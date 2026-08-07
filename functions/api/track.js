// Cloudflare Pages Function: /api/track  (POST)
// 轻量访问统计：把每次前台页面访问累加到 KV 的“按天”桶里。
// 键：stats:day:YYYY-MM-DD -> { pv, uv, sv, paths:{}, refs:{}, dev:{mobile,desktop}, hours:{} }
//   pv=页面浏览量  uv=当日独立访客(前端按天判定)  sv=会话数(前端按会话判定)
// 说明：KV 免费额度约每天 1000 次写入；小站足够。并发写入可能少量丢计数，属正常。
// 不追踪后台(/admin /manage /nav-admin 等静态页不走本布局，天然不计入)。

const DAY_TTL = 60 * 60 * 24 * 120; // 保留约 120 天

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "仅支持 POST" }, 405);
  }
  if (!env.NAV_DB) return json({ ok: false }, 200); // 未绑定 KV 时静默

  let body = {};
  try { body = await request.json(); } catch {}
  let path = typeof body.path === "string" ? body.path.slice(0, 120) : "/";
  const newVisitor = body.newVisitor === true; // 当日首访
  const newSession = body.newSession === true; // 会话首访

  // 不统计后台/管理相关路径（双保险）
  if (/^\/(admin|manage|nav-admin|github-admin|relay-admin|stats-admin)/.test(path)) {
    return json({ ok: true, skipped: true });
  }

  // 来源域名（去掉自身域名）
  let refHost = "";
  try {
    const ref = typeof body.ref === "string" ? body.ref : "";
    if (ref) {
      const rh = new URL(ref).hostname;
      const self = new URL(request.url).hostname;
      if (rh && rh !== self) refHost = rh;
    }
  } catch {}
  if (!refHost) refHost = "(直接访问)";

  // 设备类型（服务端读 UA）
  const ua = request.headers.get("User-Agent") || "";
  const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);

  // 使用中国标准时间（Asia/Shanghai，UTC+8）统计日期和小时
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = chinaNow.toISOString().slice(0, 10);
  const hour = String(chinaNow.getUTCHours());

  const key = "stats:day:" + day;
  let s;
  try {
    const raw = await env.NAV_DB.get(key);
    s = raw ? JSON.parse(raw) : null;
  } catch {}
  if (!s) s = { pv: 0, uv: 0, sv: 0, paths: {}, refs: {}, dev: { mobile: 0, desktop: 0 }, hours: {} };

  s.pv += 1;
  if (newVisitor) s.uv += 1;
  if (newSession) s.sv += 1;
  s.paths[path] = (s.paths[path] || 0) + 1;
  s.refs[refHost] = (s.refs[refHost] || 0) + 1;
  if (isMobile) s.dev.mobile += 1; else s.dev.desktop += 1;
  s.hours[hour] = (s.hours[hour] || 0) + 1;

  // 控制体积：paths / refs 只保留 Top 200
  s.paths = trimTop(s.paths, 200);
  s.refs = trimTop(s.refs, 200);

  try {
    await env.NAV_DB.put(key, JSON.stringify(s), { expirationTtl: DAY_TTL });
  } catch {}

  return json({ ok: true });
}

function trimTop(obj, n) {
  const entries = Object.entries(obj);
  if (entries.length <= n) return obj;
  entries.sort((a, b) => b[1] - a[1]);
  const out = {};
  for (const [k, v] of entries.slice(0, n)) out[k] = v;
  return out;
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
