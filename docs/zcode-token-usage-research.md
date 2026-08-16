# ZCode Token Usage 面板实现调研

> 证据截止：2026-08-16。官方资料只采用 ZCode 官方文档、官方发布说明和官方反馈仓库；实现结论另由当前本机 ZCode 3.7.7 安装包与本地数据库只读核验。

## 结论

当前本机 ZCode 3.7.7 的 App Usage 采用的是：

> **内部模型/轮次/工具生命周期在线写入结构化 usage 事实 → SQLite 持久化 → 打开面板时查询最近 7/30 天并做 SQL 聚合 → 返回单个 snapshot。**

因此可以明确排除两种猜测：

- **不是公开插件 Hooks 记账。** usage 写入点位于 ZCode 内部运行时，直接接收模型响应中的 usage 和运行时事件；公开 Hooks 没有模型完成/Token usage 事件。
- **不是打开面板后扫描全部原始会话或 transcript。** 面板读取 `model_usage`、`turn_usage`、`tool_usage` 三张专用表。它仍然会在打开时临时执行聚合 SQL，但扫描边界是最近 7/30 天的结构化行，并有时间索引，不是解析历史会话文本。

也没有发现“后台 worker 预先生成日报/物化汇总表”的证据。ZCode 的关键优化不是把聚合搬到后台，而是把昂贵的“从会话重建 usage”改成运行期增量落事实；面板保留轻量、按需、有限窗口的 SQL 聚合。

## 已验证的数据链路

```text
模型流结束 / 失败
  └─ recordModelUsageFact()
       └─ await sessionStore.recordModelUsage(...response.usage)
            └─ UPSERT model_usage

Turn 完成 / 失败
  └─ recordTurnUsageFact()
       └─ await sessionStore.upsertTurnUsage(...aggregated usage)
            └─ UPSERT turn_usage

工具生命周期事件
  └─ appendEvent()
       └─ await recordToolUsageFromEvent()
            └─ UPSERT tool_usage

设置页 App Usage 挂载
  └─ getAppUsageSnapshot({ range, timeZone })
       └─ RPC v4/usage/stats
            └─ queryAppUsage({ since, until, tzOffsetMs })
                 └─ SQLite SUM / COUNT / GROUP BY
                      └─ 单个 snapshot 返回 UI
```

### 1. usage 在运行时产生并在线落库

当前安装包为 ZCode `3.7.7`（build `3.7.7.4926`），由 `/Applications/ZCode.app/Contents/Info.plist` 验证。

