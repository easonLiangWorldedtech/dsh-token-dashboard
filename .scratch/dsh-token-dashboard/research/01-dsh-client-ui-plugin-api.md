# 01 · DSH client-ui 插件 API：侧边栏入口、面板视图与 host 数据路由

> research 结论（ticket 01）。只读调查，证据全部来自本机源码（社区已发布插件 + DSH harness checkout），逐条附源文件路径。

## TL;DR（结论）

1. **社区插件是「双面 Cordis 插件」（单 npm 包、两个入口）**：`exports["."]` 跑在 Node 宿主进程（host 半区：数据服务 + HTTP 路由），`exports["./client"]` 跑在浏览器 Web GUI（client 半区：React UI）。两半区各自用 Cordis 的 `inject`（服务名数组）+ `apply(ctx)` 契约挂载。
2. **侧边栏入口有两条路**：官方 slot 只有「脚部动作」`sidebar.footer.action`（list）与浮层 `shell.overlay`（list）；**没有「顶部导航条目」的官方 slot**。SSH / task-board 的顶部条目是 **DOM 注入 + MutationObserver 自愈** 实现的。
3. **面板/视图无 URL 路由**——SPA 单页。挂载方式两种：① 注册进已声明的 slot（由 owner 的 `renderSlot` 渲染）；② DOM 注入到 shell 的既有网格（`[data-dsh-frame]` 三轨 grid、`[data-pane="conversation"]` 等）+ MutationObserver 自愈。
4. **host 数据 API = `ctx.webServer.register({kind:"exact"|"prefix", path, handler})`**（服务 `webServer` 来自 `@deepseek-ai/dsh-host-webserver`）；WebSocket 用 `registerUpgrade`；SSE 直接在 handler 里写 `text/event-stream`。
5. **客户端调用 host API**：同源相对 `fetch("/xxx", {method:"POST", headers:{"content-type":"application/json"}, body})` + JSON 信封；SSE 用 `EventSource`；页面与路由共用同一 webserver，无跨域。
6. **最小插件契约**：`package.json` 的 `dsh.bundle.patch` + `dsh.client` 字段 + `cordis.patch.yml`（`- insert: - {id, name}`）+ 两半区各 `export const inject` / `export function apply`。
7. **HMR**：`dsh-client-hmr` 在浏览器订阅 SSE `/plugins/events`，Node 侧 stat-poll 构建产物；`tsdown --watch` 重打包即触发重载；client bundle 由 `dsh-client-modules` 提供在 `/plugins/<cordis-id>/client.js`。
8. **架构建议：单包（双面）**，与 aionui-panel / dsh-ssh 完全一致。实现 `webServer`（host 路由）+ `systemPrompt`（公告）+ `slots`/`locale`/`sessions`（client UI），面板走「右栏 DOM 注入（aionui-panel 模式）或 `shell.overlay` slot」+「`sidebar.footer.action` slot 或 DOM 顶部条目」切换。

---

## 1. 双面插件（dual-face plugin）总览

DSH Web GUI 插件是一个 npm 包承载**两个 Cordis 插件体**。参考实现 `@linxin666/dsh-client-ui-aionui-panel` v0.1.7：

- `package.json` 的 `exports`：`"."` → host 半区（`lib/index.js`），`"./client"` → browser 半区（`lib/client.js`），另暴露 `"./package.json"` 与 `"./src/*"`。
- `package.json` 的 `dsh` 字段：
  - `dsh.bundle.patch`：指向 `cordis.patch.yml`（把插件行插入 profile roster）。
  - `dsh.client`：`{ inject: [...], platform: "web" }`，声明 browser 半区依赖的其它 client 包 + 平台。

源：`/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel/package.json`

`cordis.patch.yml` 内容（aionui-panel）——一行「裸插件，按包名」：

```yaml
- insert:
    - id: ui-dsh-aionui-panel
      name: '@linxin666/dsh-client-ui-aionui-panel'
```

