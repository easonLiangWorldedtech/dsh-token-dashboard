# 09 · 发布：公开 GitHub 仓库 + npm 首版 0.1.0（HITL）

Type: task
Status: resolved
Blocked by: 08

## Question

分发决策修订（用户 2026-08-14）：**先 GitHub、再补 npm**。本次范围 = GitHub 分发达成；npm 发布拆出为 ticket 11（等用户配置 2FA）。
## Answer

完成。**GitHub 分发已上线并端到端验证**：

1. **公开仓库**：https://github.com/apodemakeles/dsh-token-dashboard （PUBLIC，main + tag v0.1.0，最新 tag 指向 9fbbed2）。
2. **git 安装验证（真机）**：本机 web profile 从 link: 切换为 `github:apodemakeles/dsh-token-dashboard`，pnpm 克隆成功；用户多次重启 dsh web 实测，数据（含缓存口径、模型分布 tooltip）均确认正确。lib/ 预构建产物随仓库发布（git 安装免构建）。
3. **安装命令**：`dsh plugin --profile web add github:apodemakeles/dsh-token-dashboard`（README 双语已写明；需能访问 github.com HTTPS——本机需代理，见 ~/.dsh/AGENTS.md）。
4. **npm**：因 npm 强制 2FA 且用户未配置验证器，npm 发布拆出为 **ticket 11**（blocked by 用户 2FA 配置）。
