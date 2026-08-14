# 03 · 社区 DSH 插件的 npm 打包、发布与安装约定（研究结论）

> 本文件是 ticket 03 的只读调查产出。所有结论均来自本机一级证据（源码 / package.json / README），路径在每条结论旁标注。目标插件定名 @apodemakeles/dsh-token-dashboard（scoped、MIT、中英双语，见 map.md standing constraints）。

## 结论速览（TL;DR）

1. package.json 必须有的「DSH 专属」字段只有两个：dsh.bundle.patch（指向 cordis.patch.yml，让 dsh plugin add 自动把它写进 profile 的 dsh.profile.bundles）和 dsh.client（platform: "web" + inject: [...]，让浏览器半区被发现并加载）。其余字段（main/exports/peerDependencies/type: module）是普通 ESM 包约定。
2. 不需要 dsh-client-ui-* 命名前缀。UI 发现靠 dsh.client 声明 + cordis.patch.yml 的 insert 行，不靠包名。@linxin666/dsh-live-stats、dsh-ssh、dsh-pet 均无该前缀且正常被发现。前缀只是对齐官方 @deepseek-ai/dsh-client-ui-* 命名习惯。
3. dsh plugin add 之后无需手动改 patch：CLI 会 pnpm add 到 profile，然后自动 reconcile——凡声明 dsh.bundle.patch 的依赖会被追加进 dsh.profile.bundles。唯一手动步骤是重启 dsh web（客户端半区的插件集合变更只在重启时生效）。
4. version 起手用 0.1.0，peer 版本 pin ^0.1.0-rc.6（DSH 全系官方包当前都是 0.1.0-rc.6）。不要直接 1.0.0；map 的「v1.0.0」是目的地而非首版。

---

## 一、参考实现证据

### 1.1 @linxin666/dsh-client-ui-aionui-panel v0.1.7

证据路径：/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel/package.json

完整 package.json（关键字段原样，去掉注释）：

    {
      "name": "@linxin666/dsh-client-ui-aionui-panel",
      "version": "0.1.7",
      "type": "module",
      "main": "lib/index.js",
      "types": "lib/types/index.d.ts",
      "exports": {
        ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
        "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
        "./src/*": "./src/*",
        "./package.json": "./package.json"
      },
      "dsh": {
        "bundle": { "patch": "./cordis.patch.yml" },
        "client": {
          "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-locale"],
          "platform": "web"
        }
      },
      "peerDependencies": {
        "@deepseek-ai/dsh-client-locale": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-host-webserver": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-subprocess": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-system-prompt": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-workspace": "^0.1.0-rc.6",
        "react": "^18.2.0"
      },
      "devDependencies": {
        "@deepseek-ai/cordis": "^4.0.1",
        "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
        "@types/react": "~18.3.1", "@types/react-dom": "^18.3.5",
        "jsdom": "29.1.1", "lightningcss": "^1.32.0",
        "react": "^18.3.1", "react-dom": "^18.3.1",
        "tsdown": "0.22.2", "typescript": "~5.7.2",
        "vite-tsconfig-paths": "^6.1.1", "vitest": "^4.1.8",
        "@types/node": "^22.20.0"
      },
      "files": ["lib", "src", "cordis.patch.yml", "README.md"],
      "license": "BSD-3-Clause",
      "repository": { "type": "git", "url": "https://github.com/zhu1090093659/dsh-web-ui.git" },
      "scripts": {
        "build": "tsc -b && tsdown",
        "watch": "tsdown --watch",
        "test": "vitest run",
        "typecheck": "tsc -b --pretty false"
      }
    }

要点：

- 双半区（dual-face）结构：exports["."] 是 host 半区（Cordis 插件，跑在 node 宿主进程），exports["./client"] 是 browser 半区（打包成单文件 lib/client.js 供 GUI 加载）。lib/client.js 约 192KB、lib/index.js 约 40KB，均为预构建产物（仓库带 src，发布包同时带 src + 编译后的 lib）。
- 无 engines 字段；无 publishConfig 字段（scoped 包要公开需在 publish 时加 --access public，见第四节）。
- 无 README.i18n.yaml（aionui-panel 只有 README.md；i18n 约定见 dsh-live-stats）。
- 目录结构：src/index.ts（host 入口）、src/host/（fs/git 服务 + 路由）、src/client/（浏览器半区）、src/core/types.ts（前后半区共享类型）。构建后 lib/ 下有 index.js、client.js、types/（tsc 产物 d.ts）。

