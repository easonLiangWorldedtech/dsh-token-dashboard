# DSH 插件发现机制调研

调研时间：2026-08-16

## 结论

要让“正在找 DSH 插件”的用户自动看到本仓库，第一优先级是给 GitHub 仓库添加 **`dsh-plugin` topic**。

DeepSeek Harness 官方 README 明确要求插件仓库添加 `dsh-plugin` topic 以便被发现。当前没有查到 DSH 官方插件市场、独立 registry 或 `dsh plugin search`；官方安装文档显示，`dsh plugin add` 只是把明确给出的包规格交给 pnpm 安装，并不会替用户搜索插件。

截至调研时，本仓库的实时状态是：

- GitHub 仓库公开，description 已包含 DSH、token heatmap 和 DeepSeek Harness，但 **topics 为空**，因此不会出现在 `topic:dsh-plugin` 的仓库集合中。
- `main` 已推送，README 中已有英文/中文介绍、截图和 GitHub 安装命令。
- npm registry 对 `@apodemakeles/dsh-token-dashboard` 返回 `404`，即尚未发布；本地 `package.json` 也尚无 `keywords`。

实时元数据：[GitHub Repository API](https://api.github.com/repos/apodemakeles/dsh-token-dashboard)、[npm Registry](https://registry.npmjs.org/%40apodemakeles%2Fdsh-token-dashboard)、[当前 package.json](https://github.com/apodemakeles/dsh-token-dashboard/blob/main/package.json)。

## DSH 的实际机制

### 是否有官方插件市场或推荐列表

在 DSH 官方 README 和插件发布/安装文档中，没有公开的插件市场、registry 提交流程或官方推荐清单。官方给出的发现方式是给插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic；社区与支持入口则是 GitHub Discussions 和 Discord。

因此更准确的表述是：**目前官方把 GitHub topic 当作插件生态的公开索引，而不是维护一个独立商店。** 这是基于当前公开文档得出的结论；DSH 尚处于 developer preview，后续机制可能变化。

来源：[DSH 官方 README：Community and support](https://github.com/deepseek-ai/deepseek-harness#community-and-support)。

### `dsh plugin add` 会不会自动发现插件

不会。官方文档说明：

1. `dsh plugin --profile <name> <args...>` 在 profile 目录中把参数转交给 pnpm。
2. 用户必须明确提供 npm 包名、本地路径、tarball 或 GitHub 包规格，例如 `github:you/hello-plugin`。
3. 安装后，DSH 检查包中的 `dsh.bundle` manifest，再把 bundle 加进 profile；没有该声明只会作为普通依赖安装。

所以 GitHub topic、npm 搜索等负责“让用户先找到包”，`dsh plugin add` 只负责“安装已知包”。

来源：[DSH 官方插件打包与安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#install-into-a-profile)、[GitHub 安装说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)。

## 建议清单

### 必须

1. **添加 GitHub topic `dsh-plugin`。**

   这是 DSH 官方明确指定的 discoverability 标记。GitHub 会把带有同一 topic 的仓库集中展示，也支持 `topic:dsh-plugin` 查询。当前仓库 topics 为空，这是最直接的缺口。

   建议同时添加：`deepseek-harness`、`dsh`、`token-usage`、`token-dashboard`、`dashboard`、`heatmap`。

   GitHub 网页操作：仓库首页右侧 **About → 齿轮 → Topics**。

   来源：[DSH 官方 README](https://github.com/deepseek-ai/deepseek-harness#community-and-support)、[GitHub Topics 官方说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)、[GitHub 仓库搜索语法](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories#search-by-topic)。

2. **若希望被 npm 用户搜索到，必须把 scoped package 公开发布。**

   当前 npm registry 中不存在该包。公开发布后，用户才能通过 npm 搜索发现并使用更短、更稳定的安装命令：

   ```bash
   dsh plugin --profile web add @apodemakeles/dsh-token-dashboard
   ```

   scoped package 首次公开发布需要 `npm publish --access public`。DSH 官方也推荐发布预构建产物，这样安装时不需要授权执行 Git 依赖的 `prepare` 脚本。

   来源：[npm scoped public package 发布文档](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)、[DSH 官方 npm 分发建议](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md#installing-from-github-the-build-script-catch)。

### 收益高

1. **在发布 npm 前补充 `package.json.keywords`。**

   建议值：

   ```json
   "keywords": [
     "dsh-plugin",
     "deepseek-harness",
     "dsh",
     "token-usage",
     "token-dashboard",
     "dashboard",
     "heatmap"
   ]
   ```

   npm 官方说明，搜索会匹配 package title、description、README 和 keywords；新包最多可能需要两周才进入搜索结果。包名和现有 description 已经有价值，但 keywords 可以覆盖用户常用的不同查询词。

   来源：[npm 搜索机制](https://docs.npmjs.com/searching-for-and-choosing-packages-to-download/)、[npm package.json 的 description/keywords](https://docs.npmjs.com/cli/configuring-npm/package-json/#keywords)。

2. **把 GitHub description 改成更贴近用户搜索词的一句话。**

   建议：

   > DeepSeek Harness (DSH) plugin: local daily/weekly token usage dashboard and heatmap

   GitHub 默认仓库搜索会匹配仓库名、description 和 topics；README 只有在查询使用 `in:readme` 时才参与。因此 description 应直接包含 `DeepSeek Harness`、`DSH plugin`、`token usage`、`dashboard` 和 `heatmap`，不要只依赖 README。

   来源：[GitHub 仓库搜索范围](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories#search-by-repository-name-description-or-contents-of-the-readme-file)。

3. **npm 发布后立即验证三条发现路径。**

   - GitHub topic 页面：`https://github.com/topics/dsh-plugin`
   - GitHub 查询：`topic:dsh-plugin "token usage"`
   - npm 查询：`dsh plugin`、`deepseek harness token`、`token dashboard`

   npm 搜索索引可能延迟，不能用发布后立即搜不到来判断发布失败；先用 package URL 或 `npm view @apodemakeles/dsh-token-dashboard` 验证发布状态。

### 可选

1. **创建 GitHub Release `v0.1.0`。** 它不会代替 topic 或 npm 搜索，但能让用户更容易识别稳定版本、阅读变更并固定安装版本。
2. **为 npm 元数据补充 `homepage` 和 `bugs`。** 它们不是主要搜索字段，但能把 npm 用户引回 README 和 Issues，提高找到后的转化率。
3. **设置 GitHub social preview。** 截图已具备，可提升链接在社交平台分享时的辨识度；它不影响 `topic:dsh-plugin` 搜索。
4. **在 DSH 官方 Discussions/Discord 发布一次介绍。** 这属于人工曝光，不是自动索引，但它们是官方 README 指向的社区入口。

## 建议执行顺序

1. 立即添加 `dsh-plugin` 等 GitHub topics。
2. 优化 GitHub description。
3. 给 `package.json` 添加 keywords、homepage、bugs，并发布 npm 公共包。
4. 等待 npm 索引后验证搜索结果。
5. 创建 GitHub Release，再去 DSH 官方社区做一次发布介绍。

做到第 1 步，仓库就进入 DSH 官方指定的自动发现链；做到第 3 步，则同时覆盖 GitHub topic 与 npm 搜索两条主要入口。
