#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  PREVIEW_URL,
  normalizeChinaPhone,
  bindFirstAdminPhone
} = require('./v3a-bind-first-admin-phone');

const AUTH_USER_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '40000000-0000-4000-8000-000000000002';
const PUBLIC_USER_ID = '50000000-0000-4000-8000-000000000001';
const ANON_KEY = 'TEST_PREVIEW_ANON_KEY_NOT_REAL';
const ACCESS_TOKEN = 'TEST_EMAIL_ACCESS_TOKEN_NOT_REAL';
const VERIFIED_ACCESS_TOKEN = 'TEST_PHONE_CHANGE_ACCESS_TOKEN_NOT_REAL';
const EMAIL = 'admin@example.test';
const PASSWORD = 'TEST_PASSWORD_NOT_REAL';
const PHONE = '+8613800138000';
const OTP = '123456';

function response(status, payload) {
  return { status, ok: status >= 200 && status < 300, async json() { return payload; } };
}

function createFetch(options = {}) {
  const calls = [];
  let publicPhone = options.publicPhone || null;
  const fetchStub = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    assert.equal(url.origin, PREVIEW_URL, '工具只能连接固定 Preview URL');
    assert.equal(init.headers.apikey, ANON_KEY);

    if (url.pathname === '/auth/v1/token') {
      if (options.signInFailure) return response(400, { message: `raw ${PASSWORD}` });
      return response(200, {
        access_token: ACCESS_TOKEN,
        user: {
          id: AUTH_USER_ID,
          email: options.authEmail || EMAIL,
          email_confirmed_at: '2026-07-15T00:00:00.000Z',
          phone: options.existingPhone || null,
          phone_confirmed_at: options.existingPhone && !options.unconfirmedExistingPhone
            ? '2026-07-15T00:00:00.000Z'
            : null,
          phone_change: options.phoneChange || ''
        }
      });
    }
    if (url.pathname === '/rest/v1/users') {
      return response(200, [{
        id: PUBLIC_USER_ID,
        auth_user_id: AUTH_USER_ID,
        email: options.publicEmail || EMAIL,
        role: options.role || 'super_admin',
        status: options.status || 'active',
        phone: publicPhone
      }]);
    }
    if (url.pathname === '/rest/v1/admin_audit_logs') {
      if (options.auditMissing) return response(200, []);
      return response(200, [{
        id: '60000000-0000-4000-8000-000000000001',
        admin_id: PUBLIC_USER_ID,
        target_id: PUBLIC_USER_ID,
        details: { auth_user_id: options.auditAuthUserId || AUTH_USER_ID }
      }]);
    }
    if (url.pathname === '/auth/v1/user') {
      return response(200, { id: options.updateUserId || AUTH_USER_ID, phone_change: PHONE });
    }
    if (url.pathname === '/auth/v1/verify') {
      return response(200, {
        access_token: VERIFIED_ACCESS_TOKEN,
        user: {
          id: options.verifyUserId || AUTH_USER_ID,
          phone: options.verifyPhone || PHONE,
          phone_confirmed_at: '2026-07-15T00:01:00.000Z'
        }
      });
    }
    if (url.pathname === '/rest/v1/rpc/v3a_sync_own_first_super_admin_phone') {
      if (options.syncFailure) return response(409, { message: `raw ${ACCESS_TOKEN}` });
      publicPhone = PHONE;
      return response(200, { success: true, already_synced: false });
    }
    if (url.pathname === '/auth/v1/logout') return response(204, null);
    throw new Error(`Unexpected path ${url.pathname}`);
  };
  fetchStub.calls = calls;
  return fetchStub;
}

async function expectBlocked(options, expectedMessage) {
  try {
    await bindFirstAdminPhone(options);
    assert.fail('应当停止但实际成功');
  } catch (error) {
    assert.equal(error.message, expectedMessage);
    assert.equal(error.message.includes(PASSWORD), false, '错误不得泄漏密码');
    assert.equal(error.message.includes(ACCESS_TOKEN), false, '错误不得泄漏 token');
  }
}

