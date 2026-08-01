#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'api', 'v3a-admin.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const adminPage = fs.readFileSync(path.join(__dirname, '..', 'admin-applications.html'), 'utf8');
const adminClient = fs.readFileSync(path.join(__dirname, '..', 'static', 'v3a-admin.js'), 'utf8');

const ADMIN_PROJECT_REF = 'admin-test-project';
const ALTERNATE_PROJECT_REF = 'admin-alternate-project';
const ADMIN_SUPABASE_URL = `https://${ADMIN_PROJECT_REF}.supabase.co`;
const ALTERNATE_SUPABASE_URL = `https://${ALTERNATE_PROJECT_REF}.supabase.co`;
const ALLOWED_ORIGIN = 'https://preview.aipiwen.cn';
const DEPLOYMENT_HOST = 'aipiwen-ai-understanding-a5lprbyl2-guo-yanling-s-projects.vercel.app';
const DEPLOYMENT_ORIGIN = `https://${DEPLOYMENT_HOST}`;
const KV_URL = 'https://v3a-session-kv.example';
const KV_TOKEN = 'TEST_V3A_KV_TOKEN_NOT_REAL';
const ENCRYPTION_KEY_BYTES = Buffer.alloc(32, 0x42);
const ENCRYPTION_KEY = ENCRYPTION_KEY_BYTES.toString('base64');
const SERVICE_KEY = 'TEST_V3A_SERVICE_ROLE_KEY_NOT_REAL';
const ANON_KEY = 'TEST_V3A_ANON_KEY_NOT_REAL';
const SESSION_COOKIE = '__Host-aipiwen_v3a_session';
const SESSION_ID = Buffer.alloc(32, 0x31).toString('base64url');
const CSRF_TOKEN = Buffer.alloc(32, 0x32).toString('base64url');
const OLD_ACCESS_TOKEN = 'TEST_OLD_ADMIN_ACCESS_TOKEN_NOT_REAL';
const REFRESH_TOKEN = 'TEST_ADMIN_REFRESH_TOKEN_NOT_REAL';
const ROTATED_REFRESH_TOKEN = 'TEST_ROTATED_REFRESH_TOKEN_NOT_REAL';
const ACCESS_TOKEN = 'TEST_ADMIN_ACCESS_TOKEN_NOT_REAL';
const REQUIRED_ADMIN_ENV = new Set([
  'V3A_SUPABASE_URL',
  'V3A_SUPABASE_ANON_KEY',
  'V3A_SUPABASE_SERVICE_ROLE_KEY',
  'V3A_SUPABASE_PROJECT_REF',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'V3A_SESSION_ENCRYPTION_KEY'
]);
const ALLOWED_ENV = new Set([
  ...REQUIRED_ADMIN_ENV,
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'V3A_ALLOWED_ORIGIN',
  'V3A_ALLOWED_ORIGINS',
  'VERCEL_URL',
  'V3A_ADMIN_REVIEW_WRITES_ENABLED',
  'V3A_PHONE_OTP_ENABLED'
]);

function adminEnv(reviewWritesEnabled = 'false', overrides = {}) {
  return {
    V3A_SUPABASE_URL: ADMIN_SUPABASE_URL,
    V3A_SUPABASE_ANON_KEY: ANON_KEY,
    V3A_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    V3A_SUPABASE_PROJECT_REF: ADMIN_PROJECT_REF,
    V3A_ADMIN_REVIEW_WRITES_ENABLED: reviewWritesEnabled,
    V3A_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
    VERCEL_URL: DEPLOYMENT_HOST,
    KV_REST_API_URL: KV_URL,
    KV_REST_API_TOKEN: KV_TOKEN,
    V3A_SESSION_ENCRYPTION_KEY: ENCRYPTION_KEY,
    V3A_PHONE_OTP_ENABLED: 'false',
    ...overrides
  };
}

const ADMIN_AUTH_ID = '40000000-0000-4000-8000-000000000001';
const ADMIN_USER_ID = '10000000-0000-4000-8000-000000000001';
const APPLICATION_ID = '20000000-0000-4000-8000-000000000001';
const APPROVED_APPLICATION_ID = '20000000-0000-4000-8000-000000000002';
const REJECTED_APPLICATION_ID = '20000000-0000-4000-8000-000000000003';
const APPLICANT_USER_ID = '30000000-0000-4000-8000-000000000001';
const APPROVED_USER_ID = '30000000-0000-4000-8000-000000000002';
const APPLICANT_AUTH_ID = '50000000-0000-4000-8000-000000000001';
const WALLET_ID = '60000000-0000-4000-8000-000000000001';
const CREDIT_LOG_ID = '70000000-0000-4000-8000-000000000001';
const AUDIT_LOG_ID = '80000000-0000-4000-8000-000000000001';
const RAW_PHONE = '+8613800000000';
const MASKED_PHONE = '+86 138****0000';

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; }
  };
}

function adminRecord(overrides = {}) {
  return {
    id: ADMIN_USER_ID,
    auth_user_id: ADMIN_AUTH_ID,
    role: 'super_admin',
    status: 'active',
    display_name: '总部管理员',
    ...overrides
  };
}

const pendingReview = {
  id: APPLICATION_ID,
  user_id: APPLICANT_USER_ID,
  role: 'advisor',
  status: 'pending',
  applied_city: '上海',
  applied_name: '测试申请人',
  applied_nickname: '测试申请人',
  practitioner_type: 'independent',
  organization_name: null,
  invite_code: null,
  application_note: '测试申请说明',
  created_at: '2026-07-15T00:00:00.000Z'
};

const approvedReview = {
  ...pendingReview,
  id: APPROVED_APPLICATION_ID,
  user_id: APPROVED_USER_ID,
  status: 'approved'
};

const rejectedReview = {
  ...pendingReview,
  id: REJECTED_APPLICATION_ID,
  status: 'rejected'
};

const applicant = {
  id: APPLICANT_USER_ID,
  auth_user_id: APPLICANT_AUTH_ID,
  phone: RAW_PHONE,
  display_name: '测试申请人',
  city: '上海',
  status: 'pending'
};

const profile = {
  user_id: APPLICANT_USER_ID,
  role: 'advisor',
  status: 'pending',
  nickname: '测试申请人',
  city: '上海',
  organization_name: null,
  practitioner_type: 'independent',
  agreement_version: 'V3a-2026-07',
  agreed_rules_at: '2026-07-15T00:00:00.000Z'
};

