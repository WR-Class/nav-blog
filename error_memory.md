# error_memory.md — 错误记忆

## 1. 重新翻译按钮点击无反应

- **重复出现**：用户多次反馈"点击重新翻译没有任何提示"
- **根因**：`retranslate` 函数已完整定义（含计时器、进度提示、轮询逻辑），但事件绑定区遗漏了 `$('#retranslateBtn').onclick = retranslate;` 这一行，导致按钮点击后不触发任何函数
- **解法**：在事件绑定区补上 `$('#retranslateBtn').onclick = retranslate;`
- **下次避免**：新增按钮时，必须在事件绑定区同步添加 onclick 绑定，并对照 HTML 中所有 `id="xxxBtn"` 的元素逐一检查是否都有对应绑定
- **适用范围**：`public/blog-editor/index.html` 及所有包含按钮的纯 HTML 后台页面
- **修复时间**：2026-08-08

## 2. 博客详情页 308 重定向导致加载失败

- **现象**：点击博客列表中的文章，显示"文章加载失败或不存在"
- **根因**：博客列表链接 `/blog/post?slug=xxx` 缺少尾部斜杠，Cloudflare Pages 返回 308 重定向，导致客户端 JS 读取 slug 参数失败
- **解法**：链接改为 `/blog/post/?slug=xxx`（加尾部斜杠）
- **下次避免**：Cloudflare Pages 静态页面链接一律加尾部斜杠
- **修复时间**：2026-08-08

## 3. GitHub API 403 限流

- **现象**：迁移工具调用 GitHub API 获取文件列表时返回 403
- **根因**：未认证的 GitHub API 请求有严格速率限制（每小时 60 次）
- **解法**：在迁移工具中添加 GitHub Token 输入框，请求头携带 `Authorization: token <token>`
- **下次避免**：调用 GitHub API 时必须携带 Token
- **修复时间**：2026-08-08
