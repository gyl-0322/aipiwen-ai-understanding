#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { Webhook } = require('standardwebhooks');
const { createHandler, sendAliyunSms } = require('../server/v3a-sms-hook');

const PREVIEW_REF = 'lmjriqncuopgxwyudfee';
const PRODUCTION_REF = 'tysbwijizgebnrazxpvo';
const KV_URL = 'https://kv-sms-hook.test';
const KV_TOKEN = 'TEST_KV_TOKEN_NOT_REAL';
const ACCESS_KEY_ID = 'TEST_ACCESS_KEY_ID_NOT_REAL';
const ACCESS_KEY_SECRET = 'TEST_ACCESS_KEY_SECRET_NOT_REAL';
const PHONE = '+8613800138000';
const LOCAL_PHONE = '13800138000';
const OTP = '123456';
const SECRET = Buffer.from('test-standard-webhook-secret-32b').toString('base64');
const PAYLOAD = JSON.stringify({ user: { phone: PHONE }, sms: { otp: OTP } });
const ENV_KEYS = [
  'V3A_SUPABASE_PROJECT_REF',
  'VERCEL_ENV',
  'VERCEL_TARGET_ENV',
  'V3A_SEND_SMS_HOOK_ENABLED',
  'V3A_SEND_SMS_HOOK_SECRET',
  'ALIYUN_SMS_ACCESS_KEY_ID',
  'ALIYUN_SMS_ACCESS_KEY_SECRET',
  'ALIYUN_SMS_SIGN_NAME',
  'ALIYUN_SMS_TEMPLATE_CODE',
  'ALIYUN_SMS_TEMPLATE_PARAM_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN'
];

function previewEnv(overrides = {}) {
  return {
    V3A_SUPABASE_PROJECT_REF: PREVIEW_REF,
    VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'preview',
    V3A_SEND_SMS_HOOK_ENABLED: 'true',
    V3A_SEND_SMS_HOOK_SECRET: `v1,whsec_${SECRET}`,
    ALIYUN_SMS_ACCESS_KEY_ID: ACCESS_KEY_ID,
    ALIYUN_SMS_ACCESS_KEY_SECRET: ACCESS_KEY_SECRET,
    ALIYUN_SMS_SIGN_NAME: '测试签名',
    ALIYUN_SMS_TEMPLATE_CODE: 'SMS_123456789',
    ALIYUN_SMS_TEMPLATE_PARAM_KEY: 'code',
    KV_REST_API_URL: KV_URL,
    KV_REST_API_TOKEN: KV_TOKEN,
    ...overrides
  };
}

async function withEnv(env, callback) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);
  try {
    return await callback();
  } finally {
    ENV_KEYS.forEach((key) => {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    });
  }
}

function response(statusCode, payload) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    async json() { return payload; }
  };
}

function createKvFetch(options = {}) {
  const store = new Map();
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    assert.equal(url, KV_URL, 'Hook 只能访问专用 Preview KV');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers?.Authorization, `Bearer ${KV_TOKEN}`);
    const command = JSON.parse(init.body);
    calls.push(command);
    if (options.fail) return response(500, { error: 'test failure' });
    const [rawName, ...args] = command;
    const name = String(rawName).toUpperCase();
    let result;
    if (name === 'SET') {
      const [key, value] = args;
      const nx = args.some((item) => String(item).toUpperCase() === 'NX');
      if (nx && store.has(key)) result = null;
      else {
        store.set(key, String(value));
        result = 'OK';
      }
    } else if (name === 'GET') {
      result = store.has(args[0]) ? store.get(args[0]) : null;
    } else if (name === 'SETEX') {
      store.set(args[0], String(args[2]));
      result = 'OK';
    } else if (name === 'EVAL') {
      const key = args[2];
      const expected = String(args[3]);
      if (store.get(key) === expected) {
        store.delete(key);
        result = 1;
      } else result = 0;
    } else {
      throw new Error(`Unexpected KV command: ${name}`);
    }
    return response(200, { result });
  };
  fetchStub.calls = calls;
  fetchStub.store = store;
  return fetchStub;
}

function signedRequest(options = {}) {
  const body = options.body ?? PAYLOAD;
  const webhookId = options.webhookId || 'msg_preview_sms_001';
  const timestamp = options.timestamp || new Date();
  const signature = new Webhook(SECRET).sign(webhookId, timestamp, body);
  const req = Readable.from(options.chunks || [Buffer.from(body)]);
  req.method = options.method || 'POST';
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    'webhook-id': webhookId,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': options.signature || signature,
    ...options.headers
  };
  Object.defineProperty(req, 'body', {
    get() { throw new Error('签名校验不得读取或重建 req.body'); }
  });
  return req;
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    send(value) { this.payload = value; return this; }
  };
}

