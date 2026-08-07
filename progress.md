# progress.md — 进度记录

## 2026-08-08 博客系统迁移到 KV + 翻译改进

### 背景

用户反馈两个问题：
1. 博客仓库是公开的，别人可以下载博客文章内容
2. 谷歌免费翻译速度慢且翻译不全

### 解决方案

将博客内容从 GitHub 仓库（公开 md 文件）迁移到 Cloudflare KV 数据库（私有存储），通过 API 接口访问。同时改进翻译逻辑。

### 已完成的工作

1. **新建博客 API**（`functions/api/blog.js`）
   - CRUD 操作：GET 列表/单篇，POST 保存/删除
   - KV 存储：`blog:index`（元数据列表）+ `blog:post:<slug>`（完整内容）
   - 内置翻译：保存时自动翻译英文（支持 DeepL + 谷歌回退）
   - 翻译改进：分块（≤800字符）+ 并行（并发6）+ 术语表 + KV 缓存
   - 鉴权：ADMIN_PASSWORD（公开读，密码写）

2. **新建博客图片 API**（`functions/api/blog-image.js`）
   - 图片上传到 KV（base64 存储，5MB 限制）
   - 公开读取（带 1 年缓存）
   - 密码上传

3. **重写博客列表页**（`src/pages/blog.astro`）
   - 从静态生成改为客户端 fetch `/api/blog` 渲染
   - 支持中英文切换

4. **重写博客详情页**（`src/pages/blog/post.astro`）
   - 删除旧的 `blog/[slug].astro`（依赖 getCollection）
   - 新建静态页面 + `_redirects` 重写 `/blog/:slug` → `/blog/post`
   - 客户端 fetch `/api/blog?slug=xxx` + marked.js 渲染 Markdown
   - 支持中英文切换

5. **重写博客编辑器**（`public/blog-editor/index.html`）
   - 从 GitHub OAuth 改为密码鉴权（`nav_pwd`，与其他后台一致）
   - 从 GitHub API 改为 KV API（`/api/blog`）
   - 图片上传改为 KV（`/api/blog-image`）
   - 新增翻译预览功能（预览后可手动编辑英文）
   - 新增手动英文正文编辑区
   - 新增删除功能

6. **创建迁移工具**（`public/migrate-blog.html`）
   - 从 GitHub 仓库读取现有 md 文件
   - 解析 frontmatter + body
   - POST 到 `/api/blog` 导入 KV
   - 迁移完成后应删除此文件

7. **项目文档**（`AGENTS.md`、`code_map.md`、`progress.md`）
   - 创建项目入口索引
   - 创建代码地图
   - 创建进度记录

### 待用户操作

1. 将代码推送到 GitHub → Cloudflare Pages 自动部署
2. 确认 Cloudflare Pages 环境变量已配置：`NAV_DB`、`ADMIN_PASSWORD`、`DEEPL_API_KEY`（可选）
3. 访问 `/migrate-blog.html`，输入管理密码，执行迁移
4. 确认博客列表和详情页正常工作
5. 确认博客编辑器登录、保存、翻译功能正常
6. 迁移成功后：删除 `public/migrate-blog.html`、删除 `src/content/blog/` 和 `src/content/blog-en/` 下的 md 文件
7. 推送清理后的代码

### 构建测试

- `npm run build` 通过，9 页面构建成功
- `_redirects` 正确输出到 dist
- `blog/post/index.html` 和 `blog/index.html` 正确生成

## 2026-08-08 自动翻译系统 v2 — 永久可靠的翻译机制

### 背景

用户反馈：不只是这次翻译，而是在 AI 不在场时，用户写新博文也要自动翻译，访客点击中英文切换时两边都必须正确。

### 已完成的工作

1. **重构保存流程（`functions/api/blog.js`）**
   - 关键改动：先保存博文到 KV（不含翻译），再执行翻译
   - 防止 Cloudflare 30 秒超时导致博文数据丢失
   - 翻译完成后二次更新 KV 写入翻译结果
   - retranslate 同样先标记 "pending" 再翻译

2. **翻译清理扫描（`cleanupTranslation` 函数）**
   - 翻译完成后扫描结果中残留的中文片段
   - 对每个残留片段用 5 次重试再次翻译
   - 替换成功翻译的片段，减少中文残留

3. **翻译状态追踪完善**
   - 四种状态：`complete`（完整）、`partial`（部分残留）、`pending`（翻译中）、`none`（未翻译）
   - `upsertIndex` 同步写入 `translationStatus` 到索引
   - 编辑器列表显示状态图标：✅⚠️🔄⏳

4. **文章详情页修复（`src/pages/blog/post.astro`）**
   - 英文版分类翻译：添加 `categoryEn` 映射表（工具调用→Tools 等）
   - 页面标题跟随语言切换（英文模式显示英文标题）
   - 翻译状态展示：pending 显示"翻译进行中"，partial 显示警告横幅
   - `langchange` 事件同步更新页面标题

5. **编辑器改进（`public/blog-editor/index.html`）**
   - 保存超时容错：请求失败后检查博文是否已保存，提示用户点击"重新翻译"
   - 翻译状态图标显示在文章列表中
   - 保存提示信息优化（含自动翻译时提示"可能需要 10-30 秒"）
   - 新增 `pending` 状态显示

### 用户需要操作

