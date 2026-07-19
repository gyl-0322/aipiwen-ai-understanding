const crypto = require('crypto');

const PREVIEW_PROJECT_REF = 'lmjriqncuopgxwyudfee';
const PRODUCTION_PROJECT_REF = 'tysbwijizgebnrazxpvo';
const COOKIE_NAME = '__Host-aipiwen_v3a_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_SKEW_MS = 60 * 1000;
const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalize(value) {
  return String(value || '').trim();
}

function parseEncryptionKey(value) {
  const encoded = String(value || '').trim();
  let key;
  try {
    key = Buffer.from(encoded, 'base64');
  } catch {
    key = null;
  }
  const canonical = key?.toString('base64').replace(/=+$/, '');
  if (!key || key.length !== 32 || canonical !== encoded.replace(/=+$/, '')) {
    throw new HttpError(503, '服务端会话密钥配置无效。', 'SESSION_KEY_INVALID');
  }
  return key;
}

function parseHttpsOrigin(value, code = 'SESSION_CONFIG_INVALID') {
  const raw = normalize(value);
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
  } catch {
    throw new HttpError(503, '手机号登录服务项目校验未通过。', code);
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.port ||
    url.pathname !== '/' || url.search || url.hash
  ) {
    throw new HttpError(503, '手机号登录服务项目校验未通过。', code);
  }
  return url.origin;
}

function previewDeploymentOrigin(vercelUrl) {
  const origin = parseHttpsOrigin(vercelUrl);
  if (!origin) return '';
  const hostname = new URL(origin).hostname;
  if (!hostname.endsWith('.vercel.app')) {
    throw new HttpError(503, '手机号登录服务项目校验未通过。', 'SESSION_CONFIG_INVALID');
  }
  return origin;
}

function parseAllowedOrigins(env) {
  const origins = [
    normalize(env.V3A_ALLOWED_ORIGIN),
    ...normalize(env.V3A_ALLOWED_ORIGINS).split(',').map(normalize),
    previewDeploymentOrigin(env.VERCEL_URL)
  ].filter(Boolean).map((value) => parseHttpsOrigin(value));
  return [...new Set(origins)];
}

function getConfig() {
  const supabaseUrl = normalize(
    process.env.V3A_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  ).replace(/\/+$/, '');
  const anonKey = normalize(
    process.env.V3A_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const projectRef = normalize(process.env.V3A_SUPABASE_PROJECT_REF);
  const vercelEnv = normalize(process.env.VERCEL_ENV);
  const vercelTargetEnv = normalize(process.env.VERCEL_TARGET_ENV);
  const allowedOrigins = parseAllowedOrigins(process.env);
  const kvUrl = normalize(process.env.KV_REST_API_URL).replace(/\/+$/, '');
  const kvToken = normalize(process.env.KV_REST_API_TOKEN);
  const phoneOtpEnabled = process.env.V3A_PHONE_OTP_ENABLED === 'true';
  if (!supabaseUrl || !anonKey || !projectRef || allowedOrigins.length === 0 || !kvUrl || !kvToken) {
    throw new HttpError(503, '手机号登录服务尚未完成 Preview 配置。', 'SESSION_SERVICE_NOT_CONFIGURED');
  }
  let parsedSupabase;
  let parsedKv;
  try {
    parsedSupabase = new URL(supabaseUrl);
    parsedKv = new URL(kvUrl);
  } catch {
    throw new HttpError(503, '手机号登录服务项目校验未通过。', 'SESSION_CONFIG_INVALID');
  }
  if (
    projectRef === PRODUCTION_PROJECT_REF || projectRef !== PREVIEW_PROJECT_REF ||
    vercelEnv !== 'preview' || vercelTargetEnv !== 'preview' ||
    parsedSupabase.protocol !== 'https:' || parsedSupabase.username || parsedSupabase.password || parsedSupabase.port ||
    parsedSupabase.hostname !== `${PREVIEW_PROJECT_REF}.supabase.co` ||
    parsedSupabase.origin !== supabaseUrl || parsedSupabase.pathname !== '/' || parsedSupabase.search || parsedSupabase.hash ||
    parsedKv.protocol !== 'https:' || !parsedKv.hostname || parsedKv.username || parsedKv.password || parsedKv.port ||
    parsedKv.origin !== kvUrl || parsedKv.pathname !== '/' || parsedKv.search || parsedKv.hash
  ) {
    throw new HttpError(503, '手机号登录服务项目校验未通过。', 'SESSION_CONFIG_INVALID');
  }
  return {
    supabaseUrl,
    anonKey,
    projectRef,
    allowedOrigin: allowedOrigins[0],
    allowedOrigins,
    kvUrl,
    kvToken,
    encryptionKey: parseEncryptionKey(process.env.V3A_SESSION_ENCRYPTION_KEY),
    phoneOtpEnabled
  };
}

function setPrivateHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie, Origin');
}

