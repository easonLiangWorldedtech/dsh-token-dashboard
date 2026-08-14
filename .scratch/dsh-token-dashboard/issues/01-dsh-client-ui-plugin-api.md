# 01 · DSH client-ui 插件注册机制：侧边栏入口、专用面板与 host 数据路由

Type: research
Status: resolved
Blocked by: —

## Question

一个社区插件如何在 DSH Web GUI 中注册侧边栏入口、打开专用面板/视图，并提供 host 侧数据 API 路由？产出：注册机制说明 + 最小可复用模式 + 对 `@apodemakeles/dsh-token-dashboard` 架构的具体建议（单包 or 双包、需要实现哪些服务/slot、dev/HMR 工作流）。

## Context

- 参考实现源码：`/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel`（npm 发布版，含 host 路由 `/aionui-panel/*` 与侧边栏面板注册）。
- DSH 自身 client-ui 包（profile node_modules 与 harness checkout 内）：`dsh-client-ui-sidebar`、`dsh-client-ui-slots`、`dsh-client-web`、`dsh-client-web-react`、`dsh-client-modules`、`dsh-host-frontend-static`、`dsh-client-hmr`。
- 只读调查，不安装、不修改 profile 与 ~/.dsh。
## Answer

结论（详见 [research/01-dsh-client-ui-plugin-api.md](../research/01-dsh-client-ui-plugin-api.md)，300 行逐条附源码路径）：

1. **插件形态 = 单包双面 Cordis 插件**：`exports["."]` 跑 host 进程、`exports["./client"]` 跑浏览器；两半区各 `export inject` + `export function apply`。由 `dsh.bundle.patch` + `dsh.client({inject, platform:"web"})` 声明，bundle 由 `dsh-client-modules` 提供在 `/plugins/<cordis-id>/client.js`。
2. **侧边栏入口**：无「顶部导航条目」官方 slot；可注册座 = `sidebar.footer.action`(list) 与 `shell.overlay`(list)。顶部条目（如 ssh）是 DOM 注入 + MutationObserver 自愈；slot 注册用 `ctx.slots.register` + `ctx.slots.inject`（等声明）。
3. **面板无 URL 路由**：走已声明 slot（owner 渲染）或 DOM 注入 `[data-dsh-frame]` / `[data-pane="conversation"]`。
4. **host 数据 API**：`ctx.webServer.register({kind:'exact'|'prefix', path, handler})`（服务 `webServer`，来自 `dsh-host-webserver`）；WS 用 `registerUpgrade`、SSE 直接写 `text/event-stream`；client 同源 `fetch` / `EventSource`。
5. **对本插件的架构建议（采纳）**：**单包（双面）**。host 半区：`webServer` 注册 `/api/token-dashboard/*`（读 `~/.dsh/sessions/*.jsonl.zstd` 聚合）+ 可选 `systemPrompt` 公告；client 半区：`slots` + `locale` + `sessions`，面板走 `shell.overlay`（或右栏 DOM 注入），入口走 `sidebar.footer.action` slot。