注释原文明确：node 半区（`exports "."`）跑在宿主进程，`dsh.client` 声明让 browser 半区（`exports "./client"`）在 `/plugins/ui-dsh-aionui-panel/client.js` 提供、加载进 Web GUI。源：同目录 `cordis.patch.yml`。

**装载链**（web profile）：

- profile 根 `package.json` 的 `dsh.profile.bundles` 列出 bundle 包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@linxin666/dsh-web-ui-all`）。
- `cordis.yml` 是空 `[]`，注释写明「树由 patch 组合：先每个 bundle 的 patch，再 `cordis.patch.yml`，再 `--patch` overlay；改 `cordis.patch.yml` 而非本文件」。
- `@linxin666/dsh-web-ui-all` 的 `cordis.patch.yml` 是聚合：把 aionui-panel、task-board、git-graph、pet、ssh 等每个子插件各插一行（`- insert: - {id, name}`）。

源：`/Users/caozheng/.dsh/profiles/web/{package.json,cordis.yml,cordis.patch.yml}`；`/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-web-ui-all/{package.json,cordis.patch.yml}`

> 安装：`dsh plugin --profile web add <pkg-or-link>`；安装后**重启 `dsh web`**（aionui-panel README）。

---

## 2. 侧边栏入口如何注册

分「官方 slot」与「DOM 注入」两种，取决于入口位置。

### 2.1 官方 slot 系统（`@deepseek-ai/dsh-client-ui-slots`）

- Slot 注册表是纯核心（无 React、无 Cordis 运行时依赖）。**契约表 `SlotMap` 通过 `declare module "@deepseek-ai/dsh-client-ui-slots" { interface SlotMap {...} }` 声明合并**——owner（渲染方）声明 slot key，贡献方 register 进去。
- 一次 `register({ name, children?, store?, inject?, ...kind, id/order/label/priority/key/select }, Component)` 向已声明 slot 贡献组件，同时可声明子 slot。返回 disposer。
- `SlotCore` 是纯注册表；运行时包 `dsh-client-runtime` 把它包成 **`ctx.slots`（`SlotRegistry`）** service：`ctx.slots.register(...)`（注册）+ `ctx.slots.inject(key, callback)`（「等声明→注册→声明消失时 dispose」的声明感知注入）。

源：`.../dsh-client-ui-slots/lib/types/index.d.ts`、`README.zh.md`；`.../dsh-client-runtime/lib/types/client/slots.d.ts`

### 2.2 侧边栏 shell 实际声明的 slot（`dsh-client-ui-sidebar`）

`sidebar` slot（single，被 SidebarRoot 占用）声明三个子 slot：

- `sidebar.workspaces`（single）：工作区/会话浏览器（ui-workspace 注册）。
- `sidebar.settings`（single）：底部 Settings 座（ui-settings 注册）。
- **`sidebar.footer.action`（list, scope:root, owner:{wide}）**：Settings 旁的脚部动作——**这是侧边栏唯一对外可加塞的「列表」slot**。

源：`.../dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts`（SlotMap 声明 + owner 类型），`.../dsh-client-ui-sidebar/lib/client.js`（`renderSlot("sidebar.footer.action", { wide })` 渲染点，line ~211）

> 注意：`sidebar.remote` 是**旧**座（remote-web-ui 注释说「Current shells declare `sidebar.footer.action` instead of the legacy `sidebar.remote` seat」）；当前 shell 用 `sidebar.footer.action`。

### 2.3 顶部导航条目：**无官方 slot，用 DOM 注入**

dsh-ssh `src/client/sidebar-entry.ts` 注释原文：

> "dsh 的 sidebar shell 没有暴露任何外部插件可注册的 slot，所以（沿用 task-board 的 DOM 级扩展先例）条目行被注入到 shell 的 New Session 按钮与工作区浏览器之间。"

实现要点（`.../dsh-ssh/src/client/sidebar-entry.ts`）：

- 定位 sidebar 根：`document.querySelector("[data-pane=sidebar], [class*=sidebarCol]")` → 取 logo row 的 parent 为根。
- 找 New Session 按钮：`button[class*=newSession]`。
- 建纯 DOM `<button data-dsh-ssh-entry>` 插到 New Session 之后、浏览器区之前（按 family block 定位，避免与 task-board 等兄弟插件换位）。
- **MutationObserver 自愈**：React 重渲染把行顶掉时，同一帧重新插入（不闪烁）；body 级 observer 兜底「整树重建」。

task-board 同款：`.../dsh-client-ui-task-board/src/client/index.ts` 里 `mountSidebarEntry(controller)`。

### 2.4 通过 slot 注册侧边栏/浮层入口的示范（remote-web-ui）

`.../dsh-remote-web-ui/src/client/index.ts` 展示最规范的「slot 注册」写法：

```ts
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

