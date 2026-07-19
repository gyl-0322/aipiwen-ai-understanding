#!/usr/bin/env node

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'api', 'v3a-session.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const PREVIEW_REF = 'lmjriqncuopgxwyudfee';
const PRODUCTION_REF = 'tysbwijizgebnrazxpvo';
const PREVIEW_URL = `https://${PREVIEW_REF}.supabase.co`;
const ALLOWED_ORIGIN = 'https://preview.aipiwen.cn';
const DEPLOYMENT_HOST = 'aipiwen-ai-understanding-a5lprbyl2-guo-yanling-s-projects.vercel.app';
const DEPLOYMENT_ORIGIN = `https://${DEPLOYMENT_HOST}`;
const KV_URL = 'https://kv-session.test';
const ANON_KEY = 'TEST_V3A_ANON_KEY_NOT_REAL';
const KV_TOKEN = 'TEST_V3A_KV_TOKEN_NOT_REAL';
const SESSION_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const COOKIE_NAME = '__Host-aipiwen_v3a_session';
const COOKIE_MAX_AGE = 604800;
const PHONE = '+8613800138000';
const HOSTED_PHONE = '8613800138000';
const MASKED_PHONE = '+86 138****8000';
const OTP = '123456';
const AUTH_USER_ID = '40000000-0000-4000-8000-000000000001';
const BUSINESS_USER_ID = '10000000-0000-4000-8000-000000000001';
const ACCESS_TOKEN = 'TEST_V3A_ACCESS_TOKEN_NOT_REAL';
const REFRESH_TOKEN = 'TEST_V3A_REFRESH_TOKEN_NOT_REAL';
const ROTATED_ACCESS_TOKEN = 'TEST_V3A_ROTATED_ACCESS_TOKEN_NOT_REAL';
const ROTATED_REFRESH_TOKEN = 'TEST_V3A_ROTATED_REFRESH_TOKEN_NOT_REAL';
const ALLOWED_ENV = new Set([
  'V3A_SUPABASE_URL',
  'V3A_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'V3A_SUPABASE_PROJECT_REF',
  'VERCEL_ENV',
  'VERCEL_TARGET_ENV',
  'V3A_ALLOWED_ORIGIN',
  'V3A_ALLOWED_ORIGINS',
  'VERCEL_URL',
  'V3A_PHONE_OTP_ENABLED',
  'V3A_SESSION_ENCRYPTION_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN'
]);

function previewEnv(overrides = {}) {
  return {
    V3A_SUPABASE_URL: PREVIEW_URL,
    V3A_SUPABASE_ANON_KEY: ANON_KEY,
    V3A_SUPABASE_PROJECT_REF: PREVIEW_REF,
    VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'preview',
    V3A_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
    VERCEL_URL: DEPLOYMENT_HOST,
    V3A_SESSION_ENCRYPTION_KEY: SESSION_ENCRYPTION_KEY,
    KV_REST_API_URL: KV_URL,
    KV_REST_API_TOKEN: KV_TOKEN,
    ...overrides
  };
}

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get() { return null; } },
    async json() { return payload; },
    async text() { return payload == null ? '' : JSON.stringify(payload); }
  };
}

function parseBody(body) {
  if (body == null || body === '') return undefined;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return body; }
  }
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  return body;
}

