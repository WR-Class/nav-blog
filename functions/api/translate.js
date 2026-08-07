// Cloudflare Pages Function: /api/translate
// 把用户后台填写的中文内容（导航分类名、链接标题、GitHub 项目名/简介等）
// 动态翻译成英文，让外国访客也能看懂。
//
// 用法：POST { "texts": ["莱卡云", "云服务器"], "to": "en" }
// 返回：{ "translations": ["Lycloud", "Cloud Server"] }
//
// 策略：
//   1. 逐条查 KV 缓存（键 tr:<to>:<原文>），命中直接用，翻译只做一次，永久缓存。
//   2. 未命中的调用 Google 免费翻译端点（无需 API Key），成功后写回 KV。
//   3. 任何一条翻译失败都回退成原文，绝不让页面报错。

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "只支持 POST" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const to = body.to === "zh" ? "zh" : "en";
  const from = to === "en" ? "zh" : "en";
  const texts = Array.isArray(body.texts) ? body.texts : [];
  if (texts.length === 0) {
    return json({ translations: [] });
  }

  // 去重，减少翻译次数
  const unique = [...new Set(texts.filter((t) => typeof t === "string"))];
  const map = new Map();

  await Promise.all(
    unique.map(async (text) => {
      const trimmed = text.trim();
      // 空串、纯数字/符号、看起来像 URL 的，直接原样返回，不翻译
      if (!trimmed || /^[\d\s\p{P}\p{S}]+$/u.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
        map.set(text, text);
        return;
      }

      // v2：旧版本曾把长段落翻译失败结果缓存下来，升级版本号强制重新翻译。
      // Separate caches by provider so old Google results do not hide a newly configured DeepL key.
      const provider = env.DEEPL_API_KEY ? "deepl" : "google";
      const cacheKey = `tr:v4:${provider}:${to}:${trimmed}`;

      // 1. 查 KV 缓存
      if (env.NAV_DB) {
        try {
          const cached = await env.NAV_DB.get(cacheKey);
          if (cached !== null) {
            map.set(text, cached);
            return;
          }
        } catch { /* 忽略缓存读取错误 */ }
      }

      // 2. 调用 Google 免费翻译
      try {
        const result = env.DEEPL_API_KEY
          ? await deeplTranslate(trimmed, from, to, env.DEEPL_API_KEY)
          : await googleTranslate(trimmed, from, to);
        const out = result || text;
        map.set(text, out);
        // 3. 写回 KV（不阻塞返回也行，但这里 await 保证下次命中）
        if (env.NAV_DB && result) {
          try {
            await env.NAV_DB.put(cacheKey, out);
          } catch { /* 忽略缓存写入错误 */ }
        }
      } catch {
        map.set(text, text); // 失败回退原文
      }
    })
  );

  const translations = texts.map((t) => map.get(t) ?? t);
  return json({ translations, provider: env.DEEPL_API_KEY ? "deepl" : "google" });
}

async function deeplTranslate(text, from, to, apiKey) {
  const pieces = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [text];
  const out = [];
  for (const piece of pieces) {
    if (!/[\u4e00-\u9fff]/.test(piece)) { out.push(piece); continue; }
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST', headers: {'Authorization': 'DeepL-Auth-Key ' + apiKey, 'Content-Type': 'application/json'},
      body: JSON.stringify({text: [piece], source_lang: from.toUpperCase(), target_lang: to.toUpperCase()})
    });
    if (!res.ok) throw new Error('DeepL HTTP ' + res.status);
    const data = await res.json(); out.push(data.translations?.[0]?.text || piece);
  }
  return out.join('');
}

async function googleTranslate(text, from, to) {
  // Translate in small pieces. Mixed Chinese/English records are first split into
  // Chinese runs so a preserved product/model name cannot make the whole field fail.
  const pieces = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [text];
  const out = [];
  for (const piece of pieces) {
    if (!/[\u4e00-\u9fff]/.test(piece)) { out.push(piece); continue; }
    out.push(await googlePiece(piece, from, to));
  }
  return out.join("");
}

async function googlePiece(text, from, to) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = "https://translate.googleapis.com/translate_a/single?client=gtx" +
        `&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!res.ok) throw new Error("translate http " + res.status);
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const result = data[0].map((seg) => (seg && seg[0]) || "").join("");
        if (result && result !== text) return result;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  return text;
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
