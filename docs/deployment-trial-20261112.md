# 云主机独立试用实例

## 当前登录页

2026-11-13 当前运行源码为 `5a42fd0e068a5a437f1bd695cc70a79a6b99f6c5`。本轮仅移除登录页顶部 V 图标和闲置样式，表单从标题开始；格式、网页类型、Linux 构建与安装验证通过。目标机 12,845 个文件哈希匹配，公网网页 JS 与制品清单一致；会话、配置、令牌和实例身份保留，服务 active/enabled，Cloud 健康。回执见 `evidence/server-login-page-20261113.json` 与 `evidence/linux-install-5a42fd0.json`。

## 会话命名、置顶与归档（历史）

当前运行源码为 `79425931a5514e4a25af3d91ce6f8c050c4dd9a1`。默认选中一个新会话，「+」复用空白入口；行内菜单提供重命名、置顶和归档，底部进入已归档列表并可恢复。服务端也复用空会话，运行中禁止归档，归档保留原消息和请求回执。组织信息独立保存，schema 2 保持不变。详细合同与验证见 [会话管理差量](session-management-20261112.md)。

部署前没有活动任务，私有备份保存一致的数据库和配置，切换后先核对原有 7 条记录及设置均保留。这 7 条全部为之前重复创建的未使用空会话；随后按「最多一个新会话」要求，仅合并其中无消息、无事实、无请求、未命名、未置顶且未归档的重复空行，删除 6 条并保留 1 条，没有删除有内容或已命名的会话。实例身份、模型配置、访问令牌和工作文件不变，原浏览器仍保持登录。

[Linux 安装验收 43220425537](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43220425537)通过，归档 SHA-256 为 `7c7aa479c2b85b1ce05bdc53244128b299808d9b62dd983d48a7062a73697612`，43,079,857 bytes；ZIP 校验值与 GitHub artifact digest 一致，目标机全部 12,845 个清单文件哈希一致。服务 active/enabled，用户和 journal 补充组保持不变；公网鉴权、CSRF/Origin、文件根限制、SSE、网页 JS 与制品清单匹配均通过。线上浏览器默认一条新会话，连续点「+」仍为一条，三项菜单和归档入口正常，无 error；没有发送生产测试消息或调用供应商。

Cloud 保持 healthy/readiness ok。回执见 `evidence/server-session-management-20261112.json` 和 `evidence/linux-install-7942593.json`。下文保留历史源码身份及当时的清理记录。

## 会话交互与旧会话清理（历史）

当前运行源码为 `75957d038494bb016e4cbc447c4092ab7cac65ad`。本轮修复同次运行被拆成多个回答的问题，执行模式改为输入区右侧共享 ghost 按钮；新会话和消息立即展示，外层可见执行说明。具体合同、失败处理和慢网络验证见 [会话交互差量](chat-flow-20261112.md)。

按用户明确指令移除旧格式兼容，不增加迁移代码。已清理 2 个旧会话、2 条请求记录、53 条通知及旧 Runtime 上下文，产品 schema 变为 2。模型配置、访问令牌、实例身份、浏览器登录和工作文件保留；最终重启后再次核对配置及令牌一致、会话数为 0。首次停服状态探测在命令替换中误触继承的错误处理分支，已修正并再次明确停服，核对空表和 schema 后从新制品启动；不把这一中间状态当作最终运行证明。

[Linux 安装验收 43214638113](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43214638113)通过，安装包 SHA-256 为 `921de6d86b356269d184620d0a65e753b5ce56b64a199ed64917ff247c91544f`，43,079,463 bytes。下载 ZIP 与 tar 均核对校验值；目标机逐项核对 12,845 个文件哈希。服务 active/enabled，专用用户和 journal 补充组保持不变。公网 HTTPS、401 鉴权、Secure Cookie、CSRF/Origin 拒绝、工作根读取和状态目录排除、SSE 及网页 JS 清单哈希均通过。

线上浏览器保持登录，旧会话栏为空；执行模式位于右侧，三项选择正确，无 error。没有发送生产测试消息或调用付费模型。Cloud 容器仍 healthy，readiness 为 ok。本轮回执见 `evidence/server-chat-flow-20261112.json` 与 `evidence/linux-install-75957d0.json`。下文保留历史源码身份与当时的数据约定。