function createFetch(options = {}) {
  const calls = [];
  const kvStore = new Map();
  const businessStatus = options.businessStatus || 'pending';

  function applyKv(command) {
    assert(Array.isArray(command) && command.length > 0, 'KV 请求必须是 Redis 命令数组');
    const [rawName, rawKey, ...args] = command;
    const name = String(rawName).toUpperCase();
    const key = String(rawKey || '');
    if (name === 'SET') {
      const nx = args.slice(1).some((item) => String(item).toUpperCase() === 'NX');
      if (nx && kvStore.has(key)) return null;
      kvStore.set(key, String(args[0]));
      return 'OK';
    }
    if (name === 'SETEX') {
      kvStore.set(key, String(args[1]));
      return 'OK';
    }
    if (name === 'GET') return kvStore.has(key) ? kvStore.get(key) : null;
    if (name === 'DEL') return kvStore.delete(key) ? 1 : 0;
    if (name === 'EXPIRE') return kvStore.has(key) ? 1 : 0;
    if (name === 'EVAL') {
      const script = key;
      const evalKey = String(args[1] || '');
      const argument = String(args[2] || '');
      if (script.includes('redis.call("incr"')) {
        const count = Number(kvStore.get(evalKey) || 0) + 1;
        kvStore.set(evalKey, String(count));
        return count;
      }
      const lock = evalKey;
      const token = argument;
      if (kvStore.get(lock) !== token) return 0;
      kvStore.delete(lock);
      return 1;
    }
    throw new Error(`Unexpected KV command: ${name}`);
  }

  const fetchStub = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = parseBody(init.body);
    const call = { url: url.toString(), method, init, body };
    calls.push(call);

    if (url.origin === KV_URL) {
      assert.equal(method, 'POST', 'Session KV 只能通过 POST 调用 Redis REST API');
      assert.equal(init.headers?.Authorization, `Bearer ${KV_TOKEN}`, 'Session KV 必须使用专用 KV token');
      if (url.pathname === '/pipeline') {
        return response(200, body.map((command) => ({ result: applyKv(command) })));
      }
      if (url.pathname === '/' || url.pathname === '') {
        return response(200, { result: applyKv(body) });
      }
      throw new Error(`Unexpected KV path: ${url.pathname}`);
    }

    assert.equal(url.origin, PREVIEW_URL, '所有 Supabase 请求必须固定在 Preview 项目');
    if (/\/auth\/v1\/admin\/users\/?$/.test(url.pathname)) {
      throw new Error('Session API must never create an admin Auth user');
    }
    if (url.pathname === '/auth/v1/otp') return response(200, {});
    if (url.pathname === '/auth/v1/verify') {
      const verifiedPhone = Object.prototype.hasOwnProperty.call(options, 'verifyPhone')
        ? options.verifyPhone
        : String(body.phone || '').replace(/^\+86(?=1)/, '86');
      return response(200, {
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
        user: authUser({ phone: verifiedPhone, ...(options.verifyUserOverrides || {}) })
      });
    }
    if (url.pathname === '/auth/v1/token') {
      await new Promise((resolve) => setImmediate(resolve));
      return response(200, {
        access_token: ROTATED_ACCESS_TOKEN,
        refresh_token: ROTATED_REFRESH_TOKEN,
        expires_in: 3600,
        user: authUser()
      });
    }
    if (url.pathname === '/auth/v1/user') return response(200, authUser());
    if (url.pathname === '/auth/v1/logout') return response(204, null);
    if (url.pathname === '/rest/v1/users') {
      return response(200, [{
        id: BUSINESS_USER_ID,
        auth_user_id: AUTH_USER_ID,
        phone: PHONE,
        email: 'private@example.test',
        role: 'advisor',
        status: businessStatus,
        display_name: '测试指导师',
        city: '上海',
        created_at: '2026-07-15T00:00:00.000Z',
        last_login_at: null
      }]);
    }
    if (url.pathname === '/rest/v1/advisor_profiles') {
      return response(200, [{
        user_id: BUSINESS_USER_ID,
        role: 'advisor',
        status: businessStatus,
        nickname: '测试指导师',
        city: '上海',
        practitioner_type: 'independent',
        created_at: '2026-07-15T00:00:00.000Z'
      }]);
    }
    if (url.pathname === '/rest/v1/application_reviews') {
      return response(200, [{
        user_id: BUSINESS_USER_ID,
        role: 'advisor',
        status: businessStatus === 'active' ? 'approved' : businessStatus,
        applied_city: '上海',
        applied_nickname: '测试指导师',
        practitioner_type: 'independent',
        created_at: '2026-07-15T00:00:00.000Z'
      }]);
    }
    if (url.pathname === '/rest/v1/credit_wallets') {
      if (businessStatus !== 'active') throw new Error('pending 用户不得读取钱包');
      return response(200, [{ balance: options.walletBalance ?? 500 }]);
    }
    if (url.pathname === '/rest/v1/invite_codes') {
      if (businessStatus !== 'active') throw new Error('pending 用户不得读取邀请码');
      return response(200, [{ code: options.inviteCode || 'ADV-ABCDEFGH' }]);
    }
    if (url.pathname === '/rest/v1/rpc/v3a_submit_pending_application') {
      return response(200, { success: true });
    }
    throw new Error(`Unexpected Supabase path: ${url.pathname}`);
  };

  fetchStub.calls = calls;
  fetchStub.kvStore = kvStore;
  return fetchStub;
}

function authUser(overrides = {}) {
  return {
    id: AUTH_USER_ID,
    phone: PHONE,
    email: 'private@example.test',
    phone_confirmed_at: '2026-07-15T00:00:00.000Z',
    user_metadata: { privateMarker: 'AUTH_USER_PRIVATE_MARKER' },
    ...overrides
  };
}

function loadHandler(env, fetchStub) {
  const envReads = new Set();
  const envProxy = new Proxy({ ...env }, {
    get(target, property) {
      if (typeof property !== 'string') return target[property];
      assert(ALLOWED_ENV.has(property), `Session API 不得读取环境变量 ${property}`);
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
    TextEncoder,
    TextDecoder,
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout,
    setImmediate,
    clearImmediate
  });
  const cache = new Map();

  function loadModule(filename) {
    const resolved = require.resolve(filename);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const code = fs.readFileSync(resolved, 'utf8');
    const wrapper = new vm.Script(
      `(function (require, module, exports, __filename, __dirname) {\n${code}\n})`,
      { filename: resolved }
    ).runInContext(context);
    const localRequire = (request) => {
      if (!request.startsWith('.') && !path.isAbsolute(request)) return require(request);
      return loadModule(path.resolve(path.dirname(resolved), request));
    };
    wrapper(localRequire, module, module.exports, resolved, path.dirname(resolved));
    return module.exports;
  }

  const handler = loadModule(sourcePath);
  assert.equal(typeof handler, 'function', 'api/v3a-session.js 必须导出请求处理函数');
  return { handler, envReads };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end(payload) {
      if (payload !== undefined) this.body = payload;
      return this;
    }
  };
}

async function invoke(options = {}) {
  const fetchStub = options.fetchStub || createFetch();
  const env = options.env || previewEnv();
  const loaded = options.loaded || loadHandler(env, fetchStub);
  const { handler, envReads } = loaded;
  const defaultHeaders = options.method === 'POST'
    ? { origin: ALLOWED_ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }
    : {};
  const req = {
    method: options.method || 'GET',
    query: { action: options.action || '' },
    headers: options.headers === undefined ? defaultHeaders : options.headers,
    body: options.body
  };
  const res = createResponse();
  await handler(req, res);
  assert.equal(res.headers['cache-control'], 'private, no-store', '所有 Session 响应必须禁止缓存');
  return { res, fetchStub, envReads };
}

function payload(res) {
  if (typeof res.body !== 'string') return res.body;
  try { return JSON.parse(res.body); } catch { return res.body; }
}

function setCookie(res) {
  const value = res.headers['set-cookie'];
  return Array.isArray(value) ? value.join('; ') : String(value || '');
}

