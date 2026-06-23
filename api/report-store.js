/**
 * api/report-store.js — 专属报告存储与读取
 *
 * POST /api/report-store
 *   body: { sections, engineResult, fingers? }
 *   → { ok: true, id }      (8位hex，唯一报告ID)
 *   存入 Redis key report:{id}，TTL 30天
 *
 * GET  /api/report-store?id=xxx
 *   → { ok: true, report: { sections, engineResult, createdAt } }
 *   → { ok: false, error } (不存在/已过期)
 */

const { redisGet, redisSet } = require('./_lib');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';

  // ─── POST: 保存报告 ─────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = JSON.parse(raw);
    } catch {
      return res.status(400).json({ ok: false, error: '请求体格式错误' });
    }

    const { sections, engineResult, fingers } = body;
    if (!sections?.length || !engineResult) {
      return res.status(400).json({ ok: false, error: '缺少 sections 或 engineResult' });
    }

    const id = crypto.randomBytes(4).toString('hex'); // 8位hex
    const payload = {
      sections,
      engineResult,
      fingers: fingers || [],
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

    const report = await redisGet(`report:${id}`).catch(() => null);
    if (!report) {
      return res.status(404).json({ ok: false, error: '报告不存在或已过期（30天）' });
    }

    return res.status(200).json({ ok: true, report });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
