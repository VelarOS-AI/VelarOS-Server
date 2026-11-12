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

管理员按实际环境配置后可安装 unit 并启用服务。2026-11-12 的独立试用实例已通过 HTTPS `/server/` 提供控制台，无需 SSH 隧道，详见[部署记录](../docs/deployment-trial-20261112.md)。采用反向代理时使用同源 HTTPS 并关闭 SSE 缓冲；Cloud 产品发布仍是独立流程。

网页可直接部署在根目录，也可由代理移除 `/server` 前缀后转发。同一个编译包按页面位置加载资源、API 和事件。`VELAROS_SERVER_PUBLIC_ORIGIN` 始终填写站点 origin（不含 `/server/`），不要放宽来源检查；反向代理需将 `/server` 跳转到 `/server/`。若 Caddy 运行在容器内，后端绑定该容器可达的宿主私有地址；不为此开放公网后端端口。

## 运行与更新

首次启动把随机访问令牌写入数据目录中的 `access-token`，日志只输出文件位置。网页登录后只获得 HttpOnly 会话 Cookie；模型密钥不返回浏览器。

网页的执行档位随每次输入交付。标准模式和每次询问使用 `VELAROS_SERVER_EXECUTION_MODE` 指定的 Host，完全访问使用不启用沙箱的独立 Host；它开放的是当前服务账户已有的系统权限，文件 HTTP API 仍按管理员配置的根目录授权。`VELAROS_SERVER_APPROVAL` 只决定未传执行档位的 API 请求默认行为。部署账户需要读系统 journal 时，可由管理员在 systemd unit 的 `[Service]` 中设置 `SupplementaryGroups=systemd-journal`，核对系统存在该组后重启空闲服务；这只授予日志读取，不包含 root 或服务管理权限。进程全貌需在完全访问档位检查，沙箱里的 PID 视图不能视为宿主机进程排行。

本次执行权限合同增加三档 Host/审批配置，授权范围推进到 `server-execution-v2`。升级后旧会话仍可查看，恢复旧运行前的范围核对会拒绝扩大授权；请用新会话开始新的运维任务，不改写旧绑定或自动重放旧命令。

产品诊断写到标准输出和错误输出，由 systemd/journald 或实际进程管理器负责日志轮转与保留；没有另建产品日志归档。SQLite 的变更通知和展示投影有界，请求去重记录保留原身份，不随日志清理删除，以免历史命令被重复执行。数据目录及其备份包含访问与模型凭据，应沿用该目录的访问限制。

更新先停止服务并等待真实运行收束，保存数据目录，解压新产物再启动。不要将同一数据根同时交给两个服务实例；unknown 结果先核对原操作，不自动重放。这里只提供单机交付流程，不加入自更新代理或产品版本兼容层。

## 单轮 Linux 安装验证

需要验证新制品时，在隔离 Linux/同架构环境使用本仓干净 checkout，按顺序安装冻结依赖、运行必要 Server/Web 类型与一次网页构建、`node scripts/package.mjs`。校验 SHA 后将归档解压到新的空目录，执行 `node scripts/verify-linux-install.mjs <解压后的velaros-server绝对目录>`。

此脚本消费真实生产目录和原生依赖，核对基础归档与主入口哈希，确认不安装 UI/React/Electron/capabilities 开发或扩展包，再启动真实产品 main，验证 HTTP 登录、静态网页、样例文件、PTY 输出与停止、SIGTERM 后零退出码。测试使用一次性目录和 loopback，不配置供应商密钥，不重跑已通过 Agent 链；进程退出未知时报告并保留现场，不增加强杀兜底。

最近一次已验收的 Linux 制品来自 [run 43207284707](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43207284707)，准确源码为 `f618d502f50fba87f9f43a141351d5df51002462`，使用基础 0.12.1 / UI 1.1.3 构建。已下载产物并核对 SHA-256 `354dbfef5f731e97733bb7d682b58a309be2198f4eee8ed0d4bbd735cbd54867`；文件名 `velaros-server-0.1.0-linux-x64.tar.gz`，43,067,617 bytes。CI artifact 保留 3 天，持久回执见 `docs/evidence/linux-install-f618d50.json`。旧版本回执保持原身份。

CI 安装验证使用显式 danger-full-access 验证服务用户的直接权限，不宣称覆盖 bubblewrap 或 systemd unit。独立试用实例的真实 systemd 启动、专用用户、workspace-write 隔离与网页登录已在目标云主机另外验证；初次隔离证明见 `docs/evidence/server-trial-20261112.json`，HTTPS 首次接入见 `docs/evidence/server-public-console-20261112.json`，当前执行权限及渲染部署见 `docs/evidence/server-execution-render-20261112.json`。模型服务和实际运维任务由用户随后配置与确认，不用 CI 或 Windows 结果代替。
