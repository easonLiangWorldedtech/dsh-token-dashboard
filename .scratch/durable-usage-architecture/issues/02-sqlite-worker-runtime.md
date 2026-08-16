# SQLite Worker 运行时与打包边界

Type: research
Status: resolved
Blocked by: —

## Question

在当前 DSH/Node/plugin 打包环境中，用哪个 SQLite 客户端和 Worker 加载形式能稳定实现主线程非阻塞、WAL、批量事务、异步排空与 npm 发布？需要哪些 peer/runtime 依赖与构建约束？

## Research context

- Branch: `research/sqlite-worker-runtime`
- Report target: `research/02-sqlite-worker-runtime.md`

## Answer

详细证据见 [SQLite Worker 运行时与打包边界](../research/02-sqlite-worker-runtime.md)。

- 采用一个常驻 Node Worker，由 Worker 独占 `node:sqlite` `DatabaseSync` 和串行命令队列；不引入 `better-sqlite3`/`sqlite3` native addon。
- SQLite 基线为 WAL + `synchronous=FULL` + `busy_timeout=5000`；每批 facts 与 checkpoint 在同一事务中提交。
- host 保留尚未 commit-ack 的 fact；Worker 崩溃后可重发。`snapshot` 先 flush 已接收批次，再由同一连接的读事务执行所有聚合。
- Worker 作为 tsdown 第二个 Node entry 产出 `lib/usage-worker.js`，host 以 `new URL('./usage-worker.js', import.meta.url)` 加载；构建物必须进入 Git/npm 包。
- 当前 DSH 已使用 `node:sqlite`；Node 24.14 的 ExperimentalWarning 不否决方案，但设计需声明 engine、启动时做能力检测，且不得全局关闭 warning。
