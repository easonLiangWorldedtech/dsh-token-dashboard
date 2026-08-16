# 异步写回与异常恢复状态机

Type: grilling
Status: resolved
Blocked by: 01, 02, 03

## Question

队列如何合并 chunk/message、何时批量提交、如何限界和施加背压；正常退出如何排空并标记 clean，异常退出如何以 revision + last_seq 只恢复变化会话，同时定义可接受的延迟、丢失窗口和故障降级？

## Answer

### 1. 非阻塞拓扑与队列数据

`session/event` 回调不得等待 Promise、DSH flush、Worker 或 SQLite。它只校验生命周期与 seq、提取有界字段并写入内存状态：

```text
SessionIngress
  lifecycle identity
  expected_seq
  open_batch { from_seq, to_seq, opened_at, last_activity, deltas[] }
  source_chain
  mode: live | recovering | resync_required

ProjectionBatch
  batch_id + host_generation
  lifecycle identity
  from_seq / to_seq
  relevant_deltas[]
```

`relevant_deltas` 只允许 provider/model 路由变化、Usage chunk、最终 Usage message及其 seq/time/turn/step/四桶。无关事件仅推进连续 `to_seq`；消息正文、工具参数、工具输出和完整 SessionEvent 不得进入队列或跨线程发送。

每个生命周期维护一条串行 `source_chain`，不同生命周期可并行。Worker 仍是全局单连接串行 owner。DSH 保证单会话 seq 连续，但 host 仍校验 `expected_seq`；发现缺口立即将该生命周期转为 `resync_required`，不能用后到事件越过缺口。

### 2. chunk/message 折叠和两级批处理

host 按会话关闭 open batch 的任一触发条件：

- 收到最终 Usage message 或 `turn/end`：立即关闭；
- 只有 chunk 而没有最终 message：250ms 空闲；
- open batch 年龄达到 1s；
- 相关 delta 达到 64 条。

关闭批次只调度后台链，不阻塞事件回调。后台链先等待该会话 `ctx.sessions.flush(session)`；成功才把 source-confirmed batch 发送给 Worker。Worker 跨会话再合并最多 250ms 或 128 个事实更新，任一先到就用一个 SQLite 事务提交；snapshot 和 drain 强制立即提交。

Worker 按 seq 更新 checkpoint 路由游标并折叠 Usage。同一 `(lifecycle, turn, step)` 的最终 message 以较大 source_seq 覆盖 chunk；若最终 message 永远没有出现，chunk 在计时器关闭批次后仍会成为事实。chunk 已经提交、message 后到也只产生一次幂等 UPSERT，不累加。

目标可见延迟：正常最终消息约 `≤250ms + commit latency`；只有 chunk 时约 `≤500ms + commit latency`。这些是内部初始常量，不是产品/API 承诺；实施后通过 queue depth、batch size、source flush latency 和 commit latency 调整。

### 3. ack 与重复投递

host 按精确 `(batch_id, host_generation)` 保留所有未 commit-ack 的 compact batch。Worker 可以把多个 batch 合并进一个事务，但 COMMIT 成功后必须逐一 ack 本事务包含的 batch identity。旧 ack 只能删除对应版本，不能删除同一 fact 的后来更新。

Worker 重启或通信中断后，host 重投未确认批次。Worker 先读取 session checkpoint：

- 批次整体不超过 `last_seq`：幂等 no-op 后 ack；
- 批次与 checkpoint 重叠：裁掉已提交前缀，只处理连续后缀；
- 批次从 `last_seq + 1` 开始：正常处理；
- 批次在 checkpoint 后存在缺口：拒绝并要求该生命周期 resync。

因此事务已 COMMIT、ack 尚未送达时崩溃不会重复计费，也不会错误回退路由游标。

### 4. 背压与内存上限

事件入口不能向模型对话施加阻塞式背压。本模块只能降低面板新鲜度：

- 未确认相关 delta `<4096`：正常 250ms Worker 合批。
- 达到软阈值 4096：取消 Worker 等待并连续提交，状态仍可保持 ready。
- 达到硬阈值 16384：停止无限保留后续 delta，记录受影响生命周期，phase 进入 `degraded` 且原因是 `resync_required`。
- 压力解除后，对受影响生命周期执行 `flush → readFrom(checkpoint + 1)`；追平才退出 degraded。
- 受影响生命周期集合本身达到实现上限时，不再扩大集合，设置全局 overflow 标记；恢复时用一次全会话 revision 比对找候选者。

