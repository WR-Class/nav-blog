// Cloudflare Pages Function: /api/blog
// 博客文章的读写 —— 数据存在 KV (绑定变量名 NAV_DB)
//   blog:index        → 文章列表元数据数组（列表页用，体积小）
//   blog:post:<slug>  → 单篇文章完整内容（含中英文正文）
//
// GET  /api/blog               → 公开读取文章列表（不含草稿）
// GET  /api/blog?slug=xxx      → 公开读取单篇文章
// POST /api/blog （需密码）     → 保存/更新文章；未提供 bodyEn 时自动翻译英文
//        body: { action:'delete', slug } → 删除文章
//        body: { action:'retranslate', slug } → 重新翻译已有文章
//        body: { ..., forceRetranslate: true } → 保存时强制重新翻译

const INDEX_KEY = "blog:index";
const POST_PREFIX = "blog:post:";

// 术语表：翻译前把中文口语替换成英文，避免机翻翻车
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
      if (post.draft && !checkAuth(request, env)) {
        return json({ error: "文章不存在" }, 404);
      }
      return json({ post });
    }
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

    // 重新翻译已有文章
    if (body.action === "retranslate") {
      const rSlug = String(body.slug || "").trim();
      if (!rSlug) return json({ error: "缺少 slug" }, 400);
      const raw = await env.NAV_DB.get(POST_PREFIX + rSlug);
      if (!raw) return json({ error: "文章不存在" }, 404);
      const post = JSON.parse(raw);

      // 先标记为翻译中并保存，防止超时丢数据
      post.translationStatus = "pending";
      post.updatedAt = Date.now();
      await env.NAV_DB.put(POST_PREFIX + rSlug, JSON.stringify(post));
      await upsertIndex(env, post);

      // 重新翻译正文
      if (post.body && /[\u4e00-\u9fff]/.test(post.body)) {
        try {
          post.bodyEn = await translateMarkdown(post.body, env);
          // 清理扫描：对残留中文段落二次重试
          post.bodyEn = await cleanupTranslation(post.bodyEn, env);
        } catch (e) {
          post.bodyEn = "";
        }
      }
      // 重新翻译标题和摘要
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

      post.translationStatus = checkTranslationStatus(post.body, post.bodyEn);
      post.updatedAt = Date.now();

      await env.NAV_DB.put(POST_PREFIX + rSlug, JSON.stringify(post));
      await upsertIndex(env, post);
      return json({ ok: true, post, translationStatus: post.translationStatus });
    }

    // 保存前端翻译结果（前端驱动翻译，避免后端 30s 超时）
    if (body.action === "save-translation") {
      const sSlug = String(body.slug || "").trim();
      if (!sSlug) return json({ error: "缺少 slug" }, 400);
      const raw = await env.NAV_DB.get(POST_PREFIX + sSlug);
      if (!raw) return json({ error: "文章不存在" }, 404);
      const post = JSON.parse(raw);
      post.bodyEn = String(body.bodyEn || "");
      post.titleEn = String(body.titleEn || post.title);
      post.snippetEn = String(body.snippetEn || post.snippet);
      post.translationStatus = checkTranslationStatus(post.body, post.bodyEn);
      post.updatedAt = Date.now();
      await env.NAV_DB.put(POST_PREFIX + sSlug, JSON.stringify(post));
      await upsertIndex(env, post);
      return json({ ok: true, post, translationStatus: post.translationStatus });
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

    // 决定是否需要翻译正文：
    // 1. bodyEn 为空 + 正文含中文 + 未禁用自动翻译 → 翻译
    // 2. forceRetranslate=true + 正文含中文 → 强制重新翻译
    const needBodyTranslate = (body.autoTranslate !== false) &&
      /[\u4e00-\u9fff]/.test(post.body) &&
      ((!post.bodyEn) || body.forceRetranslate === true);

    // 翻译标题和摘要（用于英文列表页）
    const needTitleTranslate = (body.autoTranslate !== false) &&
      (/[\u4e00-\u9fff]/.test(post.title) || /[\u4e00-\u9fff]/.test(post.snippet)) &&
      (body.forceRetranslate === true || !post.titleEn || post.titleEn === post.title);

    // ★ 关键：先保存博文（不含翻译），确保数据不丢失
    // 即使翻译超时（Cloudflare 30s 限制），博文也已安全存入 KV
    post.translationStatus = needBodyTranslate ? "pending" : (post.bodyEn ? checkTranslationStatus(post.body, post.bodyEn) : "none");
    if (!post.titleEn) { post.titleEn = post.title; post.snippetEn = post.snippet; }
    await env.NAV_DB.put(POST_PREFIX + slug2, JSON.stringify(post));
    await upsertIndex(env, post);

    // 然后翻译正文
    if (needBodyTranslate) {
      try {
        post.bodyEn = await translateMarkdown(post.body, env);
        // 清理扫描：对残留中文段落二次重试
        post.bodyEn = await cleanupTranslation(post.bodyEn, env);
      } catch (e) {
        post.bodyEn = "";
      }
    }

    // 翻译标题和摘要
    if (needTitleTranslate) {
      try {
        const t = await translateTexts([post.title, post.snippet].filter((s) => s), env);
        post.titleEn = t[0] || post.title;
        post.snippetEn = t[1] || post.snippet;
      } catch {
        post.titleEn = post.title;
        post.snippetEn = post.snippet;
      }
    }

    // 验证翻译完整性并更新保存
    post.translationStatus = checkTranslationStatus(post.body, post.bodyEn);
    post.updatedAt = Date.now();
    await env.NAV_DB.put(POST_PREFIX + slug2, JSON.stringify(post));
    await upsertIndex(env, post);
    return json({ ok: true, post, translationStatus: post.translationStatus });
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

// ========== 翻译完整性验证 ==========
// 返回 'complete' | 'partial' | 'none'
function checkTranslationStatus(body, bodyEn) {
  if (!bodyEn || !bodyEn.trim()) return "none";
  const chineseInEn = (bodyEn.match(/[\u4e00-\u9fff]/g) || []).length;
  if (chineseInEn === 0) return "complete";
  return "partial";
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
    translationStatus: post.translationStatus || "none",
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

// ========== 翻译系统 v2（按段落翻译 + 重试 + 双引擎 fallback） ==========

// 翻译 Markdown 正文：保留代码块，按段落翻译，表格单独处理
async function translateMarkdown(text, env) {
  // 1. 按代码块分割，代码块不翻译
  const segments = text.split(/(```[\s\S]*?```)/g);
  const results = [];

  for (const seg of segments) {
    if (seg.startsWith("```")) {
      results.push(seg);
    } else if (!/[\u4e00-\u9fff]/.test(seg)) {
      results.push(seg);
    } else {
      // 2. 按段落分割（双换行），每段作为一个翻译单元
      const paras = seg.split(/(\n\n+)/);
      const translatedParas = await mapLimit(paras, 4, async (para) => {
        if (!para.trim() || !/[\u4e00-\u9fff]/.test(para)) return para;
        // 3. 表格段落：保留结构，翻译单元格
        if (/^\s*\|/.test(para)) {
          return await translateTable(para, env);
        }
        // 4. 普通段落：按中文/非中文片段切分后翻译
        return await translateParagraph(para, env);
      });
      results.push(translatedParas.join(""));
    }
  }
  return results.join("");
}

// 清理扫描：找出翻译结果中残留的中文片段，用更多重试次数二次翻译
async function cleanupTranslation(translatedText, env) {
  if (!translatedText || !/[\u4e00-\u9fff]/.test(translatedText)) return translatedText;

  // 提取所有连续中文片段（含标点）
  const chineseSegs = translatedText.match(/[\u4e00-\u9fff][\u4e00-\u9fff\s。，！？、；：""''（）【】《》·…—]+/g) || [];
  if (chineseSegs.length === 0) return translatedText;

  // 对每个残留中文片段用 5 次重试再翻一次
  const replacements = await mapLimit(chineseSegs, 3, async (seg) => {
    const trimmed = seg.trim();
    if (!trimmed) return { from: seg, to: seg };
    const retry = await translateWithRetry(trimmed, env, 5);
    return { from: seg, to: retry };
  });

  // 逐个替换（从后往前，避免位置偏移）
  let result = translatedText;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { from, to } = replacements[i];
    if (to && to !== from && !/[\u4e00-\u9fff]/.test(to)) {
      result = result.replace(from, to);
    }
  }
  return result;
}

// 翻译表格：保留表格结构，只翻译单元格内容
async function translateTable(text, env) {
  const lines = text.split("\n");
  const results = await mapLimit(lines, 6, async (line) => {
    if (!line.trim() || !/[\u4e00-\u9fff]/.test(line)) return line;
    // 表格分隔行（|---|---|）不翻译
    if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) return line;
    // 翻译每个单元格
    const cells = line.split("|");
    const translatedCells = await mapLimit(cells, 6, async (cell) => {
      const trimmed = cell.trim();
      if (!trimmed || !/[\u4e00-\u9fff]/.test(trimmed)) return cell;
      const translated = await translateWithRetry(trimmed, env);
      // 保留原始空白对齐
      const leading = cell.match(/^\s*/)[0];
      const trailing = cell.match(/\s*$/)[0];
      return leading + translated + trailing;
    });
    return translatedCells.join("|");
  });
  return results.join("\n");
}