async function run() {
  assert.equal(PREVIEW_PROJECT_REF, 'lmjriqncuopgxwyudfee');
  assert.equal(PRODUCTION_PROJECT_REF, 'tysbwijizgebnrazxpvo');
  assert.notEqual(PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF);
  assert.equal(normalizeChinaPhone('138 0013 8000'), PHONE);
  assert.equal(normalizeChinaPhone('8613800138000'), PHONE);

  let fetchStub = createFetch();
  const gates = [];
  const result = await bindFirstAdminPhone({
    fetchImpl: fetchStub,
    anonKey: ANON_KEY,
    email: EMAIL,
    password: PASSWORD,
    phone: PHONE,
    beforePhoneChange: async ({ authUserId }) => { gates.push(`before:${authUserId}`); return true; },
    afterPhoneChange: async ({ authUserId }) => { gates.push(`after:${authUserId}`); return true; },
    getOtp: async () => { gates.push('otp'); return OTP; }
  });
  assert.deepStrictEqual(result, {
    alreadyBound: false,
    publicPhoneSynced: true,
    phoneMasked: '+86 138****8000'
  });
  assert.deepStrictEqual(gates, [`before:${AUTH_USER_ID}`, `after:${AUTH_USER_ID}`, 'otp'],
    '必须先完成两次只读预检，再读取短信验证码');
  assert.deepStrictEqual(fetchStub.calls.map((call) => `${call.init.method}:${call.url.pathname}`), [
    'POST:/auth/v1/token',
    'GET:/rest/v1/users',
    'GET:/rest/v1/admin_audit_logs',
    'PUT:/auth/v1/user',
    'POST:/auth/v1/verify',
    'POST:/rest/v1/rpc/v3a_sync_own_first_super_admin_phone',
    'GET:/rest/v1/users',
    'POST:/auth/v1/logout'
  ]);
  const update = fetchStub.calls.find((call) => call.url.pathname === '/auth/v1/user');
  const verify = fetchStub.calls.find((call) => call.url.pathname === '/auth/v1/verify');
  assert.deepStrictEqual(update.body, { phone: PHONE, channel: 'sms' });
  assert.deepStrictEqual(verify.body, { phone: PHONE, token: OTP, type: 'phone_change' });
  assert.equal(update.init.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  const sync = fetchStub.calls.find((call) => call.url.pathname === '/rest/v1/rpc/v3a_sync_own_first_super_admin_phone');
  assert.deepStrictEqual(sync.body, {}, '同步 RPC 不得接收手机号或 UUID 参数');
  assert.equal(sync.init.headers.Authorization, `Bearer ${VERIFIED_ACCESS_TOKEN}`,
    '业务身份同步必须使用 phone_change 成功后签发的新身份');
  assert.equal(fetchStub.calls.some((call) => call.url.origin.includes(PRODUCTION_PROJECT_REF)), false,
    '任何请求都不得连接 Production');

  fetchStub = createFetch({ existingPhone: PHONE });
  const alreadyBound = await bindFirstAdminPhone({
    fetchImpl: fetchStub,
    anonKey: ANON_KEY,
    email: EMAIL,
    password: PASSWORD,
    phone: PHONE,
    otp: OTP,
    beforePhoneChange: async () => { throw new Error('已绑定时不应触发预检'); },
    afterPhoneChange: async () => { throw new Error('已绑定时不应触发预检'); }
  });
  assert.equal(alreadyBound.alreadyBound, true);
  assert.equal(alreadyBound.publicPhoneSynced, true);
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    '已绑定同号时不得重复发送短信或换绑');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/rest/v1/rpc/v3a_sync_own_first_super_admin_phone'), true,
    '已绑定同号时仍必须核对并同步 public.users.phone');

  fetchStub = createFetch({ phoneChange: PHONE });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '该账号已有未完成的手机号换绑记录，已停止；请先人工核查，不要自动清理。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    '遗留 phone_change 必须在写操作前停止');

  fetchStub = createFetch({ publicPhone: '+8613900139000' });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '业务身份已经存在手机号，已停止；请先人工核查。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    '业务身份已有手机号时必须在 Auth 写操作前停止');

  fetchStub = createFetch({ publicEmail: 'other@example.test' });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '当前邮箱账号不是唯一的 active super_admin，已停止。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    '业务身份邮箱不一致时必须在 Auth 写操作前停止');

  fetchStub = createFetch({ auditMissing: true });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '首位总部管理员审计标记不完整，已停止。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    'FIRST_SUPER_ADMIN 审计缺失时必须在 Auth 写操作前停止');

  fetchStub = createFetch({ existingPhone: PHONE, unconfirmedExistingPhone: true });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '该账号存在未确认的 Auth 手机号状态，已停止；请先人工核查。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    'Auth 未确认手机号状态必须在写操作前停止');

  fetchStub = createFetch({ role: 'advisor' });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '当前邮箱账号不是唯一的 active super_admin，已停止。');

  fetchStub = createFetch({ verifyUserId: OTHER_USER_ID });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '换绑结果未能证明是同一 Auth UUID，已停止；请立即人工核查。');

  fetchStub = createFetch();
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => false, afterPhoneChange: async () => true
  }, '发码前只读预检未确认，已停止。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/user'), false,
    '预检 A 拒绝时不得发送短信');

  fetchStub = createFetch({ updateUserId: OTHER_USER_ID });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '发码后的 Auth UUID 不一致，已停止。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/verify'), false,
    '发码返回错误 UUID 时不得提交验证码');

  fetchStub = createFetch();
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => false
  }, '验证码提交前只读预检未确认，已停止；远端可能保留待确认手机号，不要自动重试或清理。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname === '/auth/v1/verify'), false,
    '预检 B 拒绝时不得提交验证码');

  fetchStub = createFetch({ verifyPhone: '+8613900139000' });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '换绑结果未能证明是同一 Auth UUID，已停止；请立即人工核查。');
  assert.equal(fetchStub.calls.some((call) => call.url.pathname.includes('v3a_sync_own')), false,
    '验证返回错误手机号时不得同步 public.users');

  fetchStub = createFetch({ syncFailure: true });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, 'Auth 手机号已验证，但业务身份同步失败，已停止；不要创建第二个账号。');

  fetchStub = createFetch({ signInFailure: true });
  await expectBlocked({
    fetchImpl: fetchStub, anonKey: ANON_KEY, email: EMAIL, password: PASSWORD, phone: PHONE, otp: OTP,
    beforePhoneChange: async () => true, afterPhoneChange: async () => true
  }, '现有邮箱账号认证失败，已停止。');

  console.log('PASS: first super_admin phone binding stays on Preview, preserves UUID, and gates both prechecks');
}

run().catch((error) => {
  console.error(`FAIL: first super_admin phone binding: ${error.message}`);
  process.exitCode = 1;
});
