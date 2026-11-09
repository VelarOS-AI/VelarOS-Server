# 共享会话页面的轻量消费需求

Server 复用现有 UI 的 AppShell、Input/Button、ChatConversationPane、ChatSurfaceComposer，保持 Desktop 的视觉与基本交互。产品仅需要文本/代码/基础 Markdown、消息滚动、输入、停止和原运行交互确认；不需要浏览器/桌面、Office、People/Team、项目文件、语音和附件入口。

当前固定 UI 是 v1.0.0，SHA-256 见 `resources/runtime-snapshot.json`。本轮实际 Vite 产物 404 文件、16,029,876 bytes（15.29 MiB）；主入口约 1,078.61 kB，CSS 345.60 kB，Markdown 懒块 1,110.94 kB。这些数字是一次现有产物统计，不是网络首屏下载量。终端另为按页懒加载的 xterm，约 334.76 kB。

聊天入口仍会生成大量 Shiki 语言、Mermaid、Cytoscape、数学和其他展示资源；没有使用相应功能也要把这些文件交付。Server 不通过改 node_modules、伪 alias、复制 Desktop 组件或新增 renderer 副本绕开。

交 UI owner 的需求：

- 提供正式的轻量会话/基础 Markdown 公开入口，或将高级 renderer 插件显式装配。基础入口不引入图表、数学和完整语言清单；完整 Desktop 展示可继续显式消费高级入口。
- 提供 tokens/基本布局/原语/会话所需样式的可消费闭包，避免每个产品都携带无关产品组件样式。
- 轻量展示合同围绕会话、消息、运行状态和动作端口；People/团队、项目文件等字段尽量不成为所有消费者必须填写的业务字段。不添加 Server 专用分支。
- 保持现有公开共享组件的视觉、滚动与输入行为；Server 只负责公开入口迁移与一次受影响验证，不承担库内部重构。

这是后续公开合同需求，不是当前四页无法运行的阻塞。当前页面与严格类型/构建已通过；后续按 UI owner 提供的固定版本一次切换，不为每个小调整重复构建或做性能矩阵。

## 1.1.0 接入结果

正式 v1.1.0 归档 SHA-256 `5561690111c8e9dbb806658c88473b8866364b02fdec2d39116588fedd0422c6`、源提交 `131bab8178913bed8392c61c473693aa910e941f` 已固定到本仓 vendor。基础会话入口与 conversation-basic.css 已接入，公开 Provider 装配补齐；中文、列表、普通代码、表格的实际消息场景通过。

新静态产物 16 文件、3,020,832 bytes（2.88 MiB），相对原 404 文件、16,029,876 bytes 减少 81.15%。统计指全部静态交付文件，不能用作首屏流量。主 JS 约 1.13 MB，仍有基础 Markdown/代码格式化资源；Mermaid 文件名对应的仅为 62 字节转出，不是完整图表引擎。独立展示 DTO 的后续收敛没有在本批冒称完成，不扩入当前交付门。
