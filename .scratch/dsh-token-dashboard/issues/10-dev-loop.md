# 10 · 开发联调环境：本地包挂载与 dsh web 热更工作流

Type: task
Status: open
Blocked by: 04

## Question

建立本插件的开发联调循环并写成可复用文档：把本地包（`dsh plugin --profile web add link:$(pwd)`，03 已确认语义）挂进本机 web profile，配合 `pnpm watch`（tsdown --watch）+ harness checkout 的 `pnpm run dev:web`（client-plugin HMR 只重建 bundle 内容、不改变插件集合；插件集合变更须重启 dsh web）。产出：一条可复用的联调步骤（写进 README dev 节或 docs/），并实测验证：改动 client bundle → GUI 热更；改动 host 半区/插件声明 → 重启生效。07 的 UI 开发依赖此循环做可视化验证。
