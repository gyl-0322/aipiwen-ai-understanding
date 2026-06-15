/**
 * AIPIWEN Growth Tracker — Server Endpoint v2
 * Vercel serverless: POST /api/track
 *
 * Storage: Vercel KV (Upstash Redis REST API) — persistent across cold starts.
 * Env vars auto-injected when KV store is linked in Vercel dashboard:
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 *
 * Redis schema:
 *   gt:funnel        HASH  { event_name → count }
 *   gt:attr          HASH  { utm_source  → count }
 *   gt:type:{key}    HASH  { views, shares, wecom, leads → count }
 *   gt:types         SET   known type keys (avoids slow KEYS scan)
 *   gt:events        LIST  JSON strings, newest-first, capped at 2000
 */

const MAX_EVENTS = 2000;

// ── KV helpers ────────────────────────────────────────────────────────────────

// Supports both Upstash marketplace vars and legacy Vercel KV vars
function kvBase()  { return process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || null; }
function kvToken() { return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null; }

/** Run multiple Redis commands in a single HTTP round-trip */
async function kvPipeline(commands) {
  const base = kvBase();
  if (!base) return null; // KV not yet connected — silent degraded mode
  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) console.error(`[KV] pipeline HTTP ${res.status}`);
    return res.ok ? res.json() : null;
  } catch (e) {
    console.error('[KV] pipeline error:', e.message);
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event, meta = {}, session, type, ts, utm = {} } = payload || {};

  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: 'Missing event' });
  }

  const src = (utm && utm.source) || 'direct';
  const entry = JSON.stringify({
    event, meta, session, type,
    ts: ts || Date.now(), utm, received: Date.now(),
  });

  // Always: funnel counter + attribution + event log (capped)
  const pipeline = [
    ['HINCRBY', 'gt:funnel', event, 1],
    ['HINCRBY', 'gt:attr',   src,   1],
    ['LPUSH',   'gt:events', entry],
    ['LTRIM',   'gt:events', 0, MAX_EVENTS - 1],
  ];

  // Type-level performance counters
  if (type) {
    const typeKey = `gt:type:${type}`;
    pipeline.push(['SADD', 'gt:types', type]);
    if (event === 'result_view')   pipeline.push(['HINCRBY', typeKey, 'views',  1]);
    if (event === 'poster_share')  pipeline.push(['HINCRBY', typeKey, 'shares', 1]);
    if (event === 'wecom_click')   pipeline.push(['HINCRBY', typeKey, 'wecom',  1]);
    if (event === 'lead_captured') pipeline.push(['HINCRBY', typeKey, 'leads',  1]);
  }

  await kvPipeline(pipeline);

  console.log(`[GT v2] ${event} | session=${session || '-'} | type=${type || '-'} | src=${src}`);

  return res.status(200).json({ ok: true });
}
