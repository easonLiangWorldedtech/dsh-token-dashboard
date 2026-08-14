# 02 · 历史 token 消耗的数据源与「每日总量」聚合方案

> research 结论（ticket 02）。只读调查，证据全部来自本机真实会话日志（`/usr/local/bin/zstd -dc` 解压）+ DSH harness checkout（`~/.dsh/profiles/node_modules/@deepseek-ai/*` 均符号链接到 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/`），逐条附源文件路径。未改动任何 ~/.dsh 文件。

## TL;DR（结论）

1. **推荐数据源：走 `ctx.sessionPersistence` seam（`dsh-session-persistence`），不要走 `dsh-session-query-sqlite`，也不要在 host 里手工扫 fs + 手工 zstd。**
   - `dsh-session-query-sqlite` 是 **FTS5 全文搜索只读模型**，只存语义文本、**不含任何 token 数据**——直接排除。
   - `ctx.sessionPersistence.listSnapshots()`（廉价列目录+revision）+ `readFrom(id, fromSeq)`（增量尾读）/ `inspect(id)`（全量解码）是官方稳定读取接口，自动处理 zstd 解压、chunk 行解包、崩溃修复，且是版本化的 seam（比直接拼 `~/.dsh/sessions/--proj--/<id>/session.jsonl.zstd` 路径稳）。
   - 若要零重写的「累计总量」，`ctx.sessionProjections.snapshot(session).values.tokenUsage` 已现成（本机 `dsh-token-meter` 已挂载、投影缓存里已落盘）；但它只给「每会话累计值」，**没有按日拆分**，热力图仍需按事件 `time` 归属日期 → 仍要读事件流。
2. **usage 只在两类事件出现，且每步恰好一对**：`assistant/chunk`（`data.chunk.type==="usage"`，流式早期样本）+ `assistant/message`（`data.usage`，该步最终样本）。二者对同一 `(turn,step)` 数值相等。**去重策略：按 `(turn,step)` 保留最后一条（assistant/message 覆盖 chunk 样本），同一对恰好计一次。** 本机 15 个会话共 563 条 chunk-usage + 563 条 message-usage，若直接相加会**~2 倍重复计数**；去重后为 563 个有效样本。未观察到重试/重放导致的额外重复（无一步出现 >1 条 assistant/message），但 token-meter 的 fold 对「chunk 有、message 无（请求失败）」与「同 step 重复样本」都稳健。
3. **cacheReadTokens 语义**：是「从 KV cache 读到的输入 token」（= DeepSeek `prompt_cache_hit_tokens`），与 `inputTokens`（= 未命中缓存的输入 `prompt_cache_miss_tokens`）**不相交**；计费口径 = input + cacheRead + cacheWrite。本机 provider（opencode/deepseek-v4-pro）从不输出 `cacheWriteTokens`（投影缓存里恒 0），`reasoningTokens` 也从不单独出现（reasoning 已含在 outputTokens 内）。
4. **zstd 在 host 侧 = Node 内建 `node:zlib`**（Node ≥22.5，本机 v24.14.1），无需任何原生依赖：`zstdCompress / zstdDecompress / zstdDecompressSync / createZstdDecompress / constants.ZSTD_*`。**关键坑**：会话日志是「拼接多帧」容器（一次 append 一帧，最大文件 1.36 MiB 含 3234 帧），`zstdDecompressSync` 一次性只解**第一帧**，必须按帧扫描（magic `0xFD2FB528` + 帧头解析）逐帧解——这正是 `dsh-session-persistence-jsonl` 的 `scanZstdFrames()` 干的事。
5. **「每日总量」total 口径**：**v1 头条 total = `inputTokens + outputTokens`（不含 cacheRead）**；cacheRead 单独存、单独可看（tooltip/图例），并提供一个「含缓存」开关（含缓存口径 = input + cacheRead + output；cacheWrite 恒 0 可忽略）。理由：cacheRead 在本机样本里比 uncached input 大 **30~50 倍**（如某会话 cacheRead 2.13M vs input 59.9K），混进 total 会淹没真实新增消耗信号；且它与 input/output 计费单价不同、语义是「上下文复用」而非「新消耗」。四项桶都落盘，便于后续任意聚合。
6. **日界/时区：日志里没有 `clientTimeZone` 结构化字段**（ticket 前提有误），只有每事件 `time`（epoch ms）与会话头 `createdAt`。`dsh-time-context` 把浏览器时区作为**自然语言消息**注入（opt-in、默认关闭，本机未开）。**建议按浏览器时区 `Intl.DateTimeFormat().resolvedOptions().timeZone` 切日**（可配置 `timeZone` 覆盖，默认取浏览器 zone；跨机一致性才用 UTC）。日 key = 该时区下的 `YYYY-MM-DD`。
7. **性能**：本机 15 会话 = 7.92 MiB 压缩 / 18.07 MiB 解压（zstd 2.3×），共 30323 行 JSONL；帧扫描+逐帧 zstd+逐行 JSON.parse 全量冷扫 **≈ 517 ms**（单机同步）。量级上，N 会话全扫是 O(总解压字节)，几百个会话约数秒，**可接受，但应做增量缓存**：以 `listSnapshots()` 的 revision（或文件 mtime+size）为会话级失效键 + 每会话 `(lastSeq)` 水印只折新尾部；本机现成的 `~/.dsh/storages/session_projcache.json` 里的 `tokenUsage` 行可作为「累计值」交叉校验/冷启动捷径（但它是累计值，非按日）。

---

## 1. 会话日志结构

- 布局：`~/.dsh/sessions/<projectKey>/<sessionId>/session.jsonl.zstd`。`projectKey` 是 cwd 的有损转义（`--Users-caozheng-works-stable--` 这种），见 `dsh-session-persistence-jsonl/lib/types/format.d.ts` 的 `projectKey()` / `sessionDir()` / `logPath()`。
- 首行是 `{"type":"session", ...}` 头（SessionHeader：id/version/createdAt/cwd/delegationDepth/agentPreset…），其余每行一个 `SessionEvent` 或打包 chunk 行。事件信封 `{type, seq, time, data}`（surface 事件额外带 `sourceEventSeqs`/ `surfaceOp`），`time` = Unix epoch 毫秒。源：`dsh-session/lib/types/types.d.ts`（`SessionEvent`、`SessionHeader`、`SESSION_FORMAT_VERSION=0`）。
- 实拍（本机 `--Users-caozheng-github-apodemakeles-dsh-token-dashboard--/4c918e67…`）：

```json
{"type":"session","version":0,"id":"4c918e67-…","createdAt":1786677252453,"cwd":"/Users/…/dsh-token-dashboard","delegationDepth":0,"agentPreset":"code"}
{"type":"request/header","seq":13,"time":1786678660370,"data":{"header":{"config":{"provider":"opencode","model":"deepseek-v4-pro"},"system":"…","tools":[…]},"reason":"initial"}}
{"type":"request/context","seq":14,"time":1786678660370,"data":{"provider":"opencode","model":"deepseek-v4-pro","contextWindow":1000000}}
{"type":"assistant/chunk","seq":597,"time":1786678670785,"data":{"turn":1,"step":2,"chunk":{"type":"usage","usage":{"inputTokens":237,"outputTokens":572,"cacheReadTokens":16000}}}}
{"type":"assistant/message","seq":599,"time":1786678670786,"data":{"turn":1,"step":2,"message":{…},"usage":{"inputTokens":237,"outputTokens":572,"cacheReadTokens":16000}},"sourceEventSeqs":[…],"surfaceOp":"append"}
```

- 事件词表（15 会话全集）：`session, permission/preset, sandbox/mode, approval/policy, turn/start, turn/end, step/start, step/end, user/message, request/header, request/context, assistant/chunk, assistant/message, tool/call, tool/result, todo/write, session/title, session/title-llm-request, subagent/descriptor, session/end-seed, agent/inbox/spliced, tool/code-dispatch(-start)`，外加打包行 `reasoning-chunks / text-chunks / tool-call-chunks`。

## 2. usage 事件的准确位置

usage 只出现在两种事件，二者对同一 `(turn,step)` 数值**完全相等**（实测比对全部一致）：

| 事件 | 位置 | 语义 |
|---|---|---|
| `assistant/chunk` | `data.chunk.type === "usage"` 时，`data.chunk.usage` | 流式期间的**早期样本**（provider 一报 usage 就落盘，早于 message 组装） |
| `assistant/message` | `data.usage`（可选，adapter 报了才有） | 该步**最终样本**（与 message 一起落盘） |

源（权威）：
- `dsh-session/lib/types/types.d.ts` 对 `assistant/message` 的注释原文：`"Carries the step's usage when the adapter reported token accounting, so the model output and its accounting travel together (there is no separate usage record)."`
- `dsh-token-meter/lib/types/usage-projection.js` 的 `usageOf(event)` 精确枚举了这两个位置。

**不在**：`request/header`、`request/context`（只有 provider/model/contextWindow，无 usage）、`step/end`（只有 turn/step）、`turn/end`。没有独立的 token-meter 事件。

每步恰好一对：本机 15 会话统计 = 563 条 `assistant/chunk` usage + 563 条 `assistant/message` usage（每步 1 chunk 样本 + 1 message 样本）。未发现任何一步出现 >1 条 assistant/message（即这些会话里没有重试/重放导致的额外 message），也未发现「有 chunk usage 但无对应 message」的失败残留——但 fold 语义要覆盖这种情形（见 §3）。

## 3. 去重 / 重放语义（token-meter 的权威 fold）

`dsh-token-meter` 的 `tokenUsageProjectionDefinition`（`lib/types/usage-projection.js`）是**官方 replay-aware 计数实现**，逐字逻辑：

1. `bucketsFrom(usage)`：`uncachedInputTokens = usage.inputTokens`、`outputTokens = usage.outputTokens`、`cacheReadTokens = usage.cacheReadTokens ?? 0`、`cacheWriteTokens = usage.cacheWriteTokens ?? 0`。
2. 只对 `usageOf(event)` 命中的两个事件类型累计。
3. **去重 = 单一 `last` 槽 + `(turn,step)` 键**：新样本若与 `last` 同 `(turn,step)`，则「先减旧、再加新」替换（若桶值全等则跳过）；否则追加。即 **`(turn,step)` 内最后一条样本胜出**（assistant/message 覆盖先到的 chunk 样本）。
4. 依赖的日志不变量（README 原文）："once a later step reports usage, a legal log never reports usage for an earlier step again" —— 同一 step 的 usage 报告是相邻的，因此单槽 `last` 就够，无需按 step 存多值。
5. README 原文："Usage chunks are counted even when a request later fails; a final assistant-message usage for the same (turn, step) replaces that sample instead of double-counting it." —— chunk 样本保证「请求后来失败也能留下计数」，message 样本保证「同一步不双计」。

**重放/重试**：`assistant/message` 的 `source.sourceEventSeqs` 引用构成它的 chunk seq，`source.replayState`（含 `kind:"pi-ai"`、`responseId`）是 replay 身份；但**做 token 计数无需理会 replay 身份**——按 `(turn,step)` 最后样本胜出的 fold 已天然 replay-aware（重复样本替换而非叠加）。`dsh-session-telemetry` 侧的去重键是 `(session.id, event.seq)`（属转发去重，与本聚合无关）。

**对本插件的最小实现**：逐行读事件 → 命中两类 usage 事件 → 以 `(turn,step)` 为键、后写覆盖 → 对最终样本按 `event.time` 归日累加。约 20~30 行。

## 4. 候选数据层包逐个核查

| 包 | 作用 | 是否含 token 数据 / 能否直接用于每日总量 |
|---|---|---|
| `dsh-session-query-sqlite` | `ctx.sessionQuery` 的 SQLite FTS5 实现；派生索引只存**语义文本文档**（`node:sqlite` `DatabaseSync`，schema v8，application id 1146308689） | **否**。表是 FTS5 全文索引，不是 token 计数；`searchSessions/searchEvents` + 继承的 `readEvent/filterEvents` 都没有求和原语。排除。 |
| `dsh-session-stats` | `sessionStats` 投影：turn/step 数 + LLM/工具/首字/decode 墙钟 | 只有 `decodeTokens`（= 有 usage 的 step 的 outputTokens 之和），**不含 input/cacheRead**。不足以做总量。 |
| `dsh-token-meter` | `ctx.tokenMeter`（measure/estimateMessage）+ **`tokenUsage` 投影**（四桶累计：uncachedInput/output/cacheRead/cacheWrite） | **是**。这是 token 计数的官方权威实现，fold 即 §3。 |
| `dsh-session-telemetry` + `-otel` | 把会话事件（含完整 `event.data`）转发给 OTel collector（logs），默认 DISABLED | **否**。是导出 SDK，本地无查询/聚合 API；只有部署了 collector 才能用，且是原始事件流非聚合。 |
| `dsh-session-persistence-jsonl` | JSONL+zstd 落盘后端；`node:zlib` zstd、`scanZstdFrames`、`scanLog`、`parseHeaderMeta` | 底层读写；被 seam 包着用，不建议直接依赖其内部符号。 |
| `dsh-session-persistence`（seam） | `ctx.sessionPersistence`：`list / listSnapshots / inspect / readFrom(id,fromSeq) / load / readRaw / locate` | **推荐读取入口**（见 §5）。 |
| `dsh-session-projection`（seam） | `ctx.sessionProjections`：`snapshot / onChanged / checkpoint / restore` | 承载 `tokenUsage`（累计值）。 |
| `dsh-session-projection-cache` | 把投影 checkpoint 持久化到 `session_projcache` domain | 本机已落盘 `~/.dsh/storages/session_projcache.json`。 |

**本机实测投影缓存**（`~/.dsh/storages/session_projcache.json`，domain `session_projcache` v3）已含 `tokenUsage` 行（8/15 会话），形如：

```json
{"ver":1,"seq":31528,"val":{"totals":{"uncachedInputTokens":59865,"outputTokens":32955,"cacheReadTokens":2135808,"cacheWriteTokens":0},"last":{"turn":11,"step":3,"buckets":{…}}}}
```

佐证：`dsh-token-meter` 确已挂载、`tokenUsage` 已在算；`cacheWriteTokens` 恒 0（本 provider 不报 cache write）。

## 5. 推荐数据源选型与理由

**首选：`ctx.sessionPersistence` seam 读事件 + 自己实现 §3 的 30 行 fold。**

- 枚举：`ctx.sessionPersistence.listSnapshots()` → `{header, revision}`[]（只读头，不解析全文，对会话数线性）。
- 读取：`readFrom(id, fromSeq)`（增量尾读，带水印）或 `inspect(id)`（全量解码，冷启动）；两者都返回已解 zstd + 已解 chunk 行的 `SessionEvent[]`，插件拿到的是标准事件，无需碰 zstd/打包/崩溃修复。
- 归属日：用 `event.time` + 浏览器时区（§8）。
- 增量：会话级失效键 = revision（或 mtime+size）；事件级水印 = 最后已折 `seq`；`readFrom` 只折新尾。

理由（四维）：
1. **性能**：seam 的 `readFrom` 在 JSONL 上仍需全文件解压再跳过（类型注释明说 "sequential media (JSONL…) still parse the whole artifact and skip forward"），冷扫成本与手工扫相同（§9），但增量后只需尾读，量级相同。
2. **维护成本**：不重写目录遍历、zstd 帧扫描、chunk 行解码、崩溃修复（`inspect` 会补 synthetic closers）；fold 只有 30 行且照抄官方实现。
3. **对 DSH 内部 API 的耦合**：耦合到 `ctx.sessionPersistence` **seam**（稳定扩展点，跨版本契约）而非内部事件细节；唯一硬依赖是「usage 在 `assistant/chunk`/ `assistant/message` 的字段名」这一已文档化且被 token-meter 长期依赖的契约。
4. **跨 DSH 版本稳定性**：seam 与事件契约比 `~/.dsh/sessions/--proj--/<id>/session.jsonl.zstd` 目录布局更稳（布局由 `projectKey()` 决定，是有意 lossy 的内部细节）。

**次选（可叠加，作为累计值交叉校验）**：`ctx.sessionProjections.snapshot(session).values.tokenUsage`（当 `dsh-token-meter` 挂载时）——但它是「每会话累计」不含按日拆分，只能作校验/冷启动捷径，不能替代按日 fold。

**不选**：`dsh-session-query-sqlite`（无 token）、`dsh-session-telemetry-otel`（导出 SDK、需 collector）、手工 fs+zstd（重写内部细节、易碎）。

## 6. zstd 解压（host 侧）

- **依赖：Node 内建 `node:zlib`**（Node ≥22.5 起提供 zstd；本机 v24.14.1 已确认）。无 npm 依赖、无原生 addon。
- 导入（照抄 `dsh-session-persistence-jsonl/lib/index.js:10`）：

```js
import { constants, createZstdDecompress, zstdCompress, zstdDecompress, zstdDecompressSync } from "node:zlib";
```

- **关键坑（实测）**：会话文件是**拼接多帧**容器（一次 `append()` 写一帧；本机最大 1.36 MiB 文件含 **3234 帧**）。`zstdDecompressSync(wholeBuffer)` 一次性**只解第一帧**（实测只得到 191 B 的 session 头行）；`createZstdDecompress` 流式同样停在首帧。必须**先扫帧边界再逐帧解**：

```
帧头：4B magic 0xFD2FB528(LE) + 1B frame-header-descriptor + 可选 window/dict/contentSize + 块序列 + 可选 checksum。
```

  `dsh-session-persistence-jsonl` 的 `scanZstdFrames(buffer)`（`lib/index.js:503`）就是完整实现（读 magic → 解析 descriptor 的 `contentSizeFlag/singleSegment/checksum/dictionaryFlag` → 按块头 `lastBlock/blockType/blockSize` 跳块 → 得到 `{start,end}`），再对每帧 `zstdDecompressSync(frame)`。**建议直接复用该算法逻辑，或更简单：走 `ctx.sessionPersistence` seam（§5），它已把这层全包了。**
- 离线调查用的 `/usr/local/bin/zstd -dc`（CLI v1.5.7）会自动处理拼接帧，但那是子进程，插件运行时无需它。

## 7. 「每日总量」total 口径

`TokenUsage` 四桶**互斥**（`dsh-llm/lib/types/types.d.ts:115-129`）：

> "Counts are DISJOINT: `inputTokens` is uncached input only; cached input is reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input = sum of the three). Adapters whose providers fold cache hits into a total prompt count (DeepSeek's `prompt_tokens`) subtract them out."

- `inputTokens` = 未命中缓存的输入（DeepSeek `prompt_cache_miss_tokens`）
- `cacheReadTokens` = 从 KV cache 读到的输入（`prompt_cache_hit_tokens`）
- `cacheWriteTokens` = 写入缓存的输入（本 provider 恒 0）
- `outputTokens` = 输出（**含 reasoning**，reasoning 不再单列；`dsh-token-meter/lib/types/projection.d.ts` 明言 "reasoning tokens are already included in outputTokens"）

**推荐口径**：
- **头条 `total = inputTokens + outputTokens`（不含 cacheRead）**。理由：cacheRead 在本机样本里是 uncached input 的 **30~50 倍**（实例：某会话 `cacheReadTokens:2135808` vs `uncachedInputTokens:59865`），若混入 total，热力图被「上下文复用」淹没，失去「当日真实新增消耗」的语义；且 cacheRead 与 input/output 计费单价不同（DeepSeek cache hit 约 1/10 价）、语义是复用非新增。
- **四桶全部落盘**（uncachedInput / output / cacheRead / cacheWrite），UI 只渲染 total，但保留：
  - 图例/tooltip 附 cacheRead（可选开关「含缓存」）。
  - 「含缓存口径」= input + cacheRead + output（cacheWrite 恒 0 可忽略）供对照。
- 这符合 map 锁定决策「v1 只显示 total tokens、不做 input/output/cache 明细、不做成本」：total 定义即 `input+output`，cacheRead 仅作可选附注。

## 8. 日界与时区

- **日志里没有 `clientTimeZone` 结构化字段**（全 15 会话逐行 grep 事件 `data` 无任何 timeZone/timezone/clientTimeZone 键；会话头 `SessionHeader` 也无时区字段）。ticket 前提「日志里有 clientTimeZone（如 Asia/Shanghai）」**不成立**。
- 时间信息只有：会话头 `createdAt`、每事件 `time`（均为 epoch ms）。usage 的 `assistant/chunk` 与 `assistant/message` 的 `time` 同毫秒级（实测同值），归属日用任一即可。
- `dsh-time-context` 会把浏览器时区作为**自然语言消息**注入（opt-in、默认关闭，本机未启用、会话里无 time-context 消息），不是结构化字段。源：`dsh-time-context/README.md`（"browser samples `Intl.DateTimeFormat().resolvedOptions().timeZone`… natural-language context, not an input default"）。
- **建议**：日界按**浏览器时区** `Intl.DateTimeFormat().resolvedOptions().timeZone`（在 client 取、作为请求参数/配置传给 host 聚合，或 host 读 `process.env.TZ` 回退）；提供 `timeZone` 配置覆盖（默认取浏览器 zone）。日 key = 该时区 `YYYY-MM-DD`（用 `Intl.DateTimeFormat('en-CA', {timeZone})` 取日历日期，避免手算 UTC 偏移）。仅当需要跨机/跨会话绝对一致时才退到 UTC。

## 9. 性能估算与增量缓存

实测（本机，`/Users/caozheng/.dsh/sessions` 全部）：

- 15 会话 = **7.92 MiB 压缩 / 18.07 MiB 解压**（zstd 压缩比 2.3×），共 **30323 行 JSONL**，最大单会话 2.84 MiB 解压、3234 帧。
- **全量冷扫**（帧扫描 + 逐帧 `zstdDecompressSync` + 逐行 `JSON.parse`，只挑 usage 行）≈ **517 ms**（单机同步、Node v24）。
- 结果：563 chunk-usage + 563 message-usage → 去重后 563 个有效样本（若两处相加则 1126，**2 倍虚增**）。

量级模型：成本 O(总解压字节 + 总行数)。zstd 解压 ~100+ MB/s、`JSON.parse` ~50 MB/s，故 **N 会话（每会话几百 KB~几 MB）**：N=100 → ~3~4 s；N=1000 → ~30 s 冷扫。对「打开面板一次性冷扫 + 之后增量」完全够用。

**增量缓存方案（建议）**：
1. 会话级失效键 = `listSnapshots()` 的 `revision`（或退化为 `session.jsonl.zstd` 的 mtime+size）；revision 变 → 重扫该会话。
2. 事件级水印 = 该会话已折的最后 `seq`（`readFrom(id, watermark)` 只回新事件）；新事件只折尾部并累加当日桶。
3. 持久化：自己的缓存（如 `~/.dsh/storages/…` 或项目内 `.scratch` 下）存 `{sessionId: {revision, lastSeq, dailyTotals}}`。可复用 DSH 现成的 `session_projcache.json` 的 `tokenUsage` 行做「累计值」交叉校验（注意它是累计值、非按日，且只覆盖 host 加载过/已 dispose 的会话——本机 8/15）。

---

## 附：关键证据路径速查

- 事件信封/usage 字段语义：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts`、`dsh-llm/lib/types/types.d.ts:115-129`
- 权威 fold（去重）：`…/dsh-token-meter/lib/types/usage-projection.js`（`tokenUsageProjectionDefinition`）、`…/dsh-token-meter/README.md`
- 读取 seam：`…/dsh-session-persistence/lib/types/index.d.ts`（`listSnapshots/readFrom/inspect/readRaw/locate`）
- zstd：`…/dsh-session-persistence-jsonl/lib/index.js:10`（`node:zlib` 导入）、`:503`（`scanZstdFrames`）、`lib/types/format.d.ts`（`eventLines/scanLog/parseHeaderMeta`）
- sqlite 无 token：`…/dsh-session-query-sqlite/README.md`、`lib/types/schema.d.ts`（`SESSION_QUERY_SQLITE_SCHEMA_VERSION=8`）
- 投影缓存实样：`~/.dsh/storages/session_projcache.json`（`tables.sessions.*.rows.tokenUsage`）
- 时区无结构化字段：全 15 会话逐行 grep（本调查实测）
