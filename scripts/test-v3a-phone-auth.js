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
const workbenchPage = fs.readFileSync(path.join(__dirname, '..', 'ai-interpreter-workbench.html'), 'utf8');

const APP_ORIGIN = 'https://preview.aipiwen.cn';
const SESSION_PATH = '/api/v3a-session';
const VERIFIED_PHONE = '+8613800138000';
const MASKED_PHONE = '+86 138****8000';
const OTP = '123456';
const CSRF_TOKEN = 'TEST_V3A_CSRF_TOKEN_ONLY_NOT_REAL_1234567890';

function emptyMe() {
  return { phoneMasked: MASKED_PHONE, user: null, profile: null, applicationReview: null };
}

function completeMe(status = 'pending', role) {
  const effectiveRole = role || (status === 'active' ? 'advisor' : 'pending');
  const me = {
    phoneMasked: MASKED_PHONE,
    user: {
      role: effectiveRole,
      status,
      displayName: '测试指导师',
      city: '上海',
      createdAt: '2026-07-15T00:00:00.000Z',
      lastLoginAt: null
    },
    profile: {
      role: effectiveRole === 'super_admin' ? 'super_admin' : 'advisor',
      status,
      nickname: '测试指导师',
      city: '上海',
      practitionerType: 'independent',
      createdAt: '2026-07-15T00:00:00.000Z'
    },
    applicationReview: {
      role: effectiveRole === 'super_admin' ? 'super_admin' : 'advisor',
      status: status === 'active' ? 'approved' : status,
      appliedCity: '上海',
      appliedNickname: '测试指导师',
      practitionerType: 'independent',
      reviewNote: '总部审核后更新',
      createdAt: '2026-07-15T00:00:00.000Z',
      reviewedAt: null
    }
  };
  if (status === 'active' && ['advisor', 'agent', 'center'].includes(effectiveRole)) {
    me.wallet = { balance: 500 };
    me.inviteCode = 'ADV-ABCDEFGH';
  }
  return me;
}

function webResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

function createStorage() {
  const accesses = [];
  return {
    accesses,
    getItem(key) {
      accesses.push({ operation: 'get', key: String(key) });
      return null;
    },
    setItem(key, value) {
      accesses.push({ operation: 'set', key: String(key), value: String(value) });
    },
    removeItem(key) {
      accesses.push({ operation: 'remove', key: String(key) });
    }
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    contains(value) { return values.has(value); },
    toggle(value, force) {
      const enabled = force === undefined ? !values.has(value) : Boolean(force);
      if (enabled) values.add(value);
      else values.delete(value);
      return enabled;
    }
  };
}

