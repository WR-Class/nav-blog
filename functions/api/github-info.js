// Cloudflare Pages Function: /api/github-info?repo=owner/name  (或完整 URL)
// 根据 GitHub 仓库地址自动获取项目信息（名称、简介、star、语言等）
// 可选：带 &readme=1 时附带 README 内容（markdown）
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get("repo");
  const withReadme = url.searchParams.get("readme") === "1";

  if (!raw) return json({ error: "缺少 repo 参数" }, 400);

  // 解析出 owner/repo
  let owner, repo;
  try {
    let s = raw.trim();
    if (s.includes("github.com")) {
      const u = new URL(s.startsWith("http") ? s : "https://" + s);
      const parts = u.pathname.split("/").filter(Boolean);
      owner = parts[0];
      repo = (parts[1] || "").replace(/\.git$/, "");
    } else {
      const parts = s.split("/").filter(Boolean);
      owner = parts[0];
      repo = (parts[1] || "").replace(/\.git$/, "");
    }
  } catch {
    owner = null;
  }
  if (!owner || !repo) return json({ error: "无法解析 GitHub 仓库地址" }, 400);

  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "nav-blog-app",
  };
  // 可选 token 提升速率上限（在 Cloudflare 环境变量里设 GITHUB_TOKEN）
  if (env.GITHUB_TOKEN) headers["Authorization"] = "Bearer " + env.GITHUB_TOKEN;

  try {
    const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (apiRes.status === 404) return json({ error: "仓库不存在或为私有" }, 404);
    if (apiRes.status === 403) return json({ error: "GitHub API 速率超限，请稍后再试或配置 GITHUB_TOKEN" }, 429);
    if (!apiRes.ok) return json({ error: "GitHub API 错误：" + apiRes.status }, 502);

    const r = await apiRes.json();
    const result = {
      name: r.name,
      fullName: r.full_name,
      description: r.description || "",
      url: r.html_url,
      homepage: r.homepage || "",
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      language: r.language || "",
      topics: r.topics || [],
      owner: r.owner ? r.owner.login : owner,
      avatar: r.owner ? r.owner.avatar_url : "",
    };

    if (withReadme) {
      try {
        const rmRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
        if (rmRes.ok) {
          const rm = await rmRes.json();
          // content 是 base64
          result.readme = decodeBase64Utf8(rm.content || "");
        }
      } catch { /* README 拿不到就算了 */ }
    }

    return json(result);
  } catch (e) {
    return json({ error: "请求失败：" + e.message }, 500);
  }
}

function decodeBase64Utf8(b64) {
  try {
    const clean = b64.replace(/\n/g, "");
    const bin = atob(clean);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
