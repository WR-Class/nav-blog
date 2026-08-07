// Cloudflare Pages Function: /api/domain-stats
// 返回 wurong.bot.cd 的访问统计（需密码鉴权）

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method.toUpperCase() !== "GET") {
    return json({ error: "只支持 GET" }, 405);
  }

  // 鉴权
  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ error: "密码错误" }, 401);
  }

  const STATS_KEY = "stats:domain_visits";
  let stats = {};
  if (env.NAV_DB) {
    try {
      const raw = await env.NAV_DB.get(STATS_KEY);
      stats = raw ? JSON.parse(raw) : {};
    } catch {}
  }

  return json({ stats });
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
