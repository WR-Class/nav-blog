// Cloudflare Pages Function: /api/go?id=链接ID
// 记录导航链接点击后，再跳转到 KV 中保存的原始 URL。
const DAY_TTL = 60 * 60 * 24 * 120;

export async function onRequest(context) {
  const { request, env } = context;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!env.NAV_DB || !id) return new Response("链接不存在", { status: 404 });

  let target = "";
  let title = id;
  let kind = "nav";
  try {
    if (id === "shop") {
      target = "https://pay.ldxp.cn/shop/EQT7J0I3";
      title = "吾荣小店";
      kind = "shop";
    }
    const [navRaw, relayRaw] = await Promise.all([
      env.NAV_DB.get("nav_data"), env.NAV_DB.get("relay_data")
    ]);
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
