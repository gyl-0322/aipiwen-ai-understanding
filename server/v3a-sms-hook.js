'use strict';

const crypto = require('crypto');
const { Webhook } = require('standardwebhooks');

const PREVIEW_PROJECT_REF = 'lmjriqncuopgxwyudfee';
const PRODUCTION_PROJECT_REF = 'tysbwijizgebnrazxpvo';
const MAX_BODY_BYTES = 20 * 1024;
const IDEMPOTENCY_TTL_SECONDS = 10 * 60;
const HANDLER_DEADLINE_MS = 4300;
const KV_TIMEOUT_MS = 650;
const RESPONSE_BUFFER_MS = 250;
const MIN_PROVIDER_BUDGET_MS = 3000;

class HookError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalize(value) {
  return String(value || '').trim();
}

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? normalize(value[0]) : normalize(value);
}

function parseHookSecret(value) {
  const secret = normalize(value);
  if (!secret.startsWith('v1,whsec_')) {
    throw new HookError(503, 'SMS_HOOK_CONFIG_INVALID');
  }
  const encoded = secret.slice('v1,whsec_'.length);
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64');
  } catch {
    decoded = null;
  }
  if (!decoded || decoded.length < 24 || decoded.length > 128) {
    throw new HookError(503, 'SMS_HOOK_CONFIG_INVALID');
  }
  return encoded;
}

function getConfig(env = process.env) {
  const projectRef = normalize(env.V3A_SUPABASE_PROJECT_REF);
  const vercelEnv = normalize(env.VERCEL_ENV);
  const vercelTargetEnv = normalize(env.VERCEL_TARGET_ENV);
  const enabled = env.V3A_SEND_SMS_HOOK_ENABLED === 'true';
  const kvUrl = normalize(env.KV_REST_API_URL).replace(/\/+$/, '');
  const config = {
    projectRef,
    vercelEnv,
    vercelTargetEnv,
    enabled,
    hookSecret: parseHookSecret(env.V3A_SEND_SMS_HOOK_SECRET),
    accessKeyId: normalize(env.ALIYUN_SMS_ACCESS_KEY_ID),
    accessKeySecret: normalize(env.ALIYUN_SMS_ACCESS_KEY_SECRET),
    signName: normalize(env.ALIYUN_SMS_SIGN_NAME),
    templateCode: normalize(env.ALIYUN_SMS_TEMPLATE_CODE),
    templateParamKey: normalize(env.ALIYUN_SMS_TEMPLATE_PARAM_KEY),
    kvUrl,
    kvToken: normalize(env.KV_REST_API_TOKEN)
  };

  let parsedKv;
  try {
    parsedKv = new URL(config.kvUrl);
  } catch {
    parsedKv = null;
  }
  if (
    projectRef === PRODUCTION_PROJECT_REF || projectRef !== PREVIEW_PROJECT_REF ||
    vercelEnv !== 'preview' || vercelTargetEnv !== 'preview' ||
    !parsedKv || parsedKv.protocol !== 'https:' || parsedKv.username || parsedKv.password || parsedKv.port ||
    parsedKv.origin !== config.kvUrl || parsedKv.pathname !== '/' || parsedKv.search || parsedKv.hash ||
    !config.kvToken || !config.accessKeyId || !config.accessKeySecret ||
    !config.signName || Array.from(config.signName).length > 100 ||
    !/^SMS_[A-Za-z0-9]{6,32}$/.test(config.templateCode) ||
    !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(config.templateParamKey)
  ) {
    throw new HookError(503, 'SMS_HOOK_CONFIG_INVALID');
  }
  if (!enabled) throw new HookError(503, 'SMS_HOOK_DISABLED');
  return config;
}

