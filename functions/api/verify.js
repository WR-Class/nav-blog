// Cloudflare Pages Function: /api/verify
// 仅用于后台登录框校验密码是否正确。
// 前端不再硬编码密码；登录时把用户输入的密码 POST 到这里校验。
// 真正的写保护仍在各 /api/* 的 POST 里独立校验（本接口只是登录体验）。

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "仅支持 POST" }, 405);
  }

  // 服务器未配置密码则拒绝（不再有任何硬编码默认值）
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return json({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" }, 500);
  }

  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  if (!password || password !== expected) {
    return json({ ok: false, error: "密码错误" }, 401);
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
