# 11 · npm 发布（用户决定跳过）

Type: task
Status: resolved
Blocked by: 09

## Question

旧的 GitHub `v0.1.0` 标签指向持久化投影改造前版本，不移动旧标签；本次以 `v0.2.0` 统一发布 npm 与 GitHub Release。发布后验证 `npm view @apodemakeles/dsh-token-dashboard`，README 状态行更新为「npm 已发布」，并在 DSH 官方 Show Your Plugins 分类发布介绍。

## Answer

2026-08-16 用户确认没有 npm 账号并要求跳过 npm 发布。保留 `package.json` 的 discoverability metadata，README 明确只提供 GitHub 安装；本次仅创建 GitHub `v0.2.0` Release 和官方插件区介绍。

- GitHub Release：https://github.com/apodemakeles/dsh-token-dashboard/releases/tag/v0.2.0
- DSH 官方插件区：https://github.com/deepseek-ai/deepseek-harness/discussions/2420
- GitHub Topics：`dsh-plugin`、`deepseek-harness`、`dsh`、`token-usage`、`token-dashboard`、`dashboard`、`heatmap`
