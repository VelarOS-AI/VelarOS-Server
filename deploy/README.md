# 原生部署产物

生产形态是一个 Node 服务，托管已构建网页和 API；数据目录、文件授权根和运行用户由部署配置绑定。首版仅管理服务所在主机。

## 产物与前置条件

`bun run package` 将使用当前干净源码、固定 Runtime/UI 身份和现有构建产物，生成本地 tar.gz、SHA-256 和文件清单。归档只包含运行代码、静态网页、生产 node_modules、部署模板与说明，不包含源码仓库、开发依赖或数据。该命令不会启动服务、安装 systemd、联网发布或改 Cloud 部署。

生产包仅保留基础 Runtime 的 vendor 归档；UI 候选归档属于构建输入，网页编译后不随生产目录再次携带。生产依赖安装本身仍以冻结 lock 为准，实际闭包由 Linux 安装验证核验。

部署目录仅包含最终用户所需的配置示例、systemd unit、Caddy 模板和说明。CI 工作流、研发交接与历史排障文档不进入生产包。

最终基础为本仓 vendor 中的正式 0.9.2 归档（tag v0.7.3）；不安装 capabilities。轻量 UI 1.1.0 已固定并正式发布同字节资产，必要类型、构建与实际消息展示通过。两份真实发布身份已齐，可按冻结输入进行一次原生 Linux 安装验证。打包前核对固定归档 SHA、干净源码及构建回执；生成归档不等于已经通过 Linux 产品验收。

目标机需要与构建产物原生依赖匹配的 Linux/架构，以及 Node.js 24.22.0 或更新版本。同一份 Windows node_modules 不能作为 Linux 原生依赖交付；打包器在清单中标记实际构建平台，不伪装跨平台产物。最终 Linux 包应在对应隔离环境中组装。

## 安装布局

- `/opt/velaros-server`：解压后的只读产品文件与生产依赖。
- `/var/lib/velaros-server`：专用用户可写的运行数据、访问令牌与 Platform 状态。
- `/etc/velaros-server.env`：管理员维护的配置，权限应限制到实际服务身份。
- `velaros`：专用运行用户；只授予实际需要读取或维护的目录权限。

使用模板前，核对 `velaros-server.service` 的 Node 路径、用户、产品目录和数据目录；核对 `server.env.example` 的公开 origin 与授权根。模板不自动扩大 sudo、Docker 或文件权限。

管理员审阅后可安装 unit 并启用服务。本仓本轮没有执行这些系统变更，也没有获得 Cloud 生产部署授权。反向代理使用同源 HTTPS，关闭 SSE 缓冲；后端默认只绑定 loopback。

## 运行与更新

首次启动把随机访问令牌写入数据目录中的 `access-token`，日志只输出文件位置。网页登录后只获得 HttpOnly 会话 Cookie；模型密钥不返回浏览器。

更新先停止服务并等待真实运行收束，保存数据目录，解压新产物再启动。不要将同一数据根同时交给两个服务实例；unknown 结果先核对原操作，不自动重放。这里只提供单机交付流程，不加入自更新代理或产品版本兼容层。

## 单轮 Linux 安装验证

最终固定依赖到齐后，在隔离 Linux/同架构环境使用本仓干净 checkout，按顺序安装冻结依赖、运行必要 Server/Web 类型与一次网页构建、`node scripts/package.mjs`。校验 SHA 后将归档解压到新的空目录，执行 `node scripts/verify-linux-install.mjs <解压后的velaros-server绝对目录>`。

此脚本消费真实生产目录和原生依赖，核对基础归档与主入口哈希，确认不安装 UI/React/Electron/capabilities 开发或扩展包，再启动真实产品 main，验证 HTTP 登录、静态网页、样例文件、PTY 输出与停止、SIGTERM 后零退出码。测试使用一次性目录和 loopback，不配置供应商密钥，不重跑已通过 Agent 链；进程退出未知时报告并保留现场，不增加强杀兜底。

当前脚本仅完成本机静态检查，未在 Linux 执行。它使用显式 danger-full-access 来验证服务用户的直接权限，不宣称覆盖 bubblewrap 或 systemd unit。真实 systemd 启停、授权模式和实际服务维护任务仍需在隔离 Linux 安装环境验收，不能用 Platform 基础 CI 或 Windows PTY 结果替代。