function createHarness(options = {}) {
  const fetch = options.fetch || createKvFetch();
  const sends = [];
  const providerResults = [...(options.providerResults || [true])];
  const sendSms = async (config, sms, outId) => {
    sends.push({ config, sms, outId });
    const result = providerResults.length ? providerResults.shift() : true;
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetch, sends, handler: createHandler({ fetch, sendSms }) };
}

async function invoke(handler, req) {
  const res = createRes();
  await handler(req, res);
  return res;
}

async function testValidAndDuplicate() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness();
    const first = await invoke(harness.handler, signedRequest());
    const duplicate = await invoke(harness.handler, signedRequest());
    const splitAt = Math.floor(PAYLOAD.length / 2);
    const chunked = await invoke(harness.handler, signedRequest({
      webhookId: 'msg_preview_sms_chunked',
      chunks: [Buffer.from(PAYLOAD.slice(0, splitAt)), Buffer.from(PAYLOAD.slice(splitAt))]
    }));
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload, '', '成功响应必须为空');
    assert.equal(duplicate.statusCode, 200, '已发送的相同 webhook 必须幂等成功');
    assert.equal(chunked.statusCode, 200, '多 chunk 原始请求体必须保持验签字节不变');
    assert.equal(harness.sends.length, 2, '重复 webhook 不得重复发送短信');
    assert.deepStrictEqual(harness.sends[0].sms, { phone: '13800138000', otp: OTP });
    assert.equal(harness.sends[0].config.projectRef, PREVIEW_REF);
    const kvText = JSON.stringify(harness.fetch.calls);
    assert(!kvText.includes(PHONE) && !kvText.includes('13800138000') && !kvText.includes(OTP),
      'KV key/value 不得包含手机号或 OTP');
  });
}

async function testSupabaseChinaPhoneFormats() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness();
    const formats = [PHONE, `86${LOCAL_PHONE}`];
    for (const [index, phone] of formats.entries()) {
      const body = JSON.stringify({ user: { phone }, sms: { otp: OTP } });
      const result = await invoke(harness.handler, signedRequest({
        body,
        webhookId: `msg_china_phone_format_${index}`
      }));
      assert.equal(result.statusCode, 200, `中国手机号格式 ${index + 1} 应被 Hook 接受`);
      assert.equal(harness.sends[index].sms.phone, LOCAL_PHONE, '阿里云只接收 11 位中国大陆手机号');
    }
  });
}

async function testConcurrentClaim() {
  await withEnv(previewEnv(), async () => {
    const fetch = createKvFetch();
    let markStarted;
    let releaseProvider;
    const providerStarted = new Promise((resolve) => { markStarted = resolve; });
    const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
    let sends = 0;
    const handler = createHandler({
      fetch,
      async sendSms() {
        sends += 1;
        markStarted();
        await providerGate;
        return true;
      }
    });
    const firstPromise = invoke(handler, signedRequest({ webhookId: 'msg_concurrent' }));
    await providerStarted;
    const concurrent = await invoke(handler, signedRequest({ webhookId: 'msg_concurrent' }));
    assert.equal(concurrent.statusCode, 503, '处理中重复请求不得并发发送');
    assert.equal(sends, 1);
    releaseProvider();
    const first = await firstPromise;
    assert.equal(first.statusCode, 200);
  });
}

async function testReplayConflict() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness();
    await invoke(harness.handler, signedRequest({ webhookId: 'msg_same_id' }));
    const changed = JSON.stringify({ user: { phone: '+8613900139000' }, sms: { otp: '654321' } });
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_same_id', body: changed }));
    assert.equal(result.statusCode, 409);
    assert.equal(harness.sends.length, 1);
  });
}

async function testSignatureAndPayloadRejections() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness();
    const badSignature = await invoke(harness.handler, signedRequest({ signature: 'v1,invalid' }));
    assert.equal(badSignature.statusCode, 401);
    const expired = await invoke(harness.handler, signedRequest({ timestamp: new Date(Date.now() - 6 * 60 * 1000) }));
    assert.equal(expired.statusCode, 401);
    const badPhoneBody = JSON.stringify({ user: { phone: '+14155550100' }, sms: { otp: OTP } });
    const badPhone = await invoke(harness.handler, signedRequest({ body: badPhoneBody, webhookId: 'msg_bad_phone' }));
    assert.equal(badPhone.statusCode, 400);
    const barePhoneBody = JSON.stringify({ user: { phone: LOCAL_PHONE }, sms: { otp: OTP } });
    const barePhone = await invoke(harness.handler, signedRequest({ body: barePhoneBody, webhookId: 'msg_bare_phone' }));
    assert.equal(barePhone.statusCode, 400);
    const badOtpBody = JSON.stringify({ user: { phone: PHONE }, sms: { otp: '12345' } });
    const badOtp = await invoke(harness.handler, signedRequest({ body: badOtpBody, webhookId: 'msg_bad_otp' }));
    assert.equal(badOtp.statusCode, 400);
    assert.equal(harness.fetch.calls.length, 0, '验签或载荷失败不得访问 KV');
    assert.equal(harness.sends.length, 0, '验签或载荷失败不得调用阿里云');
  });
}

