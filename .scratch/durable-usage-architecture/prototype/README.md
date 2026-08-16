# PROTOTYPE — Durable Usage State Machine

这是一次性逻辑原型，不是产品实现，也不访问真实 JSONL/SQLite。

它回答一个问题：正常写入、JSONL 后/SQLite 前崩溃、COMMIT 后/ack 前崩溃、初始化与实时事件竞争、队列溢出、关闭超时六个场景中，设计是否始终满足：

- SQLite checkpoint 不领先权威 JSONL；
- 同一 `(lifecycle, turn, step)` 不重复计费；
- 有未确认/待恢复工作时不能标记 clean；
- 初始化或恢复未完成时不能宣称 complete。

运行：

```bash
node .scratch/durable-usage-architecture/prototype/tui.mjs
```

非交互跑完全部场景：

```bash
node .scratch/durable-usage-architecture/prototype/tui.mjs --scenario all
```

原型状态全部在内存中，退出即丢弃。
