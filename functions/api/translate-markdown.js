// Markdown-aware translation: preserve fences, line breaks, tables and Markdown markers.
export async function onRequest({ request }) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const text = typeof body.text === 'string' ? body.text : '';
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  let translatedText = text;
  try { translatedText = await translateMarkdown(text, request); } catch (error) {
    // Return a usable preview instead of turning a single failed chunk into HTTP 500.
    translatedText = text;
  }
  const result = { text: translatedText, fields: {}, partial: translatedText === text };
  for (const [key, value] of Object.entries(fields)) {
    try {
      if (typeof value === 'string') result.fields[key] = await translateText(value, request);
      else if (Array.isArray(value)) result.fields[key] = await Promise.all(value.map(v => translateText(String(v), request)));
    } catch { result.fields[key] = value; }
  }
  return json(result);
}
async function translateMarkdown(text, request) {
  const lines = text.split(/(\r?\n)/);
  const out = []; let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; out.push(line); continue; }
    if (inCode || /^\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) { out.push(line); continue; }
    // Translate text runs inside each line/cell, preserving Markdown punctuation and layout.
    try { out.push(await translateMixed(line, request)); }
    catch { out.push(line); }
  }
  return out.join('');
}
async function translateMixed(text, request) {
  const runs = text.match(/[\u4e00-\u9fff]+|[^\u4e00-\u9fff]+/g) || [text];
  const translated = await mapLimit(runs, 2, async (run) => /[\u4e00-\u9fff]/.test(run) ? translateText(run, request) : run);
  return translated.join('');
}

async function mapLimit(items, limit, fn) { const out = new Array(items.length); let next = 0; async function worker(){ while(true){ const i=next++; if(i>=items.length)return; out[i]=await fn(items[i],i); } } await Promise.all(Array.from({length:Math.min(limit,items.length)}, worker)); return out; }
async function batch(values, request) {
  const result=[];
  for(let i=0;i<values.length;i+=8){
    const part=values.slice(i,i+8), r=await fetch(new URL('/api/translate',request.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts:part,to:'en'})});
    const d=await r.json(); result.push(...part.map((v,j)=>d.translations?.[j]||v));
  }
  return result;
}
async function translateText(text, request) { if(!text || !/[\u4e00-\u9fff]/.test(text)) return text; const r=await batch([text],request); return r[0]||text; }
function json(o,status=200){return new Response(JSON.stringify(o),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
