#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
process.env.SESSION_SECRET ||= 'TEST_SESSION_SECRET_NOT_REAL';
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/020_v3a_advisor_client_tables.sql'), 'utf8');
const permissionFixMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/021_v3a_advisor_report_rls_helper_permissions.sql'),
  'utf8'
);
const customersSource = fs.readFileSync(path.join(root, 'api/v3a-attribution.js'), 'utf8');
const importSource = fs.readFileSync(path.join(root, 'api/v3a-report-import.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const customersTest = require('../api/v3a-attribution')._test;
const reportTest = require('../api/v3a-report-import')._test;

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert(condition, message);
}
function mustMatch(source, pattern, message) {
  check(pattern.test(source), message);
}
function mustNotMatch(source, pattern, message) {
  check(!pattern.test(source), message);
}
function expectCode(fn, code, message) {
  checks += 1;
  assert.throws(fn, (error) => error?.code === code, message);
}

// Migration and privilege contract.
mustMatch(migration, /^begin;[\s\S]*commit;\s*$/m, 'migration 020 必须是单事务');
mustMatch(migration, /MIGRATION_020_REQUIRES_USERS/, 'migration 必须预检 users 表');
mustMatch(migration, /MIGRATION_020_REQUIRES_V3A_HELPERS/, 'migration 必须预检 V3a helper');
mustMatch(migration, /create table public\.advisor_clients/, '必须创建 advisor_clients');
mustMatch(migration, /create table public\.advisor_reports/, '必须创建 advisor_reports');
mustMatch(migration, /check \(source in \('invite_link', 'advisor_qr', 'advisor_import'\)\)/g,
  '客户与报告必须限制三种来源');
mustMatch(migration, /advisor_clients_note_length_check[\s\S]*char_length\(note\) <= 200/,
  '客户备注必须限制长度');
mustMatch(migration, /advisor_reports_structured_input_check[\s\S]*structured_input <> '\{\}'::jsonb/,
  '结构化报告输入不得为空对象');
mustMatch(migration, /advisor_reports_result_state_check/, '报告状态和结果必须保持一致');
mustMatch(migration, /grant select on table public\.advisor_clients to authenticated;/,
  'authenticated 只能读取客户表');
mustMatch(migration, /grant select on table public\.advisor_reports to authenticated;/,
  'authenticated 只能读取报告表');
mustNotMatch(migration, /grant\s+[^;]*\binsert\b[^;]*\bto authenticated;/i,
  'authenticated 不得获得表 INSERT 权限');
mustNotMatch(migration, /grant\s+[^;]*\bupdate\b[^;]*\bto authenticated;/i,
  'authenticated 不得获得表 UPDATE 权限');
check((migration.match(/public\.v3a_current_role\(\) = 'advisor'/g) || []).length === 2,
  '两张表的 RLS 都必须限制 active advisor');
mustMatch(migration, /create function public\.v3a_create_advisor_report_import\([\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/,
  '创建 RPC 必须固定 search_path 并使用 SECURITY DEFINER');
mustMatch(migration, /create function public\.v3a_complete_advisor_report_import\([\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/,
  '完成 RPC 必须固定 search_path 并使用 SECURITY DEFINER');
mustNotMatch(migration, /p_advisor(_user)?_id/i, 'RPC 不得接收 advisor id');
mustMatch(migration, /where u\.auth_user_id = auth\.uid\(\)[\s\S]*u\.role = 'advisor'[\s\S]*u\.status = 'active'/,
  'RPC 必须从 auth.uid 推导 active advisor');
mustMatch(migration, /when unique_violation[\s\S]*IDEMPOTENCY_KEY_CONFLICT/,
  '创建 RPC 必须在事务内处理并发幂等冲突');
mustMatch(migration, /IDEMPOTENCY_PAYLOAD_MISMATCH/,
  '相同幂等键的不同 payload 必须被拒绝');
mustMatch(migration, /join public\.advisor_clients c on c\.id = r\.advisor_client_id[\s\S]*c\.advisor_user_id = v_advisor_id/,
  '完成 RPC 必须校验报告归属');
mustMatch(migration, /v_current_status <> 'generating'[\s\S]*INVALID_REPORT_TRANSITION/,
  '完成 RPC 必须限制 generating 到 ready/failed 的状态迁移');
mustMatch(migration, /revoke all on function public\.v3a_create_advisor_report_import[\s\S]*from public, anon, authenticated, service_role;/,
  '创建 RPC 必须先撤销所有默认执行权限');
mustMatch(migration, /grant execute on function public\.v3a_create_advisor_report_import[\s\S]*to authenticated;/,
  '创建 RPC 只能授权 authenticated');
mustMatch(migration, /MIGRATION_020_POSTFLIGHT_RPC_PRIVILEGES_FAILED/,
  'migration 必须在事务内执行权限 postflight');

// Migration 021 is a narrow runtime-permission repair for the new 020 RLS policies.
mustMatch(permissionFixMigration, /^begin;[\s\S]*commit;\s*$/m,
  'migration 021 必须是单事务');
mustMatch(permissionFixMigration,
  /revoke all on function public\.v3a_current_role\(\)[\s\S]*from public, anon, authenticated, service_role;/,
  'migration 021 必须先收紧 current_role 的全部默认授权');
mustMatch(permissionFixMigration,
  /grant execute on function public\.v3a_current_role\(\)[\s\S]*to authenticated;/,
  'migration 021 只能为 authenticated 恢复 current_role EXECUTE');
mustNotMatch(permissionFixMigration,
  /grant execute on function public\.v3a_current_role\(\)[\s\S]*to (?:anon|service_role|public);/,
  'migration 021 不得授权 anon、service_role 或 public');
mustNotMatch(permissionFixMigration,
  /grant execute on function public\.v3a_(?:current_user_id|current_status|is_super_admin)\(\)/,
  'migration 021 不得扩大或重复授权其他 helper');
mustMatch(permissionFixMigration, /MIGRATION_021_POSTFLIGHT_PRIVILEGES_FAILED/,
  'migration 021 必须验证最终 helper 权限');

// BFF source-level security and routing contract.
mustNotMatch(importSource, /SERVICE_ROLE|serviceRole|service_role/, '报告 BFF 不得读取或使用 service-role key');
mustNotMatch(customersSource, /SERVICE_ROLE|serviceRole|service_role/, '客户 BFF 不得读取或使用 service-role key');
mustMatch(importSource, /v3a_create_advisor_report_import/, 'confirm 必须调用原子创建 RPC');
mustMatch(importSource, /v3a_complete_advisor_report_import/, '生成结束必须调用受控完成 RPC');
mustNotMatch(importSource, /idempotencyKey\s*[:=]\s*crypto\.randomUUID\(/,
  'BFF 不得替浏览器重新生成报告导入幂等键');
mustMatch(importSource, /body\.idempotencyKey/, 'BFF 必须读取客户端幂等键');
mustMatch(importSource, /ADVISOR_ID_NOT_ALLOWED/, 'BFF 必须显式拒绝 advisor id');
mustMatch(importSource, /\/api\/extract-fp/, 'OCR 必须复用现有 Vercel extract API');
mustNotMatch(importSource, /functions\/v1\/extract-fp/, '不得调用不存在的 Supabase extract Edge Function');
mustMatch(importSource, /imageBase64: file\.toString\('base64'\)/,
  'OCR 请求必须匹配现有 JSON Base64 契约');
mustMatch(importSource, /module\.exports\.config = \{ api: \{ bodyParser: false \} \}/,
  'multipart BFF 必须关闭自动 body parser');
mustMatch(importSource, /req\.method === 'POST'\);/, '只有 POST 需要 CSRF');
mustMatch(importSource, /select: 'id,advisor_client_id,status,source,age_at_report/,
  '状态查询必须读取 advisor_client_id');
mustMatch(customersSource, /user\.role !== 'advisor'/, '客户 API 首期只允许普通指导师');
mustNotMatch(customersSource, /new Set\(\['advisor', 'agent', 'center'\]\)/,
  '机构角色不得在首期读取客户 API');
mustMatch(importSource, /req\.method === 'GET'\) return await handleStatus\(/,
  '状态查询必须在统一 try/catch 内 await');
mustMatch(importSource, /action === 'extract'\) return await handleExtract\(/,
  'OCR action 必须在统一 try/catch 内 await');
mustMatch(importSource, /action === 'confirm'\) return await handleConfirm\(/,
  'confirm action 必须在统一 try/catch 内 await');
mustNotMatch(importSource, /return handle(?:Status|Extract|Confirm)\(/,
  '异步 action 不得以未 await Promise 绕过统一错误处理');

// Real pure-function tests.
const validUuid = '11111111-1111-4111-8111-111111111111';
const clientUuid = '22222222-2222-4222-8222-222222222222';
check(reportTest.isUuid(validUuid), '必须接受合法 UUID');
check(!reportTest.isUuid('not-a-uuid'), '必须拒绝非法 UUID');

const validFingers = Object.fromEntries(
  ['R1', 'R2', 'R3', 'R4', 'R5', 'L1', 'L2', 'L3', 'L4', 'L5']
    .map((key, index) => [key, { sym: index === 3 ? 'Rl' : 'Lu', trc: index + 1 }])
);
check(Object.keys(reportTest.validateFingers(validFingers)).length === 10, '必须接受完整十指对象');
expectCode(() => reportTest.validateFingers([]), 'INVALID_FINGERS', '必须拒绝数组形态 fingers');
expectCode(() => reportTest.validateFingers({ ...validFingers, R1: { sym: 'BAD', trc: 10 } }),
  'INVALID_FINGERS', '必须拒绝未知纹型');
expectCode(() => reportTest.validateFingers({ ...validFingers, R1: { sym: 'Lu', trc: 99 } }),
  'INVALID_FINGERS', '必须拒绝越界 TRC');

const confirmBody = {
  idempotencyKey: validUuid,
  existingClientId: clientUuid,
  dataConfirmed: true,
  reportType: '儿童天赋报告',
  selectedIssues: ['注意力', '学习兴趣'],
  customIssue: '',
  extractedData: { fingers: validFingers, atd: 42, age: 8, name: '测试客户' }
};
const normalized = reportTest.validateConfirmBody(confirmBody);
check(normalized.idempotencyKey === validUuid, 'confirm 必须保留客户端幂等键');
check(normalized.existingClientId === clientUuid, 'confirm 必须保留已有客户 ID');
check(normalized.selectedIssues.length === 2, 'confirm 必须保留合法关注问题');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, advisor_id: clientUuid }),
  'ADVISOR_ID_NOT_ALLOWED', 'confirm 必须拒绝 advisor_id');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, idempotencyKey: 'bad' }),
  'INVALID_IDEMPOTENCY_KEY', 'confirm 必须拒绝非法幂等键');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, newClient: { displayName: '重复' } }),
  'AMBIGUOUS_CLIENT', 'confirm 必须执行客户 XOR');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, dataConfirmed: false }),
  'DATA_NOT_CONFIRMED', '未人工确认不得提交');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, selectedIssues: [] }),
  'INVALID_SELECTED_ISSUES', '必须选择至少一个关注问题');
