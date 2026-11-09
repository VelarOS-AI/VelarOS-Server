# VelarOS Server

本机服务器管理产品。网页复用 VelarOS UI 的布局和会话组件，首版提供对话、文件、终端、设置。Node 是生产运行环境，Bun 负责开发和包管理。

## 当前状态

已实现登录、HTTP/事件边界、会话索引、请求去重、有界展示投影、真实文件读写、模型设置和四页网页。真实 Runtime、网页确认和 Node 执行短链已通过；终端使用同一 Host。最终基础依赖为正式 Platform 0.9.2（tag v0.7.3），原 Windows PTY 停止缺口保留 0.9.1 的单独通过证据。网页使用正式 UI 1.1.0 的基础会话入口，有消息的中文/列表/代码/表格检查通过。最终身份已齐，Server Linux 产品安装待隔离私有 CI 单次验收。

本产品不依赖 Cloud 登录或生产服务，不复制 Desktop IPC、People/团队、Workbench 工作区，不新增 Agent 循环或命令执行 Host。

## 本地运行

需要 Node.js 24.22 或更新版本、Bun 1.4.3。基础 Runtime 由本仓 vendor 固定归档提供，生产依赖和当前 UI 由 bun.lock 固定，身份见 `resources/runtime-snapshot.json`。安装不需要兄弟仓源码或临时联调路径。

```powershell
bun install --frozen-lockfile
bun run build
bun run start
```

访问 `http://127.0.0.1:8787`。初次启动在数据目录的 `access-token` 写入访问令牌，仅打印文件位置。Linux 默认数据目录是 `$XDG_STATE_HOME/velaros-server`，未设置时为 `~/.local/state/velaros-server`；Windows 开发使用 `%LOCALAPPDATA%/VelarOS-Server`。数据目录必须在执行根之外，并从文件 API 排除。

可用环境变量见 `deploy/server.env.example`。文件根使用 JSON 数组，生产时必须明确配置；默认只开放启动目录。开发 Vite 页面时，把后端 `VELAROS_SERVER_PUBLIC_ORIGIN` 设为实际 Vite origin，避免放宽来源检查。

执行默认 `workspace-write` 与逐程序 `ask`。Linux 受约束模式需要可用 bubblewrap，底座不能落实约束时拒绝执行；`danger-full-access` 是管理员明确选择的进程权限模式，仍受服务用户的操作系统权限约束。模型首版可明确选择 OpenAI Responses 或兼容 Chat Completions，设置变更在活动运行收束后应用。

## 验证与交付

按一批改动集中进行格式、必要类型和四个产品边界场景，不默认跑压力测试、大型矩阵或 Linux/桌面全量回归。真实 Platform 与 Linux 验收在接入固定归档后单独记录，不用测试端口替代。

`deploy/` 提供原生 Node + systemd 和同源反向代理模板，尚未执行生产部署。配置专用用户、目录与 Node 路径后再安装。普通容器中的命令不代表宿主机权限。

架构、数据与待接入边界见 `docs/architecture.md`。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。固定 Platform 与 UI 依赖保留各自的许可证。package.json 的 private 仅禁止意外发布 npm 包，不限制本仓源码公开。
