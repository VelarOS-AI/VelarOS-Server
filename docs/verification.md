# 当前验证与交接

2026-11-10 更新。区分产品协议、真实底座链与发行验收，不互相替代。

- 四个轻量产品边界场景一次通过，Node 24.22.0，约 566 ms：SQLite、HTTP/SSE、文件路径与冲突、请求去重和未知状态。执行端口为测试注入；结果保留，不重复。
- Server 严格类型/编译和 Web 严格类型通过，`strict=true`、`skipLibCheck=false`。Server 添加 DOM 声明以消费供应商 HTTP 类型；未启用额外的 exactOptionalPropertyTypes 模式，该模式暴露了 ai 依赖自身的声明错误，没有用 skipLibCheck 掩盖。
- 随后修正模型协议接线：显式区分 OpenAI Responses 与兼容 Chat Completions，使用现有 UI Select 和底座适配器。只补 Server/Web 类型，两项通过；未重复 Agent 绿项或网页构建。当前协议选项与后续固定依赖将在最终交付窗口合并构建，现有网页产物不冒称包含这项后续改动。
- 真实 SDK 接缝单独通过：`node scripts/verify.mjs platform-seam`。约 1.90 秒测试正文、3.81 秒含 Node runner；HTTP 202 与真实 input 分开、确认前文件不存在、按原 id/runId 回答、真实 Node 写文件、外部读取核对、completed、重复回答拒绝、Runtime/Host 关闭后自然退出。仅替代外部模型供应商，Agent/Node/存储/授权桥是真实固定包。
- 终端 SSE 与实际输出已分段观察；停止失败。最短 `terminal-seam` 场景约 2.64 秒得到原始 PERMISSION，Node 因存活资源未退出，外层 30 秒预算中止。该失败不记绿，证据在 `platform-host-issue.md`。
- 后续固定 0.9.1 已核对归档元数据、SHA、658 输入的提交树证明并进入本仓 vendor/生产 manifest/lock。原 terminal-seam 只补一次，通过 PID 对齐、实际 PTY 输出、停止、exited；正文约 1.73 秒，Node 总约 3.14 秒自然退出码 0。其他 Agent/边界/网页绿项保留原归档和产品身份，不重复运行。
- UI 1.1.0 按候选 SHA 一次切入本仓 vendor、manifest、lock，随后正式发布同字节资产，来源记录单独更新，不因发布标签重装或重构建。必要 Server/Web 类型通过；一个有消息的聊天场景发现 Server 漏装 ConversationBlockHooksProvider，补齐公开装配后仅补 Web 类型/构建和原场景，通过中文/列表/普通代码/表格，未出现新浏览器错误。截图 `.cache/server-basic-ui.png`；独立 fixture 正常退出，未调用 Agent 或连接终端。
- 最终轻量静态总产物 16 文件、3,020,832 bytes（2.88 MiB），相对原 404 文件、16,029,876 bytes 减少 81.15%，不是首屏流量。
- 最终基础已核实为实际发布的 0.9.2 / tag v0.7.3，SHA-256 `285083f64db4f31869af25d2f8cbd944f82eed8bbea03fa08fb1deaea6fec5b2`，源 `ae20dcebf5d086d99ff7d8df1701d71a91574efe`；本机归档、GitHub asset digest、正式 receipt 一致。仅基础进入 vendor/manifest/lock，不安装 capabilities。UI 同字节、只读 trace 的真实 delta 没有触发 Agent、Windows 终端或网页绿项重跑。
- 0.9.2 实装后仅补受影响的 Server 严格类型/编译，通过；原 UI 1.1.0 源码、归档和展示均未变，保留前端绿项。最终 Linux 冷构建会为两份正式输入生成本机产物与回执，不以旧 Windows dist 冒充 Linux 发行。
- 网页严格类型通过；含真实聊天 UI、确认面板与懒加载 xterm 的 Vite 构建通过，5.13 秒。后续小修的受影响静态门集中补查，不重新跑 Agent 链。
- 使用单独隐藏 IAB 和本仓 `.cache/browser-fixture` 完成实际页面检查：登录、创建维护会话、四入口、读取样例配置与 390px 窄屏；页面宽度与 scrollWidth 均为 390px、主区 324px，未见横向页面溢出。四页无浏览器 error 日志。没有连接已知失败的 Windows PTY，没有设置真实密钥，没有操作用户现有屏幕。截图 `.cache/server-preview.png`；已恢复 viewport，关闭一次性 fixture 进程。此检查不是 Agent 浏览器 E2E，Server Linux 部署仍未验收。

所有类型/构建/真实进程验证用 `scripts/verify.mjs` 的 wx 共享锁、独占 token 和 finally 释放；每步最多 45 秒、Node 2 GiB。只补失败或本批受影响步骤。禁止默认全量回归、压力测试、大型矩阵或反复构建。

