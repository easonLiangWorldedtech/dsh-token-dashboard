# 06 · 数据聚合服务实现（host 端扫描 + 日总量 API）

Type: task
Status: open
Blocked by: 02, 04

## Question

按 02 的选型实现 host 侧聚合服务：经 `ctx.sessionPersistence` seam 读会话事件（不做手工 fs+zstd），按 (turn,step) 去重后 fold usage 四桶（in/out/cacheRead/cacheWrite），按浏览器时区（可配置覆盖）切日聚合全局 total（input+output，口径以 05 确认为准），实现 revision+lastSeq 增量缓存，并经 `ctx.webServer` 注册 `/api/token-dashboard/*`（01 结论）暴露给 client 面板。交付：可运行代码 + 聚合结果与原始日志抽查一致的验证（含 cacheRead 不计入 total 的抽查）。