# 10 · 开发联调环境：本地包挂载与 dsh web 热更工作流

Type: task
Status: resolved
Blocked by: 04

## Question

建立本插件的开发联调循环并写成可复用文档：把本地包（`dsh plugin --profile web add link:$(pwd)`，03 已确认语义）挂进本机 web profile，配合 `pnpm watch`（tsdown --watch）+ harness checkout 的 `pnpm run dev:web`（client-plugin HMR 只重建 bundle 内容、不改变插件集合；插件集合变更须重启 dsh web）。产出：一条可复用的联调步骤（写进 README dev 节或 docs/），并实测验证：改动 client bundle → GUI 热更；改动 host 半区/插件声明 → 重启生效。07 的 UI 开发依赖此循环做可视化验证。
## Answer

完成，commit `325ccc0`。实测记录：

1. **挂载**：`dsh plugin --profile web add link:<repo>` → profile package.json 出现 `link:` 依赖，`dsh.profile.bundles` 自动追加 `@apodemakeles/dsh-token-dashboard`（reconcile 语义与 03 结论一致，无需手改 patch）。
2. **重启生效（实测）**：重启 dsh web 后插件加载，host 半区 API 存活——`GET /api/token-dashboard/summary?tz=local` 返回真实聚合数据（21 会话、当日 2.67M tokens、cacheRead 85M 独立桶）；`/days` 26 周窗口正常。日分布与逐会话 usage 时间戳抽查一致（本机历史使用恰好全部落在今天，仅一个非零日是真实数据）。注：用户重启时曾遇到一次启动失败并自行修复，最终状态本插件正常加载、非本插件故障（未观察到本包引起的 boot 异常；若后续复现需在 08 前定位）。
3. **文档**：docs/dev-loop.md（一次性挂载/卸载、三档改动生效表、watch+HMR receiver 双终端循环、curl 验证、已知坑），README 双语已挂指针。
4. **HMR（client bundle 内容热更）**：该验证需可见 UI 才可观测，**并入 07 验收**（07 的 UI 开发即以 docs/dev-loop.md 为循环）。
