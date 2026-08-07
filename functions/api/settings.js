// Cloudflare Pages Function: /api/settings
// 站点全局设置（目前用于背景图）—— 存在 KV (绑定变量名 NAV_DB，键 site_settings)
// GET  : 公开读取设置（全站页面用）
// POST : 密码校验后保存设置（后台用）

const DEFAULT_SETTINGS = {
  backgroundUrl: "",   // 背景图片 URL，空则用默认纯色背景
  backgroundDim: 40,   // 背景遮罩暗度 0-80（数字越大越暗，保证文字可读）
  backgroundFit: "cover", // 适应模式：cover(铺满裁切) / contain(完整留白) / blur(模糊填充) / stretch(拉伸)
  cardBgOpacity: 1.0,  // 分类卡片背景不透明度 0.3-1.0（越低越透明）
};

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (!env.NAV_DB) {
    return json({ error: "未绑定 KV 数据库（变量名应为 NAV_DB）" }, 500);
  }

  if (method === "GET") {
    const raw = await env.NAV_DB.get("site_settings");
    const data = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
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

    const settings = {
      backgroundUrl: typeof body.backgroundUrl === "string" ? body.backgroundUrl.trim() : "",
      backgroundDim: Number.isFinite(body.backgroundDim)
        ? Math.min(80, Math.max(0, body.backgroundDim))
        : DEFAULT_SETTINGS.backgroundDim,
      backgroundFit: ["cover", "contain", "blur", "stretch"].includes(body.backgroundFit)
        ? body.backgroundFit
        : DEFAULT_SETTINGS.backgroundFit,
      cardBgOpacity: Number.isFinite(body.cardBgOpacity)
        ? Math.min(1, Math.max(0.1, body.cardBgOpacity))
        : DEFAULT_SETTINGS.cardBgOpacity,
    };

    await env.NAV_DB.put("site_settings", JSON.stringify(settings));
    return json({ ok: true, settings });
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