async function testMethodAndSizeRejections() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness();
    const wrongMethod = await invoke(harness.handler, signedRequest({ method: 'GET' }));
    assert.equal(wrongMethod.statusCode, 405);
    const tooLarge = signedRequest({ headers: { 'content-length': String(21 * 1024) } });
    const largeResult = await invoke(harness.handler, tooLarge);
    assert.equal(largeResult.statusCode, 413);
    const wrongType = signedRequest({ headers: { 'content-type': 'application/jsonx' } });
    const wrongTypeResult = await invoke(harness.handler, wrongType);
    assert.equal(wrongTypeResult.statusCode, 415);
    assert.equal(harness.sends.length, 0);
  });
}

async function testProviderFailureSemantics() {
  await withEnv(previewEnv(), async () => {
    const rejected = createHarness({ providerResults: [false, true] });
    const first = await invoke(rejected.handler, signedRequest({ webhookId: 'msg_rejected' }));
    const retry = await invoke(rejected.handler, signedRequest({ webhookId: 'msg_rejected' }));
    assert.equal(first.statusCode, 502);
    assert.equal(retry.statusCode, 200, '明确未受理时必须释放 claim 以允许安全重试');
    assert.equal(rejected.sends.length, 2);

    const uncertain = createHarness({ providerResults: [new Error('timeout'), true] });
    const timeout = await invoke(uncertain.handler, signedRequest({ webhookId: 'msg_timeout' }));
    const blockedRetry = await invoke(uncertain.handler, signedRequest({ webhookId: 'msg_timeout' }));
    assert.equal(timeout.statusCode, 503);
    assert.equal(blockedRetry.statusCode, 503, '结果不明时必须保留 claim，禁止盲目重发');
    assert.equal(uncertain.sends.length, 1);
  });
}

