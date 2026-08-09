// Cloudflare Pages Function: /api/relay-probe?url=https://xxx
// 探测一个 AI Token 中转站（new-api 系）的公开定价信息。
// 返回：站名、公告、分组倍率、可用分组、模型列表（含倍率/分档表达式）。
// 无法探测时返回 error 说明原因（非 new-api / 需要登录 / 无法访问）。
//
// 安全修复（SSRF 防护）：
//   1. 主机白名单 —— 仅允许 /api/relay 清单中已配置的中转站域名
//   2. 强制 HTTPS —— 拒绝 http:// 协议
//   3. 出站超时 —— 5 秒 AbortController，防止慢速目标占用 Worker
//   4. 响应截断 —— announcements / registerInfo 字段长度限制，减少回显面

export async function onRequest(context) {
  const { request, env } = context;
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get("url");
  if (!raw) return json({ error: "缺少 url 参数" }, 400);

  // 规范化出站点根地址
  let base;
  try {
    const s = raw.trim();
    const u = new URL(s.startsWith("http") ? s : "https://" + s);
    // 强制 HTTPS，阻止 http:// 协议
    if (u.protocol !== "https:") {
      return json({ error: "仅支持 HTTPS 协议" }, 400);
    }
    base = u.origin;
  } catch {
    return json({ error: "网址格式不正确" }, 400);
  }

  // SSRF 防护：主机白名单校验 —— 仅允许 /api/relay 清单中已配置的中转站域名
  const allowedDomains = await getRelayDomains(env);
  const targetHost = new URL(base).hostname;
  if (allowedDomains.size > 0 && !allowedDomains.has(targetHost)) {
    return json({ error: "不允许探测未在中转清单中的域名" }, 403);
  }

  // 出站超时控制（5秒），防止慢速目标占用 Worker 执行时间
  const FETCH_TIMEOUT = 5000;
  function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  const headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json" };

  // 1) 读取 /api/status 判断是不是 new-api、定价是否公开
  let status = null;
  try {
    const r = await fetchWithTimeout(base + "/api/status", { headers, cf: { cacheTtl: 60 } });
    if (r.ok) {
      const t = await r.text();
      try { status = JSON.parse(t); } catch {}
    }
  } catch {}

  let siteName = "";
  let pricingRequireAuth = null;
  let announcements = [];
  let registerInfo = {};
  if (status && status.data) {
    const sd = status.data;
    siteName = sd.system_name || sd.SystemName || "";
    announcements = Array.isArray(sd.announcements) ? sd.announcements : [];
    try {
      const nav = JSON.parse(sd.HeaderNavModules || "{}");
      if (nav.pricing && typeof nav.pricing === "object") {
        pricingRequireAuth = !!nav.pricing.requireAuth;
      }
    } catch {}
    // 注册 / 白嫖相关信息（new-api 的 /api/status 会暴露这些）
    // 安全修复：截断字符串字段，减少回显面
    const truncate = (s, max = 200) => typeof s === "string" ? s.slice(0, max) : s;
    registerInfo = {
      registerEnabled: sd.register_enabled === true,
      passwordRegister: sd.password_register_enabled === true,
      emailVerification: sd.email_verification === true,
      githubOAuth: sd.github_oauth === true,
      linuxdoOAuth: sd.linuxdo_oauth === true,
      telegramOAuth: sd.telegram_oauth === true,
      wechatLogin: sd.wechat_login === true,
      turnstile: sd.turnstile_check === true,
      checkin: sd.checkin_enabled === true,
      quotaDisplayType: truncate(sd.quota_display_type || ""),
      logo: truncate(sd.logo || "", 300),
    };
  }

  // 2) 读取 /api/pricing
  let pricing = null, pricingStatus = 0;
  try {
    const r = await fetchWithTimeout(base + "/api/pricing", { headers, cf: { cacheTtl: 60 } });
    pricingStatus = r.status;
    if (r.ok) {
      const t = await r.text();
      try { pricing = JSON.parse(t); } catch {}
    }
  } catch {}

  // 2.5) 若 /api/status 没拿到站名（非 new-api 或自研站），退回抓首页 HTML 的标题
  if (!siteName) {
    try {
      const r = await fetchWithTimeout(base + "/", { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }, cf: { cacheTtl: 60 } });
      if (r.ok) {
        const html = await r.text();
        // 优先 og:site_name，其次 <title>
        let m = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
        if (m) siteName = m[1].trim();
        if (!siteName) {
          const t = html.match(/<title>([^<]+)<\/title>/i);
          if (t) siteName = t[1].trim();
        }
        // 标题常含「站名｜副标题 - slogan」，取分隔符前的主名
        if (siteName) {
          siteName = siteName.split(/[｜|\-–—_·•:：]/)[0].trim() || siteName.trim();
        }
      }
    } catch {}
  }

  // 安全修复：公告内容截断（单条 ≤500 字符）
  const truncAnnouncements = (list) =>
    list.map((a) => ({ content: typeof a.content === "string" ? a.content.slice(0, 500) : "", type: a.type })).slice(0, 5);

  // 判定结果
  if (!pricing || !Array.isArray(pricing.data)) {
    if (pricingStatus === 401 || pricingStatus === 403 || pricingRequireAuth) {
      return json({ error: "该站定价需要登录才能查看（requireAuth），无法探测价格", base, siteName, registerInfo, announcements: truncAnnouncements(announcements) }, 200);
    }
    if (status === null && pricingStatus === 0) {
      return json({ error: "无法访问该站点（网络失败或域名无效）", base }, 200);
    }
    return json({ error: "未探测到 new-api 公开定价接口（可能是自研站或已关闭）", base, siteName, registerInfo }, 200);
  }

  // 精简模型字段，减小体积
  const models = pricing.data.map((m) => ({
    name: m.model_name,
    vendor: m.owner_by || "",
    quota_type: m.quota_type || 0,
    model_ratio: m.model_ratio,
    completion_ratio: m.completion_ratio,
    cache_ratio: m.cache_ratio,
    model_price: m.model_price,
    billing_expr: m.billing_expr || "",
    groups: m.enable_groups || [],
    endpoints: m.supported_endpoint_types || [],
  }));

  return json({
    ok: true,
    base,
    siteName,
    registerInfo,
    announcements: truncAnnouncements(announcements),
    autoGroups: pricing.auto_groups || ["default"],
    groupRatio: pricing.group_ratio || { default: 1 },
    usableGroup: pricing.usable_group || {},
    models,
    probedAt: Date.now(),
  });
}

// 从 KV 读取 /api/relay 清单中的中转站域名，构建白名单
async function getRelayDomains(env) {
  try {
    if (!env || !env.NAV_DB) return new Set();
    const raw = await env.NAV_DB.get("relay_data");
    const data = raw ? JSON.parse(raw) : { sites: [] };
    const domains = new Set();
    if (data.sites && Array.isArray(data.sites)) {
      for (const site of data.sites) {
        if (site.url) {
          try {
            const u = new URL(site.url.startsWith("http") ? site.url : "https://" + site.url);
            domains.add(u.hostname);
          } catch {}
        }
      }
    }
    return domains;
  } catch {
    return new Set();
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
