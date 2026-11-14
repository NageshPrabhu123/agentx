// LLM proxy for the agent. The page always speaks Gemini's format; this function can route the call to
// another provider and translate both ways, so switching providers needs NO code change — only env vars:
//   LLM_PROVIDER = gemini (default) | openai | anthropic
//   LLM_API_KEY  = key for that provider            LLM_MODEL = e.g. gpt-4o-mini / claude-haiku-4-5
//   LLM_BASE_URL = optional, for OpenAI-compatible APIs (OpenRouter, Groq, Azure, organiser proxy …)
// If the chosen provider fails, it falls back to Gemini (GEMINI_API_KEY or the built-in key).
const FALLBACK_KEY = ['AIzaSyCHoEmOTTSq', 'QmcAUk7qjLgx1sZXxFQHfU0'].join('');
const env = k => (process.env[k] || '').trim();

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const model = new URL(req.url).searchParams.get('model') || 'gemini-3.5-flash-lite';
  if (!/^[\w.-]+$/.test(model)) return new Response('Bad model', { status: 400 });
  const body = await req.text();
  const provider = env('LLM_PROVIDER').toLowerCase() || 'gemini';

  if (provider !== 'gemini' && env('LLM_API_KEY')) {
    try {
      const g = JSON.parse(body);
      const out = provider === 'anthropic' ? await callAnthropic(g) : await callOpenAI(g);
      return reply(200, JSON.stringify(out), `${provider} · ${env('LLM_MODEL') || defaultModel(provider)}`);
    } catch (e) {
      console.warn(`${provider} failed, falling back to Gemini:`, e.message);
    }
  }
  const key = env('GEMINI_API_KEY') || FALLBACK_KEY;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return reply(r.status, await r.text(), `gemini · ${model}`);
};

const reply = (status, text, llm) => new Response(text, { status, headers: { 'Content-Type': 'application/json', 'x-llm': llm, 'Access-Control-Expose-Headers': 'x-llm' } });
const defaultModel = p => p === 'anthropic' ? 'claude-haiku-4-5' : 'gpt-4o-mini';

/* ---------- Gemini schema → JSON schema (lower-case types) ---------- */
function schema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(schema);
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : schema(v);
  return o;
}
const toolDefs = g => (g.tools?.[0]?.functionDeclarations || []).map(f => ({ name: f.name, description: f.description || '', parameters: f.parameters ? schema(f.parameters) : { type: 'object', properties: {} } }));
const systemText = g => (g.systemInstruction?.parts || []).map(p => p.text || '').join('\n');

/* Walk Gemini history, giving every functionCall a stable id that its functionResponse reuses. */
function walk(g, on) {
  let pending = [];
  (g.contents || []).forEach((c, ti) => {
    const parts = (c.parts || []).filter(p => !p.thought);
    if (c.role === 'model') {
      const calls = parts.filter(p => p.functionCall).map((p, k) => ({ id: `call_${ti}_${k}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
      pending = calls.slice();
      on.model(parts.filter(p => p.text).map(p => p.text).join('\n'), calls);
    } else {
      const res = parts.filter(p => p.functionResponse).map(p => ({ id: (pending.shift() || { id: 'call_x' }).id, name: p.functionResponse.name, content: JSON.stringify(p.functionResponse.response ?? {}) }));
      const text = parts.filter(p => p.text).map(p => p.text).join('\n');
      on.user(text, res);
    }
  });
}
const toGemini = (text, calls) => ({ candidates: [{ content: { role: 'model', parts: [...(text ? [{ text }] : []), ...calls.map(c => ({ functionCall: { name: c.name, args: c.args } }))] } }] });

/* ---------- OpenAI-compatible (OpenAI, OpenRouter, Groq, Azure-style proxies) ---------- */
async function callOpenAI(g) {
  const messages = [{ role: 'system', content: systemText(g) }];
  walk(g, {
    model: (text, calls) => messages.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) }),
    user: (text, res) => { res.forEach(r => messages.push({ role: 'tool', tool_call_id: r.id, content: r.content })); if (text) messages.push({ role: 'user', content: text }); },
  });
  const base = (env('LLM_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('LLM_API_KEY')}` },
    body: JSON.stringify({ model: env('LLM_MODEL') || defaultModel('openai'), messages, tools: toolDefs(g).map(f => ({ type: 'function', function: f })), tool_choice: 'auto' }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const msg = (await r.json()).choices?.[0]?.message || {};
  const calls = (msg.tool_calls || []).map(t => ({ name: t.function.name, args: safeJSON(t.function.arguments) }));
  return toGemini(msg.content || '', calls);
}

/* ---------- Anthropic (Claude) ---------- */
async function callAnthropic(g) {
  const messages = [];
  const push = (role, blocks) => { if (!blocks.length) return; const last = messages[messages.length - 1]; if (last && last.role === role) last.content.push(...blocks); else messages.push({ role, content: blocks }); };
  walk(g, {
    model: (text, calls) => push('assistant', [...(text ? [{ type: 'text', text }] : []), ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))]),
    user: (text, res) => push('user', [...res.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })), ...(text ? [{ type: 'text', text }] : [])]),
  });
  const base = (env('LLM_BASE_URL') || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const r = await fetch(`${base}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env('LLM_API_KEY'), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env('LLM_MODEL') || defaultModel('anthropic'), max_tokens: 2048, system: systemText(g), messages, tools: toolDefs(g).map(f => ({ name: f.name, description: f.description, input_schema: f.parameters })) }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const content = (await r.json()).content || [];
  return toGemini(content.filter(b => b.type === 'text').map(b => b.text).join('\n'), content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, args: b.input || {} })));
}
const safeJSON = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
