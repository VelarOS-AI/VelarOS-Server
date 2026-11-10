# Platform 受管接入

组合根按 ADR 0028 消费 `@velaros-ai/velaros/node`、`/execution/local`、`/execution` 与公开合同类型。没有兄弟仓源码导入、私有 dist 路径、能力扩展、旧 workspace 配置或 Host 副本。

当前基础归档为 `vendor/runtime/velaros-ai-velaros-0.9.6.tgz`，SHA-256 `de2a4ae3b11f93abb5ce66516007c3234037cde0ba5c2a8f47be9f8825f82726`，源码 `eb6b7310aafe3e788f5131c304c2c727372e5268`，正式 tag v0.7.7。安装前独立下载并核本仓字节、归档包名/版本/代际、空 peer、上游正式 manifest/receipt 与 GitHub asset digest。基础和 UI 的第三方依赖、peer 与原固定版本分别相同，未扩大生产闭包。发布来源及实际 URL 登记于 `resources/platform-provenance.json`。旧归档、安装和 Agent 回执保持原字节、源码与版本身份。

生产 manifest 与 bun.lock 直接声明本仓固定正式基础文件，UI 直接声明固定正式构建归档，不使用 override、数字版本映射或本地 link。安装使用 `bun install --frozen-lockfile`。基础没有 UI 宿主 peer；不安装 capabilities，不从兄弟仓或 `.cache/integration` 解析依赖。早期 no-save 联调脚本已退役。打包前再次核对归档 SHA 和 manifest 指向。

一个 ShellEnvironment 和一个 LocalShellHost 同时供 Node 执行和交互终端使用。Host 注入 Node 装配后仍归 Server；先 Runtime.close，再 Host.dispose，再环境释放。close 失败保留资源所有权，不把退出期限当作真实回收。状态目录必须在执行 cwd 之外。

Server 将 `createLocalShellHost()` 的真实实例直接交给 `createNodeRuntime()`，没有产品 ShellHost 包装或私有 SDK shim。Core 负责将 `observationSupport()` 转发至执行器；支持报告来自实际只读约束后端，真实采集仍检查隔离。缺后端时 observe 只提供历史选择与 clear，不回落普通 exec；Server 不接管观察历史、动态材料或索引，也不拼接 compiledPrompt/protocol/dynamic。

执行身份从部署实例、用户、真实 Node 派生；授权身份从 cwd、状态根、批准根、模式和策略修订派生。每个产品会话首次写入身份元数据，恢复前逐字核对；这不是第二份执行历史。

产品 requestId 只提交一次并作 SDK inputId 关联，真正接纳使用 input 事实及其 ref；SDK accepted 只投影已接纳模型正文。text/program 预览不当作执行结果。取消只发意图，等待真实终态。Session 的 pending、answer 和 request 提供确认/问答原身份，浏览器不会自行构造新运行来回答旧请求。

模型显式选择底座已有的 `openai`（Responses）或 `openai-compatible-gateway`（Chat Completions）适配器，不按地址猜协议、不回退另一线路，不把任意字符串当已注册 Provider。活动运行继续使用原连接，结束后下次输入才重建 Runtime。运行事实和程序原文留在底座，产品只保有界投影与事实引用。

Server 早期真实 Node/网页确认绿项保留于 0.9.0 原身份。0.9.1 原终端失败路径的 PID 对齐、实际输出、停止、exited 和 Node 自然退出通过证据保留。0.9.2 的实际增量为通用只读 trace，未以此重复 Agent、Windows PTY 或网页场景。基础 Linux 证明沿用 owner 原单轮；Server 最终 0.9.2 的独立生产安装、HTTP、文件读写、原生 PTY 输出/停止/exited 和主 SIGTERM 零退出码已在本仓 [run 42581492981](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42581492981) 通过。systemd 与真实供应商 API 不在本轮证明内。

