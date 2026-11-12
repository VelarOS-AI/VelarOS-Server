import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type {
  ChangeNotice,
  InputReceipt,
  SessionView,
  AttachmentSummary,
} from '../../../packages/contracts/src/index.js'
import { HttpError } from './errors.js'
import { TranscriptLimits } from '../../../packages/contracts/src/index.js'

export const ProjectionLimits = { messages: 40, textChars: 8_000, facts: 24, notices: 512 } as const

const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int(),
  status: z.enum([
    'idle',
    'received',
    'accepted',
    'running',
    'waiting',
    'completed',
    'failed',
    'cancelled',
    'unknown',
  ]),
  runId: z.string().nullable(),
  inputId: z.string().nullable(),
  updatedAt: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant', 'system']),
      text: z.string(),
      truncated: z.boolean(),
      timestamp: z.iso.datetime(),
      runId: z.string().optional(),
      runStatus: z
        .enum([
          'idle',
          'received',
          'accepted',
          'running',
          'waiting',
          'completed',
          'failed',
          'cancelled',
          'unknown',
        ])
        .optional(),
      runFinishedAt: z.string().optional(),
      turnId: z.string().optional(),
      phase: z.enum(['preview', 'accepted']).optional(),
      preview: z.string().optional(),
      thinking: z.string().optional(),
      executions: z
        .array(
          z.object({
            id: z.string(),
            kind: z.enum(['execute', 'observe', 'blobs']),
            status: z.enum([
              'writing',
              'queued',
              'running',
              'succeeded',
              'failed',
              'cancelled',
              'unknown',
            ]),
            source: z.string(),
            sourceTruncated: z.boolean(),
            durationMs: z.number().nullable(),
            processOutput: z.string().optional(),
            processOutputTruncated: z.boolean().optional(),
            error: z.string().optional(),
            calls: z.array(
              z.object({
                module: z.string(),
                operation: z.string(),
                status: z.enum(['pending', 'succeeded', 'failed', 'cancelled']),
                effect: z.enum(['none', 'committed', 'partial', 'unknown']),
                input: z.string(),
                output: z.string(),
                inputTruncated: z.boolean(),
                outputTruncated: z.boolean(),
              }),
            ),
          }),
        )
        .optional(),
      attachments: z
        .array(
          z.object({
            name: z.string(),
            kind: z.enum(['text', 'image']),
            mediaType: z.string(),
            bytes: z.number().int().nonnegative(),
          }),
        )
        .optional(),
    }),
  ),
  interaction: z
    .object({
      id: z.string(),
      runId: z.string(),
      message: z.string(),
      kind: z.enum(['confirm', 'question']),
    })
    .nullable(),
  facts: z.array(z.object({ sessionId: z.string(), runId: z.string(), recordId: z.string() })),
  contextUsage: z
    .object({
      requestId: z.string(),
      model: z.string(),
      inputTokens: z.number().nonnegative(),
      inputWindow: z.number().positive(),
    })
    .optional(),
})

const rowSchema = z.object({ projection: z.string() })
const requestSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  fingerprint: z.string(),
  input_id: z.string().nullable(),
  run_id: z.string().nullable(),
  status: sessionSchema.shape.status,
})

type InputAdmission = { receipt: InputReceipt } | { receipt: InputReceipt; notice: ChangeNotice }

/** 只存产品索引、有界投影、去重指纹和事实引用；通知表不保存事件正文。 */
export class ProductStore {
  public readonly db: DatabaseSync

