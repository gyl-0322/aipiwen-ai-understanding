/**
 * AIPIWEN 通用会话日志接口
 * POST /api/log-session
 * body: { sessionId, context, summary, detail }
 *
 * 用于非对话式页面（皮纹速测、报告上传入口等）记录用户行为，
 * 写入与 guest-chat.js 完全相同的 convlog:* Redis 结构，
 * 供 admin-convs.html 统一查看、导出、自动分析。
 *
 * context 值约定：
 *   'fingerprint'  皮纹速测结果
 *   'report'       报告上传入口（guest-chat.js 已独立记录对话，此处可补充入口信息）
 *   其他自定义字符串均可
 *
 * sessionId 由前端生成（fp_{timestamp}_{random5}）
 * 同一 sessionId 只写一次（幂等），防止重复上报
 */

const { redisSet, redisGet } = require('./_lib');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { sessionId, context, summary, detail } = payload || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 80) {
    return res.status(400).json({ error: 'sessionId 必填且不超过80字符' });
  }
  if (!context || typeof context !== 'string') {
    return res.status(400).json({ error: 'context 必填' });
  }

  const ip = (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  ).slice(0, 20);

  const ts = Date.now();

  try {
    const msgsKey = `convlog:msgs:${sessionId}`;

    // 幂等：已存在则跳过
    const existing = await redisGet(msgsKey);
    if (existing && existing.length > 0) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const msgs = [
      { role: 'user', content: String(summary || '').slice(0, 1000), ts },
      { role: 'ai',   content: String(detail  || '').slice(0, 1000), ts: ts + 1 },
    ];

    // 保留90天（比行为分析的60天更长，确保训练数据不流失）
    await redisSet(msgsKey, msgs, 90 * 86400);

    // 写入会话索引（与 guest-chat.js 共用同一个 convlog:index）
    const index = await redisGet('convlog:index') || [];
    index.unshift({
      sessionId,
      context,
      ts,
      firstMsg: String(summary || '').slice(0, 120),
      ip,
    });
    if (index.length > 500) index.splice(500);
    await redisSet('convlog:index', index);

    console.log(`[log-session] ${context} | sid=${sessionId} | ip=${ip}`);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('[log-session] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
