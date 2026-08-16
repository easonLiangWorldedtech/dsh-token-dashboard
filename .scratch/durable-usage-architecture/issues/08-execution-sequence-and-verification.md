# 实施顺序与验证门禁

Type: grilling
Status: resolved
Blocked by: 03, 04, 05, 06, 07

## Question

实施者应以什么小步顺序完成 schema/Worker、实时采集、初始化、恢复、snapshot API 和 client 切换；每一步的单元/集成/真实数据验证、性能门禁、观测点与可回滚点是什么？

## Answer

### 1. 总体实施原则

- 每个提交同时包含该步测试，提交结束必须 typecheck/test/build 通过。
- 新模块先以未接线的 deep module 落地；只有第 9 步一次性替换运行时，避免可发布提交同时运行旧扫描与新投影。
- 不手改 `lib/**`；每个影响 bundle/type 的提交通过 build 生成并同步提交对应产物。
- 所有文件测试使用临时 DSH_HOME/临时数据库，不写真实 `~/.dsh`。
- 真实历史只做只读交叉核对；不通过大量 subagent 制造负载。
- host/Worker 改动必须重启 DSH，不能以 client HMR 结果代替验证。

### 2. 十个小步提交

#### Commit 1 — 共享合同与纯投影器

新增版本化 SnapshotV1、ProjectionBatch/delta、Worker RPC、稳定错误码和 projector 纯函数；覆盖 route cursor、chunk/message last-wins、非法事件隔离、连续 seq/gap、Token 安全整数。

门禁：纯单测；旧 host/client 不引用新模块，运行行为不变。回滚只删除新文件。

#### Commit 2 — SQLite schema、repository 与查询

实现 application_id/user_version/projection_version、DDL、prepared statements、fact/error/checkpoint 原子事务、UPSERT 单调条件、projection/run state 和 snapshot SQL/补零/Top N。

门禁：临时库 schema golden test、约束/外键、重复重放、事务 rollback、checkpoint 不跨 gap、本地日历/DST、query plan 使用 occurred_at 索引、numeric overflow。该模块仍不接入插件。

#### Commit 3 — Worker entry、协议与发布形态

新增 `src/host/usage-worker.ts`、第二 Node entry、Worker command serializer、commit ack、snapshot/drain；更新 tsdown/package engine/files 和 plugin-shape artifact 测试。

门禁：真实 Worker + 临时 SQLite 的 boot/ingest/snapshot/drain、错误序列化、提交后 ack；`pnpm build` 后存在 `lib/usage-worker.js`，npm/Git artifact 包含它。尚不从 `src/index.ts` 启动 Worker。

#### Commit 4 — UsageWorkerClient

实现 RPC pending map、batch_id+generation、unacked 保留、checkpoint 裁前缀重投、100ms/1s/5s 三次重启、熔断、5 秒 snapshot timeout、4 秒 drain。

门禁：故障注入覆盖 commit 前退出、commit 后 ack 前退出、messageerror、旧 ack 不删除新版本、三次熔断。仍未接线。

#### Commit 5 — 实时 collector 与两级队列

实现根级 listener 的 O(1) 最小 delta 提取、每生命周期顺序链、250ms/1s/64 host 组批、flush barrier、Worker 250ms/128 合批提示、4096/16384 背压和 resync 标记。

门禁：fake session service 验证 listener 不返回待等待 Promise、不传正文、不同会话并行/同会话有序、flush 失败不发送 SQLite、soft/hard threshold 与其他会话隔离。模块未应用到 Cordis root。

#### Commit 6 — 初始化与异常恢复协调器

实现 arming/active/clean、revision baseline、单并发初始化、500-event yield/bulk、进度、final sweep、AbortSignal、dirty recovery 两并发、锚点与 per-lifecycle 临时表重建。

门禁：listener/scan race、新会话动态发现、初始化取消续跑、failed session degraded、ready 原子门禁、active/arming 恢复候选、截短日志局部替换。使用 deterministic fake persistence 和真实 Worker。

#### Commit 7 — shadow rebuild、migration 与维护 CLI

实现 owner、application/schema probe、事务 migration、intent 状态机、shadow promotion crash recovery，以及 status/verify/rebuild/backups/restore/cleanup CLI。

门禁：在 promotion 每个文件操作点故障注入；foreign/newer DB 不改写；权限/ENOSPC 不误判 corruption；exact basename/symlink/glob 防护；DSH owner 活跃时 CLI 写命令拒绝。模块仍未接入生产 apply。

#### Commit 8 — Snapshot route 与 client 适配（未切换）

实现单 GET handler、输入验证、HTTP 状态、inflight coalescing、8-entry generation cache、no-store；实现 `fetchSnapshot`、AbortController 与状态展示组件，但旧 Panel 暂不调用。

门禁：路由契约/安全错误、同参数 RPC 合并、commit/state/cross-day 失效、partial 200/不可用 503、Top3/Top100 tail totals、旧请求不覆盖新翻页。

#### Commit 9 — 原子运行时切换

在唯一 `ctx.effect` 中启动 owner/Worker、持久化 arming、注册 collector/routes，并按单 disposer 顺序关闭；Panel 改为单次 fetchSnapshot；删除旧 TokenAggregator、summary/days routes 和仅为旧扫描存在的代码/测试。

门禁：完整集成 + link 安装；进程只注册 snapshot，不再注册旧接口；打开面板无 listSnapshots/readFrom 调用；host 启动后初始化自动运行；UI 原行为及新增状态均通过。该提交是主要回滚点，revert 后旧插件忽略 SQLite。

