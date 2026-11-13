// Shared demo data for all devices (client / advocate / admin laptops), kept in Netlify Blobs.
// GET  → current state.   POST → merge the device's changes (newest "updated" wins) and return the result.
// POST ?reset=1 → wipe everything and start a new "epoch" (all devices clear their local copy).
import { getStore } from '@netlify/blobs';

const KEY = 'state';
const fresh = () => ({ epoch: Date.now().toString(36), seq: 1040, matters: [], notifs: [] });
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async (req) => {
  const store = getStore({ name: 'nyayadesk', consistency: 'strong' });
  let cur = (await store.get(KEY, { type: 'json' })) || null;
  if (!cur) { cur = fresh(); await store.setJSON(KEY, cur); }
  if (req.method === 'GET') return json(cur);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (new URL(req.url).searchParams.get('reset')) { cur = fresh(); await store.setJSON(KEY, cur); return json(cur); }

  let inc;
  try { inc = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (inc.epoch && inc.epoch !== cur.epoch) return json(cur); // stale device after a reset: ignore its data

  const mm = new Map(cur.matters.map(m => [m.id, m]));
  for (const m of inc.matters || []) { const e = mm.get(m.id); if (!e || (m.updated || 0) >= (e.updated || 0)) mm.set(m.id, m); }
  const nm = new Map(cur.notifs.map(n => [n.id, n]));
  for (const n of inc.notifs || []) { const e = nm.get(n.id); nm.set(n.id, e ? { ...e, read: e.read || n.read } : n); }

  cur = {
    epoch: cur.epoch,
    seq: Math.max(cur.seq || 0, inc.seq || 0),
    matters: [...mm.values()].sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 200),
    notifs: [...nm.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 400),
  };
  await store.setJSON(KEY, cur);
  return json(cur);
};
