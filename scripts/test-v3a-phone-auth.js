#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'static', 'v3a-auth.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const loginPage = fs.readFileSync(path.join(__dirname, '..', 'login.html'), 'utf8');
const registerPage = fs.readFileSync(path.join(__dirname, '..', 'advisor-register.html'), 'utf8');
const pendingPage = fs.readFileSync(path.join(__dirname, '..', 'advisor-pending.html'), 'utf8');
const verifiedPhone = '+8613800138000';
const previewRef = 'lmjriqncuopgxwyudfee';
const productionRef = 'tysbwijizgebnrazxpvo';

function completeRecords(status = 'pending', role) {
  const effectiveRole = role || (status === 'active' ? 'advisor' : 'pending');
  return {
    users: {
      id: '10000000-0000-4000-8000-000000000001',
      auth_user_id: '40000000-0000-4000-8000-000000000001',
      role: effectiveRole,
      status,
      phone: verifiedPhone,
      email: null,
      display_name: '测试指导师',
      city: '上海'
    },
    advisor_profiles: {
      id: '20000000-0000-4000-8000-000000000001',
      role: effectiveRole === 'super_admin' ? 'super_admin' : 'advisor',
      status,
      nickname: '测试指导师',
      city: '上海',
      practitioner_type: 'independent'
    },
    application_reviews: {
      id: '30000000-0000-4000-8000-000000000001',
      role: effectiveRole === 'super_admin' ? 'super_admin' : 'advisor',
      status: status === 'active' ? 'approved' : status,
      applied_city: '上海',
      applied_nickname: '测试指导师',
      practitioner_type: 'independent',
      invite_code: null
    }
  };
}

function authUser(overrides = {}) {
  return {
    id: '40000000-0000-4000-8000-000000000001',
    phone: verifiedPhone,
    phone_confirmed_at: '2026-07-15T00:00:00.000Z',
    confirmed_at: '2026-07-15T00:00:00.000Z',
    ...overrides
  };
}

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push({ key: String(key), value: String(value) });
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    }
  };
}

