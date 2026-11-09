# Windows PTY 真实接缝：停止身份与退出资源

2026-11-09。固定基础候选 `@velaros-ai/velaros@0.9.0`，SHA-256 `ba4c31c49582380d84f63b884c44bc2fbd4897bb45bbda6a33ad68f1aa789045`；来源证明对应 `697bcba2fdff5b7160116a7c936876df8bf4abb2`。Node 24.22.0，Windows x64，`@lydell/node-pty@1.2.0-beta.15`。

最短重现：`node scripts/verify.mjs terminal-seam`。测试只创建公开 `createShellEnvironment`、`createLocalShellHost` 与 PTY factory；不创建 Runtime 或模型，不修改 SDK。测试入口 `tests/terminal-seam.test.ts`。

原始事实：PTY `spawn()` 立即返回时 `pid=0`；实际输出出现后 `pid=25900`，Host `listBackgroundTasks()` 的同一任务仍保存 `pid=0`。shell 是 `git-bash`，拼接命令产生的实际哨兵输出已核对，排除了仅回显命令误判成功。

首个原始错误：`host.terminateBackgroundTask({taskId,sessionId,force:false})` 抛 `AppError`，`code='PERMISSION'`，`message='无法确认后台进程的受管身份。'`。调用栈：公开 Host → `ShellCommandRunner.terminateTask` → 受管 PID 与任务快照 PID 比较。SDK 归档中的该比较位于 `dist/execution/impl/local/ShellCommandRunner.js:156`。

`host.dispose()` 已兑现后，`process.getActiveResourcesInfo()` 仍为 `['PipeWrap','PipeWrap','PipeWrap','MessagePort','PipeWrap']`；Node 测试未自然退出，外层 30 秒验证预算最终中止。这里只证明资源仍存活；MessagePort 的具体归属需要 owner 继续核实，不能只凭类型断定。静态线索：WindowsTerminal 在 ready_datapipe 后补 PID；ShellManagedProcess 对 PTY 使用通用进程树终止，未调用注入 terminal.kill。不能据此把未经验证的修改作为结论。

Server 不取消身份核对，不保存第二份进程表，不吞错或添加私有强杀兜底。Linux PTY 未在本机验证，不能把此 Windows 失败泛化成 Linux 结论。

与此分离的真实 Server 链已经观察到：HTTP 输入接纳、原 interaction id/runId、执行前文件不存在、确认后真实 Node 写入、外部文件读取核对、Runtime completed 和终端 SSE 实际输出；模型使用确定性驱动，未验证供应商 API。该组合测试因上述终端失败整体未通过，不记为完整验收。

## 0.9.1 关闭缺口

同一原始 `terminal-seam` 仅复验一次，固定基础 SHA-256 `7845f1e6c90fd93f90faf8d5c52203a7110580054365419acb1c38d72d0e93c2`、源提交 `e3e157696994a0d667cbd542a809484b93e40e71`。初始 PID=0，就绪后实际 PID=44000，Host 任务 PID=44000；实际哨兵输出、原 taskId 停止和 exited 状态全部通过。测试正文 1727.13 ms，Node runner 总计 3137.62 ms，自然退出码 0，没有强制退出或 Server 私有进程补丁。

Host close 兑现瞬间仍能观察到短暂的 MessagePort/管道/定时器，随后 Node 正常退出；不能把瞬时资源列表宣称为已经全空，也不能据此继续沿用原“无法自然退出”的失败结论。这里只关闭已复现的 Windows 缺口，Linux PTY 仍需要独立产品安装证据。已通过 Agent 链、网页和四边界场景没有重跑。
