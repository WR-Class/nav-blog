/**
 * 临时诊断端点：确认 Pages Functions 里的 Browser Run 绑定是否真的可用。
 * 只在测试分支上存在，合并前必须删除。
 */

export async function onRequest(context) {
  const { env, request } = context;
  const u = new URL(request.url);
  const q = (u.searchParams.get("q") || "M365 E3 E5账号是什么").trim();

  const out = {
    hasBinding: Boolean(env.BROWSER),
    bindingType: typeof env.BROWSER,
    hasQuickAction: Boolean(env.BROWSER && typeof env.BROWSER.quickAction === "function"),
    methods: env.BROWSER ? Object.getOwnPropertyNames(Object.getPrototypeOf(env.BROWSER) || {}) : [],
  };

  if (out.hasQuickAction) {
    const t0 = Date.now();
    try {
      const resp = await env.BROWSER.quickAction("scrape", {
        url: "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q),
        elements: [{ selector: "a.result__a" }, { selector: "a.result__snippet" }],
        gotoOptions: { waitUntil: "domcontentloaded", timeout: 15000 },
      });
      out.ms = Date.now() - t0;
      out.respOk = resp && resp.ok;
      out.respStatus = resp && resp.status;
      const body = await resp.json();
      const payload = body && body.result !== undefined ? body.result : body;
      out.payloadIsArray = Array.isArray(payload);
      out.envelope = body && body.result !== undefined ? "wrapped" : "bare";
      const groups = Array.isArray(payload) ? payload : [];
      out.groups = groups.map((g) => ({ selector: g && g.selector, n: ((g && g.results) || []).length }));
      const first = groups[0] && groups[0].results && groups[0].results[0];
      out.firstText = first && String(first.text || "").slice(0, 50);
      out.firstAttrNames = first && (first.attributes || []).map((a) => a.name);
      const hrefAttr = first && (first.attributes || []).find((a) => a.name === "href");
      out.firstHref = hrefAttr && String(hrefAttr.value).slice(0, 70);
    } catch (e) {
      out.ms = Date.now() - t0;
      out.error = (e && e.name) + ": " + (e && e.message);
    }
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