ctx.effect(() => ctx.locale.register(NS, { zh, en }), '...')

ctx.slots.inject('sidebar.footer.action', () => {
  let disposeEntry: (() => void) | undefined
  const syncEntry = () => {
    if (enabled() && disposeEntry === undefined) {
      disposeEntry = ctx.slots.register({ name: 'sidebar.footer.action', id: 'remote-web-ui', locale: NS }, FooterRemoteEntry)
    } else if (!enabled() && disposeEntry !== undefined) {
      disposeEntry(); disposeEntry = undefined
    }
  }
  const unsub = settingsScope.subscribe(syncEntry); syncEntry()
  return () => { unsub(); disposeEntry?.() }
})
```

要点：`ctx.slots.inject(key, cb)` 等声明；`cb` 里 `ctx.slots.register({name, id, order, locale, inject}, Component)`；返回的 disposer 随 fiber 卸载自动级联清理。

### 2.5 浮层座（全局悬浮面板）

`dsh-client-ui-layout` 声明 **`shell.overlay`（list, scope:root）**——「frame 级浮层，在每列之上、滚动容器之外，可加塞（新 `id` 与既有条目并存）；层本身 click-through，条目 opt-in pointer events」。**这是官方支持的「自建全屏/悬浮表面」加法座**。

源：`.../dsh-client-ui-layout/lib/types/client/index.d.ts`（`shell.overlay` 注释块）

---

## 3. 面板 / 视图如何挂载与路由

**无 URL 路由**（`dsh-host-frontend-static` 兜底服务 SPA dist；`dsh-host-webserver` 只做 HTTP/upgrade 路由，不路由前端页面）。面板挂载分两类：

### 3.1 slot 注册挂载（有声明 owner 渲染）

插件 declare-merge 一个 slot key 没意义（无人 render 它就没法显示）；真正可用的是注册进**已被 DSH core 声明的** slot：

- `shell.overlay`（list）：全屏浮层。
- `sidebar.footer.action`（list）：侧边栏脚部动作。
- `settings.plugin.item`（list，`dsh-client-ui-settings-plugins` 声明）：设置面里的「插件配置卡片」。
- `conversation.input.dock`（list，`dsh-client-ui-conversation` 声明）：composer 输入上方的 dock（pet / git-graph 用它）。
- 另有 `conversation`（single，占用）/ `details`（single）/ `sidebar`（single）——single 座注册会**替换**整列，不该碰。

源：`.../dsh-client-ui-layout/lib/types/client/index.d.ts`（sidebar/conversation/details/shell.overlay 的 kind/scope/注释）；`.../dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts`（settings.plugin.item）；`.../dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`（conversation.input.dock）

### 3.2 DOM 注入挂载（专用面板：ssh / task-board / aionui-panel）

- **中心列抢占**（ssh、task-board）：`conversation` slot 是 single-occupant（ui-conversation 占用），外部插件不能声明 slot，所以面板在 DOM 层接管中心列——往 `[data-pane="conversation"]` 追加一个 React 永不管理的容器，用 `<html data-dsh-ssh-active>` 属性 + 样式规则隐藏对话内容，切换面板。

  > 原文（ssh `src/client/mount.tsx`）："The `conversation` slot is single-occupant (ui-conversation) and external plugins cannot declare slots, so the panel takes over the center column at the DOM level..."

- **右栏轨道扩展**（aionui-panel，最贴近本插件需求）：`[data-dsh-frame]` 是三轨 grid（sidebar / center / details）。aionui-panel 的 `layout.ts` 监听 frame 的 inline `grid-template-columns`，镜像 shell 自己的 3 轨，再**追加两条轨道**（preview + explorer），拖动把手改宽、折叠=宽度 0 保持挂载。React 根通过 `createRoot(el).render(...)` 挂进 `[data-aionui-preview-col]` / `[data-aionui-explorer-col]`，用 `waitForElement` + MutationObserver 等 shell 挂载完成。

源：`.../dsh-client-ui-aionui-panel/src/client/layout.ts`、`src/client/mount.tsx`、`src/client/index.ts`

### 3.3 当前会话/项目如何取得

browser 半区通过 `ctx.sessions.list.getSnapshot()` 取当前 session，再取 `.byId[sessionId]?.cwd` 作为项目根；`ctx.sessions.list.subscribe(...)` 跟随会话切换。aionui-panel 的 `bindRoot()`（`src/client/index.ts`）就是完整示范。

---

## 4. host 侧数据 API：如何实现与注册

### 4.1 服务与依赖

host 半区 `inject`（aionui-panel）：`['webServer', 'subprocess', 'workspaceRegistry', 'systemPrompt']`。对应 peerDependencies：

- `@deepseek-ai/dsh-host-webserver` → `ctx.webServer`（HTTP 路由注册）。
- `@deepseek-ai/dsh-subprocess` → `ctx.subprocess`（托管子进程，跑 `git` 等）。
- `@deepseek-ai/dsh-workspace` → `ctx.workspaceRegistry`（`.list()` 返回工作区，含 `.path`，用于安全门卫）。
- `@deepseek-ai/dsh-system-prompt` → `ctx.systemPrompt.section({name, order, text})`（给每个 agent 注入插件公告）。
- 另有 `@deepseek-ai/dsh-tools` → `ctx.tools.register(tool)`（给 agent 注册工具，ssh 用）；`@deepseek-ai/dsh-settings` → `installSettingsSection(ctx, ns, schema, entry, hooks)`（可选配置，ssh/task-board 用）。

源：`.../dsh-client-ui-aionui-panel/src/index.ts`、`package.json`（peerDependencies）；`.../dsh-ssh/src/index.ts`（tools + installSettingsSection 示范）

### 4.2 `webServer.register` API（`@deepseek-ai/dsh-host-webserver`）

- `register(route): () => void`，`route = { kind: 'exact'|'prefix', path, handler(req,res) }`；重复 (kind,path) 抛错。
- `registerUpgrade(route)`：精确 pathname 的 upgrade（WebSocket 终端）。
- `registerFallback(handler)`：唯一兜底（SPA dist 的 `dsh-host-frontend-static` 拥有）。
- `tapIndex(transform)`：index.html 转换。
- 匹配顺序固定：exact → 最长前缀 → fallback。

源：`.../dsh-host-webserver/lib/types/index.d.ts`、`README.zh.md`

### 4.3 路由实现范式

aionui-panel 的 `registerPanelRoutes(ctx, fs, git)`（`src/host/routes.ts`）：

- 一次 `ctx.webServer.register({kind:'prefix', path:'/aionui-panel', handler})` 处理所有 JSON 操作；一次 `{kind:'exact', path:'/aionui-panel/events', handler:sse}` 处理 SSE 流（最长前缀优先保证两者不相交）。
- JSON 信封：`{ok:true, value}` / `{ok:false, error:{code,message}}`。
- 反 CSRF：POST 强制 `content-type: application/json`（跨站简单请求不能设它）。
- SSE：handler 内 `res.writeHead(200, {"content-type":"text/event-stream", ...})` + `res.write("event: change\ndata: ...\n\n")`，`req.on("close")` 清理订阅。
- **工作区门卫**（安全边界）：`gate.ts` 用 `ctx.workspaceRegistry.list()` + `realpath` 规范化 + 前缀校验，拒绝工作区外路径；`fs-service.ts` 的 `resolveInsideRoot` 逐级 realpath 防符号链接逃逸。
- 子进程跑 git：`subprocessRunner(ctx)` 包 `ctx.subprocess.spawn(spec)`（`graceMs`、`maxBytes` 上限、失败降级为 127 而非 throw）。

源：`.../dsh-client-ui-aionui-panel/src/host/{routes.ts,gate.ts,fs-service.ts,git-service.ts}`

ssh 则是 `makeRoutes()` 返回 `WebRoute[]` + `WebUpgradeRoute`，`apply` 里 `routes.map(r => ctx.webServer.register(r))` + `ctx.webServer.registerUpgrade(upgrade)`，并加 **loopback-only 信任栅栏**（`isLoopbackRequest`：远端 127.0.0.1 + host/Origin 同源校验）。源：`.../dsh-ssh/src/{routes.ts,index.ts}`

---

## 5. 客户端如何调用 host API

同源相对请求（页面与路由共用 webserver），`.../dsh-client-ui-aionui-panel/src/client/api.ts`：

- JSON 操作：`fetch("/aionui-panel/list", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({root, path})})` → 解 `{ok, value|error}`，永不 throw（transport 失败返回 `{code:"internal"}`）。
- SSE：`new EventSource("/aionui-panel/events?root=" + encodeURIComponent(root))` + `addEventListener("change", ...)`。
- WebSocket 终端：ssh 用 `new WebSocket(SSH_API.terminal + "?...")`（走 `registerUpgrade`）。

---

## 6. 最小可用插件需要 export / 声明什么

**package.json 必填**：

- `name`、`type: "module"`、`main`（host 入口）、`exports`（`"."` + `"./client"` + `"./package.json"`）。
- `dsh.bundle.patch`（→ `cordis.patch.yml`）、`dsh.client`（`inject` + `platform:"web"`）。
- `peerDependencies`：本插件用到的 `@deepseek-ai/dsh-*`（aionui-panel 列了 `dsh-client-locale`、`dsh-client-runtime`、`dsh-host-webserver`、`dsh-subprocess`、`dsh-system-prompt`、`dsh-workspace` + `react`）。
- 构建工具链：`tsdown`（bundle）、`typescript`、`lightningcss`、`vitest`（aionui-panel 的 devDependencies）。

**host 半区**（`src/index.ts`）：`export const inject = [...]`、`export function apply(ctx) {...}`；可选 `export const name`、`export const Config`（schemastery schema）。所有注册放进 `ctx.effect(() => ..., "label")`（fiber 卸载时自动 dispose）。

**browser 半区**（`src/client/index.ts`）：`export const inject = [...]`、`export function apply(ctx: ClientContext) {...}`；`ClientContext` 从 `@deepseek-ai/dsh-client-runtime/client` 导入。类型-only 导入用于拉取 Context/SlotMap merge：

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'   // ctx.locale merge
import type {} from '@deepseek-ai/dsh-client-ui-slots'        // SlotMap / LocaleNamespaceMap merge
```

