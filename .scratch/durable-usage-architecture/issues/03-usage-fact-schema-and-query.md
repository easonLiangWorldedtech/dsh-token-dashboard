# Usage fact Schema 与聚合语义

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

如何定义 Usage fact、session checkpoint、run epoch 和初始化状态的 DDL、主键、索引、版本与事务不变式，使重放幂等、provider/model 归属、Token 口径、本地时区切日和全历史查询与现有产品行为一致？

## Answer

### 1. 数据库角色与版本

SQLite 是可从 DSH JSONL 重建的持久查询投影，不是新的事实来源。首版使用两种相互独立的版本：

- `PRAGMA application_id = 0x44544F4B`（ASCII `DTOK`）：拒绝把其他 SQLite 文件误当成用量库。
- `PRAGMA user_version = 1`：DDL 结构版本；旧版本只能通过受支持的事务迁移升级。
- `projection_state.projection_version = 1`：JSONL 事件到 Usage fact 的解释语义版本。语义不兼容时进入 `rebuild_required`，不能假装成普通 DDL 迁移。
- 当前插件遇到更高的任一版本时拒绝写入并返回明确的版本不兼容状态，不得降级或自动删除数据库。

所有连接初始化执行：`foreign_keys=ON`、`journal_mode=WAL`、`synchronous=FULL`、有限 `busy_timeout`。常驻 Worker 是唯一数据库连接所有者。

### 2. 首版逻辑 DDL

字段名是实施合同；错误详情必须有长度上限，不保存完整原始事件。

```sql
CREATE TABLE session_lifecycle (
  lifecycle_pk          INTEGER PRIMARY KEY,
  session_id            TEXT    NOT NULL,
  session_created_at_ms INTEGER NOT NULL CHECK (session_created_at_ms >= 0),
  cwd                    TEXT    NOT NULL,
  discovered_at_ms       INTEGER NOT NULL CHECK (discovered_at_ms >= 0),
  UNIQUE (session_id, session_created_at_ms, cwd)
);

CREATE TABLE usage_fact (
  lifecycle_pk     INTEGER NOT NULL
                     REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  turn             INTEGER NOT NULL CHECK (turn >= 0),
  step             INTEGER NOT NULL CHECK (step >= 0),
  source_seq       INTEGER NOT NULL CHECK (source_seq >= 0),
  occurred_at_ms   INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
  provider         TEXT,
  model            TEXT,
  input_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens    INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  PRIMARY KEY (lifecycle_pk, turn, step)
) WITHOUT ROWID;

CREATE INDEX usage_fact_occurred_at_idx
  ON usage_fact(occurred_at_ms);

CREATE TABLE session_checkpoint (
  lifecycle_pk       INTEGER PRIMARY KEY
                       REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  last_seq           INTEGER NOT NULL DEFAULT -1 CHECK (last_seq >= -1),
  route_provider     TEXT,
  route_model        TEXT,
  bootstrap_complete INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_complete IN (0, 1)),
  source_revision    TEXT,
  updated_at_ms      INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (bootstrap_complete = 0 OR source_revision IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE ingestion_error (
  lifecycle_pk  INTEGER NOT NULL
                  REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  source_seq    INTEGER NOT NULL CHECK (source_seq >= 0),
  event_type    TEXT,
  reason_code   TEXT    NOT NULL,
  detail        TEXT    NOT NULL,
  first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= 0),
  PRIMARY KEY (lifecycle_pk, source_seq)
) WITHOUT ROWID;

CREATE TABLE projection_state (
  singleton_id       INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  projection_version INTEGER NOT NULL,
  phase              TEXT NOT NULL CHECK (
                       phase IN (
                         'initializing', 'recovering', 'ready', 'degraded',
                         'rebuild_required', 'error'
                       )
                     ),
  discovered_sessions INTEGER NOT NULL DEFAULT 0 CHECK (discovered_sessions >= 0),
  completed_sessions INTEGER NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0),
  scanning_sessions  INTEGER NOT NULL DEFAULT 0 CHECK (scanning_sessions >= 0),
  retrying_sessions  INTEGER NOT NULL DEFAULT 0 CHECK (retrying_sessions >= 0),
  failed_sessions    INTEGER NOT NULL DEFAULT 0 CHECK (failed_sessions >= 0),
  started_at_ms      INTEGER,
  completed_at_ms    INTEGER,
  last_error_code    TEXT,
  last_error_message TEXT,
  updated_at_ms      INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (completed_sessions + failed_sessions <= discovered_sessions)
);

CREATE TABLE run_epoch (
  epoch_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  state         TEXT NOT NULL CHECK (state IN ('arming', 'active', 'clean')),
  clean_at_ms   INTEGER
);

CREATE TABLE run_baseline (
  epoch_id        INTEGER NOT NULL
                    REFERENCES run_epoch(epoch_id) ON DELETE CASCADE,
  lifecycle_pk    INTEGER NOT NULL
                    REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL,
  PRIMARY KEY (epoch_id, lifecycle_pk)
) WITHOUT ROWID;
```

除生命周期唯一约束、Usage fact 主键和 `occurred_at_ms` 外不预建辅助索引。当前产品只按 provider/model 分组而不按它们筛选，增加普通索引仍需回表读取四个 Token 字段，会制造不必要的写放大和空间占用。新增索引必须由真实 `EXPLAIN QUERY PLAN` 与数据规模证明。

### 3. Usage fact 语义