function createHarness(options = {}) {
  const page = options.page || 'login';
  const calls = {
    signInWithOtp: [],
    verifyOtp: [],
    rpc: [],
    from: [],
    inserts: 0
  };
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const message = { textContent: '', hidden: true };
  const location = {
    href: '',
    replace(value) {
      this.href = value;
    }
  };
  const sendButton = {
    disabled: false,
    _click: null,
    addEventListener(type, handler) {
      if (type === 'click') this._click = handler;
    }
  };
  const formData = page === 'register'
    ? {
        displayName: '测试指导师',
        city: '上海',
        role: 'advisor',
        practitionerType: 'independent',
        inviteCode: ''
      }
    : {
        phone: '13800138000',
        token: '123456',
        otp: '123456'
      };
  Object.assign(formData, options.formData || {});

  const form = {
    _data: formData,
    _submit: null,
    elements: {
      phone: { value: formData.phone || '' },
      token: { value: formData.token || '' },
      otp: { value: formData.otp || '' },
      acceptedRules: { checked: options.acceptedRules !== false }
    },
    querySelectorAll() {
      return [];
    },
    querySelector(selector) {
      const name = selector.match(/^\[name=['\"]?([^'\"\]]+)/)?.[1];
      return name ? this.elements[name] || null : null;
    },
    addEventListener(type, handler) {
      if (type === 'submit') this._submit = handler;
    }
  };

  let rpcCompleted = false;
  const requestedPhone = options.requestedPhone || verifiedPhone;
  const currentAuthUser = options.authUser || authUser();
  const otpUser = options.verifyUser || currentAuthUser;

  function currentRecords() {
    if (typeof options.records === 'function') return options.records({ rpcCompleted, calls });
    if (options.records) return options.records;
    if (page === 'register' && rpcCompleted) return completeRecords('pending');
    return {};
  }

  function query(table) {
    calls.from.push(table);
    return {
      select() { return this; },
      eq() { return this; },
      order() { return this; },
      limit() { return this; },
      insert() {
        calls.inserts += 1;
        throw new Error('direct table insert must not be called');
      },
      async maybeSingle() {
        const value = currentRecords()[table];
        if (value?.error) return { data: null, error: value.error };
        return { data: value || null, error: null };
      }
    };
  }

  const client = {
    auth: {
      async signInWithOtp(payload) {
        calls.signInWithOtp.push(payload);
        if (options.signInThrow) throw options.signInThrow;
        return { data: {}, error: options.signInError || null };
      },
      async verifyOtp(payload) {
        calls.verifyOtp.push(payload);
        if (options.verifyThrow) throw options.verifyThrow;
        return {
          data: options.verifyData || {
            user: otpUser,
            session: { access_token: 'TEST_TOKEN_NOT_REAL', user: otpUser }
          },
          error: options.verifyError || null
        };
      },
      async getUser() {
        if (options.getUserThrow) throw options.getUserThrow;
        return { data: { user: currentAuthUser }, error: options.getUserError || null };
      },
      async getSession() {
        return { data: { session: { user: currentAuthUser } }, error: null };
      },
      async signOut() {
        return { error: null };
      }
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      rpcCompleted = true;
      if (typeof options.rpc === 'function') return options.rpc(name, args);
      return options.rpc || { data: { success: true }, error: null };
    },
    from: query
  };

  const selectorMap = new Map([
    ['#v3a-phone-auth-form', page === 'login' ? form : null],
    ['#v3a-login-form', page === 'login' ? form : null],
    ['#v3a-register-form', page === 'register' ? form : null],
    ['#v3a-send-otp', page === 'login' ? sendButton : null],
    ['#v3a-send-otp-button', page === 'login' ? sendButton : null],
    ['#v3a-login-message', page === 'login' ? message : null],
    ['#v3a-register-message', page === 'register' ? message : null],
    ['#v3a-phone', page === 'login' ? form.elements.phone : null],
    ['#v3a-token', page === 'login' ? form.elements.token : null],
    ['#v3a-otp', page === 'login' ? form.elements.otp : null]
  ]);
  const document = {
    body: { dataset: { v3aAuthPage: page } },
    head: { appendChild() {} },
    querySelector(selector) {
      return selectorMap.get(selector) || null;
    },
    querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return {}; }
  };
  const window = {
    AIPIWEN_V3A_SUPABASE: options.supabaseConfig || {
      supabaseUrl: `https://${previewRef}.supabase.co`,
      projectRef: previewRef,
      supabaseAnonKey: 'TEST_ANON_KEY_NOT_REAL'
    },
    AIPIWEN_V3A_PHONE_OTP_ENABLED: options.phoneOtpEnabled === true,
    supabase: { createClient() { return client; } },
    location
  };

  const context = vm.createContext({
    window,
    document,
    localStorage,
    sessionStorage,
    FormData: class {
      constructor(target) { this.target = target; }
      get(name) { return this.target._data[name]; }
    },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    URL
  });

  vm.runInContext(source, context, { filename: 'static/v3a-auth.js' });
  form._data.phone = options.formData?.phone || form._data.phone || requestedPhone;

  return {
    calls,
    form,
    sendButton,
    message,
    location,
    localStorage,
    sessionStorage
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function clickSend(harness) {
  await flush();
  if (typeof harness.sendButton._click === 'function') {
    await harness.sendButton._click({ preventDefault() {} });
    await flush();
  }
}

async function submit(harness) {
  await flush();
  assert.equal(typeof harness.form._submit, 'function', '页面必须绑定表单提交处理');
  await harness.form._submit({ preventDefault() {} });
  await flush();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoSecretStorage(harness) {
  const serialized = JSON.stringify([
    ...harness.localStorage.writes,
    ...harness.sessionStorage.writes
  ]);
  assert.equal(serialized.includes('13800138000'), false, '不得把手机号写入浏览器存储');
  assert.equal(serialized.includes('123456'), false, '不得把短信验证码写入浏览器存储');
}

function assertNoRawDetail(message, fragments) {
  fragments.forEach((fragment) => {
    assert.equal(message.includes(fragment), false, `用户错误信息不得泄漏底层详情：${fragment}`);
  });
}

async function run() {
  assert.equal(loginPage.includes('id="v3a-phone-auth-form"'), true, '统一登录页必须包含手机号表单');
  assert.equal(loginPage.includes('name="phone"'), true, '统一登录页必须包含手机号字段');
  assert.equal(loginPage.includes('name="otp"'), true, '统一登录页必须包含验证码字段');
  assert.equal(loginPage.includes('preview-demo-auth') || loginPage.includes('模拟验证码'), false,
    '统一登录页不得包含模拟登录资产');
  assert.equal(/name="email"|name="password"/.test(registerPage), false,
    '申请资料页不得重新收集邮箱或密码');
  assert.equal(registerPage.includes('id="v3a-register-form"'), true, '申请资料页必须包含原子申请表单');
  assert.equal(pendingPage.includes('id="v3a-current-status"'), true, 'pending 页必须回读申请状态');
  assert.equal(source.includes('persistSession: false'), true, '本地集成阶段不得让 Supabase SDK 持久化 Session');
  assert.equal(source.includes(".select('id,role,status,phone,email"), false,
    '账号状态路由不得额外查询原始 phone/email');

  let harness = createHarness({ phoneOtpEnabled: false });
  await clickSend(harness);
  assert.equal(harness.calls.signInWithOtp.length, 0, '发送门禁关闭时绝不能调用 signInWithOtp');
  assertNoSecretStorage(harness);

  for (const supabaseConfig of [
    {
      supabaseUrl: `https://${productionRef}.supabase.co`,
      projectRef: productionRef,
      supabaseAnonKey: 'TEST_ANON_KEY_NOT_REAL'
    },
    {
      supabaseUrl: `https://${productionRef}.supabase.co`,
      projectRef: previewRef,
      supabaseAnonKey: 'TEST_ANON_KEY_NOT_REAL'
    }
  ]) {
    harness = createHarness({ phoneOtpEnabled: true, supabaseConfig });
    await clickSend(harness);
    assert.equal(harness.calls.signInWithOtp.length, 0,
      'Production 或 URL/ref 不一致必须在任何手机号 Auth 请求前停止');
  }

  for (const phone of ['13800138000', '8613800138000', '+8613800138000']) {
    harness = createHarness({ phoneOtpEnabled: true, formData: { phone } });
    await clickSend(harness);
    assert.equal(harness.calls.signInWithOtp.length, 1, `有效中国手机号必须可规范化：${phone}`);
    assert.deepStrictEqual(plain(harness.calls.signInWithOtp[0]), {
      phone: verifiedPhone,
      options: { shouldCreateUser: true }
    });
    assertNoSecretStorage(harness);
  }

  harness = createHarness({ phoneOtpEnabled: true, formData: { phone: '23800138000' } });
  await clickSend(harness);
  assert.equal(harness.calls.signInWithOtp.length, 0, '无效中国手机号不得触发短信发送');
  assertNoRawDetail(harness.message.textContent, ['auth.users', 'stack', 'schema']);

  harness = createHarness({ phoneOtpEnabled: true, records: {} });
  await submit(harness);
  assert.equal(harness.calls.verifyOtp.length, 1);
  assert.deepStrictEqual(plain(harness.calls.verifyOtp[0]), {
    phone: verifiedPhone,
    token: '123456',
    type: 'sms'
  });
  assert.equal(harness.location.href, '/advisor-register.html', '无业务记录必须进入申请资料页');
  assertNoSecretStorage(harness);

  harness = createHarness({
    phoneOtpEnabled: true,
    records: {},
    authUser: authUser({ phone: '+8613900139000' }),
    verifyUser: authUser({ phone: '+8613900139000' })
  });
  await submit(harness);
  assert.equal(harness.location.href, '', 'Auth user 手机号与本次验证手机号不一致时不得继续');
  assertNoRawDetail(harness.message.textContent, ['+8613900139000', 'auth.users', 'stack', 'schema']);

  harness = createHarness({
    phoneOtpEnabled: true,
    records: {},
    authUser: authUser({ phone_confirmed_at: null, confirmed_at: null }),
    verifyUser: authUser({ phone_confirmed_at: null, confirmed_at: null })
  });
  await submit(harness);
  assert.equal(harness.location.href, '', '手机号未确认的 Auth user 不得继续');

  for (const testCase of [
    { records: completeRecords('pending'), expected: '/advisor-pending.html' },
    { records: completeRecords('active', 'advisor'), expected: '/ai-interpreter-workbench.html' },
    { records: completeRecords('active', 'super_admin'), expected: '/admin-applications.html' }
  ]) {
    harness = createHarness({ phoneOtpEnabled: true, records: testCase.records });
    await submit(harness);
    assert.equal(harness.location.href, testCase.expected);
  }

  harness = createHarness({ page: 'register' });
  await submit(harness);
  assert.equal(harness.calls.rpc.length, 1, '注册资料必须且只能提交一次原子 RPC');
  assert.equal(harness.calls.inserts, 0, '注册资料不得直接 insert 业务表');
  assert.equal(harness.calls.rpc[0].name, 'v3a_submit_pending_application');
  assert.deepStrictEqual(
    Object.keys(harness.calls.rpc[0].args).sort(),
    [
      'p_accepted_rules',
      'p_agreement_version',
      'p_city',
      'p_display_name',
      'p_invite_code',
      'p_practitioner_type',
      'p_requested_role'
    ]
  );
  for (const forbidden of ['phone', 'email', 'auth_user_id', 'status']) {
    assert.equal(forbidden in harness.calls.rpc[0].args, false, `RPC 参数不得包含 ${forbidden}`);
  }
  assert.equal(harness.location.href, '/advisor-pending.html');
  assertNoSecretStorage(harness);

  harness = createHarness({
    phoneOtpEnabled: true,
    signInError: { code: 'provider_failure', message: 'auth.users internal provider detail' }
  });
  await clickSend(harness);
  assertNoRawDetail(harness.message.textContent, ['auth.users', 'internal provider detail']);

  harness = createHarness({
    phoneOtpEnabled: true,
    records: {},
    verifyError: { code: 'otp_expired', message: 'auth schema raw verification detail' }
  });
  await submit(harness);
  assert.equal(harness.location.href, '');
  assertNoRawDetail(harness.message.textContent, ['auth schema', 'raw verification detail']);

  harness = createHarness({
    page: 'register',
    records: {},
    rpc: async () => ({
      data: null,
      error: { code: 'XX000', message: 'public.users internal_constraint raw detail' }
    })
  });
  await submit(harness);
  assert.equal(harness.location.href, '');
  assertNoRawDetail(harness.message.textContent, ['public.users', 'internal_constraint', 'raw detail']);

  console.log('PASS: V3a phone auth and atomic registration contracts');
}

run().catch((error) => {
  console.error(`FAIL: V3a phone auth contract: ${error.message}`);
  process.exitCode = 1;
});
