# 03 · 社区 DSH 插件的 npm 打包、发布与安装约定

Type: research
Status: resolved
Blocked by: —

## Question

社区 DSH 插件如何打包、发布到 npm、被用户安装（`dsh plugin add <pkg>`）？产出：package.json 约定（name/files/exports/peerDependencies/engines/version 策略）、README 与 i18n 约定、安装/升级流程的完整验证，供 04（脚手架）与 08（本地安装验证）直接执行。

## Context

- 参考实现：`@linxin666/dsh-client-ui-aionui-panel` v0.1.7（本机已安装，看它的 package.json、README、以及它在本机 web profile 中的安装形态：profile package.json 依赖、cordis 配置声明方式）。
- CLI：`dsh plugin add <pkg>` 转发 pnpm 到 profile 目录；DSH 官方包均 MIT、`README.i18n.yaml` i18n 约定。
- 本插件定名 `@apodemakeles/dsh-token-dashboard`（scoped，npm registry 可用）。
- 只读调查，不安装、不修改 profile 与 ~/.dsh。
## Answer

结论（详见 [research/03-npm-packaging.md](../research/03-npm-packaging.md)，全部带一级证据路径）：

1. **package.json 的 DSH 专属字段只有两个**：`dsh.bundle.patch`（指向 cordis.patch.yml → `dsh plugin add` 时自动 reconcile 进 profile 的 dsh.profile.bundles）与 `dsh.client`（`{platform:"web", inject:[...]}` → 浏览器半区发现/加载）。其余是普通 ESM 双半区包约定：`type: module`、`exports["."]` 为 host 半区、`exports["./client"]` 为 browser 半区，用 tsdown 构建。
2. **不需要 `dsh-client-ui-*` 前缀**——UI 发现只看 `dsh.client` + cordis.patch.yml 的 insert 行（id 任意、name=包名）；`@apodemakeles/dsh-token-dashboard` 名可用。
3. **安装流程**：`dsh plugin add <pkg>` = pnpm 转发 + 自动 reconcile，无需手改 patch；唯一手动步骤是**重启 dsh web**（客户端插件集合变更仅重启生效，HMR 只覆盖 bundle 内容）。
4. **版本策略**：首版 **0.1.0**（非 1.0.0）；peer 一律 `^0.1.0-rc.6`（DSH 官方包当前版本）、cordis `^4.0.1`；`publishConfig.access: "public"`；README.md + README.zh.md + README.i18n.yaml（git blob hash 配对）三语文档约定。
5. 安装/发布其余细节（pnpm-workspace、cordis.yml 结构）见 findings 文件。

**对地图的修正**：目的地「v1.0.0」改为「首版 0.1.0 起、按 tag 迭代」——map Destination 与 ticket 09 已同步更新。
