# Server 产品边界与当前接入状态

Server 管理本机单 Host；网页只有左侧会话栏和右侧聊天，复用 Desktop 使用的共享会话及输入组件。新对话在首次发送时创建，标题取首条输入；窄屏会话栏按需展开。文件、终端和模型设置保留已有服务端接口，网页不再提供独立页面、主机指标或常驻说明。它不持有 Desktop People/团队、Workbench 工作区或 Desktop IPC。UI 固定消费正式 v1.1.3 归档及基础会话入口，来源与 SHA 登记于 `resources/runtime-snapshot.json` 和 `resources/ui-provenance.json`。正式依赖直接声明官方归档 URL，不使用 overrides、resolutions 或本地 link。

`ExecutionPort` 是产品到 Platform 适配器的窄边界。`platform-composition.ts` 创建一个公开 LocalShellHost，同时注入 Node Runtime 和 HostTerminal；环境和 Host 归产品，模型循环、执行事实和进程生命周期归底座。Runtime 真正关闭后才释放 Host。没有创建第二个命令执行器。

网络请求 requestId 加文本指纹去重。202 仅表示产品受理；只有 SDK input 事实才能写入 inputId/runId。SDK accepted 是模型正文被接纳，不是用户输入接纳。取消受理不等于进程 close；网络未知结果与重启中的未收束运行均保留 unknown，不自动提交第二次。

请求去重行、初始会话投影和 change 引用在同一 SQLite 事务提交，成功后才登记活动请求、通知网页并派发执行；提交失败完整回滚，不留下尚未派发的 received 回执。执行通知与 unknown 的请求绑定、会话投影、change 同样一起提交，失败保留最后一次持久事实。执行已经尝试后，同 requestId 只返回原回执，不再次派发；unknown 自身也无法保存时分别记录执行与持久化错误，不另建内存状态或自动重试。

SQLite 只保存产品索引、请求指纹与绑定、序号、事实引用和有界展示投影。消息最多 40 条、每条 8000 字符、事实引用最多 24 条；change 表只存 sequence/session_id/revision。完整事实归 Platform，产品不归档 ActEvent、模型请求或第二份原文历史。

SSE 发送变更引用，网页随后读取最新投影；通知保留 512 条。游标已淘汰时发送 reset。订阅写失败和慢连接只移除网络订阅，不能传播到运行事实路径。EventDelivery 不被当成历史库或 ACK 库。

网页刷新只接受当前认证下最新一次读取的结果；认证切换和卸载取消过期 GET，并清理本地展示投影，不能借此取消或重放已发出的变更请求。刷新失败单独报告，不反转已经受理的输入或回答；SSE 重连只重读投影。实际权限仍由服务器认证与 CSRF 校验负责。

按 ADR 0028 固定 `resources/runtime-snapshot.json` 登记的官方正式基础归档 URL，只消费公开 Node/Execution 入口，显式 binding/executionIdentity/authorizationScope，modules 为空，不安装能力扩展。状态目录与执行根分离；恢复产品会话前核对原实例、执行用户、Node、授权根和策略身份。模型设置改变不会热替换正在运行的 Runtime；初始化也只合并同一配置身份，不同配置的新提交沿用 MODEL_BUSY，等待原运行收束。关闭等待初始化结果；没有 Runtime 留存的初始化失败不重复阻断产品资源清理，旧 Runtime 的实际关闭失败仍保留原 owner 和错误。

首版 API：`/api/auth`、`/api/info`、`/api/sessions`、`/api/sessions/:id/inputs|cancel|answers|interaction`、`/api/files`、`/api/files/text`、`/api/settings/model`、`/api/settings/model/catalog`、`/api/events` 和 `/api/terminal`。JSON 入参在 HTTP 边界校验；网页变更需登录、CSRF 和匹配来源。后端持有模型密钥，前端仅收到 hasApiKey。

模型配置按需打开弹窗。服务商身份与默认地址来自 Platform 运营清单；可选型号只来自官方 ProviderModelCatalogService 的远端结果或用户输入，不再消费同步预置型号。目录 POST 按当前连接解析已存密钥，草稿查询不写 SQLite。网页在完成地址/密钥输入后延迟查询，关闭、认证或连接变化取消旧请求，并按连接身份隔离迟到结果；服务端在客户端断开与应用关闭时取消对应查询。鉴权作用域缓存、协议和响应解析归 Platform，Server 不维护第二套供应商模型协议。

附件与思考深度属于同一输入身份：附件标准 base64、名称/类型和档位一同参与去重，改变其中任一项不能沿用原 requestId。HTTP 只在 inputs 路由放宽至有界 6 MiB，按流读取执行上限；解码后再次按真实字节核对单文件、分类总量、全部总量与数量，校验 UTF-8 及图片类型签名，不解析链接或写上传文件。UTF-8 附件全文直接进入 ActInput.text，图片直接进入 ActInput.images；完整输入归 Platform 原始记录持有，SQLite 产品投影只留附件名称、类型、大小及有界用户文字。

每次输入的 reasoningLevel 进入公开 RuntimeModelConfiguration，参与同一 Runtime 配置身份；活动运行仍使用原配置。Server 显式装配 128,000 总窗口、110,000 输入预算、12,000 模型输出额度，并以同一输入预算约束上下文策略。上下文投影只接收 Act usage 的请求身份与 inputTokens，加上该次运行的模型与实际输入预算；保留最近一次计数直到新请求报告，没有供应商计数时不虚构百分比。前端只计算这两个同源数值的比例。

默认每次执行经原 Session 的 confirmation；网页按需读取待执行原文，不另存正文。回答绑定 id/runId 并单次消费。终端采用 Host 输出缓冲→SSE、浏览器按键→HTTP，不增加 WebSocket 服务或第二份输出档案。输入不自动重试，断开订阅不停止任务；停止调用 Host 的原 taskId。

终端订阅从首次异步读取前即计入共享连接额度并归应用关闭管理，读取失败保留原 HTTP 错误并释放额度。断线或关闭后的迟到结果不再写出或启动轮询。网页的进程状态只取自 Host 输出，输入网络失败只暂停输入，不能因此禁用仍在运行进程的停止入口。

文件操作使用明确授权根和真实路径校验，排除状态目录。首版只编辑已有 UTF-8 普通文本，单文件 128 KiB；本实例按真实路径串行核对 SHA-256、原子替换和读取保存结果，目录别名共用同一保存许可，不同文件互不等待。它不是跨任意外部写入者的文件系统事务；发布核对之后的外部竞争仍需底层文件事务机制或操作系统授权约束。日志持续尾读、配置差异页还未实现。

四个边界测试证明产品协议、真实 HTTP 和文件边界，执行端口是注入。另有固定 Runtime 的真实 Node/确认/文件短链通过，模型是确定性驱动。原 Windows PTY 停止缺口已在 0.9.1 单独复验闭环，历史与证据见 `platform-host-issue.md`。Platform owner 的基础 Linux CI 与 Server 产品部署是不同证据，不能互相替代。
