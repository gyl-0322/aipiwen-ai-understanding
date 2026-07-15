#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'api', 'v3a-admin.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const adminPage = fs.readFileSync(path.join(__dirname, '..', 'admin-applications.html'), 'utf8');
const adminClient = fs.readFileSync(path.join(__dirname, '..', 'static', 'v3a-admin.js'), 'utf8');

const PREVIEW_REF = 'lmjriqncuopgxwyudfee';
const PRODUCTION_REF = 'tysbwijizgebnrazxpvo';
const PREVIEW_URL = `https://${PREVIEW_REF}.supabase.co`;
const SERVICE_KEY = 'TEST_V3A_SERVICE_ROLE_KEY_NOT_REAL';
const ACCESS_TOKEN = 'TEST_ADMIN_ACCESS_TOKEN_NOT_REAL';
const ALLOWED_ENV = new Set([
  'V3A_SUPABASE_URL',
  'V3A_SUPABASE_SERVICE_ROLE_KEY',
  'V3A_SUPABASE_PROJECT_REF',
  'V3A_ADMIN_REVIEW_WRITES_ENABLED'
]);

function previewEnv(reviewWritesEnabled = 'false') {
  return {
    V3A_SUPABASE_URL: PREVIEW_URL,
    V3A_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    V3A_SUPABASE_PROJECT_REF: PREVIEW_REF,
    V3A_ADMIN_REVIEW_WRITES_ENABLED: reviewWritesEnabled
  };
}

const ADMIN_AUTH_ID = '40000000-0000-4000-8000-000000000001';
const ADMIN_USER_ID = '10000000-0000-4000-8000-000000000001';
const APPLICATION_ID = '20000000-0000-4000-8000-000000000001';
const APPROVED_APPLICATION_ID = '20000000-0000-4000-8000-000000000002';
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

function createFetch(options = {}) {
  const calls = [];
  const fetchStub = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: url.toString(), method, init });

    if (url.pathname === '/auth/v1/admin/users' || /\/auth\/v1\/admin\/users\/?$/.test(url.pathname)) {
      throw new Error('Auth user creation path must not exist');
    }
    if (url.pathname === '/auth/v1/user') {
      if (options.authFailure) return response(500, options.authFailure);
      return response(200, { id: ADMIN_AUTH_ID, phone: '+8613900139000' });
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
      if (requestedId === `eq.${APPLICATION_ID}`) return response(200, [pendingReview]);
      return response(200, pendingOnly ? [pendingReview] : [pendingReview, approvedReview]);
    }
    if (url.pathname === '/rest/v1/advisor_profiles') return response(200, [profile]);
    if (url.pathname === '/rest/v1/invite_codes') return response(200, []);
    if (url.pathname === '/rest/v1/rpc/v3a_approve_application') {
      if (options.rpcFailure) return response(500, options.rpcFailure);
      const body = JSON.parse(init.body);
      return response(200, {
        success: true,
        already_processed: false,
        data: {
          application_id: APPLICATION_ID,
          user_id: APPLICANT_USER_ID,
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
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    __dirname: path.dirname(sourcePath),
    __filename: sourcePath,
    process: { env: envProxy },
    fetch: fetchStub,
    URL,
    URLSearchParams,
    Buffer,
    console: { log() {}, error() {} }
  });
  vm.runInContext(source, context, { filename: sourcePath });
  assert.equal(typeof module.exports, 'function', 'api/v3a-admin.js 必须导出请求处理函数');
  return { handler: module.exports, envReads };
}

function createRequest(method, action, body, headers = {}) {
  return {
    method,
    headers,
    query: action ? { action } : {},
    body
  };
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
    env: options.env || previewEnv(),
    fetchStub
  });
  const req = createRequest(
    options.method || 'GET',
    options.action,
    options.body,
    options.headers === undefined ? { authorization: `Bearer ${ACCESS_TOKEN}` } : options.headers
  );
  if (options.query) Object.assign(req.query, options.query);
  const res = createResponse();
  await loaded.handler(req, res);
  return { res, fetchStub, envReads: loaded.envReads };
}

function assertNoSensitivePayload(payload) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(RAW_PHONE), false, '响应不得返回原始手机号');
  assert.equal(serialized.includes('13800000000'), false, '响应不得返回未脱敏手机号');
  assert.equal(serialized.includes(APPLICANT_AUTH_ID), false, '响应不得返回 auth_user_id');
  assert.equal(serialized.includes(SERVICE_KEY), false, '响应不得返回 service role key');
  assert.equal(serialized.includes('auth_user_id'), false, '响应不得返回 auth_user_id 字段');
}

function assertPendingQuery(calls) {
  const call = calls.find(({ url }) => new URL(url).pathname === '/rest/v1/application_reviews');
  assert(call, '列表必须读取 application_reviews');
  assert.equal(new URL(call.url).searchParams.get('status'), 'eq.pending', '申请查询必须在上游限定 status=eq.pending');
}

function mutationCalls(calls) {
  return calls.filter(({ method }) => !['GET', 'HEAD'].includes(method));
}

