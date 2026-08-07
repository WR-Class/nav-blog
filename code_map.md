# code_map.md — 代码地图

## 前端页面（src/pages/）

| 文件 | 作用 | 说明 |
|------|------|------|
| `index.astro` | 首页（导航书签） | 客户端 fetch `/api/nav` 渲染导航卡片 |
| `blog.astro` | 博客列表页 | 客户端 fetch `/api/blog` 渲染文章列表 |
| `blog/post.astro` | 博客详情页 | 通过 `_redirects` 重写，客户端 fetch `/api/blog?slug=xxx` + marked.js 渲染 |
| `github.astro` | GitHub 项目专区 | 客户端 fetch `/api/github` 渲染项目卡片 |
| `gh.astro` | GitHub 专区（备用入口） | 轻量版 GitHub 项目展示 |
| `relay.astro` | Token 中转页 | 展示中转服务状态 |
| `relay-probe.astro` | 中转探测页 | 探测中转节点延迟 |
| `about.astro` | 关于页 | 静态内容 |
| `404.astro` | 404 页面 | 静态内容 |

## 后台管理（public/）

统一入口架构：`/admin/`（登录）→ `/manage/`（统一面板，iframe 内嵌各子页面）

| 文件 | 作用 | 鉴权方式 | 直接访问行为 |
|------|------|----------|-------------|
| `admin/index.html` | 登录页（唯一登录入口） | `/api/verify` 校验密码 | 登录后跳转 `/manage/` |
| `manage/index.html` | 统一管理面板（iframe 容器，5 个页签） | `nav_pwd` + `admin_logged_in`，未登录跳 `/admin/` | 需登录才能访问 |
| `nav-admin/index.html` | 导航管理（🧭 导航页签） | `nav_pwd` (sessionStorage) | iframe 检测，重定向到 `/manage/#nav` |
| `github-admin/index.html` | GitHub 专区管理（🐙 GitHub 页签） | `nav_pwd` | iframe 检测，重定向到 `/manage/#github` |
| `relay-admin/index.html` | Token 中转管理（🔑 Token 中转页签） | `nav_pwd` | iframe 检测，重定向到 `/manage/#relay` |
| `stats-admin/index.html` | 访问统计看板（📊 看板页签） | `nav_pwd` | iframe 检测，重定向到 `/manage/#stats` |
| `blog-editor/index.html` | 博客编辑器（✍️ 博客页签） | `nav_pwd`，通过 `/api/verify` 校验 | iframe 检测，重定向到 `/manage/#blog` |
| `admin/cms/index.html` | 已废弃（原 Decap CMS） | 无 | 重定向到 `/manage/` |

## API Functions（functions/api/）

| 文件 | 路由 | 方法 | 作用 |
|------|------|------|------|
| `nav.js` | `/api/nav` | GET/POST | 导航数据读写 |
| `blog.js` | `/api/blog` | GET/POST | 博客 CRUD + 自动翻译（KV 存储） |
| `blog-image.js` | `/api/blog-image` | GET/POST | 博客图片上传/读取（KV 存储） |
| `github.js` | `/api/github` | GET | GitHub 项目数据 |
| `settings.js` | `/api/settings` | GET/POST | 网站设置（背景图等） |
| `translate-markdown.js` | `/api/translate-markdown` | POST | Markdown 翻译（编辑器预览用） |
| `translate.js` | `/api/translate` | POST | 纯文本翻译（底层接口） |
| `verify.js` | `/api/verify` | POST | 密码校验（登录用） |
| `track.js` | `/api/track` | POST | 访问统计埋点 |
| `go.js` | `/api/go` | GET | 链接跳转（统计点击） |
| `domain-stats.js` | `/api/domain-stats` | GET | 域名访问统计查看（需密码） |

## Middleware（functions/）

| 文件 | 作用 | 说明 |
|------|------|------|
| `_middleware.js` | 域名级拦截 | `wurong.bot.cd` 访问时显示"站点已转移"提示页，5秒后跳转到 `wurong.cc.cd`；API/静态资源直接302跳转；访问量记录到KV |

## KV 数据结构

| Key | 值 | 说明 |
|-----|-----|------|
| `nav_data` | JSON | 导航分类与链接数据 |
| `blog:index` | JSON 数组 | 博客文章元数据列表（列表页用） |
| `blog:post:<slug>` | JSON | 单篇博客完整内容（含中英文正文） |
| `blog:image:<id>` | JSON | 博客图片（base64 + content-type） |
| `tr:v5:<provider>:en:<text>` | string | 翻译缓存 |
| `settings` | JSON | 网站设置 |
| `stats:*` | JSON | 访问统计数据 |
| `stats:domain_visits` | JSON | 旧域名(wurong.bot.cd)访问统计（总量/每日/最后访问时间） |

## 博客文章数据结构（blog:post:<slug>）

```json
{
  "slug": "hello-world",
  "title": "文章标题",
  "titleEn": "English Title",
  "snippet": "摘要",
  "snippetEn": "English snippet",
  "publishDate": "2026-08-06",
  "author": "吾荣",
  "category": "工具调用",
  "tags": ["tag1", "tag2"],
  "image": { "src": "/api/blog-image?id=xxx.png", "alt": "封面说明" },
  "draft": false,
  "body": "中文 Markdown 正文",
  "bodyEn": "English markdown body",
  "updatedAt": 1786123456789
}
```

## 翻译流程

1. 保存博客时，若无手写英文正文（`bodyEn` 为空），自动翻译
2. 翻译优先使用 DeepL（配置了 `DEEPL_API_KEY` 时），否则回退谷歌免费翻译
3. Markdown 翻译保留代码块、表格分隔行、空行不翻译
4. 中文按句号切分到 ≤800 字符的小块，并行翻译（并发 6）
5. 术语表预替换常见口语（白嫖→get free credits 等）
6. 翻译结果缓存到 KV（key: `tr:v5:<provider>:en:<text>`）

## 继续开发从哪开始

- 新增博客功能：修改 `functions/api/blog.js`（API）+ `public/blog-editor/index.html`（编辑器）+ `src/pages/blog/post.astro`（详情页）
- 修改翻译逻辑：`functions/api/blog.js` 中的 `translateMarkdown` / `translateOne` 函数
- 新增后台页面：在 `public/` 下创建目录 + 在 `public/manage/index.html` 注册 tab
- 新增 API：在 `functions/api/` 下创建 `.js` 文件
