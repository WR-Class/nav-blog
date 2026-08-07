// Cloudflare Pages Function: /api/nav
// 导航数据的读写 —— 数据存在 KV (绑定变量名 NAV_DB)
// GET  : 公开读取导航数据（首页用）
// POST : 密码校验后保存整份导航数据（后台用）

const DEFAULT_DATA = {
  categories: [
    {
      id: "cat-default",
      name: "常用推荐",
      links: [
        { id: "l1", title: "GitHub", url: "https://github.com", icon: "" },
        { id: "l2", title: "YouTube", url: "https://youtube.com", icon: "" },
      ],
    },
  ],
};

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  // 没绑定 KV 时给出明确提示
  if (!env.NAV_DB) {
    return json({ error: "未绑定 KV 数据库（变量名应为 NAV_DB）" }, 500);
  }

  if (method === "GET") {
    const raw = await env.NAV_DB.get("nav_data");
    const data = raw ? JSON.parse(raw) : DEFAULT_DATA;
    return json(data);
  }

  if (method === "POST") {
    // 密码校验
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

    if (!body || !Array.isArray(body.categories)) {
      return json({ error: "数据格式错误：缺少 categories 数组" }, 400);
    }

    await env.NAV_DB.put("nav_data", JSON.stringify(body));
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
