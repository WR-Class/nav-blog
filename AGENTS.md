# AGENTS.md — 吾荣小屋 (nav-blog) 项目入口索引

## 项目用途

个人导航 + 技术博客网站，部署在 Cloudflare Pages。
- 导航数据、博客内容、设置等动态数据存储在 Cloudflare KV（绑定变量名 `NAV_DB`）
- 前端使用 Astro 5 + Tailwind CSS 4 静态生成
- 后台管理面板为独立 HTML 页面，通过 `/api/*` Functions 读写 KV

## 文档索引

| 文档 | 用途 |
|------|------|
| `AGENTS.md` | 本文件，项目入口索引 |
| `code_map.md` | 代码地图（功能→文件→作用） |
| `progress.md` | 进度记录 |
| `error_memory.md` | 错误记忆（重复问题与解法） |

## 代码地图入口

- 前端页面：`src/pages/`（Astro 静态页面）
- 后台管理：`public/*-admin/`、`public/blog-editor/`、`public/manage/`（纯 HTML）
- API Functions：`functions/api/`（Cloudflare Pages Functions）
- 内容集合：`src/content/`（已弃用，博客内容迁移到 KV）

## 环境变量（Cloudflare Pages）

| 变量名 | 用途 |
|--------|------|
| `NAV_DB` | KV 命名空间绑定 |
| `ADMIN_PASSWORD` | 后台管理密码（所有 `/api/*` POST 写操作校验） |
| `DEEPL_API_KEY` | DeepL 翻译 API 密钥（可选，未配置时回退谷歌翻译） |
| `GITHUB_TOKEN` | GitHub API 令牌（用于 GitHub 专区数据获取，可选） |

## 禁止修改区域

- `public/assets/` — 静态图片资源，不要删除
- `src/layouts/Layout.astro` 中的背景层、统计埋点逻辑 — 全站共用
- `functions/api/verify.js` — 鉴权接口，所有后台共用

## 注意事项

1. 博客内容已从 GitHub 仓库迁移到 KV 数据库，仓库中不再存储博客正文
2. 博客详情页 `/blog/:slug` 通过 `_redirects` 重写到 `/blog/post`，客户端 JS 读取 slug
3. 所有后台统一使用 `nav_pwd`（sessionStorage）进行密码鉴权
4. 博客翻译支持 DeepL（优先）和谷歌翻译（回退），含术语表和分块并行翻译
5. 迁移完成后需删除 `public/migrate-blog.html` 和 `src/content/` 下的 md 文件