function assertCookieAttributes(serialized) {
  assert.match(serialized, /(?:^|;)\s*Path=\/(?:;|$)/i, 'Session cookie 必须 Path=/');
  assert.match(serialized, /(?:^|;)\s*Secure(?:;|$)/i, 'Session cookie 必须 Secure');
  assert.match(serialized, /(?:^|;)\s*HttpOnly(?:;|$)/i, 'Session cookie 必须 HttpOnly');
  assert.match(serialized, /(?:^|;)\s*SameSite=Lax(?:;|$)/i, 'Session cookie 必须 SameSite=Lax');
  assert.doesNotMatch(serialized, /(?:^|;)\s*Domain=/i, '__Host cookie 不得设置 Domain');
}

function assertSidCookie(res) {
  const serialized = setCookie(res);
  assertCookieAttributes(serialized);
  const first = serialized.split(';')[0];
  const prefix = `${COOKIE_NAME}=`;
  assert(first.startsWith(prefix), `验证成功必须设置 ${COOKIE_NAME}`);
  const sid = decodeURIComponent(first.slice(prefix.length));
  assert(sid, 'Session cookie 必须包含 opaque SID');
  assert.match(serialized, new RegExp(`(?:^|;)\\s*Max-Age=${COOKIE_MAX_AGE}(?:;|$)`, 'i'),
    'Session cookie 必须使用 7 天绝对生命周期');
  const bytes = /^[0-9a-f]{64}$/i.test(sid)
    ? Buffer.from(sid, 'hex')
    : Buffer.from(sid, 'base64url');
  assert.equal(bytes.length, 32, 'Session SID 必须由 32 字节随机数生成');
  for (const forbidden of [ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN, PHONE, HOSTED_PHONE, OTP]) {
    assert.equal(serialized.includes(forbidden), false, '浏览器 Cookie 不得包含 Supabase token、手机号或 OTP');
  }
  return sid;
}

function assertClearedCookie(res) {
  const serialized = setCookie(res);
  assertCookieAttributes(serialized);
  assert.match(serialized, new RegExp(`^${COOKIE_NAME}=;`), '退出必须清空 Session cookie');
  assert.match(serialized, /(?:^|;)\s*Max-Age=0(?:;|$)/i, '退出必须立即失效 Session cookie');
}

function assertNoSensitiveBody(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN,
    PHONE, HOSTED_PHONE, OTP, AUTH_USER_ID, 'private@example.test', 'AUTH_USER_PRIVATE_MARKER',
    SESSION_ENCRYPTION_KEY, KV_TOKEN
  ]) {
    assert.equal(serialized.includes(forbidden), false, `响应不得泄漏敏感值 ${forbidden}`);
  }
  for (const field of ['access_token', 'refresh_token', 'auth_user_id', 'phone', 'email', 'user_metadata']) {
    assert.equal(new RegExp(`"${field}"\\s*:`).test(serialized), false, `响应不得包含 ${field} 字段`);
  }
}

function sessionKey(sid) {
  return `v3a:session:${crypto.createHash('sha256').update(sid).digest('hex')}`;
}

function sessionEntries(kvStore) {
  return [...kvStore.entries()].filter(([key]) => /^v3a:session:[0-9a-f]{64}$/.test(key));
}

function parseEnvelope(kvStore, sid) {
  const raw = kvStore.get(sessionKey(sid));
  assert.equal(typeof raw, 'string', 'KV 必须使用 sha256(SID) 作为 Session key');
  const envelope = JSON.parse(raw);
  assert.deepStrictEqual(Object.keys(envelope).sort(), ['ciphertext', 'iv', 'tag', 'v'],
    'Session 密文必须使用固定 AES-GCM envelope');
  assert.equal(envelope.v, 1, 'Session envelope 版本必须为 1');
  assert.equal(Buffer.from(envelope.iv, 'base64url').length, 12, 'AES-GCM IV 必须为 12 字节');
  assert.equal(Buffer.from(envelope.tag, 'base64url').length, 16, 'AES-GCM tag 必须为 16 字节');
  assert(Buffer.from(envelope.ciphertext, 'base64url').length > 32, 'Session ciphertext 不得为空');
  return envelope;
}

