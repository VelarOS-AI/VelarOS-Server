# 当前验证与交接

2026-11-09。区分产品协议、真实底座链与发行验收，不互相替代。

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