Platform 0.9.0 的 Ubuntu/Node 24 基础 CI 由 owner 持有；这里不复做，也不把它当 Server 安装验收。此前私有 Linux job 在 runner 分配前被账户付款/消费限额阻止，runner_id=0、执行步骤为零；没有安装/HTTP/PTY 结果。用户随后明确授权 Server 开源，改用本仓手动单 job。真实供应商 API、systemd 实装不在本轮证明内。没有触碰 Cloud 生产服务或其他仓源码。

公开仓库实际为 PUBLIC、GitHub 识别 Apache-2.0。应用源码、合同、锁及两个正式 vendor 与原冻结源码一致；公开历史仅从正式依赖快照开始，未上传旧候选包开发历史。源码快照为 `8f58240b4065492c88a22716f3ab2931c77a0747`，独立 CI 接线为 `4a0d1888c024e7ccca2fd3ba783996c114d5873b`。

[Server Linux run 42580381502](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42580381502) 的 headSha 与上述 CI 提交一致。两个 attempt 均分配了真实 Ubuntu runner，checkout 与 Node 安装通过，固定官方 Bun 1.4.3 下载连续 HTTP 504。官方发布 API 确认资产存在且地址正确，SHA-256 `3e730528d89775f03f87f05c06787c4df4099d0a37f3f252e7b829cb23816e18`。仅对首次失败 job 恢复过一次；没有改版本、来源或应用代码。第二次 job `129038290877` 于 2026-11-09 15:40:46（北京时间）结束，产品验证与 artifact 上传步骤均 skipped。此结果是安装工具下载阻塞：没有运行冻结依赖安装、Linux 类型/构建、生产打包、HTTP、文件读写、原生 PTY 或 SIGTERM 验证，不记为产品代码失败或 Linux 验收通过。随后经诊断切换同一官方资产的 API 入口，实际通过结果如下。

最终 [Server Linux run 42581492981](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42581492981) 于 2026-11-09 15:48:39（北京时间）完成，单个 job 1m34s，产品安装步骤约 22 秒，通过。headSha 精确为 `165139c90caaeab917fd9920985ff070c619ca7a`；CI 接线只更改同一官方 Bun 1.4.3 资产的 API 下载入口，先核官方 SHA 和实际版本，没有改应用、依赖或增加镜像。

真实 Ubuntu 24.04 x64 / Node 24.22.0 冷安装、必要 Server/Web 类型与网页构建、生产打包和新目录安装通过。真实产品 main 的 HTTP 登录、静态网页、样例文件读取/修改及模式保留、原生 PTY 实际输出、按原 taskId 停止并观察 exited、主服务 SIGTERM 后自然退出码 0 均通过。生产安装没有 UI/React/Electron/capabilities；本机下载后另核产物 SHA、文件清单源码身份、两个回执一致及根 LICENSE 包含，未重复运行 Agent 或其他原绿项。`resources/platform-provenance.json` 的 false 标记保留的是依赖采用时尚未进行产品安装的历史状态，以本次独立产品回执为当前证据。

生产包 `velaros-server-0.1.0-linux-x64.tar.gz`，40,282,169 bytes，SHA-256 `aaf806a6451e1406a0dd1de9acc7101588e7082f54c0511fcc2c4b50f56a0197`。artifact ID 13656869693，保留 3 天；永久保存的精简结果见 [evidence/linux-install-165139c.json](evidence/linux-install-165139c.json)。此证明使用 danger-full-access，不覆盖 bubblewrap、systemd、供应商模型或真实生产服务维护；没有部署到 Cloud 或用户生产主机。

后续源码自查阅读了四页、HTTP/存储/文件、运行桥、Host/终端适配、打包与依赖边界。旧私有 carrier 已移除；网络故障隔离的 catch、资源所有权及必要 unknown 保留，没有为形式整洁新增框架。发现并修复两个具体控制问题：对已退出终端的并发重连原本能分别越过异步状态检查，现把检查与启动统一放进同一在途 open；审批展示原本在执行端接纳前被清除，现仅在成功后清除匹配提示，拒绝时保留原提示，临时并发回答保护在 finally 释放且不持久化第二份运行事实。

本批只补 Server 严格类型/编译、两个不创建 Host/Agent 的控制交错测试（合计 Node runner 298.55 ms）和一个受协议 fixture 修正影响的真实 HTTP 边界（380.60 ms），全部通过。其余绿项未重复；既有生产包和 Linux 回执准确对应源码 165139c，不包含后续这两处控制修复，不将新源码冒充已核对的原归档。

