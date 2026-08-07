// Cloudflare Pages Function: /api/blog
// 博客文章的读写 —— 数据存在 KV (绑定变量名 NAV_DB)
//   blog:index        → 文章列表元数据数组（列表页用，体积小）
//   blog:post:<slug>  → 单篇文章完整内容（含中英文正文）
//
// GET  /api/blog               → 公开读取文章列表（不含草稿）
// GET  /api/blog?slug=xxx      → 公开读取单篇文章
// GET  /api/blog?slug=xxx&raw=1（需密码）→ 含草稿
// POST /api/blog （需密码）     → 保存/更新文章；未提供 bodyEn 时自动翻译英文
//        body: { action:'delete', slug } → 删除文章

const INDEX_KEY = "blog:index";
const POST_PREFIX = "blog:post:";

// —— 术语表：翻译前把中文口语替换成英文，避免机翻翻车 ——
const GLOSSARY_ZH_EN = [
  ["白嫖站", "free-credit site"],
  ["白嫖", "get free credits"],
  ["额度", "credits"],
  ["签到", "daily check-in"],
  ["机场", "VPN provider"],
  ["过盾", "captcha solving"],
  ["接码", "SMS verification"],
  ["家宽", "residential IP"],
  ["拼团", "group buy"],
];

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  if (!env.NAV_DB) return json({ error: "未绑定 KV 数据库（NAV_DB）" }, 500);

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  // ---------- GET ----------
  if (method === "GET") {
    if (slug) {
      const raw = await env.NAV_DB.get(POST_PREFIX + slug);
      if (!raw) return json({ error: "文章不存在" }, 404);
      const post = JSON.parse(raw);
      // 草稿文章需要密码才能看
      if (post.draft && !checkAuth(request, env)) {
        return json({ error: "文章不存在" }, 404);
      }
      return json({ post });
    }
    // 列表
    const raw = await env.NAV_DB.get(INDEX_KEY);
    let posts = raw ? JSON.parse(raw) : [];
    const isAuthed = checkAuth(request, env);
    if (!isAuthed) posts = posts.filter((p) => !p.draft);
    return json({ posts });
  }

  // ---------- POST（写操作，需密码）----------
  if (method === "POST") {
    if (!checkAuth(request, env)) return json({ error: "密码错误" }, 401);

    let body;
    try { body = await request.json(); } catch { return json({ error: "请求体不是合法 JSON" }, 400); }

    // 删除
    if (body.action === "delete") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "缺少 slug" }, 400);
      await env.NAV_DB.delete(POST_PREFIX + slug);
      await removeFromIndex(env, slug);
      return json({ ok: true });
    }

    // 保存/更新
    const slug2 = String(body.slug || "").trim().replace(/[^\w\-\u4e00-\u9fff]+/g, "-");
    if (!slug2) return json({ error: "缺少 slug" }, 400);
    if (!body.title || !String(body.title).trim()) return json({ error: "缺少标题" }, 400);

    const post = {
      slug: slug2,
      title: String(body.title).trim(),
      snippet: String(body.snippet || "").trim(),
      publishDate: String(body.publishDate || new Date().toISOString().slice(0, 10)),
      author: String(body.author || "吾荣").trim(),
      category: String(body.category || "未分类").trim(),
      tags: Array.isArray(body.tags) ? body.tags : [],
      image: typeof body.image === "object" ? body.image : { src: String(body.image || ""), alt: String(body.imageAlt || "") },
      draft: !!body.draft,
      body: String(body.body || ""),
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn : "",
      updatedAt: Date.now(),
    };

    // 没给英文正文且未禁用自动翻译 → 后台翻译
    if (!post.bodyEn && body.autoTranslate !== false && /[\u4e00-\u9fff]/.test(post.body)) {
      try {
        post.bodyEn = await translateMarkdown(post.body, env);
      } catch (e) {
        post.bodyEn = ""; // 翻译失败不阻塞保存
      }
    }
    // 翻译标题和摘要（用于英文列表页）
    if (/[\u4e00-\u9fff]/.test(post.title) || /[\u4e00-\u9fff]/.test(post.snippet)) {
      try {
        const t = await translateTexts([post.title, post.snippet].filter((s) => s), env);
        post.titleEn = t[0] || post.title;
        post.snippetEn = t[1] || post.snippet;
      } catch {}
    } else {
      post.titleEn = post.title;
      post.snippetEn = post.snippet;
    }

    await env.NAV_DB.put(POST_PREFIX + slug2, JSON.stringify(post));
    await upsertIndex(env, post);
    return json({ ok: true, post });
  }

  return json({ error: "不支持的请求方法" }, 405);
}

// ========== 鉴权 ==========
function checkAuth(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  const password = auth.replace(/^Bearer\s+/i, "");
  return password === expected;
}

