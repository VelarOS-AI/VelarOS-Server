# Server 产品边界

- 此仓只拥有单机运维产品、网页、HTTP/事件/终端适配和部署；不复制 Agent 循环、执行 Host 或 Desktop IPC。
- Platform 与 UI 只通过公开包入口消费固定快照；不导入兄弟仓源码，不改 node_modules。公开接口需求交所属 owner。
- Desktop People/Team、Workbench 工作区、项目/浏览器 workspace 都不进入 Server 数据合同。
- 一份运行事实一个 owner。仅保存必要请求去重、序号、事实引用和有界展示投影，不另存完整 ActEvent、模型请求或原文档案。
- 网络受理、Agent input 接纳与进程 close 分别记录；unknown 不自动重放。网络订阅失败不能改变运行任务。
- 包管理使用 Bun，Node 是生产执行环境。代码按职责保持简单，测试验证真实接缝和失败边界。
- 一批完整改动只集中跑一次最小必要验证；已通过结果保留，修复后仅补未通过或受影响步骤，不默认跑全量回归、压力/性能矩阵或长时间 E2E。
- 提交只暂存本轮精确文件；不提交密钥、数据、归档缓存或临时日志。公开发布仅在用户明确授权范围内进行，不携带其他产品源码或未发行候选包。
- 验证默认使用本仓 .cache 独占锁；多仓联调通过 VELAROS_VALIDATION_LOCK_PATH 显式指定共享锁。锁以 wx 获取，只在 finally 释放自己持有的 token。