function createHarness(options = {}) {
  const page = options.page || 'login';
  const calls = [];
  const intervals = new Map();
  let nextIntervalId = 1;
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const cookieAccesses = [];
  const message = { textContent: '', hidden: true };
  const texts = {
    phoneLoginStatus: { textContent: '', className: '' },
    phoneLoginHeading: { textContent: '' },
    phoneLoginDescription: { textContent: '' },
    verifiedPhone: { textContent: '' },
    currentRole: { textContent: '' },
    currentStatus: { textContent: '' },
    submittedAt: { textContent: '' },
    reviewNote: { textContent: '' },
    workbenchName: { textContent: '' },
    workbenchCity: { textContent: '' },
    workbenchStatus: { textContent: '' },
    workbenchRole: { textContent: '' },
    workbenchBalance: { textContent: '' },
    workbenchInviteCode: { textContent: '' }
  };
  const location = { href: '', replace(value) { this.href = value; } };
  const sendButton = {
    disabled: false,
    textContent: '获取验证码',
    _click: null,
    addEventListener(type, handler) {
      if (type === 'click') this._click = handler;
    }
  };
  const loginButton = {
    disabled: false,
    textContent: '登录'
  };
  const logoutButton = {
    _click: null,
    addEventListener(type, handler) {
      if (type === 'click') this._click = handler;
    }
  };
  const formData = page === 'register'
    ? {
        displayName: '测试指导师',
        city: '上海',
        channelIdentity: '',
        practitionerType: 'independent',
        inviteCode: ''
      }
    : { phone: '13800138000', token: OTP, otp: OTP };
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
    querySelector(selector) {
      if (selector === 'button[type="submit"]') return loginButton;
      return null;
    },
    querySelectorAll() { return [sendButton, loginButton]; },
    addEventListener(type, handler) {
      if (type === 'submit') this._submit = handler;
    }
  };
  const nav = {
    id: '',
    _click: null,
    addEventListener(type, handler) { if (type === 'click') this._click = handler; }
  };
  const sidebar = page === 'workbench' ? {
    classList: createClassList(),
    toggle: null,
    querySelector(selector) {
      if (selector === '.nav') return nav;
      if (selector === '.mobile-nav-toggle') return this.toggle;
      return null;
    },
    insertBefore(node) { this.toggle = node; }
  } : null;

  function defaultPayload(action) {
    if (action === 'capabilities') {
      return { status: 200, body: { ok: true, phoneOtpEnabled: options.phoneOtpEnabled !== false } };
    }
    if (action === 'me') {
      if (Object.prototype.hasOwnProperty.call(options, 'me')) {
        return { status: 200, body: { ok: true, me: options.me, csrfToken: CSRF_TOKEN } };
      }
      if (page === 'login') {
        return { status: 401, body: { ok: false, error: '请先登录。', code: 'UNAUTHENTICATED' } };
      }
      const me = page === 'register'
        ? emptyMe()
        : page === 'workbench'
          ? completeMe('active', 'advisor')
          : completeMe();
      return { status: 200, body: { ok: true, me, csrfToken: CSRF_TOKEN } };
    }
    if (action === 'request_otp') return { status: 200, body: { ok: true } };
    if (action === 'verify_otp') {
      return { status: 200, body: { ok: true, me: options.verifyMe || emptyMe(), csrfToken: CSRF_TOKEN } };
    }
    if (action === 'submit_application') {
      return { status: 200, body: { ok: true, me: options.submitMe || completeMe(), csrfToken: CSRF_TOKEN } };
    }
    if (action === 'logout') return { status: 200, body: { ok: true } };
    return { status: 400, body: { ok: false, error: '不支持的 action。', code: 'INVALID_ACTION' } };
  }

  async function fetchStub(input, init = {}) {
    const url = new URL(String(input), APP_ORIGIN);
    const action = url.searchParams.get('action') || '';
    let body;
    try { body = init.body === undefined ? undefined : JSON.parse(init.body); } catch { body = init.body; }
    calls.push({ input: String(input), url, action, method: init.method || 'GET', init, body });
    const failure = options.failures?.[action];
    if (failure instanceof Error) throw failure;
    if (failure) return webResponse(failure.status, failure.body);
    const result = defaultPayload(action);
    return webResponse(result.status, result.body);
  }

  const selectorMap = new Map([
    ['#v3a-phone-auth-form', page === 'login' ? form : null],
    ['#v3a-login-form', page === 'login' ? form : null],
    ['#v3a-register-form', page === 'register' ? form : null],
    ['#v3a-send-otp', page === 'login' ? sendButton : null],
    ['#v3a-send-otp-button', page === 'login' ? sendButton : null],
    ['#v3a-logout-button', page === 'pending' ? logoutButton : null],
    ['#v3a-workbench-logout', page === 'workbench' ? logoutButton : null],
    ['#v3a-login-message', page === 'login' ? message : null],
    ['#v3a-phone-login-status', page === 'login' ? texts.phoneLoginStatus : null],
    ['#v3a-phone-login-heading', page === 'login' ? texts.phoneLoginHeading : null],
    ['#v3a-phone-login-description', page === 'login' ? texts.phoneLoginDescription : null],
    ['#v3a-register-message', page === 'register' ? message : null],
    ['#v3a-pending-message', page === 'pending' ? message : null],
    ['#v3a-workbench-message', page === 'workbench' ? message : null],
    ['#v3a-verified-phone', page === 'register' ? texts.verifiedPhone : null],
    ['#v3a-current-role', page === 'pending' ? texts.currentRole : null],
    ['#v3a-current-status', page === 'pending' ? texts.currentStatus : null],
    ['#v3a-submitted-at', page === 'pending' ? texts.submittedAt : null],
    ['#v3a-review-note', page === 'pending' ? texts.reviewNote : null],
    ['#v3a-workbench-name', page === 'workbench' ? texts.workbenchName : null],
    ['#v3a-workbench-city', page === 'workbench' ? texts.workbenchCity : null],
    ['#v3a-workbench-status', page === 'workbench' ? texts.workbenchStatus : null],
    ['#v3a-workbench-role', page === 'workbench' ? texts.workbenchRole : null],
    ['#v3a-workbench-balance', page === 'workbench' ? texts.workbenchBalance : null],
    ['#v3a-workbench-invite-code', page === 'workbench' ? texts.workbenchInviteCode : null],
    ['.sidebar', sidebar]
  ]);
  const document = {
    body: { dataset: { v3aAuthPage: page }, hidden: page === 'workbench' },
    querySelector(selector) { return selectorMap.get(selector) || null; },
    createElement() {
      return {
        className: '',
        type: '',
        innerHTML: '',
        attributes: {},
        _click: null,
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener(type, handler) { if (type === 'click') this._click = handler; },
        focus() {}
      };
    },
    addEventListener() {}
  };
  Object.defineProperty(document, 'cookie', {
    get() { cookieAccesses.push({ operation: 'get' }); return ''; },
    set(value) { cookieAccesses.push({ operation: 'set', value: String(value) }); }
  });
  const window = { location };
  for (const forbidden of ['supabase', 'AIPIWEN_V3A_SUPABASE', 'AIPIWEN_V3A_PHONE_OTP_ENABLED']) {
    Object.defineProperty(window, forbidden, {
      get() { throw new Error(`浏览器脚本不得读取 ${forbidden}`); }
    });
  }
  const context = vm.createContext({
    window,
    document,
    fetch: fetchStub,
    localStorage,
    sessionStorage,
    FormData: class {
      constructor(target) { this.target = target; }
      get(name) {
        if (this.target.elements?.[name] && 'value' in this.target.elements[name]) {
          return this.target.elements[name].value;
        }
        return this.target._data[name];
      }
    },
    URL,
    URLSearchParams,
    Date,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearInterval(id) { intervals.delete(id); }
  });
  vm.runInContext(source, context, { filename: sourcePath });
  return {
    calls,
    form,
    sendButton,
    loginButton,
    logoutButton,
    message,
    texts,
    location,
    localStorage,
    sessionStorage,
    cookieAccesses,
    body: document.body,
    sidebar,
    tickIntervals(seconds = 1) {
      for (let second = 0; second < seconds; second += 1) {
        [...intervals.values()].forEach(({ callback }) => callback());
      }
    }
  };
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function clickSend(harness) {
  await settle();
  if (typeof harness.sendButton._click === 'function') {
    await harness.sendButton._click({ preventDefault() {} });
    await settle();
  }
}