// ========== 索引维护 ==========
async function getIndex(env) {
  const raw = await env.NAV_DB.get(INDEX_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function upsertIndex(env, post) {
  const list = await getIndex(env);
  const idx = list.findIndex((p) => p.slug === post.slug);
  const meta = {
    slug: post.slug,
    title: post.title,
    titleEn: post.titleEn || post.title,
    snippet: post.snippet,
    snippetEn: post.snippetEn || post.snippet,
    publishDate: post.publishDate,
    author: post.author,
    category: post.category,
    tags: post.tags,
    image: post.image,
    draft: post.draft,
  };
  if (idx >= 0) list[idx] = meta;
  else list.push(meta);
  list.sort((a, b) => (b.publishDate || "").localeCompare(a.publishDate || ""));
  await env.NAV_DB.put(INDEX_KEY, JSON.stringify(list));
}

async function removeFromIndex(env, slug) {
  const list = await getIndex(env);
  const filtered = list.filter((p) => p.slug !== slug);
  await env.NAV_DB.put(INDEX_KEY, JSON.stringify(filtered));
}

// ========== 翻译（改进版：分块 + 并行 + DeepL + 术语表） ==========

// 翻译 Markdown 正文：保留代码块/表格分隔行，逐段翻译
async function translateMarkdown(text, env) {
  const lines = text.split(/(\r?\n)/);
  const out = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; out.push(line); continue; }
    if (inCode || /^\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) { out.push(line); continue; }
    out.push(await translateLine(line, env));
  }
  return out.join("");
}

// 翻译单行：按中文片段切分，长片段再按句号切分到 ≤800 字符
async function translateLine(line, env) {
  const runs = line.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [line];
  const translated = await mapLimit(runs, 6, async (run) =>
    /[\u4e00-\u9fff]/.test(run) ? translateChunked(run, env) : run
  );
  return translated.join("");
}

// 把一段长中文切成 ≤800 字符的小块，并行翻译后拼回
async function translateChunked(text, env) {
  const chunks = splitChineseChunks(text, 800);
  const results = await mapLimit(chunks, 6, (chunk) => translateOne(chunk, "zh", "en", env));
  return results.join("");
}

// 按句号/分号/逗号切分中文，每块不超过 maxLen
function splitChineseChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = text.split(/([。！？；])/);
  const chunks = [];
  let cur = "";
  for (const part of parts) {
    if ((cur + part).length > maxLen && cur) {
      chunks.push(cur);
      cur = part;
    } else {
      cur += part;
    }
  }
  if (cur) chunks.push(cur);
  // 如果单块仍超长（没有标点的长句），按字符硬切
  return chunks.flatMap((c) =>
    c.length <= maxLen ? [c] : Array.from({ length: Math.ceil(c.length / maxLen) }, (_, i) => c.slice(i * maxLen, (i + 1) * maxLen))
  );
}

// 翻译一组短文本（标题、摘要等）
async function translateTexts(texts, env) {
  return mapLimit(texts, 6, (t) => translateOne(t, "zh", "en", env));
}

// 翻译单段文本：先套术语表，再调 DeepL 或谷歌
async function translateOne(text, from, to, env) {
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return text;

  // 查缓存
  const provider = env.DEEPL_API_KEY ? "deepl" : "google";
  const cacheKey = `tr:v5:${provider}:${to}:${text.trim()}`;
  if (env.NAV_DB) {
    try {
      const cached = await env.NAV_DB.get(cacheKey);
      if (cached !== null) return cached;
    } catch {}
  }

  // 术语表预替换
  let processed = text;
  for (const [zh, en] of GLOSSARY_ZH_EN) {
    processed = processed.split(zh).join(en);
  }

  let result;
  try {
    result = env.DEEPL_API_KEY
      ? await deeplTranslate(processed, from, to, env.DEEPL_API_KEY)
      : await googleTranslate(processed, from, to);
  } catch {
    result = text; // 失败回退原文
  }
  if (!result) result = text;

  // 写缓存
  if (env.NAV_DB && result !== text) {
    try { await env.NAV_DB.put(cacheKey, result); } catch {}
  }
  return result;
}

async function deeplTranslate(text, from, to, apiKey) {
  const res = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: { Authorization: "DeepL-Auth-Key " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [text], source_lang: from.toUpperCase(), target_lang: to.toUpperCase() }),
  });
  if (!res.ok) throw new Error("DeepL HTTP " + res.status);
  const data = await res.json();
  return data.translations?.[0]?.text || text;
}

async function googleTranslate(text, from, to) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const u = "https://translate.googleapis.com/translate_a/single?client=gtx" +
        `&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!res.ok) throw new Error("translate http " + res.status);
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const result = data[0].map((seg) => (seg && seg[0]) || "").join("");
        if (result && result !== text) return result;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  return text;
}

// 并发限制器
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
