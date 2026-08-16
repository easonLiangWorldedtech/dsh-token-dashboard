# SQLite Worker 运行时与打包边界

> 调研日期：2026-08-16  
> 调研对象：`@apodemakeles/dsh-token-dashboard`、本机 DSH `0.1.0-rc.6`、Node.js `24.14.1`

## 结论

采用 **一个常驻 Node Worker + Worker 内 `node:sqlite` `DatabaseSync` + 单连接串行命令队列**。

- 宿主进程的 `session/event` 回调只合并小对象、保存未确认 fact，并通过 `postMessage()` 发送批次；不访问 SQLite，不等待落库。
- Worker 独占数据库连接，负责 schema/migration、批量 UPSERT、checkpoint/run 标记、初始化导入和 snapshot 查询。
- 使用 `journal_mode=WAL`、`synchronous=FULL`、`busy_timeout=5000`。每批 fact 与对应 checkpoint 必须处于同一事务。
- `snapshot` 命令先强制提交 Worker 内待写批次，再在同一连接的读事务内完成所有汇总查询，从而返回一个一致时间点的数据。
- Worker 作为 tsdown 的第二个 Node entry 构建成 `lib/usage-worker.js`；宿主以 `new URL('./usage-worker.js', import.meta.url)` 加载。worker 文件不需要成为 package export，但必须进入发布 tarball，并继续提交到 Git，以支持当前 GitHub 安装方式。
- 不引入 `better-sqlite3` 或 `sqlite3`。当前 DSH 自己已经用 `node:sqlite` 实现 `@deepseek-ai/dsh-session-query-sqlite`，增量运行风险明显低于额外引入原生 addon。

`node:sqlite` 在本机 Node 24.14.1 仍会发出一次 `ExperimentalWarning`；这不阻塞本方案，但必须声明 Node engine、做启动能力检查，并把 SQLite 实现隔离在 Worker 协议之后。不要全局关闭 Node warning。

## 1. 已验证的运行时事实

### 1.1 当前插件的构建与分发形态

当前 host bundle 只有 `src/index.ts -> lib/index.js` 一个 Node entry；client 是另一个浏览器 bundle。[仓库 `tsdown.config.ts`](../../../tsdown.config.ts) 第 28–69 行。package 是 ESM，host main 为 `lib/index.js`；`files` 已包含 `lib/**/*.js` 和 sourcemap，所以新增的 `lib/usage-worker.js` 会自然进入 npm tarball。[仓库 `package.json`](../../../package.json) 第 5–18、68–78 行。