async function run() {
  [
    'v3a-admin-gate', 'v3a-admin-workspace', 'v3a-admin-list', 'v3a-admin-detail-list',
    'v3a-admin-approve', 'v3a-admin-reject', 'v3a-admin-reject-reason'
  ].forEach((id) => assert.equal(adminPage.includes(`id="${id}"`), true, `总部审核页缺少 ${id}`));
  assert.equal(adminPage.includes('href="login.html"'), true, '总部审核页必须返回统一 login.html');
  assert.equal(adminPage.includes('advisor-login'), false, '总部审核页不得使用旧独立登录页');
  assert.equal(adminPage.includes('cdn.jsdelivr.net') || adminPage.includes('esm.sh'), false,
    '中国用户后台不得依赖境外 CDN');
  assert.equal(adminPage.includes('解读师'), false, '总部审核页必须统一使用“指导师”');
  assert.equal(adminClient.includes('phoneMasked'), true, '浏览器后台只能消费脱敏手机号');
  assert.equal(/localStorage|sessionStorage/.test(adminClient), false,
    '总部审核脚本不得自行保存身份或申请数据');
  assert.equal(/auth\/v1\/admin\/users|admin\.createUser|auth\.admin\.createUser|\.signUp\s*\(/.test(source), false,
    '后台审核接口不得包含创建 Supabase Auth 用户的路径');

  for (const env of [
    {
      V3A_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
      V3A_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      V3A_SUPABASE_PROJECT_REF: PRODUCTION_REF
    },
    {
      V3A_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
      V3A_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      V3A_SUPABASE_PROJECT_REF: PREVIEW_REF
    },
    {
      V3A_SUPABASE_URL: PREVIEW_URL,
      V3A_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      V3A_SUPABASE_PROJECT_REF: 'another-project-ref'
    }
  ]) {
    const fetchStub = createFetch();
    const { res } = await invoke({ action: 'list_applications', env, fetchStub });
    assert.equal(res.statusCode, 503, 'Production、非 Preview 或 URL/ref 不一致必须返回 503');
    assert.equal(fetchStub.calls.length, 0, '项目门禁失败时绝不能发起 fetch');
  }

  let result = await invoke({ action: 'list_applications', headers: {} });
  assert.equal(result.res.statusCode, 401, '缺少 Bearer token 必须返回 401');
  assert.equal(result.fetchStub.calls.length, 0, '缺少 Bearer token 时不得访问 Supabase');

  result = await invoke({
    action: 'list_applications',
    fetchOptions: { admin: adminRecord({ role: 'advisor' }) }
  });
  assert.equal(result.res.statusCode, 403, '普通用户必须返回 403');
  assert.equal(result.fetchStub.calls.some(({ url }) => url.includes('/application_reviews')), false,
    '普通用户不得读取申请列表');

  result = await invoke({
    action: 'list_applications',
    fetchOptions: { admin: adminRecord({ status: 'frozen' }) }
  });
  assert.equal(result.res.statusCode, 403, '非 active super_admin 必须返回 403');
  assert.equal(result.fetchStub.calls.some(({ url }) => url.includes('/application_reviews')), false,
    '非 active super_admin 不得读取申请列表');

  result = await invoke({ action: 'list_applications' });
  assert.equal(result.res.statusCode, 200, 'active super_admin 必须可以读取 pending 列表');
  assertPendingQuery(result.fetchStub.calls);
  assert.deepStrictEqual([...result.envReads].sort(), [...ALLOWED_ENV].sort(),
    '后台接口必须且只能读取四项 V3A Preview 环境变量');
  const listPayload = JSON.parse(JSON.stringify(result.res.body));
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
  assertPendingQuery(result.fetchStub.calls);
  assert.equal(JSON.stringify(result.res.body).includes(MASKED_PHONE), true, '详情必须只返回脱敏手机号');
  assertNoSensitivePayload(result.res.body);

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID }
  });
  assert.equal(result.res.statusCode, 503, '审核写开关默认关闭');
  assert.equal(mutationCalls(result.fetchStub.calls).length, 0, '写开关关闭时不得调用任何 RPC');

  result = await invoke({
    method: 'POST',
    action: 'approve_application',
    body: { applicationId: APPLICATION_ID },
    env: previewEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '批准 pending 申请应成功');
  let writes = mutationCalls(result.fetchStub.calls);
  assert.equal(writes.length, 1, '批准流程只能有一次写请求');
  assert.equal(new URL(writes[0].url).pathname, '/rest/v1/rpc/v3a_approve_application',
    '批准流程只能调用 v3a_approve_application RPC');
  let rpcBody = JSON.parse(writes[0].init.body);
  assert.equal(rpcBody.p_application_id, APPLICATION_ID);
  assert.equal(rpcBody.p_reviewer_user_id, ADMIN_USER_ID);
  assert.equal(typeof rpcBody.p_invite_code, 'string');
  assertNoSensitivePayload(result.res.body);

  const reason = '申请资料与当前审核要求不一致，请补充后重新提交';
  result = await invoke({
    method: 'POST',
    action: 'reject_application',
    body: { applicationId: APPLICATION_ID, reason },
    env: previewEnv('true')
  });
  assert.equal(result.res.statusCode, 200, '驳回 pending 申请应成功');
  writes = mutationCalls(result.fetchStub.calls);
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
    body: { applicationId: APPLICATION_ID, reason: '过'.repeat(501) },
    env: previewEnv('true')
  });
  assert.equal(result.res.statusCode, 400, '超长驳回原因必须在调用 RPC 前拒绝');
  assert.equal(mutationCalls(result.fetchStub.calls).length, 0, '超长驳回原因不得产生写请求');

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
    env: previewEnv('true')
  });
  assert.equal(result.res.statusCode >= 500, true, '底层 RPC 错误必须返回服务端错误');
  assertNoSensitivePayload(result.res.body);
  assert.equal(JSON.stringify(result.res.body).includes('database internal failure'), false,
    'RPC 错误不得泄露底层错误信息');

  console.log('PASS: V3a admin Preview gate, authorization, masking, pending-only reads, and RPC-only review contracts');
}

run().catch((error) => {
  console.error(`FAIL: V3a admin flow contract: ${error.message}`);
  process.exitCode = 1;
});