provider/model、错误 message 等所有字符串输入必须在入队前限制长度，阈值才构成真实内存边界。不得引入第二份临时磁盘 journal；权威 JSONL 就是溢出恢复日志。

### 5. flush 与 Worker 故障

单会话 DSH flush 失败按 100ms、1s、5s 重试三次，保持其顺序且不发送 SQLite；其他会话继续工作。三次失败后该会话进入 `degraded/resync_required`，30 秒冷却后允许下一轮。成功时不直接发送可能过期的内存片段，而是从 checkpoint 后读取 JSONL 尾部重新对齐。

Worker 的 retryable 意外退出同样最多自动重启三次，退避 100ms、1s、5s；新 Worker ready 后按上一节重投。确定性 schema/version/migration/corruption 错误不得循环重启；三次可重试失败也在本次运行熔断。两者都保留非 clean epoch，由下次启动恢复。

phase 语义：

- `ready`：投影已追平来源；可以同时有确定性 `ingestion_error` warnings。
- `recovering`：异常退出候选会话正在补齐，snapshot 是明确标记的不完整结果。
- `degraded`：队列溢出、单会话 flush/Worker 可恢复故障或 resync 尚未追平。
- `error`：本次运行不可恢复的确定性系统错误，禁止用旧数据冒充 ready。

确定性坏来源事件已经在同事务隔离并推进 checkpoint，不会让系统永久 degraded；snapshot 另返回 `warnings.count` 和有限摘要。

### 6. 正常关闭

插件必须由同一个 async disposer 串起依赖顺序，正常预算 4 秒：

1. 设置 `accepting=false` 并注销 listener；
2. 关闭所有 open batch；
3. 等待所有已建立的 per-session source flush/index chain；
4. Worker 强制提交全部已接收批次并返回 ack；
5. 仅当 host 无未确认批次、无 resync、全部步骤成功时，在最后一个 SQLite 事务把当前 epoch 标记 clean；
6. 关闭 DatabaseSync 和 Worker。

任一步失败或超时都不得写 clean；随后可 terminate Worker 并允许 DSH 继续退出。DSH 的致命异常宽限可能短于 4 秒，这只会制造一次安全的“假 dirty”，下次多做恢复，不会制造错误的 clean。

`run_epoch=arming` 必须在开始实时 admission 之前以 FULL durability 提交。否则启动早期硬崩溃可能错误地把更早的 clean epoch 当作上一运行。

### 7. 异常退出恢复

恢复不阻塞 DSH 启动或面板路由注册：

1. 上一 epoch 为 active：phase=`recovering`，当前 snapshots 与该 epoch 的 baseline 比较，候选集仅为新增或 revision 变化的生命周期。
2. 上一 epoch 为 arming：baseline 可能不完整，候选集退化为全部当前生命周期。
3. 最多并行读取两个会话，避免同时解压大量 JSONL；同一生命周期的实时事件进入其有界暂存队列，不受影响会话继续 live 投影。
4. 每个候选先从 checkpoint 自身 seq 读取锚点。锚点仍存在时只处理其后的连续尾部；checkpoint=-1 时从 0 开始。
5. 锚点缺失代表日志截短或重写：从 0 投影到 Worker 临时表，完整成功后用一个事务替换该生命周期的 facts/errors/checkpoint。中断时丢弃临时结果，旧事实保留但标记 stale。
6. 恢复尾部与期间实时暂存事件按 seq 去重合并；所有候选追平后 phase 才回到 ready。

snapshot 中完全消失的会话不触发事实删除，符合永久保留策略；只对同一生命周期仍存在但其 revision/锚点证明被重写的日志做局部替换。

### 8. 可恢复性合同

- JSONL 已持久化、SQLite 未提交：revision + checkpoint 尾部恢复。
- SQLite 已提交、ack 丢失：重投并按 checkpoint 裁前缀。
- host/Worker 队列溢出：从权威 JSONL resync。
- 事件只在 DSH 内存、硬中断前尚未写入 JSONL：插件无法恢复；这是唯一被接受的真实丢失窗口，属于权威来源自身尚未持久化。
- 打开面板从不触发 flush、恢复或历史扫描，只查询当前一致快照。
