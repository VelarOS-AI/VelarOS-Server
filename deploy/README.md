# 原生部署产物

生产形态是一个 Node 服务，托管已构建网页和 API；数据目录、文件授权根和运行用户由部署配置绑定。首版仅管理服务所在主机。

## 产物与前置条件

`bun run package` 将使用当前干净源码、固定 Runtime/UI 身份和现有构建产物，生成本地 tar.gz、SHA-256 和文件清单。归档只包含运行代码、静态网页、生产 node_modules、部署模板与说明，不包含源码仓库、开发依赖或数据。该命令不会启动服务、安装 systemd、联网发布或改 Cloud 部署。

生产包仅保留基础 Runtime 的 vendor 归档；固定 UI 归档属于构建输入，网页编译后不随生产目录再次携带。生产依赖安装本身仍以冻结 lock 为准，实际闭包由 Linux 安装验证核验。

部署目录仅包含最终用户所需的配置示例、systemd unit、Caddy 模板和说明。CI 工作流、研发交接与历史排障文档不进入生产包。

当前固定基础与 UI 身份由 `resources/runtime-snapshot.json` 管理；不安装 capabilities。各版本的静态、实际接缝和历史安装证明分别见根 README 与 `docs/verification.md`，不以旧制品替代当前源码。打包前核对固定归档 SHA、干净源码及构建回执；生成归档不等于已经通过 Linux 产品验收。

目标机需要与构建产物原生依赖匹配的 Linux/架构，以及 Node.js 24.22.0 或更新版本。同一份 Windows node_modules 不能作为 Linux 原生依赖交付；打包器在清单中标记实际构建平台，不伪装跨平台产物。最终 Linux 包应在对应隔离环境中组装。

## 安装布局

- `/opt/velaros-server`：解压后的只读产品文件与生产依赖。
- `/var/lib/velaros-server`：专用用户可写的运行数据、访问令牌与 Platform 状态。
- `/etc/velaros-server.env`：管理员维护的配置，权限应限制到实际服务身份。
- `velaros`：专用运行用户；只授予实际需要读取或维护的目录权限。

使用模板前，核对 `velaros-server.service` 的 Node 路径、用户、产品目录和数据目录；核对 `server.env.example` 的公开 origin 与授权根。模板不自动扩大 sudo、Docker 或文件权限。

管理员按实际环境配置后可安装 unit 并启用服务。2026-11-12 已安装一个专用账户运行的独立试用实例，使用 loopback + SSH 隧道，详见[部署记录](../docs/deployment-trial-20261112.md)。采用反向代理时使用同源 HTTPS 并关闭 SSE 缓冲；Cloud 产品发布仍是独立流程。

## 运行与更新

首次启动把随机访问令牌写入数据目录中的 `access-token`，日志只输出文件位置。网页登录后只获得 HttpOnly 会话 Cookie；模型密钥不返回浏览器。

产品诊断写到标准输出和错误输出，由 systemd/journald 或实际进程管理器负责日志轮转与保留；没有另建产品日志归档。SQLite 的变更通知和展示投影有界，请求去重记录保留原身份，不随日志清理删除，以免历史命令被重复执行。数据目录及其备份包含访问与模型凭据，应沿用该目录的访问限制。

更新先停止服务并等待真实运行收束，保存数据目录，解压新产物再启动。不要将同一数据根同时交给两个服务实例；unknown 结果先核对原操作，不自动重放。这里只提供单机交付流程，不加入自更新代理或产品版本兼容层。

## 单轮 Linux 安装验证

需要验证新制品时，在隔离 Linux/同架构环境使用本仓干净 checkout，按顺序安装冻结依赖、运行必要 Server/Web 类型与一次网页构建、`node scripts/package.mjs`。校验 SHA 后将归档解压到新的空目录，执行 `node scripts/verify-linux-install.mjs <解压后的velaros-server绝对目录>`。

此脚本消费真实生产目录和原生依赖，核对基础归档与主入口哈希，确认不安装 UI/React/Electron/capabilities 开发或扩展包，再启动真实产品 main，验证 HTTP 登录、静态网页、样例文件、PTY 输出与停止、SIGTERM 后零退出码。测试使用一次性目录和 loopback，不配置供应商密钥，不重跑已通过 Agent 链；进程退出未知时报告并保留现场，不增加强杀兜底。

最近一次已验收的 Linux 制品来自 [run 43190848464](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43190848464)，准确源码为 `cdd5aa3ffffd635a209c4fede0f0508e781861d4`，使用基础 0.12.1 / UI 1.1.3 构建。已下载产物并核对 SHA-256 `9fef8280b92320b6dfabaf4e2b72bfba79214bbb3052fa46f177b83d0c6e30af`；文件名 `velaros-server-0.1.0-linux-x64.tar.gz`，40,313,395 bytes。CI artifact 保留 3 天，持久回执见 `docs/evidence/linux-install-cdd5aa3.json`。旧 19d4261 / 0.9.3 与 165139c / 0.9.2 的回执保持原身份。

CI 安装验证使用显式 danger-full-access 验证服务用户的直接权限，不宣称覆盖 bubblewrap 或 systemd unit。独立试用实例的真实 systemd 启动、专用用户、workspace-write 隔离与网页登录已在目标云主机另外验证；记录见 `docs/evidence/server-trial-20261112.json`。模型服务和实际运维任务由用户随后配置与确认，不用 CI 或 Windows 结果代替。