### 1.2 @linxin666/dsh-live-stats v0.1.7（与 token 仪表盘最接近的同类）

证据路径：/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-live-stats/package.json

与 aionui-panel 的差异，正好是 token 相关插件需要的：

- 额外导出 "./invariant"（官方包惯例，见第三节）。
- peerDependencies 额外含 @deepseek-ai/dsh-token-meter、dsh-session、dsh-session-projection、dsh-llm、dsh-settings、dsh-invariants（全部 ^0.1.0-rc.6）。
- dependencies 用 schemastery ^3.18.0 + zod ^4.4.3（配置 schema 校验）。
- files 更精细：["lib/**/*.js","lib/**/*.js.map","lib/**/*.d.ts","lib/**/*.d.ts.map","src","cordis.patch.yml"]。
- 三语 README 齐全：README.md（英）+ README.zh.md（中）+ README.i18n.yaml（配对一致性记录，见第二节）。

### 1.3 @linxin666/dsh-ssh v0.1.7（侧边栏入口 + agent 工具的双半区范例）

证据路径：/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-ssh/package.json、cordis.patch.yml

- dsh.client.inject 含 @deepseek-ai/dsh-client-ui-sidebar、dsh-client-ui-slots；peerDependencies 含 dsh-client-ui-sidebar、dsh-tools。→ 侧边栏入口的插件，client 注入 sidebar/slots，host 注入 tools。本插件要侧边栏入口，应仿此。
- 在 pnpm-lock 里，dsh-ssh@0.1.7（及 git-graph/pet/remote-web-ui）带 engines: {node: ^22.19.0 || >=24.0.0}，而 aionui-panel/live-stats/skin-center/task-board/web-ui-settings 不带。→ engines 是可选的社区自行添加项。

### 1.4 cordis.patch.yml 的 insert 形态（关键）

证据路径：三个插件的 cordis.patch.yml 结构完全相同：

    - insert:
        - id: live-stats                       # 任意 cordis 实例 id（可自定义）
          name: '@linxin666/dsh-live-stats'    # 包名 = 真正被加载的模块

- id 是任意字符串（ui-dsh-aionui-panel、live-stats、ssh、pet、ui-task-board），用于去重/覆盖/禁用。
- name 是包名（模块说明符），Cordis Loader 按它 require 宿主半区；客户端半区的路由 id 也取 name（见第三节）。
- 该 patch 作为「profile bundle layer」应用：bundle 在 dsh.profile.bundles 顺序内叠加（先 dsh-base、再 dsh-web-app、再社区 bundle）。

---

## 二、README 与 i18n 约定

### 2.1 README.i18n.yaml 格式（官方 + 社区一致）

证据路径：/usr/local/lib/node_modules/@deepseek-ai/dsh/README.i18n.yaml 与 /Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-live-stats/README.i18n.yaml

内容就是双语 git blob hash 配对记录（两语言同等权威，改一侧要同步另一侧并重记 hash）：

    # Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each
    # side as of the last confirmed-consistent state. Both languages carry equal authority;
    # after editing either side, bring the other along and re-record with:
    #   pnpm run verify-translation-pairing --write <path-to>/README.md
    README.md: 1ee38637d078aed2353d0589a442b75a7a1de804
    README.zh.md: 2dedfe8b040baf89453d47035e40bef8c7dd0675

- hash 是 git blob hash（git hash-object），是给维护者的配对一致性记录，不是 npm 校验字段。
- 中文文件名固定 README.zh.md（不是 zh-CN）；两份 README 顶部互链：English | [中文](README.zh.md) / [English](README.md) | 中文。

### 2.2 README 结构（参考 live-stats，token 同类）

README.md 分节：标题 → 语言切换行 → 一句话功能 → 输出示例 → What it does（host/client 两半区各干什么）→ Installation（npm + 仓库 link 两种）→ Configuration（配置表）→ Export shape → Model Experience（注入什么 prompt/token 开销）→ Known Limitations。中文 README.zh.md 全文对应。

---

## 三、客户端半区的发现机制（回答「命名前缀」与「HMR/重启」）

证据路径：/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js（node 半区）、lib/client.js（browser 半区）

