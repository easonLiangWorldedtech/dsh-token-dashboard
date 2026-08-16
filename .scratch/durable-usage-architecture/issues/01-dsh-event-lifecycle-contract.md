# DSH 已提交事件与生命周期合同

Type: research
Status: resolved
Blocked by: —

## Question

当前 DSH 版本中，`session/event`、`sessionPersistence`、`listSnapshots` revision、`readFrom`、Cordis 异步 disposer 和 `sessionProjectionCache` 的精确承诺是什么？设计能依赖哪些稳定 seam 来实现非阻塞采集、clean shutdown 与异常尾部恢复？

## Research context

- Branch: `research/dsh-event-lifecycle`
- Report target: `research/01-dsh-event-lifecycle-contract.md`

## Answer

详细证据见 [DSH committed-event and lifecycle contract](../research/01-dsh-event-lifecycle-contract.md)。

- `session/event` 是内存日志 post-commit、fire-and-forget 通知；监听器只能做有界同步工作，返回的 Promise 不会成为提交屏障。
- 事件通知时 JSONL 可能尚未持久化；采用「轻量入队→`await ctx.sessions.flush(session)`→Worker 事务写 fact + checkpoint」，防止 SQLite 超前于权威日志。
- 首次初始化必须先注册实时监听，再 `readFrom(id, 0)`；seed/resume 历史事件不会重发到实时 feed。
- checkpoint 绑定 `(session_id, createdAt, cwd)` 生命周期身份；异常恢复使用 revision 筛选 + `last_seq` 尾部重放。
- 监听停止、链路/Worker 排空和 clean marker 最终写入必须放在同一个异步 Cordis disposer 中；host 变更继续要求重启，不设计 HMR 双实例兼容。
