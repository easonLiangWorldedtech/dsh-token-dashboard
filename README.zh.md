# @apodemakeles/dsh-token-dashboard

[English](README.md) | 中文

一个 DeepSeek Harness (DSH) Web GUI 插件：token 消耗热力图面板。以 GitHub 贡献图风格展示本机**所有项目的每日/每周 token 总消耗**，数据来自 DSH 会话日志中记录的 usage 事件。

> 状态：**已发布 v0.1.0** —— GitHub 分发已上线；npm 发布待维护者配置 2FA。

## 功能

- **宿主半区** —— 通过 `sessionPersistence` seam 读取 DSH 会话日志，按 (turn, step) 去重 usage 事件，聚合成按日的 total-token 桶（本地时区，可配置覆盖），经 `/api/token-dashboard/*` 路由提供给面板。
- **客户端半区** —— 在侧边栏注册 **Token** 入口，打开专用面板渲染热力图（周视图网格 + 日视图）。

## 安装

从 GitHub：

```bash
dsh plugin --profile web add github:apodemakeles/dsh-token-dashboard
```

安装后**重启 dsh web**。打开任意项目会话，点击侧边栏的 **Token** 入口即可看到热力图面板。

从 npm（即将提供——等维护者完成 2FA 配置后发布）：

```bash
dsh plugin --profile web add @apodemakeles/dsh-token-dashboard
```

## 开发

```bash
git clone https://github.com/apodemakeles/dsh-token-dashboard.git
cd dsh-token-dashboard
pnpm install && pnpm build
dsh plugin --profile web add link:$(pwd)
```

项目地图（规划 tracker）见 [.scratch/dsh-token-dashboard/map.md](.scratch/dsh-token-dashboard/map.md)，完整联调循环（watch / HMR / 重启规则）见 [docs/dev-loop.md](docs/dev-loop.md)。

## 已知限制

- total tokens = inputTokens + outputTokens；cacheReadTokens 会记录但不计入头条数字（它比真实消耗大几十倍，会淹没信号）。
- 仅统计本机：数据来自本机 `~/.dsh/sessions` 下的会话。

## 协议

MIT