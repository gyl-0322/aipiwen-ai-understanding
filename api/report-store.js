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

const PAYMENT_DRYRUN_PRICE_CENTS = 1990;
const PAYMENT_DRYRUN_PRICE_YUAN = '19.9';
const PAYMENT_DRYRUN_PROVIDERS = new Set(['alipay', 'wechat']);

// ── IP 限流：每 IP 每分钟最多 10 次 POST ─────────────────────────────────
async function checkRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:rptstore:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 10) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

function buildPaymentDryRunResponse(body = {}) {
  const action = String(body.action || '');
  if (!['payment_dryrun_create', 'payment_dryrun_mock_paid', 'payment_dryrun_status'].includes(action)) return null;

  const provider = String(body.provider || 'alipay').toLowerCase();
  const reportId = String(body.reportId || '').trim();
  if (!reportId) return { status: 400, body: { ok: false, error: '缺少 reportId' } };
  if (!PAYMENT_DRYRUN_PROVIDERS.has(provider)) {
    return { status: 400, body: { ok: false, error: '不支持的模拟支付方式' } };
  }

  const orderId = String(body.orderId || `DRYRUN-${provider.toUpperCase()}-${Date.now()}-${reportId.slice(0, 6)}`);
  const base = {
    ok: true,
    dryRunOnly: true,
    reportId,
    amount: PAYMENT_DRYRUN_PRICE_YUAN,
    amountCents: PAYMENT_DRYRUN_PRICE_CENTS,
    provider,
    orderId,
  };

  if (action === 'payment_dryrun_create') {
    return {
      status: 200,
      body: {
        ...base,
        status: 'created',
        message: '模拟订单已创建。Preview 不连接真实支付宝或微信。',
      },
    };
  }

  if (action === 'payment_dryrun_mock_paid') {
    return {
      status: 200,
      body: {
        ...base,
        status: 'paid',
        paidAt: Date.now(),
        message: '模拟支付成功。Preview 中可解锁当前 reportId 的 PDF 下载。',
      },
    };
  }

  return {
    status: 200,
    body: {
      ...base,
      status: 'unknown',
      message: 'dry-run 支付状态仅在前端 localStorage 中临时保存。',
    },
  };
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

    const paymentDryRun = buildPaymentDryRunResponse(body);
    if (paymentDryRun) return res.status(paymentDryRun.status).json(paymentDryRun.body);

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
