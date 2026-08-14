# dsh-token-dashboard · wayfinder map

## Destination

`@apodemakeles/dsh-token-dashboard` 达到 **npm 发布（首版 0.1.0 起，按 tag 迭代）**：一个用户可 `dsh plugin add` 安装的 DeepSeek Harness 插件，在 Web GUI 侧边栏提供 Token 入口与专用面板，以 GitHub 风格热力图展示全局**每日/每周 token 总消耗**；发布时创建公开 GitHub 仓库；界面中英双语；MIT 协议。地图携带实现：ticket 直接产出代码与发布物，不只是决策。

## Notes

- **域**：DeepSeek Harness (DSH) 插件开发。DSH 是 Cordis 插件系统；本插件属于 web profile 的 client-ui 插件家族。
- **锁定决策**（charting 阶段 grilling 产出，本 map 的 standing constraints）：
  - UI：侧边栏入口 + 专用面板（参考 aionui-panel 模式）。
  - 指标：**只显示 total tokens**（v1 不做 input/output/cache 明细、不做成本）。
  - 范围：**全局统计、无项目过滤**。
  - 分支/发布：极简 main + tag；手动 npm publish。
  - 仓库时机：先本地开发，发布前创建公开 GitHub 仓库 → tracker 用**本地 markdown**（.scratch/）。
  - npm 名：`@apodemakeles/dsh-token-dashboard`；协议 MIT；界面中英双语。
- **参考实现**：`@linxin666/dsh-client-ui-aionui-panel` v0.1.7（本机已安装，源码在 `~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel`）。
- **环境事实**：会话日志 `~/.dsh/sessions/<project>/<session-id>/session.jsonl.zstd`（JSONL+zstd，含逐请求 `usage` 事件：inputTokens/outputTokens/cacheReadTokens）；DSH checkout `/usr/local/lib/node_modules/@deepseek-ai/dsh`；安装命令 `dsh plugin add <pkg>`。
- **技能**：会话可用 `prototype`、`grilling`、`domain-modeling`、`research`。

## Decisions so far

<!-- 每行一个已关闭 ticket：gist + 链接；细节在 ticket 的 Answer 里 -->

- [01 · DSH client-ui 插件注册机制](issues/01-dsh-client-ui-plugin-api.md) — 单包双面 Cordis 插件（host 主导出 + ./client browser 半区）；侧边栏入口用 `sidebar.footer.action` slot（顶部条目需 DOM 注入）；面板走 `shell.overlay`；host 数据 API 用 `ctx.webServer.register`（`/api/token-dashboard/*`），client 同源 fetch/EventSource。
- [07 · UI 实现](issues/07-ui-implementation.md) — 官方 slot 双条目（sidebar.footer.action 入口 + shell.overlay 面板）；Variant A 生产重写（26 周热力图+翻页、日视图、tooltip、tz 偏好、刷新）；中英双语随 shell 语言；用户实测验收通过。
- [10 · 开发联调环境](issues/10-dev-loop.md) — 本地包 link 挂载进 web profile（bundle 自动 reconcile）；重启后插件加载、/api/token-dashboard/* 实测存活返回真实数据；docs/dev-loop.md 联调手册；client-bundle HMR 验证并入 07。
- [06 · 数据聚合服务实现](issues/06-aggregation-service.md) — sessionPersistence seam + revision/lastSeq 增量缓存；(turn,step) 后写覆盖 fold；DST 安全 local/utc 切日；total=input+output、cacheRead 独立桶；/api/token-dashboard/{summary,days}（26 周默认+offset 翻页）；20 测试全绿含本机全量会话日志交叉核对。
- [05 · 热力图面板的视觉与交互原型](issues/05-heatmap-prototype.md) — Variant A 胜出（周热力图 + 日视图两 tab）；默认 26 周可翻页；本地时区切日（UTC 选项已按用户评审删除）；total=input+output、cacheRead 仅 tooltip 附注；打开时加载+手动刷新（无轮询/SSE）。面板二次设计见 05 Revision。原型全集在 throwaway 分支 `prototype/05-heatmap`。
- [04 · 仓库脚手架](issues/04-repo-scaffold.md) — 首个 commit `2165e13`：main 分支、双半区骨架（host: webServer+sessionPersistence；client: slots+locale）、build=tsdown&&tsc -b（三个 tsdown 坑已记）、README 三件套 + blob hash 配对、冒烟测试通过、npm pack 16 文件齐全。
- [02 · 历史 token 消耗的数据源与聚合方案](issues/02-token-data-source.md) — 走 `ctx.sessionPersistence` seam（不选 sqlite/otel/手工 fs）；usage 在 assistant/chunk 与 assistant/message 各一次、按 (turn,step) 去重；total 推荐 input+output（不含 cacheRead，由 05 确认）；zstd 多帧须逐帧解；按浏览器时区切日；需 revision+lastSeq 增量缓存。
- [03 · 社区 DSH 插件的 npm 打包、发布与安装约定](issues/03-npm-packaging.md) — package.json 只需 dsh.bundle.patch + dsh.client 两个 DSH 专属字段；ESM 双半区包（host 主导出 + ./client browser 半区）；无需 dsh-client-ui-* 前缀；dsh plugin add 自动 reconcile、重启 dsh web 生效；首版 0.1.0、peer ^0.1.0-rc.6、cordis ^4.0.1、publishConfig public、README 三件套。

## Not yet specified

<!-- 雾区：能感觉到但还无法精确开 ticket 的问题；前沿推进后毕业为 ticket -->

- **官方生态收录**：发布后是否提交到 dsh-web-ui 插件全家桶 / 官方插件清单。

## Out of scope

<!-- 目的地之外的、有意识排除的工作；只在重画目的地时以新 effort 回归 -->

- 成本 ($) 换算与模型定价表。
- input/output/cacheRead 明细展示（用户决策：只 total tokens）。
- 按项目过滤、项目维度统计。
- 远程/多机数据聚合（仅本机数据）。
- 其他 AI 工具（zcode/codex 等）的历史用量导入——本插件只读本机 DSH 会话日志（07 验收中用户提出，明确排除；如需多工具聚合需重画目的地）。
- 并入 dsh-web-ui 全家桶仓库维护（独立仓库自维护）。