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
const migrationV3Path = 'supabase/migrations/030_v3a_advisor_interpretation_v3.sql';
const helperPath = 'server/v3a-interpretation.js';
assert(exists(migrationPath), '缺少 Migration 029');
assert(exists(migrationV3Path), '缺少 Migration 030');
assert(exists(helperPath), '缺少 AI 解读输出校验模块');

const migration = read(migrationPath);
const migrationV3 = read(migrationV3Path);
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

assert(/^begin;[\s\S]*commit;\s*$/m.test(migrationV3), 'Migration 030 必须为单事务');
assert(/MIGRATION_030_REQUIRES_MIGRATION_029/.test(migrationV3), 'Migration 030 必须验证 029 基线');
assert(/version' = '1'[\s\S]*jsonb_array_length\(interpretation_data -> 'steps'\) = 8/.test(migrationV3),
  'Migration 030 必须兼容旧版 8 步数据');
assert(/version' = '3'[\s\S]*status' = 'generating'[\s\S]*in \(2, 4, 6, 8, 10, 12, 14\)/.test(migrationV3),
  'Migration 030 必须只允许偶数板块的 V3 分段状态');
assert(/status' in \('generated', 'edited'\)[\s\S]*jsonb_array_length\(interpretation_data -> 'steps'\) = 16/.test(migrationV3),
  'Migration 030 必须要求完成态正好 16 个板块');
