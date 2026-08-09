// Cloudflare Pages Middleware
// 功能 1: wurong.bot.cd 域名迁移提示 + 统计
// 功能 2: 管理后台服务端鉴权（H-1 修复）—— 无有效 Cookie 拦截 admin 页面
// 功能 3: 敏感 API 端点频控 —— /api/relay-probe 每分钟 30 次/IP（SSRF 防护）

const OLD_DOMAIN = "wurong.bot.cd";
const NEW_DOMAIN = "wurong.cc.cd";
const STATS_KEY = "stats:domain_visits";
const COOKIE_NAME = "admin_session";
const COOKIE_SALT = "wurong_admin_2026";

// 需要服务端鉴权的路径前缀
const ADMIN_PATHS = [
  "/manage",
  "/stats-admin",
  "/nav-admin",
  "/github-admin",
  "/relay-admin",
  "/blog-editor",
];

export async function onRequest(context) {
  const { request, env, next } = context;
  const host = request.headers.get("host") || "";
  const url = new URL(request.url);

  // ========== 功能 1: wurong.bot.cd 域名迁移 ==========
  if (host === OLD_DOMAIN) {
    return handleOldDomain(request, env, url);
  }

  // ========== 功能 2: 管理后台服务端鉴权 ==========
  const isAdminPath = ADMIN_PATHS.some((p) => url.pathname.startsWith(p));

  if (isAdminPath) {
    // 未配置密码时放行（避免锁死，但此时站点本身无法正常工作）
    if (!env.ADMIN_PASSWORD) {
      return next();
    }

    const cookieValid = await checkAdminCookie(request, env);
    if (!cookieValid) {
      // HTML 请求：重定向到登录页
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/html")) {
        return Response.redirect(
          "https://" + (host || NEW_DOMAIN) + "/admin/",
          302
        );
      }
      // 非 HTML 请求：返回 401
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  // ========== 功能 3: 敏感 API 端点频控 ==========
  // /api/translate 已在函数内部实现频控，此处仅对 /api/relay-probe 做频控
  // relay-probe 每分钟 30 次/IP，防止端口扫描和 Worker 时间 DoS
  if (url.pathname === "/api/relay-probe" && env.NAV_DB) {
    const clientIP = request.headers.get("cf-connecting-ip") || "unknown";
    const rateLimitKey = `rl:relay-probe:${clientIP}`;
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 30;
    try {
      const raw = await env.NAV_DB.get(rateLimitKey);
      const entries = raw ? JSON.parse(raw) : [];
      const recent = entries.filter((t) => now - t < windowMs);
      if (recent.length >= maxRequests) {
        return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
          status: 429,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      recent.push(now);
      await env.NAV_DB.put(rateLimitKey, JSON.stringify(recent.slice(-maxRequests * 2)), {
        expirationTtl: 120,
      });
    } catch {}
  }

  return next();
}

// ========== Cookie 校验 ==========
async function checkAdminCookie(request, env) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[COOKIE_NAME];
  if (!sessionCookie) return false;

  const expectedValue = await sha256(env.ADMIN_PASSWORD + COOKIE_SALT);
  return sessionCookie === expectedValue;
}

function parseCookies(header) {
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = val;
    }
  });
  return cookies;
}

// ========== SHA-256 ==========
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ========== wurong.bot.cd 域名迁移处理 ==========
async function handleOldDomain(request, env, url) {
  // 统计访问量
  if (env.NAV_DB) {
    try {
      const raw = await env.NAV_DB.get(STATS_KEY);
      const stats = raw ? JSON.parse(raw) : {};
      const today = new Date().toISOString().slice(0, 10);
      if (!stats[OLD_DOMAIN]) stats[OLD_DOMAIN] = { total: 0, daily: {} };
      stats[OLD_DOMAIN].total = (stats[OLD_DOMAIN].total || 0) + 1;
      stats[OLD_DOMAIN].daily[today] = (stats[OLD_DOMAIN].daily[today] || 0) + 1;
      stats[OLD_DOMAIN].lastVisit = new Date().toISOString();
      env.NAV_DB.put(STATS_KEY, JSON.stringify(stats));
    } catch {}
  }

  const accept = request.headers.get("accept") || "";
  const isHtml = accept.includes("text/html");
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|webp|avif|xml|txt|map)$/i.test(url.pathname);
  const isApi = url.pathname.startsWith("/api/");
  const redirectUrl = "https://" + NEW_DOMAIN + url.pathname + url.search;

  // API 和静态资源：直接 302 跳转
  if (isApi || isAsset) {
    return Response.redirect(redirectUrl, 302);
  }

  // HTML 页面：显示迁移提示页
  if (isHtml) {
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

  return Response.redirect(redirectUrl, 302);
}
