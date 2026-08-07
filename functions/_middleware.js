// Cloudflare Pages Middleware: 域名级拦截
// 1. 统计 wurong.bot.cd 的访问量（存 KV）
// 2. wurong.bot.cd 访问时显示"站点已转移"提示页，5 秒后自动跳转到 wurong.cc.cd

const OLD_DOMAIN = "wurong.bot.cd";
const NEW_DOMAIN = "wurong.cc.cd";
const STATS_KEY = "stats:domain_visits";

export async function onRequest(context) {
  const { request, env, next } = context;

  // 获取访问域名
  const host = request.headers.get("host") || "";

  // 只处理 wurong.bot.cd 的请求
  if (host !== OLD_DOMAIN) {
    return next();
  }

  // ---------- 统计访问量（不阻塞主流程）----------
  if (env.NAV_DB) {
    try {
      const raw = await env.NAV_DB.get(STATS_KEY);
      const stats = raw ? JSON.parse(raw) : {};
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      if (!stats[OLD_DOMAIN]) stats[OLD_DOMAIN] = { total: 0, daily: {} };
      stats[OLD_DOMAIN].total = (stats[OLD_DOMAIN].total || 0) + 1;
      stats[OLD_DOMAIN].daily[today] = (stats[OLD_DOMAIN].daily[today] || 0) + 1;
      stats[OLD_DOMAIN].lastVisit = new Date().toISOString();
      // fire-and-forget：不 await，避免拖慢响应
      env.NAV_DB.put(STATS_KEY, JSON.stringify(stats));
    } catch {}
  }

  // ---------- 判断请求类型 ----------
  const accept = request.headers.get("accept") || "";
  const url = new URL(request.url);
  const isHtml = accept.includes("text/html");
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|webp|avif|xml|txt|map)$/i.test(url.pathname);
  const isApi = url.pathname.startsWith("/api/");

  // API 和静态资源：直接 302 跳转，不显示提示页
  if (isApi || isAsset) {
    const redirectUrl = "https://" + NEW_DOMAIN + url.pathname + url.search;
    return Response.redirect(redirectUrl, 302);
  }

  // HTML 页面：显示"站点已转移"提示页，5 秒后自动跳转
  if (isHtml) {
    const redirectUrl = "https://" + NEW_DOMAIN + url.pathname + url.search;
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>站点已转移 | Site Moved</title>
<meta http-equiv="refresh" content="5;url=${redirectUrl}">
<link rel="canonical" href="${redirectUrl}">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff}
  .card{background:#fff;color:#1e293b;border-radius:20px;padding:48px 40px;max-width:480px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)}
  .icon{font-size:56px;margin-bottom:16px}
  h1{font-size:24px;font-weight:700;margin-bottom:8px}
  .sub{color:#64748b;font-size:15px;margin-bottom:24px;line-height:1.6}
  .new-domain{display:inline-block;background:#fef3c7;color:#92400e;padding:8px 20px;border-radius:8px;font-weight:600;font-size:16px;margin-bottom:24px;word-break:break-all}
  .countdown{color:#64748b;font-size:14px;margin-bottom:20px}
  .countdown strong{color:#ea580c;font-size:18px}
  .btn{display:inline-block;background:#ea580c;color:#fff;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:16px;transition:background .2s}
  .btn:hover{background:#c2410c}
  .en{color:#94a3b8;font-size:13px;margin-top:16px;line-height:1.5}
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🚚</div>
    <h1>站点已转移</h1>
    <p class="sub">本站已迁移至新域名，将在 5 秒后自动跳转<br>请更新您的书签</p>
    <div class="new-domain">${NEW_DOMAIN}</div>
    <p class="countdown"><strong id="cd">5</strong> 秒后自动跳转…</p>
    <a href="${redirectUrl}" class="btn">立即跳转 →</a>
    <p class="en">This site has moved to a new domain.<br>You will be redirected in 5 seconds.</p>
  </div>
  <script>
    let s = 5;
    const el = document.getElementById('cd');
    const t = setInterval(() => { s--; el.textContent = s; if (s <= 0) { clearInterval(t); location.href = '${redirectUrl}'; } }, 1000);
  </script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // 其他请求：直接跳转
  const redirectUrl = "https://" + NEW_DOMAIN + url.pathname + url.search;
  return Response.redirect(redirectUrl, 302);
}