function decryptSession(kvStore, sid) {
  const envelope = parseEnvelope(kvStore, sid);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(SESSION_ENCRYPTION_KEY, 'base64'),
    Buffer.from(envelope.iv, 'base64url')
  );
  decipher.setAAD(Buffer.from(sessionKey(sid), 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function replaceSession(kvStore, sid, record) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(SESSION_ENCRYPTION_KEY, 'base64'), iv);
  cipher.setAAD(Buffer.from(sessionKey(sid), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  kvStore.set(sessionKey(sid), JSON.stringify({
    v: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  }));
}

function assertEncryptedKv(kvStore, sid) {
  assert.equal(sessionEntries(kvStore).length, 1, '每个登录 Session 必须且只能写入一条 Session KV 记录');
  const raw = kvStore.get(sessionKey(sid));
  for (const forbidden of [
    ACCESS_TOKEN, REFRESH_TOKEN, ROTATED_ACCESS_TOKEN, ROTATED_REFRESH_TOKEN,
    PHONE, HOSTED_PHONE, OTP, AUTH_USER_ID, 'accessToken', 'refreshToken', 'csrfToken'
  ]) {
    assert.equal(raw.includes(forbidden), false, 'KV Session 记录必须使用 AES-256-GCM 加密');
  }
  const record = decryptSession(kvStore, sid);
  for (const field of [
    'authUserId', 'accessToken', 'refreshToken', 'accessExpiresAt',
    'csrfToken', 'createdAt', 'absoluteExpiresAt'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(record, field), `Session record 缺少 ${field}`);
  }
  assert.equal(record.authUserId, AUTH_USER_ID);
  assert.equal(typeof record.csrfToken, 'string');
  assert(record.csrfToken.length >= 32, '服务端 CSRF token 必须具有足够随机性');
  assert.equal('phone' in record, false, 'Session record 不得保存手机号');
  assert.equal('email' in record, false, 'Session record 不得保存邮箱');
  assert.equal(record.absoluteExpiresAt - record.createdAt, COOKIE_MAX_AGE * 1000,
    'Session 必须使用 7 天不可滑动的绝对过期时间');
  return record;
}

function kvCommands(calls) {
  return calls
    .filter(({ url }) => new URL(url).origin === KV_URL)
    .flatMap(({ body }) => Array.isArray(body?.[0]) ? body : [body]);
}

function supabaseCalls(calls) {
  return calls.filter(({ url }) => new URL(url).origin === PREVIEW_URL);
}

function restMutations(calls) {
  return supabaseCalls(calls).filter(({ url, method }) =>
    new URL(url).pathname.startsWith('/rest/v1/') && !['GET', 'HEAD'].includes(method));
}

function otpHeaders(ip, origin = ALLOWED_ORIGIN) {
  return {
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-forwarded-for': ip
  };
}

function assertPrivateRateKeys(fetchStub, scopes, identifiers) {
  const keys = [...fetchStub.kvStore.keys()].filter((key) => key.startsWith('v3a:rate:'));
  scopes.forEach((scope) => {
    assert(keys.some((key) => key.startsWith(`v3a:rate:${scope}:`)), `缺少 ${scope} 限流 key`);
  });
  keys.forEach((key) => {
    identifiers.forEach((identifier) => {
      assert.equal(key.includes(identifier), false, '限流 KV key 不得暴露原始手机号或 IP');
    });
    assert.match(key, /^v3a:rate:[a-z-]+:[0-9a-f]{64}$/, '限流标识必须使用带密钥 HMAC 摘要');
  });
}

async function run() {
  const enabledEnv = previewEnv({ V3A_PHONE_OTP_ENABLED: 'true' });
  let result;

  assert.equal(/auth\/v1\/admin\/users|admin\.createUser|auth\.admin\.createUser|\.signUp\s*\(/.test(source), false,
    'Session API 不得创建 Supabase admin Auth 用户');
  assert.equal(source.includes('V3A_SUPABASE_SERVICE_ROLE_KEY'), false,
    'Session API 不得读取 service role key');
  assert.equal(source.includes('__Host-aipiwen_v3a_refresh'), false,
    '浏览器不得再保存 Supabase refresh token cookie');
  assert.equal(source.includes('V3A_SESSION_SECRET'), false,
    'Session 加密只能使用统一的 V3A_SESSION_ENCRYPTION_KEY');

  for (const env of [
    previewEnv({ V3A_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, V3A_SUPABASE_PROJECT_REF: PRODUCTION_REF }),
    previewEnv({ V3A_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }),
    previewEnv({ V3A_SUPABASE_PROJECT_REF: PRODUCTION_REF }),
    previewEnv({ V3A_SUPABASE_PROJECT_REF: 'another-project-ref' }),
    previewEnv({ VERCEL_ENV: 'production' }),
    previewEnv({ VERCEL_TARGET_ENV: 'production' }),
    previewEnv({ V3A_ALLOWED_ORIGIN: `${ALLOWED_ORIGIN}/path` }),
    previewEnv({ V3A_ALLOWED_ORIGIN: '', VERCEL_URL: '' }),
    previewEnv({ VERCEL_URL: 'preview.aipiwen.cn' }),
    previewEnv({ VERCEL_URL: `${DEPLOYMENT_HOST}/path` }),
    previewEnv({ V3A_SESSION_ENCRYPTION_KEY: '' }),
    previewEnv({ V3A_SESSION_ENCRYPTION_KEY: Buffer.alloc(31, 7).toString('base64') }),
    previewEnv({ V3A_SESSION_ENCRYPTION_KEY: 'not-valid-base64!' }),
    previewEnv({ KV_REST_API_URL: '', KV_REST_API_TOKEN: '' })
  ]) {
    const fetchStub = createFetch();
    const result = await invoke({
      method: 'POST',
      action: 'request_otp',
      body: { phone: PHONE },
      env: { ...env, V3A_PHONE_OTP_ENABLED: 'true' },
      fetchStub
    });
    assert.equal(result.res.statusCode, 503, '无效 Preview、Origin、KV 或 Session encryption key 配置必须返回 503');
    assert.equal(fetchStub.calls.length, 0, '配置门禁失败时不得发起任何网络请求');
  }

  const genericSupabaseEnv = previewEnv({ V3A_PHONE_OTP_ENABLED: 'true' });
  genericSupabaseEnv.NEXT_PUBLIC_SUPABASE_URL = genericSupabaseEnv.V3A_SUPABASE_URL;
  genericSupabaseEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = genericSupabaseEnv.V3A_SUPABASE_ANON_KEY;
  delete genericSupabaseEnv.V3A_SUPABASE_URL;
  delete genericSupabaseEnv.V3A_SUPABASE_ANON_KEY;
  let genericFetchStub = createFetch();
  let genericResult = await invoke({
    method: 'POST',
    action: 'request_otp',
    body: { phone: PHONE },
    headers: otpHeaders('203.0.113.9'),
    env: genericSupabaseEnv,
    fetchStub: genericFetchStub
  });
  assert.equal(genericResult.res.statusCode, 200,
    'Preview 必须可安全复用现有 NEXT_PUBLIC Supabase URL/anon key');
  assert.equal(supabaseCalls(genericFetchStub.calls).length, 1,
    '通用 Preview Supabase 变量只能触发一次 OTP 上游请求');

  for (const action of ['request_otp', 'verify_otp']) {
    for (const headers of [{}, { origin: `${ALLOWED_ORIGIN}/` }, { origin: `${ALLOWED_ORIGIN}.evil` }]) {
      const fetchStub = createFetch();
      const result = await invoke({
        method: 'POST',
        action,
        body: action === 'request_otp' ? { phone: PHONE } : { phone: PHONE, token: OTP },
        headers,
        env: previewEnv({ V3A_PHONE_OTP_ENABLED: 'true' }),
        fetchStub
      });
      assert.equal(result.res.statusCode, 403, 'OTP POST 必须匹配允许的 Preview Origin');
      assert.equal(fetchStub.calls.length, 0, 'Origin 失败必须发生在 OTP 上游请求前');
    }
  }

  const deploymentOriginFetch = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'request_otp',
    body: { phone: PHONE },
    headers: otpHeaders('203.0.113.8', DEPLOYMENT_ORIGIN),
    env: enabledEnv,
    fetchStub: deploymentOriginFetch
  });
  assert.equal(result.res.statusCode, 200, '当前 Vercel Preview 部署域名必须可通过同源校验');
  assert.equal(supabaseCalls(deploymentOriginFetch.calls).length, 1,
    '当前 Preview 部署域名通过后只能触发一次 OTP 上游请求');

  let fetchStub = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'request_otp',
    body: { phone: '13800138000' },
    fetchStub
  });
  assert.equal(result.res.statusCode, 503, '短信发送开关默认必须关闭');
  assert.equal(fetchStub.calls.length, 0, '短信开关默认关闭时必须零 fetch');

  fetchStub = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'request_otp',
    body: { phone: '13800138000' },
    env: previewEnv({ V3A_PHONE_OTP_ENABLED: 'true' }),
    fetchStub
  });
  assert.equal(result.res.statusCode, 200, '短信开关开启后应允许发送 OTP');
  let upstream = supabaseCalls(fetchStub.calls);
  assert.equal(upstream.length, 1, '发送 OTP 只能调用一次 Supabase');
  assert.equal(upstream[0].method, 'POST');
  assert.equal(new URL(upstream[0].url).pathname, '/auth/v1/otp', '发送 OTP 只能调用 /auth/v1/otp');
  assert.equal(upstream[0].body.phone, PHONE, '手机号必须规范化为中国 E.164');
  assert.equal(upstream[0].body.create_user, true, 'Phone OTP 必须允许 Supabase 创建普通 Auth 用户');
  assertNoSensitiveBody(payload(result.res));

  for (const [label, verifyPhone] of [['Hosted 86', HOSTED_PHONE], ['E.164 +86', PHONE]]) {
    const compatibleFetch = createFetch({ verifyPhone });
    const compatibleResult = await invoke({
      method: 'POST',
      action: 'verify_otp',
      body: { phone: PHONE, token: OTP },
      env: enabledEnv,
      fetchStub: compatibleFetch
    });
    assert.equal(compatibleResult.res.statusCode, 200, `${label} 同号格式必须通过身份校验`);
    assertSidCookie(compatibleResult.res);
  }

  for (const testCase of [
    { label: '不同中国手机号', verifyPhone: '+8613900139000' },
    { label: '裸 11 位手机号', verifyPhone: '13800138000' },
    { label: '境外手机号', verifyPhone: '+14155550100' },
    { label: '畸形手机号', verifyPhone: 'not-a-phone' },
    { label: '缺失手机号', verifyPhone: undefined },
    { label: '未确认手机号', verifyPhone: HOSTED_PHONE, verifyUserOverrides: { phone_confirmed_at: null } }
  ]) {
    const rejectedFetch = createFetch({
      verifyPhone: testCase.verifyPhone,
      verifyUserOverrides: testCase.verifyUserOverrides
    });
    const rejected = await invoke({
      method: 'POST',
      action: 'verify_otp',
      body: { phone: PHONE, token: OTP },
      env: enabledEnv,
      fetchStub: rejectedFetch
    });
    assert.equal(rejected.res.statusCode, 502, `${testCase.label} 必须拒绝建立 Session`);
    assert.equal(payload(rejected.res).code, 'INVALID_SESSION');
    assert.equal(sessionEntries(rejectedFetch.kvStore).length, 0, '身份校验失败不得写 Session KV');
    assert.equal(setCookie(rejected.res), '', '身份校验失败不得下发 Session Cookie');
    assert.equal(supabaseCalls(rejectedFetch.calls)
      .some(({ url }) => new URL(url).pathname === '/auth/v1/user'), false,
      '身份校验失败不得继续回读 Auth user');
  }

  const sendPhoneIp = '203.0.113.10';
  const sendPhoneRateFetch = createFetch();
  for (let index = 0; index < 6; index += 1) {
    const before = sendPhoneRateFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action: 'request_otp',
      body: { phone: PHONE },
      headers: otpHeaders(sendPhoneIp),
      env: enabledEnv,
      fetchStub: sendPhoneRateFetch
    });
    assert.equal(result.res.statusCode, index < 5 ? 200 : 429,
      '同一手机号 10 分钟内第 6 次发送必须被限流');
    if (index === 5) {
      assert.equal(supabaseCalls(sendPhoneRateFetch.calls.slice(before)).length, 0,
        '手机号发送超限必须在 Supabase 前返回 429');
      assertNoSensitiveBody(payload(result.res));
    }
  }
  assert.equal(supabaseCalls(sendPhoneRateFetch.calls)
    .filter(({ url }) => new URL(url).pathname === '/auth/v1/otp').length, 5);
  assertPrivateRateKeys(sendPhoneRateFetch, ['otp-send-ip', 'otp-send-phone'], [PHONE, sendPhoneIp]);

  const sendIp = '203.0.113.11';
  const sendIpRateFetch = createFetch();
  const sendIpPhones = Array.from({ length: 11 }, (_, index) => `+861390000${String(index).padStart(4, '0')}`);
  for (let index = 0; index < sendIpPhones.length; index += 1) {
    const before = sendIpRateFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action: 'request_otp',
      body: { phone: sendIpPhones[index] },
      headers: otpHeaders(sendIp),
      env: enabledEnv,
      fetchStub: sendIpRateFetch
    });
    assert.equal(result.res.statusCode, index < 10 ? 200 : 429,
      '同一 IP 10 分钟内第 11 次发送必须被限流');
    if (index === 10) {
      assert.equal(supabaseCalls(sendIpRateFetch.calls.slice(before)).length, 0,
        'IP 发送超限必须在 Supabase 前返回 429');
    }
  }
  assertPrivateRateKeys(sendIpRateFetch, ['otp-send-ip', 'otp-send-phone'], [sendIp, ...sendIpPhones]);

  const verifyPhoneIp = '203.0.113.12';
  const verifyPhoneRateFetch = createFetch();
  for (let index = 0; index < 11; index += 1) {
    const before = verifyPhoneRateFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action: 'verify_otp',
      body: { phone: PHONE, token: OTP },
      headers: otpHeaders(verifyPhoneIp),
      env: enabledEnv,
      fetchStub: verifyPhoneRateFetch
    });
    assert.equal(result.res.statusCode, index < 10 ? 200 : 429,
      '同一手机号 10 分钟内第 11 次验证必须被限流');
    if (index === 10) {
      assert.equal(supabaseCalls(verifyPhoneRateFetch.calls.slice(before)).length, 0,
        '手机号验证超限必须在 Supabase 前返回 429');
      assertNoSensitiveBody(payload(result.res));
    }
  }
  assert.equal(supabaseCalls(verifyPhoneRateFetch.calls)
    .filter(({ url }) => new URL(url).pathname === '/auth/v1/verify').length, 10);
  assertPrivateRateKeys(verifyPhoneRateFetch, ['otp-verify-ip', 'otp-verify-phone'], [PHONE, verifyPhoneIp]);

  const verifyIp = '203.0.113.13';
  const verifyIpRateFetch = createFetch();
  const verifyIpPhones = Array.from({ length: 21 }, (_, index) => `+861370000${String(index).padStart(4, '0')}`);
  for (let index = 0; index < verifyIpPhones.length; index += 1) {
    const before = verifyIpRateFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action: 'verify_otp',
      body: { phone: verifyIpPhones[index], token: OTP },
      headers: otpHeaders(verifyIp),
      env: enabledEnv,
      fetchStub: verifyIpRateFetch
    });
    assert.equal(result.res.statusCode, index < 20 ? 200 : 429,
      '同一 IP 10 分钟内第 21 次验证必须被限流');
    if (index === 20) {
      assert.equal(supabaseCalls(verifyIpRateFetch.calls.slice(before)).length, 0,
        'IP 验证超限必须在 Supabase 前返回 429');
    }
  }
  assertPrivateRateKeys(verifyIpRateFetch, ['otp-verify-ip', 'otp-verify-phone'], [verifyIp, ...verifyIpPhones]);

  const lifecycleFetch = createFetch();
  let mark = lifecycleFetch.calls.length;
  result = await invoke({
    method: 'POST',
    action: 'verify_otp',
    body: { phone: PHONE, token: OTP },
    env: enabledEnv,
    fetchStub: lifecycleFetch
  });
  assert.equal(result.res.statusCode, 200, '正确 OTP 必须建立服务端 Session');
  upstream = supabaseCalls(lifecycleFetch.calls.slice(mark));
  const verifyWrites = upstream.filter(({ method }) => method === 'POST');
  assert.equal(verifyWrites.length, 1, 'OTP 验证阶段只能有一次 Supabase 写请求');
  assert.equal(new URL(verifyWrites[0].url).pathname, '/auth/v1/verify', 'OTP 只能交给 Supabase /verify 校验');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(verifyWrites[0].body)), {
    phone: PHONE,
    token: OTP,
    type: 'sms'
  });
  const sid = assertSidCookie(result.res);
  assertNoSensitiveBody(payload(result.res));
  let sessionRecord = assertEncryptedKv(lifecycleFetch.kvStore, sid);
  assert.equal(sessionRecord.accessToken, ACCESS_TOKEN);
  assert.equal(sessionRecord.refreshToken, REFRESH_TOKEN);
  const initialSet = kvCommands(lifecycleFetch.calls.slice(mark))
    .find((command) => ['SET', 'SETEX'].includes(String(command?.[0]).toUpperCase()));
  assert(initialSet, '验证成功必须持久化 Session');
  assert.equal(initialSet[1], sessionKey(sid), 'KV key 不得暴露原始 SID');
  if (String(initialSet[0]).toUpperCase() === 'SET') {
    const exIndex = initialSet.findIndex((item) => String(item).toUpperCase() === 'EX');
    assert(exIndex >= 0, 'Session KV 写入必须设置 TTL');
    assert.equal(Number(initialSet[exIndex + 1]), COOKIE_MAX_AGE, '初始 Session KV TTL 必须为 7 天');
  } else {
    assert.equal(Number(initialSet[2]), COOKIE_MAX_AGE, '初始 Session KV TTL 必须为 7 天');
  }

  mark = lifecycleFetch.calls.length;
  result = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}` },
    env: enabledEnv,
    fetchStub: lifecycleFetch
  });
  assert.equal(result.res.statusCode, 200, '有效 opaque SID 必须可读取当前业务状态');
  const mePayload = payload(result.res);
  assert.equal(typeof mePayload.csrfToken, 'string', 'GET me 必须返回只保存在内存中的 CSRF token');
  assert(mePayload.csrfToken.length >= 32, 'CSRF token 必须具有足够随机性');
  assert.equal(JSON.stringify(mePayload).includes(MASKED_PHONE), true, 'me 只能返回脱敏手机号');
  assert.equal(JSON.stringify(mePayload).includes('pending'), true, 'me 必须返回当前业务状态');
  assert.equal(Object.prototype.hasOwnProperty.call(mePayload.me, 'wallet'), false,
    'pending 用户响应不得暴露钱包');
  assert.equal(Object.prototype.hasOwnProperty.call(mePayload.me, 'inviteCode'), false,
    'pending 用户响应不得暴露邀请码');
  assertNoSensitiveBody(mePayload);
  assert.equal(setCookie(result.res), '', '普通 me 不得重发或滑动 Session cookie');
  upstream = supabaseCalls(lifecycleFetch.calls.slice(mark));
  let refreshCalls = upstream.filter(({ url }) => new URL(url).pathname === '/auth/v1/token');
  assert.equal(refreshCalls.length, 0, 'access token 尚有 60 秒以上有效期时不得刷新');
  assert.equal(upstream.some(({ url }) => ['/rest/v1/credit_wallets', '/rest/v1/invite_codes']
    .includes(new URL(url).pathname)), false, 'pending 用户不得查询钱包或邀请码');
  sessionRecord = assertEncryptedKv(lifecycleFetch.kvStore, sid);

  const activeFetch = createFetch({ businessStatus: 'active' });
  let activeResult = await invoke({
    method: 'POST',
    action: 'verify_otp',
    body: { phone: PHONE, token: OTP },
    env: enabledEnv,
    fetchStub: activeFetch
  });
  const activeSid = assertSidCookie(activeResult.res);
  const activeMark = activeFetch.calls.length;
  activeResult = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(activeSid)}` },
    env: enabledEnv,
    fetchStub: activeFetch
  });
  assert.equal(activeResult.res.statusCode, 200, 'active 用户必须可读取真实工作台资产');
  const activeMe = payload(activeResult.res).me;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(activeMe.wallet)), { balance: 500 });
  assert.equal(activeMe.inviteCode, 'ADV-ABCDEFGH');
  const activeAssetPaths = supabaseCalls(activeFetch.calls.slice(activeMark))
    .map(({ url }) => new URL(url).pathname);
  assert.equal(activeAssetPaths.filter((value) => value === '/rest/v1/credit_wallets').length, 1,
    'active 用户只能读取一次 own wallet');
  assert.equal(activeAssetPaths.filter((value) => value === '/rest/v1/invite_codes').length, 1,
    'active 用户只能读取一次 own active invite code');

  sessionRecord.accessExpiresAt = Date.now() + 30000;
  replaceSession(lifecycleFetch.kvStore, sid, sessionRecord);
  const loaded = loadHandler(enabledEnv, lifecycleFetch);
  mark = lifecycleFetch.calls.length;
  const concurrentMe = await Promise.all([
    invoke({
      action: 'me',
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}` },
      fetchStub: lifecycleFetch,
      loaded
    }),
    invoke({
      action: 'me',
      headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}` },
      fetchStub: lifecycleFetch,
      loaded
    })
  ]);
  concurrentMe.forEach(({ res }) => {
    assert.equal(res.statusCode, 200, '并发 me 必须都成功读取轮换后的 Session');
    assert.equal(payload(res).csrfToken, mePayload.csrfToken, '并发刷新不得分叉 Session 记录');
    assert.equal(setCookie(res), '', 'access token 刷新不得重发 opaque SID cookie');
  });
  refreshCalls = supabaseCalls(lifecycleFetch.calls.slice(mark))
    .filter(({ url }) => new URL(url).pathname === '/auth/v1/token');
  assert.equal(refreshCalls.length, 1, '同一 SID 并发临期刷新必须全局单飞');
  assert.equal(new URL(refreshCalls[0].url).searchParams.get('grant_type'), 'refresh_token');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(refreshCalls[0].body)), { refresh_token: REFRESH_TOKEN });
  sessionRecord = assertEncryptedKv(lifecycleFetch.kvStore, sid);
  assert.equal(sessionRecord.accessToken, ROTATED_ACCESS_TOKEN);
  assert.equal(sessionRecord.refreshToken, ROTATED_REFRESH_TOKEN);

  const application = {
    displayName: '测试指导师',
    city: '上海',
    role: 'advisor',
    channelIdentity: '',
    practitionerType: 'education_family',
    inviteCode: '',
    acceptedRules: true
  };

  for (const action of ['submit_application', 'logout']) {
    mark = lifecycleFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action,
      body: action === 'submit_application' ? application : undefined,
      headers: {
        origin: `${ALLOWED_ORIGIN}.evil`,
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
        'x-csrf-token': mePayload.csrfToken
      },
      env: enabledEnv,
      fetchStub: lifecycleFetch
    });
    assert.equal(result.res.statusCode, 403, '已认证写请求必须精确匹配 Origin');
    assert.equal(lifecycleFetch.calls.length, mark, 'Origin 失败必须在 KV 读取和 Supabase 请求前拒绝');
  }

  for (const action of ['submit_application', 'logout']) {
    mark = lifecycleFetch.calls.length;
    result = await invoke({
      method: 'POST',
      action,
      body: action === 'submit_application' ? application : undefined,
      headers: {
        origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
        cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
        'x-csrf-token': 'WRONG_CSRF_TOKEN_NOT_REAL'
      },
      env: enabledEnv,
      fetchStub: lifecycleFetch
    });
    assert.equal(result.res.statusCode, 403, 'submit/logout 必须校验 Session 绑定的 X-CSRF-Token');
    assert.equal(supabaseCalls(lifecycleFetch.calls.slice(mark))
      .filter(({ method }) => !['GET', 'HEAD'].includes(method)).length, 0,
    'CSRF 失败不得刷新 Session 或执行业务写操作');
  }

  mark = lifecycleFetch.calls.length;
  result = await invoke({
    method: 'POST',
    action: 'submit_application',
    body: application,
    headers: {
      origin: ALLOWED_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
      'x-csrf-token': mePayload.csrfToken
    },
    env: enabledEnv,
    fetchStub: lifecycleFetch
  });
  assert.equal(result.res.statusCode, 200, '有效 Session、Origin 和 CSRF 必须可提交申请');
  let mutations = restMutations(lifecycleFetch.calls.slice(mark));
  assert.equal(mutations.length, 1, '申请流程只能有一次业务写请求');
  assert.equal(new URL(mutations[0].url).pathname, '/rest/v1/rpc/v3a_submit_pending_application',
    '申请只能调用 v3a_submit_pending_application 用户态 RPC');
  assert.equal(mutations[0].init.headers.Authorization, `Bearer ${ROTATED_ACCESS_TOKEN}`,
    '申请 RPC 必须使用当前用户 access token');
  const rpcBody = mutations[0].body;
  assert.deepStrictEqual(Object.keys(rpcBody).sort(), [
    'p_accepted_rules',
    'p_agreement_version',
    'p_application_identity',
    'p_city',
    'p_display_name',
    'p_invite_code',
    'p_practitioner_type',
    'p_requested_role'
  ]);
  assert.equal(rpcBody.p_application_identity, null,
    '未选择代理身份时 RPC 必须收到 null application identity');
  assert.equal(rpcBody.p_practitioner_type, 'education_family',
    '新增从业类型必须原样传给申请 RPC');
  for (const forbidden of ['phone', 'email', 'auth_user_id', 'status']) {
    assert.equal(forbidden in rpcBody, false, `申请 RPC 参数不得包含 ${forbidden}`);
  }
  assertNoSensitiveBody(payload(result.res));
  assertEncryptedKv(lifecycleFetch.kvStore, sid);

  mark = lifecycleFetch.calls.length;
  result = await invoke({
    method: 'POST',
    action: 'logout',
    headers: {
      origin: ALLOWED_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
      'x-csrf-token': mePayload.csrfToken
    },
    env: enabledEnv,
    fetchStub: lifecycleFetch
  });
  assert.equal(result.res.statusCode, 200, '退出必须成功');
  assertClearedCookie(result.res);
  assertNoSensitiveBody(payload(result.res));

  mark = lifecycleFetch.calls.length;
  result = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(sid)}` },
    env: enabledEnv,
    fetchStub: lifecycleFetch
  });
  assert.equal(result.res.statusCode, 401, '退出后旧 SID 必须立即失效');
  assert.equal(supabaseCalls(lifecycleFetch.calls.slice(mark)).length, 0,
    '退出后的旧 SID 不得再次刷新 Supabase Session');

  const expiryFetch = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'verify_otp',
    body: { phone: PHONE, token: OTP },
    env: enabledEnv,
    fetchStub: expiryFetch
  });
  const expirySid = assertSidCookie(result.res);
  const expiredRecord = decryptSession(expiryFetch.kvStore, expirySid);
  expiredRecord.createdAt = Date.now() - 1000;
  expiredRecord.absoluteExpiresAt = Date.now() - 1;
  replaceSession(expiryFetch.kvStore, expirySid, expiredRecord);
  mark = expiryFetch.calls.length;
  result = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(expirySid)}` },
    env: enabledEnv,
    fetchStub: expiryFetch
  });
  assert.equal(result.res.statusCode, 401, '超过 absoluteExpiresAt 的 Session 必须返回 401');
  assertClearedCookie(result.res);
  assert.equal(sessionEntries(expiryFetch.kvStore).length, 0, '绝对过期 Session 必须从 KV 删除');
  assert.equal(supabaseCalls(expiryFetch.calls.slice(mark)).length, 0,
    '绝对过期必须在访问 Supabase 前拒绝');

  const tamperFetch = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'verify_otp',
    body: { phone: PHONE, token: OTP },
    env: enabledEnv,
    fetchStub: tamperFetch
  });
  const tamperSid = assertSidCookie(result.res);
  const tampered = parseEnvelope(tamperFetch.kvStore, tamperSid);
  const ciphertext = Buffer.from(tampered.ciphertext, 'base64url');
  ciphertext[0] ^= 1;
  tampered.ciphertext = ciphertext.toString('base64url');
  tamperFetch.kvStore.set(sessionKey(tamperSid), JSON.stringify(tampered));
  mark = tamperFetch.calls.length;
  result = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(tamperSid)}` },
    env: enabledEnv,
    fetchStub: tamperFetch
  });
  assert.equal(result.res.statusCode, 401, 'AES-GCM 密文被篡改后必须返回 401');
  assertClearedCookie(result.res);
  assert.equal(supabaseCalls(tamperFetch.calls.slice(mark)).length, 0,
    '密文认证失败不得访问 Supabase');

  const aadFetch = createFetch();
  result = await invoke({
    method: 'POST',
    action: 'verify_otp',
    body: { phone: PHONE, token: OTP },
    env: enabledEnv,
    fetchStub: aadFetch
  });
  const sourceSid = assertSidCookie(result.res);
  const copiedSid = crypto.randomBytes(32).toString('base64url');
  aadFetch.kvStore.set(sessionKey(copiedSid), aadFetch.kvStore.get(sessionKey(sourceSid)));
  mark = aadFetch.calls.length;
  result = await invoke({
    action: 'me',
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(copiedSid)}` },
    env: enabledEnv,
    fetchStub: aadFetch
  });
  assert.equal(result.res.statusCode, 401, 'Session 密文复制到另一 SID key 后必须因 AAD 不匹配而失效');
  assertClearedCookie(result.res);
  assert.equal(supabaseCalls(aadFetch.calls.slice(mark)).length, 0,
    '跨 SID 搬移密文不得访问 Supabase');

  console.log('PASS: V3a opaque SID, AES-GCM KV, OTP dual rate limits, CSRF, refresh single-flight, Preview gate, and user-RPC contracts');
}

run().catch((error) => {
  console.error(`FAIL: V3a HttpOnly Session contract: ${error.message}`);
  process.exitCode = 1;
});
