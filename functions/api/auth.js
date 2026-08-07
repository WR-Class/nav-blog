// Cloudflare Pages Function: /api/auth
// Decap CMS 登录第一步 —— 把用户重定向到 GitHub 授权页
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return new Response("缺少 GITHUB_OAUTH_CLIENT_ID 环境变量", { status: 500 });
  }

  // 生成随机 state 防 CSRF
  const state = crypto.randomUUID();

  const redirectUri = `${url.origin}/api/callback`;
  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "repo,user");
  authUrl.searchParams.set("state", state);

  // 把 state 写进 cookie，回调时校验
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