  public constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS product_schema (version INTEGER NOT NULL);
      INSERT INTO product_schema SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM product_schema);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, projection TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        input_id TEXT, run_id TEXT, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS browser_sessions (
        digest TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    const schema = z
      .object({ version: z.literal(2) })
      .safeParse(this.db.prepare('SELECT version FROM product_schema').get())
    if (!schema.success) throw new HttpError(500, 'SCHEMA_MISMATCH', '产品数据库版本不受支持')
    // 进程重启不是运行成功或取消的证据，所有未收束记录明确变为 unknown。
    for (const session of this.listSessions()) {
      const unfinished = ['received', 'accepted', 'running', 'waiting'].includes(session.status)
      const previews = session.messages.some((message) => message.phase === 'preview')
      if (unfinished || previews) {
        session.messages = session.messages.filter((message) => message.phase !== 'preview')
        for (const message of session.messages)
          if (unfinished && message.runId === session.runId) message.runStatus = 'unknown'
        for (const message of session.messages)
          for (const card of message.executions ?? [])
            if (['writing', 'queued', 'running'].includes(card.status)) card.status = 'unknown'
      }
      if (unfinished) {
        session.status = 'unknown'
        session.interaction = null
      }
      if (unfinished || previews) this.saveSession(session)
    }
    this.db
      .prepare(
        "UPDATE requests SET status='unknown' WHERE status IN ('received','accepted','running','waiting')",
      )
      .run()
  }

  public listSessions(): SessionView[] {
    return this.db
      .prepare('SELECT projection FROM sessions ORDER BY rowid DESC')
      .all()
      .map((row) => sessionSchema.parse(JSON.parse(rowSchema.parse(row).projection)))
  }

  public getSession(id: string): SessionView {
    const row = this.db.prepare('SELECT projection FROM sessions WHERE id=?').get(id)
    if (!row) throw new HttpError(404, 'NOT_FOUND', '会话不存在')
    return sessionSchema.parse(JSON.parse(rowSchema.parse(row).projection))
  }

  public createSession(title: string, id: string = randomUUID()): SessionView {
    const existing = this.db.prepare('SELECT projection FROM sessions WHERE id=?').get(id)
    if (existing) return sessionSchema.parse(JSON.parse(rowSchema.parse(existing).projection))
    const session: SessionView = {
      id,
      title,
      revision: 0,
      status: 'idle',
      runId: null,
      inputId: null,
      updatedAt: new Date().toISOString(),
      messages: [],
      interaction: null,
      facts: [],
    }
    this.db
      .prepare('INSERT INTO sessions (id,projection) VALUES (?,?)')
      .run(session.id, JSON.stringify(session))
    return session
  }

  public saveSession(session: SessionView): ChangeNotice {
    return this.transaction(() => this.persistSession(session))
  }

  private persistSession(session: SessionView): ChangeNotice {
    session.messages = session.messages.slice(-ProjectionLimits.messages).map((message) => ({
      ...message,
      text: message.text.slice(0, ProjectionLimits.textChars),
      truncated: message.truncated || message.text.length > ProjectionLimits.textChars,
      preview: message.preview?.slice(0, ProjectionLimits.textChars),
      thinking: message.thinking?.slice(0, TranscriptLimits.thinkingChars),
      executions: message.executions?.slice(-TranscriptLimits.executions).map((card) => ({
        ...card,
        source: card.source.slice(0, TranscriptLimits.sourceChars),
        sourceTruncated: card.sourceTruncated || card.source.length > TranscriptLimits.sourceChars,
        processOutput: card.processOutput?.slice(0, TranscriptLimits.outputChars),
        processOutputTruncated:
          card.processOutputTruncated ||
          (card.processOutput?.length ?? 0) > TranscriptLimits.outputChars,
        error: card.error?.slice(0, TranscriptLimits.outputChars),
        calls: card.calls.slice(0, TranscriptLimits.calls).map((call) => ({
          ...call,
          input: call.input.slice(0, TranscriptLimits.callChars),
          output: call.output.slice(0, TranscriptLimits.callChars),
          inputTruncated: call.inputTruncated || call.input.length > TranscriptLimits.callChars,
          outputTruncated: call.outputTruncated || call.output.length > TranscriptLimits.callChars,
        })),
      })),
    }))
    session.facts = session.facts.slice(-ProjectionLimits.facts)
    session.revision++
    session.updatedAt = new Date().toISOString()
    this.db
      .prepare('UPDATE sessions SET projection=? WHERE id=?')
      .run(JSON.stringify(session), session.id)
    const result = this.db
      .prepare('INSERT INTO changes (session_id,revision) VALUES (?,?)')
      .run(session.id, session.revision)
    const sequence = Number(result.lastInsertRowid)
    this.db
      .prepare('DELETE FROM changes WHERE sequence <= ?')
      .run(sequence - ProjectionLimits.notices)
    return { sequence, sessionId: session.id, revision: session.revision }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  public admitInput(
    requestId: string,
    sessionId: string,
    text: string,
    identity = text,
    attachments: AttachmentSummary[] = [],
  ): InputAdmission {
    const fingerprint = createHash('sha256').update(identity).digest('hex')
    return this.transaction((): InputAdmission => {
      const existing = this.db.prepare('SELECT * FROM requests WHERE id=?').get(requestId)
      if (existing) {
        const row = requestSchema.parse(existing)
        if (row.session_id !== sessionId || row.fingerprint !== fingerprint)
          throw new HttpError(409, 'REQUEST_CONFLICT', '同一请求身份不能提交不同内容')
        return {
          receipt: {
            requestId,
            sessionId,
            inputId: row.input_id,
            runId: row.run_id,
            status: row.status,
            replayed: true,
          },
        }
      }
      const session = this.getSession(sessionId)
      if (['received', 'accepted', 'running', 'waiting', 'unknown'].includes(session.status))
        throw new HttpError(409, 'SESSION_BUSY', '会话仍有执行或未知结果，请先核对原运行')
      this.db
        .prepare(
          "INSERT INTO requests (id,session_id,fingerprint,status) VALUES (?,?,?,'received')",
        )
        .run(requestId, sessionId, fingerprint)
      session.status = 'received'
      session.runId = null
      session.inputId = null
      session.interaction = null
      if (session.title === '新会话' && session.messages.length === 0)
        session.title = (text.trim().split('\n')[0] || attachments[0]?.name || '附件对话').slice(
          0,
          40,
        )
      session.messages.push({
        id: requestId,
        role: 'user',
        text,
        truncated: false,
        timestamp: new Date().toISOString(),
        ...(attachments.length ? { attachments } : {}),
      })
      return {
        receipt: {
          requestId,
          sessionId,
          inputId: null,
          runId: null,
          status: 'received',
          replayed: false,
        },
        notice: this.persistSession(session),
      }
    })
  }

  public saveRunSession(requestId: string, session: SessionView): ChangeNotice {
    return this.transaction(() => {
      this.db
        .prepare('UPDATE requests SET input_id=?,run_id=?,status=? WHERE id=?')
        .run(session.inputId, session.runId, session.status, requestId)
      return this.persistSession(session)
    })
  }

  public changesAfter(sequence: number): {
    current: number
    reset: boolean
    notices: ChangeNotice[]
  } {
    const rows = this.db
      .prepare('SELECT sequence,session_id,revision FROM changes ORDER BY sequence')
      .all()
      .map((row) =>
        z.object({ sequence: z.number(), session_id: z.string(), revision: z.number() }).parse(row),
      )
    const current = rows.at(-1)?.sequence ?? 0
    return {
      current,
      reset: sequence > current || (sequence !== 0 && sequence < (rows[0]?.sequence ?? 0) - 1),
      notices: rows
        .filter((row) => row.sequence > sequence)
        .map((row) => ({
          sequence: row.sequence,
          sessionId: row.session_id,
          revision: row.revision,
        })),
    }
  }

  public close(): void {
    this.db.close()
  }
}
