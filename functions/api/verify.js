// Cloudflare Pages Function: /api/verify
// 后台登录密码校验 + 频控 + 下发 HttpOnly Cookie 会话
//
// 安全设计：
//   1. IP 维度频控：同 IP 1 小时内失败 5 次锁定 1 小时（KV 计数）
//   2. 成功后下发 HttpOnly + Secure + SameSite=Lax Cookie，服务端可校验
//   3. Cookie 值 = sha256(password + 盐)，不泄露明文密码

const RATE_LIMIT_KEY = "rl:verify:";
const MAX_FAILS = 5;
const LOCKOUT_MS = 3600 * 1000; // 1 小时
const COOKIE_NAME = "admin_session";
const COOKIE_SALT = "wurong_admin_2026";
const COOKIE_MAX_AGE = 86400; // 24 小时

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "仅支持 POST" }, 405);
  }

  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return json({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" }, 500);
  }

  // ---------- 频控检查 ----------
  const clientIP = request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  if (env.NAV_DB) {
    try {
      const rlRaw = await env.NAV_DB.get(RATE_LIMIT_KEY + clientIP);
      if (rlRaw) {
        const rl = JSON.parse(rlRaw);
        const now = Date.now();
        if (rl.lockedUntil && now < rl.lockedUntil) {
          const waitMin = Math.ceil((rl.lockedUntil - now) / 60000);
          return json({ error: `尝试过多，已锁定，请 ${waitMin} 分钟后再试` }, 429);
        }
        // 清理过期记录
        if (rl.lockedUntil && now >= rl.lockedUntil) {
          await env.NAV_DB.delete(RATE_LIMIT_KEY + clientIP);
        }
      }
    } catch {}
  }

  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");

  if (!password || password !== expected) {
    // ---------- 记录失败 ----------
    if (env.NAV_DB) {
      try {
        const rlRaw = await env.NAV_DB.get(RATE_LIMIT_KEY + clientIP);
        const rl = rlRaw ? JSON.parse(rlRaw) : { fails: 0, firstFail: Date.now() };
        rl.fails = (rl.fails || 0) + 1;
        rl.lastFail = Date.now();
        if (rl.fails >= MAX_FAILS) {
          rl.lockedUntil = Date.now() + LOCKOUT_MS;
        }
        // KV 设置 1 小时 TTL，自动过期清理
        await env.NAV_DB.put(RATE_LIMIT_KEY + clientIP, JSON.stringify(rl), { expirationTtl: 3600 });
      } catch {}
    }
    return json({ ok: false, error: "密码错误" }, 401);
  }

  // ---------- 登录成功：清除频控记录 ----------
  if (env.NAV_DB) {
    try { await env.NAV_DB.delete(RATE_LIMIT_KEY + clientIP); } catch {}
  }

  // ---------- 下发 HttpOnly Cookie ----------
  const cookieValue = await sha256(expected + COOKIE_SALT);

  const response = json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`
  );
  return response;
}

// SHA-256 哈希（Web Crypto API，Cloudflare Workers 原生支持）
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