UI 已切到本仓固定的正式 v1.1.1 归档，公开入口、props、样式和依赖合同保持不变，无需产品迁移。聊天从 `@velaros-ai/ui/conversation/basic` 消费同一 ChatConversationPane，使用配套 conversation-basic.css；AppShell、Input/Button、Select 与 Composer 继续用已有公开入口。显式挂载公开 ConversationBlockHooksProvider 与中立 hooks，避免仅空会话可用、有消息时因漏装配崩溃。终端 xterm 按页加载，不修改库或复制渲染器。

此前 0.9.3 的独立 Linux 产品安装已在 [run 42607896603](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42607896603) 通过，制品源为 `19d426196d43238f38d83ae1c3712438e1b0fd48`，包括此前 2eb7622 的全部服务与网页修复。网页仅在该 Linux 轮次冷构建一次；原 UI 交互、Agent 与 Windows PTY 证明未重跑、未重标为新归档执行。此次证明覆盖生产安装、HTTP、文件读写及模式、原生 PTY 输出/停止/exited 和主服务 SIGTERM 零退出码；精确摘要见 `docs/evidence/linux-install-19d4261.json`。provenance 中的 `linuxProductInstall: false` 记录相应依赖采用时的状态，不替代独立产品回执。

随后同一 19d4261 安装包在独立 [run 42610262328](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42610262328) 通过当前 0.9.3 的真实 Agent 整链：产品 HTTP 创建会话与输入、两次审批、Agent/Kernel 真实 Node 读写并完成、第二次运行取消、SSE 变化，以及 Host/服务关闭后的自有 Node 资源回收。只替代外部模型为本地确定性兼容 Chat Completions 的 HTTP/SSE 服务，没有替代底座执行或复用旧 0.9.0 结果。先核原制品 SHA，未重装依赖或重建产物；脚本源 `b2e791b` 与产品源 `19d4261` 分别记录于 `docs/evidence/agent-chain-19d4261.json`。取消接口受理不等于进程关闭，后者以实际 child close 和进程身份检查为准；不覆盖供应商 API、网页交互、bubblewrap、systemd 或生产部署。

正式 0.9.4 消费后仅补一次 Server 严格类型/编译和既有 `platform-seam`，全部通过。确定性模型先单独选择空历史目录，下一轮核对真实 selected 回执、dynamic 目录、完整原生往返及一次性交付，再经原 HTTP 审批执行真实 Node 写入、外部读取核对、done 与 Runtime/Host 关闭。fixture 使用官方 `modelRequestEncoder.layout()`；稳定 compiledPrompt、本轮 protocol 和动态尾区按完整编码检查，不用旧字段拼接替代。实际 Windows 后端报告 read-only 不可用，历史控制仍正常；没有执行观察程序，不把此结果当只读采集成功。证据见 `docs/evidence/platform-094-seam.json`。旧 19d4261 / 0.9.3 安装包及其回执未改；本轮不重建网页、生产包或 Linux 安装矩阵。

此前 0.9.5 修复 Core 内部 npm 包环境及 RuntimeBootstrap 的查询转发，并将 `/script` 的 `createNodeCodeRunner` 返回值细化为保证查询存在的 `NodeCodeRunnerApi`；输入与既有调用合同不变。Server 未配置 packageEnvironment，不经过 npm 环境包装，不添加产品兼容层。正式同归档的查询转发证明由 Core 持有，覆盖状态、原因、receiver 和方法替换且零命令，不代表只读采集成功。本仓当轮仅补一次 `server-types`，严格类型/编译通过，约 8.21 秒；该轮精确消费证据见 `docs/evidence/platform-095-adoption.json`。

此前 UI 1.1.0 的有消息场景已核对中文、列表、普通代码与表格，浏览器无新错误。该轮静态总产物从 404 文件、16,029,876 bytes 变为 16 文件、3,020,832 bytes，减少 81.15%；这是原身份下的总产物，不是首屏下载。

0.9.6 与 UI 1.1.1 的最终接入只消费公开正式归档。实际入口、严格声明、HTTP/审批/真实 Node 文件/关闭、当前网页构建及隔离浏览器效果见 `docs/evidence/platform-096-ui-111-adoption.json`；没有复制底座或 UI 内部修复。旧 Linux 制品没有重建或重标。