async function testPreviewAndConfigurationGates() {
  const cases = [
    previewEnv({ V3A_SUPABASE_PROJECT_REF: PRODUCTION_REF }),
    previewEnv({ V3A_SUPABASE_PROJECT_REF: 'other-project-ref' }),
    previewEnv({ VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production' }),
    previewEnv({ VERCEL_TARGET_ENV: 'production' }),
    previewEnv({ V3A_SEND_SMS_HOOK_ENABLED: 'false' })
  ];
  for (const env of cases) {
    await withEnv(env, async () => {
      const harness = createHarness();
      const result = await invoke(harness.handler, signedRequest());
      assert.equal(result.statusCode, 503);
      assert.equal(harness.fetch.calls.length, 0);
      assert.equal(harness.sends.length, 0);
    });
  }

  await withEnv(previewEnv(), async () => {
    const fetch = createKvFetch({ fail: true });
    const harness = createHarness({ fetch });
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_kv_down' }));
    assert.equal(result.statusCode, 503);
    assert.equal(harness.sends.length, 0, 'KV claim 失败时不得发送短信');
  });

  await withEnv(previewEnv(), async () => {
    const fetch = (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const harness = createHarness({ fetch });
    const startedAt = Date.now();
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_kv_hangs' }));
    assert.equal(result.statusCode, 503);
    assert(Date.now() - startedAt < 1500, 'KV 无响应时必须在 Supabase 5 秒窗口前中止');
    assert.equal(harness.sends.length, 0);
  });

  await withEnv(previewEnv(), async () => {
    const fetch = async () => ({
      ok: true,
      json() { return new Promise(() => {}); }
    });
    const harness = createHarness({ fetch });
    const startedAt = Date.now();
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_kv_body_hangs' }));
    assert.equal(result.statusCode, 503);
    assert(Date.now() - startedAt < 1500, 'KV 响应体无响应时也必须及时中止');
    assert.equal(harness.sends.length, 0);
  });

  await withEnv(previewEnv(), async () => {
    const baseFetch = createKvFetch();
    const fetch = (url, init) => {
      const command = JSON.parse(init.body);
      if (command[0] !== 'SETEX') return baseFetch(url, init);
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };
    const harness = createHarness({ fetch });
    const startedAt = Date.now();
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_mark_hangs' }));
    assert.equal(result.statusCode, 200, '阿里云已受理后 mark 超时仍须及时返回 200，避免重复发送');
    assert(Date.now() - startedAt < 1500);
    assert.equal(harness.sends.length, 1);
  });

  await withEnv(previewEnv(), async () => {
    const fetch = createKvFetch();
    let sends = 0;
    const handler = createHandler({
      fetch,
      sendSms() {
        sends += 1;
        return new Promise(() => {});
      },
      handlerDeadlineMs: 250,
      responseBufferMs: 50,
      minProviderBudgetMs: 50
    });
    const startedAt = Date.now();
    const result = await invoke(handler, signedRequest({ webhookId: 'msg_provider_hangs' }));
    assert.equal(result.statusCode, 503, 'Provider 无响应时必须保留 claim 并及时失败');
    assert(Date.now() - startedAt < 800);
    assert.equal(sends, 1);
  });
}

async function testAliyunAdapterContract() {
  const config = {
    accessKeyId: ACCESS_KEY_ID,
    accessKeySecret: ACCESS_KEY_SECRET,
    signName: '测试签名',
    templateCode: 'SMS_123456789',
    templateParamKey: 'code'
  };
  const originalLoad = require('module')._load;
  const calls = [];
  class Config {
    constructor(value) { this.value = value; }
  }
  class SendSmsRequest {
    constructor(value) { Object.assign(this, value); }
  }
  class Client {
    constructor(value) { calls.push({ type: 'client', value }); }
    async sendSms(value) {
      calls.push({ type: 'send', value });
      return { body: { code: 'OK' } };
    }
  }
  require('module')._load = function patched(request, parent, isMain) {
    if (request === '@alicloud/dysmsapi20170525') return { default: Client, SendSmsRequest };
    if (request === '@alicloud/openapi-core') return { $OpenApiUtil: { Config } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const accepted = await sendAliyunSms(config, { phone: '13800138000', otp: OTP }, 'abcdef0123456789');
    assert.equal(accepted, true);
  } finally {
    require('module')._load = originalLoad;
  }
  const clientConfig = calls.find((call) => call.type === 'client').value.value;
  const request = calls.find((call) => call.type === 'send').value;
  assert.equal(clientConfig.endpoint, 'dysmsapi.aliyuncs.com');
  assert.equal(clientConfig.connectTimeout, 800);
  assert.equal(clientConfig.readTimeout, 2000);
  assert.equal(request.phoneNumbers, '13800138000');
  assert.equal(request.signName, config.signName);
  assert.equal(request.templateCode, config.templateCode);
  assert.deepStrictEqual(JSON.parse(request.templateParam), { code: OTP });
}

async function testNoSensitiveOutputAndContracts() {
  await withEnv(previewEnv(), async () => {
    const harness = createHarness({ providerResults: [false] });
    const result = await invoke(harness.handler, signedRequest({ webhookId: 'msg_safe_error' }));
    assert.deepStrictEqual(result.payload, {
      error: { http_code: 502, message: '短信发送暂时不可用，请稍后重试。' }
    }, '错误响应必须符合 Supabase Auth Hook 合同');
    const publicText = JSON.stringify({ headers: result.headers, payload: result.payload });
    for (const secret of [PHONE, '13800138000', OTP, SECRET, ACCESS_KEY_ID, ACCESS_KEY_SECRET, KV_TOKEN]) {
      assert(!publicText.includes(secret), '响应不得泄露手机号、OTP 或任何凭据');
    }
  });

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'v3a-send-sms-hook.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'v3a-sms-hook.js'), 'utf8');
  assert(apiSource.includes('bodyParser: false'), 'Webhook 必须显式禁用请求体解析');
  assert(!serverSource.includes('console.'), 'Webhook 不得记录手机号、OTP 或供应商错误详情');
  assert(serverSource.includes("projectRef === PRODUCTION_PROJECT_REF || projectRef !== PREVIEW_PROJECT_REF"),
    'Webhook 必须硬锁 Preview 并拒绝 Production');
}

async function main() {
  await testValidAndDuplicate();
  await testSupabaseChinaPhoneFormats();
  await testConcurrentClaim();
  await testReplayConflict();
  await testSignatureAndPayloadRejections();
  await testMethodAndSizeRejections();
  await testProviderFailureSemantics();
  await testPreviewAndConfigurationGates();
  await testAliyunAdapterContract();
  await testNoSensitiveOutputAndContracts();
  console.log('PASS: Preview-only Supabase Send SMS Hook is verified with replay protection and zero real sends');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
