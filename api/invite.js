/**
 * api/invite.js — 邀请裂变 token 管理
 *
 * GET  /api/invite?action=create  → { ok: true, token }
 *   为当前 IP 创建一个邀请 token，存 Redis 30天
 *   前端把 token 拼入分享链接：https://aipiwen.cn?ref={token}
 *
 * 积分逻辑在 _lib.creditReferral()，被 guest-chat / generate-report 调用
 */

const { redisGet, redisSet, createInviteToken } = require('./_lib');

// 简单防刷：每 IP 每分钟最多创建 5 个 token
async function checkCreateRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:invite:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 5) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';

  // GET /api/invite?action=create
  if (req.method === 'GET') {
    const url    = new URL(req.url, `https://${req.headers.host}`);
    const action = url.searchParams.get('action');

    if (action === 'create') {
      const ok = await checkCreateRate(ip).catch(() => true);
      if (!ok) return res.status(429).json({ ok: false, error: '请求过于频繁' });
      const token = await createInviteToken(ip);
      return res.status(200).json({ ok: true, token });
    }

    return res.status(400).json({ ok: false, error: '缺少 action 参数' });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