**`cordis.patch.yml`**：`- insert: - {id, name}` 一行（id 即 `/plugins/<id>/client.js` 的 URL 段）。

**关键纪律**（社区插件反复强调）：client 半区 `apply` 里所有 DOM/运行时接线失败一律 log、**绝不 throw**——「web shell 在插件 apply throw 时整个 boot 失败」。export 纪律：`/client` 表层只承载 cordis 加载所需（`inject`/`apply`）+ 类型。

---

## 7. 开发期 HMR / 热更工作流

源：`.../dsh-client-hmr/README.zh.md`、`.../dsh-client-modules/README.zh.md`

- `dsh-client-hmr`：浏览器侧订阅 SSE `GET /plugins/events`；每帧 `rebuilt` 按队列串行重载一个插件（`invalidate` → `prefetch` → 卸载旧 fiber → 删 `<style data-plugin>` → `entry.refresh()` 重新 import+mount）。
- Node 侧：`interval` stat-poll 每个图 bundle，检测真实 rev 变化才广播。**任何 `tsdown --watch` 进程重打包都会触发 HMR，无需 builder→host 通道**。
- `dsh-client-modules`：Node 扫描已启用 Loader 条目里的 `dsh.client` 包，解析 `exports["./client"]`，把构建后 bundle 哈希写进启动图，经 `/plugins` 提供该文件 + sourcemap（`/plugins/<id>/client.js`）。
- 粗粒度重载：整包重来，React 状态丢失，数据层 fiber 不受影响；失败不回滚（FAILED 态）。
- 前提：client 半区要能被 `tsdown --watch` 重打包（脚本 `watch: "tsdown --watch"`）。

