# Durable Usage Architecture · Wayfinder Map

## Destination

产出一份可直接交给实施者的详细架构设计与执行文档：将 `dsh-token-dashboard` 从「打开面板时扫描会话日志」改造为「已提交 usage 事件→异步持久化 Usage facts→单一 snapshot 查询」。本 effort 不实施代码。

## Notes

- **域**：DSH 宿主侧用量读模型、SQLite、Worker 异步写回、会话事件重放。
- **本 effort 产物**：架构设计与执行文档；不修改产品代码，不执行迁移。
- **已锁定约束**：
  - 权威读模型为每个 `(session, turn, step)` 一条 Usage fact；`provider + model` 作为可分组维度存储。
  - 实时入口使用已提交的 `session/event`；主线程只筛选字段并投递异步链。对应会话经 `ctx.sessions.flush(session)` 确认权威日志持久化后，才由 Worker 批量事务写 SQLite。
  - 通过 run epoch 的 clean-shutdown 标记识别异常退出；仅异常退出后以 revision 筛选变化会话，再从 usage checkpoint 恢复尾部。
  - 历史数据只在首次建库时做一次非阻塞初始化扫描；实时监听先于扫描启动，面板显示进度。
  - 查询收敛为单一 `/api/token-dashboard/snapshot`，在一个一致读中返回状态、进度、summary、days 及 `byModel`。
  - Usage facts 首版永久保留，不设 30/90 天清理，不预建日级 rollup。
  - 保留现有 UI、Token 口径、时区行为、provider/model 分类与历史翻页；只增加初始化/恢复/错误状态。
  - 不将「大量 subagent 压测」作为验收项。
- **必用技能**：`research`、`grilling`、`domain-modeling`；最终文档草案使用 `prototype` 做 HITL 评审。

## Decisions so far

<!-- 每行一个已关闭 ticket：只放 gist + 链接，细节留在 ticket Answer。 -->

- [DSH 已提交事件与生命周期合同](issues/01-dsh-event-lifecycle-contract.md) — `session/event` 只轻量入队；先 flush 权威日志再提交索引，checkpoint 绑定会话生命周期，单一异步 disposer 负责 clean shutdown。
- [SQLite Worker 运行时与打包边界](issues/02-sqlite-worker-runtime.md) — 常驻 Worker 独占 `node:sqlite`，WAL+FULL 批量事务与 commit ack，第二 tsdown entry 随 Git/npm 分发。
- [Usage fact Schema 与聚合语义](issues/03-usage-fact-schema-and-query.md) — 生命周期安全事实主键、连续 checkpoint 与路由游标、双版本、初始化/run epoch 状态及一致 snapshot 的 DDL 和事务不变式已锁定。
- [异步写回与异常恢复状态机](issues/04-write-behind-and-recovery-state-machine.md) — 最小增量两级批处理、精确 ack、限界降级、4 秒 clean shutdown、revision/锚点尾部恢复与局部重建状态机已锁定。
- [首次初始化扫描合同](issues/05-initialization-scan-contract.md) — listener-first 的每会话扫描切点、单并发低优先级调度、可证明进度、失败隔离、断点续跑与 ready 原子门禁已锁定。
- [单一 Snapshot API 与一致读合同](issues/06-snapshot-api-contract.md) — 固定本地日历窗口的一次 GET、版本化响应、部分状态、窗口模型上限、一致读、内存缓存与 5 秒超时合同已锁定。
- [重建、迁移与运维边界](issues/07-rebuild-migration-and-operations.md) — 原子版本切换、DSH Home 单 owner 库、严格处理矩阵、shadow 重建/晋升恢复、事务迁移与本机维护 CLI 已锁定。
- [实施顺序与验证门禁](issues/08-execution-sequence-and-verification.md) — 十个可回滚提交、故障注入矩阵、真实数据等价、无 subagent 的性能门禁、观测点与发布检查已锁定。
- [架构设计与执行文档评审](issues/09-architecture-document-review.md) — 主合同与状态机原型已经用户确认，可按十个提交直接进入实施。

## Not yet specified

- 无。

## Out of scope

- 修改或实施任何产品代码。
- 重做面板视觉、改变 Token 计量口径或增加新统计维度。
- 每次启动或打开面板时扫描全部会话。
- 常驻历史 backfill、大量 subagent 压测、日级 rollup 和自动历史清理。
