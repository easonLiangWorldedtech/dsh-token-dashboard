# 08 · 本地安装与自用验证（HITL）

Type: task
Status: resolved
Blocked by: 03, 07

## Question

按 03 的安装约定把插件装进本机 web profile（`dsh plugin add` 或等价方式），真实数据跑通，用户日常使用一轮并确认可用。产出：安装步骤记录（供 README 使用）+ 用户验收结论。
## Answer

**用户验收通过**（2026-08-14：「这一版可以了，我很满意」）。历时一整天的自用验证循环：

1. **安装**：link: 挂载进 web profile（bundle 自动 reconcile），重启后 host API 与 client UI 均生效。
2. **真实数据**：面板渲染本机全部 22 个会话的聚合数据（当日 2.7M tokens / 935 请求 / cacheRead 85M 附注桶），逐会话时间戳抽查确认日界正确。
3. **验收期间发现并修复的问题**（全部 commit 于 main）：
   - 周视图横向滚动条（月标签 flex margin 累加）→ 绝对定位修复；
   - tooltip 右缘截断 → portal + fixed + 视口钳制；
   - 用户评审推翻「可配 UTC」→ 仅本地时区（05 Revision 已记录）；
   - 重设计 round 2（固定弹框尺寸、大选项卡入 header、日视图去列表、质感打磨）；
   - 零数据日显示短柱 → 完全隐藏；
   - 热力图放大 + 居中；月份标签半格错位（跨月共列边界 bug）→ 块中心对齐，实测 7 月标签全部精确重合；
   - 周视图滚动条（wrap min-height+padding 溢出）→ border-box 修复。
4. **交付**：README 安装说明（npm + 仓库 link 两种）、docs/dev-loop.md、测试全绿（含真实日志核对）。

**发布就绪判定**：功能、稳定性、视觉均获用户确认，可进入 09 发布。
