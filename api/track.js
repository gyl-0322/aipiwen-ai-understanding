/**
 * AIPIWEN Growth Tracker — Server Endpoint v1
 * Vercel serverless function: POST /api/track
 *
 * In-memory aggregation only (resets on cold start).
 * V2: replace _store with a real database write.
 */

// In-memory log (ephemeral)
const _log = [];
const _agg = {
  funnel: {},
  typePerf: {},
  attribution: {}
};

const MAX_LOG = 1000; // cap memory usage

export default function handler(req, res) {
  // CORS for same-origin & WeChat webview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // Append to log
  const entry = { event, meta, session, type, ts: ts || Date.now(), utm, received: Date.now() };
  _log.push(entry);
  if (_log.length > MAX_LOG) _log.shift();

  // Aggregate funnel
  _agg.funnel[event] = (_agg.funnel[event] || 0) + 1;

  // Type performance
  if (type) {
    if (!_agg.typePerf[type]) _agg.typePerf[type] = { views: 0, shares: 0, wecom: 0, leads: 0 };
    if (event === 'result_view')   _agg.typePerf[type].views++;
    if (event === 'poster_share')  _agg.typePerf[type].shares++;
    if (event === 'wecom_click')   _agg.typePerf[type].wecom++;
    if (event === 'lead_captured') _agg.typePerf[type].leads++;
  }

  // Attribution
  const src = (utm && utm.source) || 'direct';
  _agg.attribution[src] = (_agg.attribution[src] || 0) + 1;

  console.log(`[GT] ${event} | session=${session} | type=${type || '-'} | src=${src}`);

  return res.status(200).json({ ok: true });
}
