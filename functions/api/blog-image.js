// Cloudflare Pages Function: /api/blog-image
// 博客图片上传与读取 —— 图片存在 KV (NAV_DB)
//   blog:image:<id>  → { type, data }  （data 为 base64 无前缀）
//
// GET  /api/blog-image?id=xxx      → 公开读取图片（返回 image/* ）
// POST /api/blog-image （需密码）    → 上传图片，返回 { ok, url }

const IMAGE_PREFIX = "blog:image:";

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (!env.NAV_DB) return json({ error: "未绑定 KV 数据库（NAV_DB）" }, 500);

  // ---------- GET：公开读取图片 ----------
  if (method === "GET") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "缺少 id" }, 400);
    const raw = await env.NAV_DB.get(IMAGE_PREFIX + id);
    if (!raw) return json({ error: "图片不存在" }, 404);
    const obj = JSON.parse(raw);
    const bin = base64ToBytes(obj.data);
    return new Response(bin, {
      headers: {
        "Content-Type": obj.type || "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // ---------- POST：上传图片（需密码）----------
  if (method === "POST") {
    if (!checkAuth(request, env)) return json({ error: "密码错误" }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: "请求体不是合法 JSON" }, 400); }

    const dataUrl = String(body.dataUrl || "");
    if (!dataUrl.startsWith("data:")) return json({ error: "需要 dataUrl 格式的图片" }, 400);

    // 解析 data:image/png;base64,xxxx
    const m = dataUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/);
    if (!m) return json({ error: "dataUrl 格式不正确" }, 400);
    const type = m[1];
    const base64 = m[2];

    // 大小限制：5MB
    const sizeBytes = Math.ceil(base64.length * 0.75);
    if (sizeBytes > 5 * 1024 * 1024) return json({ error: "图片超过 5MB 限制" }, 400);

    const id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const ext = type.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
    await env.NAV_DB.put(IMAGE_PREFIX + id, JSON.stringify({ type, data: base64 }));

    return json({ ok: true, url: "/api/blog-image?id=" + id + "." + ext });
  }

  return json({ error: "不支持的请求方法" }, 405);
}

function checkAuth(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  return password === expected;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
