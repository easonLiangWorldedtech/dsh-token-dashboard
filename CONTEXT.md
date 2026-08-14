# CONTEXT

本仓库的术语表。只收录词汇与定义，不放实现细节。

- **Token 消耗 (token consumption)**：一次模型调用消耗的 token 数量，本产品以「Total tokens」为用户可见口径。
- **Total tokens**：单日聚合的 token 消耗总量，是热力图格子的唯一指标（v1）；构成口径由产品决策定义（见 .scratch map 05 决议）。
- **热力图 (heatmap)**：GitHub 贡献图风格的按日聚合色块矩阵；周视图为主，配日视图。
- **会话日志 (session log)**：DSH 为每个会话记录的 JSONL 事件流（`~/.dsh/sessions/<project>/<session-id>/session.jsonl.zstd`），含逐请求 usage 数据，是本插件唯一数据来源。
- **用量面板 (usage panel)**：本插件在 DSH Web GUI 侧边栏入口打开的专用面板。
- **DSH (DeepSeek Harness)**：本插件宿主——Cordis 插件系统驱动的 agent harness，含 web GUI（web profile）。
- **双半区插件 (dual-face plugin)**：同一个 npm 包导出两个入口的 DSH 插件形态——宿主半区（node 进程，`exports["."]`）与客户端半区（浏览器，`exports["./client"]`）。
- **profile**：DSH 的一组插件装载配置与依赖集合（如 web profile），由 bundle 层 + 用户 patch 层叠加而成。
- **bundle patch**：插件随包携带的 `cordis.patch.yml` 清单，声明本包如何插入 profile 的插件树（`dsh.bundle.patch` 字段指向它）。
- **usage 四桶**：会话日志中单次调用的 token 计量——inputTokens / outputTokens / cacheReadTokens / cacheWrite（本 provider 只出现前三者）。