有一个必须显式处理的 Git 安装差异：当前只有 `prepublishOnly: pnpm build`，而 npm 官方说明 `prepublishOnly` **只在 `npm publish` 执行**；Git dependency 若要现场构建需要 `prepare`/`prepack`。[npm lifecycle 文档](https://docs.npmjs.com/cli/using-npm/scripts/)。当前 profile 实际安装的是 GitHub commit tarball，因此不能指望安装阶段生成 worker；沿用仓库现状，应把构建后的 `lib/usage-worker.js` 提交进 Git，并在发版检查中验证它存在。

### 1.2 DSH 与 Node 能力

本机：

```text
dsh --version       0.1.0-rc.6
node --version      v24.14.1
process.versions.sqlite  3.51.2
```

在这个运行时上已做只读隔离探针：Worker 中成功导入 `node:sqlite`，启用 WAL，在一个事务中插入 1000 行并读回 `count=1000`；唯一额外输出是一次 `ExperimentalWarning`。

更重要的是，DSH 自己已经采用同一能力：本机安装的 `@deepseek-ai/dsh-session-query-sqlite/lib/index.js` 第 40–68 行动态导入 `node:sqlite`、创建 `DatabaseSync` 并设置 journal mode；其默认配置在第 1076 行是 `wal`。该服务还将所有操作串行化，并在关闭时等待尾部任务后关闭连接（第 581–603、619–640 行）。这说明 `node:sqlite + WAL + 串行 ownership` 是当前 DSH 的一等实现路径，不是插件自造的异构运行时。

Node 官方文档显示：`node:sqlite` 从 22.5 加入，22.13 起无需实验 flag；`DatabaseSync.timeout` 在 22.16 加入。当前最新 Node 24 文档从 24.15 起将其标为 Stability 1.2（release candidate），但 24.14 仍会发 warning。[Node SQLite v22 文档](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html)、[Node SQLite v24 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。

### 1.3 DSH 已有 Worker 的打包先例

本机 `@deepseek-ai/dsh-workflow-worker-thread` 发布包把 `lib/worker.cjs` 明确列入 `files`，built 模式用 `new URL('./worker.cjs', import.meta.url)` 定位，并传入空 `execArgv`；见其 `package.json` 第 13–36 行、`lib/index.js` 第 220–248 行。`@deepseek-ai/dsh-code-runtime-worker-thread` 也使用同样的 sibling worker asset 方式。

因此本插件应复制“独立 entry + 相对 `import.meta.url` 定位”的边界，不应使用：

- 运行时 TS 文件和 tsx loader；
- `eval: true` 内嵌整段 worker；
- 基于 `process.cwd()` 的路径；
- 把 worker 代码塞回 host bundle 后再猜测 chunk 文件名。

## 2. 推荐运行时拓扑

```text
DSH host / Cordis fiber
  session/event
      │  O(1) 字段提取与按 (session, turn, step) 合并
      ▼
  UsageWorkerClient
      ├─ unackedByKey（仅保留尚未 commit-ack 的 fact）
      ├─ RPC pending map（snapshot / drain / health）
      └─ postMessage(batch)
              ▼
      persistent usage worker
          ├─ DatabaseSync（唯一 owner）
          ├─ prepared statements
          ├─ pending batch / timer
          └─ command serializer
                  ▼
          $DSH_HOME/data/token-dashboard/usage.sqlite
```

### 为什么是一个 Worker，而不是“主线程 async SQLite”

`DatabaseSync` 的全部 API 都是同步 API。[Node SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#class-databasesync)。把它直接放在 host，即使接口包装成 Promise，prepare/step/commit/checkpoint 仍会阻塞 DSH 事件循环。放入 Worker 后，磁盘同步和 SQL 聚合只阻塞该 Worker。

一个常驻 Worker 足够：usage 写入量低，SQLite 本来也只允许一个 writer；Node 官方也提示反复创建 Worker 的启动开销不值得，应复用 worker。[Node worker_threads 文档](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html)。

### 为什么不拆成读、写两个 Worker

首版不需要并行连接：

- 同一 Worker 的 `snapshot` 在查询前强制 flush，因此天然 read-your-writes。
- 每次事务只有几十到几百个小 UPSERT，串行等待很短。
- 第二连接会引入 busy、checkpoint starvation、关闭顺序与快照时间点协调，却不会改善对话速度；对话线程本来已经与数据库隔离。

WAL 仍然保留。SQLite 官方说明 WAL 允许 reader 与 writer 并行，但同一时刻仍只有一个 writer；它还提供 snapshot isolation。[SQLite WAL](https://www.sqlite.org/wal.html)、[SQLite isolation](https://www.sqlite.org/isolation.html)。这里 WAL 首先用于可靠、顺序的追加提交并与 DSH 默认保持一致；未来若增加诊断只读连接，也无需迁移 journal mode。

## 3. Worker 消息协议

建议只传 plain data，不传 class、函数或数据库对象。Node 的 `postMessage` 使用 structured clone。[Node MessagePort 文档](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html#portpostmessagevalue-transferlist)。

```ts
type HostToWorker =
  | { type: 'boot'; id: number; dbPath: string; runId: string }
  | { type: 'ingest'; batchId: number; facts: UsageFactInput[] }
  | { type: 'snapshot'; id: number; query: SnapshotQuery }
  | { type: 'drain'; id: number; runId: string }

type WorkerToHost =
  | { type: 'ready'; id: number; schemaVersion: number }
  | { type: 'committed'; batchId: number; keys: UsageFactKey[] }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'failure'; id?: number; batchId?: number; error: SerializedFailure }
```

协议要求：

1. `ready` 只能在数据库打开、PRAGMA 和 migration 全部成功后发送。
2. `committed` 只能在 fact 与 checkpoint 的事务完成后发送；宿主收到后才从 `unackedByKey` 删除对应值。
3. 同一 key 在未确认期间出现更新，宿主保留新版本。旧 batch 的 ack 不得误删后来版本，因此每项需带 host generation/version，或 ack 精确 `batchId + version`。
4. `snapshot` 进入 Worker 后先 flush 所有已接收 fact，再在一个显式读事务内跑 summary、days、by-provider/model 查询，返回 `asOf`。
5. Error 序列化为 `{ code, message, retryable }`，不要依赖跨线程 Error 子类和自定义字段。

## 4. 批量写入与事务

### 推荐参数

- Worker 刷新：`250 ms` 或 `128` 个唯一 fact，任一先到即提交。
- `turn/end`：只发送 flush hint，不 await。
- `snapshot` / `drain`：强制立即 flush。
- 首次初始化：以例如 `500` facts 为一个 bulk batch，避免把全部历史同时放进 host/worker 内存。

这些值是初始保护线，不是统计语义；应做成内部常量并用指标观察 queue depth、batch size、commit latency 后调整。

### 事务形态

```sql
BEGIN IMMEDIATE;
-- prepared UPSERT usage_fact ...
-- prepared UPSERT usage_checkpoint ...
COMMIT;
```

任何异常都显式 `ROLLBACK`。SQLite 官方说明 `BEGIN IMMEDIATE` 会立即取得写事务，在另一个 writer 存在时可能返回 `SQLITE_BUSY`。[SQLite transaction](https://www.sqlite.org/lang_transaction.html)。本设计只有一个 owner，正常情况下不会竞争；`timeout: 5000`/`busy_timeout` 仍用于用户临时诊断连接、杀毒软件或未来只读连接的短时冲突。

prepared statement 在 Worker 启动时编译并复用。chunk usage 与最终 message usage 可以多次发送，但同一 `(session_id, turn, step)` 最终只做幂等 UPSERT；worker pending map 也先按该 key 合并，最终 message 覆盖早期 chunk。

### PRAGMA 决策

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
```

并在构造 `DatabaseSync` 时设 `timeout: 5000`、禁止 extension。

选择 `FULL` 而不是常见的 `NORMAL`，原因不是防止 SQLite corruption，而是保护本设计的 **clean-shutdown/run marker 与 checkpoint 语义**。SQLite 官方说明 WAL+NORMAL 对应用进程崩溃仍安全，但断电或 OS crash 可能回滚已经返回成功的事务；WAL+FULL 才是 ACID。[SQLite PRAGMA synchronous](https://www.sqlite.org/pragma.html#pragma_synchronous)。若 run-start 事务在断电后消失，下一次启动可能错误地把更早的一次 clean run 当成“上次运行”，破坏异常恢复判定。写入已经在 Worker 中且按批 amortize，因此 FULL 的 fsync 不会进入对话事件循环。

保持 SQLite 默认 WAL autocheckpoint（1000 pages）即可。不要在每批后 checkpoint，也不要在正常运行中自动 VACUUM；偶发 checkpoint 只会暂停 Worker。关闭连接通常会收束 WAL；无需把 `wal_checkpoint(TRUNCATE)` 设为 clean-shutdown 成功的必要条件。

## 5. 一致 snapshot 与读写关系

单一 `/snapshot` API 对应单个 Worker RPC：

1. command serializer 让它排在此前收到的 ingest 后面；
2. force-flush Worker 内 pending facts；
3. `BEGIN` 只读事务；
4. 执行 summary、日桶、`GROUP BY provider, model` 等全部查询；
5. `COMMIT`，返回同一 `asOf` 和初始化/恢复状态。

这比 host 上另开 read connection 更简单：不会出现“summary 已见新批次，days 尚未见”的撕裂，也不会让同步 SQL 回到 DSH 主线程。若初始化仍在进行，结果可以是 partial，但 `state/progress/asOf` 必须来自同一 Worker 状态。

## 6. 关闭、异常退出与 Worker 故障

### Cordis 优雅关闭

本机 `@deepseek-ai/cordis/src/fiber.ts` 第 70–93 行明确允许 async disposer，第 675–682 行会 await disposer。因此插件应用时应注册一个拥有 listener 与 Worker 的 effect，并在 disposer 中执行：

1. 先取消 `session/event` 订阅，停止接收新事实；
2. 向 Worker 发 `drain`；
3. Worker force-flush，在成功事务中把本 run 标记 clean；
4. Worker 关闭 `DatabaseSync`，回复成功并自然退出；
5. host 等待回复及 `'exit'`。

不要先调用 `worker.terminate()`。Node 官方说明 terminate 会尽快停止执行，可能停在 SQLite 操作中间；它仅用于 drain 超时后的最后手段，并且返回 Promise。[Node Worker terminate](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html#workerterminate)。若超时或关闭失败，**不得**标记 clean，直接终止后让下一次启动走已决定的异常尾部恢复。

不要调用 `worker.unref()`：它可能在 Worker 是最后一个活动 handle 时允许进程在 flush 前退出。让 Cordis disposer 明确完成生命周期。

### Worker 自身故障

宿主必须监听 `'error'`、`'messageerror'`、`'exit'`。Node 官方保证 uncaught exception 会触发 error 并终止 Worker，exit 是最终事件，且 worker 发出的消息先于 exit。[Node Worker events](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html#event-error)。

故障策略：

- 立即 reject 所有 pending snapshot/drain RPC，面板状态改为 `error`/`degraded`，不得返回旧数据冒充 ready。
- `unackedByKey` 保留在 host，实时事件继续进入有上限的 map，因此 Worker 单独崩溃不会立即丢 fact，也不会阻塞对话。
- 对可重试错误执行有限重启（建议最多 3 次，指数退避）；新 Worker `ready` 后重发未确认最新版本。
- schema 不兼容、数据库 application id 不匹配、迁移失败、持续 `SQLITE_CORRUPT` 属于不可重试错误，停止循环并暴露可诊断错误。不要静默删除数据库。
- bounded map 达到上限时进入明确 degraded 状态并记录计数；不要无限吃内存。全进程崩溃的事实恢复由已决定的 abnormal-run + session tail 恢复协议负责。

## 7. 构建与发布设计

### tsdown

将 host config 改为两个命名 entry（示意）：

```ts
{
  entry: {
    index: 'src/index.ts',
    'usage-worker': 'src/host/usage-worker.ts',
  },
  format: ['esm'],
  platform: 'node',
  fixedExtension: false,
  outDir: 'lib',
  // 其余保持现状
}
```

tsdown 官方支持 multiple entry，并可通过 entry name 固定独立输出。[tsdown entry](https://tsdown.dev/options/entry)、[tsdown output format](https://tsdown.dev/options/output-format)。宿主加载：

```ts
new Worker(new URL('./usage-worker.js', import.meta.url), {
  name: 'dsh-token-usage',
  execArgv: [],
})
```

`.js` 在 package `type: module` 下按 ESM 解释。`execArgv: []` 避免继承用户的 preload/loader；Node 官方提醒 Worker 默认会继承 host 的 `execArgv`，DSH 自己的 Worker 也主动清空它。[Node Worker notes](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html#launching-worker-threads-from-preload-scripts)。

不要依赖 `type: 'module'` 这个浏览器 Worker option；Node 根据文件扩展名和 package type 判定。

### package.json

建议：

```json
{
  "engines": { "node": "^22.19.0 || >=24.0.0" }
}
```

这个范围覆盖 `DatabaseSync.timeout`（22.16+），也与本机 DSH 社区包常见的 Node 范围一致。运行时仍做能力检查：Worker boot 时若 `import('node:sqlite')` 失败，返回明确的 `SQLITE_RUNTIME_UNAVAILABLE`。

现有 `files: ["lib/**/*.js", ...]` 已覆盖 worker；不必增加 `exports["./usage-worker"]`，相对 URL 不通过 export map。发布验收必须同时检查：

```text
lib/index.js
lib/usage-worker.js
lib/client.js
```

并运行 `npm pack --dry-run`/检查 tarball 清单；npm 官方建议用它确认发布内容。[npm publish files](https://docs.npmjs.com/cli/publish/#files-included-in-package)。对于 GitHub-first 安装，还必须确认 `git ls-files lib/usage-worker.js` 有结果，因为当前没有 `prepare`。

### 数据路径

Worker 只接收宿主解析好的绝对路径，不自行读取 cwd。默认路径建议由宿主使用 DSH 的 home-path helper 解析为：

```text
$DSH_HOME/data/token-dashboard/usage.sqlite
```

本机 `@deepseek-ai/dsh-home-paths` 明确规定优先级为显式配置、`DSH_HOME`、`~/.dsh`，且所有用户数据位于同一 root（`lib/index.js` 第 63–83 行）。若实现时直接 import 该 helper，必须把 `@deepseek-ai/dsh-home-paths` 声明为 peer/dev dependency，不能依赖 pnpm 的偶然传递依赖可见性。

## 8. `node:sqlite` 的实验状态是否构成否决

不构成，理由按强度排序：

1. 当前 DSH 自身已在正式 package 中使用 `node:sqlite`，而且是同样的 `DatabaseSync + journal mode + serialized operations`。
2. 本机 DSH 的 Node 24.14.1 已通过 Worker/WAL/transaction 探针；无需 `--experimental-sqlite`。
3. 本方案只使用从 22.5 就存在的最小 API：constructor、`exec`、`prepare/get/all/run`、`close`，不依赖近期新增的 session/backup/extension 功能。
4. SQLite 调用完全封在 Worker 协议后；若未来 Node API 有破坏性变化，替换 driver 不影响事件采集、HTTP API 或 UI。

仍需接受一个可见差异：Node 24.14.1 会打印一次 ExperimentalWarning。首版建议保留，不设置全局 `NODE_NO_WARNINGS`。若产品明确要求静默，只能在该专用 Worker 的 `execArgv` 中精确设置 `--disable-warning=ExperimentalWarning`，并在兼容性测试中覆盖；不要污染 DSH host 的 warning 策略。[Node `--disable-warning`](https://nodejs.org/dist/latest/docs/api/cli.html#--disable-warningcode-or-type)。

## 9. 备选方案

| 方案 | 优点 | 代价/风险 | 结论 |
|---|---|---|---|
| `node:sqlite` + 常驻 Worker | 零 npm/native 依赖；与当前 DSH 一致；跨平台随 Node；打包简单 | 当前 24.14 有实验 warning；同步 API 必须隔离 | **采用** |
| `better-sqlite3` + Worker | API 成熟、性能好 | 原生 addon；当前 registry 包约 27.3 MB unpacked、要求 Node >=22，带多平台 native artifact；增加安装/ABI/脚本风险 | 仅在 Node core SQLite 出现实质兼容问题时切换 |
| `sqlite3` npm addon | callback/async API | 仍是原生安装；prebuilt 覆盖之外需 node-gyp；API 与类型更复杂 | 不采用 |
| host 主线程 `DatabaseSync` | 最少代码 | 同步 SQL、fsync、checkpoint 会阻塞 DSH event loop | 不采用 |
| 读写双 Worker/双连接 | 真正读写并发 | 一致性、busy、checkpoint 和关停显著复杂；当前量级无收益 | 首版不采用 |

`better-sqlite3` 当前 npm registry 元数据为 13.0.3、`engines.node >=22`、unpacked size 27,302,969 bytes，并包含平台专用 exports。[npm registry primary metadata](https://registry.npmjs.org/better-sqlite3/latest)。`sqlite3` 官方 npm 页面也说明 unsupported platform 会回退到 node-gyp 编译。[sqlite3 npm](https://www.npmjs.com/package/sqlite3)。

## 10. 实现验收清单

1. `session/event` 回调测试证明不调用任何 DB API、不 await Worker RPC。
2. batch commit 测试证明 usage facts 与 per-session checkpoint 同事务；注入中途异常后两者均不前进。
3. chunk/message 同 key 的 late update + old ack 测试证明不会删除更新版本。
4. snapshot 测试证明先 flush，并且 summary/days/byModel 使用同一 read transaction/asOf。
5. Worker crash 测试证明 pending RPC reject、unacked facts 保留、重启后重发且不重复计数。
6. graceful drain 测试证明只有 flush、clean marker、close 全成功才回报 clean；超时 terminate 后仍为 unclean。
7. Node 22.19 和当前 Node 24 上跑 Worker + WAL + FULL + transaction 集成测试。
8. build 后验证 `new URL('./usage-worker.js', import.meta.url)` 可从安装包路径启动。
9. `npm pack --dry-run` 和实际 tarball 均包含 worker；Git 安装 commit 也包含 `lib/usage-worker.js`。
10. 主线程延迟基准只测事件字段提取、map 更新和 postMessage；SQLite commit/初始化扫描不得出现在主线程 profile 中。

## Sources

- [Node.js SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Node.js Worker Threads API](https://nodejs.org/download/release/v24.16.0/docs/api/worker_threads.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite transaction](https://www.sqlite.org/lang_transaction.html)
- [SQLite PRAGMA](https://www.sqlite.org/pragma.html)
- [tsdown entry](https://tsdown.dev/options/entry)
- [npm lifecycle scripts](https://docs.npmjs.com/cli/using-npm/scripts/)
- [npm package files](https://docs.npmjs.com/files/package.json/#files)
- 本机一手实现：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-query-sqlite/lib/index.js`
- 本机一手实现：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-workflow-worker-thread/lib/index.js`
- 本机一手实现：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts`
