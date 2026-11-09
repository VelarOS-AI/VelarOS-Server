# Platform 受管接入

组合根按 ADR 0028 消费 `@velaros-ai/velaros/node`、`/execution/local`、`/execution` 与公开合同类型。没有兄弟仓源码导入、私有 dist 路径、能力扩展、旧 workspace 配置或 Host 副本。

当前基础归档为 `vendor/runtime/velaros-ai-velaros-0.9.3.tgz`，SHA-256 `7e65c6627a046aecc937e13b0442cd14dcf3e323bc583147eae8b0b072f0ca59`，源码 `308b3f306f103ba1942b6fd383ab558c441f82f0`，正式 tag v0.7.4。已核本仓字节、归档包名/版本/代际、上游正式 receipt 与 GitHub asset digest。发布来源及实际 URL 登记于 `resources/platform-provenance.json`。旧 0.9.2 归档及安装回执保持原字节、源码与版本身份。

生产 manifest 与 bun.lock 已切到本仓固定正式基础文件，直接 `bun install --frozen-lockfile`。基础没有 UI 宿主 peer；不安装 capabilities，不从兄弟仓或 `.cache/integration` 解析依赖。早期 no-save 联调脚本已退役。打包前再次核对归档 SHA 和 manifest 指向，最终 UI 同样由本仓固定归档提供。

一个 ShellEnvironment 和一个 LocalShellHost 同时供 Node 执行和交互终端使用。Host 注入 Node 装配后仍归 Server；先 Runtime.close，再 Host.dispose，再环境释放。close 失败保留资源所有权，不把退出期限当作真实回收。状态目录必须在执行 cwd 之外。

执行身份从部署实例、用户、真实 Node 派生；授权身份从 cwd、状态根、批准根、模式和策略修订派生。每个产品会话首次写入身份元数据，恢复前逐字核对；这不是第二份执行历史。

产品 requestId 只提交一次并作 SDK inputId 关联，真正接纳使用 input 事实及其 ref；SDK accepted 只投影已接纳模型正文。text/program 预览不当作执行结果。取消只发意图，等待真实终态。Session 的 pending、answer 和 request 提供确认/问答原身份，浏览器不会自行构造新运行来回答旧请求。

模型显式选择底座已有的 `openai`（Responses）或 `openai-compatible-gateway`（Chat Completions）适配器，不按地址猜协议、不回退另一线路，不把任意字符串当已注册 Provider。活动运行继续使用原连接，结束后下次输入才重建 Runtime。运行事实和程序原文留在底座，产品只保有界投影与事实引用。

Server 的真实 Node/网页确认绿项保留于 0.9.0 原身份，不重复整链。0.9.1 原终端失败路径的 PID 对齐、实际输出、停止、exited 和 Node 自然退出通过证据保留。0.9.2 的实际增量为通用只读 trace，未以此重复 Agent、Windows PTY 或网页场景。基础 Linux 证明沿用 owner 原单轮；Server 最终 0.9.2 的独立生产安装、HTTP、文件读写、原生 PTY 输出/停止/exited 和主 SIGTERM 零退出码已在本仓 [run 42581492981](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42581492981) 通过。systemd 与真实供应商 API 不在本轮证明内。

UI 已切到本仓固定的正式 v1.1.0 同字节归档。聊天从 `@velaros-ai/ui/conversation/basic` 消费同一 ChatConversationPane，使用配套 conversation-basic.css；AppShell、Input/Button、Select 与 Composer 继续用已有公开入口。显式挂载公开 ConversationBlockHooksProvider 与中立 hooks，避免仅空会话可用、有消息时因漏装配崩溃。终端 xterm 按页加载，不修改库或复制渲染器。

当前 0.9.3 的独立 Linux 产品安装已在 [run 42607896603](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42607896603) 通过，制品源为 `19d426196d43238f38d83ae1c3712438e1b0fd48`，包括此前 2eb7622 的全部服务与网页修复。网页仅在该 Linux 轮次冷构建一次；原 UI 交互、Agent 与 Windows PTY 证明未重跑、未重标为新归档执行。此次新证明覆盖生产安装、HTTP、文件读写及模式、原生 PTY 输出/停止/exited 和主服务 SIGTERM 零退出码；精确摘要见 `docs/evidence/linux-install-19d4261.json`。provenance 中的 `linuxProductInstall: false` 记录采用依赖时的状态，不替代本次产品回执。

实际有消息场景已核对中文、列表、普通代码与表格，浏览器无新错误。静态总产物从 404 文件、16,029,876 bytes 变为 16 文件、3,020,832 bytes，减少 81.15%；该数字不是首屏下载。总产物还含约 1.13 MB 主 JS 和代码格式化等基础资源，不宣称已完成所有体积优化。
