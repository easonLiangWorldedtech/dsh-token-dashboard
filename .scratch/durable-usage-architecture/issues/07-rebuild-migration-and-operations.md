# 重建、迁移与运维边界

Type: grilling
Status: resolved
Blocked by: 03, 04, 05

## Question

首版从内存聚合切换到本地库时如何发布；数据库缺失、损坏、schema 升级、会话日志缩短或身份变化时如何检测、重建、回滚和告警，同时保持「日常启动不扫全量」的边界？

## Answer

### 1. 首版发布与回滚

首个持久化版本是一个原子包切换：host、client、`lib/usage-worker.js`、Snapshot API 与共享类型同时发布。首次启动：

1. 新库不存在时先建立 run/实时 listener；
2. 后台执行票据 05 的一次初始化；
3. 面板读取新 snapshot，初始化期间显示部分结果和进度；
4. 删除旧 TokenAggregator 与打开面板时扫描 summary/days 的路径。

不保留 fallback，也不导入旧内存缓存；两套统计并存会重新引入双口径和面板扫描。回滚到持久化版本之前的旧插件时，旧代码忽略 SQLite 并恢复旧扫描，数据库文件原样保留；再次升级可继续或按版本矩阵处理。

发布物必须同时包含 host、client、worker、CLI 和类型声明。GitHub commit 安装不能依赖 prepublishOnly 现场生成 worker，验收必须解包实际 Git/npm artifact 验证 sibling entry 存在。

### 2. 路径、权限和单 owner

固定根：

```text
$DSH_HOME/data/token-dashboard/
  usage-v1.sqlite
```

`DSH_HOME` 走 DSH 共享解析规则：显式环境，否则 `~/.dsh`。目录 owner-only 0700，数据库、intent、backup owner-only 0600；首版不接受浏览器或配置传入任意路径。

一个 DSH Home 同时只允许一个 Worker/maintenance CLI 写 owner。Worker 打开后设置 SQLite exclusive locking mode 并执行所有权探针；第二个 web 进程必须失败为 `database_in_use`，不能依靠 WAL 让两套 run epoch/collector 同时写。采用 SQLite/OS 生命周期锁，不能以一个硬崩溃后需人工删除的普通 `.lock` 文件作为唯一真相。

CLI 写命令复用同一所有权协议；DSH 运行时拒绝 verify/rebuild/restore/cleanup。host HMR 不支持重叠 owner，host 修改继续要求重启 DSH。

### 3. 数据库身份与正常启动探针

数据库设置：

```sql
PRAGMA application_id = 0x44544F4B; -- ASCII DTOK
PRAGMA user_version = <schema version>;
```

正常启动只读取 application_id、user_version、projection_version、projection_state 和最后 run epoch；不执行每次全库 `integrity_check`，也不扫描 JSONL。application_id 不匹配属于 `foreign_database`，不得迁移、隔离或自动重建。

完整性检测分层：

- 新库/shadow 晋升前执行 `quick_check`，并验证 schema、版本、ready state；
- 收到明确 `SQLITE_CORRUPT`/`SQLITE_NOTADB`/结构不变量破坏后，停止写入并执行诊断校验确认；
- CLI `verify` 显式执行 quick_check，并允许用户选择较慢的 full integrity_check；
- 权限、只读文件系统、磁盘满、BUSY、临时 IOERR 不归类为 corruption。

### 4. 自动处理矩阵

| 条件 | 动作 | 是否扫全历史 |
|---|---|---:|
| canonical 不存在且无未完成 intent | 创建新库、首次初始化 | 是，一次 |
| schema 较旧且有显式兼容 migration | 备份后事务迁移 | 否 |
| projection_version 语义不兼容 | shadow rebuild | 是 |
| 已确认 SQLite corruption | 隔离原 DB/WAL/SHM 后 shadow rebuild | 是 |
| 数据库版本比插件新 | `database_too_new`，拒绝写入 | 否 |
| application_id 不匹配 | `foreign_database`，拒绝处理 | 否 |
| 权限/磁盘/路径/临时 I/O | error/retry 指引，不重建 | 否 |
| 单个 JSONL 损坏 | 隔离该生命周期，整体 degraded | 否 |
| 同一生命周期 revision 变化且锚点缺失 | 票据 04 单会话重建 | 仅该会话 |
| snapshot 中会话消失 | 保留永久 facts | 否 |

日常 ready 启动只处理实时事件。初始化 incomplete 只续未完成生命周期；异常 run 只恢复 revision 候选；上述三种路径之外不得隐式全扫。