- node 半区扫描 host Loader 的 entries，凡「已加载且未禁用」的 entry，若其包 package.json 声明 dsh.client 且 platform === "web"，就编入 window.__DSH_BOOT__ 入口图，并把 exports["./client"] 指向的产物以 /plugins/<id>/client.js 路由供浏览器加载（<id> = entry name = 包名）。源码头注释：entry id (package name)。
- dsh.client 字段校验（parseDshClient）：platform 必填字符串；inject 可选字符串数组（必须先加载的其它 client 包名）；immediately 可选布尔（是否 eager 加载）。exports["./client"] 必须是字符串或 {default: string}，否则抛「declares dsh.client but exports no ./client bundle」。
- 发现不依赖包名：parseDshClient(pkgName, ...) 只看 dsh.client 字段，不看名字是否含 dsh-client-ui-。@linxin666/dsh-live-stats / dsh-pet / dsh-ssh 无前缀照样被编入。
- 插件集合变更只在重启生效：源码头注释明确「Package metadata ... is cached per name and never expires — plugin-set changes take effect on restart; bundle content changes reach the graph only through ClientModuleRegistry.rebuilt」。→
  - 新增/移除插件 → 重启 dsh web。
  - 仅改 bundle 内容（开发期 watch）→ 走 rebuilt()（即 client-plugin HMR，需 pnpm run dev:web 从 harness checkout 同步运行；它只重建 bundle 内容，不改变插件集合）。
- 缺失构建产物时启动报错：client bundles not found; run "pnpm run build" before launch → 发布前必须 build，否则用户装了跑不起来。

---

## 四、dsh plugin add 语义（回答「安装后还要做什么」）

证据路径：/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js（runPlugin / reconcilePlugins）、lib/bin.js（plugin 子命令）

dsh plugin --profile <name> <args...> 是「pnpm 转发器 + bundle reconcile」三步：

1. profile 无 package.json 时先 initProfile（按 profile 模板的 DEFAULT_PROFILE_BUNDLES 初始化）。
2. 在 profile 目录跑 pnpm <args...>（stdio: inherit）。相对路径 spec（.、../x、file:、link:）会锚定到调用者 cwd；绝对 spec、registry 名、git url 原样透传。
3. pnpm 退出码 0 后 reconcilePlugins：扫描 package.json 的 dependencies，凡解析到「声明了 dsh.bundle.patch 的包」就自动追加进 dsh.profile.bundles（按依赖顺序）；已删除或不再声明 bundle 的依赖会被移除；新增的「无 bundle」依赖打一行 warning（作为普通依赖安装，不激活）。

结论：

- 用户 dsh plugin --profile web add @apodemakeles/dsh-token-dashboard 一步到位，前提是包声明了 dsh.bundle.patch。无需手改 dsh.profile.bundles 或 cordis.patch.yml。
- 唯一手动步骤 = 重启 dsh web（三份社区 README 均写「安装后重启 dsh web」）。
- git-hosted 插件（git+...）其 prepare 构建脚本会被 pnpm 拦到 allowBuilds（~/.dsh/profiles/web/pnpm-workspace.yaml）允许后才执行；从 npm registry 装的预构建包不触发此问题 → 本插件走 npm publish 预构建，避开此坑。

### 本机 web profile 当前安装形态（对照）

证据路径：/Users/caozheng/.dsh/profiles/web/package.json、cordis.patch.yml、cordis.yml、pnpm-workspace.yaml；/Users/caozheng/.dsh/cordis.patch.yml

- package.json：dependencies 含 @linxin666/dsh-web-ui-all ^0.1.7（聚合 bundle）与 dsh-web-search-model-routed link:...；dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@linxin666/dsh-web-ui-all"]。
- cordis.yml 是空列表 []，注释说明「树由 patch 组成：先每个 bundle 的 patch，再 cordis.patch.yml，再 --patch 覆盖；编辑 cordis.patch.yml 而非本文件」。
- cordis.patch.yml（profile 层）是用户层 patch：insert web-search-model-routed、覆盖 web.searchProvider、禁用 ui-task-board。
- ~/.dsh/cordis.patch.yml（全局）目前只含 dsh-skin 的 disabled: true 条目（auto-generated），与本插件无关——本插件不该写进这里，应作为 bundle 层随 dsh plugin add 自动进 dsh.profile.bundles。
- pnpm-workspace.yaml：nodeLinker: hoisted、autoInstallPeers: false、minimumReleaseAgeExclude（对社区包 0.1.6||0.1.7 免最小发布期限制）、allowBuilds。

---

## 五、官方 @deepseek-ai/* 包惯例