async function submit(harness) {
  await settle();
  assert.equal(typeof harness.form._submit, 'function', '页面必须绑定表单提交处理');
  await harness.form._submit({ preventDefault() {} });
  await settle();
}

async function clickLogout(harness) {
  await settle();
  assert.equal(typeof harness.logoutButton._click, 'function', '受保护页面必须绑定退出处理');
  await harness.logoutButton._click({ preventDefault() {} });
  await settle();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function actionCalls(harness, action) {
  return harness.calls.filter((call) => call.action === action);
}

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function assertBffCall(call, expected = {}) {
  assert(call, `缺少 BFF 请求 ${expected.action || ''}`);
  assert.equal(call.url.origin, APP_ORIGIN, '浏览器身份请求必须同源');
  assert.equal(call.url.pathname, SESSION_PATH, '浏览器只能调用 /api/v3a-session');
  assert.equal(call.input.startsWith(`${SESSION_PATH}?`), true, '浏览器不得拼接 Supabase 或外部 URL');
  assert.equal(call.action, expected.action);
  assert.equal(call.method, expected.method || 'GET');
  assert.equal(call.init.credentials, 'same-origin', '所有身份请求必须携带同源 HttpOnly cookie');
  assert.equal(headerValue(call.init.headers, 'Authorization'), undefined, '浏览器不得持有或发送 access token');
  assert.equal(headerValue(call.init.headers, 'Cookie'), undefined, '浏览器脚本不得读取或手工拼接 HttpOnly cookie');
  if (call.method === 'POST') {
    assert.equal(headerValue(call.init.headers, 'Content-Type'), 'application/json', 'POST 必须使用 JSON');
    assert(call.body && typeof call.body === 'object' && !Array.isArray(call.body), 'POST body 必须是 JSON object');
    const csrf = headerValue(call.init.headers, 'X-CSRF-Token');
    if (expected.csrf) assert.equal(csrf, expected.csrf, '已认证写请求必须携带内存 CSRF token');
    else assert.equal(csrf, undefined, 'OTP 前置请求不得伪造 CSRF token');
  }
}

function assertBrowserIsolation(harness) {
  harness.calls.forEach((call) => assertBffCall(call, {
    action: call.action,
    method: call.method,
    csrf: ['submit_application', 'logout'].includes(call.action) ? CSRF_TOKEN : undefined
  }));
  assert.equal(harness.localStorage.accesses.length, 0, '浏览器脚本不得访问 localStorage');
  assert.equal(harness.sessionStorage.accesses.length, 0, '浏览器脚本不得访问 sessionStorage');
  assert.equal(harness.cookieAccesses.length, 0, '浏览器脚本不得读取或写入 document.cookie');
  const serialized = JSON.stringify(harness.calls);
  assert.equal(/access_token|refresh_token|service_role|anon[_-]?key/i.test(serialized), false,
    '浏览器请求不得含 Supabase token 或 key');
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
  assert.equal(loginPage.includes('id="v3a-phone-login-status"'), true, '统一登录页必须动态回读短信登录状态');
  assert.equal(loginPage.includes('preview-demo-auth') || loginPage.includes('模拟验证码'), false,
    '统一登录页不得包含模拟登录资产');
  assert.equal(/邮箱|name="email"|name="password"/.test(loginPage), false,
    '统一登录页当前不得继续提示邮箱或密码登录入口');
  assert.equal(/name="email"|name="password"/.test(registerPage), false,
    '申请资料页不得重新收集邮箱或密码');
  assert.equal(registerPage.includes('id="v3a-register-form"'), true, '申请资料页必须包含申请表单');
  assert.equal(pendingPage.includes('id="v3a-current-status"'), true, 'pending 页必须回读申请状态');
  assert.equal(workbenchPage.includes('data-v3a-auth-page="workbench" hidden'), true,
    '正式工作台必须在真实身份校验前保持隐藏');
  assert.equal(workbenchPage.includes('static/v3a-auth.js'), true, '正式工作台必须使用统一真实认证脚本');
  assert.equal(workbenchPage.includes('id="v3a-workbench-balance"'), true,
    '正式工作台必须展示真实积分余额');
  assert.equal(workbenchPage.includes('id="v3a-workbench-invite-code"'), true,
    '正式工作台必须展示真实邀请码');
  assert.equal(/preview-demo|sessionStorage|localStorage|ZHANGWEI01|王小明/.test(workbenchPage), false,
    '正式工作台不得包含演示 Session 或硬编码业务数据');

  assert.equal(source.includes("const SESSION_API = '/api/v3a-session'"), true, '浏览器必须只接入同源 Session BFF');
  assert.equal(source.includes("credentials: 'same-origin'"), true, 'BFF 请求必须携带同源 HttpOnly cookie');
  assert.equal(source.includes("'X-CSRF-Token'"), true, '已认证 POST 必须支持内存 CSRF token');
  assert.equal(/window\.supabase|createClient|AIPIWEN_V3A_SUPABASE|supabase\.co/i.test(source), false,
    '浏览器不得再依赖 Supabase SDK 或项目配置');
  assert.equal(/access_token|refresh_token|service_role|anon[_-]?key/i.test(source), false,
    '浏览器源码不得处理 Supabase token 或 key');
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(source), false,
    '浏览器身份脚本不得自行持久化或读取 cookie');

  let harness = createHarness({ phoneOtpEnabled: false });
  await settle();
  const initialCount = harness.calls.length;
  await clickSend(harness);
  await submit(harness);
  assert.equal(harness.sendButton.disabled, true, 'capabilities 关闭时发送按钮必须禁用');
  assert.equal(harness.texts.phoneLoginStatus.textContent, '短信登录尚未开放');
  assert.equal(harness.texts.phoneLoginStatus.className, 'status pending');
  assert.equal(harness.texts.phoneLoginHeading.textContent, '短信登录尚未开放');
  assert.equal(harness.calls.length, initialCount, '服务端短信门禁关闭时不得请求 OTP 或 verify');
  assert.equal(actionCalls(harness, 'request_otp').length, 0);
  assert.equal(actionCalls(harness, 'verify_otp').length, 0);
  assertBrowserIsolation(harness);

  for (const phone of ['13800138000', '8613800138000', '+8613800138000']) {
    harness = createHarness({ formData: { phone } });
    await settle();
    assert.equal(harness.texts.phoneLoginStatus.textContent, '短信登录已开放');
    assert.equal(harness.texts.phoneLoginStatus.className, 'status done');
    await clickSend(harness);
    const request = actionCalls(harness, 'request_otp')[0];
    assertBffCall(request, { action: 'request_otp', method: 'POST' });
    assert.deepStrictEqual(plain(request.body), { phone: VERIFIED_PHONE });
    assertBrowserIsolation(harness);
  }

  harness = createHarness({ formData: { otp: '999999', token: '999999' } });
  await clickSend(harness);
  assert.equal(harness.message.textContent, '验证码已发送，请查看短信；60 秒后可重新获取。');
  assert.equal(harness.message.hidden, false, '发送成功提示必须立即可见');
  assert.equal(harness.form.elements.otp.value, '', '重新发送成功后必须清空旧验证码，避免旧码误提交');
  assert.equal(harness.sendButton.disabled, true, '发送成功后必须阻止连续点击');
  assert.equal(harness.sendButton.textContent, '60 秒后重试');
  await clickSend(harness);
  assert.equal(actionCalls(harness, 'request_otp').length, 1, '冷却期间重复点击不得再次发送 OTP');
  harness.tickIntervals(1);
  assert.equal(harness.sendButton.textContent, '59 秒后重试');
  harness.tickIntervals(59);
  assert.equal(harness.sendButton.disabled, false, '60 秒后必须允许重新获取');
  assert.equal(harness.sendButton.textContent, '获取验证码');

  harness = createHarness({ formData: { phone: '23800138000' } });
  await clickSend(harness);
  assert.equal(actionCalls(harness, 'request_otp').length, 0, '无效中国手机号不得触发短信发送');
  assertNoRawDetail(harness.message.textContent, ['auth.users', 'stack', 'schema']);

  harness = createHarness({ verifyMe: emptyMe() });
  await submit(harness);
  let request = actionCalls(harness, 'verify_otp')[0];
  assertBffCall(request, { action: 'verify_otp', method: 'POST' });
  assert.deepStrictEqual(plain(request.body), { phone: VERIFIED_PHONE, token: OTP });
  assert.equal(harness.loginButton.textContent, '登录', '验证码校验结束后登录按钮必须恢复');
  assert.equal(harness.location.href, '/advisor-register.html', '无业务记录必须进入申请资料页');
  assertBrowserIsolation(harness);

  for (const testCase of [
    { me: completeMe('pending'), expected: '/advisor-pending.html' },
    { me: completeMe('active', 'advisor'), expected: '/ai-interpreter-workbench.html' },
    { me: completeMe('active', 'super_admin'), expected: '/admin-applications.html' }
  ]) {
    harness = createHarness({ verifyMe: testCase.me });
    await submit(harness);
    assert.equal(harness.location.href, testCase.expected);
    assertBrowserIsolation(harness);
  }

  harness = createHarness({ me: completeMe('active', 'advisor') });
  await settle();
  assert.equal(harness.location.href, '/ai-interpreter-workbench.html', '已有 Session 必须按状态恢复路由');
  assertBrowserIsolation(harness);

  harness = createHarness({
    failures: {
      verify_otp: { status: 400, body: { ok: false, error: '验证码不正确或已失效。', code: 'OTP_VERIFY_FAILED' } }
    }
  });
  await clickSend(harness);
  await submit(harness);
  assert.equal(harness.location.href, '');
  assert.equal(harness.message.textContent, '验证码不正确或已失效。');
  assert.equal(harness.sendButton.disabled, true, '验证码校验结束后仍须保持发送冷却');
  assert.equal(harness.sendButton.textContent, '60 秒后重试');
  assertNoRawDetail(harness.message.textContent, ['auth schema', 'raw verification detail']);

  harness = createHarness({ failures: { request_otp: new Error('auth.users internal provider detail') } });
  await clickSend(harness);
  assert.equal(harness.message.textContent, '账号服务暂时不可用，请稍后重试。');
  assert.equal(harness.sendButton.disabled, false, '发送失败后必须允许用户重试');
  assert.equal(harness.sendButton.textContent, '获取验证码');
  assertNoRawDetail(harness.message.textContent, ['auth.users', 'internal provider detail']);

  harness = createHarness({ page: 'register' });
  await settle();
  assert.equal(harness.texts.verifiedPhone.textContent, MASKED_PHONE, '申请页只能显示脱敏手机号');
  await submit(harness);
  request = actionCalls(harness, 'submit_application')[0];
  assertBffCall(request, { action: 'submit_application', method: 'POST', csrf: CSRF_TOKEN });
  assert.deepStrictEqual(plain(request.body), {
    displayName: '测试指导师',
    city: '上海',
    channelIdentity: '',
    role: 'advisor',
    practitionerType: 'independent',
    inviteCode: '',
    acceptedRules: true
  });
  for (const forbidden of ['phone', 'email', 'auth_user_id', 'status']) {
    assert.equal(forbidden in request.body, false, `申请 BFF 参数不得包含 ${forbidden}`);
  }
  assert.equal(harness.location.href, '/advisor-pending.html');
  assertBrowserIsolation(harness);

  harness = createHarness({ page: 'register', formData: { channelIdentity: 'branch_company' } });
  await settle();
  await submit(harness);
  request = actionCalls(harness, 'submit_application')[0];
  assert.deepStrictEqual(plain(request.body), {
    displayName: '测试指导师',
    city: '上海',
    channelIdentity: 'branch_company',
    role: 'agent',
    practitionerType: 'independent',
    inviteCode: '',
    acceptedRules: true
  });
  assert.equal(harness.location.href, '/advisor-pending.html');
  assertBrowserIsolation(harness);

  harness = createHarness({ page: 'register', acceptedRules: false });
  await submit(harness);
  assert.equal(actionCalls(harness, 'submit_application').length, 0, '未同意规则不得提交申请');
  assert.equal(harness.message.textContent.includes('请先勾选同意'), true);

  harness = createHarness({
    page: 'register',
    failures: {
      submit_application: {
        status: 502,
        body: { ok: false, error: 'public.users internal_constraint raw detail', code: 'APPLICATION_RESULT_UNKNOWN' }
      }
    }
  });
  await submit(harness);
  assert.equal(harness.location.href, '');
  assertNoRawDetail(harness.message.textContent, ['public.users', 'internal_constraint', 'raw detail']);

  harness = createHarness({ page: 'pending' });
  await settle();
  assert.equal(harness.texts.currentRole.textContent, '指导师');
  assert.equal(harness.texts.currentStatus.textContent, 'pending');
  assert.equal(harness.texts.reviewNote.textContent, '总部审核后更新');
  await clickLogout(harness);
  request = actionCalls(harness, 'logout')[0];
  assertBffCall(request, { action: 'logout', method: 'POST', csrf: CSRF_TOKEN });
  assert.deepStrictEqual(plain(request.body), {});
  assert.equal(harness.location.href, '/login.html', '退出后必须返回统一登录页');
  assertBrowserIsolation(harness);

  harness = createHarness({
    page: 'pending',
    failures: { me: { status: 401, body: { ok: false, error: '请先登录。', code: 'UNAUTHENTICATED' } } }
  });
  await settle();
  assert.equal(harness.location.href, '/login.html', 'pending Session 失效必须返回登录页');

  harness = createHarness({ page: 'pending', me: completeMe('rejected') });
  await settle();
  assert.equal(harness.message.textContent.includes('申请未通过'), true, 'rejected 路由必须保留安全提示');

  harness = createHarness({ page: 'workbench' });
  await settle();
  assert.equal(harness.body.hidden, false, 'active 指导师通过真实 Session 校验后才显示工作台');
  assert.equal(harness.texts.workbenchName.textContent, '测试指导师');
  assert.equal(harness.texts.workbenchCity.textContent, '上海');
  assert.equal(harness.texts.workbenchStatus.textContent, 'active');
  assert.equal(harness.texts.workbenchRole.textContent, '指导师');
  assert.equal(harness.texts.workbenchBalance.textContent, '500');
  assert.equal(harness.texts.workbenchInviteCode.textContent, 'ADV-ABCDEFGH');
  assert.equal(harness.sidebar.classList.contains('mobile-nav-ready'), true,
    '工作台通过身份校验后必须启用紧凑移动导航');
  assert.equal(harness.sidebar.toggle.attributes['aria-expanded'], 'false');
  await harness.sidebar.toggle._click();
  assert.equal(harness.sidebar.classList.contains('is-open'), true, '移动导航按钮必须可以展开菜单');
  assert.equal(harness.sidebar.toggle.attributes['aria-expanded'], 'true');
  assertBrowserIsolation(harness);
  await clickLogout(harness);
  assert.equal(harness.location.href, '/login.html', '工作台退出后必须返回统一登录页');
  assertBrowserIsolation(harness);

  harness = createHarness({ page: 'workbench', me: completeMe('pending') });
  await settle();
  assert.equal(harness.body.hidden, true, '非 active 身份不得看到工作台内容');
  assert.equal(harness.location.href, '/advisor-pending.html');

  harness = createHarness({ page: 'workbench', me: completeMe('active', 'super_admin') });
  await settle();
  assert.equal(harness.body.hidden, true, 'super_admin 不得误入指导师工作台');
  assert.equal(harness.location.href, '/admin-applications.html');

  harness = createHarness({
    page: 'workbench',
    failures: { me: { status: 401, body: { ok: false, error: '请先登录。', code: 'UNAUTHENTICATED' } } }
  });
  await settle();
  assert.equal(harness.body.hidden, true, '未登录时不得闪现工作台内容');
  assert.equal(harness.location.href, '/login.html');

  harness = createHarness({
    page: 'workbench',
    failures: { me: { status: 503, body: { ok: false, error: '账号服务暂时不可用。', code: 'UPSTREAM_UNAVAILABLE' } } }
  });
  await settle();
  assert.equal(harness.body.hidden, true, '账号服务异常时也不得显示工作台壳层');
  assert.equal(harness.location.href, '/login.html?service_unavailable=1',
    '账号服务异常必须回到统一登录页并保留安全状态标识');

  console.log('PASS: V3a browser BFF, HttpOnly isolation, phone login, registration, and protected workbench contracts');
}

run().catch((error) => {
  console.error(`FAIL: V3a phone auth contract: ${error.message}`);
  process.exitCode = 1;
});