内置 Agent `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 中：

- `recordModelUsageFact` 在模型调用完成或失败后，读取 `result.usage` 的 input、output、reasoning、cache read/write、provider total 等字段，并 `await recordModelUsage(...)`；见 bundled source 第 3074 行。
- `recordTurnUsageFact` 在 turn 完成、失败或取消时汇总该 turn 的模型请求、重试、工具调用和 Token，并 `await upsertTurnUsage(...)`；见第 3074、3143 行。
- `recordToolUsageFromEvent` 监听内部 `ToolCallScheduled`、`PermissionRequested`、`ToolCallStarted`、`ToolCallProgress`、`ToolCallResult`、`ToolCallError` 等事件；内部 `appendEvent` 会 `await` 它；见第 3074、3146 行附近。
- 主 turn、`subagent_child`、`workflow_child` 会被映射为 `main_turn`、`subagent`、`workflow_child` 三类 `query_source`，即 subagent usage 在其自己的模型调用完成时直接写入，不需要主会话结束后再遍历子会话。
- 标题生成、compact、目标完成校验等非主 turn 模型请求也走同一个 `recordModelUsageFact`。

这不是独立的用户 Hook，也不是延迟批处理：写入调用处使用 `await`，失败时只记录 `usage.*.write.failed` 警告，避免 usage 统计失败中断主业务。

### 2. SQLite 是持久化事实库，不是原始日志索引

本机数据库为 `~/.zcode/cli/db/db.sqlite`。`0010_usage_observability` migration（Agent v0.15.0）创建了三张专用表；见 `zcode.cjs` 第 527–615 行：

| 表 | 粒度 | 关键内容 | 主键/幂等键 |
|---|---|---|---|
| `model_usage` | 一次模型请求/重试 attempt | session、turn、query source、provider/model、状态、时间、input/output/reasoning/cache/total tokens | `id`，由 query source、消息/trace、attempt 组成 |
| `turn_usage` | 一个 turn | session、turn、模型请求数、重试数、工具数、各类 Token、耗时与状态 | `(session_id, turn_id)` |
| `tool_usage` | 一次工具调用 | session、turn、tool name、状态、权限、耗时、输出字节数 | `id`，另有 `(session_id, tool_call_id)` 唯一索引 |

主要查询索引：

- `model_usage_started_model_idx(started_at, provider_id, model_id)`
- `model_usage_session_turn_idx(session_id, turn_id)`
- `model_usage_query_source_idx(query_source)`
- `turn_usage_started_idx(started_at)`
- `tool_usage_started_tool_idx(started_at, tool_name)`
- `tool_usage_session_turn_idx(session_id, turn_id)`

数据库强制使用 WAL；写入函数采用 UPSERT，模型、turn 和工具每次写入后还会清理 30 天以前的 usage 行。当前 schema 中没有 usage 日汇总表、物化视图或后台聚合 checkpoint。

### 3. 面板打开时做按需 SQL 聚合

Renderer 的 `useAppUsageStats` 在组件挂载或 range 变化时调用一次 `usageStatsService.getAppUsageSnapshot({range,timeZone})`；实现在 `/Applications/ZCode.app/Contents/Resources/app.asar` 的 `out/renderer/assets/styles-OqUHW1P0.js`。

Desktop host 将调用转发为 Agent RPC `v4/usage/stats`；Agent 的 `getUsageStats` 只允许 `7d` / `30d`，计算 `since`、`until` 后调用 `queryAppUsage`，见 `zcode.cjs` 第 3515 行。

`queryAppUsage`（第 1389–1456 行）直接对三张 usage 表执行 9 组查询：

- 总 Token、输入/输出/reasoning/cache、请求数和错误数；
- session/turn 总数、工具调用和错误数；
- 按 model、tool、day、day + model 分组。

这些查询都带 `started_at >= ? and started_at <= ?`。本机 `EXPLAIN QUERY PLAN` 验证 `model_usage`、`turn_usage`、`tool_usage` 分别使用上述 started-at 索引；`count(distinct session_id)` 额外使用临时 B-tree。

所以它是“**面板打开时临时聚合**”，但不是当前插件那种“打开时重新扫描和解析所有 session 文件”。两者的计算量级和退化方式不同。

## 当前本机数据与耗时快照

只读快照时间约为 2026-08-16 11:34（运行中的 ZCode 仍可能继续追加，数值会变化）：

| 表/分类 | 行数 | 补充 |
|---|---:|---|
| `model_usage` | 18,347 | 约 13.9 MB 表数据，started/model 索引约 1.2 MB |
| `turn_usage` | 1,416 | 约 0.38 MB 表数据 |
| `tool_usage` | 21,034 | 约 7.5 MB 表数据 |
| `query_source=main_turn` | 10,823 | `task_type=interactive` |
| `query_source=subagent` | 7,306 | `task_type=subagent_child` |

数据库整体约 313 MB，但面板不读取占大头的 message/part/transcript 内容。按当前 30 天窗口复刻 `queryAppUsage` 的 9 组 SQL，一次只读执行约 **0.42 秒**。这是本机单次样本、受 OS page cache 影响，不应当当成 SLA；它只用于确认读取成本没有随巨大 transcript 文件线性放大。

大量 subagent 会增加 `model_usage` / `turn_usage` 行数，所以仍会让 SQL 聚合略慢；但每个 subagent 不会促使面板重新解压/解析其 transcript。当前 7,306 条 subagent 模型请求已经在同一索引表中独立记账。

## 和公开 Hooks 的边界

[Hooks 官方文档](https://zcode.z.ai/en/docs/hooks) 列出的公开事件是 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。公开输入没有模型请求完成、provider usage、input/output Token 等字段。

本机 bundled source 也把两条链路明确分开：

- `runSessionStartHooks`、`runUserPromptSubmitHooks`、`runStopHooks` 调用 `hookRunner`；
- `recordModelUsageFact`、`recordTurnUsageFact`、`recordToolUsageFromEvent` 直接调用 `sessionStore`。

因此准确说法是：**ZCode 使用内部运行时生命周期拦截/在线写事实，但没有使用公开插件 Hooks。**

## 官方资料交叉验证

1. [Usage Stats 官方文档](https://zcode.z.ai/en/docs/usage-stats) 明确区分：
   - App Usage 读取当前设备的本地 ZCode 会话记录；
   - Coding Plan 读取 Z.ai / BigModel 远端套餐统计。

2. [ZCode 官方发布说明](https://zcode.z.ai/en/changelog) 中，v3.7.6 提到重启后恢复 compacted usage details，以及 retries / model changes 下 usage tracking 一致性；v2.5.0、v2.6.0、v3.1.0 也持续演进 usage 图表与入口。这与本机看到的独立 usage 事实表和恢复链路一致。

3. 官方反馈仓库 [Issue #245](https://github.com/zai-org/feedback/issues/245) 提交者报告了 SQLite usage 表和 `getAppUsageSnapshot` 链路；本次本机只读调查已独立验证其核心描述。但 issue 本身仍是待评估，SQLite schema 和内部 RPC 不能视为公开稳定 API。

4. 官方反馈仓库 [Issue #93](https://github.com/zai-org/feedback/issues/93) 报告 OpenAI-compatible 流式请求未返回 usage 时，context-window 与 Token 统计缺失。这与本机代码从模型响应 `result.usage` 写入的实现吻合；该 issue 仍未获维护者确认。

## 对 dsh-token-dashboard 的直接启示

值得借鉴的是 ZCode 的数据边界，而不是照抄它的内部表：

1. 在 DSH 能稳定拿到 usage event 的最靠近模型响应处，立即生成幂等 `usage_fact`；不要等面板打开再从 session 重建。
2. 持久化至少保存 `event_id/session_id/timestamp/model/input/output/cache/total`，以 `event_id` UPSERT，给 `(timestamp, model)`、`session_id` 建索引。
3. 面板只请求一个 range snapshot；summary、daily、model breakdown 在同一次查询/响应中返回，避免多个 endpoint 各自触发 refresh。
4. 老 session 的补录应当是一次性、可断点、后台 backfill；完成后日常路径只处理新事件。面板不能隐式触发全量 backfill。
5. 如果 DSH 没有正式的模型完成事件，再考虑从 session append 流实时消费 usage，而不是使用面板请求触发扫描。必须保存 offset/event-id 和去重键。

这一方案不要求预先维护每日汇总表。以当前规模，先用“增量事实表 + 受限窗口 SQL”已经足够；当事实行增长到 SQL 明显变慢时，再增加日级 rollup，而不是回退到扫描原始会话。

## 证据边界

- 本机实现结论只对应 ZCode 3.7.7 / embedded Agent 当前版本；`zcode.cjs`、SQLite schema、RPC 名称都是内部实现，不是官方兼容承诺。
- 调查只覆盖本机 App Usage；远程 workspace、Coding Plan 远端监控接口和服务端账单准确性不是同一条链路。
- 没有发现独立后台预聚合 worker，不等于 ZCode 其他模块完全没有后台任务；结论仅限 App Usage snapshot 的产生与读取路径。
- 0.42 秒是当前数据库、当前机器和当前缓存状态的一次实测。

## 只读复核入口

```bash
plutil -p /Applications/ZCode.app/Contents/Info.plist
sqlite3 -readonly ~/.zcode/cli/db/db.sqlite '.schema model_usage'
sqlite3 -readonly ~/.zcode/cli/db/db.sqlite '.schema turn_usage'
sqlite3 -readonly ~/.zcode/cli/db/db.sqlite '.schema tool_usage'
sqlite3 -readonly ~/.zcode/cli/db/db.sqlite \
  "select query_source, task_type, count(*) from model_usage group by query_source, task_type;"
rg -n "usage_observability|recordModelUsageFact|recordTurnUsageFact|queryAppUsage|getUsageStats" \
  /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
```
