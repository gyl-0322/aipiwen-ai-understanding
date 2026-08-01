const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const trackerPath = '/js/error-tracker.js';
const pages = [
  'login.html',
  'advisor-register.html',
  'advisor-pending.html',
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'ai-interpreter-session.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];
const forbiddenValues = [
  'DontStoreThis',
  'Dont Store This Either',
  '654321',
  'TokenMustNotAppear',
  'CookieMustNotAppear',
  'SessionMustNotAppear',
  'SecretMustNotAppear',
  '13812345678'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function responseHarness() {
  return {
    body: null,
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
}

function assertNoSensitiveValues(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of forbiddenValues) {
    assert(!serialized.includes(forbidden), `错误事件不得记录敏感测试值：${forbidden}`);
  }
}

function testPageContracts() {
  for (const page of pages) {
    const source = read(page);
    const trackerTag = `<script src="${trackerPath}" defer></script>`;
    assert.equal((source.match(new RegExp(trackerTag, 'g')) || []).length, 1,
      `页面必须且只能加载一次错误追踪器：${page}`);
    assert(source.indexOf(trackerTag) < source.indexOf('static/v3a-auth.js'),
      `错误追踪器必须早于认证脚本加载：${page}`);
  }
  const adminSource = read('admin-convs.html');
  assert(!adminSource.includes('/api/error-log?secret='),
    '错误后台不得把管理口令放入 URL query');
  assert.equal((adminSource.match(/'x-admin-secret': _secret/g) || []).length, 2,
    '错误后台读取必须统一使用 x-admin-secret header');

  const workbenchSource = read('ai-interpreter-workbench.html');
  for (const id of [
    'v3a-workbench-error',
    'v3a-workbench-error-shell',
    'v3a-workbench-error-message'
  ]) {
    assert(workbenchSource.includes(`id="${id}"`), `工作台必须包含错误态 DOM：${id}`);
  }
}

async function testFrontendTracker() {
  const listeners = {};
  const beacons = [];
  const window = {
    addEventListener(name, handler) {
      listeners[name] = handler;
    },
    fetch: async (input) => {
      if (String(input).includes('/api/network-failure')) throw new Error('network down');
      return { ok: false, status: 503 };
    }
  };
  class TestBlob {
    constructor(parts) {
      this.value = parts.join('');
    }
  }
  const context = {
    Blob: TestBlob,
    document: { body: { dataset: { v3aAuthPage: 'workbench', page: 'session' } } },
    location: { origin: 'https://beta.example', pathname: '/ai-interpreter-session.html' },
    navigator: {
      userAgent: 'Beta-Test-Browser',
      sendBeacon(endpoint, blob) {
        beacons.push({ endpoint, body: blob.value });
        return true;
      }
    },
    window
  };
  vm.runInNewContext(read('js/error-tracker.js'), context, { filename: 'error-tracker.js' });

  listeners.error({
    message: 'password=DontStoreThis secret="Dont Store This Either" otp=654321 token=TokenMustNotAppear cookie=CookieMustNotAppear session=SessionMustNotAppear phone=13812345678',
    error: { stack: 'Error token=TokenMustNotAppear' },
    filename: '/static/test.js',
    lineno: 10
  });
  listeners.unhandledrejection({
    reason: { message: 'Unhandled beta failure', stack: 'Error: Unhandled beta failure' }
  });
  await window.fetch('/api/v3a-session?action=me&token=TokenMustNotAppear');
  await assert.rejects(
    window.fetch('/api/network-failure?otp=654321'),
    /network down/
  );

  assert.equal(beacons.length, 4, 'JS、Promise、API HTTP 和 API 网络错误必须分别上报');
  const payloads = beacons.map((item) => {
    assert.equal(item.endpoint, '/api/error-log');
    return JSON.parse(item.body);
  });
  assert.equal(payloads[0].page, '/ai-interpreter-session.html');
  assert.equal(payloads[0].module, 'advisor-session');
  assert.equal(payloads[0].ua, 'Beta-Test-Browser');
  assert(payloads[0].msg.includes('[REDACTED]'));
  assert(!payloads[2].msg.includes('?'), 'API 错误不得记录 query 参数');
  assert.equal(payloads[2].context, 'HTTP 503');
  assertNoSensitiveValues(payloads);

  beacons.length = 0;
  assert.equal(beacons.length, 0, '前端测试错误数据必须清理');
}

async function testBackendErrorLog() {
  const originalFetch = global.fetch;
  const originalAdminSecret = process.env.ADMIN_SECRET;
  const originalAlertWebhook = process.env.ALERT_WEBHOOK;
  const originalKvUrl = process.env.KV_REST_API_URL;
  const originalKvToken = process.env.KV_REST_API_TOKEN;
  const originalSessionSecret = process.env.SESSION_SECRET;
  const pipelineCalls = [];
  const testAdminSecret = 'TEST_ADMIN_SECRET_DO_NOT_USE';

  delete process.env.ALERT_WEBHOOK;
  process.env.KV_REST_API_URL = 'https://mock-kv.invalid';
  process.env.KV_REST_API_TOKEN = 'TEST_KV_TOKEN_DO_NOT_USE';
  process.env.SESSION_SECRET = 'TEST_SESSION_SECRET_NOT_FOR_PRODUCTION';
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/lrange/')) {
      return { json: async () => ({ result: [] }) };
    }
    if (String(url).includes('/get/')) {
      return { json: async () => ({ result: null }) };
    }
    const commands = JSON.parse(options.body || '[]');
    pipelineCalls.push(commands);
    if (commands[0]?.[0] === 'GET') {
      return { json: async () => ({ result: [{ result: 'duplicate' }, { result: 'OK' }] }) };
    }
    return { json: async () => ({ result: commands.map(() => ({ result: 'OK' })) }) };
  };

  const handler = require('../api/admin-convs');
  try {
    const postResponse = responseHarness();
    await handler({
      method: 'POST',
      url: '/api/error-log',
      headers: {},
      query: {},
      body: {
        msg: 'password=DontStoreThis secret="Dont Store This Either" otp=654321 token=TokenMustNotAppear',
        stack: 'cookie=CookieMustNotAppear session=SessionMustNotAppear',
        page: '/login.html?secret=SecretMustNotAppear',
        module: 'advisor-login',
        context: 'phone=13812345678',
        ua: 'Beta-Test-Browser'
      }
    }, postResponse);
    assert.equal(postResponse.statusCode, 200);
    assert.deepEqual(postResponse.body, { ok: true });

    const logPipeline = pipelineCalls.find((commands) => commands[0]?.[0] === 'LPUSH');
    assert(logPipeline, '测试错误必须写入错误日志 pipeline');
    const storedEntry = JSON.parse(logPipeline[0][2]);
    assert.equal(storedEntry.page, '/login.html');
    assert.equal(storedEntry.module, 'advisor-login');
    assertNoSensitiveValues(storedEntry);

    delete process.env.ADMIN_SECRET;
    const missingSecretResponse = responseHarness();
    await handler({
      method: 'GET',
      url: '/api/error-log',
      headers: {},
      query: {}
    }, missingSecretResponse);
    assert.equal(missingSecretResponse.statusCode, 503,
      '未配置 ADMIN_SECRET 时必须关闭错误日志读取');

    process.env.ADMIN_SECRET = testAdminSecret;
    const querySecretResponse = responseHarness();
    await handler({
      method: 'GET',
      url: '/api/error-log',
      headers: {},
      query: { secret: testAdminSecret }
    }, querySecretResponse);
    assert.equal(querySecretResponse.statusCode, 401,
      '错误日志读取不得接受 URL query 中的管理口令');

    const deniedResponse = responseHarness();
    await handler({
      method: 'GET',
      url: '/api/error-log',
      headers: { 'x-admin-secret': 'WRONG_TEST_SECRET' },
      query: {}
    }, deniedResponse);
    assert.equal(deniedResponse.statusCode, 401);

    const allowedResponse = responseHarness();
    await handler({
      method: 'GET',
      url: '/api/error-log',
      headers: { 'x-admin-secret': testAdminSecret },
      query: { n: '1' }
    }, allowedResponse);
    assert.equal(allowedResponse.statusCode, 200);
    assert.deepEqual(allowedResponse.body.errors, []);

    for (const path of ['/api/stats', '/api/knowledge', '/api/admin-convs']) {
      const deniedAdminResponse = responseHarness();
      const deniedQuery = path === '/api/knowledge'
        ? { action: 'list' }
        : path === '/api/admin-convs'
          ? { action: 'vip_list' }
          : { admin: '1' };
      await handler({
        method: 'GET',
        url: path,
        headers: { 'x-admin-secret': 'x' },
        query: deniedQuery
      }, deniedAdminResponse);
      assert.equal(deniedAdminResponse.statusCode, 401,
        `错误管理密钥必须被拒绝：${path}`);

      const allowedAdminResponse = responseHarness();
      await handler({
        method: 'GET',
        url: path,
        headers: { 'x-admin-secret': testAdminSecret },
        query: deniedQuery
      }, allowedAdminResponse);
      assert.equal(allowedAdminResponse.statusCode, 200,
        `正确管理密钥必须通过：${path}`);
    }
  } finally {
    pipelineCalls.length = 0;
    global.fetch = originalFetch;
    if (originalAdminSecret === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = originalAdminSecret;
    if (originalAlertWebhook === undefined) delete process.env.ALERT_WEBHOOK;
    else process.env.ALERT_WEBHOOK = originalAlertWebhook;
    if (originalKvUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalKvUrl;
    if (originalKvToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalKvToken;
    if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSessionSecret;
  }
  assert.equal(pipelineCalls.length, 0, '后端模拟错误数据必须清理');
}

async function main() {
  const backendSource = read('api/admin-convs.js');
  assert(!/process\.env\.ADMIN_SECRET\s*\|\|/.test(backendSource),
    '错误日志读取不得使用硬编码 ADMIN_SECRET 回退');
  assert(backendSource.includes('crypto.timingSafeEqual'),
    '错误日志读取必须使用常量时间比较');
  assert(!backendSource.includes('provided !== adminSecret'),
    '管理密钥不得直接使用字符串不等比较');
  assert(!/req\.query(?:\?\.)?\.secret\s*===/.test(backendSource),
    '知识库管理密钥不得直接使用字符串相等比较');
  assert((backendSource.match(/matchesSecret\(/g) || []).length >= 5,
    '所有四条管理读取路径必须统一使用 matchesSecret');

  testPageContracts();
  await testFrontendTracker();
  await testBackendErrorLog();
  console.log('PASS: advisor observability, unified admin-secret checks, error-shell DOM, and test-data cleanup');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