## 执行档位与 Desktop 首次渲染（历史）

当前产品源码为 `f618d502f50fba87f9f43a141351d5df51002462`，继续通过 HTTPS `/server/` 提供网页与 API。输入区复用共享 UI 的选择控件，提供「标准模式 / 完全访问 / 每次询问」。标准模式和每次询问使用部署的 workspace-write Host；完全访问借用独立的 danger-full-access Host，使用服务账户已有权限，不启用工作区沙箱并自动批准程序和确认请求。旧 API 的 allow 默认仍使用原 Host，不隐式撤销沙箱。执行档位参与请求去重和 Runtime 配置身份，活动运行不被热切换。

按用户反馈，systemd 服务增加 `SupplementaryGroups=systemd-journal`，实际进程补充组为 984/999；没有授予 sudo、Docker 或 root。真实服务身份调用同一正式 SDK Host，核对标准模式保持 bubblewrap 约束、拒绝工作区外写入，完全访问按账户权限允许该测试写入；两档均可读取系统与内核 journal。标准沙箱只看到 2 个进程，完全访问看到 141 个进程，证明不能把隔离 PID 视图当宿主排行。仅保留布尔权限结果和数量，不归档日志原文或进程明细。此检查在 `28f5d91` 执行，后续 Host 装配及 SDK 身份保持一致；最终服务组再次核对。

消息链路按 Desktop 补齐：正式事件投影器区分正文预览与接纳，思考摘要按开关显示；程序事件建立脚本卡，实际 trace 补充源码、进程输出、Kernel 回执、状态及耗时。网页使用同一完整会话 Markdown 门面与共享确认/提问卡，旧消息没有真实时间时不显示虚构时刻。具体差量和边界见 [Desktop 渲染接入差量](desktop-rendering-20261112.md)。新执行授权范围为 server-execution-v2，主体身份包含补充组；旧范围会话可查看，不能自动按新权限续跑，请新建会话。

本轮保留已有模型设置、访问令牌和业务数据；所有切换前均确认没有活动运行，旧制品与配置备份保留，Cloud 未重新部署。最终 Linux 安装、逐文件校验、systemd、HTTPS/鉴权/实时事件、真实 Host 权限及本地/线上浏览器的分项证据见 `evidence/server-execution-render-20261112.json`；不把本地脚本化模型与真实 Node 验证当作付费供应商或生产运维验收。早先的安装、隔离和公网入口证明保持各自原源码身份。

## HTTPS 控制台首次启用（历史）

按用户追加的控制台部署请求，已升级到 `2a1eca4b79fc578def21e13d31a14c15d7dccb4c`，通过现有 Caddy 的 HTTPS `/server/` 提供网页和 API，无需本地 SSH 隧道。后端只监听 Caddy 容器可达的宿主桥接地址 `172.18.0.1:8890`，未开放公网 8890。公开 origin 绑定 HTTPS 站点，保留令牌登录、Secure/HttpOnly/SameSite Cookie、CSRF 和来源检查。实际站点地址交付给实例所有者，不写入公开回执。

本轮差量是 Vite 相对资源路径，以及网页请求和 EventSource 相对页面位置解析；服务端 API、数据合同和 Platform/UI 依赖身份未改变。Cloud 主分支提交 `2e5896eb98a67548b410cc7f57fb3639075c74b4` 包含对应路由和末尾斜杠跳转修复。代理移除 `/server` 前缀，8 MB 代理请求上限覆盖产品现有 4 MiB 附件内容及 JSON 编码开销，原有前后端附件上限继续生效；事件转发关闭缓冲。本轮仅热加载代理配置，没有重新部署 Cloud 产品或改动原有业务路由。

新的 [Linux 安装验收 43196294103](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43196294103)核验冻结安装、类型、网页构建、独立生产包、文件与 PTY、停止及零退出码。归档 SHA-256 为 `8146039740dc1f6fbeab5eb02918aeca78952e4a58252ef1380d913730089c6e`；目标机逐项核对 12,452 个文件哈希。切换前确认没有活动会话，保留旧版本、数据和配置备份，现有模型配置与访问令牌未修改。systemd 当前 active/enabled。