文件页另外关闭保存进行时继续编辑/选择文件的窗口，避免请求返回覆盖期间的新草稿；仅设置现有保存状态下的禁用属性，没有增加缓存或业务状态。此改动只补 Web 严格类型和受影响的网页构建，通过；原浏览器绿项保留。当前静态总产物 16 文件、3,020,846 bytes，相对原 16,029,876 bytes 仍减少 81.15%。该后续网页修复同样不在原 165139c 安装归档内。

2026-11-09 正式基础升级至 0.9.3 / tag v0.7.4，源 `308b3f306f103ba1942b6fd383ab558c441f82f0`，SHA-256 `7e65c6627a046aecc937e13b0442cd14dcf3e323bc583147eae8b0b072f0ca59`。本仓归档、上游 manifest/receipt 与 GitHub asset digest 一致；只更新基础依赖及 lock 的归档路径和 integrity，第三方依赖与 UI 1.1.0 不变。本机只补 Server 严格类型/编译，通过；本机不重建网页。本轮 Linux 工作流按下述固定源码冷构建网页一次并组装生产制品，旧 Linux、网页与供应商证据没有重标为 0.9.3 执行结果。

[0.9.3 最终 Linux 安装 run 42607896603](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42607896603) 首次执行成功，2026-11-09 19:18:36（北京时间）完成，job 39 秒，产品安装步骤 24 秒。源精确为 `19d426196d43238f38d83ae1c3712438e1b0fd48`，包含 2eb7622 之前的全部控制与文件保存保护修复。采用既有 Ubuntu 24.04 x64 / Node 24.22.0 / Bun 1.4.3 公有工作流，没有扩展矩阵或重新执行原 Agent、UI 交互、Windows PTY 场景。

新产品归档 `velaros-server-0.1.0-linux-x64.tar.gz` 为 40,298,499 bytes，SHA-256 `23ebc020c3c02968d723fb4c5369558a31073c0bb54f45768ff7328d4e4fdc6e`。GitHub artifact ID `13668329136`，ZIP 40,236,715 bytes，digest `sha256:4cf4faf51df3ad25beeea439ced9d4b8b18048a027ca5443cea3d2ed314f9a37`，本机下载实算一致。清单源、两份安装回执、基础归档 SHA、服务及网页入口哈希一致，清单 12,439 文件，包含 LICENSE，生产依赖没有 UI/React/Electron/capabilities，也没有携带旧 0.9.2 vendor。精简持久证明为 [evidence/linux-install-19d4261.json](evidence/linux-install-19d4261.json)。

该轮真实安装验证 HTTP 登录与静态网页、文件读取/修改及模式保留、原生 PTY 实际输出、按原 taskId 停止并观察 exited、主服务 SIGTERM 自然退出码 0。权限模式为 danger-full-access；该安装轮次没有执行供应商 API、Agent 整链、bubblewrap、systemd 或真实生产部署。后续证据提交只更新文档与该回执，归档仍准确对应上述构建源，不改称证据提交本身的产物。原 165139c/0.9.2 的归档和回执保持不变。

同一 19d4261 / Platform 0.9.3 安装包的独立 [Agent 整链 run 42610262328](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42610262328) 于 2026-11-09 19:35:50（北京时间）完成，测试正文约 2 秒，通过。验证脚本源为 `b2e791be69ee19bd0aeb1fdcbee0f3d28cffe025`；先核对原 artifact ZIP 与生产归档的 SHA，再直接运行原编译入口，没有重装依赖、重建网页或重新打包。精简持久证明见 [evidence/agent-chain-19d4261.json](evidence/agent-chain-19d4261.json)。

一个真实产品 HTTP 会话中先后运行两条任务。第一条通过原审批身份授权，真实 Foundation Agent/Kernel 启动 Node 写入并读回文件，实际工具结果经本地 HTTP/SSE 模型服务返回真实 `done`，进入 completed。第二条再次审批，真实 Node 启动等待程序，产品取消接口受理后观察到 cancelled。模型共收到 3 次请求，产品 SSE 观察到 26 次变化。随后 SIGTERM 产品，等待实际 child close、退出码 0，并核对所记录的自有 Node 进程身份全部消失，最后关闭模型服务与订阅、移除临时目录。取消受理与 cancelled 不单独视为进程已回收；资源关闭结论来自 Host/服务关闭后的独立检查。

此独立用例仅以确定性本地模型 HTTP 服务替代供应商，产品 HTTP、审批、Agent/Kernel、Node 执行、完成/取消状态与资源关闭均走真实安装包。仍未验证真实供应商 API、网页交互、bubblewrap、systemd 或生产部署。此前首次尝试 `42610108736` 因验证脚本缺少 `tmpdir` 导入，在 Server/Agent 启动前失败；只修复该脚本导入后补原用例，没有改变产品或依赖。