### 5. schema migration

每个支持的 schema 版本必须有单步、不可跳号的 migration 和 fixture 测试。启动 migration 前：

1. 确认 application_id 与 projection_version 兼容；
2. checkpoint/关闭 WAL 写活动，在同目录创建不可覆盖的时间戳 backup；
3. `BEGIN IMMEDIATE` 执行 DDL/数据变换；
4. 验证结构不变量，最后设置 user_version；
5. COMMIT 后 quick_check，失败则停止并保留 backup，不继续启动 collector。

事务内失败必须 ROLLBACK。禁止 `DROP-and-recreate` 冒充 schema migration；需要重新解释 JSONL 的改变必须提升 projection_version 并走 shadow rebuild。插件不执行 downgrade。

### 6. shadow rebuild 与实时交接

同目录文件集：

```text
usage-v1.sqlite
usage-v1.rebuild-<uuid>.sqlite
usage-v1.backup-<timestamp>.sqlite
usage-v1.corrupt-<timestamp>.sqlite
rebuild-intent.json
```

intent 通过 owner-only 临时文件、fsync、原子 rename 和目录 sync 发布；内容只允许经过 basename/UUID/schema 校验的相对文件名，拒绝绝对路径和 `..`。

流程：

1. 保持 canonical 不动，写 intent 并创建唯一 shadow；
2. shadow 复用票据 05 初始化与票据 04 live queue，成为重建期间 snapshot 的数据源；旧语义统计不再展示；
3. shadow ready 后强制 drain，执行 WAL checkpoint，关闭连接，验证 application/schema/projection/ready/quick_check；
4. 更新 intent 为 promotion；把 canonical 及其 WAL/SHM 作为一个集合隔离为 backup，再把已收束的 shadow 改名为 canonical，每步同步目录；
5. 重开 canonical 并验证，再删除 intent；旧 backup 保留。

promotion 任一步崩溃后，启动 recovery 只做确定性选择：

- canonical 已是目标 ready generation：完成并清理 intent；
- shadow 是唯一验证通过的目标：继续晋升；
- shadow 无效而 backup 是唯一验证通过的原库：恢复 backup；
- 多个候选都无法唯一证明：进入 `maintenance_required`，不得按时间戳猜测或删除文件。

腐败原库连同 WAL/SHM 只改名隔离，不尝试在线覆盖。首版不自动删除 backup/corrupt 文件，避免把唯一回滚/诊断副本当垃圾清理。

### 7. 运维 CLI

随包提供本机 bin：

```text
dsh-token-dashboard status
dsh-token-dashboard verify [--full]
dsh-token-dashboard rebuild
dsh-token-dashboard backups
dsh-token-dashboard restore <exact-backup-basename>
dsh-token-dashboard cleanup <exact-backup-basename>
```

- status 只显示路径的安全缩写、版本、phase、进度、稳定错误码、intent 与备份列表，不读取/输出会话正文。
- verify/rebuild/restore/cleanup 必须取得独占 owner；数据库正在使用时拒绝。
- rebuild 只写 durable intent；下次插件启动执行 shadow rebuild，不在 CLI 中另造一套 projector。
- restore 不覆盖当前 canonical：先把当前库改名为新的 pre-restore backup，再验证并晋升指定 backup。
- restore/cleanup 必须指定严格 basename、展示 resolved exact file、要求交互式二次确认；非 TTY 默认拒绝，自动化需显式 `--yes` 与完全限定 basename。
- 目录、glob、符号链接逃逸、自动“最新备份”选择一律拒绝。

不提供浏览器 mutation endpoint。面板只能显示状态、错误码和运行 CLI 的指导，不具备重建/删除按钮。

### 8. 告警、诊断与空间

host 日志使用稳定 code 和结构化上下文记录 migration、rebuild、recovery、retry、degraded/error；不得记录 Token 事件正文。snapshot 只暴露已确认的安全摘要。首版不增加外部遥测或后台上传。

status 至少报告 canonical/shadow/backup 文件大小、WAL 大小、fact/lifecycle/error 数、最后 commit、phase 和 queue lag，便于判断磁盘增长。普通运行不自动 VACUUM、不按年龄删除 facts、不自动清理备份。用户通过 CLI 精确清理，操作前后都记录本地审计日志。

README/README.zh 必须修正当前过时的总量说明：实现和已确认合同是 `input + output + cacheRead`，并加入数据库路径、首次初始化、状态含义、备份与恢复 runbook。
