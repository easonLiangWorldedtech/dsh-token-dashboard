# 07 · UI 实现：侧边栏入口 + Token 面板 + 热力图

Type: task
Status: resolved
Blocked by: 01, 04, 05, 06, 10

## Question

按 01（注册机制）、05（视觉/交互决议，见其 Answer）实现 UI：侧边栏 Token 入口、专用面板、周/日热力图组件、i18n 中英双语文案。视觉基准 = 05 原型 Variant A（throwaway 分支 `prototype/05-heatmap`，commit 72d300b），须重写为生产代码。交付：面板在本地 web GUI 渲染真实数据。
## Answer

完成，commit `cf4a6be`。用户实测验收通过（「出现了」）。

**实现**（全部官方 slot，无 DOM 注入 hack）：
- `src/client/index.ts` — 注册 zh/en 词典（`ctx.locale.register`）、注入作用域样式表、`ctx.slots.inject` 声明感知注册两个 slot 条目；所有注册失败仅 log 不抛（外壳 boot 约定）。
- 侧边栏入口：`sidebar.footer.action`（id: token-dashboard, order 60），火焰图标 + 「Token」标签（窄栏仅图标）。
- 面板：`shell.overlay`（id: token-dashboard），Variant A 生产重写——统计行（今日/本周/近30天/全部）、周/日 tab、26 周热力图（月标签、周日历行、5 级色阶、悬停 tooltip：总量+输入输出拆分+请求数+缓存读附注）、「← 更早 / 更新 →」翻页、日视图（近30天柱状+明细行+缓存读附注）、图例。
- 数据策略（05 决议）：打开时加载 + 手动刷新；tz local/utc 存 localStorage（`dsh-token-dashboard.tz`）；Esc/✕ 关闭。
- i18n：NS `token-dashboard`，zh/en 双词典；深色主题随 `body[data-ds-dark-theme]` 纯 CSS 切换。

**构建**：lib/client.js 28KB，`__ModuleLoader__` 包装与参考插件逐字同构（react/react-dom 由 shell 模块加载器 require 提供）；typecheck/test/build 全绿。

**验收记录**：GUI 刷新后侧边栏 Token 入口出现、面板打开渲染真实数据。用户反馈「没有历史」经逐会话核对为真实状态（本机所有会话与 usage 均始于今日 2026-08-14），非缺陷。