---

## 8. 对 `@apodemakeles/dsh-token-dashboard` 的架构建议

### 8.1 明确推荐：**单包（双面），与 aionui-panel / dsh-ssh 完全同构**

一个 npm 包 `@apodemakeles/dsh-token-dashboard`，`exports["."]` = host 半区（读会话日志 + `/api/token-dashboard/*` 路由 + systemPrompt 公告），`exports["./client"]` = browser 半区（热力图面板）。理由：

1. DSH 的双面机制**就是为一个包承载 host+client 设计的**：`dsh.bundle.patch` 只插一行；`dsh.client` 声明让同包的 `./client` 导出在 `/plugins/<id>/client.js` 提供。拆双包反而要额外串 host 包与 client 包的加载，无收益。
2. 两个最接近的参考（aionui-panel 右面板、ssh 侧边栏+面板）都是单包双面。
3. 数据源（`~/.dsh/sessions/<project>/<session-id>/session.jsonl.zstd`）在宿主进程本地，天然归 host 半区；UI 归 client 半区，二者通过一个 HTTP 路由族对话，边界清晰。

### 8.2 需要实现的服务 / slot

**host 半区**（`inject` 建议 `['webServer', 'workspaceRegistry', 'systemPrompt']`；若用设置项再加 `settings`）：

