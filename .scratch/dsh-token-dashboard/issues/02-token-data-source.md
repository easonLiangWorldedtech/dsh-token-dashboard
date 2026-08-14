# 02 · 历史 token 消耗的数据源与「每日总量」聚合方案

Type: research
Status: resolved
Blocked by: —

## Question

本机 DSH 的历史 token 消耗数据从哪里读、如何聚合到「每日总量」？产出：数据源选型（直读 jsonl vs `dsh-session-query-sqlite` vs `dsh-token-meter` / `dsh-session-stats` / `dsh-session-telemetry`）、usage 事件在日志中的准确位置与重放/去重语义、zstd 解压方案、日界与时区建议、total 口径建议（cacheReadTokens 是否计入、是否去重）。

## Context

- 会话日志：`~/.dsh/sessions/<project>/<session-id>/session.jsonl.zstd`（JSONL + zstd）。已确认日志含 `"usage":{"inputTokens":N,"outputTokens":N,"cacheReadTokens":N}` 形态对象。
- 候选数据层包（本机 profile node_modules 可读源码）：`dsh-session-query-sqlite`、`dsh-session-stats`（whole-log 计数）、`dsh-token-meter`（replay-aware，`ctx.tokenMeter`）、`dsh-session-telemetry` + `dsh-session-telemetry-otel`、`dsh-session-persistence-jsonl`。
- 插件运行侧：web GUI host 进程（node）在本机、可访问 fs；client-ui 插件经 host 路由取数（见 01）。
- 只读调查，不安装、不修改 profile 与 ~/.dsh。
## Answer

结论（详见 [research/02-token-data-source.md](../research/02-token-data-source.md)，逐条附源码路径）：

1. **数据源选型：走 `ctx.sessionPersistence` seam**（`listSnapshots` + `readFrom`/`inspect` 读事件），自己实现约 30 行的 token-meter fold。不选 sqlite（FTS5 全文索引，无 token 数据）、不选 telemetry-otel（是导出 SDK）、不做手工 fs+zstd。
2. **usage 位置与去重**：仅 `assistant/chunk`（chunk.type==="usage"）与 `assistant/message`（data.usage）各一次/步、值相等；按 (turn,step) 保留最后样本（message 覆盖 chunk）——不查重会 2 倍虚增（本机实样 563+563→563）。无重试/重放重复。
3. **cacheReadTokens 语义**：KV cache 读输入（prompt_cache_hit），与 inputTokens（未命中）互斥；计费= input+cacheRead+cacheWrite；本 provider 的 cacheWrite/reasoning 恒不出现。
4. **zstd**：Node 内建 `node:zlib`（v24 已验）；坑：日志是多帧拼接（最大 3234 帧），`zstdDecompressSync` 只解首帧，须逐帧 scan（`scanZstdFrames`）。
5. **total 口径（推荐）**：`inputTokens + outputTokens`，**不含 cacheRead**（cacheRead 比 input 大 30~50 倍，计入会淹没真实消耗信号）；四桶（in/out/cacheRead/cacheWrite）落盘、cacheRead 作可选附注。最终口径由 05（HITL 原型）确认。
6. **时区**：日志无 clientTimeZone（ticket 前提有误）；按**浏览器时区**切日，可配置覆盖。
7. **性能**：15 会话 7.92MiB→18.07MiB、30323 行，全量冷扫 ≈517ms；N=1000 约 30s → 需要 revision+lastSeq **增量缓存**。
