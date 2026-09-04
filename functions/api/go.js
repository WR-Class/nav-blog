// Cloudflare Pages Function: /api/go?id=链接ID
// 记录导航链接点击后，再跳转到 KV 中保存的原始 URL。
const DAY_TTL = 60 * 60 * 24 * 120;

// 小店地址的兜底值。正常情况下走后台设置（KV site_settings.shopUrl），
// 这里只在「后台还没填过」或「读 KV 失败」时使用，保证入口永不断链。
const SHOP_FALLBACK_URL = "https://pay.ldxp.cn/shop/EQT7J0I3";

export async function onRequest(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!env.NAV_DB || !id) return new Response("链接不存在", { status: 404 });

  let target = "";
  let title = id;
  let kind = "nav";
  try {
    // 三个键一起读。site_settings 只有小店链接用得到，但并发读不额外增加延迟，
    // 比「先读设置再读导航」串行少一个往返。
    const [navRaw, relayRaw, settingsRaw] = await Promise.all([
      env.NAV_DB.get("nav_data"),
      env.NAV_DB.get("relay_data"),
      id === "shop" ? env.NAV_DB.get("site_settings") : Promise.resolve(null),
    ]);

    if (id === "shop") {
      title = "吾荣小店";
      kind = "shop";
      // 后台可改：链动官方换地址后，在 /manage/#nav 里改一次，全站生效
      let shopUrl = "";
      try {
        shopUrl = settingsRaw ? String(JSON.parse(settingsRaw).shopUrl || "").trim() : "";
      } catch {
        /* 设置内容损坏，用兜底地址 */
      }
      target = /^https:\/\//i.test(shopUrl) ? shopUrl : SHOP_FALLBACK_URL;
    }

    const nav = navRaw ? JSON.parse(navRaw) : { categories: [] };
    for (const cat of nav.categories || []) {
      const link = (cat.links || []).find((x) => x.id === id);
      if (link && /^https?:\/\//i.test(link.url || "")) {
        target = link.url; title = link.title || id; break;
      }
    }
    if (!target) {
      const relay = relayRaw ? JSON.parse(relayRaw) : { sites: [] };
      const site = (relay.sites || []).find((x) => x.id === id);
      if (site) {
        target = site.registerUrl || site.url || "";
        title = site.name || site.url || id;
        kind = "relay";
      }
    }
  } catch {}

  // 兜底：id 是 shop 时即使上面整段抛错也要能跳转，不能让小店入口变成 404
  if (!target && id === "shop") target = SHOP_FALLBACK_URL;
  if (!target || !/^https?:\/\//i.test(target)) return new Response("链接不存在或地址无效", { status: 404 });

  // 点击统计按中国标准时间（UTC+8）分日
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const key = "stats:day:" + day;
  try {
    const raw = await env.NAV_DB.get(key);
    const stats = raw ? JSON.parse(raw) : { pv: 0, uv: 0, sv: 0, paths: {}, refs: {}, dev: { mobile: 0, desktop: 0 }, hours: {}, clicks: {} };
    if (!stats.clicks) stats.clicks = {};
    const bucket = stats.clicks[id] || { title, count: 0, kind };
    bucket.title = title;
    bucket.kind = kind;
    bucket.count = (bucket.count || 0) + 1;
    stats.clicks[id] = bucket;
    await env.NAV_DB.put(key, JSON.stringify(stats), { expirationTtl: DAY_TTL });
  } catch {}

  return Response.redirect(target, 302);
}
