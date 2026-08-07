// Cloudflare Pages Function: /api/check-links (GET, 需后台密码)
// 检查导航、中转和 GitHub 项目地址是否能通过 HTTP(S) 连接。
const timeoutMs = 8000;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "GET") return json({ error: "仅支持 GET" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD) return json({ error: "服务器未配置 ADMIN_PASSWORD" }, 500);
  if (password !== env.ADMIN_PASSWORD) return json({ error: "密码错误" }, 401);
  if (!env.NAV_DB) return json({ error: "未绑定 NAV_DB" }, 500);

  const [navRaw, relayRaw, githubRaw] = await Promise.all([
    env.NAV_DB.get("nav_data"), env.NAV_DB.get("relay_data"), env.NAV_DB.get("github_data")
  ]);
  const items = [];
  try {
    const data = navRaw ? JSON.parse(navRaw) : {};
    for (const cat of data.categories || []) for (const link of cat.links || []) {
      if (/^https?:\/\//i.test(link.url || "")) items.push({ id: link.id, type: "导航", name: link.title || link.url, url: link.url });
    }
  } catch {}
  try {
    const data = relayRaw ? JSON.parse(relayRaw) : {};
    for (const site of data.sites || []) {
      const url = site.registerUrl || site.url || "";
      if (/^https?:\/\//i.test(url)) items.push({ id: site.id, type: "中转", name: site.name || url, url });
    }
  } catch {}
  try {
    const data = githubRaw ? JSON.parse(githubRaw) : {};
    for (const p of data.projects || []) if (/^https?:\/\//i.test(p.url || "")) items.push({ id: p.id, type: "GitHub", name: p.name || p.url, url: p.url });
  } catch {}

  const results = await Promise.all(items.map(checkOne));
  return json({ ok: true, checkedAt: Date.now(), results });
}

async function checkOne(item) {
  const started = Date.now();
  try {
    // 不使用 HEAD：很多站点/防火墙会拒绝 HEAD，但浏览器 GET 正常。
    // 手动超时兼容 Cloudflare Workers，避免 AbortSignal.timeout 在部分运行时立即报错。
    const response = await withTimeout(fetch(item.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WurongLinkChecker/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    }), timeoutMs);
    const reachable = response.status >= 200 && response.status < 600;
    const ok = response.status >= 200 && response.status < 400;
    return { ...item, ok, reachable, status: response.status, finalUrl: response.url, ms: Date.now() - started, message: ok ? "页面可访问" : (response.status === 403 ? "目标站点拒绝检测服务器，但不代表访客浏览器打不开" : response.status === 404 ? "服务器可达，但目标路径不存在/已失效" : "目标站点返回异常状态") };
  } catch (e) {
    const timedOut = e && e.message === "TIMEOUT";
    return { ...item, ok: false, reachable: false, status: 0, finalUrl: "", ms: Date.now() - started, message: timedOut ? "检测超时：目标站点可能屏蔽云服务器或响应较慢" : "检测请求失败：" + (e && e.message ? e.message.slice(0, 100) : "无法连接") };
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
  ]);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
