# 隔离 Linux 产品安装交接

2026-11-09。只读核对到现有 `VelarOS-AI/VelarOS-Desktop` 为 private，Actions enabled、允许既有 Actions，当前身份具备维护权限。其常规 CI 仅 push main / PR / 手动触发；Server 本轮没有向该仓写入，也不推送公开仓。以下由协调者交私有 CI owner 实施，不依赖 Cloud 生产或本机 Docker/WSL。

## 输入与单命令

最终 UI 候选固定并提交后，Server owner 在干净产品 checkout 执行 `node scripts/create-linux-handoff.mjs`，生成 `.cache/private-linux-handoff-<commit>/`：完整 Git bundle、bundle SHA/产品 commit/两个固定包身份的 handoff.json、run.mjs 与 CI 模板。Git bundle 保留实际产品提交，避免源码 zip 缺 .git 后伪造来源；它不含未跟踪缓存、node_modules、凭据或数据。

生成器同时核对基础/UI 的正式发布来源与本仓字节身份；尚未取得真实发布记录时拒绝生成最终输入。候选验证通过、发布标签与归档版本相同等情况都不能代替这个门。

CI owner 仅在既有私有仓创建 `codex/server-linux-install-<commit>` 独立分支，将模板放到该分支的 `.github/workflows/ci.yml`，其余三件放到 `server-validation/`，不开 PR、不合并主线、不改产品运行源码。模板只接受 workflow_dispatch；推送准备分支不会启动这个安装任务。先核对承载仓仍为 private；模板也拒绝公开仓和其他分支。

复用默认分支已存在且支持手动运行的 ci.yml 路径，避免新文件尚未注册而无法调度。GitHub 的[手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli)明确要求默认分支存在该工作流，并可用 --ref 选择待验分支。这里只在独立分支替换工作流内容，不改变默认分支 CI。

最终冻结输入到齐后，唯一远程执行命令：`gh workflow run ci.yml --repo VelarOS-AI/VelarOS-Desktop --ref codex/server-linux-install-<final-commit>`。不要省略 --ref，也不要执行默认分支 CI 或先用旧 UI 试跑。

bootstrap 核对 bundle SHA，克隆确切产品分支并核对 HEAD，随后只调用 `node scripts/linux-product.mjs`。该命令在同架构 Linux 一次完成冻结依赖安装、必要类型/最终网页构建、生产打包和真实安装验证。不要另外运行完整测试、基础 Agent、供应商 API 或矩阵。

## 环境与权限

- 一个 ubuntu-24.04 x64 临时 runner，Node 24.22.0、Bun 1.4.3、Git/tar；最多 5 分钟，顺序执行，建议至少 4 GiB RAM 与 2 GiB 空闲磁盘。不安装 Docker、WSL、桌面或系统服务。
- CI owner 需要私有分支写入与 Actions 调度/结果读取权限；job 只用 contents:read，无生产/模型/签名/发布 secret。固定 actions 身份沿用现有私有 CI 配置。
- 仅下载锁定的公开依赖、Node/Bun 和既有官方 Actions。基础/UI 归档来自产品 bundle；不需要私有 npm token、不拉兄弟仓源码。
- 上传范围仅为私有安装产物、SHA 与两个 JSON 回执，保留 3 天；不公开 Server 源码/产物，不创建发行，不操作 Cloud。

## 实际证明与边界

真实生产目录应没有 UI/React/Electron/capabilities 的已安装包；使用原生 Linux PTY 和产品 main，覆盖 loopback HTTP 登录、静态网页、一次样例配置读写并核对 Linux 文件模式保留、终端实际输出与停止、SIGTERM 后退出码 0。输出记录产品 commit、实际依赖 SHA、Node/架构、产物 SHA，unknown 保留现场并失败，不添加强杀或假成功。

本轮使用显式 danger-full-access，证明服务用户的直接权限；不宣称验证 bubblewrap、systemd unit 或付费模型。基础 Linux Agent 证明沿用原 Platform CI，Windows 产品 Agent/四边界/页面绿项保留。最终隔离任务尚未执行；真实结果到齐后再登记 Server Linux 安装通过。
