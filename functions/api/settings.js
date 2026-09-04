// Cloudflare Pages Function: /api/settings
// 站点全局设置（背景图、小店链接）—— 存在 KV (绑定变量名 NAV_DB，键 site_settings)
// GET  : 公开读取设置（全站页面用）
// POST : 密码校验后保存设置（后台用）

const DEFAULT_SETTINGS = {
  backgroundUrl: "",   // 背景图片 URL，空则用默认纯色背景
  backgroundDim: 40,   // 背景遮罩暗度 0-80（数字越大越暗，保证文字可读）
  backgroundFit: "cover", // 适应模式：cover(铺满裁切) / contain(完整留白) / blur(模糊填充) / stretch(拉伸)
  cardBgOpacity: 1.0,  // 分类卡片背景不透明度 0.3-1.0（越低越透明）
  shopUrl: "",         // 吾荣小店地址，空则用 go.js 内置的兜底地址
};

// 只接受 https 链接。不限制域名 —— 链动官方换地址时新域名未必还是原来那个，
// 写死域名等于给自己埋坑。
function normalizeShopUrl(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    return null; // 不是合法 URL
  }
  if (u.protocol !== "https:") return null;
  return u.toString();
}

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
    if (!body || typeof body !== "object") {
      return json({ error: "请求体不是合法 JSON 对象" }, 400);
    }

    // 只更新请求里出现的字段，其余保持原值。
    //
    // 这一点很关键：后台有多个独立的保存按钮（保存背景、应用不透明度、保存小店链接），
    // 各自只提交自己关心的字段。若整体覆盖，点「保存背景」就会把小店链接清空 ——
    // 而且以后每加一个设置项，所有旧按钮都得同步改一遍，迟早漏掉。
    const raw = await env.NAV_DB.get("site_settings");
    const current = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    const settings = { ...current };

    if ("backgroundUrl" in body) {
      settings.backgroundUrl = typeof body.backgroundUrl === "string" ? body.backgroundUrl.trim() : "";
    }
    if ("backgroundDim" in body) {
      settings.backgroundDim = Number.isFinite(body.backgroundDim)
        ? Math.min(80, Math.max(0, body.backgroundDim))
        : DEFAULT_SETTINGS.backgroundDim;
    }
    if ("backgroundFit" in body) {
      settings.backgroundFit = ["cover", "contain", "blur", "stretch"].includes(body.backgroundFit)
        ? body.backgroundFit
        : DEFAULT_SETTINGS.backgroundFit;
    }
    if ("cardBgOpacity" in body) {
      settings.cardBgOpacity = Number.isFinite(body.cardBgOpacity)
        ? Math.min(1, Math.max(0.1, body.cardBgOpacity))
        : DEFAULT_SETTINGS.cardBgOpacity;
    }
    if ("shopUrl" in body) {
      const shop = normalizeShopUrl(body.shopUrl);
      // 非法链接直接拒绝，不静默改成空值 —— 否则站上的小店入口会悄悄断掉
      if (shop === null) {
        return json({ error: "小店链接必须是完整的 https:// 地址" }, 400);
      }
      settings.shopUrl = shop;
    }

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
