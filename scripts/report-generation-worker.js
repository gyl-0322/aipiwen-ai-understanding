#!/usr/bin/env node

const {
  getReportJob,
  popReportJobId,
  updateReportJob,
} = require('../lib/report-job-store');
const { generateReportPayload } = require('../api/generate-report');

const POLL_INTERVAL_MS = Number(process.env.REPORT_WORKER_POLL_MS || 3000);
const WORKER_MAX_TOKENS = Number(process.env.REPORT_WORKER_MAX_TOKENS || 6200);
const WORKER_TIMEOUT_MS = Number(process.env.REPORT_WORKER_TIMEOUT_MS || 180000);
const RUN_ONCE = process.env.REPORT_WORKER_ONCE === 'true';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processOneJob() {
  const jobId = await popReportJobId();
  if (!jobId) return false;

  const job = await getReportJob(jobId);
  if (!job) {
    console.warn(`[report-worker] missing job ${jobId}`);
    return true;
  }
  if (!['queued', 'failed_retryable'].includes(job.status)) {
    console.warn(`[report-worker] skip job ${jobId}, status=${job.status}`);
    return true;
  }

  await updateReportJob(jobId, {
    status: 'running',
    progress: 8,
    currentModule: '正在读取报告结构与知识索引',
    attempts: (job.attempts || 0) + 1,
    error: null,
  });

  try {
    const result = await generateReportPayload(job.input, {
      maxTokens: WORKER_MAX_TOKENS,
      timeoutMs: WORKER_TIMEOUT_MS,
      fallbackOnError: true,
    });
    await updateReportJob(jobId, {
      status: 'done',
      progress: 100,
      currentModule: '报告已生成',
      sections: result.sections || [],
      raw: result.raw || '',
      requiredModules: result.requiredModules || [],
      degraded: !!result.degraded,
      message: result.message || '',
      error: null,
    });
    console.log(`[report-worker] done ${jobId} sections=${result.sections?.length || 0} degraded=${!!result.degraded}`);
  } catch (err) {
    await updateReportJob(jobId, {
      status: 'failed',
      progress: 100,
      currentModule: '生成失败',
      error: err?.message || String(err),
    });
    console.error(`[report-worker] failed ${jobId}`, err?.message || err);
  }

  return true;
}

async function main() {
  console.log('[report-worker] started');
  do {
    const processed = await processOneJob();
    if (RUN_ONCE) break;
    if (!processed) await sleep(POLL_INTERVAL_MS);
  } while (true);
}

main().catch(err => {
  console.error('[report-worker] fatal', err);
  process.exit(1);
});