#### Commit 10 — 文档、生成物与发布验收

更新 README/README.zh/dev-loop/CONTEXT、总量 cacheRead 口径、DB/CLI/runbook；重建并提交 `lib/**`、sourcemap 和 declarations。

门禁：从干净 checkout 安装依赖、typecheck/test/build、pack 内容检查、link 安装到 web profile、DSH 重启与 GUI smoke。禁止仅验证工作区源文件而漏掉发布 artifact。

### 3. 自动测试矩阵

#### 单元测试

- projector：route state 跨 checkpoint、chunk/message、重复/乱序/gap、坏字段 warning。
- schema/repository：主键、CHECK/FK、migration、fact+checkpoint 原子性、run clean last。
- SQL：today/7/30/all、DST、本地跨日、offset zero-fill、provider/model unknown、稳定排序与尾部汇总。
- queues：timer/size/max-age、generation ack、soft/hard bounds、retry/circuit breaker。
- API/client：参数/envelope/status、abort race、partial data 与 warning 展示。
- maintenance：intent 状态机、路径校验、恢复唯一性。

#### 集成故障点

至少覆盖：

1. 事件进入内存但 flush 失败；
2. JSONL flush 成功、SQLite COMMIT 前退出；
3. COMMIT 成功、ack 前 Worker 退出；
4. run 停在 arming 与 active；
5. 初始化读取中 abort；
6. live 与 readFrom(0) 重叠；
7. queue overflow 后 resync；
8. checkpoint 锚点消失；
9. disposer 超时，不得写 clean；
10. shadow ready 前、两次 rename 之间、promotion 后 intent 删除前崩溃；
11. 第二 owner/CLI 竞争；
12. database too new、foreign application_id、corrupt、permission、ENOSPC 分类。

每个故障测试最终都要断言“总量不重复、checkpoint 不越界、错误状态不伪装 ready、原库/backup 未被误删”。

### 4. 真实数据等价验证

新增只读对照工具：

1. 从真实 sessionPersistence 读取本机 snapshots/事件，但将新投影写入临时目录；
2. 用冻结的旧 fold/day-bucket 逻辑计算 oracle；
3. 按 `(lifecycle,turn,step)`、summary、每日本地桶、provider/model、requests、sessionCount 逐项对比；
4. 再重放相同日志一次，断言 facts/总量完全不变；
5. 不输出 prompt/tool 内容，不修改真实 JSONL 或正式 usage.sqlite。

由于 README 旧文案与当前实现冲突，oracle 以当前代码和已确认合同 `input+output+cacheRead` 为准。真实对照失败不得以“测试过时”跳过，必须定位到具体 fact 差异。

### 5. 性能与资源门禁

使用当前真实语料的只读副本，加一个直接生成 facts 的确定性 SQLite fixture；不运行大量 subagent：

| 指标 | 首版门禁 |
|---|---:|
| session/event 回调（仅 normalize+enqueue） | p99 < 1ms，0 I/O |
| 128 facts FULL transaction | 本机 p95 < 100ms |
| 当前真实语料 ready snapshot | p95 < 500ms |
| 100k facts、26 周 snapshot | p95 < 2s，且低于 5s HTTP budget |
| 相同 query/cache generation 命中 | p95 < 10ms，不进 Worker SQL |
| host 未确认 delta | 永不超过 16384；溢出转 resync |
| 初始化调度 | 单会话并发；live soft pressure 时暂停 |

性能测试报告机器、Node/SQLite 版本、facts/lifecycles/models 数量和冷/热缓存，不能只报单次最好值。DSH `readFrom()` 单压缩帧同步解码是已知外部限制；测试分别记录 readFrom wall time 与插件每 500 events 的处理/yield，不能把外部整帧耗时伪装成插件可消除。

### 6. 观测点

结构化本地指标/日志至少包含：

- phase、commitGeneration/stateGeneration、pending batches/deltas、overflow lifecycles；
- source flush、SQLite commit、snapshot SQL/total、initial scan session/readFrom 时延；
- batch facts/events、retry 次数、Worker restart、circuit open、resync 原因；
- discovered/completed/retrying/failed、warning by code；
- DB/WAL/shadow/backup 大小、migration/rebuild/promotion 状态；
- shutdown drain 各阶段耗时和 clean/dirty 结果。

不得记录完整 event、prompt、tool args/output。指标首先用于测试断言与 status CLI；首版不上传外部遥测。

### 7. 发布门禁与回滚点

每次提交：

```text
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

最终额外验证：

- `lib/index.js`、`lib/client.js`、`lib/usage-worker.js`、CLI 和全部 declarations 存在；
- client bundle 仍通过 `window.__ModuleLoader__.load` 注册；
- pack/Git 安装产物实际包含 Worker/CLI，不依赖 prepublishOnly；
- Node engine/capability failure给出稳定错误，不全局屏蔽 ExperimentalWarning；
- link 安装后重启 DSH，首次初始化、刷新、翻页、退出/重启、dirty recovery、CLI owner 拒绝均 smoke；
- 面板打开时 trace/spy 证明没有 listSnapshots/readFrom；
- 删除临时测试 DSH_HOME，不触碰正式数据库。

回滚层级：

- Commit 1～8 未接入 root，逐提交可直接 revert。
- Commit 9 可整体 revert 到旧扫描路径；SQLite 保留。
- schema migration 前已有 backup；投影升级后降级必须用匹配版本 CLI restore，旧插件不得直接写较新库。
- shadow promotion 失败由 intent 自动收敛，禁止人工先删除“看起来多余”的候选文件。