1. 等待 Cloudflare Pages 自动部署（推送后 1-2 分钟）
2. 从 `wurong.cc.cd` 首页进入后台（`/admin/` 登录 → `/manage/` 统一面板），点击「✍️ 博客」页签，点击「🌐 重新翻译」对现有博文重新翻译
3. 从 `wurong.cc.cd` 访问博客，测试中英文切换效果
4. 以后写新博文保存时将自动翻译，无需 AI 介入

## 2026-08-08 统一后台入口 — 消除多个独立后台页面

### 背景

用户发现后台入口不统一：`/manage/` 和 `/blog-editor/` 都能直接访问，且 `/blog-editor/` 只显示博客编辑器。用户要求所有后台功能（看板、导航、GitHub、Token 中转、博客）统一在 `/manage/` 下，不允许单独入口。

### 问题根因

1. `/manage/index.html` 本身**没有登录保护**，任何人都能直接访问统一面板
2. `/admin/cms/index.html`（废弃的 Decap CMS）**没有 iframe 检测**，是一个独立的后台入口，且有直接链接指向 `/manage/`
3. 登录体验碎片化：用户直接访问 `/manage/` 看到空面板，点页签后子页面各自弹出登录框

### 修复内容

1. **`/manage/index.html` 添加登录保护**
   - 在 `<head>` 最前面加入登录检查脚本
   - 检查 `sessionStorage.nav_pwd` 和 `localStorage.admin_logged_in`
   - 未登录则 `location.replace('/admin/')` 跳转登录页
   - `admin_logged_in` 为 true 但 `nav_pwd` 丢失（新标签页场景）也要求重新登录

2. **`/admin/cms/index.html` 替换为重定向**
   - 移除废弃的 Decap CMS（博客管理已迁移至 KV + 自定义编辑器）
   - 整个文件替换为 `location.replace('/manage/')` 重定向
   - 消除了独立的后台入口和直接链接

3. **子页面 iframe 检测确认正常**
   - 5 个子页面（blog-editor / stats-admin / nav-admin / github-admin / relay-admin）均已有 `window.top===window.self` 检测
   - 直接访问子页面 URL 会自动重定向到 `/manage/#对应页签`

### 修复后的后台入口架构

```
/admin/          → 登录页（唯一登录入口）
/manage/         → 统一管理面板（需登录，否则跳 /admin/）
  ├─ 📊 看板     → iframe 加载 /stats-admin/（直接访问重定向到 /manage/#stats）
  ├─ 🧭 导航     → iframe 加载 /nav-admin/（直接访问重定向到 /manage/#nav）
  ├─ 🐙 GitHub   → iframe 加载 /github-admin/（直接访问重定向到 /manage/#github）
  ├─ 🔑 Token    → iframe 加载 /relay-admin/（直接访问重定向到 /manage/#relay）
  └─ ✍️ 博客     → iframe 加载 /blog-editor/（直接访问重定向到 /manage/#blog）
/admin/cms/      → 重定向到 /manage/（废弃的 Decap CMS 已移除）
```

### 用户需要操作

1. 推送代码到 GitHub → Cloudflare Pages 自动部署
2. 从 `wurong.cc.cd` 首页导航进入后台，测试统一入口是否正常
3. 确认直接访问 `/blog-editor/` 等子页面会自动跳转到 `/manage/`

## 2026-08-08 多 DeepL Key 轮换 + 前端驱动翻译

### 背景

用户反馈翻译超时（Cloudflare 30s 限制），并要求支持配置多个 DeepL Key（一个 free 用完了用另一个）。

### 已完成的工作

1. **多 DeepL Key 轮换（`functions/api/translate.js` + `functions/api/blog.js`）**
   - 新增环境变量 `DEEPL_API_KEYS`（逗号分隔多个 Key）
   - 向后兼容：有 `DEEPL_API_KEYS` 用它，否则回退 `DEEPL_API_KEY`（单个）
   - `deeplTranslate` 函数逐个 Key 尝试，403/429（额度用完/限流）自动切下一个
   - Free Key（以 `:fx` 结尾）自动使用 `api-free.deepl.com`，Pro Key 使用 `api-pro.deepl.com`
   - 全部 Key 失败后回退 Google Translate

2. **前端驱动翻译避免超时（`public/blog-editor/index.html`）**
   - 「重新翻译」改为前端逐行分批翻译（每批 6 行），调用 `/api/translate` 短请求
   - 翻译进度实时显示（已翻译 X / Y 行）
   - 翻译完成后调用 `save-translation` 接口保存结果到 KV
   - 新增 `save-translation` action 在 `blog.js` 中，仅保存翻译结果不触发后端翻译

### 环境变量配置说明

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `DEEPL_API_KEY` | 密钥 | 单个 DeepL Key（向后兼容） |
| `DEEPL_API_KEYS` | 明文 | 多个 DeepL Key，逗号分隔（推荐），Free Key 以 `:fx` 结尾 |

### 用户需要操作

1. 等 Cloudflare Pages 自动部署（推送后 1-2 分钟）
2. 如需多 Key：在 Cloudflare Pages 环境变量中添加 `DEEPL_API_KEYS`，值如 `key1:fx,key2:fx,key3`
3. 从 `wurong.cc.cd` 后台进入博客编辑器，点击「重新翻译」测试
