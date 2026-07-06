/**
 * Report PDF payment dry-run API.
 *
 * This endpoint never connects to Alipay, WeChat Pay, databases, or real money.
 * It only returns mock order/status payloads so the PDF download payment wall can
 * be tested safely in Preview.
 */

const crypto = require('crypto');

const PRICE_CENTS = 1990;
const PRICE_YUAN = '19.9';
const VALID_PROVIDERS = new Set(['alipay', 'wechat']);

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32 * 1024) {
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function makeOrderId(provider) {
  return `DRYRUN-${provider.toUpperCase()}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      mode: 'dry-run',
      payment: 'mock',
      realPaymentConnected: false,
      amount: PRICE_YUAN,
      amountCents: PRICE_CENTS,
    });
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return send(res, error.code === 413 ? 413 : 400, {
      ok: false,
      error: error.code === 413 ? '请求体过大' : '请求体格式错误',
    });
  }

  const action = String(payload.action || 'create');
  const provider = String(payload.provider || 'alipay');
  const reportId = String(payload.reportId || '').trim();

  if (!reportId) {
    return send(res, 400, { ok: false, error: '缺少 reportId' });
  }

  if (!VALID_PROVIDERS.has(provider)) {
    return send(res, 400, { ok: false, error: '不支持的 mock 支付方式' });
  }

  if (action === 'create') {
    const orderId = makeOrderId(provider);
    return send(res, 200, {
      ok: true,
      mode: 'dry-run',
      status: 'created',
      provider,
      reportId,
      orderId,
      amount: PRICE_YUAN,
      amountCents: PRICE_CENTS,
      currency: 'CNY',
      realPaymentConnected: false,
      message: '这是模拟支付订单，不会发起真实支付宝或微信支付。',
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
  }

  if (action === 'mock_paid') {
    const orderId = String(payload.orderId || makeOrderId(provider));
    return send(res, 200, {
      ok: true,
      mode: 'dry-run',
      status: 'paid',
      provider,
      reportId,
      orderId,
      amount: PRICE_YUAN,
      amountCents: PRICE_CENTS,
      currency: 'CNY',
      realPaymentConnected: false,
      paidAt: Date.now(),
      message: '模拟支付成功。Preview 中可解锁当前 reportId 的 PDF 下载。',
    });
  }

  if (action === 'status') {
    return send(res, 200, {
      ok: true,
      mode: 'dry-run',
      status: 'client_managed',
      provider,
      reportId,
      amount: PRICE_YUAN,
      amountCents: PRICE_CENTS,
      realPaymentConnected: false,
      message: 'dry-run 状态由前端 localStorage 记录。',
    });
  }

  return send(res, 400, { ok: false, error: '未知 dry-run action' });
};
