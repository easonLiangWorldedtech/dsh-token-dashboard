# 首次初始化扫描合同

Type: grilling
Status: resolved
Blocked by: 01, 03, 04

## Question

首次建库如何在不阻塞 DSH 启动的前提下，先接入实时事件、再扫描已有会话，与实时写入幂等合并，并对面板提供准确的总量、进度、完成与失败状态？

## Answer

### 1. 触发条件与启动顺序

全历史扫描只在以下情况运行：

- 新建数据库尚无 `projection_state`；
- 已有状态仍为 `initializing`，恢复未完成初始化；
- 后续运维流程明确创建了新的重建 generation（由票据 07 定义）。

`ready` 数据库的普通启动、打开面板和 snapshot 请求都不得触发全历史扫描。删除数据库等价于显式要求重新初始化。

首次建库的启动顺序：

1. Worker 创建 schema 和 `projection_state(initializing)`，以 FULL durability 写入当前 run `arming`；
2. host 注册根级 `session/event` listener 和有界 live ingress；
3. DSH 启动继续，HTTP 路由可立即服务 initializing snapshot；
4. 后台调用 `listSnapshots()` 枚举初始生命周期；
5. 单并发执行历史扫描。

listener 必须早于历史枚举；否则构造/恢复时未重放到 live feed 的事件与扫描期间的新事件之间会有覆盖空洞。初始化不是 endpoint 后台补录，endpoint 只读状态。

### 2. 每会话扫描切点

`listSnapshots()` 没有跨会话原子切点，因此一致性单位是 session lifecycle。每个生命周期复用票据 04 的串行 `source_chain`：

1. 建立或取得 `SessionIngress`，历史任务与该生命周期的实时提交互斥有序；
2. 若已有活跃 session/live buffer，原子截取当前 buffer 并等待 `flush(session)`，建立一个已持久化 cut；
3. 首次执行 `readFrom(id, 0)`；中断续跑则从 checkpoint 的锚点/后缀逻辑继续；
4. 每 500 个事件把最小 projection delta 分批交给 Worker，并按 seq 更新 facts、route cursor 和 checkpoint；
5. 比较扫描前后 revision。listener 已覆盖的正常追加按 seq 合并；无法由 listener 解释的外部改写使用锚点校验，必要时走票据 04 的局部重建；
6. 把扫描结果和 cut 期间的 live buffer 按 seq 去重合并；
7. 最后一个会话事务写 `bootstrap_complete=1` 与完成时 `source_revision`，再把之后的事件交还普通 live 链。

重复 scan/live 观察由 `(lifecycle, turn, step)`、`source_seq` 和 checkpoint 裁前缀消除。初始化不会因活跃会话持续追加而等待“永久静止”。

### 3. 扫描调度与对话性能

当前 DSH JSONL backend 的 `readFrom()` 会在宿主进程读取并解析完整物理文件；Zstd 解码约每 500ms 在帧之间 yield，但一个压缩帧仍是不可分割同步工作。首版必须遵守：

- 历史扫描并发固定为 1；
- 每处理 500 个事件或完成一个会话后主动 `scheduler.yield()`；
- 初始化交给 Worker 的 bulk batch 最多 500 facts；
- live 未确认 delta 达到票据 04 的软阈值时暂停历史调度，压力恢复后继续；
- AbortSignal 贯穿排队与 `readFrom()`，关闭时可以停止；
- 不直接读取、解压或解析 DSH 私有文件路径，保持 persistence API 边界。

这保证 DSH 启动不等待扫描、实时链优先于历史导入，但无法承诺消除单个超大 Zstd frame 的短暂宿主线程占用；该限制必须进入实施风险与验收说明。

### 4. 动态发现与进度

持久进度字段：

```text
phase
discoveredSessions
completedSessions
scanningSessions
retryingSessions
failedSessions
startedAt / completedAt
```

snapshot 再合并 host 的 `pendingLiveBatches`；该值是实时内存状态，不要求为每个变化写 SQLite。

规则：

- 生命周期进入扫描集合时增加 discovered；只有 bootstrap_complete 事务 COMMIT 后增加 completed。
- scanning/retrying/failed 在 Worker 批次边界更新，不按事件写进度。
- 初始化期间发现新会话可以增加 denominator；UI 只显示“完成 X / 已发现 Y”及各状态计数，不承诺百分比单调、不提供 ETA。
- 初始扫描队列为空后必须再执行一次 `listSnapshots()` 收口，把尚未发现的持久生命周期加入队列。
- 收口 cut 之后创建的新生命周期由 listener 首次发现时执行正常的单会话 bootstrap，不重新打开全局 initialization。

### 5. 失败隔离

单会话临时读取失败按 1s、5s、30s 重试三次，其他历史会话继续。确定性日志损坏、格式不兼容或重试耗尽时：

- 该生命周期保持 `bootstrap_complete=0`，计入 failedSessions；
- 保存有界错误码/摘要，不保存正文；
- 扫描其余生命周期；
- 扫描结束后全局 phase=`degraded`，不得标记 ready，因为历史统计不完整；
- 下次插件启动只重试未 bootstrap complete 的生命周期，不重扫已完成历史。

确定性单事件字段错误仍按票据 03 隔离为 ingestion warning，可以完成该会话；整个文件无法可靠读取才属于初始化失败。数据库/Worker 整体不可用才进入全局 error。

### 6. 正常取消与断点续跑

初始化完成与 run clean 是两个维度。正常 disposer：

1. 停止调度新历史会话并 abort 当前 read；
2. 保留已 commit 的 facts/checkpoint，当前生命周期继续是 bootstrap_complete=false；
3. 排空实时/flush/Worker 链；
4. 若实时投影干净，可按票据 04 标记 run clean，即使 projection phase 仍是 initializing。

正常取消不增加 failedSessions，不发错误告警。下次启动看到 initializing 后，从未完成生命周期的 checkpoint 继续；当前 JSONL backend 物理上仍可能解析整文件，但逻辑上不会重复计量。

### 7. ready 原子门禁

只有全部满足时才能进入 ready：

1. 当前初始化队列为空；
2. 最终 `listSnapshots()` 收口已完成；
3. 收口发现的全部生命周期均 bootstrap_complete；
4. failedSessions=0；
5. 所有初始化 Worker 批次都已 commit-ack；
6. 初始化期间截取的 live buffer 已交接给正常实时队列。

Worker 随后在单个事务中写入最终进度、completed_at 和 phase=ready。该事务前 snapshot 只能看到 initializing；事务后才能看到 ready 与完整历史切点。cut 后新事件按普通 250ms 后台批次处理，允许正常短暂滞后，不重新打开全局初始化。