function sessionKey() {
  return `v3a:session:${crypto.createHash('sha256').update(SESSION_ID).digest('hex')}`;
}

function sessionRecord(overrides = {}) {
  const now = Date.now();
  return {
    v: 1,
    authUserId: ADMIN_AUTH_ID,
    accessToken: OLD_ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
    accessExpiresAt: now - 60_000,
    csrfToken: CSRF_TOKEN,
    createdAt: now - 60 * 60 * 1000,
    absoluteExpiresAt: now + 6 * 24 * 60 * 60 * 1000,
    ...overrides
  };
}

function encryptSessionRecord(record) {
  const iv = Buffer.alloc(12, 0x24);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY_BYTES, iv);
  cipher.setAAD(Buffer.from(sessionKey(), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), 'utf8'),
    cipher.final()
  ]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decryptSessionRecord(envelope) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY_BYTES,
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(sessionKey(), 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function createFetch(options = {}) {
  const calls = [];
  const encryptedSession = options.kvEnvelope || encryptSessionRecord(options.sessionRecord || sessionRecord());
  const fetchStub = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: url.toString(), method, init });

    if (url.origin === KV_URL) {
      if (options.kvFailure) return response(500, { error: 'kv unavailable' });
      if (method === 'POST' && url.pathname === '/') {
        const command = JSON.parse(init.body);
        const name = String(command?.[0] || '').toUpperCase();
        if (name === 'GET') {
          return response(200, {
            result: !options.kvMissing && command[1] === sessionKey()
              ? JSON.stringify(encryptedSession)
              : null
          });
        }
        if (['SET', 'DEL'].includes(name)) return response(200, { result: 'OK' });
        if (name === 'EVAL') return response(200, { result: 1 });
      }
      throw new Error(`Unexpected KV fetch path: ${method} ${url.pathname}`);
    }

    if (url.pathname === '/auth/v1/admin/users' || /\/auth\/v1\/admin\/users\/?$/.test(url.pathname)) {
      throw new Error('Auth user creation path must not exist');
    }
    if (url.pathname === '/auth/v1/token') {
      if (options.refreshFailure) return response(401, options.refreshFailure);
      return response(200, {
        access_token: ACCESS_TOKEN,
        refresh_token: ROTATED_REFRESH_TOKEN,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: {
          id: ADMIN_AUTH_ID,
          phone: '+8613900139000',
          phone_confirmed_at: '2026-07-15T00:00:00.000Z'
        }
      });
    }
    if (url.pathname === '/auth/v1/user') {
      if (options.authFailure) return response(500, options.authFailure);
      return response(200, {
        id: ADMIN_AUTH_ID,
        phone: '+8613900139000',
        phone_confirmed_at: '2026-07-15T00:00:00.000Z'
      });
    }
    if (url.pathname === '/rest/v1/users') {
      if (url.searchParams.has('auth_user_id')) {
        return response(200, [options.admin || adminRecord()]);
      }
      return response(200, [applicant]);
    }
    if (url.pathname === '/rest/v1/application_reviews') {
      if (options.dataFailure) return response(500, options.dataFailure);
      const pendingOnly = url.searchParams.get('status') === 'eq.pending';
      const requestedId = url.searchParams.get('id');
      if (requestedId === `eq.${APPROVED_APPLICATION_ID}`) {
        return response(200, pendingOnly ? [] : [approvedReview]);
      }
      if (requestedId === `eq.${REJECTED_APPLICATION_ID}`) {
        return response(200, pendingOnly ? [] : [rejectedReview]);
      }
      if (requestedId === `eq.${APPLICATION_ID}`) return response(200, [pendingReview]);
      return response(200, pendingOnly ? [pendingReview] : [pendingReview, approvedReview]);
    }
    if (url.pathname === '/rest/v1/advisor_profiles') return response(200, [profile]);
    if (url.pathname === '/rest/v1/invite_codes') return response(200, []);
    if (url.pathname === '/rest/v1/rpc/v3a_approve_application') {
      if (options.rpcFailure) return response(500, options.rpcFailure);
      const body = JSON.parse(init.body);
      const alreadyProcessed = body.p_application_id === APPROVED_APPLICATION_ID;
      return response(200, {
        success: true,
        already_processed: alreadyProcessed,
        data: {
          application_id: body.p_application_id,
          user_id: alreadyProcessed ? APPROVED_USER_ID : APPLICANT_USER_ID,
          user_status: 'active',
          wallet: { id: WALLET_ID, balance: 500 },
          credit_log: { id: CREDIT_LOG_ID, type: 'REGISTER_BONUS', amount: 500 },
          invite_code: body.p_invite_code,
          audit_log_id: AUDIT_LOG_ID
        }
      });
    }
    if (url.pathname === '/rest/v1/rpc/v3a_reject_application') {
      if (options.rpcFailure) return response(500, options.rpcFailure);
      return response(200, {
        success: true,
        already_processed: false,
        data: {
          application_id: APPLICATION_ID,
          user_id: APPLICANT_USER_ID,
          user_status: 'rejected',
          review_id: APPLICATION_ID,
          audit_log_id: AUDIT_LOG_ID
        }
      });
    }
    throw new Error(`Unexpected fetch path: ${url.pathname}`);
  };
  fetchStub.calls = calls;
  return fetchStub;
}

function loadHandler({ env = {}, fetchStub }) {
  const envReads = new Set();
  const envProxy = new Proxy({ ...env }, {
    get(target, property) {
      if (typeof property !== 'string') return target[property];
      assert(ALLOWED_ENV.has(property), `后台接口不得读取环境变量 ${property}`);
      envReads.add(property);
      return target[property];
    }
  });
  const context = vm.createContext({
    process: { env: envProxy },
    fetch: fetchStub,
    URL,
    URLSearchParams,
    Buffer,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    console: { log() {}, error() {} }
  });
  const cache = new Map();

  function resolveLocal(specifier, parentFilename) {
    const base = path.resolve(path.dirname(parentFilename), specifier);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`Cannot resolve local module ${specifier} from ${parentFilename}`);
  }

  function loadModule(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const moduleSource = filename === sourcePath ? source : fs.readFileSync(filename, 'utf8');
    const wrapper = vm.runInContext(
      `(function (require, module, exports, __dirname, __filename) {\n${moduleSource}\n})`,
      context,
      { filename }
    );
    const localRequire = (specifier) => {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        return loadModule(resolveLocal(specifier, filename));
      }
      return require(specifier);
    };
    wrapper(localRequire, loadedModule, loadedModule.exports, path.dirname(filename), filename);
    return loadedModule.exports;
  }

  const handler = loadModule(sourcePath);
  assert.equal(typeof handler, 'function', 'api/v3a-admin.js 必须导出请求处理函数');
  return { handler, envReads };
}

