// Cloudflare Pages Function: /api/favicon?url=https://example.com
// 根据网址自动获取图标。核心改进：不再无脑返回一个地址，而是
// 依次尝试多个图标源并「真正 fetch 验证」，返回第一个确实能取到的图标。
//
// 常见取不到的原因：用户填的是子域名（如 invite.zooproxy.com、m.novproxy.com），
// 图标库往往只收录了主域名（zooproxy.com）。所以我们会同时尝试主域名。
export async function onRequest(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    return json({ error: "缺少 url 参数" }, 400);
  }

  let host;
  try {
    const normalized = target.startsWith("http") ? target : `https://${target}`;
    host = new URL(normalized).hostname;
  } catch {
    return json({ error: "网址格式不正确" }, 400);
  }

  // 安全修复：拒绝内网/私有 IP 和 localhost，防止被用作探测 oracle
  if (isPrivateOrLocal(host)) {
    return json({ error: "不支持的域名" }, 403);
  }

  // 计算主域名（去掉 www / 常见子域名前缀，保留注册域）
  const apex = apexDomain(host);

  // 候选域名：完整主机名 + 主域名（去重）
  const domains = [...new Set([host, apex])];

  // 候选图标源（按优先级），每个域名都试一遍
  //  - Google s2：清晰、覆盖广
  //  - DuckDuckGo：Google 拿不到时的有效补充
  const sources = [];
  for (const d of domains) {
    sources.push(`https://www.google.com/s2/favicons?domain=${d}&sz=128`);
    sources.push(`https://icons.duckduckgo.com/ip3/${d}.ico`);
  }

  // 逐个验证，返回第一个真正取到图标的
  for (const src of sources) {
    if (await isValidIcon(src)) {
      return json({ icon: src, domain: host });
    }
  }

  // 全都失败：返回一个基于首字母的占位图标（data URI，永远能显示）
  return json({ icon: letterIcon(host), domain: host, fallback: true });
}

// 验证一个图标 URL 是否真的能取到有效图片（跟随重定向，检查状态码和大小）
async function isValidIcon(url) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
      cf: { cacheTtl: 604800, cacheEverything: true },
    });
    if (!res.ok) return false; // 404 等直接判失败
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image")) return false;
    // Google/DDG 找不到时常回一个很小的默认地球图标，用大小过滤掉
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) return false;
    return true;
  } catch {
    return false;
  }
}

// 安全修复：检测内网/私有 IP 和 localhost
function isPrivateOrLocal(host) {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "::1") return true;
  // IPv4 私有/保留段
  const ipMatch = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const [a, b] = [parseInt(ipMatch[1]), parseInt(ipMatch[2])];
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // 127.0.0.0/8 (loopback)
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local)
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  }
  // IPv6 私有段
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

// 提取注册主域名：如 invite.zooproxy.com -> zooproxy.com
// 处理二级后缀（.com.cn / .co.uk 等）保留三段
function apexDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoLevelTlds = new Set([
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
    "co.uk", "org.uk", "gov.uk", "co.jp", "com.hk", "com.tw",
  ]);
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevelTlds.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

// 生成一个基于域名首字母的彩色 SVG 图标（data URI），保证兜底有图
function letterIcon(host) {
  const clean = host.replace(/^www\./, "");
  const letter = (clean[0] || "?").toUpperCase();
  // 用域名 hash 生成稳定颜色
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) % 360;
  const bg = `hsl(${h},65%,55%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="24" fill="${bg}"/><text x="50%" y="50%" dy=".1em" font-family="system-ui,sans-serif" font-size="72" font-weight="bold" fill="#fff" text-anchor="middle" dominant-baseline="middle">${letter}</text></svg>`;
  return "data:image/svg+xml;base64," + b64(svg);
}

// Workers 环境里用 btoa（对 ASCII 安全；SVG 内容都是 ASCII）
function b64(str) {
  if (typeof btoa === "function") return btoa(str);
  // 兜底
  return Buffer.from(str, "utf-8").toString("base64");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
