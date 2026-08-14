# 05 · 热力图面板的视觉与交互原型（HITL）

Type: prototype
Status: resolved
Blocked by: 01

## Question

热力图面板长什么样、怎么交互？产出：浏览器可直接打开的静态原型 + 用户对以下细节的逐项确认：
- 周视图（GitHub 风格热力图）与日视图（柱状/明细）的形态与切换方式；
- hover 内容（单日 total tokens）；
- 时间范围与历史深度（默认最近多少周/月、能否翻页）；
- 日界与时区（本地时区 vs UTC）；
- total 口径的展示确认（02 建议：input+output、不含 cacheRead，cacheRead 作附注）；
- 数据刷新方式（02 已确认冷扫 ≈0.5s、增量缓存可行、SSE 技术可行——倾向「打开时加载 + 手动刷新」，由原型讨论敲定）。

原型是抛砖引玉的粗制品，只为敲定上面这些问题；不产出生产代码。
## Answer

HITL 完成，五项视觉/行为决议全部确认：

1. **视觉方向 = Variant A**：GitHub 风格周热力图 + 日视图（近 30 天柱状 + 明细列表）两个 tab；顶部统计行（今日/本周/近 30 天/全部）。试过月视图（日历色块），用户否掉，不保留。Variant B（月历）、C（列表优先）淘汰。
2. **历史深度**：默认最近 26 周，可翻页到更早历史（无上限）→ 聚合 API 需支持窗口 + offset 翻页。
3. **日界时区**：默认按机器本地时区切「一天」，面板设置提供 UTC 覆盖。
4. **total 口径**：inputTokens + outputTokens；cacheReadTokens 不计入总量，只在 tooltip 附注「缓存读 N（不计入）」；tooltip 同时显示输入/输出拆分与请求数。
5. **刷新方式**：面板打开时自动加载 + 手动「刷新」按钮；v1 无自动轮询、无 SSE 实时推送。

**资产（primary source）**：三 variant 全集 + 切换器在 throwaway 分支 `prototype/05-heatmap`（commits a20063c → b955cfb → 72d300b，最终版即 72d300b 的 Variant A），文件 `.scratch/dsh-token-dashboard/prototypes/05-heatmap/index.html`。07 折叠时按此重写生产代码，不得直接搬原型。