// 翻译段落：按中文/非中文片段切分，翻译中文部分
async function translateParagraph(text, env) {
  const runs = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [text];
  const translated = await mapLimit(runs, 6, async (run) => {
    if (!/[\u4e00-\u9fff]/.test(run)) return run;
    // 长文本分块
    const chunks = splitChineseChunks(run, 800);
    const chunkResults = await mapLimit(chunks, 6, (chunk) => translateWithRetry(chunk, env));
    return chunkResults.join("");
  });
  return translated.join("");
}

// 带重试的翻译：最多重试 3 次，DeepL 优先，Google Translate 兜底
async function translateWithRetry(text, env, maxRetries = 3) {
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return text;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await translateOne(text, "zh", "en", env);
      if (result && result !== text) {
        return result;
      }
    } catch (e) {
      // 翻译失败，继续重试
    }
    if (attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return text; // 全部重试失败，返回原文
}

// 翻译一组短文本（标题、摘要等）
async function translateTexts(texts, env) {
  return mapLimit(texts, 6, (t) => translateWithRetry(t, env));
}

// 翻译单段文本：先套术语表，再调 DeepL 或 Google
async function translateOne(text, from, to, env) {
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return text;

  // 查缓存（v6: 新缓存版本，废弃 v5 旧缓存）
  const hasDeepL = !!(env.DEEPL_API_KEYS || env.DEEPL_API_KEY);
  const provider = hasDeepL ? "deepl" : "google";
  const cacheKey = `tr:v6:${provider}:${to}:${text.trim()}`;
  if (env.NAV_DB) {
    try {
      const cached = await env.NAV_DB.get(cacheKey);
      if (cached !== null && cached !== text) return cached;
    } catch {}
  }

  // 术语表预替换
  let processed = text;
  for (const [zh, en] of GLOSSARY_ZH_EN) {
    processed = processed.split(zh).join(en);
  }

  let result = null;

  // 解析 DeepL Keys：优先 DEEPL_API_KEYS（逗号分隔），回退 DEEPL_API_KEY（单个）
  const deeplKeys = env.DEEPL_API_KEYS
    ? env.DEEPL_API_KEYS.split(",").map(k => k.trim()).filter(Boolean)
    : (env.DEEPL_API_KEY ? [env.DEEPL_API_KEY] : []);

  // 优先 DeepL（多 Key 轮换）
  if (deeplKeys.length > 0) {
    try {
      result = await deeplTranslate(processed, from, to, deeplKeys);
    } catch (e) {
      // DeepL 全部 Key 失败，回退到 Google
    }
  }

  // DeepL 不可用或失败 → 用 Google Translate
  if (!result || result === text) {
    try {
      result = await googleTranslate(processed, from, to);
    } catch {
      result = text;
    }
  }

  if (!result) result = text;

  // 只缓存成功的翻译（结果与原文不同）
  if (env.NAV_DB && result !== text) {
    try { await env.NAV_DB.put(cacheKey, result); } catch {}
  }
  return result;
}

async function deeplTranslate(text, from, to, apiKeys) {
  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  // 逐个 Key 尝试，403/429（额度用完/限流）自动切下一个
  for (const key of keys) {
    const deeplUrl = key.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api-pro.deepl.com/v2/translate";
    try {
      const res = await fetch(deeplUrl, {
        method: "POST",
        headers: { Authorization: "DeepL-Auth-Key " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [text], source_lang: from.toUpperCase(), target_lang: to.toUpperCase() }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.translations?.[0]?.text || text;
      }
    } catch {}
  }
  throw new Error("所有 DeepL Key 均失败");
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
  return chunks.flatMap((c) =>
    c.length <= maxLen ? [c] : Array.from({ length: Math.ceil(c.length / maxLen) }, (_, i) => c.slice(i * maxLen, (i + 1) * maxLen))
  );
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
