#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
process.env.SESSION_SECRET ||= 'TEST_SESSION_SECRET_NOT_REAL';

const migrationPath = 'supabase/migrations/029_v3a_advisor_interpretation_data.sql';
const helperPath = 'server/v3a-interpretation.js';
assert(exists(migrationPath), '缺少 Migration 029');
assert(exists(helperPath), '缺少 AI 解读输出校验模块');

const migration = read(migrationPath);
const reportBff = read('api/v3a-report-import.js');
const aiLib = read('api/_lib.js');
const helperSource = read(helperPath);
const sessionHtml = read('ai-interpreter-session.html');
const sessionJs = read('static/ai-interpreter.js');
const customersJs = read('static/v3a-attribution.js');
const vercel = JSON.parse(read('vercel.json'));
const interpretation = require(path.join(root, helperPath));
const reportTest = require(path.join(root, 'api/v3a-report-import.js'))._test;

assert(/^begin;[\s\S]*commit;\s*$/m.test(migration), 'Migration 029 必须为单事务');
assert(/add column interpretation_data jsonb/.test(migration), '必须增加 interpretation_data jsonb');
assert(/create function public\.v3a_save_advisor_interpretation\(/.test(migration), '必须创建受控保存 RPC');
assert(/security definer[\s\S]*set search_path = pg_catalog, public/.test(migration), '保存 RPC 必须固定 search_path');
assert(/where u\.auth_user_id = auth\.uid\(\)[\s\S]*u\.role = 'advisor'[\s\S]*u\.status = 'active'/.test(migration),
  '保存 RPC 必须从 auth.uid 推导 active advisor');
assert(/c\.advisor_user_id = v_advisor_id/.test(migration), '保存 RPC 必须校验客户归属');
assert(/r\.status = 'ready'/.test(migration), '只有 ready 报告可保存解读方案');
assert(/grant execute on function public\.v3a_save_advisor_interpretation[\s\S]*to authenticated;/.test(migration),
  '保存 RPC 只能授权 authenticated');
assert(!/grant (?:insert|update|delete) on table public\.advisor_reports/i.test(migration),
  '不得扩大 advisor_reports 浏览器写权限');
assert(!/delete from public\.(?:users|advisor_clients|advisor_reports)/i.test(migration), '迁移不得删除用户、客户或报告');

const aliases = new Map(vercel.routes.map((route) => [route.src, route.dest]));
assert.equal(aliases.get('/api/v3a-generate-interpretation'), '/api/v3a-report-import?action=interpretation',
  'AI 解读外部 endpoint 必须合并到现有报告 BFF');
const functionFiles = fs.readdirSync(path.join(root, 'api'))
  .filter((name) => name.endsWith('.js') && !name.startsWith('_'));
assert.equal(functionFiles.length, 12, '不得超过 Hobby 12 个 Function');
assert(!exists('api/v3a-generate-interpretation.js'), '不得新增第 13 个 Serverless Function');

assert(/require\('\.\.\/server\/v3a-interpretation'\)/.test(reportBff), '报告 BFF 必须复用解读安全模块');
assert(/callClaude/.test(reportBff) && /MODEL_FREE/.test(reportBff), '必须复用现有 AI 调用封装');
assert(/responseFormat/.test(aiLib) && /body\.response_format = responseFormat/.test(aiLib),
  'AI 调用封装必须支持可选 JSON 输出模式');
assert(/action === 'interpretation'/.test(reportBff), '报告 BFF 必须登记 interpretation action');
assert(/v3a_save_advisor_interpretation/.test(reportBff), '保存必须调用受控 RPC');
assert(/consumeRateLimit/.test(reportBff) && /interpretation-generate-advisor/.test(reportBff),
  '生成必须有指导师级限流');
assert(!/SERVICE_ROLE|serviceRole|service_role/.test(reportBff), '报告 BFF 不得使用 service-role');
assert(!/console\.(?:log|error)\([^\n]*(?:prompt|structured_input|generated_report)/i.test(reportBff),
  '不得记录 AI prompt 或客户报告内容');

assert(/const STEP_TITLES/.test(helperSource), '必须冻结 8 步标题');
assert(/UNSAFE_AI_OUTPUT/.test(helperSource), '必须拒绝不安全 AI 输出');
assert(/AI_OUTPUT_INVALID/.test(helperSource), '必须拒绝非结构化 AI 输出');
assert(/每个内容字段只写1条/.test(helperSource), '必须限制模型输出长度，避免 8 步方案生成超时');

assert(!/id="generate-plan"/.test(sessionHtml) && /await generateInterpretation\(\)/.test(sessionJs),
  '首次进入真实报告必须自动生成方案，不保留重复生成按钮');
assert(/id="save-interpretation"/.test(sessionHtml), '必须提供保存解读方案按钮');
assert(/id="session-client-title"/.test(sessionHtml) && /id="session-report-meta"/.test(sessionHtml),
  '页面标题必须支持真实客户动态渲染');
assert(!/id="credit-modal"/.test(sessionHtml), 'MVP 不得保留假积分弹窗');
assert(!/王小明|张老师专属链接/.test(sessionHtml), '真实解读页不得硬编码示例客户');

for (const marker of ['loadClientReport', 'generateInterpretation', 'saveInterpretation']) {
  assert(sessionJs.includes(`function ${marker}`) || sessionJs.includes(`async function ${marker}`), `缺少 ${marker}`);
}
assert(/URLSearchParams/.test(sessionJs) && /clientId/.test(sessionJs) && /reportId/.test(sessionJs),
  '解读页必须从 URL 获取真实 clientId/reportId');
assert(/\/api\/v3a-generate-interpretation/.test(sessionJs), '前端必须调用统一 AI 解读 endpoint');
assert(!/const steps = \[/.test(sessionJs), '不得继续使用静态完整话术 steps 数组');

assert(/ai-interpreter-session\.html\?clientId=/.test(customersJs) && /reportId=/.test(customersJs),
  '真实客户 ready 报告必须携带 clientId/reportId 进入解读页');

const validSteps = interpretation.STEP_TITLES.map((title, stepIndex) => ({
  stepIndex,
  title,
  why: ['原因'],
  say: ['可以这样说'],
  ask: ['可以这样问'],
  no: ['不要贴标签'],
  action: ['记录反馈'],
  risk: ['注意边界']
}));
assert.equal(interpretation.validateSteps(validSteps).length, 8, '必须接受合法 8 步输出');
assert.throws(() => interpretation.validateSteps(validSteps.slice(0, 7)), /AI_OUTPUT_INVALID/,
  '必须拒绝不足 8 步');
assert.throws(() => interpretation.validateSteps(validSteps.map((step, index) =>
  index === 0 ? { ...step, say: ['孩子以后一定会成功'] } : step)), /UNSAFE_AI_OUTPUT/,
  '必须拒绝预测性话术');

const parsed = interpretation.parseModelText(`\`\`\`json\n${JSON.stringify({ steps: validSteps })}\n\`\`\``);
assert.equal(parsed.length, 8, '必须解析 fenced JSON');
assert.throws(() => interpretation.validateGenerateBody({ reportId: 'bad', clientId: 'bad' }), /INVALID_REPORT_ID/,
  '必须拒绝非法报告 ID');
assert.throws(() => interpretation.validateGenerateBody({
  reportId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  advisorId: '33333333-3333-4333-8333-333333333333'
}), /ADVISOR_ID_NOT_ALLOWED/, '不得接受浏览器 advisorId');

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
  const reportId = '11111111-1111-4111-8111-111111111111';
  const clientId = '22222222-2222-4222-8222-222222222222';
  const advisorId = '33333333-3333-4333-8333-333333333333';
  const session = { csrfToken: 'TEST_CSRF_NOT_REAL', record: { accessToken: 'TEST_ACCESS_TOKEN_NOT_REAL' } };
  const config = { supabaseUrl: 'https://project.supabase.co', anonKey: 'TEST_ANON_KEY_NOT_REAL' };
  let stored = null;
  let hideReport = false;
  const calls = [];
  try {
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, init, body });
      if (url.pathname === '/rest/v1/advisor_reports') {
        return response(200, hideReport ? [] : [{
          id: reportId,
          advisor_client_id: clientId,
          status: 'ready',
          structured_input: {
            reportType: '儿童天赋报告',
            selectedIssues: ['注意力'],
            fingers: { R1: { sym: 'Lu', trc: 10 } },
            atd: 42,
            engineResult: { 主性格类型: '观察型' }
          },
          generated_report: { sections: [{ title: '摘要', content: '报告内容' }] },
          age_at_report: 8,
          interpretation_data: stored,
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:00:00Z'
        }]);
      }
      if (url.pathname === '/rest/v1/advisor_clients') {
        return response(200, [{
          id: clientId,
          display_name: '隔离测试客户',
          birth_date: '2018-01-01',
          created_at: '2026-07-30T00:00:00Z'
        }]);
      }
      if (url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')) {
        stored = body.p_interpretation_data;
        return response(200, {
          reportId,
          interpretationId: stored.id,
          status: stored.status,
          updatedAt: stored.updatedAt
        });
      }
      throw new Error(`unexpected fetch ${url.pathname}`);
    };

    const getRes = responseHarness();
    await reportTest.handleInterpretationGet(config, session, getRes, {
      query: { clientId, reportId }
    });
    assert.equal(getRes.statusCode, 200, 'GET 必须返回自己的 ready 报告');
    assert.equal(getRes.body.client.displayName, '隔离测试客户', 'GET 必须返回客户展示名');
    assert.equal(getRes.body.csrfToken, session.csrfToken, 'GET 必须返回当前 Session CSRF');

    let limited = false;
    const generateRes = responseHarness();
    await reportTest.handleInterpretationGenerate(config, session, generateRes, {
      clientId,
      reportId,
      clientConcerns: ['注意力'],
      customNotes: '先确认家长当前观察'
    }, advisorId, {
      consumeRateLimit: async (_config, scope, key) => {
        limited = scope === 'interpretation-generate-advisor' && key === advisorId;
      },
      callClaude: async () => ({ text: JSON.stringify({ steps: validSteps }) })
    });
    assert.equal(generateRes.statusCode, 200, '生成必须成功返回');
    assert.equal(generateRes.body.steps.length, 8, '生成必须返回 8 步');
    assert(limited, '生成必须执行指导师级限流');
    assert(stored && stored.status === 'generated', '生成结果必须经 RPC 保存');

    let reusedCalledModel = false;
    const reusedRes = responseHarness();
    await reportTest.handleInterpretationGenerate(config, session, reusedRes, {
      clientId,
      reportId,
      clientConcerns: [],
      customNotes: ''
    }, advisorId, {
      consumeRateLimit: async () => {},
      callClaude: async () => {
        reusedCalledModel = true;
        throw new Error('已有方案不得再次调用模型');
      }
    });
    assert.equal(reusedRes.statusCode, 200, '已有方案必须直接返回');
    assert.equal(reusedRes.body.reused, true, '已有方案必须标记 reused');
    assert.equal(reusedCalledModel, false, '已有方案不得重复生成');

    const saveRes = responseHarness();
    await reportTest.handleInterpretationSave(config, session, saveRes, {
      clientId,
      reportId,
      interpretationId: stored.id,
      editedSteps: validSteps.map((step, index) => index === 0 ? { ...step, say: ['指导师编辑话术'] } : step)
    });
    assert.equal(saveRes.statusCode, 200, '编辑结果必须保存成功');
    assert.equal(stored.status, 'edited', '保存后状态必须为 edited');
    assert.equal(stored.steps[0].say[0], '指导师编辑话术', '保存必须使用指导师编辑内容');

    await assert.rejects(
      () => reportTest.handleInterpretationSave(config, session, responseHarness(), {
        clientId,
        reportId,
        interpretationId: '99999999-9999-4999-8999-999999999999',
        editedSteps: validSteps
      }),
      (error) => error?.code === 'INTERPRETATION_CONFLICT',
      '错误 interpretation id 必须拒绝保存'
    );

    const rpcCall = calls.find((call) => call.url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation'));
    assert(rpcCall, '必须调用保存 RPC');
    assert.equal(rpcCall.init.headers.Authorization, `Bearer ${session.record.accessToken}`,
      '保存 RPC 必须使用当前 Session access token');
    assert(!JSON.stringify(rpcCall.body).includes(advisorId), '保存 payload 不得携带 advisor id');

    stored = null;
    let truncatedAttempts = 0;
    const saveCallsBeforeRetry = calls.filter((call) =>
      call.url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')).length;
    const retryRes = responseHarness();
    await reportTest.handleInterpretationGenerate(config, session, retryRes, {
      clientId,
      reportId,
      clientConcerns: [],
      customNotes: ''
    }, advisorId, {
      consumeRateLimit: async () => {},
      callClaude: async (options) => {
        truncatedAttempts += 1;
        assert.equal(options.timeoutMs, 45000, '首次 AI 请求必须保留完整生成时间');
        assert.equal(options.maxTokens, 3500, 'AI 输出上限必须受控，避免生成时间失控');
        assert.deepEqual(options.responseFormat, { type: 'json_object' }, 'AI 解读必须启用模型 JSON 输出模式');
        return truncatedAttempts === 1
          ? { text: JSON.stringify({ steps: validSteps }), finishReason: 'length' }
          : { text: JSON.stringify({ steps: validSteps }), finishReason: 'stop' };
      }
    });
    assert.equal(retryRes.statusCode, 200, '首次输出截断后必须重试并成功');
    assert.equal(truncatedAttempts, 2, '截断输出只允许额外重试一次');
    assert.equal(calls.filter((call) =>
      call.url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')).length - saveCallsBeforeRetry, 1,
    '重试成功后只能保存一次解读方案');

    stored = null;
    let transientAttempts = 0;
    const transientRes = responseHarness();
    await reportTest.handleInterpretationGenerate(config, session, transientRes, {
      clientId,
      reportId,
      clientConcerns: [],
      customNotes: ''
    }, advisorId, {
      consumeRateLimit: async () => {},
      callClaude: async () => {
        transientAttempts += 1;
        if (transientAttempts === 1) throw new Error('temporary upstream failure');
        return { text: JSON.stringify({ steps: validSteps }), finishReason: 'stop' };
      }
    });
    assert.equal(transientRes.statusCode, 200, '瞬时上游失败后必须重试并成功');
    assert.equal(transientAttempts, 2, '瞬时失败只允许额外重试一次');

    stored = null;
    let invalidAttempts = 0;
    await assert.rejects(
      () => reportTest.handleInterpretationGenerate(config, session, responseHarness(), {
        clientId,
        reportId,
        clientConcerns: [],
        customNotes: ''
      }, advisorId, {
        consumeRateLimit: async () => {},
        callClaude: async () => {
          invalidAttempts += 1;
          return { text: JSON.stringify({ steps: validSteps.slice(0, 7) }), finishReason: 'stop' };
        }
      }),
      (error) => error?.code === 'AI_OUTPUT_INVALID',
      '不足 8 步的模型输出必须拒绝且不得保存'
    );
    assert.equal(invalidAttempts, 2, '格式异常输出只允许额外重试一次');

    hideReport = true;
    await assert.rejects(
      () => reportTest.handleInterpretationGet(config, session, responseHarness(), { query: { clientId, reportId } }),
      (error) => error?.code === 'REPORT_NOT_FOUND',
      'RLS 不可见报告必须按不存在处理'
    );
  } finally {
    global.fetch = originalFetch;
  }
}

testBffFlows()
  .then(() => console.log('PASS: V3A AI interpretation MVP contract'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
