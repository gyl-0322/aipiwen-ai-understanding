/**
 * AIPIWEN 基础统计接口
 *
 * POST /api/stats        { event, meta? }  → 记录一次事件（埋点）
 * GET  /api/stats?admin=1&secret=xxx       → 查看统计数据
 *
 * Redis key 结构：
 *   stats:daily:{event}:{YYYY-MM-DD}  → 当天事件次数
 *   stats:total:{event}               → 累计次数
 *   stats:events                      → 所有事件名列表
 */

const { redisSet, redisGet } = require('./_lib');

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── 写入事件（埋点）────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = '';
    await new Promise(resolve => { req.on('data', c => (body += c)); req.on('end', resolve); });
    let payload = {};
    try { payload = JSON.parse(body); } catch {}

    const { event } = payload;
    if (!event?.trim()) return res.status(400).json({ error: 'event 必填' });

    const date = today();
    const dailyKey = `stats:daily:${event}:${date}`;
    const totalKey = `stats:total:${event}`;

    const [daily, total, events] = await Promise.all([
      redisGet(dailyKey).then(v => (v || 0) + 1),
      redisGet(totalKey).then(v => (v || 0) + 1),
      redisGet('stats:events').then(v => v || []),
    ]);

    const updatedEvents = events.includes(event) ? events : [...events, event];

    await Promise.all([
      redisSet(dailyKey, daily, 90 * 86400), // 保留90天
      redisSet(totalKey, total),
      redisSet('stats:events', updatedEvents),
    ]);

    return res.status(200).json({ ok: true });
  }

  // ── 查看统计（管理端）───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided    = req.query.secret || req.headers['x-admin-secret'] || '';
    if (adminSecret && provided !== adminSecret) {
      return res.status(401).json({ error: '未授权' });
    }

    const events = await redisGet('stats:events') || [];

    // 最近14天日期
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - i * 86400000);
      return d.toISOString().slice(0, 10);
    }).reverse();

    const result = {};
    for (const event of events) {
      const total = await redisGet(`stats:total:${event}`) || 0;
      const daily = {};
      for (const date of dates) {
        daily[date] = (await redisGet(`stats:daily:${event}:${date}`)) || 0;
      }
      result[event] = { total, daily };
    }

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      dates,
      events: result,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