公网验证通过 HTTPS 证书校验、308 跳转、网页与匹配清单哈希的 JS、401 鉴权、登录与 Secure Cookie、CSRF/Origin 拒绝、会话和工作根读取、403 排除状态令牌以及 SSE 首段数据。实际浏览器已登录，模型配置可打开且没有 error；模型尚未配置，没有调用真实供应商。原 Cloud readiness 和容器健康正常。回执见 `evidence/server-public-console-20261112.json`，CI 安装证明见 `evidence/linux-install-2a1eca4.json`。下文初次部署的安装及隔离证明保留原源码身份，不作为本次新增验证。

## 初次部署（历史）

已按用户请求安装真实 Linux x64 制品，运行源码为 `cdd5aa3ffffd635a209c4fede0f0508e781861d4`，包含附件原始内容、思考深度、上下文仪表及动态模型目录。该提交修复部署归档遗漏 `dist/packages/model-config` 的问题；此前 `fff813e` 安装包启动失败，不作为部署结果。修复后 [Linux 安装验收 43190848464](https://github.com/VelarOS-AI/VelarOS-Server/actions/runs/43190848464)通过，归档 SHA-256 为 `9fef8280b92320b6dfabaf4e2b72bfba79214bbb3052fa46f177b83d0c6e30af`。目标机逐文件核对全部 12,452 个清单条目的哈希后才启动。

应用与生产依赖位于 `/opt/velaros-server/releases/<源码提交>/velaros-server`，`/opt/velaros-server/current` 指向本次版本；Node 24.22.0 位于 `/opt/velaros-node/v24.22.0`。`velaros-server.service` 使用独立 `velaros-server` 账户并已启用开机启动，数据为 `/var/lib/velaros-server`，配置为 `/etc/velaros-server.env`。该账户没有 sudo 或 Docker 组授权。默认工作及文件根是 `/srv/velaros-server`，执行模式为 `workspace-write`，逐程序审批为 `ask`。

服务只监听远端 `127.0.0.1:8890`，维护电脑通过已固定主机公钥的 SSH 隧道访问同一个本机端口。浏览器虽使用本机 URL，API、数据和执行都在云主机；隧道关闭只会断开网页入口，systemd 服务继续运行。本轮没有修改公共 DNS 或 Cloud 的 Caddy 路由。模型连接尚未配置，浏览器已登录并停在模型配置窗口，未调用真实或付费供应商。

执行隔离使用 Ubuntu 的 bubblewrap 0.9.0-1ubuntu0.3。针对该主机启用中的 AppArmor 用户命名空间约束，只从同发行版官方 `apparmor-profiles` 4.0.1really4.0.1-0ubuntu0.24.04.9 包提取并启用了 `bwrap-userns-restrict`；没有安装整组额外策略。配置哈希为 `11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9`，全局限制仍为 1。按应用允许用户命名空间的依据见 [Ubuntu 官方说明](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)。

目标机以真实服务账户调用正式 SDK Host，确认 bubblewrap 的完整约束生效、工作根内实际写入并读回、同账户可写的数据目录在受约束子进程中仍不能写入，随后 Host/环境自然关闭。实际服务经过 SSH 隧道确认网页与编译 JS、登录、401 鉴权、会话和工作目录读取、403 拒绝读取状态令牌；浏览器无 error。原 Cloud 容器仍为 healthy，原公开 readiness 检查返回正常。CI 的文件/PTY/停止/服务关闭证明和目标机的 systemd/隔离证明分别保存于 `evidence/linux-install-cdd5aa3.json` 与 `evidence/server-trial-20261112.json`。

运维使用 `systemctl status velaros-server` 与 `journalctl -u velaros-server`。更新仍需等待原运行真实收束后停止服务、保留数据并切换版本；不将同一数据根交给两个活动实例。远端身份、SSH 私钥、访问令牌和模型凭据不写入本仓回执。
