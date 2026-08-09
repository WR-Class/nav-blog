# error_memory.md — 错误记忆

## 0. 安全审计修复（2026-08-08）

- **H-1 管理后台无服务端鉴权**：`_middleware.js` 拦截 `/manage/*`、`/*-admin/*`、`/blog-editor/*`，无 `admin_session` Cookie 重定向到 `/admin/`。Cookie 由 `/api/verify` 登录成功后下发（HttpOnly+Secure+SameSite=Lax），值=`sha256(password+salt)`
- **M-1 无频控**：`/api/verify` 同 IP 1 小时内失败 5 次锁定 1 小时（KV `rl:verify:<ip>` + TTL 3600s）
- **M-2 relay 泄露 _probe**：`/api/relay` GET 响应改用白名单字段过滤，`_probe`/`quotaPerUnit`/`usdExchangeRate`/`docsLink`/`serverAddress` 不进公开响应
- **M-3 安全头缺失**：`public/_headers` 配置 CSP/HSTS/X-Frame-Options:SAMEORIGIN/Permissions-Policy/COOP
- **L-1 robots.txt**：sitemap 改为 `https://wurong.cc.cd/sitemap-index.xml`
- **L-3 外链无 SRI**：CSP 已限制脚本源白名单（`cdn.tailwindcss.com`/`uicdn.toast.com`/`cdn.jsdelivr.net`），版本固定+SRI 留后续
- **适用范围**：`functions/_middleware.js`、`functions/api/verify.js`、`functions/api/relay.js`、`public/_headers`、`public/robots.txt`

## 0b. 渗透测试报告漏洞修复（2026-08-09）

- **M-1 `/api/relay-probe` SSRF**：该端点接受任意公网 URL 并发起出站请求，可被用于端口扫描和公网内容盲读。修复：主机白名单（仅允许 `/api/relay` KV 清单中的域名）、强制 HTTPS、5 秒超时（AbortController）、响应字段截断
- **M-2 `/api/translate` 无限制代理滥用**：该端点无鉴权/频控/大小限制，攻击者可耗尽 DeepL 配额。修复：Referer 校验（仅自有域名）、批量上限 20 条、单条 ≤5000 字符、IP 频控 60 次/分钟
- **L-3 `/api/favicon` 任意域请求**：接受任意域名参数（虽仅查询 Google/DDG 图标服务，风险低）。修复：拒绝内网/私有 IP 和 localhost
- **中间件频控**：`_middleware.js` 对 `/api/relay-probe` 加 IP 频控 30 次/分钟
- **适用范围**：`functions/api/relay-probe.js`、`functions/api/translate.js`、`functions/api/favicon.js`、`functions/_middleware.js`
- **注意事项**：`/api/translate` 的 Referer 校验要求前端调用时必须携带 Referer 头。若未来新增调用翻译 API 的页面，需确保该页面的 URL 在 `allowedOrigins` 白名单中

## 1. 重新翻译按钮点击无反应

- **重复出现**：用户多次反馈"点击重新翻译没有任何提示"
- **根因**：`retranslate` 函数已完整定义（含计时器、进度提示、轮询逻辑），但事件绑定区遗漏了 `$('#retranslateBtn').onclick = retranslate;` 这一行，导致按钮点击后不触发任何函数
- **解法**：在事件绑定区补上 `$('#retranslateBtn').onclick = retranslate;`
- **下次避免**：新增按钮时，必须在事件绑定区同步添加 onclick 绑定，并对照 HTML 中所有 `id="xxxBtn"` 的元素逐一检查是否都有对应绑定
- **适用范围**：`public/blog-editor/index.html` 及所有包含按钮的纯 HTML 后台页面
- **修复时间**：2026-08-08

## 6. CSP 拦截 Toast UI 编辑器 CSS 导致博客编辑器无样式

- **现象**：博客编辑器（`/blog-editor/`）的 Toast UI 编辑器工具栏、按钮、编辑区全部无样式，控制台报 CSP 错误
- **根因**：`public/_headers` 中的 CSP `style-src` 指令只允许 `cdn.tailwindcss.com`，未包含 `uicdn.toast.com`，导致 `https://uicdn.toast.com/editor/latest/toastui-editor.min.css` 被浏览器拦截
- **解法**：在 `style-src` 中添加 `uicdn.toast.com`
- **下次避免**：新增外部 CSS 资源时，必须同步更新 `_headers` 中的 CSP `style-src` 白名单；新增外部 JS 资源时同步更新 `script-src` 白名单
- **适用范围**：`public/_headers`，所有通过 `<link>` 或 `<script>` 引用外部 CDN 资源的页面
- **修复时间**：2026-08-10

## 2. 博客详情页 308 重定向导致加载失败

- **现象**：点击博客列表中的文章，显示"文章加载失败或不存在"
- **根因**：博客列表链接 `/blog/post?slug=xxx` 缺少尾部斜杠，Cloudflare Pages 返回 308 重定向，导致客户端 JS 读取 slug 参数失败
- **解法**：链接改为 `/blog/post/?slug=xxx`（加尾部斜杠）
- **下次避免**：Cloudflare Pages 静态页面链接一律加尾部斜杠
- **修复时间**：2026-08-08

## 3. 翻译超时（Cloudflare 30s 函数限制）

- **现象**：博客文章保存或重新翻译时，后端翻译整篇文章超过 Cloudflare Pages Function 30 秒限制，请求超时
- **根因**：后端一次性翻译整篇 Markdown 正文（分块+并行+清理扫描），文章较长时总耗时超过 30 秒
- **解法**：改为前端驱动翻译——前端按行分批（每批 6 行）调用 `/api/translate` 短请求，翻译完成后通过 `save-translation` 接口保存结果到 KV
- **下次避免**：Cloudflare Pages Function 有 30 秒硬限制，长耗时任务必须拆分为前端驱动的多次短请求
- **适用范围**：所有涉及长文本翻译或批量操作的后台功能
- **修复时间**：2026-08-08

## 4. 单个 DeepL Key 额度用完导致翻译全部失败

- **现象**：DeepL Free Key 每月 50 万字符额度用完后，翻译请求返回 403/429，导致所有翻译失败
- **根因**：只配置了单个 DeepL Key，没有轮换机制
- **解法**：新增 `DEEPL_API_KEYS` 环境变量（逗号分隔多个 Key），`deeplTranslate` 函数逐个 Key 尝试，403/429 自动切下一个；全部失败回退 Google Translate
- **下次避免**：依赖第三方 API 配额的功能必须支持多 Key 轮换 + 备用引擎回退
- **适用范围**：`functions/api/translate.js`、`functions/api/blog.js` 中的所有翻译函数
- **修复时间**：2026-08-08

## 5. GitHub API 403 限流

- **现象**：迁移工具调用 GitHub API 获取文件列表时返回 403
- **根因**：未认证的 GitHub API 请求有严格速率限制（每小时 60 次）
- **解法**：在迁移工具中添加 GitHub Token 输入框，请求头携带 `Authorization: token <token>`
- **下次避免**：调用 GitHub API 时必须携带 Token
- **修复时间**：2026-08-08