2026-11-09 当前源码正式消费基础 0.9.4 / tag v0.7.5，源 `1b0004d773ac54c9f20f3748f9f4baed021a6481`，SHA-256 `ad28c5dc3b6499140a2e176481df7decc0eb80e8c73658fa7982ba6eccfa0250`。安装前独立下载官方归档，核对 SHA-256、SHA-512 integrity、2,255,841 bytes、包名/版本/代际与空 peer；GitHub release target/asset digest、官方 manifest/validation 和本地字节一致。只将基础加入 vendor/manifest/snapshot/provenance；一次 `bun install --ignore-scripts --offline` 更新 lock，第三方依赖与 UI 1.1.0 完全不变，不安装 capabilities。

在共享 wx/token 锁下仅执行一次 `node scripts/verify.mjs server-types platform-seam`，首次全部通过。2026-11-09 23:56:06（北京时间）开始，总约 14.79 秒；Server `strict=true`、`skipLibCheck=false` 的类型/编译通过。既有单条真实产品接缝正文 2,366.30 ms，Node runner 5,697.11 ms，自然退出码 0。没有重复旧 Linux、Windows PTY 或网页交互场景。

该接缝仅替代外部模型为确定性 ModelDriver，实际走产品 HTTP 登录/输入、Foundation Agent/Kernel、真实 LocalShellHost。模型先单独提交 `observe('', { history: { kind: 'list' } })`；第二轮核对真实 selected/selectionRef/next-model-turn/executed:false 回执、空历史目录与完整原生 call/result 同处 dynamic 尾区，未进入普通可保留历史；第三轮确认选择已经消费。随后原 HTTP 审批仍在文件不存在时等待，按原交互身份授权后真实 Node 写入，模型与产品外部读取核对，再 done/completed。总计 3 次模型调用；应用、Runtime、Host、环境及存储关闭后才打印成功回执并自然退出。

fixture 用正式公开 `modelRequestEncoder.layout()` 检查完整消息，不把旧 compiledPrompt 当作完整请求。实际运行的控制 schema 与 dynamic availability 均报告当前 Windows read-only 后端不可用并给出真实原因，仍允许历史选择；没有提交观察源码，没有用 exec 冒充只读采集，也没有创建产品观察索引。精简证据见 [evidence/platform-094-seam.json](evidence/platform-094-seam.json)，含基础归档身份、源码指纹及 fixture SHA、命令与单例回执。此证明不覆盖真实供应商、只读采集、网页重建、Linux 新安装、systemd 或生产部署；既有 19d4261 / 0.9.3 制品及 bf62940 所保存的证明保留原身份。

2026-11-10 最终固定基础 0.9.5 / tag v0.7.6，源 `70e93a2b8c020ad7509a9fb2d8eb3f7a754664a7`，SHA-256 `8d8bc25d98bda5ab207c6bae05151922df77c23d1494a6e5cab17273d3db3b2b`。安装前再次独立下载实际官方归档，核对 SHA-256、SHA-512 integrity、2,256,421 bytes、包名/版本/代际及空 peer；GitHub target、asset digest/size、manifest/validation 与本仓字节一致。正式同基础 SHA 的 JS、strictDeclarations、nodeEnvironmentQuery 均为 true。一次离线安装更新基础 pin/lock/snapshot/provenance，第三方 lock 内容与 UI 1.1.0 不变，不安装 capabilities。

Core 本批修复 withPackageEnvironment 与 RuntimeBootstrap 的 observationSupport 转发，公开 Node 工厂返回类型细化为 NodeCodeRunnerApi；参数和旧调用不变。Server 没有 packageEnvironment 装配，不经过 npm 包环境包装；产品源码及既有 fixture 均未改。因公开声明有实际变化，仅补一次 `node scripts/verify.mjs server-types`，2026-11-10 00:51:12（北京时间）开始，8,214.15 ms，通过，strict=true、skipLibCheck=false。首次共享锁占用时 helper 以 23 退出且未启动检查；释放后才进行上述唯一一次实际类型/编译，未抢占其他 owner。

0.9.4 的 HTTP/Agent/history/dynamic/审批/真实 Node/关闭证明继续以 5ffceaf 和原归档 SHA 保存；旧 19d4261 / 0.9.3 Linux 安装和 bf62940 所保存的 Agent 证明也未改身份。0.9.5 不新增运行整链证明，不重复 Agent、PTY、网页、生产打包或 Linux 安装。最低静态检查确认当前安装版本、归档字节、仅基础依赖、UI、产品装配和旧证据一致；新消费证据为 [evidence/platform-095-adoption.json](evidence/platform-095-adoption.json)。Core 官方查询证明不是 Server 新增只读采集或真实供应商 API 证明；本轮仍未生产部署。