async function readRawBody(req) {
  const contentType = header(req, 'content-type').toLowerCase();
  if (contentType.split(';', 1)[0].trim() !== 'application/json') {
    throw new HookError(415, 'JSON_REQUIRED');
  }
  const declaredLength = Number(header(req, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HookError(413, 'PAYLOAD_TOO_LARGE');
  }
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
    throw new HookError(400, 'INVALID_REQUEST_BODY');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HookError(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(buffer);
  }
  if (size === 0) throw new HookError(400, 'INVALID_REQUEST_BODY');
  return Buffer.concat(chunks).toString('utf8');
}

function verifyPayload(config, rawBody, headers) {
  try {
    return new Webhook(config.hookSecret).verify(rawBody, headers);
  } catch {
    throw new HookError(401, 'INVALID_WEBHOOK_SIGNATURE');
  }
}

function normalizeChinaSmsPhone(value) {
  const match = /^(?:\+86|86)(1[3-9][0-9]{9})$/.exec(normalize(value));
  if (!match) throw new HookError(400, 'INVALID_SMS_PAYLOAD');
  return match[1];
}

function validatePayload(payload) {
  const phone = normalizeChinaSmsPhone(payload?.user?.phone);
  const otp = normalize(payload?.sms?.otp);
  if (!/^[0-9]{6}$/.test(otp)) {
    throw new HookError(400, 'INVALID_SMS_PAYLOAD');
  }
  return { phone, otp };
}

async function kvCommand(config, command, fetchImpl, deadlineAt) {
  const remaining = Math.min(KV_TIMEOUT_MS, deadlineAt - Date.now());
  if (remaining <= 0) throw new HookError(503, 'SMS_HOOK_DEADLINE_EXCEEDED');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HookError(503, 'SMS_IDEMPOTENCY_UNAVAILABLE'));
    }, remaining);
  });
  try {
    const response = await Promise.race([fetchImpl(config.kvUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    }), timeout]);
    const payload = await Promise.race([response.json(), timeout]);
    if (!response.ok || !payload || Object.prototype.hasOwnProperty.call(payload, 'error')) {
      throw new HookError(503, 'SMS_IDEMPOTENCY_UNAVAILABLE');
    }
    return payload.result;
  } catch {
    throw new HookError(503, 'SMS_IDEMPOTENCY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function requestDigests(config, webhookId, rawBody) {
  const key = Buffer.from(config.hookSecret, 'base64');
  return {
    id: crypto.createHmac('sha256', key).update(`id:${webhookId}`).digest('hex'),
    payload: crypto.createHmac('sha256', key).update(`payload:${rawBody}`).digest('hex')
  };
}

async function claimWebhook(config, webhookId, rawBody, fetchImpl, deadlineAt) {
  const digest = requestDigests(config, webhookId, rawBody);
  const key = `v3a:sms-hook:${digest.id}`;
  const pending = `pending:${digest.payload}`;
  const claimed = await kvCommand(
    config,
    ['SET', key, pending, 'EX', String(IDEMPOTENCY_TTL_SECONDS), 'NX'],
    fetchImpl,
    deadlineAt
  );
  if (claimed === 'OK') return { state: 'claimed', key, pending, digest };
  const existing = normalize(await kvCommand(config, ['GET', key], fetchImpl, deadlineAt));
  if (existing === `sent:${digest.payload}`) return { state: 'sent', key, pending, digest };
  if (existing === pending) return { state: 'pending', key, pending, digest };
  return { state: 'conflict', key, pending, digest };
}

async function markSent(config, claim, fetchImpl, deadlineAt) {
  await kvCommand(
    config,
    ['SETEX', claim.key, String(IDEMPOTENCY_TTL_SECONDS), `sent:${claim.digest.payload}`],
    fetchImpl,
    deadlineAt
  );
}

async function releaseClaim(config, claim, fetchImpl, deadlineAt) {
  const script = 'if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
  try {
    await kvCommand(config, ['EVAL', script, '1', claim.key, claim.pending], fetchImpl, deadlineAt);
  } catch {
    // Keep the short-lived claim when release cannot be proven safe.
  }
}

async function sendAliyunSms(config, sms, outId) {
  const { default: DysmsClient, SendSmsRequest } = require('@alicloud/dysmsapi20170525');
  const { $OpenApiUtil } = require('@alicloud/openapi-core');
  const client = new DysmsClient(new $OpenApiUtil.Config({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    endpoint: 'dysmsapi.aliyuncs.com',
    connectTimeout: 800,
    readTimeout: 2000
  }));
  const request = new SendSmsRequest({
    phoneNumbers: sms.phone,
    signName: config.signName,
    templateCode: config.templateCode,
    templateParam: JSON.stringify({ [config.templateParamKey]: sms.otp }),
    outId: `v3a_${outId.slice(0, 32)}`
  });
  const response = await client.sendSms(request);
  return response?.body?.code === 'OK';
}

function setHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Allow', 'POST');
}