- `webServer`（`@deepseek-ai/dsh-host-webserver`）：注册 `prefix` 路由 `/api/token-dashboard`（或 `/aionui-panel` 风格的前缀），提供「聚合查询」端点（如 `GET/POST .../usage?range=day|week`）。数据源是本地会话日志，**无需** `subprocess`（除非复用 git 之类）；若需实时刷新可加一个 SSE 端点（参照 aionui-panel `/events`）。
- `systemPrompt`（`@deepseek-ai/dsh-system-prompt`）：`ctx.systemPrompt.section({name:"plugin:token-dashboard", order, text})` 向 agent 公告插件存在与语义（用户提到「token 用量/热力图」即指本插件）。
- （可选）`settings` / `installSettingsSection`：开关、聚合范围等配置（ssh/task-board 模式）。
- 数据读取：host 直接 `fs` 读 `~/.dsh/sessions/.../session.jsonl.zstd`（zstd 解压 + JSONL 逐行，取 `usage` 事件聚合）。本 map 环境事实已确认日志含 `usage`（inputTokens/outputTokens/cacheReadTokens）。注意做**门卫/路径限制**：只允许读 `~/.dsh/sessions` 之下，防任意路径读取（对齐 aionui-panel 的 workspace gate 思想，但作用域是 `~/.dsh/sessions` 而非 workspace）。

