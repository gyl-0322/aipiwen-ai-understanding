const crypto = require('crypto');
const { redisGet, redisSet } = require('../api/_lib');

const QUEUE_KEY = 'report:jobs:queue';
const JOB_TTL_SECONDS = 3 * 24 * 60 * 60;

function kvUrl() {
  return process.env.KV_REST_API_URL || process.env.REDIS_URL || '';
}

function kvToken() {
  return process.env.KV_REST_API_TOKEN || '';
}

function makeJobId() {
  return `rpt_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function jobKey(jobId) {
  return `report:job:${jobId}`;
}

async function upstashPipeline(commands) {
  const url = kvUrl();
  const token = kvToken();
  if (!url || !token) throw new Error('Redis 环境变量未配置');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline failed: ${res.status}`);
  return res.json();
}

async function enqueueReportJob(input, meta = {}) {
  const jobId = makeJobId();
  const now = Date.now();
  const job = {
    jobId,
    status: 'queued',
    progress: 0,
    currentModule: '等待生成',
    input,
    sections: null,
    error: null,
    degraded: false,
    attempts: 0,
    meta,
    createdAt: now,
    updatedAt: now,
  };
  await redisSet(jobKey(jobId), job, JOB_TTL_SECONDS);
  await upstashPipeline([['RPUSH', QUEUE_KEY, jobId]]);
  return job;
}

async function getReportJob(jobId) {
  if (!jobId) return null;
  return redisGet(jobKey(jobId));
}

async function updateReportJob(jobId, patch) {
  const current = await getReportJob(jobId);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await redisSet(jobKey(jobId), next, JOB_TTL_SECONDS);
  return next;
}

async function popReportJobId() {
  const data = await upstashPipeline([['LPOP', QUEUE_KEY]]);
  return data?.[0]?.result || null;
}

module.exports = {
  QUEUE_KEY,
  enqueueReportJob,
  getReportJob,
  updateReportJob,
  popReportJobId,
};
