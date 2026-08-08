// Cloudflare Pages Function: /api/relay
// 分享的「Token 中转站」数据读写 —— 存在 KV (绑定变量名 NAV_DB，键 relay_data)
// GET  : 公开读取分享列表（/relay 页面用）
// POST : 密码校验后保存整份列表（后台用）

const DEFAULT_DATA = { sites: [] };

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (!env.NAV_DB) {
    return json({ error: "未绑定 KV 数据库（变量名应为 NAV_DB）" }, 500);
  }

  if (method === "GET") {
    const raw = await env.NAV_DB.get("relay_data");
    const data = raw ? JSON.parse(raw) : DEFAULT_DATA;
    // 公开响应：剥离内部字段 _probe / quotaPerUnit / usdExchangeRate / docsLink / serverAddress
    const PUBLIC_FIELDS = new Set([
      "name", "nameEn", "url", "registerUrl", "registerMethod", "registerMethodEn",
      "strategy", "strategyEn", "intro", "introEn", "logo",
    ]);
    if (data.sites && Array.isArray(data.sites)) {
      data.sites = data.sites.map((site) => {
        const clean = {};
        for (const key of Object.keys(site)) {
          if (PUBLIC_FIELDS.has(key)) clean[key] = site[key];
        }
        return clean;
      });
    }
    return json(data);
  }

  if (method === "POST") {
    const auth = request.headers.get("Authorization") || "";
    const password = auth.replace(/^Bearer\s+/i, "");
    const expected = env.ADMIN_PASSWORD;
    if (!expected) {
      return json({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" }, 500);
    }
    if (password !== expected) {
      return json({ error: "密码错误" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求体不是合法 JSON" }, 400);
    }

    if (!body || !Array.isArray(body.sites)) {
      return json({ error: "数据格式错误：缺少 sites 数组" }, 400);
    }

    // 保存时预翻译并保存中英文双字段，前台切换无需等待翻译接口。
    if (env.TRANSLATE_ON_SAVE !== "false") {
      body.sites = await Promise.all(body.sites.map(async (site) => {
        const out = { ...site };
        for (const field of ["name", "registerMethod", "strategy", "intro"]) {
          if (typeof site[field] === "string" && site[field].trim()) {
            out[field + "En"] = await translateText(site[field], env);
          }
        }
        return out;
      }));
    }
    await env.NAV_DB.put("relay_data", JSON.stringify(body));
    return json({ ok: true });
  }

  return json({ error: "不支持的请求方法" }, 405);
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


async function translateText(text, env) {
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  const key = `tr:v3:en:${text.trim()}`;
  if (env.NAV_DB) { const cached = await env.NAV_DB.get(key); if (cached) return cached; }
  const pieces = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [text];
  const result = [];
  for (const piece of pieces) {
    if (!/[\u4e00-\u9fff]/.test(piece)) { result.push(piece); continue; }
    let translated = piece;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh&tl=en&dt=t&q=" + encodeURIComponent(piece);
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        const d = await r.json();
        const value = Array.isArray(d) && Array.isArray(d[0]) ? d[0].map(x => x?.[0] || "").join("") : "";
        if (value && !/[\u4e00-\u9fff]/.test(value)) { translated = value; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    result.push(translated);
  }
  const value = result.join("");
  if (env.NAV_DB && value !== text) await env.NAV_DB.put(key, value);
  return value;
}