expectCode(() => reportTest.validateConfirmBody({ ...confirmBody, reportType: '任意报告' }),
  'INVALID_REPORT_TYPE', '必须拒绝未知报告类型');

const boundary = 'AIPIWEN_TEST_BOUNDARY';
function multipart(file, contentType = 'image/jpeg') {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="report.jpg"\r\nContent-Type: ${contentType}\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
check(reportTest.parseMultipartFile(multipart(jpeg), `multipart/form-data; boundary=${boundary}`).mimeType === 'image/jpeg',
  'multipart 必须识别 JPEG magic bytes');
check(reportTest.parseMultipartFile(multipart(png, 'image/png'), `multipart/form-data; boundary="${boundary}"`).mimeType === 'image/png',
  'multipart 必须识别 PNG magic bytes及引号 boundary');
expectCode(() => reportTest.parseMultipartFile(multipart(Buffer.from('not-image')), `multipart/form-data; boundary=${boundary}`),
  'INVALID_IMAGE_FORMAT', 'multipart 必须拒绝伪造扩展名');

const generated = reportTest.sanitizeGeneratedReport({
  ok: true,
  sections: [{ title: '摘要', content: '内容' }],
  requiredModules: ['天赋底色'],
  raw: '不得入库的原始模型输出'
}, { 主性格类型: '模仿型' }, validFingers);
check(!Object.prototype.hasOwnProperty.call(generated, 'raw'), '生成结果必须剔除 raw 模型输出');
check(generated.sections.length === 1, '生成结果必须保留结构化 sections');
expectCode(() => reportTest.sanitizeGeneratedReport({ ok: false }, {}, validFingers),
  'REPORT_GENERATION_FAILED', '失败生成结果不得标记 ready');

const previousVercelUrl = process.env.VERCEL_URL;
process.env.VERCEL_URL = 'preview-example.vercel.app';
check(reportTest.internalOrigin({ allowedOrigin: 'https://www.aipiwen.cn' }) === 'https://preview-example.vercel.app',
  '内部调用必须优先使用受控 VERCEL_URL');
if (previousVercelUrl === undefined) delete process.env.VERCEL_URL;
else process.env.VERCEL_URL = previousVercelUrl;

const customerUrl = customersTest.restUrl({ supabaseUrl: 'https://project.supabase.co' }, 'advisor_clients', {
  advisor_user_id: `eq.${clientUuid}`,
  archived_at: 'is.null'
});
check(customerUrl.searchParams.get('advisor_user_id') === `eq.${clientUuid}`,
  '客户查询归属过滤必须由服务端构造');
check(!customerUrl.searchParams.has('advisor_id'), '客户 API 不得使用浏览器 advisor_id 参数');

// Deployment registration and Hobby budget contract.
check(Object.prototype.hasOwnProperty.call(vercel.functions, 'api/v3a-attribution.js'),
  'vercel.functions 必须登记客户 API');
check(Object.prototype.hasOwnProperty.call(vercel.functions, 'api/v3a-report-import.js'),
  'vercel.functions 必须登记报告导入 API');
const functionFiles = fs.readdirSync(path.join(root, 'api')).filter((name) => name.endsWith('.js') && !name.startsWith('_'));
check(functionFiles.length === 12, '当前 Serverless Function 数量必须恰好为 12');
check(functionFiles.length <= 12, '不得超过 Hobby 12 个 Function 上限');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function responseHarness() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function testBffFlows() {
  const originalFetch = global.fetch;
  const config = {
    supabaseUrl: 'https://project.supabase.co',
    anonKey: 'TEST_ANON_KEY_NOT_REAL',
    allowedOrigin: 'https://www.aipiwen.cn'
  };
  const session = { record: { accessToken: 'TEST_ACCESS_TOKEN_NOT_REAL' } };
  const reportUuid = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  try {
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, init, body });
      if (url.pathname === '/rest/v1/advisor_clients') {
        return response(200, [{ id: clientUuid, birth_date: '2018-03-15' }]);
      }
      if (url.pathname.endsWith('/rpc/v3a_create_advisor_report_import')) {
        return response(200, {
          clientId: clientUuid,
          clientName: '测试客户',
          reportId: reportUuid,
          status: 'generating',
          idempotent: false
        });
      }
      if (url.pathname === '/api/generate-report') {
        return response(200, { ok: true, sections: [{ title: '摘要', content: '生成内容' }] });
      }
      if (url.pathname.endsWith('/rpc/v3a_complete_advisor_report_import')) {
        return response(200, { reportId: reportUuid, status: 'ready' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const res = responseHarness();
    await reportTest.handleConfirm(config, session, res, confirmBody, clientUuid);
    check(res.statusCode === 200 && res.body?.report?.status === 'ready',
      'confirm 集成流必须完成 ready 状态');
    const createCall = calls.find((call) => call.url.pathname.endsWith('/rpc/v3a_create_advisor_report_import'));
    check(createCall?.body?.p_idempotency_key === validUuid, '创建 RPC 必须收到浏览器幂等键');
    check(!Object.keys(createCall?.body || {}).some((key) => /advisor/i.test(key)),
      '创建 RPC payload 不得包含 advisor id');
    const generationCall = calls.find((call) => call.url.pathname === '/api/generate-report');
    check(generationCall?.body?.engineResult?.主性格类型, 'BFF 必须在服务端生成 TRC engineResult');
    check(!Array.isArray(generationCall?.body?.fingers) && generationCall?.body?.fingers?.R1,
      '报告生成必须收到十指对象而非数组');
    check(/^v3a-[0-9a-f]{24}$/.test(generationCall?.init?.headers?.['x-forwarded-for'] || ''),
      '内部生成调用必须使用不可逆指导师配额标识');
    const completeCall = calls.find((call) => call.url.pathname.endsWith('/rpc/v3a_complete_advisor_report_import'));
    check(completeCall?.body?.p_succeeded === true, '成功生成必须通过完成 RPC 标记 ready');

    calls.length = 0;
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, init, body });
      if (url.pathname === '/rest/v1/advisor_clients') {
        return response(200, [{ id: clientUuid, birth_date: '2018-03-15' }]);
      }
      if (url.pathname.endsWith('/rpc/v3a_create_advisor_report_import')) {
        return response(200, {
          clientId: clientUuid,
          clientName: '测试客户',
          reportId: reportUuid,
          status: 'generating',
          idempotent: true
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const duplicateRes = responseHarness();
    await reportTest.handleConfirm(config, session, duplicateRes, confirmBody, clientUuid);
    check(duplicateRes.body?.idempotent === true, '重复请求必须返回现有报告');
    check(!calls.some((call) => call.url.pathname === '/api/generate-report'),
      'generating 状态的幂等重试不得重复调用报告生成');

    calls.length = 0;
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, init, body });
      if (url.pathname === '/rest/v1/advisor_clients') {
        return response(200, [{ id: clientUuid, birth_date: '2018-03-15' }]);
      }
      if (url.pathname.endsWith('/rpc/v3a_create_advisor_report_import')) {
        return response(200, {
          clientId: clientUuid,
          clientName: '测试客户',
          reportId: reportUuid,
          status: 'generating',
          idempotent: true,
          retry: true
        });
      }
      if (url.pathname === '/api/generate-report') return response(200, { ok: false });
      if (url.pathname.endsWith('/rpc/v3a_complete_advisor_report_import')) {
        return response(200, { reportId: reportUuid, status: 'failed' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const failedRes = responseHarness();
    await reportTest.handleConfirm(config, session, failedRes, confirmBody, clientUuid);
    check(failedRes.statusCode === 502 && failedRes.body?.report?.status === 'failed',
      '生成失败必须安全落为 failed 并返回可重试报告 ID');
    const failureCall = calls.find((call) =>
      call.url.pathname.endsWith('/rpc/v3a_complete_advisor_report_import') && call.body?.p_succeeded === false);
    check(failureCall?.body?.p_error_code === 'REPORT_GENERATION_FAILED',
      '失败状态只能保存安全错误码');

    calls.length = 0;
    global.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push({ url });
      if (url.pathname === '/rest/v1/advisor_reports') {
        return response(200, [{
          id: reportUuid,
          advisor_client_id: clientUuid,
          status: 'ready',
          source: 'advisor_import',
          age_at_report: 8,
          generated_report: { sections: [{ title: '摘要' }] },
          error_code: null,
          created_at: '2026-07-29T00:00:00Z',
          updated_at: '2026-07-29T00:00:00Z'
        }]);
      }
      if (url.pathname === '/rest/v1/advisor_clients') return response(200, [{ id: clientUuid }]);
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const statusRes = responseHarness();
    await reportTest.handleStatus(config, session, statusRes, reportUuid);
    check(statusRes.statusCode === 200 && statusRes.body?.report?.generatedReport,
      '状态查询必须在归属校验后返回 ready 报告');
    check(calls.some((call) => call.url.searchParams.get('select')?.includes('advisor_client_id')),
      '状态查询必须实际请求 advisor_client_id');

    let extractRequest = null;
    global.fetch = async (input, init = {}) => {
      extractRequest = { url: new URL(String(input)), body: JSON.parse(init.body) };
      return response(200, { ok: true, fingers: validFingers, atd: 42, age: 8, name: '测试客户', raw: '不返回' });
    };
    const extracted = await reportTest.callExtract(config, clientUuid, jpeg, 'image/jpeg');
    check(extractRequest.url.pathname === '/api/extract-fp' && extractRequest.body.imageBase64,
      'extract 集成流必须调用现有 Base64 OCR API');
    check(!Object.prototype.hasOwnProperty.call(extracted, 'raw'), 'BFF 不得向前端透传 OCR raw 输出');
  } finally {
    global.fetch = originalFetch;
  }
}

testBffFlows().then(() => {
  console.log(`PASS: ${checks} real advisor report import checks`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
