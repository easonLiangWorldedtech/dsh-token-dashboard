# 单一 Snapshot API 与一致读合同

Type: grilling
Status: resolved
Blocked by: 03, 05

## Question

`/api/token-dashboard/snapshot` 的请求参数、返回 schema、读事务一致性、分页、初始化/恢复/错误状态和缓存边界如何定义，才能一次返回 summary、days 和 `byModel`，并保持当前 UI 行为？

## Answer

### 1. Endpoint 与参数

唯一读接口：

```http
GET /api/token-dashboard/snapshot?weeks=26&offsetWeeks=0
Accept: application/json
```

- `weeks`：可选安全整数，默认 26，范围 1～52。
- `offsetWeeks`：可选安全整数，默认 0，范围 0～10000。
- 固定使用运行机器本地时区，不提供 tz、provider/model 筛选或事实 cursor。
- 非整数、重复值解释不唯一或越界返回 400 `bad_query`；未知参数忽略以允许向前扩展。
- weeks/offsetWeeks 表示固定本地日历窗口，继续支持当前每次 26 周的 older/newer 翻页。

该面板读取全局持久 Usage facts，不增加 active workspace gate，保持当前插件行为。host/client 在同一包原子升级，实施时以 snapshot 替换旧 summary/days 路由与两次并行 fetch，不保留会导致双查询的运行时兼容路径。

### 2. 成功响应合同

沿用现有 `{ok,value}|{ok:false,error}` envelope。逻辑 TypeScript 合同：

```ts
type ProjectionPhase =
  | 'initializing'
  | 'recovering'
  | 'ready'
  | 'degraded'

interface SnapshotV1 {
  contractVersion: 1
  asOf: {
    committedAtMs: number
    commitGeneration: number
    stateGeneration: number
  }
  query: {
    weeks: number
    offsetWeeks: number
    timezone: 'local'
    fromDate: string       // YYYY-MM-DD, inclusive
    toDate: string         // YYYY-MM-DD, inclusive
  }
  projection: {
    phase: ProjectionPhase
    complete: boolean
    pendingBatches: number
    progress: {
      discoveredSessions: number
      completedSessions: number
      scanningSessions: number
      retryingSessions: number
      failedSessions: number
      startedAtMs: number | null
      completedAtMs: number | null
    }
  }
  summary: {
    today: number
    week: number
    month30: number
    all: number
    cacheReadAll: number
    sessionCount: number
  }
  days: Array<{
    date: string
    totalTokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    requests: number
    byModel: ModelBucket[]       // 最多 Top 3
    otherModelCount: number
    otherModelTokens: number
  }>
  byModel: {
    items: ModelBucket[]         // 最多 Top 100
    otherModelCount: number
    otherModelTokens: number
  }
  warnings: {
    count: number
    byCode: Array<{ code: string; count: number }>
  }
}

interface ModelBucket {
  provider: string
  model: string
  tokens: number
}
```

所有 Token JSON number 在返回前验证为非负安全整数；SQLite 聚合超出 JavaScript 安全整数时返回 503 `numeric_overflow`，不得静默舍入。

### 3. 范围与排序

- summary 始终是相对于请求发生时本地日期的 today、最近 7 天、最近 30 天和全历史，不受 offsetWeeks 影响。
- days 是 `[fromDate,toDate]` 的完整连续日期数组，长度固定 `weeks*7`，无事实日期补零，最旧在前。
- 每个 day 的 byModel 只返回 Token Top 3，并提供全部其余分组的准确 count/tokens；这等价于当前 tooltip 的 Top 3 + others。
- 顶层 byModel 汇总当前请求窗口而不是全历史，最多 Top 100，并提供准确尾部汇总。
- 模型排序为 tokens DESC、provider ASC、model ASC；provider/model 空值展示为 `unknown`。
- sessionCount 是至少存在一条永久 Usage fact 的不同生命周期数。
- total 口径继续是 input + output + cacheRead；cacheWrite 不进入现有 UI。

### 4. 状态与完整性

- ready：HTTP 200、complete=true；存在已隔离 ingestion warnings 不改变 ready。
- initializing/recovering/degraded：HTTP 200、complete=false，返回同一提交时点的部分统计和进度，UI 保留当前数据并显示状态提示。
- pendingBatches 表示 host 侧尚未进入该 DB cut 的批次；ready 可以短暂 pending，这是正常 250ms 实时延迟，不改变历史完整性。
- warnings 只提供按稳定错误码聚合的数量，不把 session id、路径、正文或内部堆栈发送到浏览器。

不可提供可信统计时使用失败 envelope：

```ts
interface DashboardError {
  code: string
  message: string
  retryable: boolean
  projectionPhase?: 'rebuild_required' | 'error'
  retryAfterMs?: number
}
```

- rebuild_required、全局 error、Worker 不可用、snapshot 超时、numeric overflow：503。
- bad query：400。
- 未分类路由错误：500。
- 浏览器 message 是无敏感信息的稳定文案；详细 cause/stack 只进 host 日志。

### 5. 一致读

一次 HTTP 请求只产生一个 Worker snapshot RPC：

1. Worker command serializer 让请求排在此前已收到的 ingest 后；
2. force-commit Worker 内 pending batch；
3. 在同一 DatabaseSync 连接开启显式只读事务；
4. 读取 projection state/warnings，并执行 summary、window days、逐日 Top 3、窗口 Top 100、sessionCount；
5. COMMIT 读事务，产生单个 commitGeneration/asOf；
6. Worker 在同一命令内补零日期并组装 payload，host 只合并瞬时 pendingBatches。

接口不调用 DSH flush，不等待 host 正在执行的来源落盘链。SQL 各区域绝不撕裂，但结果允许落后一个正常后台批次。

### 6. 缓存、合并和超时

响应头固定 `Cache-Control: no-store`，浏览器和代理不存储本地 Usage 数据。host 内部：

- 相同 normalized query 的并发请求共享同一 RPC Promise；
- LRU 最多保存 8 个完整结果；
- cache key=`weeks/offsetWeeks + commitGeneration + stateGeneration + localDate`；
- 新 DB commit、进度/phase/warning 变化或本地跨日立即使旧 key 失效；
- 不同翻页参数在 Worker serializer 中排队，不并行访问 DatabaseSync。

HTTP 等待预算 5 秒。超时返回 retryable 503；已经进入 Worker 的同步 SQL 不使用危险强杀，完成结果只在 generation 仍匹配时进入缓存。client 新翻页、关闭面板或组件卸载时 AbortController 取消旧 fetch，旧结果不得覆盖新页面状态。

### 7. UI 保持合同

client 每次打开、手动刷新或 offsetWeeks 改变只调用一次 snapshot。保持现有：

- 不轮询、不使用 SSE；
- today/week/month30/all 四张统计卡；
- 26 周热力图、30 天柱状图与 26 周翻页；
- 日 tooltip 的 provider/model Top 3 + others 和 requests；
- 本地时区、加载/错误状态、手动刷新时间和会话数页脚。

新增 UI 只限于 initializing/recovering/degraded 进度提示、warnings 提示和不可用错误；不重做视觉结构。
