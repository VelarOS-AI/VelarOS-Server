# 云主机独立试用实例

已按用户请求安装真实 Linux x64 制品，运行源码为 `cdd5aa3ffffd635a209c4fede0f0508e781861d4`，包含附件原始内容、思考深度、上下文仪表及动态模型目录。该提交修复部署归档遗漏 `dist/packages/model-config` 的问题；此前 `fff813e` 安装包启动失败，不作为部署结果。修复后 [Linux 安装验收 43190848464](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43190848464)通过，归档 SHA-256 为 `9fef8280b92320b6dfabaf4e2b72bfba79214bbb3052fa46f177b83d0c6e30af`。目标机逐文件核对全部 12,452 个清单条目的哈希后才启动。

应用与生产依赖位于 `/opt/velaros-server/releases/<源码提交>/velaros-server`，`/opt/velaros-server/current` 指向本次版本；Node 24.22.0 位于 `/opt/velaros-node/v24.22.0`。`velaros-server.service` 使用独立 `velaros-server` 账户并已启用开机启动，数据为 `/var/lib/velaros-server`，配置为 `/etc/velaros-server.env`。该账户没有 sudo 或 Docker 组授权。默认工作及文件根是 `/srv/velaros-server`，执行模式为 `workspace-write`，逐程序审批为 `ask`。

服务只监听远端 `127.0.0.1:8890`，维护电脑通过已固定主机公钥的 SSH 隧道访问同一个本机端口。浏览器虽使用本机 URL，API、数据和执行都在云主机；隧道关闭只会断开网页入口，systemd 服务继续运行。本轮没有修改公共 DNS 或 Cloud 的 Caddy 路由。模型连接尚未配置，浏览器已登录并停在模型配置窗口，未调用真实或付费供应商。

执行隔离使用 Ubuntu 的 bubblewrap 0.9.0-1ubuntu0.3。针对该主机启用中的 AppArmor 用户命名空间约束，只从同发行版官方 `apparmor-profiles` 4.0.1really4.0.1-0ubuntu0.24.04.9 包提取并启用了 `bwrap-userns-restrict`；没有安装整组额外策略。配置哈希为 `11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9`，全局限制仍为 1。按应用允许用户命名空间的依据见 [Ubuntu 官方说明](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)。

目标机以真实服务账户调用正式 SDK Host，确认 bubblewrap 的完整约束生效、工作根内实际写入并读回、同账户可写的数据目录在受约束子进程中仍不能写入，随后 Host/环境自然关闭。实际服务经过 SSH 隧道确认网页与编译 JS、登录、401 鉴权、会话和工作目录读取、403 拒绝读取状态令牌；浏览器无 error。原 Cloud 容器仍为 healthy，原公开 readiness 检查返回正常。CI 的文件/PTY/停止/服务关闭证明和目标机的 systemd/隔离证明分别保存于 `evidence/linux-install-cdd5aa3.json` 与 `evidence/server-trial-20261112.json`。

运维使用 `systemctl status velaros-server` 与 `journalctl -u velaros-server`。更新仍需等待原运行真实收束后停止服务、保留数据并切换版本；不将同一数据根交给两个活动实例。远端身份、SSH 私钥、访问令牌和模型凭据不写入本仓回执。
