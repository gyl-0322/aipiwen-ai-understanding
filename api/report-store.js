/**
 * api/report-store.js — 专属报告存储与读取
 *
 * POST /api/report-store
 *   body: { sections, engineResult, fingers?, name?, age? }
 *   → { ok: true, id }      (8位hex，唯一报告ID)
 *   存入 Redis key report:{id}，TTL 30天
 *
 * GET  /api/report-store?id=xxx
 *   → { ok: true, report: { sections, engineResult, fingers, name, age, createdAt } }
 *   → { ok: false, error } (不存在/已过期)
 */

const { redisGet, redisSet, getOpenid } = require('./_lib');
const crypto = require('crypto');

// ── IP 限流：每 IP 每分钟最多 10 次 POST ─────────────────────────────────
async function checkRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:rptstore:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 10) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';

  // ─── POST: 保存报告 ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    // 限流
    const allowed = await checkRate(ip).catch(() => true);
    if (!allowed) {
      return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });
    }

    // body 大小限制：500KB（sections 文本内容，不含图片）
    const MAX_BODY = 500 * 1024;
    let body;
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        let bytes = 0;
        req.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_BODY) {
            reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 }));
            req.destroy();
          } else {
            data += chunk;
          }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = JSON.parse(raw);
    } catch(e) {
      const code = e.code === 413 ? 413 : 400;
      return res.status(code).json({ ok: false, error: code === 413 ? '报告数据过大' : '请求体格式错误' });
    }

    const { sections, engineResult, fingers, name, age } = body;
    if (!sections?.length || !engineResult) {
      return res.status(400).json({ ok: false, error: '缺少 sections 或 engineResult' });
    }

    const id = crypto.randomBytes(4).toString('hex'); // 8位hex
    const payload = {
      sections,
      engineResult,
      fingers:   fingers   || [],
      name:      name      ? String(name).slice(0, 40)  : null,
      age:       age       ? Number(age) || null        : null,
      createdAt: Date.now(),
      ip,
    };
    await redisSet(`report:${id}`, payload, 30 * 86400);

    return res.status(200).json({ ok: true, id });
  }

  // ─── GET: 读取报告 ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const id  = url.searchParams.get('id');
    if (!id) return res.status(400).json({ ok: false, error: '缺少 id 参数' });

    // ── 解锁鉴权（PAYMENT_ENABLED=true 时才启用）────────────────────────────
    const paymentEnabled = process.env.PAYMENT_ENABLED === 'true';
    if (paymentEnabled) {
      const openid = getOpenid(req);
      if (!openid) {
        return res.status(401).json({ ok: false, error: '请先登录后查看完整报告', needLogin: true });
      }
      const unlocked = (await redisGet(`unlock_events:${openid}`).catch(() => null)) || [];
      const ids = Array.isArray(unlocked) ? unlocked : Object.keys(unlocked);
      if (!ids.includes(id)) {
        return res.status(402).json({ ok: false, error: '该报告需解锁后查看', needUnlock: true, reportId: id });
      }
    }

    const report = await redisGet(`report:${id}`).catch(() => null);
    if (!report) {
      return res.status(404).json({ ok: false, error: '报告不存在或已过期（30天）' });
    }

    return res.status(200).json({ ok: true, report });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
