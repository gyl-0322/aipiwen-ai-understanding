const { enqueueReportJob } = require('../lib/report-job-store');
const {
  checkRate,
  checkDailyQuota,
  isVipToken,
  SOFT_LIMIT_MSG,
} = require('./generate-report');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vip-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (process.env.REPORT_ASYNC_ENABLED !== 'true') {
    return res.status(200).json({
      ok: false,
      asyncDisabled: true,
      error: '异步报告生成尚未开启',
    });
  }

  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => { body += c; });
    req.on('end', resolve);
    req.on('error', reject);
  });

  let payload = {};
  try { payload = JSON.parse(body || '{}'); } catch {
    return res.status(400).json({ ok: false, error: '请求格式错误' });
  }
  if (!payload.engineResult) return res.status(400).json({ ok: false, error: '缺少 engineResult' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const vipToken = req.headers['x-vip-token'] || '';
  const vipPass = await isVipToken(vipToken).catch(() => false);
  if (!vipPass) {
    const allowed = await checkRate(ip).catch(() => true);
    if (!allowed) return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });
    const quotaOk = await checkDailyQuota(ip).catch(() => true);
    if (!quotaOk) return res.status(200).json({ ok: false, soft: true, error: SOFT_LIMIT_MSG });
  }

  const job = await enqueueReportJob(payload, {
    ip,
    userAgent: req.headers['user-agent'] || '',
    source: 'report-upload',
  });

  return res.status(200).json({
    ok: true,
    jobId: job.jobId,
    status: job.status,
    pollAfterMs: 3000,
  });
};