- 一条事实唯一表示一个会话生命周期内的 `(turn, step)`；相同 `session_id` 删除后重建不会覆盖旧生命周期。
- Usage chunk 与最终 message 不累加。较大的 `source_seq` 是较新的完整观察，整体替换四个 Token 桶和发生时间。
- provider/model 直接存在事实中，允许为 `NULL`。新事件只以非空值覆盖旧归属；查询以 `COALESCE(value, 'unknown')` 显示缺失值。
- 四桶缺失值规范化为 `0`；必须是非负 JavaScript 安全整数。`total_tokens` 不持久化，固定派生为 `input_tokens + output_tokens + cache_read_tokens`；`cache_write_tokens` 保留但不计入当前标题总数。
- `occurred_at_ms` 保存事件绝对时间，不保存日期键；本地日期在查询时按运行机器当前时区逐条换算，因此历史夏令时与以后更换系统时区都不要求重建。

概念性 UPSERT 条件如下；实际 SQL 必须保留同样的单调覆盖语义：

```sql
ON CONFLICT (lifecycle_pk, turn, step) DO UPDATE SET
  source_seq         = excluded.source_seq,
  occurred_at_ms     = excluded.occurred_at_ms,
  provider           = COALESCE(excluded.provider, usage_fact.provider),
  model              = COALESCE(excluded.model, usage_fact.model),
  input_tokens       = excluded.input_tokens,
  output_tokens      = excluded.output_tokens,
  cache_read_tokens  = excluded.cache_read_tokens,
  cache_write_tokens = excluded.cache_write_tokens
WHERE excluded.source_seq >= usage_fact.source_seq;
```

### 4. checkpoint 与路由游标

`last_seq` 不是“最后一个 Usage 事件”，而是已经逐条检查、确认来源持久化并完成 SQLite 提交的最大连续事件序号。处理器维护 `expected_seq = last_seq + 1`：

- 重复或旧序号可幂等重放；缺口出现时不得越过，必须对该生命周期从 `expected_seq` 定向读取。
- 一批连续事件可以产生 0～N 条事实；事实、确定性错误记录、处理后的 `route_provider/route_model` 与新 checkpoint 必须在同一事务提交。
- `route_provider/route_model` 是处理完 `last_seq` 后的折叠状态。request/header 或 request/context 与后续 Usage 横跨重启时，尾部恢复从该状态继续，不能为获得模型归属回扫整个会话。
- `bootstrap_complete/source_revision` 只证明该生命周期曾完成一次稳定前缀扫描。初始化中断后，revision 未变且已完成的生命周期可跳过；变化或未完成的生命周期从 checkpoint 续扫。

确定性坏事件（非法 Token、Usage 缺少 turn/step 等）不会永久堵塞会话：同一事务按 `(lifecycle_pk, source_seq)` UPSERT 一条有界 `ingestion_error`，跳过该 fact 并推进 checkpoint。JSONL flush、Worker、SQLite 或进程错误属于临时系统故障，不得推进 checkpoint。

### 5. run epoch 与初始化状态

- 启动先插入 `arming` epoch，注册实时监听并暂存事件；`listSnapshots()` 的 revision 基线由 Worker 在一个批量事务写入 `run_baseline` 后，epoch 才进入 `active`。
- clean shutdown 的唯一合法顺序是：停止 admission/注销监听 → 排空 host 会话链 → Worker 提交全部批次 → 在最后一个事务把 epoch 标记 `clean` → 关闭数据库与 Worker。
- 下一次看到上一 epoch 为 `active`，仅对基线后新增或 revision 变化的生命周期从各自 checkpoint 尾部恢复；看到 `arming` 则因基线可能不完整而退化为全会话尾部检查。
- 标记 `clean` 的事务可以删除该 epoch 的 baseline 以回收空间；epoch 历史本身很小，可保留用于诊断。
- 首次建库全局 phase 为 `initializing`。面板可读已经提交的部分结果，但必须携带进度并明确“不完整”；所有初始化生命周期完成且初始化期间的实时暂存事件合并后，才能事务性切换为 `ready`。

### 6. 写入与查询事务不变式

写入批次必须满足：

1. host 的 `session/event` 回调只做有界分类与入队，不等待任何 I/O。
2. 后台按会话维持顺序，在 step/turn 批次边界等待 DSH 公共 `ctx.sessions.flush(session)`；Promise 成功是该批来源已落 JSONL 的唯一确认，事件自身没有落盘标记。
3. Worker 在单个事务中写 0～N 条 facts/errors 并推进 checkpoint；只在 COMMIT 后返回 ack。host 在 ack 前保留未确认批次。
4. 任何失败回滚整批；SQLite 不得领先权威 JSONL，也不得出现 fact 已提交而 checkpoint 未提交的中间状态。

snapshot 请求不触发 DSH flush，也不等待仍在 host 侧进行来源落盘的批次。Worker 先越过所有已经进入自身消息队列的写屏障，然后在同一连接的一个只读事务中执行 summary、days 与 byModel SQL，并返回同一个 `asOf`、host 报告的 `pendingBatches`、初始化/错误状态。面板允许落后一个后台批次，但不同区域不能来自不同提交时点。

聚合保持现有产品语义：

- `requests = COUNT(*)`，即去重后的 `(lifecycle, turn, step)` 数。
- 总量均使用 `SUM(input_tokens + output_tokens + cache_read_tokens)`。
- today、最近 7 天、最近 30 天按机器本地日历边界计算；历史热力图保留周偏移翻页并补零。
- byModel 以 `COALESCE(provider,'unknown'), COALESCE(model,'unknown')` 分组。
- all 与全历史模型汇总直接查询永久 facts；首版不建立日 rollup、不设自动清理。
