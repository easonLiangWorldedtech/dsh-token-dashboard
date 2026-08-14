# 11 · npm 发布 @apodemakeles/dsh-token-dashboard@0.1.0（等用户 2FA）

Type: task
Status: open
Blocked by: 09

## Question

用户配置 npm 2FA（`npm profile enable-2fa auth-and-writes` + 任一 TOTP 验证器 App）后：`npm publish --access public`（带 --otp），发布后验证 `npm view @apodemakeles/dsh-token-dashboard`、把本机 profile 依赖从 `github:` 切回 registry 版（`dsh plugin --profile web add @apodemakeles/dsh-token-dashboard`）、用户重启 dsh web 确认面板正常。产出：npm 上可 `dsh plugin add @apodemakeles/dsh-token-dashboard` 安装；README 状态行更新为「npm 已发布」。