assert(/create or replace function public\.v3a_save_advisor_interpretation\(/.test(migrationV3),
  'Migration 030 必须同步升级受控保存 RPC');
assert(/revoke all on function public\.v3a_save_advisor_interpretation[\s\S]*grant execute[\s\S]*to authenticated;/.test(migrationV3),
  'Migration 030 不得扩大 RPC 权限');
assert(!/delete from public\.(?:users|advisor_clients|advisor_reports)/i.test(migrationV3),
  'Migration 030 不得删除用户、客户或报告');

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

assert(/const STEP_TITLES/.test(helperSource), '必须冻结结构化解读板块标题');
assert(/UNSAFE_AI_OUTPUT/.test(helperSource), '必须拒绝不安全 AI 输出');
assert(/AI_OUTPUT_INVALID/.test(helperSource), '必须拒绝非结构化 AI 输出');
assert(!/每个内容字段只写1条|单条不超过60个汉字/.test(helperSource),
  '详细版不得继续把每个字段压缩成 1 条或 60 字');
for (const moduleName of ['TRC', 'ATD', '左右脑', '性格类型', '学习通道', '行为模式',
  '精神功能', '思维功能', '体觉功能', '听觉功能', '视觉功能']) {
  assert(helperSource.includes(moduleName), `详细版提示词必须覆盖完整版报告模块：${moduleName}`);
}
assert(/DETAILED_INTERPRETATION_VERSION\s*=\s*3/.test(reportBff), '16 板块详细版必须使用独立版本号');
assert(/validateDetailedPrefix/.test(reportBff) && /progress:\s*\{ completed: steps\.length/.test(reportBff),
  'BFF 必须校验并返回可恢复的分段进度');
assert(/requestIndex\s*=\s*0; requestIndex\s*<\s*8/.test(sessionJs),
  '前端必须按顺序请求 8 组板块，避免单个 Serverless 请求超时');

assert(!/id="generate-plan"/.test(sessionHtml) && /await generateInterpretation\(\)/.test(sessionJs),
  '首次进入真实报告必须自动生成方案，不保留重复生成按钮');
assert(/结构化解读路径/.test(sessionHtml) && /第 1\/16 个板块/.test(sessionHtml),
  '解读页必须展示 16 板块结构，不得继续写成 8 步');
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
const legacySteps = interpretation.LEGACY_STEP_TITLES.map((title, stepIndex) => ({
  stepIndex,
  title,
  why: ['原因'],
  say: ['可以这样说'],
  ask: ['可以这样问'],
  no: ['不要贴标签'],
  action: ['记录反馈'],
  risk: ['注意边界']
}));
const detailedSteps = interpretation.STEP_TITLES.map((title, stepIndex) => ({
  stepIndex,
  title,
  why: ['解释本步骤与报告数据的关系', '说明本步骤对本次沟通的价值'],
  say: ['先用生活场景建立理解', '再连接报告里的具体数据', '最后确认客户是否有共鸣'],
  ask: ['您在日常生活中见过类似表现吗', '哪一个场景最希望先改善'],
  no: ['不要把数值解释成能力高低', '不要把当前表现预测成未来结果'],
  action: ['记录一个真实生活场景', '选择一个可以立即尝试的小动作', '约定一周后的观察指标'],
  risk: ['资料不足时明确说明需要继续核对', '出现专业风险时建议寻求相应专业支持']
}));
assert.deepEqual(interpretation.STEP_TITLES, [
  '建立安全感', '严正声明四原则', '性格类型', 'TRC', 'ATD', '学习通道', '行为模式', '左右脑',
  '精神功能', '思维功能', '体觉功能', '听觉功能', '视觉功能', '客户关注问题', '行动建议',
  '记录客户反馈 / 必要时提交总部复核'
], '16 个解读板块必须按完整版报告习惯顺序冻结');
assert.equal(interpretation.validateSteps(validSteps).length, 16, '必须接受合法 16 板块输出');
assert.equal(interpretation.validateSteps(legacySteps).length, 8, '必须继续接受人工编辑过的旧 8 步方案');
assert.equal(interpretation.validateDetailedSteps(detailedSteps).length, 16,
  '必须接受内容完整的详细版 16 板块输出');
assert.throws(() => interpretation.validateDetailedSteps(validSteps), /AI_OUTPUT_INVALID/,
  '每字段只有 1 条的旧简版不得伪装成详细版');
assert.throws(() => interpretation.validateSteps(validSteps.slice(0, 15)), /AI_OUTPUT_INVALID/,
  '必须拒绝不足 16 板块且不属于旧 8 步的方案');
assert.throws(() => interpretation.validateSteps(validSteps.map((step, index) =>
  index === 0 ? { ...step, say: ['孩子以后一定会成功'] } : step)), /UNSAFE_AI_OUTPUT/,
  '必须拒绝预测性话术');

const parsed = interpretation.parseModelText(`\`\`\`json\n${JSON.stringify({ steps: validSteps })}\n\`\`\``);
assert.equal(parsed.length, 16, '必须解析 fenced JSON');
assert.throws(() => interpretation.validateGenerateBody({ reportId: 'bad', clientId: 'bad' }), /INVALID_REPORT_ID/,
  '必须拒绝非法报告 ID');
assert.throws(() => interpretation.validateGenerateBody({
  reportId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  advisorId: '33333333-3333-4333-8333-333333333333'
}), /ADVISOR_ID_NOT_ALLOWED/, '不得接受浏览器 advisorId');

const scopedPrompt = interpretation.buildPrompt({
  structured_input: { reportType: '测试报告', engineResult: {} },
  generated_report: { sections: [
    { title: 'TRC（认知结构）', content: 'TRC_SCOPE_MARKER' },
    { title: '视觉功能（小指系统）', content: 'VISUAL_SCOPE_MARKER' }
  ] }
}, { display_name: '隔离测试客户' }, { clientConcerns: [], customNotes: null }, [2, 3]);
assert(scopedPrompt.user.includes('TRC_SCOPE_MARKER'), '每组提示词必须携带当前板块对应的报告片段');
assert(!scopedPrompt.user.includes('VISUAL_SCOPE_MARKER'), '每组提示词不得重复携带无关报告片段');

function detailedChunkForOptions(options, source = detailedSteps) {
  const prompt = String(options?.messages?.[0]?.content || '');
  const block = prompt.match(/本次必须且只能生成以下板块：\n([\s\S]*?)\n每个板块必须包含/)?.[1] || '';
  const indexes = [...block.matchAll(/^(1[0-5]|[0-9])\./gm)].map((match) => Number(match[1]));
  assert.deepEqual(indexes.length, 2, '每次模型调用必须只生成连续 2 个板块');
  return source.filter((step) => indexes.includes(step.stepIndex));
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function normalizeEq(value) {
  return String(value || '').replace(/^eq\./, '');
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
  const secondReportId = '44444444-4444-4444-8444-444444444444';
  const secondClientId = '55555555-5555-4555-8555-555555555555';
  const session = { csrfToken: 'TEST_CSRF_NOT_REAL', record: { accessToken: 'TEST_ACCESS_TOKEN_NOT_REAL' } };
  const config = { supabaseUrl: 'https://project.supabase.co', anonKey: 'TEST_ANON_KEY_NOT_REAL' };
  let stored = null;
  let secondStored = null;
  let hideReport = false;
  const calls = [];
  try {
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url, init, body });
      if (url.pathname === '/rest/v1/advisor_reports') {
        const requestedReportId = normalizeEq(url.searchParams.get('id'));
        const requestedClientId = normalizeEq(url.searchParams.get('advisor_client_id'));
        const isSecond = requestedReportId === secondReportId && requestedClientId === secondClientId;
        const isFirst = requestedReportId === reportId && requestedClientId === clientId;
        if (!isFirst && !isSecond) return response(200, []);
        return response(200, hideReport ? [] : [{
          id: isSecond ? secondReportId : reportId,
          advisor_client_id: isSecond ? secondClientId : clientId,
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
          interpretation_data: isSecond ? secondStored : stored,
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:00:00Z'
        }]);
      }
      if (url.pathname === '/rest/v1/advisor_clients') {
        const requestedClientId = normalizeEq(url.searchParams.get('id'));
        const isSecond = requestedClientId === secondClientId;
        if (requestedClientId !== clientId && !isSecond) return response(200, []);
        return response(200, [{
          id: isSecond ? secondClientId : clientId,
          display_name: isSecond ? '第二位隔离测试客户' : '隔离测试客户',
          birth_date: '2018-01-01',
          created_at: '2026-07-30T00:00:00Z'
        }]);
      }
      if (url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')) {
        if (body.p_report_id === secondReportId) secondStored = body.p_interpretation_data;
        else stored = body.p_interpretation_data;
        const saved = body.p_report_id === secondReportId ? secondStored : stored;
        return response(200, {
          reportId: body.p_report_id,
          interpretationId: saved.id,
          status: saved.status,
          updatedAt: saved.updatedAt
        });
      }
      throw new Error(`unexpected fetch ${url.pathname}`);
    };

    async function generateComplete(targetClientId, targetReportId, dependencies) {
      const partialProgress = [];
      for (let requestIndex = 0; requestIndex < 8; requestIndex += 1) {
        const result = responseHarness();
        await reportTest.handleInterpretationGenerate(config, session, result, {
          clientId: targetClientId,
          reportId: targetReportId,
          clientConcerns: ['注意力'],
          customNotes: '先确认家长当前观察'
        }, advisorId, dependencies);
        if (result.body.complete === true) return { result, partialProgress };
        partialProgress.push(result.body.progress?.completed);
      }
      throw new Error('测试中的分段方案未在 8 次请求内完成');
    }

    const getRes = responseHarness();
    await reportTest.handleInterpretationGet(config, session, getRes, {
      query: { clientId, reportId }
    });
    assert.equal(getRes.statusCode, 200, 'GET 必须返回自己的 ready 报告');
    assert.equal(getRes.body.client.displayName, '隔离测试客户', 'GET 必须返回客户展示名');
    assert.equal(getRes.body.csrfToken, session.csrfToken, 'GET 必须返回当前 Session CSRF');

    let limitedCount = 0;
    const generated = await generateComplete(clientId, reportId, {
      consumeRateLimit: async (_config, scope, key) => {
        if (scope === 'interpretation-generate-advisor' && key === advisorId) limitedCount += 1;
      },
      callClaude: async (options) => ({
        text: JSON.stringify({ steps: detailedChunkForOptions(options) }),
        finishReason: 'stop'
      })
    });
    const generateRes = generated.result;
    assert.equal(generateRes.statusCode, 200, '生成必须成功返回');
    assert.equal(generateRes.body.steps.length, 16, '生成必须返回 16 个结构化板块');
    assert.deepEqual(generated.partialProgress, [2, 4, 6, 8, 10, 12, 14],
      '每次请求必须只保存两个板块并准确返回进度');
    assert.equal(limitedCount, 1, '同一份分段方案只能在首次请求执行一次指导师级限流');
    assert(stored && stored.status === 'generated', '生成结果必须经 RPC 保存');

    let reusedCalledModel = false;
    let reusedConsumedQuota = false;
    const reusedRes = responseHarness();
    await reportTest.handleInterpretationGenerate(config, session, reusedRes, {
      clientId,
      reportId,
      clientConcerns: [],
      customNotes: ''
    }, advisorId, {
      consumeRateLimit: async () => {
        reusedConsumedQuota = true;
      },
      callClaude: async () => {
        reusedCalledModel = true;
        throw new Error('已有方案不得再次调用模型');
      }
    });
    assert.equal(reusedRes.statusCode, 200, '已有方案必须直接返回');
    assert.equal(reusedRes.body.reused, true, '已有方案必须标记 reused');
    assert.equal(reusedCalledModel, false, '已有方案不得重复生成');
    assert.equal(reusedConsumedQuota, false, '读取已有方案不得消耗新方案生成额度');

    secondStored = {
      version: 1,
      id: '66666666-6666-4666-8666-666666666666',
      status: 'edited',
      steps: legacySteps,
      createdAt: '2026-07-30T00:00:00Z',
      updatedAt: '2026-07-30T00:00:00Z'
    };
    const legacyEditedGetRes = responseHarness();
    await reportTest.handleInterpretationGet(config, session, legacyEditedGetRes, {
      query: { clientId: secondClientId, reportId: secondReportId }
    });
    assert.equal(legacyEditedGetRes.body.interpretation.steps.length, 8,
      '指导师人工编辑过的旧方案必须保留，不得被详细版升级覆盖');

    secondStored = {
      version: 1,
      id: '66666666-6666-4666-8666-666666666666',
      status: 'generated',
      steps: legacySteps,
      createdAt: '2026-07-30T00:00:00Z',
      updatedAt: '2026-07-30T00:00:00Z'
    };
    const secondGetRes = responseHarness();
    await reportTest.handleInterpretationGet(config, session, secondGetRes, {
      query: { clientId: secondClientId, reportId: secondReportId }
    });
    assert.equal(secondGetRes.body.interpretation, null,
      '第二位客户未经人工编辑的旧简版必须自动升级为详细版');

    let secondCalledModel = false;
    const secondGenerated = await generateComplete(secondClientId, secondReportId, {
      consumeRateLimit: async () => {},
      callClaude: async (options) => {
        secondCalledModel = true;
        return { text: JSON.stringify({ steps: detailedChunkForOptions(options) }), finishReason: 'stop' };
      }
    });
    const secondGenerateRes = secondGenerated.result;
    assert.equal(secondGenerateRes.statusCode, 200, '同一指导师的第二位客户也必须生成成功');
    assert.equal(secondCalledModel, true, '第二位客户的旧简版不得阻止详细版重新生成');
    assert(secondStored && secondStored.status === 'generated', '第二位客户方案必须独立保存');
    assert.notEqual(secondStored.id, stored.id, '不同客户不得复用同一个解读方案标识');

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
    const truncatedAttempts = new Map();
    const saveCallsBeforeRetry = calls.filter((call) =>
      call.url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')).length;
    const retryGenerated = await generateComplete(clientId, reportId, {
      consumeRateLimit: async () => {},
      callClaude: async (options) => {
        const chunk = detailedChunkForOptions(options);
        const key = chunk[0].stepIndex;
        const attempt = (truncatedAttempts.get(key) || 0) + 1;
        truncatedAttempts.set(key, attempt);
        assert(options.timeoutMs > 0 && options.timeoutMs <= 52000, 'AI 请求必须在函数时限内完成');
        assert.equal(options.maxTokens, 3200, '每两个板块必须获得足够且受控的输出空间');
        assert.deepEqual(options.responseFormat, { type: 'json_object' }, 'AI 解读必须启用模型 JSON 输出模式');
        return key === 0 && attempt === 1
          ? { text: JSON.stringify({ steps: chunk }), finishReason: 'length' }
          : { text: JSON.stringify({ steps: chunk }), finishReason: 'stop' };
      }
    });
    const retryRes = retryGenerated.result;
    assert.equal(retryRes.statusCode, 200, '首次输出截断后必须重试并成功');
    assert.equal(truncatedAttempts.get(0), 2, '截断的步骤组只允许额外重试一次');
    for (const key of [2, 4, 6, 8, 10, 12, 14]) {
      assert.equal(truncatedAttempts.get(key), 1, '未截断的步骤组不得重复生成');
    }
    assert.equal(calls.filter((call) =>
      call.url.pathname.endsWith('/rpc/v3a_save_advisor_interpretation')).length - saveCallsBeforeRetry, 8,
    '每个成功板块组必须只保存一次，失败重试不得额外写入');

    stored = null;
    const transientAttempts = new Map();
    const transientGenerated = await generateComplete(clientId, reportId, {
      consumeRateLimit: async () => {},
      callClaude: async (options) => {
        const chunk = detailedChunkForOptions(options);
        const key = chunk[0].stepIndex;
        const attempt = (transientAttempts.get(key) || 0) + 1;
        transientAttempts.set(key, attempt);
        if (key === 0 && attempt === 1) throw new Error('temporary upstream failure');
        return { text: JSON.stringify({ steps: chunk }), finishReason: 'stop' };
      }
    });
    const transientRes = transientGenerated.result;
    assert.equal(transientRes.statusCode, 200, '瞬时上游失败后必须重试并成功');
    assert.equal(transientAttempts.get(0), 2, '瞬时失败的步骤组只允许额外重试一次');
    for (const key of [2, 4, 6, 8, 10, 12, 14]) {
      assert.equal(transientAttempts.get(key), 1, '未失败的步骤组不得重复生成');
    }

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
        callClaude: async (options) => {
          invalidAttempts += 1;
          return {
            text: JSON.stringify({ steps: detailedChunkForOptions(options).slice(0, 1) }),
            finishReason: 'stop'
          };
        }
      }),
      (error) => error?.code === 'AI_OUTPUT_INVALID',
      '步骤组不完整的模型输出必须拒绝且不得保存'
    );
    assert.equal(invalidAttempts, 2, '当前格式异常步骤组只允许额外重试一次，且不得进入下一组');

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