**browser 半区**（`inject` 建议 `['slots', 'locale', 'sessions']`；要配置卡再加 `settingsScope`）：

- `ctx.locale.register(NS, {zh, en})`：中英双语（本 map 要求）。
- `ctx.sessions`：取当前会话/项目（本插件 v1 是**全局统计、无项目过滤**，所以其实可不依赖 `sessions`；但取 cwd 可留作「当前项目高亮」的未来位）。
- UI 挂载（二选一，推荐前者）：
  - **推荐：右栏 DOM 注入（aionui-panel 模式）**——往 `[data-dsh-frame]` 追加一条轨道渲染热力图，或
  - **`shell.overlay` slot（list）**——官方加法浮层，代码最少、最稳（无需镜像 grid）。
- 入口（二选一）：
  - **`sidebar.footer.action` slot**：官方支持、声明感知、最稳（remote-web-ui 范式）。
  - 或顶部导航条目 DOM 注入（ssh/task-board 范式）：更醒目但需 MutationObserver 自愈，与其它注入插件协作。

**明确推荐组合**：`sidebar.footer.action` slot 做入口开关 + `shell.overlay`（或右栏 DOM 注入）渲染热力图面板 + host `/api/token-dashboard/*` 提供聚合数据。这是「官方 slot + 单 host 路由」的最简、最稳组合；若产品坚持「顶部侧边栏条目」观感，再叠加 ssh 的 DOM 注入入口。

### 8.3 dev/HMR 工作流

- `tsdown --watch` 重打包 client 半区 → `dsh-client-hmr` 经 `/plugins/events` 自动重载；host 半区改动通常需重启 `dsh web`。
- 本地安装：`dsh plugin --profile web add link:<repo>` 后重启 `dsh web`（aionui-panel README 的安装段）。

---

## 证据路径速查

| 主题 | 源文件 |
|---|---|
| 双面插件 manifest / patch / peerDeps | `~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel/{package.json,cordis.patch.yml,README.md}` |
| profile 装载链 | `~/.dsh/profiles/web/{package.json,cordis.yml,cordis.patch.yml}`、`.../@linxin666/dsh-web-ui-all/{package.json,cordis.patch.yml}` |
| host 路由/门卫/SSE | aionui-panel `src/{index.ts,host/routes.ts,host/gate.ts,host/fs-service.ts,host/git-service.ts}` |
| client API 调用 / 会话根 | aionui-panel `src/client/{index.ts,api.ts,layout.ts,mount.tsx}` |
| 顶部侧边栏条目 DOM 注入 | `.../@linxin666/dsh-ssh/src/client/{sidebar-entry.ts,mount.tsx,index.ts}`、`.../dsh-client-ui-task-board/src/client/index.ts` |
| slot 注册范式（footer.action/settings） | `.../@linxin666/dsh-remote-web-ui/src/client/index.ts` |
| SlotMap / SlotCore 契约 | `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts` |
| SlotRegistry（ctx.slots） | 同前缀 `dsh-client-runtime/lib/types/client/slots.d.ts`、`.../client/index.d.ts` |
| 侧边栏 slot 声明 | 同前缀 `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts` |
| 布局 slot（sidebar/conversation/details/shell.overlay） | 同前缀 `dsh-client-ui-layout/lib/types/client/index.d.ts` |
| webServer.register API | 同前缀 `dsh-host-webserver/lib/types/index.d.ts`、`README.zh.md` |
| client 模块加载 / 服务 | 同前缀 `dsh-client-modules/README.zh.md` |
| HMR | 同前缀 `dsh-client-hmr/README.zh.md` |
| 设置扩展点 | 同前缀 `dsh-settings/lib/types/index.d.ts`；`dsh-client-ui-settings-plugins/lib/types/client/slot-contract.d.ts` |

