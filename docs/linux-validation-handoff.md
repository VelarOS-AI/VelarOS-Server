# 独立 Linux 产品安装验收

2026-11-09。用户明确授权 Server 开源。本仓沿用生态 Apache-2.0，仅公开 Server 自身、正式 Platform 0.9.2 和 UI 1.1.0 归档；原开发分支和冻结 bundle 保留本地，未发行的旧候选包历史不进入公开分支。

## 单次工作流

`.github/workflows/linux-install.yml` 直接检出触发事件的确切 `github.sha`，只运行 `node scripts/linux-product.mjs`。不依赖 Desktop 仓库、Git bundle、私有 npm 或生产/模型密钥。一次 Ubuntu 24.04 x64 job，Node 24.22.0、Bun 1.4.3、最多 5 分钟，权限仅 contents:read。

手动触发：

```sh
gh workflow run linux-install.yml --repo VelarOS-AI/VelarOS-Server --ref main
```

触发前核对 main 的提交；记录实际 run 的 headSha 并与待验源码比较。推送不会自动运行，不另加基础 Agent、供应商 API、Windows、全量回归或矩阵。GitHub 的[手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli)说明默认分支注册与 --ref 的使用。

单命令在同架构 Linux 安装冻结依赖、进行必要类型/最终网页构建、生产打包、校验 SHA，并解压到一次性目录进行真实安装验证。生产产物、SHA 与两个 JSON 回执作为 Actions artifact 保留 3 天；不自动创建 GitHub Release，也不部署到生产。

工具链约束保持 `packageManager: bun@1.4.3`。原 setup-bun 使用的 github.com 浏览器下载地址连续 504；诊断确认官方 Release API 中相同资产 ID 626788717 的重定向和官方 CDN 可达。CI 直接从该官方 API 下载同一 bun-linux-x64.zip，核对 API 登记的 SHA-256 和实际版本后使用，不引入镜像、候选二进制或第二套工具链。

## 证明范围

生产目录应没有 UI/React/Electron/capabilities 的已安装包。启动真实产品 main，验证 loopback HTTP 登录、静态网页、样例配置读写并核对文件模式、原生 PTY 实际输出、按原 taskId 停止后 exited、主服务 SIGTERM 后自然退出码 0。回执记录产品 commit、固定依赖 SHA、Node/架构和产物 SHA。退出未知时失败，不增加强杀或假成功。

本轮显式使用 danger-full-access；不宣称验证 bubblewrap、systemd unit 或真实供应商模型。已有产品 Agent、Windows 终端与网页绿项保留，不重复运行。最终结果单独记录于 `docs/verification.md`。

此前私有承载 CI 在 runner 分配前被付款/消费限额阻止，执行步骤为零，不能视作代码失败或 Linux 通过；此路线已由用户的公开仓库授权替代。
