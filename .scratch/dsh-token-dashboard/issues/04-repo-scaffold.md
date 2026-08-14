# 04 · 仓库脚手架：main 分支、包骨架、README、首个 commit

Type: task
Status: resolved
Blocked by: 03

## Question

按已锁定的「极简 main + tag」规范搭好仓库可提交形态：main 分支、.gitignore、README（中英双语）、LICENSE (MIT)、package.json（`@apodemakeles/dsh-token-dashboard`，按 03 的约定）、基础 dev 脚本、.scratch tracker 纳入版本库，产出首个 commit。CONTEXT.md 术语表已建，此 ticket 校验并扩展。
## Answer

完成，首个 commit `2165e13`（main 分支，工作区干净）：

- **分支**：master 改名 main；极简 main + tag 工作流（无 CI，发布时手动打 tag）。
- **包骨架**：package.json 按 03 模板（dsh.bundle.patch + dsh.client、双半区 exports、peer ^0.1.0-rc.6、publishConfig public、files 白名单、prepublishOnly build）；cordis.patch.yml（id: token-dashboard）；src/index.ts（host 半区 stub，inject: webServer + sessionPersistence）+ src/client/index.ts（client 半区 stub，inject: slots + locale）。
- **构建验证**：pnpm install / typecheck / build / test 全绿；npm pack --dry-run 16 文件齐全（含 LICENSE、README.i18n.yaml、lib/client.js、lib/types）。产物 lib/index.js、lib/client.js、lib/types/{index,client/index}.d.ts 与 exports 完全对齐。
- **构建配置的三个坑（06/07 沿用）**：① tsdown 对 platform:"node" 默认 fixedExtension → 会产出 .mjs，须显式 `fixedExtension: false`；② build 顺序必须是 `tsdown && tsc -b`（tsdown 默认 clean:true 会抹掉 lib/types）；③ host 半区须 `deps: { onlyBundle: false }`（依赖一律外部化，由 profile 解析）。
- **文档**：README.md + README.zh.md 双语互链 + README.i18n.yaml（git blob hash 配对）；CONTEXT.md 扩展了 双半区插件 / profile / bundle patch / usage 四桶。
- **测试**：test/plugin-shape.test.ts 冒烟测试锁定双半区插件形态契约，pnpm test 通过。
