# VelarOS Server

本机服务器管理产品。网页复用 VelarOS UI 的布局和会话组件，首版提供对话、文件、终端、设置。Node 是生产运行环境，Bun 负责开发和包管理。

## 当前状态

已实现登录、HTTP/事件边界、会话索引、请求去重、有界展示投影、真实文件读写、模型设置和四页网页。当前固定正式 Platform 基础 0.9.6（tag v0.7.7）与 UI 1.1.1，不安装 capabilities；普通依赖直接指向本仓已验真正式归档，正式清单不使用 override。[本次实际接入证据](docs/evidence/platform-096-ui-111-adoption.json)记录严格类型、公开入口、真实 HTTP/审批/Node 写入与关闭、一次网页构建，以及隔离浏览器登录、四入口和基础消息展示。仅以确定性模型替代外部供应商，没有生产部署或重新生成 Linux 制品。

既有 [Linux 安装验收](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42607896603)与同一安装包的[真实 Agent 整链验收](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42610262328)准确对应 19d4261 / Platform 0.9.3，包括完成、取消与资源回收；没有重标为后续版本制品。网页确认与中文/列表/代码/表格的既有证明也保持原依赖身份，准确范围见 docs/verification.md。

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

只读观察能力由真实 Host 报告，不按操作系统推定支持，也不以普通执行代替只读采集。后端不可用时仍可选择已有观察历史或清除订阅；历史、动态材料和索引均由 Core 维护。当前 Windows 接缝实际报告只读程序不可用，不影响历史控制及明确审批的普通执行。

## 验证与交付

按一批改动集中进行格式、必要类型和四个产品边界场景，不默认跑压力测试、大型矩阵或 Linux/桌面全量回归。真实 Platform 与 Linux 验收在接入固定归档后单独记录，不用测试端口替代。

`deploy/` 提供原生 Node + systemd 和同源反向代理模板，尚未执行生产部署。配置专用用户、目录与 Node 路径后再安装。普通容器中的命令不代表宿主机权限。

架构、数据与待接入边界见 `docs/architecture.md`。

内部清理的分模块结论、保留理由及必要验证见 `docs/cleanup-coverage.md`；这些源码变更不改写既有 Linux 制品或真实 Agent 证明的身份。

Linux 单次安装验证见 [Server Linux install](https://github.com/VelarOS-AI/VelarOS-Server/actions/workflows/linux-install.yml) 和 `docs/linux-validation-handoff.md`。工作流仅手动触发，不因普通推送重跑。

已验收的 Linux x64 生产包仍使用 Platform 0.9.3，包含编译后的服务、网页和原生生产依赖，目标机只需 Node.js 24.22.0 或更新版本，不需要安装 Bun 或拉取其他仓库。0.9.4/0.9.5 源码消费没有重新打包或执行 Linux 安装。下载并核对既有 CI 产物：

```sh
gh run download 42607896603 --repo VelarOS-AI/VelarOS-Server --name velaros-server-linux-42607896603 --dir server-download
(cd server-download/artifacts && sha256sum --check velaros-server-0.1.0-linux-x64.tar.gz.sha256)
mkdir server-install
tar -xzf server-download/artifacts/velaros-server-0.1.0-linux-x64.tar.gz -C server-install
```

进入 `server-install/velaros-server`，按 `deploy/server.env.example` 配置专用运行用户、明确的执行/文件根和站点 origin，然后执行 `node dist/apps/server/src/main.js`。该 CI artifact 对应源码 `19d426196d43238f38d83ae1c3712438e1b0fd48`，SHA-256 `23ebc020c3c02968d723fb4c5369558a31073c0bb54f45768ff7328d4e4fdc6e`，保留至 2026-11-12 19:18:29（北京时间）。持久安装回执见 `docs/evidence/linux-install-19d4261.json`；旧 165139c 回执保持原身份。部署与 systemd 配置见 `deploy/README.md`，本轮没有执行生产部署。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。固定 Platform 与 UI 依赖保留各自的许可证。package.json 的 private 仅禁止意外发布 npm 包，不限制本仓源码公开。