证据路径：/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json、dsh-web-app、dsh-base、dsh-token-meter、dsh-session-projection、dsh-client-modules 的 package.json（均在 .../dsh/node_modules/@deepseek-ai/ 下）

- version 全系 0.1.0-rc.6（DSH 尚在 pre-1.0 rc 时代）。
- publishConfig: {"access": "public"}（scoped 公开包必须）。
- license: "MIT"；repository 带 directory 字段指向 monorepo 子目录。
- type: "module" + main: lib/index.js + types: lib/types/index.d.ts。
- exports 惯例："." + "./invariant" + （client 包）"./client" + "./src/*" + "./package.json"。
- files 惯例：显式列出 lib/index.js、lib/invariant.js、lib/types/**/*.d.ts、cordis.patch.yml（bundle 包）；不整包 "lib" 泛收。
- peerDependencies 惯例：@deepseek-ai/dsh-* 一律 ^0.1.0-rc.6，另有 @deepseek-ai/cordis ^4.0.1（token-meter、session-projection 都带）。
- dependencies：zod ^4.4.3 + @deepseek-ai/schemastery ^3.18.1（社区用非 scoped schemastery ^3.18.0）。
- 无 engines 字段（对 185 个 dsh-* 包 grep 确认，无一含 engines）。社区部分包自行加了 ^22.19.0 || >=24.0.0。
- 构建：tsdown（rolldown 系 TS 打包器）+ tsc -b 出 d.ts；build script = tsc -b && tsdown。

---

## 六、@apodemakeles/dsh-token-dashboard 推荐 package.json 模板

（token 热力图 = 侧边栏入口 + 专用面板 + host 读取 session 日志聚合。宿主侧用 dsh-session / dsh-workspace / dsh-host-webserver；若走投影式实时刷新可加 dsh-session-projection / dsh-token-meter，见 01/02 结论。）

    {
      "name": "@apodemakeles/dsh-token-dashboard",
      "description": "DSH Web GUI token-consumption heatmap: daily/weekly total-token usage panel fed by session-log usage events",
      "version": "0.1.0",
      "type": "module",
      "main": "lib/index.js",
      "types": "lib/types/index.d.ts",
      "exports": {
        ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
        "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
        "./src/*": "./src/*",
        "./package.json": "./package.json"
      },
      "dsh": {
        "bundle": { "patch": "./cordis.patch.yml" },
        "client": {
          "platform": "web",
          "inject": [
            "@deepseek-ai/dsh-client-runtime",
            "@deepseek-ai/dsh-client-connection",
            "@deepseek-ai/dsh-client-ui-sidebar",
            "@deepseek-ai/dsh-client-ui-slots"
          ]
        }
      },
      "peerDependencies": {
        "@deepseek-ai/dsh-client-runtime": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-client-connection": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-client-ui-sidebar": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-client-ui-slots": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-host-webserver": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-session": "^0.1.0-rc.6",
        "@deepseek-ai/dsh-workspace": "^0.1.0-rc.6",
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
      },
      "dependencies": {
        "schemastery": "^3.18.0",
        "zod": "^4.4.3"
      },
      "devDependencies": {
        "@deepseek-ai/cordis": "^4.0.1",
        "@deepseek-ai/dsh-settings": "^0.1.0-rc.6",
        "@types/react": "~18.3.1",
        "@types/react-dom": "^18.3.5",
        "jsdom": "^26.0.0",
        "react": "^18.3.1",
        "react-dom": "^18.3.1",
        "tsdown": "^0.22.2",
        "typescript": "~5.7.2",
        "vite-tsconfig-paths": "^6.1.1",
        "vitest": "^4.1.8"
      },
      "files": [
        "lib/index.js",
        "lib/client.js",
        "lib/types/**/*.d.ts",
        "src",
        "cordis.patch.yml",
        "README.md",
        "README.zh.md",
        "README.i18n.yaml",
        "LICENSE"
      ],
      "license": "MIT",
      "publishConfig": { "access": "public" },
      "repository": {
        "type": "git",
        "url": "git+https://github.com/apodemakeles/dsh-token-dashboard.git"
      },
      "scripts": {
        "build": "tsc -b && tsdown",
        "watch": "tsdown --watch",
        "typecheck": "tsc -b --pretty false",
        "test": "vitest run"
      }
    }

模板要点说明：