function respond(res, statusCode) {
  if (statusCode === 200) return res.status(200).json({});
  const message = statusCode === 405
    ? 'Method not allowed.'
    : statusCode === 400 || statusCode === 401
      ? '短信请求校验失败。'
      : statusCode === 409
        ? '短信请求状态冲突，请重新获取验证码。'
        : '短信发送暂时不可用，请稍后重试。';
  return res.status(statusCode).json({ error: { http_code: statusCode, message } });
}

async function runProviderWithinDeadline(operation, deadlineAt, responseBufferMs) {
  const remaining = deadlineAt - Date.now() - responseBufferMs;
  if (remaining <= 0) throw new HookError(503, 'SMS_HOOK_DEADLINE_EXCEEDED');
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new HookError(503, 'SMS_HOOK_DEADLINE_EXCEEDED')), remaining);
  });
  const provider = Promise.resolve().then(operation);
  try {
    return await Promise.race([provider, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function createHandler(dependencies = {}) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const sendSms = dependencies.sendSms || sendAliyunSms;
  const handlerDeadlineMs = dependencies.handlerDeadlineMs || HANDLER_DEADLINE_MS;
  const responseBufferMs = dependencies.responseBufferMs || RESPONSE_BUFFER_MS;
  const minProviderBudgetMs = dependencies.minProviderBudgetMs || MIN_PROVIDER_BUDGET_MS;

  return async function handler(req, res) {
    setHeaders(res);
    if (req.method !== 'POST') return respond(res, 405);
    const deadlineAt = Date.now() + handlerDeadlineMs;
    let claim;
    try {
      const config = getConfig();
      const rawBody = await readRawBody(req);
      const webhookHeaders = {
        'webhook-id': header(req, 'webhook-id'),
        'webhook-timestamp': header(req, 'webhook-timestamp'),
        'webhook-signature': header(req, 'webhook-signature')
      };
      const payload = verifyPayload(config, rawBody, webhookHeaders);
      const sms = validatePayload(payload);
      const webhookId = webhookHeaders['webhook-id'];
      if (!webhookId || webhookId.length > 200 || /[\u0000-\u001F\u007F]/.test(webhookId)) {
        throw new HookError(401, 'INVALID_WEBHOOK_SIGNATURE');
      }

      claim = await claimWebhook(config, webhookId, rawBody, fetchImpl, deadlineAt);
      if (claim.state === 'sent') return respond(res, 200);
      if (claim.state === 'pending') throw new HookError(503, 'SMS_SEND_IN_PROGRESS');
      if (claim.state === 'conflict') throw new HookError(409, 'WEBHOOK_REPLAY_CONFLICT');
      if (deadlineAt - Date.now() < minProviderBudgetMs) {
        await releaseClaim(config, claim, fetchImpl, deadlineAt);
        claim = null;
        throw new HookError(503, 'SMS_HOOK_DEADLINE_EXCEEDED');
      }

      let accepted;
      try {
        accepted = await runProviderWithinDeadline(
          () => sendSms(config, sms, claim.digest.id),
          deadlineAt,
          responseBufferMs
        );
      } catch {
        throw new HookError(503, 'SMS_PROVIDER_UNAVAILABLE');
      }
      if (!accepted) {
        await releaseClaim(config, claim, fetchImpl, deadlineAt);
        claim = null;
        throw new HookError(502, 'SMS_PROVIDER_REJECTED');
      }
      try {
        await markSent(config, claim, fetchImpl, deadlineAt);
      } catch {
        // The provider accepted the message; returning 200 avoids a duplicate retry.
      }
      return respond(res, 200);
    } catch (error) {
      const safe = error instanceof HookError
        ? error
        : new HookError(500, 'SMS_HOOK_ERROR');
      return respond(res, safe.statusCode);
    }
  };
}

module.exports = {
  HookError,
  getConfig,
  readRawBody,
  sendAliyunSms,
  createHandler,
  handler: createHandler()
};
