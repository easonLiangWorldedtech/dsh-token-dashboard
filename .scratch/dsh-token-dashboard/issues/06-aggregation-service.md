# 06 · 数据聚合服务实现（host 端扫描 + 日总量 API）

Type: task
Status: resolved
Blocked by: 02, 04

## Question

按 02 的选型实现 host 侧聚合服务：经 `ctx.sessionPersistence` seam 读会话事件（不做手工 fs+zstd），按 (turn,step) 去重后 fold usage 四桶（in/out/cacheRead/cacheWrite），按浏览器时区（可配置覆盖）切日聚合全局 total（input+output，口径以 05 确认为准），实现 revision+lastSeq 增量缓存，并经 `ctx.webServer` 注册 `/api/token-dashboard/*`（01 结论）暴露给 client 面板；API 支持默认 26 周窗口 + offset 翻页（05 决议）。交付：可运行代码 + 聚合结果与原始日志抽查一致的验证（含 cacheRead 不计入 total 的抽查）。
## Answer

完成，commit `b398183`。实现与验证如下：

**模块**（全部经 `pnpm typecheck` / `pnpm build`）：
- `src/core/types.ts` — host/client 共享的 API 契约（TokenDayBucket / TokenSummary / TokenDaysPayload / DashboardEnvelope）。
- `src/host/usage-fold.ts` — replay-aware fold：assistant/chunk(chunk.type==='usage') 与 assistant/message(data.usage) 两类事件，按 (turn,step) 后写覆盖（chunk 无 message 时仍计数；重放覆盖不叠加），输出按 time 排序。键式去重比官方单槽相邻 fold 更稳（跨 readFrom 边界也正确）。
- `src/host/day-buckets.ts` — DST 安全的逐样本偏移切日（local=机器本地时区，utc=0）；窗口零填充与 offset 翻页；buildSummary 汇总今日/本周/近30天/全部（覆盖全历史，非窗口内）。
- `src/host/aggregator.ts` — TokenAggregator：listSnapshots 观察 revision → 未变跳过；变了 readFrom(lastSeq+1) 尾折；新会话 inspect 全量冷折；会话删除时剪枝；refresh 串行化。缓存驻内存（host 进程生命周期，v1）。
- `src/host/routes.ts` — `GET /api/token-dashboard/summary?tz=` 与 `GET /api/token-dashboard/days?weeks=26&offsetWeeks=0&tz=`，`{ok,value|error}` 信封（对齐参考插件），400/500 语义；无 workspace gate（全局数据）。
- `src/index.ts` — apply 挂载 aggregator + 路由（ctx.effect 注册 disposer）。

**关键口径（05 决议落地）**：total = inputTokens + outputTokens；cacheReadTokens 单独累计（summary.cacheReadAll / day.cacheReadTokens）供 tooltip 附注；tz 由客户端经 query 传 `local|utc`（面板偏好存客户端，不依赖 dsh-settings）。

**验证**：20 个测试全绿（fold 语义 6、日界/窗口 5、增量缓存 5、插件形态 2、真实数据 2）。真实数据测试对本机**全部物化会话日志**做交叉核对：fold 结果与「按 (turn,step) 最后样本胜出」的朴素计算逐键相等；cacheRead 永不进头条总量。构建产物 lib/index.js 自包含 9.43kB、无外部运行时依赖。