- dsh.client.inject 只放客户端半区直接 import 的官方 client 包；host 半区依赖放 peerDependencies + devDependencies（官方惯例 peer 列表 = dev 列表）。inject 决定浏览器加载顺序，别塞无关项。
- files 显式列 lib/index.js / lib/client.js / lib/types/**/*.d.ts + cordis.patch.yml + 三个 README + LICENSE；src 可选带上（社区 aionui-panel 带了 src 便于调试）。
- publishConfig.access: public 必须有（scoped 包默认 restricted）。官方 MIT 包都有；社区包漏写但靠 publish 参数补齐——本插件显式写。
- engines 可选；若要写，用社区同款 "node": "^22.19.0 || >=24.0.0"（对齐 DSH 要求的 Node）。
- cordis.patch.yml 内容（本插件）：

        - insert:
            - id: token-dashboard                         # 任意 cordis id
              name: '@apodemakeles/dsh-token-dashboard'   # 包名 = 模块 + 客户端路由 id

---

## 七、发布流程（npm publish 前）

1. build：pnpm build（= tsc -b && tsdown）→ 产出 lib/index.js（host）、lib/client.js（browser，会被 /plugins/<pkg>/client.js 直接 serve）、lib/types/**（d.ts）。缺 client.js 会让用户启动即崩（第三节报错文案）。
2. 写三份 README：README.md（英）、README.zh.md（中）、README.i18n.yaml（两者 git blob hash 配对记录，第二节）。README 必须含：安装命令（npm + 重启）、配置说明、功能说明/截图、Known Limitations。
3. LICENSE：MIT 全文。
4. files 白名单核对：确保 cordis.patch.yml、lib/client.js、README/LICENSE 都在发布包里（npm pack --dry-run 检查）。
5. publish：npm publish --access public（publishConfig 已带 access，也可省 flag）。scoped + MIT，无私有 registry 问题。
6. 不 commit 到 ~/.dsh / profile；仓库发布物只有 package + lib + cordis.patch.yml + README/LICENSE。

---

## 八、README 安装说明写法（给用户）

    ## 安装

    dsh plugin --profile web add @apodemakeles/dsh-token-dashboard

    安装后**重启 dsh web**，打开任意项目会话，点击侧边栏「Token」入口即可看到热力图面板。

    ## 从仓库开发调试

    git clone https://github.com/apodemakeles/dsh-token-dashboard.git
    cd dsh-token-dashboard
    pnpm install && pnpm build
    dsh plugin --profile web add link:$(pwd)
    （相对/绝对路径 spec 会被 dsh 锚定到当前目录，见第四节）

关键点：必须写明「重启 dsh web」（三份社区 README 一致如此）；开发期热更新只覆盖 bundle 内容且需 pnpm run dev:web，新增插件仍需重启。

---

## 九、version 策略结论

- 首版 0.1.0，不要 1.0.0。理由：DSH 全系官方包仍是 0.1.0-rc.6（pre-1.0）；社区生态（aionui-panel、live-stats、ssh 等）都在 0.1.x；对 peer 用 ^0.1.0-rc.6 天然兼容。map 的「v1.0.0」是目的地（功能稳定、双语、MIT、公开仓库后），不是首版起点。
- peer 版本 pin 固定 ^0.1.0-rc.6：官方 peer 全部用 ^0.1.0-rc.6；@deepseek-ai/cordis 用 ^4.0.1。不要 pin 到 0.1.0-rc.6 精确（^ 允许 rc 小版本滚动）。
- dependencies 里的纯库（zod/schemastery）照官方/社区版本：zod ^4.4.3、schemastery ^3.18.0。

---

## 附：证据文件清单

- 参考实现 package.json / README / LICENSE / cordis.patch.yml / 目录：/Users/caozheng/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-aionui-panel/
- token 同类 + 三语 README：.../@linxin666/dsh-live-stats/
- 侧边栏+工具范例：.../@linxin666/dsh-ssh/
- 聚合 bundle：.../@linxin666/dsh-web-ui-all/package.json、cordis.patch.yml
- CLI 插件语义：/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/plugin-9h8shc4d.js、lib/bin.js
- 客户端发现机制：.../dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js
- 官方包惯例：.../dsh/node_modules/@deepseek-ai/dsh-{web-app,base,token-meter,session-projection,client-modules}/package.json
- 本机 profile 安装形态：/Users/caozheng/.dsh/profiles/web/{package.json,cordis.patch.yml,cordis.yml,pnpm-workspace.yaml,pnpm-lock.yaml}、/Users/caozheng/.dsh/cordis.patch.yml
