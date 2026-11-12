# Desktop 渲染接入差量

Server 原先虽然使用共享会话组件，却把每个消息压成单个 text block，只收 accepted 正文，忽略 text/reasoning/program 实时事件；思考可见性写死为 false，交互卡另行手画，Markdown 走 basic 入口。这导致页面不能呈现 Desktop 的执行过程。

本轮对照 Desktop 的 `ConversationRuntime`、`ConversationScripts`、`projectProductConversationForUi`、`scriptExecutionProjection` 和 `ChatConversationSurface`：正文通过 Platform 公开 `createActEventProjector` 区分预览与正式接纳；思考摘要独立投影；脚本卡从 program 事件建立，再用正式 `session.trace()` 的执行摘要、调用回执、进程输出与耗时更新。Server 保留自己的有界展示 DTO，不复制 Desktop IPC、People 或完整原始事件账。

网页改用 Desktop 同一完整 `ChatConversationPane` Markdown 门面、共享脚本卡和 `InteractionCard`；思考显示开关在思考深度菜单内，默认关闭，与 Desktop 一致。空白页标题、输入区宽度及间距对照 Desktop；仍仅保留会话栏和聊天。执行档位继续是标准模式、完全访问、每次询问。

实时展示按 100ms 合并，执行追踪每 500ms 读取，读取与交付失败只影响展示，不反转已经发生的执行。投影同时限制回合、脚本数量、源码、输出和调用摘要；原文仍归 Platform。协议拒绝撤销未接纳预览，断流及重启清理预览，缺少真实执行结局保持 unknown，不从运行结束推定进程成功。新消息记录真实时间，旧消息没有时间时保留未知。

必要验证包含 Server/Web 类型、真实 SDK 五个审批/拒绝路径、正式源码与进程输出投影、预览接纳及拒绝、SQLite 重启恢复和 Runtime 关闭/配置身份。独立本地浏览器通过脚本化模型驱动正式 SDK 与 Node 子进程，验证共享确认卡、源码/输出展开、完成与耗时、表格、代码高亮、思考开关，无浏览器 error，未调用付费供应商。Linux 制品与实际部署另在部署回执中登记，不把本地验证伪装为供应商或生产运维验收。
