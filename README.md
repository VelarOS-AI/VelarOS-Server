# VelarOS Server

本机服务器管理产品。网页复用 VelarOS UI 的布局和会话组件，只保留左侧会话栏与右侧聊天；文件与命令操作由 Agent 完成。Node 是生产运行环境，Bun 负责开发和包管理。

## 当前状态

已实现登录、HTTP/事件边界、会话索引、请求去重、有界展示投影、真实文件读写和动态模型设置。当前固定正式 Platform 基础 0.12.1（tag v0.7.13）与 UI 1.1.3，不安装 capabilities；普通依赖直接声明官方归档 URL，产品清单和两份发布包均无 overrides/resolutions。本仓 vendor 保留核对过的同字节归档。[接入证据](docs/evidence/dynamic-models-20261112.json)记录普通安装、冻结安装、实际 SDK 身份、严格类型、动态目录 HTTP、真实 Runtime/审批/Node 写入与关闭、网页构建及隔离浏览器验证。2026-11-12 已生成当前 Linux 制品并安装独立云主机试用实例，见[部署记录](docs/deployment-trial-20261112.md)。真实供应商模型仍由用户配置，未自动调用付费模型。

既有 [Linux 安装验收](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42607896603)与同一安装包的[真实 Agent 整链验收](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/42610262328)准确对应 19d4261 / Platform 0.9.3，包括完成、取消与资源回收；没有重标为后续版本制品。网页确认与中文/列表/代码/表格的既有证明也保持原依赖身份，准确范围见 docs/verification.md。

本产品不依赖 Cloud 登录或生产服务，不复制 Desktop IPC、People/团队、Workbench 工作区，不新增 Agent 循环或命令执行 Host。

## 本地运行

需要 Node.js 24.22 或更新版本、Bun 1.4.3。基础 Runtime 与 UI 从固定的官方 GitHub Release 归档安装，依赖由 bun.lock 锁定；URL、哈希与本仓核验副本见 `resources/runtime-snapshot.json`。首次安装需要下载正式依赖，不需要兄弟仓源码或临时联调路径。

```powershell
bun install --frozen-lockfile
bun run build
bun run start
```

模型在输入框左下角的「配置模型」中设置。服务商从 Platform 内置适配器下拉选择，默认地址自动带入；完成地址与密钥填写后，模型下拉通过 Platform 动态目录服务获取当前接口的实际列表，可搜索或手动刷新。获取失败显示错误，不补预置型号，仍可选择「自定义模型」。同一服务商与地址下，已有密钥留空保留；切换服务商或地址需填写对应密钥。查询草稿不保存配置，网页不回显已存密钥。

输入区的「+」支持选择、拖放或粘贴文件/图片，发送的是实际内容：UTF-8 文本、代码、日志进入用户正文，PNG/JPEG/WebP 图片作为原生图像数据交给模型，不生成下载链接或服务器文件路径。每次最多 4 个附件，文本单个 128 KiB、文本合计 256 KiB，图片单张 2 MiB，全部附件合计 4 MiB；前后端均拒绝超限，不静默裁剪。不支持 PDF、Office 或压缩包的内容解析。

「思考深度」沿用 Desktop 的低、中、高、极高、最高五档，随本次输入交给底座适配器；具体模型的档位支持和降档由 Platform 处理。右侧上下文环只在模型报告用量后显示，分子是上次请求的供应商输入 token，分母是该次运行实际装配的输入窗口（本实例默认 110,000 token），不是累计花费或按消息字符猜出的比例。

访问 `http://127.0.0.1:8787`。初次启动在数据目录的 `access-token` 写入访问令牌，仅打印文件位置。Linux 默认数据目录是 `$XDG_STATE_HOME/velaros-server`，未设置时为 `~/.local/state/velaros-server`；Windows 开发使用 `%LOCALAPPDATA%/VelarOS-Server`。数据目录必须在执行根之外，并从文件 API 排除。

