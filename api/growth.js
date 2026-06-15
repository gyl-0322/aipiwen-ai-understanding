/**
 * AIPIWEN Growth Data API — v1
 * Vercel serverless: GET /api/growth
 *
 * Reads from Vercel KV and returns structured growth data for admin dashboard.
 * Uses the same KV_REST_API_URL / KV_REST_API_TOKEN env vars as api/track.js.
 *
 * Response shape:
 * {
 *   funnel:   { event_name: count, ... },
 *   typePerf: { typeKey: { views, shares, wecom, leads }, ... },
 *   attribution: { source: count, ... },
 *   eventCount: number,   // total events stored
 *   kvConnected: boolean
 * }
 */

// Supports both Upstash marketplace vars and legacy Vercel KV vars
function kvBase()  { return process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || null; }
function kvToken() { return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null; }

async function kvCmd(cmd, ...args) {
  const base = kvBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([cmd, ...args]),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.result ?? null;
  } catch (e) {
    console.error('[KV]', cmd, e.message);
    return null;
  }
}

async function kvPipeline(commands) {
  const base = kvBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.error('[KV] pipeline', e.message);
    return null;
  }
}

/** Convert HGETALL flat array ['k','v','k2','v2'] → {k:v, k2:v2} */
function flatToObj(arr) {
  if (!Array.isArray(arr)) return {};
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = Number(arr[i + 1]) || 0;
  return obj;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const kvConnected = !!kvBase();

  if (!kvConnected) {
    return res.status(200).json({
      kvConnected: false,
      funnel: {}, typePerf: {}, attribution: {}, eventCount: 0,
    });
  }

  // Step 1: parallel fetch funnel + attr + known types + event count
  const [funnelRaw, attrRaw, typesRaw, eventCount] = await Promise.all([
    kvCmd('HGETALL', 'gt:funnel'),
    kvCmd('HGETALL', 'gt:attr'),
    kvCmd('SMEMBERS', 'gt:types'),
    kvCmd('LLEN', 'gt:events'),
  ]);

  const funnel      = flatToObj(funnelRaw);
  const attribution = flatToObj(attrRaw);
  const typeKeys    = Array.isArray(typesRaw) ? typesRaw : [];

  // Step 2: fetch each type's perf hash (pipeline)
  let typePerf = {};
  if (typeKeys.length > 0) {
    const cmds = typeKeys.map(k => ['HGETALL', `gt:type:${k}`]);
    const results = await kvPipeline(cmds);
    if (Array.isArray(results)) {
      results.forEach((item, i) => {
        typePerf[typeKeys[i]] = flatToObj(item.result);
      });
    }
  }

  return res.status(200).json({
    kvConnected: true,
    funnel,
    typePerf,
    attribution,
    eventCount: Number(eventCount) || 0,
  });
}
