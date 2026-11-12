import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import type { ModelDriver } from '@velaros-ai/velaros/kernel'
import type { ExecutionMode } from '../packages/contracts/src/index.js'
import { composePlatform } from '../apps/server/src/platform-composition.js'
import { ProductStore } from '../apps/server/src/store.js'

for (const [mode, approved, expectedConfirmations] of [
  ['standard', true, 1],
  ['standard', false, 1],
  ['full', true, 0],
  ['ask', true, 2],
  ['ask', false, 1],
] as const) {
  test(
    `真实 SDK 执行档位 ${mode}，回答 ${approved}：程序审批与内部确认`,
    { timeout: 15000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'velaros-execution-modes-'))
      const cwd = join(directory, 'work')
      const state = join(directory, 'state')
      await mkdir(cwd)
      await mkdir(state)
      const target = join(cwd, 'result.txt')
      const source = `import { confirm } from 'velaros:interaction'; import { writeFile } from 'node:fs/promises'; const answer = await confirm({message:'确认本轮测试写入？'}); if (answer.approved) await writeFile(${JSON.stringify(target)}, 'approved'); console.log(JSON.stringify(answer));`
      let calls = 0
      const model: ModelDriver = {
        id: 'execution-modes-fixture',
        nativeTools: true,
        limits: { inputTokens: 100000, contextTokens: 120000, outputTokens: 2000 },
        estimate: async () => ({
          tokens: 1000,
          precision: 'estimate',
          basis: 'execution modes fixture',
        }),
        stream: async function* () {
          assert.ok(++calls <= 2)
          if (calls === 1)
            yield {
              type: 'tool-call',
              value: {
                id: 'run-program',
                name: 'exec',
                input: { code: source, options: { async: false } },
              },
            }
          else
            yield {
              type: 'tool-call',
              value: {
                id: 'done',
                name: 'done',
                input: { message: '测试已结束', completion: '已核对执行确认结果' },
              },
            }
          yield { type: 'finish', reason: 'stop' }
        },
      }
      const store = new ProductStore(':memory:')
      const platform = await composePlatform({
        cwd,
        dataDirectory: state,
        roots: [cwd],
        store,
        mode: 'danger-full-access',
        approval: 'ask',
        model,
      })
      const session = store.createSession('execution modes')
      let confirmations = 0
      let completed = false
      const answers: Promise<void>[] = []
      try {
        await platform.execution.submit(
          {
            sessionId: session.id,
            requestId: randomUUID(),
            text: '运行确定性确认测试',
            executionMode: mode as ExecutionMode,
          },
          (notice) => {
            if (notice.type === 'interaction' && notice.request) {
              confirmations++
              const answer = platform.execution.answer(session.id, notice.request, approved)
              void answer.catch(() => {})
              answers.push(answer)
            }
            if (notice.type === 'state' && notice.status === 'completed') completed = true
          },
        )
        await Promise.all(answers)
        assert.equal(confirmations, expectedConfirmations)
        assert.equal(completed, true)
        if (approved) assert.equal(await readFile(target, 'utf8'), 'approved')
        else await assert.rejects(readFile(target), { code: 'ENOENT' })
        assert.equal(calls, 2)
      } finally {
        await platform.close()
        store.close()
        const actual = await realpath(directory)
        assert.equal(dirname(actual).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
        assert.ok(basename(actual).startsWith('velaros-execution-modes-'))
        await rm(actual, { recursive: true, force: true })
      }
    },
  )
}