可用环境变量见 `deploy/server.env.example`。文件根使用 JSON 数组，生产时必须明确配置；默认只开放启动目录。开发 Vite 页面时，把后端 `VELAROS_SERVER_PUBLIC_ORIGIN` 设为实际 Vite origin，避免放宽来源检查。

输入框的执行下拉提供「标准模式 / 完全访问 / 每次询问」，默认标准模式。标准模式自动执行普通程序，并在模型指令中要求不可恢复操作先请求确认；每次询问在每个执行程序前显示确认卡。两者使用部署配置的进程隔离（默认 `workspace-write`）；Linux 需要可用 bubblewrap，底座不能落实约束时拒绝执行。完全访问使用独立的 `danger-full-access` Host，不启用工作区沙箱，自动批准程序和确认请求，仍受服务账户的操作系统权限约束；不会自行取得 root、sudo 或 Docker 权限。档位随输入冻结并参与去重，运行中不能切换；不同模型或档位的新运行等待原 Runtime 收束。未指定档位的 API 请求沿用部署的 `VELAROS_SERVER_APPROVAL` 默认值。

只读观察能力由真实 Host 报告，不按操作系统推定支持，也不以普通执行代替只读采集。后端不可用时仍可选择已有观察历史或清除订阅；历史、动态材料和索引均由 Core 维护。当前 Windows 接缝实际报告只读程序不可用，不影响历史控制及明确审批的普通执行。

## 验证与交付

按一批改动集中进行格式、必要类型和四个产品边界场景，不默认跑压力测试、大型矩阵或 Linux/桌面全量回归。真实 Platform 与 Linux 验收在接入固定归档后单独记录，不用测试端口替代。

`deploy/` 提供原生 Node + systemd 和同源反向代理模板。独立试用实例已通过 HTTPS `/server/` 提供网页和 API，无需 SSH 隧道；服务由专用账户和 systemd 运行，真实工作目录写入及隔离约束已验证。网页同时支持根目录和反向代理子路径，API 与事件地址随页面位置解析。其他部署需按实际环境配置用户、目录与 Node 路径。

架构、数据与待接入边界见 `docs/architecture.md`。

内部清理的分模块结论、保留理由及必要验证见 `docs/cleanup-coverage.md`；这些源码变更不改写既有 Linux 制品或真实 Agent 证明的身份。

Linux 单次安装验证见 [Server Linux install](https://github.com/VelarOS-AI/VelarOS-Server/actions/workflows/linux-install.yml) 和 `docs/linux-validation-handoff.md`。工作流仅手动触发，不因普通推送重跑。

当前 Linux x64 安装包使用 Platform 0.12.1，包含编译后的服务、网页和原生生产依赖，已通过一次独立安装验收。目标机只需 Node.js 24.22.0 或更新版本，不需要安装 Bun 或拉取其他仓库。下载并核对 CI 产物：

```sh
gh run download 43196294103 --repo VelarOS-AI/VelarOS-Server --name velaros-server-linux-43196294103 --dir server-download
(cd server-download/artifacts && sha256sum --check velaros-server-0.1.0-linux-x64.tar.gz.sha256)
mkdir server-install
tar -xzf server-download/artifacts/velaros-server-0.1.0-linux-x64.tar.gz -C server-install
```

进入 `server-install/velaros-server`，按 `deploy/server.env.example` 配置专用运行用户、明确的执行/文件根和站点 origin，然后执行 `node dist/apps/server/src/main.js`。该 CI artifact 对应源码 `2a1eca4b79fc578def21e13d31a14c15d7dccb4c`，安装包 SHA-256 `8146039740dc1f6fbeab5eb02918aeca78952e4a58252ef1380d913730089c6e`，保留至 2026-11-15 17:59:57（北京时间）。持久安装回执见 `docs/evidence/linux-install-2a1eca4.json`；旧版本回执保持原身份。真实试用部署与 CI 安装的范围分别记录，不互相替代。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。固定 Platform 与 UI 依赖保留各自的许可证。package.json 的 private 仅禁止意外发布 npm 包，不限制本仓源码公开。
