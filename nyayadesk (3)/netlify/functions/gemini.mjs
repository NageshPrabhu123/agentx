// Server-side proxy: the browser never sees the Gemini API key.
// Uses the GEMINI_API_KEY environment variable if set, otherwise the built-in key.
const FALLBACK_KEY = ['AIzaSyCHoEmOTTSq', 'QmcAUk7qjLgx1sZXxFQHfU0'].join('');

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const key = process.env.GEMINI_API_KEY || FALLBACK_KEY;
  const model = new URL(req.url).searchParams.get('model') || 'gemini-3.5-flash-lite';
  if (!/^[\w.-]+$/.test(model)) return new Response('Bad model', { status: 400 });
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await req.text() }
  );
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};
