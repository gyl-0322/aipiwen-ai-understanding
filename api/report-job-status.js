const { getReportJob } = require('../lib/report-job-store');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = new URL(req.url, `https://${req.headers.host}`);
  const jobId = url.searchParams.get('id');
  if (!jobId) return res.status(400).json({ ok: false, error: '缺少 jobId' });

  const job = await getReportJob(jobId).catch(() => null);
  if (!job) return res.status(404).json({ ok: false, error: '任务不存在或已过期' });

  const base = {
    ok: true,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress || 0,
    currentModule: job.currentModule || '',
    error: job.error || null,
    degraded: !!job.degraded,
    message: job.message || '',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };

  if (job.status === 'done') {
    base.sections = job.sections || [];
    base.raw = job.raw || '';
    base.requiredModules = job.requiredModules || [];
  }

  return res.status(200).json(base);
};
