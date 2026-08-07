// Cloudflare Pages Function: /api/stats  (GET, 需密码)
// 运营看板数据聚合：读取最近 N 天的访问统计 + 各内容模块数量。
// 鉴权：Authorization: Bearer <ADMIN_PASSWORD>（与其它后台一致）。
// query: ?days=30 (默认 30，最大 90)

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "GET") {
    return json({ error: "仅支持 GET" }, 405);
  }
  if (!env.NAV_DB) return json({ error: "未绑定 KV 数据库（NAV_DB）" }, 500);

  // 鉴权
  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return json({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" }, 500);
  if (password !== expected) return json({ error: "密码错误" }, 401);

  const url = new URL(request.url);
  let days = parseInt(url.searchParams.get("days") || "30", 10);
  if (!Number.isFinite(days) || days < 1) days = 30;
  if (days > 90) days = 90;

  // 生成最近 days 天的日期键（含今天，中国标准时间 UTC+8）
  const dayKeys = [];
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  // 并发读取每天的统计
  const results = await Promise.all(
    dayKeys.map((k) =>
      env.NAV_DB.get("stats:day:" + k)
        .then((raw) => (raw ? JSON.parse(raw) : null))
        .catch(() => null)
    )
  );

  const daily = [];
  let totalPv = 0, totalUv = 0, totalSv = 0;
  const pathAgg = {}, refAgg = {}, hourAgg = {}, clickAgg = {};
  let mobile = 0, desktop = 0;

  dayKeys.forEach((k, i) => {
    const s = results[i] || { pv: 0, uv: 0, sv: 0, paths: {}, refs: {}, dev: { mobile: 0, desktop: 0 }, hours: {} };
    daily.push({ date: k, pv: s.pv || 0, uv: s.uv || 0, sv: s.sv || 0 });
    totalPv += s.pv || 0; totalUv += s.uv || 0; totalSv += s.sv || 0;
    mergeAdd(pathAgg, s.paths); mergeAdd(refAgg, s.refs); mergeAdd(hourAgg, s.hours);
    if (s.clicks) {
      for (const [id, item] of Object.entries(s.clicks)) {
        if (!clickAgg[id]) clickAgg[id] = { title: item.title || id, count: 0, kind: item.kind || "nav" };
        clickAgg[id].title = item.title || clickAgg[id].title;
        clickAgg[id].kind = item.kind || clickAgg[id].kind;
        clickAgg[id].count += Number(item.count) || 0;
      }
    }
    if (s.dev) { mobile += s.dev.mobile || 0; desktop += s.dev.desktop || 0; }
  });

  // 今日 / 昨日快捷值
  const today = daily[daily.length - 1] || { pv: 0, uv: 0, sv: 0 };
  const yesterday = daily[daily.length - 2] || { pv: 0, uv: 0, sv: 0 };

  // 内容模块数量（运维概览）
  const [navRaw, ghRaw, relayRaw, settingsRaw] = await Promise.all([
    env.NAV_DB.get("nav_data").catch(() => null),
    env.NAV_DB.get("github_data").catch(() => null),
    env.NAV_DB.get("relay_data").catch(() => null),
    env.NAV_DB.get("site_settings").catch(() => null),
  ]);
  let navCats = 0, navLinks = 0, ghProjects = 0, relaySites = 0;
  try {
    const n = navRaw ? JSON.parse(navRaw) : { categories: [] };
    navCats = (n.categories || []).length;
    navLinks = (n.categories || []).reduce((sum, c) => sum + ((c.links || []).length), 0);
  } catch {}
  try { ghProjects = (JSON.parse(ghRaw || "{}").projects || []).length; } catch {}
  try { relaySites = (JSON.parse(relayRaw || "{}").sites || []).length; } catch {}
  let hasBg = false;
  try { hasBg = !!(JSON.parse(settingsRaw || "{}").backgroundUrl); } catch {}

  return json({
    ok: true,
    range: { days, from: dayKeys[0], to: dayKeys[dayKeys.length - 1] },
    totals: { pv: totalPv, uv: totalUv, sv: totalSv },
    today, yesterday,
    daily,
    topPaths: topN(pathAgg, 15),
    topRefs: topN(refAgg, 12),
    devices: { mobile, desktop },
    hours: hourAgg,
    topClicks: Object.values(clickAgg).sort((a, b) => b.count - a.count).slice(0, 30),
    content: { navCategories: navCats, navLinks, githubProjects: ghProjects, relaySites, hasBackground: hasBg },
    generatedAt: Date.now(),
  });
}

function mergeAdd(dst, src) {
  if (!src) return;
  for (const k in src) dst[k] = (dst[k] || 0) + src[k];
}
function topN(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
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
