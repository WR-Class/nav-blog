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
