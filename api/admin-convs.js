/**
 * AIPIWEN 对话日志管理接口
 * GET /api/admin-convs?secret=xxx            → 会话列表（最新300条）
 * GET /api/admin-convs?secret=xxx&sid=xxx    → 某次会话的完整对话
 *
 * 需要在 Vercel 环境变量中设置 ADMIN_SECRET
 */

const { redisGet } = require('./_lib');

const CONTEXT_LABELS = {
  child:    '亲子',
  self:     '自我',
  partner:  '伴侣',
  business: '合伙',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 鉴权：ADMIN_SECRET 未配置时直接拒绝，不使用默认值
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: '管理密钥未配置，请在 Vercel 环境变量中设置 ADMIN_SECRET' });
  }
  const provided = req.query.secret || req.headers['x-admin-secret'] || '';
  if (provided !== adminSecret) {
    return res.status(401).json({ error: '未授权' });
  }

  const { sid } = req.query;

  // 查询单次会话完整对话
  if (sid) {
    const msgs = await redisGet(`convlog:msgs:${sid}`) || [];
    return res.status(200).json({ sid, msgs });
  }

  // 查询会话列表
  const index = await redisGet('convlog:index') || [];
  const sessions = index.map(s => ({
    ...s,
    contextLabel: CONTEXT_LABELS[s.context] || s.context,
    timeStr: s.ts ? new Date(s.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
  }));

  return res.status(200).json({ total: sessions.length, sessions });
};
