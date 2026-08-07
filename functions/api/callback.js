// Cloudflare Pages Function: /api/callback
// Decap CMS 登录第二步 —— GitHub 回调，用 code 换 token，再把 token 通过
// postMessage 回传给打开授权窗口的 Decap CMS 页面
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // 校验 state
  const cookie = request.headers.get("Cookie") || "";
  const savedState = cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("oauth_state="))
    ?.split("=")[1];

  if (!code || !state || state !== savedState) {
    return new Response("OAuth state 校验失败，请重新登录", { status: 400 });
  }

  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response("缺少 GitHub OAuth 环境变量", { status: 500 });
  }

  // 用 code 换 access_token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;

  if (!token) {
    return new Response(
      "获取 token 失败：" + JSON.stringify(tokenData),
      { status: 401 }
    );
  }

  // Decap CMS 约定：通过 postMessage 把结果传回主窗口
  const payload = JSON.stringify({ token, provider: "github" });
  const html = `<!DOCTYPE html><html><body><script>
    (function () {
      function receiveMessage(e) {
        window.opener.postMessage(
          'authorization:github:success:${payload}',
          e.origin
        );
        window.removeEventListener('message', receiveMessage, false);
      }
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    })();
  </script>登录成功，正在返回…</body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": "oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    },
  });
}