function createRequest(method, action, body, headers = {}) {
  return {
    method,
    headers,
    query: action ? { action } : {},
    body
  };
}

function defaultRequestHeaders(method) {
  const headers = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION_ID)}` };
  if (method === 'POST') {
    headers.origin = ALLOWED_ORIGIN;
    headers['x-csrf-token'] = CSRF_TOKEN;
    headers['content-type'] = 'application/json';
  }
  return headers;
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function invoke(options = {}) {
  const fetchStub = options.fetchStub || createFetch(options.fetchOptions);
  const loaded = loadHandler({
    env: options.env || adminEnv(),
    fetchStub
  });
  const method = options.method || 'GET';
  const req = createRequest(
    method,
    options.action,
    options.body,
    options.headers === undefined ? defaultRequestHeaders(method) : options.headers
  );
  if (options.query) Object.assign(req.query, options.query);
  const res = createResponse();
  await loaded.handler(req, res);
  assert.equal(res.headers['cache-control'], 'private, no-store',
    '总部身份与审核响应必须禁止共享缓存');
  return { res, fetchStub, envReads: loaded.envReads };
}

function assertNoSensitivePayload(payload) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(RAW_PHONE), false, '响应不得返回原始手机号');
  assert.equal(serialized.includes('13800000000'), false, '响应不得返回未脱敏手机号');
  assert.equal(serialized.includes(APPLICANT_AUTH_ID), false, '响应不得返回 auth_user_id');
  assert.equal(serialized.includes(SERVICE_KEY), false, '响应不得返回 service role key');
  assert.equal(serialized.includes(ANON_KEY), false, '响应不得返回 anon key');
  assert.equal(serialized.includes(KV_TOKEN), false, '响应不得返回 KV token');
  assert.equal(serialized.includes(ENCRYPTION_KEY), false, '响应不得返回 session encryption key');
  assert.equal(serialized.includes(SESSION_ID), false, '响应不得返回 opaque session id');
  assert.equal(serialized.includes(OLD_ACCESS_TOKEN), false, '响应不得返回旧 access token');
  assert.equal(serialized.includes(ACCESS_TOKEN), false, '响应不得返回 access token');
  assert.equal(serialized.includes(REFRESH_TOKEN), false, '响应不得返回 refresh token');
  assert.equal(serialized.includes(ROTATED_REFRESH_TOKEN), false, '响应正文不得返回轮换后的 refresh token');
  assert.equal(serialized.includes('auth_user_id'), false, '响应不得返回 auth_user_id 字段');
}

function assertPendingQuery(calls) {
  const call = calls.find(({ url }) => new URL(url).pathname === '/rest/v1/application_reviews');
  assert(call, '列表必须读取 application_reviews');
  assert.equal(new URL(call.url).searchParams.get('status'), 'eq.pending', '申请查询必须在上游限定 status=eq.pending');
}

function reviewMutationCalls(calls) {
  return calls.filter(({ url, method }) =>
    method === 'POST' && new URL(url).pathname.startsWith('/rest/v1/rpc/'));
}

function headerValue(headers, name) {
  if (headers && typeof headers.get === 'function') return headers.get(name);
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function assertClearedSessionCookie(res) {
  const raw = res.headers['set-cookie'];
  const serialized = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).join('\n');
  assert.equal(serialized.includes(`${SESSION_COOKIE}=`), true,
    '失效 Session 必须清除 opaque SID cookie');
  assert.match(serialized, /(?:^|;)\s*Max-Age=0(?:;|$)/i);
  assert.match(serialized, /(?:^|;)\s*HttpOnly(?:;|$)/i);
  assert.match(serialized, /(?:^|;)\s*Secure(?:;|$)/i);
  assert.match(serialized, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
  assert.match(serialized, /(?:^|;)\s*Path=\/(?:;|$)/i);
  assert.equal(/(?:^|;)\s*Domain=/i.test(serialized), false, '__Host SID cookie 不得设置 Domain');
  for (const token of [OLD_ACCESS_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN]) {
    assert.equal(serialized.includes(token), false, '清理 Cookie 响应不得包含 Supabase token');
  }
}

function kvCommand(call) {
  if (!call || new URL(call.url).origin !== KV_URL || !call.init.body) return [];
  const parsed = JSON.parse(call.init.body);
  return Array.isArray(parsed) ? parsed : [];
}

function assertEncryptedServerSessionFlow(calls, res) {
  assert.match(SESSION_ID, /^[A-Za-z0-9_-]{43}$/, 'opaque SID 必须是 32-byte base64url 随机值');
  const kvCalls = calls.filter(({ url }) => new URL(url).origin === KV_URL);
  const kvRead = kvCalls.find((call) => String(kvCommand(call)[0]).toUpperCase() === 'GET');
  assert(kvRead, '管理端必须先从服务端 KV 读取 opaque SID 对应的加密 Session');
  assert.equal(kvRead.method, 'POST', 'Upstash KV 读取必须使用根 URL POST command');
  assert.equal(new URL(kvRead.url).pathname, '/', 'Upstash KV 读取不得拼接 key 到 URL');
  assert.equal(headerValue(kvRead.init.headers, 'authorization'), `Bearer ${KV_TOKEN}`,
    'KV 读取必须使用服务端 KV token');
  const readKey = kvCommand(kvRead)[1];
  assert.equal(readKey, sessionKey(), 'KV key 必须只使用 opaque SID 的 SHA-256 哈希');
  assert.equal(`${kvRead.url}\n${kvRead.init.body || ''}`.includes(SESSION_ID), false,
    '原始 opaque SID 不得发送给 KV');

  const refreshCalls = calls.filter(({ url }) => new URL(url).pathname === '/auth/v1/token');
  assert.equal(refreshCalls.length, 1, '过期 access token 每次管理端请求只能刷新一次');
  const refresh = refreshCalls[0];
  const refreshUrl = new URL(refresh.url);
  assert.equal(refresh.method, 'POST', 'Session 刷新必须使用 POST');
  assert.equal(refreshUrl.searchParams.get('grant_type'), 'refresh_token',
    'Session 刷新必须使用 refresh_token grant');
  assert.equal(headerValue(refresh.init.headers, 'apikey'), ANON_KEY,
    'Session 刷新只能使用当前环境 anon key');
  assert.match(String(headerValue(refresh.init.headers, 'content-type') || ''), /^application\/json\b/i,
    'Session 刷新必须发送 JSON');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(JSON.parse(refresh.init.body))), {
    refresh_token: REFRESH_TOKEN
  });
  assert.equal(JSON.stringify(refresh.init.headers || {}).includes(SERVICE_KEY), false,
    'Session 刷新不得使用 service role key');

  const kvWrite = kvCalls.find((call) =>
    String(kvCommand(call)[0]).toUpperCase() === 'SET' && kvCommand(call)[1] === sessionKey());
  assert(kvWrite, '刷新后的 Supabase token 必须只回写服务端 KV');
  assert.equal(kvWrite.method, 'POST', 'Upstash KV 写入必须使用根 URL POST command');
  assert.equal(new URL(kvWrite.url).pathname, '/', 'Upstash KV 写入不得拼接 key 到 URL');
  assert.equal(headerValue(kvWrite.init.headers, 'authorization'), `Bearer ${KV_TOKEN}`,
    'KV 写入必须使用服务端 KV token');
  const setCommand = kvCommand(kvWrite);
  assert.equal(setCommand[1], sessionKey(), 'Session 刷新必须更新同一哈希 KV key');
  const serializedEnvelope = typeof setCommand[2] === 'string' ? setCommand[2] : JSON.stringify(setCommand[2]);
  for (const secret of [
    SESSION_ID, OLD_ACCESS_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN,
    CSRF_TOKEN, ADMIN_AUTH_ID, RAW_PHONE
  ]) {
    assert.equal(serializedEnvelope.includes(secret), false, 'KV 写入不得包含任何明文 Session 数据');
  }
  const envelope = JSON.parse(serializedEnvelope);
  assert.equal(envelope.v, 1, '加密 Session envelope 版本必须是 1');
  ['iv', 'ciphertext', 'tag'].forEach((field) =>
    assert.equal(typeof envelope[field], 'string', `加密 Session envelope 缺少 ${field}`));
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12, 'AES-256-GCM IV 必须是 12 bytes');
  assert.notEqual(envelope.iv, Buffer.alloc(12, 0x24).toString('base64'),
    '每次 KV Session 加密必须使用新的随机 IV');
  const rotatedRecord = decryptSessionRecord(envelope);
  assert.equal(rotatedRecord.authUserId, ADMIN_AUTH_ID);
  assert.equal(rotatedRecord.accessToken, ACCESS_TOKEN, '刷新后的 access token 只能保存在加密 Session 中');
  assert.equal(rotatedRecord.refreshToken, ROTATED_REFRESH_TOKEN,
    '轮换后的 refresh token 只能保存在加密 Session 中');
  assert.equal(rotatedRecord.csrfToken, CSRF_TOKEN, 'Session 刷新必须保留当前 CSRF token');
  for (const field of ['accessExpiresAt', 'createdAt', 'absoluteExpiresAt']) {
    assert.equal(Number.isFinite(Number(rotatedRecord[field])), true, `Session record 缺少 ${field}`);
  }
  assert.equal(rotatedRecord.absoluteExpiresAt <= Date.now() + 604800 * 1000, true,
    'Session absolute expiry 不得超过 7 天');
  assert.equal(Object.keys(rotatedRecord).some((key) => /phone|otp/i.test(key)), false,
    '服务端 Session record 不得保存手机号或 OTP');
  const exIndex = setCommand.findIndex((value) => String(value).toUpperCase() === 'EX');
  const ttl = exIndex >= 0 ? Number(setCommand[exIndex + 1]) : NaN;
  assert.equal(Number.isFinite(ttl) && ttl > 0 && ttl <= 604800, true,
    'KV Session TTL 必须受 7 天 absolute expiry 限制');

  const userCalls = calls.filter(({ url }) => new URL(url).pathname === '/auth/v1/user');
  assert.equal(userCalls.length, 1, '刷新后必须向当前环境 Auth 校验 access token');
  assert.equal(userCalls[0].method, 'GET');
  assert.equal(headerValue(userCalls[0].init.headers, 'apikey'), ANON_KEY,
    'Auth 用户校验只能使用当前环境 anon key');
  assert.equal(headerValue(userCalls[0].init.headers, 'authorization'), `Bearer ${ACCESS_TOKEN}`,
    'Auth 用户校验必须使用刚刷新得到的 access token');
  assert.equal(calls.indexOf(kvRead) < calls.indexOf(refresh), true,
    '必须先从 KV 取出 Session，再刷新当前环境 Auth');
  assert.equal(calls.indexOf(refresh) < calls.indexOf(userCalls[0]), true,
    '必须先刷新 Session，再校验 Auth 用户');
  assert.equal(calls.indexOf(userCalls[0]) < calls.indexOf(kvWrite), true,
    '必须在当前环境 Auth 用户校验成功后才更新加密 KV Session');
  const supabaseCalls = calls.filter(({ url }) => new URL(url).origin !== KV_URL);
  assert.equal(supabaseCalls.every(({ url }) => new URL(url).origin === ADMIN_SUPABASE_URL), true,
    '除专用 KV 外，管理端所有上游请求必须停留在环境声明的 Supabase');
  assert.equal(res.headers['set-cookie'], undefined,
    '普通管理请求只能更新服务端 KV，不得重发 SID 或把 Supabase token 写入 Cookie');
  assert.equal(JSON.stringify(res.headers).includes(ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(res.headers).includes(ROTATED_REFRESH_TOKEN), false);
}

function createAdminClientHarness() {
  const fetchCalls = [];
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        hidden: true,
        disabled: false,
        textContent: '',
        value: '',
        dataset: {},
        className: '',
        listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        replaceChildren() {},
        append() {},
        appendChild() {}
      });
    }
    return nodes.get(selector);
  }
  const document = {
    body: { dataset: { v3aAdminPage: 'applications' } },
    querySelector(selector) { return node(selector); },
    querySelectorAll() { return []; },
    createElement(tag) { return node(`<${tag}:${nodes.size}>`); }
  };
  const window = {
    confirm() { return true; },
    location: { href: '' }
  };
  const fetchStub = async (input, init = {}) => {
    fetchCalls.push({ input: String(input), init });
    const url = new URL(String(input), ALLOWED_ORIGIN);
    const action = url.searchParams.get('action');
    if (action === 'list_applications') {
      return response(200, {
        ok: true,
        csrfToken: CSRF_TOKEN,
        admin: { id: ADMIN_USER_ID, displayName: '总部管理员' },
        applications: [{
          applicationId: APPLICATION_ID,
          nickname: '测试申请人',
          phoneMasked: MASKED_PHONE,
          city: '上海',
          role: 'advisor',
          appliedAt: pendingReview.created_at,
          status: 'pending'
        }]
      });
    }
    if (action === 'get_application') {
      return response(200, {
        ok: true,
        csrfToken: CSRF_TOKEN,
        application: {
          summary: {
            applicationId: APPLICATION_ID,
            nickname: '测试申请人',
            phoneMasked: MASKED_PHONE,
            city: '上海',
            role: 'advisor',
            practitionerType: 'independent',
            appliedAt: pendingReview.created_at,
            status: 'pending'
          },
          currentStatus: { application: 'pending' }
        }
      });
    }
    return response(200, {
      ok: true,
      csrfToken: CSRF_TOKEN
    });
  };
  const context = vm.createContext({
    window,
    document,
    fetch: fetchStub,
    URL,
    URLSearchParams,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    console: { log() {}, error() {} }
  });
  vm.runInContext(adminClient, context, { filename: 'static/v3a-admin.js' });
  return { fetchCalls, nodes };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  [
    'v3a-admin-gate', 'v3a-admin-workspace', 'v3a-admin-list', 'v3a-admin-detail-list',
    'v3a-admin-result',
    'v3a-admin-approve', 'v3a-admin-reject', 'v3a-admin-reject-reason'
  ].forEach((id) => assert.equal(adminPage.includes(`id="${id}"`), true, `平台准入审核页缺少 ${id}`));
  assert.equal(adminPage.includes('AIPIWEN 指导师准入审核中心'), true,
    '平台准入审核后台必须使用正式主标题');
  assert.equal(adminPage.includes('href="login.html"'), true, '平台准入审核页必须返回统一 login.html');
  assert.equal(adminPage.includes('advisor-login'), false, '平台准入审核页不得使用旧独立登录页');
  assert.equal(adminPage.includes('cdn.jsdelivr.net') || adminPage.includes('esm.sh'), false,
    '中国用户后台不得依赖境外 CDN');
  assert.equal(adminPage.includes('解读师'), false, '平台准入审核页必须统一使用“指导师”');
  const forbiddenReviewCopy = new RegExp([
    'Em' + 'ma审核',
    'Em' + 'ma后台',
    'Em' + 'ma管理员',
    '总部' + '审核',
    '总部' + '账号'
  ].join('|'));
  assert.equal(forbiddenReviewCopy.test(adminPage), false,
    '平台准入审核页不得出现旧审核称呼');
  assert.equal(adminClient.includes('phoneMasked'), true, '浏览器后台只能消费脱敏手机号');
  assert.equal(/localStorage|sessionStorage/.test(adminClient), false,
    '平台准入审核脚本不得自行保存身份或申请数据');
  assert.equal(/document\.cookie/.test(adminClient), false,
    'HttpOnly opaque session cookie 不得被浏览器脚本读取');
  assert.equal(/\bgetSession\b|\baccessToken\b|access_token|\bAuthorization\b|\bBearer\b/.test(adminClient), false,
    '平台准入审核脚本不得读取或发送 Supabase token');
  assert.equal(/AIPIWEN_V3A_SUPABASE|window\.supabase|\bcreateClient\b/.test(adminClient), false,
    '平台准入审核脚本不得依赖 Supabase SDK 或浏览器端 Supabase 配置');
  assert.equal(source.includes('readBearerToken'), false,
    '后台接口不得再接受浏览器 Bearer token');
  assert.equal(/auth\/v1\/admin\/users|admin\.createUser|auth\.admin\.createUser|\.signUp\s*\(/.test(source), false,
    '后台审核接口不得包含创建 Supabase Auth 用户的路径');

  const browser = createAdminClientHarness();
  await flushAsyncWork();
  const browserRequest = browser.fetchCalls.find(({ input }) =>
    input.startsWith('/api/v3a-admin?') && input.includes('action=list_applications'));
  assert(browserRequest, '平台准入审核页初始化必须通过同源 API 读取申请列表');
  assert.equal(browserRequest.init.credentials, 'same-origin',
    '浏览器管理端请求必须显式使用 credentials: same-origin');
  assert.equal(headerValue(browserRequest.init.headers, 'authorization'), undefined,
    '浏览器管理端请求不得发送 Authorization header');
  assert.equal(headerValue(browserRequest.init.headers, 'cookie'), undefined,
    '浏览器脚本不得手工读取或拼接 HttpOnly cookie');

  const viewButton = [...browser.nodes.values()]
    .find((node) => node.textContent === '查看' && typeof node.listeners.click === 'function');
  assert(viewButton, '浏览器测试必须能打开一条 pending 申请');
  await viewButton.listeners.click();
  await flushAsyncWork();
  const approveButton = browser.nodes.get('#v3a-admin-approve');
  assert.equal(typeof approveButton?.listeners.click, 'function', '审核通过按钮必须绑定处理函数');
  await approveButton.listeners.click();
  await flushAsyncWork();
  const browserPost = browser.fetchCalls.find(({ input, init }) =>
    String(init.method || 'GET').toUpperCase() === 'POST' &&
    new URL(input, ALLOWED_ORIGIN).searchParams.get('action') === 'approve_application');
  assert(browserPost, '浏览器审核写请求必须通过同源管理 API');
  assert.equal(browserPost.init.credentials, 'same-origin',
    '浏览器审核写请求必须显式使用 credentials: same-origin');
  assert.equal(headerValue(browserPost.init.headers, 'x-csrf-token'), CSRF_TOKEN,
    '浏览器审核写请求必须携带 GET 返回的 X-CSRF-Token');
  assert.equal(headerValue(browserPost.init.headers, 'authorization'), undefined,
    '浏览器审核写请求不得发送 Authorization header');
  assert.equal(headerValue(browserPost.init.headers, 'cookie'), undefined,
    '浏览器审核写请求不得手工拼接 HttpOnly cookie');

  let alternateAdminResult = await invoke({
    action: 'list_applications',
    env: adminEnv('false', {
      V3A_SUPABASE_URL: ALTERNATE_SUPABASE_URL,
      V3A_SUPABASE_PROJECT_REF: ALTERNATE_PROJECT_REF
    })
  });
  assert.equal(alternateAdminResult.res.statusCode, 200,
    '任意环境的 Supabase URL 与 Project Ref 一致时管理读取必须通过');

  for (const env of [
    adminEnv('false', { V3A_SUPABASE_URL: ALTERNATE_SUPABASE_URL }),
    adminEnv('false', { V3A_SUPABASE_PROJECT_REF: ALTERNATE_PROJECT_REF }),
    {
      ...adminEnv(),
      VERCEL_URL: 'preview.aipiwen.cn'
    },
    {
      ...adminEnv(),
      VERCEL_URL: `${DEPLOYMENT_HOST}/path`
    }
  ]) {
    const fetchStub = createFetch();
    const { res } = await invoke({ action: 'list_applications', env, fetchStub });
    assert.equal(res.statusCode, 503, 'URL/ref 不一致或部署 URL 无效时必须返回 503');
    assert.equal(fetchStub.calls.length, 0, '项目门禁失败时绝不能发起 fetch');
  }

  const missingPrivateUrlEnv = adminEnv();
  missingPrivateUrlEnv.NEXT_PUBLIC_SUPABASE_URL = missingPrivateUrlEnv.V3A_SUPABASE_URL;
  delete missingPrivateUrlEnv.V3A_SUPABASE_URL;
  let missingPrivateUrlResult = await invoke({ action: 'list_applications', env: missingPrivateUrlEnv });
  assert.equal(missingPrivateUrlResult.res.statusCode, 503,
    '管理端必须显式配置 V3A_SUPABASE_URL');

  for (const invalidSupabaseUrl of [
    `https://user:pass@${ADMIN_PROJECT_REF}.supabase.co`,
    `${ADMIN_SUPABASE_URL}/rest`,
    `${ADMIN_SUPABASE_URL}?target=other`,
    `${ADMIN_SUPABASE_URL}#fragment`
  ]) {
    const fetchStub = createFetch();
    const { res } = await invoke({
      action: 'list_applications',
      env: { ...adminEnv(), V3A_SUPABASE_URL: invalidSupabaseUrl },
      fetchStub
    });
    assert.equal(res.statusCode, 503, 'Supabase URL 必须精确匹配环境声明的 canonical origin');
    assert.equal(fetchStub.calls.length, 0, 'Supabase URL 非 canonical 时不得发起 fetch');
  }

  for (const missingName of REQUIRED_ADMIN_ENV) {
    const env = adminEnv();
    delete env[missingName];
    const fetchStub = createFetch();
    const { res } = await invoke({ action: 'list_applications', env, fetchStub });
    assert.equal(res.statusCode, 503, `${missingName} 缺失必须返回 503`);
    assert.equal(fetchStub.calls.length, 0, `${missingName} 缺失时不得发起 fetch`);
  }

  for (const invalidKey of [
    'not-base64',
    Buffer.alloc(31, 0x41).toString('base64'),
    Buffer.alloc(33, 0x41).toString('base64')
  ]) {
    const fetchStub = createFetch();
    const { res } = await invoke({
      action: 'list_applications',
      env: { ...adminEnv(), V3A_SESSION_ENCRYPTION_KEY: invalidKey },
      fetchStub
    });
    assert.equal(res.statusCode, 503, 'Session encryption key 必须是严格 32-byte base64');
    assert.equal(fetchStub.calls.length, 0, 'Session encryption key 无效时不得发起 fetch');
  }

  for (const invalidKvUrl of [
    'http://v3a-session-kv.example',
    'https://user:pass@v3a-session-kv.example',
    `${KV_URL}/unexpected`,
    `${KV_URL}?namespace=other`,
    `${KV_URL}#fragment`
  ]) {
    const fetchStub = createFetch();
    const { res } = await invoke({
      action: 'list_applications',
      env: { ...adminEnv(), KV_REST_API_URL: invalidKvUrl },
      fetchStub
    });
    assert.equal(res.statusCode, 503, 'KV Session URL 必须是无 userinfo/path/query/hash 的 HTTPS origin');
    assert.equal(fetchStub.calls.length, 0, 'KV Session URL 无效时不得发起 fetch');
  }

  const opaqueCookieHeader = `${SESSION_COOKIE}=${SESSION_ID}`;
  for (const supabaseToken of [OLD_ACCESS_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_REFRESH_TOKEN]) {
    assert.equal(opaqueCookieHeader.includes(supabaseToken), false,
      '浏览器 Cookie 只能包含 opaque SID，不得包含 Supabase token');
  }

  let result = await invoke({ action: 'list_applications', headers: {} });
  assert.equal(result.res.statusCode, 401, '缺少 HttpOnly opaque session cookie 必须返回 401');
  assert.equal(result.fetchStub.calls.length, 0, '缺少 opaque session cookie 时不得访问 KV 或 Supabase');

  result = await invoke({
    action: 'list_applications',
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  assert.equal(result.res.statusCode, 401, 'Bearer token 不得替代 HttpOnly opaque session cookie');
  assert.equal(result.fetchStub.calls.length, 0, '只有 Bearer token 时不得访问 KV 或 Supabase');

  result = await invoke({
    action: 'list_applications',
    headers: { cookie: `${SESSION_COOKIE}=bad` }
  });
  assert.equal(result.res.statusCode, 401, '畸形 opaque SID 必须返回 401');
  assert.equal(result.fetchStub.calls.length, 0, '畸形 opaque SID 不得访问 KV 或 Supabase');
  assertClearedSessionCookie(result.res);

  result = await invoke({
    action: 'list_applications',
    headers: { cookie: `__Host-aipiwen_v3a_refresh=${REFRESH_TOKEN}` }
  });
  assert.equal(result.res.statusCode, 401, '旧 raw refresh-token Cookie 必须彻底失效');
  assert.equal(result.fetchStub.calls.length, 0, '旧 raw refresh-token Cookie 不得触发任何上游请求');

  result = await invoke({ action: 'list_applications', fetchOptions: { kvMissing: true } });
  assert.equal(result.res.statusCode, 401, 'KV 中不存在 opaque SID 必须返回 401');
  assert.equal(result.fetchStub.calls.filter(({ url }) => new URL(url).origin === KV_URL).length, 1,
    '不存在的 Session 只能读取一次 KV');
  assert.equal(result.fetchStub.calls.some(({ url }) => new URL(url).origin === ADMIN_SUPABASE_URL), false,
    'KV Session 不存在时不得访问 Supabase');
  assertClearedSessionCookie(result.res);

  const tamperedEnvelope = encryptSessionRecord(sessionRecord());
  tamperedEnvelope.tag = Buffer.alloc(16, 0x00).toString('base64');
  result = await invoke({
    action: 'list_applications',
    fetchOptions: { kvEnvelope: tamperedEnvelope }
  });
  assert.equal(result.res.statusCode, 401, '被篡改的加密 Session 必须返回 401');
  assert.equal(result.fetchStub.calls.some(({ url }) => new URL(url).origin === ADMIN_SUPABASE_URL), false,
    '加密 Session 验证失败时不得访问 Supabase');
  assertClearedSessionCookie(result.res);

  result = await invoke({
    action: 'list_applications',
    fetchOptions: { sessionRecord: sessionRecord({ absoluteExpiresAt: Date.now() - 1000 }) }
  });
  assert.equal(result.res.statusCode, 401, '超过 absolute expiry 的 Session 必须返回 401');
  assert.equal(result.fetchStub.calls.some(({ url }) => new URL(url).origin === ADMIN_SUPABASE_URL), false,
    'Session 绝对过期时不得访问 Supabase');
  assertClearedSessionCookie(result.res);

  for (const headers of [
    {
      cookie: `${SESSION_COOKIE}=${SESSION_ID}`,
      'x-csrf-token': CSRF_TOKEN,
      'content-type': 'application/json'
    },
    {
      cookie: `${SESSION_COOKIE}=${SESSION_ID}`,
      origin: `${ALLOWED_ORIGIN}/`,
      'x-csrf-token': CSRF_TOKEN,
      'content-type': 'application/json'
    }
  ]) {
    result = await invoke({
      method: 'POST',
      action: 'approve_application',
      body: { applicationId: APPLICATION_ID },
      headers,
      env: adminEnv('true')
    });
    assert.equal(result.res.statusCode, 403, '管理端 POST 缺少或不精确匹配 Origin 必须返回 403');
    assert.equal(result.fetchStub.calls.length, 0, 'Origin 校验必须发生在 KV Session 读取和写入之前');
  }

  for (const csrfHeader of [undefined, 'wrong-csrf-token']) {
    const headers = {
      cookie: `${SESSION_COOKIE}=${SESSION_ID}`,
      origin: ALLOWED_ORIGIN,
      'content-type': 'application/json'
    };
    if (csrfHeader !== undefined) headers['x-csrf-token'] = csrfHeader;
    result = await invoke({
      method: 'POST',
      action: 'approve_application',
      body: { applicationId: APPLICATION_ID },
      headers,
      env: adminEnv('true')
    });
    assert.equal(result.res.statusCode, 403,
      `管理端 POST 缺少或错误 X-CSRF-Token 必须返回 403，实际 ${result.res.statusCode}`);
    assert.equal(result.fetchStub.calls.some(({ url }) => new URL(url).origin === ADMIN_SUPABASE_URL), false,
      'CSRF 校验失败时不得访问 Supabase');
    assert.equal(result.fetchStub.calls.some((call) =>
      String(kvCommand(call)[0]).toUpperCase() === 'SET'), false,
      'CSRF 校验失败时不得更新 KV Session');
  }

  result = await invoke({
    action: 'list_applications',
    fetchOptions: { admin: adminRecord({ role: 'advisor' }) }
  });
  assert.equal(result.res.statusCode, 403,
    `普通用户必须返回 403，实际 ${result.res.statusCode} ${JSON.stringify(result.res.body)}`);
  assert.equal(result.fetchStub.calls.some(({ url }) => url.includes('/application_reviews')), false,
    '普通用户不得读取申请列表');

  result = await invoke({
    action: 'list_applications',
    fetchOptions: { admin: adminRecord({ status: 'frozen' }) }
  });
  assert.equal(result.res.statusCode, 403,
    `非 active super_admin 必须返回 403，实际 ${result.res.statusCode} ${JSON.stringify(result.res.body)}`);
  assert.equal(result.fetchStub.calls.some(({ url }) => url.includes('/application_reviews')), false,
    '非 active super_admin 不得读取申请列表');

  result = await invoke({ action: 'list_applications' });
  assert.equal(result.res.statusCode, 200, 'active super_admin 必须可以读取 pending 列表');
  assertEncryptedServerSessionFlow(result.fetchStub.calls, result.res);
  assertPendingQuery(result.fetchStub.calls);
  assert.equal([...result.envReads].every((name) => ALLOWED_ENV.has(name)), true,
    '后台接口不得读取合同外环境变量');
  for (const requiredName of REQUIRED_ADMIN_ENV) {
    assert.equal(result.envReads.has(requiredName), true, `后台接口必须读取 ${requiredName}`);
  }
  const listPayload = JSON.parse(JSON.stringify(result.res.body));
  assert.equal(listPayload.csrfToken, CSRF_TOKEN, '管理端 GET 必须在顶层返回当前 Session CSRF token');
  const applications = listPayload.applications || listPayload.data || [];
  assert.equal(applications.length, 1, '列表只能返回 pending 申请');
  assert.equal(applications[0].applicationId || applications[0].id, APPLICATION_ID);
  assert.equal(JSON.stringify(listPayload).includes(APPROVED_APPLICATION_ID), false,
    '列表不得返回非 pending 申请');
  assert.equal(JSON.stringify(listPayload).includes(MASKED_PHONE), true,
    `手机号必须脱敏为 ${MASKED_PHONE}`);
  assertNoSensitivePayload(listPayload);

  result = await invoke({ action: 'get_application', query: { id: APPLICATION_ID } });
  assert.equal(result.res.statusCode, 200, 'active super_admin 必须可以读取 pending 申请详情');
  assert.equal(result.res.body.csrfToken, CSRF_TOKEN, '管理端详情 GET 必须返回当前 Session CSRF token');
  assertPendingQuery(result.fetchStub.calls);
  assert.equal(JSON.stringify(result.res.body).includes(MASKED_PHONE), true, '详情必须只返回脱敏手机号');
  assertNoSensitivePayload(result.res.body);

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID }
  });
  assert.equal(result.res.statusCode, 503, '审核写开关默认关闭');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 0, '写开关关闭时不得调用任何 RPC');

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '批准 pending 申请应成功');
  assert.equal(result.res.body.message, '平台准入审核通过', '批准响应必须使用正式用户可读文案');
  assert.equal(result.res.body.userStatus, 'active', '批准响应必须返回 active 状态');
  assert.equal(result.res.body.walletBalance, 500, '批准响应必须返回真实钱包余额');
  assert.equal(result.res.body.creditLog?.type, 'REGISTER_BONUS',
    '批准响应必须返回 REGISTER_BONUS 类型');
  assert.equal(result.res.body.creditLog?.amount, 500,
    '批准响应必须返回 REGISTER_BONUS 金额');
  assert.match(result.res.body.inviteCode, /^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/,
    '批准响应必须返回邀请码');
  let writes = reviewMutationCalls(result.fetchStub.calls);
  assert.equal(writes.length, 1, '批准流程只能有一次写请求');
  assert.equal(new URL(writes[0].url).pathname, '/rest/v1/rpc/v3a_approve_application',
    '批准流程只能调用 v3a_approve_application RPC');
  let rpcBody = JSON.parse(writes[0].init.body);
  assert.equal(rpcBody.p_application_id, APPLICATION_ID);
  assert.equal(rpcBody.p_reviewer_user_id, ADMIN_USER_ID);
  assert.equal(typeof rpcBody.p_invite_code, 'string');
  assertNoSensitivePayload(result.res.body);

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID },
    headers: {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(SESSION_ID)}`,
      origin: DEPLOYMENT_ORIGIN,
      'x-csrf-token': CSRF_TOKEN,
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin'
    },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '当前 Vercel Preview 部署域名必须可通过管理端同源写校验');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 1,
    '当前 Preview 部署域名通过后只能调用一次审核 RPC');

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID, reviewer_id: ADMIN_USER_ID },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 400, '批准请求不得接受前端传入的 reviewer_id');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 0,
    '请求字段不符合合同时不得调用 RPC');

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPROVED_APPLICATION_ID },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '已批准申请重放必须进入 RPC 幂等分支');
  assert.equal(result.res.body.alreadyProcessed, true, '已批准重放必须返回 alreadyProcessed');
  writes = reviewMutationCalls(result.fetchStub.calls);
  assert.equal(writes.length, 1, '已批准重放仍只能调用一次数据库 RPC');
  rpcBody = JSON.parse(writes[0].init.body);
  assert.equal(rpcBody.p_application_id, APPROVED_APPLICATION_ID);

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: REJECTED_APPLICATION_ID },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 400, '已驳回申请不得进入 approve RPC');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 0,
    '已驳回申请不得产生任何审批写请求');

  const reason = '申请资料与当前审核要求不一致，请补充后重新提交';
  result = await invoke({
    method: 'POST',
    action: 'reject_application',
    body: { applicationId: APPLICATION_ID, reason },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '驳回 pending 申请应成功');
  assert.equal(result.res.body.message, '平台准入审核驳回', '驳回应答必须使用正式用户可读文案');
  assert.equal(result.res.body.userStatus, 'rejected', '驳回应答必须返回 rejected 状态');
  writes = reviewMutationCalls(result.fetchStub.calls);
  assert.equal(writes.length, 1, '驳回流程只能有一次写请求');
  assert.equal(new URL(writes[0].url).pathname, '/rest/v1/rpc/v3a_reject_application',
    '驳回流程只能调用 v3a_reject_application RPC');
  rpcBody = JSON.parse(writes[0].init.body);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rpcBody)), {
    p_application_id: APPLICATION_ID,
    p_reviewer_user_id: ADMIN_USER_ID,
    p_reason: reason
  });
  assertNoSensitivePayload(result.res.body);

  result = await invoke({
    method: 'POST',
    action: 'reject_application',
    body: { applicationId: APPLICATION_ID, reason, reviewer_id: ADMIN_USER_ID },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 400, '驳回请求不得接受前端传入的 reviewer_id');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 0,
    '驳回请求字段不符合合同时不得调用 RPC');

  result = await invoke({
    method: 'POST',
    action: 'reject_application',
    body: { applicationId: APPLICATION_ID, reason: '过'.repeat(501) },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode, 400, '超长驳回原因必须在调用 RPC 前拒绝');
  assert.equal(reviewMutationCalls(result.fetchStub.calls).length, 0, '超长驳回原因不得产生写请求');

  const upstreamLeak = {
    message: 'database internal failure',
    details: `auth_user_id raw detail ${SERVICE_KEY} ${RAW_PHONE}`
  };
  result = await invoke({ action: 'list_applications', fetchOptions: { dataFailure: upstreamLeak } });
  assert.equal(result.res.statusCode >= 500, true, '底层列表错误必须返回服务端错误');
  assertNoSensitivePayload(result.res.body);
  assert.equal(JSON.stringify(result.res.body).includes('database internal failure'), false,
    '列表错误不得泄露底层错误信息');

  result = await invoke({
    method: 'POST',
    action: 'reject_application',
    body: { applicationId: APPLICATION_ID, reason },
    fetchOptions: { rpcFailure: upstreamLeak },
    env: adminEnv('true')
  });
  assert.equal(result.res.statusCode >= 500, true, '底层 RPC 错误必须返回服务端错误');
  assertNoSensitivePayload(result.res.body);
  assert.equal(JSON.stringify(result.res.body).includes('database internal failure'), false,
    'RPC 错误不得泄露底层错误信息');

  console.log('PASS: V3a admin opaque Session, CSRF, environment gate, masking, pending-only reads, and RPC-only review contracts');
}

run().catch((error) => {
  console.error(`FAIL: V3a admin flow contract: ${error.message}`);
  process.exitCode = 1;
});