function requireSameOrigin(req, config) {
  const origin = normalize(req.headers?.origin || req.headers?.Origin);
  const fetchSite = normalize(req.headers?.['sec-fetch-site']).toLowerCase();
  if (!config.allowedOrigins.includes(origin) || (fetchSite && fetchSite !== 'same-origin')) {
    throw new HttpError(403, '请求来源校验未通过。', 'ORIGIN_NOT_ALLOWED');
  }
}

function requireJsonRequest(req) {
  const contentType = normalize(req.headers?.['content-type'] || req.headers?.['Content-Type']).toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, '请求格式无效。', 'JSON_REQUIRED');
  }
}

function readRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object' && !Array.isArray(req.body)) {
    if (JSON.stringify(req.body).length > 10000) {
      throw new HttpError(400, '请求内容无效。', 'INVALID_REQUEST_BODY');
    }
    return req.body;
  }
  if (typeof req.body !== 'string' || req.body.length > 10000) {
    throw new HttpError(400, '请求内容无效。', 'INVALID_REQUEST_BODY');
  }
  try {
    const body = JSON.parse(req.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch {
    throw new HttpError(400, '请求内容无效。', 'INVALID_REQUEST_BODY');
  }
}

function cookieHeader(sid, maxAge) {
  return `${COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

function setSessionCookie(res, sid, maxAge = SESSION_TTL_SECONDS) {
  if (!SID_PATTERN.test(sid)) throw new HttpError(500, '登录状态建立失败。', 'INVALID_SESSION_ID');
  res.setHeader('Set-Cookie', cookieHeader(sid, Math.max(1, Math.min(SESSION_TTL_SECONDS, Math.floor(maxAge)))));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', clearCookieHeader());
}

function readSessionId(req) {
  const raw = String(req.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== COOKIE_NAME) continue;
    try {
      const sid = decodeURIComponent(part.slice(index + 1).trim());
      return SID_PATTERN.test(sid) ? sid : null;
    } catch {
      return null;
    }
  }
  return null;
}

function sessionKey(sid) {
  const digest = crypto.createHash('sha256').update(sid).digest('hex');
  return `v3a:session:${digest}`;
}

function lockKey(sid) {
  return `${sessionKey(sid)}:refresh-lock`;
}

async function kvCommand(config, command) {
  let response;
  try {
    response = await fetch(config.kvUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });
  } catch {
    throw new HttpError(502, '服务端会话存储暂时不可用。', 'SESSION_STORE_UNAVAILABLE');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below without exposing storage details.
  }
  if (!response.ok || !payload || Object.prototype.hasOwnProperty.call(payload, 'error')) {
    throw new HttpError(502, '服务端会话存储暂时不可用。', 'SESSION_STORE_UNAVAILABLE');
  }
  return payload.result;
}

async function consumeRateLimit(config, scope, identifier, limit, windowSeconds) {
  const rateKey = crypto.createHmac('sha256', config.encryptionKey).update('aipiwen-v3a-rate-limit').digest();
  const digest = crypto
    .createHmac('sha256', rateKey)
    .update(`${scope}:${identifier}`)
    .digest('hex');
  const key = `v3a:rate:${scope}:${digest}`;
  const script = 'local n=redis.call("incr",KEYS[1]); if n==1 then redis.call("expire",KEYS[1],ARGV[1]) end; return n';
  const count = Number(await kvCommand(config, ['EVAL', script, '1', key, String(windowSeconds)]));
  if (!Number.isFinite(count)) {
    throw new HttpError(502, '安全校验服务暂时不可用。', 'RATE_LIMIT_UNAVAILABLE');
  }
  if (count > limit) throw new HttpError(429, '操作过于频繁，请稍后重试。', 'RATE_LIMITED');
}

function encryptRecord(config, sid, record) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  cipher.setAAD(Buffer.from(sessionKey(sid), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  });
}

function decryptRecord(config, sid, encrypted) {
  try {
    const envelope = JSON.parse(encrypted);
    if (envelope?.v !== 1 || !envelope.iv || !envelope.ciphertext || !envelope.tag) throw new Error('invalid');
    const iv = Buffer.from(envelope.iv, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('invalid');
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
    decipher.setAAD(Buffer.from(sessionKey(sid), 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return validateRecord(JSON.parse(plaintext));
  } catch {
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
}

function validateRecord(record) {
  if (
    !record || record.v !== 1 || !UUID_PATTERN.test(String(record.authUserId || '')) ||
    typeof record.accessToken !== 'string' || !record.accessToken || record.accessToken.length > 8192 ||
    typeof record.refreshToken !== 'string' || !record.refreshToken || record.refreshToken.length > 4096 ||
    typeof record.csrfToken !== 'string' || !SID_PATTERN.test(record.csrfToken) ||
    !Number.isFinite(record.accessExpiresAt) || !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.absoluteExpiresAt) || record.absoluteExpiresAt <= record.createdAt ||
    record.absoluteExpiresAt - record.createdAt > SESSION_TTL_SECONDS * 1000 + 1000
  ) {
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
  return record;
}

async function saveRecord(config, sid, record) {
  const remaining = Math.ceil((record.absoluteExpiresAt - Date.now()) / 1000);
  if (remaining <= 0) throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  const result = await kvCommand(config, ['SET', sessionKey(sid), encryptRecord(config, sid, record), 'EX', Math.min(remaining, SESSION_TTL_SECONDS)]);
  if (result !== 'OK') throw new HttpError(502, '服务端会话存储暂时不可用。', 'SESSION_STORE_UNAVAILABLE');
  return Math.min(remaining, SESSION_TTL_SECONDS);
}

async function loadRecord(config, sid) {
  const encrypted = await kvCommand(config, ['GET', sessionKey(sid)]);
  if (typeof encrypted !== 'string' || !encrypted) {
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
  let record;
  try {
    record = decryptRecord(config, sid, encrypted);
  } catch (error) {
    await kvCommand(config, ['DEL', sessionKey(sid)]).catch(() => null);
    throw error;
  }
  if (record.absoluteExpiresAt <= Date.now()) {
    await kvCommand(config, ['DEL', sessionKey(sid)]).catch(() => null);
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
  return record;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function authRequest(config, path, body, accessToken) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, '手机号登录服务暂时不可用。', 'AUTH_UPSTREAM_UNAVAILABLE');
  }
  return { response, payload: await readJson(response) };
}

function accessExpiry(payload) {
  const expiresAt = Number(payload?.expires_at) * 1000;
  const expiresIn = Number(payload?.expires_in) * 1000;
  const value = Number.isFinite(expiresAt) && expiresAt > Date.now()
    ? expiresAt
    : Date.now() + expiresIn;
  if (!Number.isFinite(value) || value <= Date.now() || value > Date.now() + SESSION_TTL_SECONDS * 1000) {
    throw new HttpError(502, '登录状态建立失败。', 'INVALID_SESSION');
  }
  return value;
}

function validateAuthPayload(payload, expectedUserId) {
  const accessToken = String(payload?.access_token || '');
  const refreshToken = String(payload?.refresh_token || '');
  const authUserId = String(payload?.user?.id || expectedUserId || '');
  if (
    !accessToken || accessToken.length > 8192 || !refreshToken || refreshToken.length > 4096 ||
    !UUID_PATTERN.test(authUserId) || (expectedUserId && authUserId !== expectedUserId)
  ) {
    throw new HttpError(502, '登录状态建立失败。', 'INVALID_SESSION');
  }
  return { accessToken, refreshToken, authUserId, accessExpiresAt: accessExpiry(payload) };
}

async function verifyCurrentUser(config, accessToken, expectedUserId) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
  } catch {
    throw new HttpError(502, '登录状态验证服务暂时不可用。', 'AUTH_UPSTREAM_UNAVAILABLE');
  }
  const user = await readJson(response);
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
  if (!response.ok) throw new HttpError(502, '登录状态验证服务暂时不可用。', 'AUTH_UPSTREAM_ERROR');
  if (!user?.id || user.id !== expectedUserId || !user.phone || !user.phone_confirmed_at) {
    throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  }
  return user;
}

async function refreshRecord(config, record) {
  const { response, payload } = await authRequest(
    config,
    '/token?grant_type=refresh_token',
    { refresh_token: record.refreshToken }
  );
  if (!response.ok) throw new HttpError(401, '登录状态已失效，请重新登录。', 'UNAUTHENTICATED');
  const refreshed = validateAuthPayload(payload, record.authUserId);
  const user = await verifyCurrentUser(config, refreshed.accessToken, record.authUserId);
  return { record: { ...record, ...refreshed }, user };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshWithLock(config, sid, originalRecord, forceRefresh = false) {
  const token = crypto.randomBytes(16).toString('base64url');
  const key = lockKey(sid);
  const acquired = await kvCommand(config, ['SET', key, token, 'NX', 'EX', 10]);
  if (acquired !== 'OK') {
    for (const delay of [40, 80, 160, 240]) {
      await wait(delay);
      const current = await loadRecord(config, sid);
      if (current.accessExpiresAt > originalRecord.accessExpiresAt) {
        const user = await verifyCurrentUser(config, current.accessToken, current.authUserId);
        return { record: current, user };
      }
    }
    throw new HttpError(503, '登录状态正在更新，请稍后重试。', 'SESSION_REFRESH_BUSY');
  }
  try {
    const current = await loadRecord(config, sid);
    if (!forceRefresh && current.accessExpiresAt > Date.now() + REFRESH_SKEW_MS) {
      const user = await verifyCurrentUser(config, current.accessToken, current.authUserId);
      return { record: current, user };
    }
    const refreshed = await refreshRecord(config, current);
    await saveRecord(config, sid, refreshed.record);
    return refreshed;
  } finally {
    const releaseScript = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
    await kvCommand(config, ['EVAL', releaseScript, '1', key, token]).catch(() => null);
  }
}

async function createSession(config, res, authPayload) {
  const auth = validateAuthPayload(authPayload);
  const user = await verifyCurrentUser(config, auth.accessToken, auth.authUserId);
  const now = Date.now();
  const sid = crypto.randomBytes(32).toString('base64url');
  const record = {
    v: 1,
    authUserId: auth.authUserId,
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accessExpiresAt: auth.accessExpiresAt,
    csrfToken: crypto.randomBytes(32).toString('base64url'),
    createdAt: now,
    absoluteExpiresAt: now + SESSION_TTL_SECONDS * 1000
  };
  await saveRecord(config, sid, record);
  setSessionCookie(res, sid);
  return { sid, record, user, csrfToken: record.csrfToken };
}

async function loadSession(req, config) {
  const sid = readSessionId(req);
  if (!sid) throw new HttpError(401, '请先登录。', 'UNAUTHENTICATED');
  const record = await loadRecord(config, sid);
  return { sid, record, csrfToken: record.csrfToken };
}

async function resolveSession(config, loaded) {
  const sid = loaded.sid;
  let record = loaded.record;
  let user;
  let attemptedRefresh = false;
  try {
    if (record.accessExpiresAt <= Date.now() + REFRESH_SKEW_MS) {
      attemptedRefresh = true;
      ({ record, user } = await refreshWithLock(config, sid, record));
    } else {
      user = await verifyCurrentUser(config, record.accessToken, record.authUserId);
    }
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode !== 401) throw error;
    if (attemptedRefresh) {
      await destroySession(config, sid);
      throw error;
    }
    try {
      ({ record, user } = await refreshWithLock(config, sid, record, true));
    } catch (refreshError) {
      if (refreshError instanceof HttpError && refreshError.statusCode === 401) {
        await destroySession(config, sid);
      }
      throw refreshError;
    }
  }
  return { sid, record, user, csrfToken: record.csrfToken };
}

async function getSession(req, _res, config) {
  return resolveSession(config, await loadSession(req, config));
}

function requireCsrf(req, session) {
  const supplied = normalize(req.headers?.['x-csrf-token']);
  const expected = String(session?.csrfToken || '');
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    !supplied || suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new HttpError(403, '请求校验未通过，请刷新页面后重试。', 'CSRF_INVALID');
  }
}

async function destroySession(config, sid) {
  if (SID_PATTERN.test(String(sid || ''))) {
    await kvCommand(config, ['DEL', sessionKey(sid)]);
  }
}

module.exports = {
  COOKIE_NAME,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  SESSION_TTL_SECONDS,
  HttpError,
  getConfig,
  setPrivateHeaders,
  requireSameOrigin,
  requireJsonRequest,
  readRequestBody,
  readSessionId,
  clearSessionCookie,
  authRequest,
  consumeRateLimit,
  readJson,
  createSession,
  loadSession,
  resolveSession,
  getSession,
  requireCsrf,
  destroySession
};
