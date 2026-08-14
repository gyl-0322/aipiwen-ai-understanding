const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

let assertions = 0;
function assert(condition, message) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function includes(source, text, message) {
  assert(source.includes(text), message);
}

function throwsCode(fn, code, message) {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert(thrown?.code === code, message);
}

const pages = [
  ['ai-interpreter-workbench.html', 'workbench'],
  ['ai-interpreter-customers.html', 'customers'],
  ['client-360.html', 'client-360'],
  ['ai-interpreter-session.html', 'session'],
  ['ai-coaching-assistant.html', 'coaching'],
  ['growth-record.html', 'growth-record'],
  ['ai-interpreter-training.html', 'training'],
  ['ai-interpreter-review.html', 'review'],
  ['ai-interpreter-cases.html', 'cases']
];
const navLinks = [
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'client-360.html',
  'ai-interpreter-customers.html?intent=interpret#v3a-real-customers',
  'ai-coaching-assistant.html',
  'growth-record.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];

for (const [file, page] of pages) {
  assert(exists(file), `${file} 必须存在`);
  const html = read(file);
  includes(html, `data-page="${page}"`, `${file} 必须声明正确 data-page`);
  assert((html.match(/class="nav-link"/g) || []).length === 9, `${file} 必须有 9 项导航`);
  for (const href of navLinks) includes(html, `href="${href}"`, `${file} 缺少导航 ${href}`);
  includes(html, 'static/v3a-auth.js', `${file} 必须继续使用 V3A Session`);
}

const css = read('static/ai-interpreter.css');
includes(css, 'V4.0 新增样式', '必须追加 V4 CSS 区块');
for (const selector of ['.stage-tag', '.case-candidate-tag', '.coaching-output', '.timeline-list', '.archive-tabs', '.case-modal-overlay']) {
  includes(css, selector, `V4 CSS 缺少 ${selector}`);
}

const workbench = read('ai-interpreter-workbench.html');
includes(workbench, 'id="clueList"', '工作台必须包含今日辅导线索容器');
includes(workbench, 'static/v3a-workbench-clues.js', '工作台必须加载辅导线索脚本');

const customers = read('ai-interpreter-customers.html');
for (const id of ['v3a-customer-stage-filter', 'v3a-real-customers-list']) includes(customers, `id="${id}"`, `客户页缺少 ${id}`);
includes(customers, 'static/v3a-customers-stage.js', '客户页必须加载阶段脚本');
includes(customers, 'static/v3a-case-cards.js', '客户页必须加载案例脚本');

const client360 = read('client-360.html');
for (const tab of ['fingerprint', 'timeline', 'service', 'action-plan']) includes(client360, `data-tab="${tab}"`, `客户 360 缺少 ${tab} Tab`);
includes(client360, 'static/v3a-client-360.js', '客户 360 必须加载交互脚本');

const coaching = read('ai-coaching-assistant.html');
for (const id of ['contextPanel', 'topicInput', 'btnGenerate', 'coachingOutput', 'scriptOutput', 'btnSaveRecord']) includes(coaching, `id="${id}"`, `AI 辅导页缺少 ${id}`);
includes(coaching, 'static/v3a-coaching.js', 'AI 辅导页必须加载交互脚本');

const growth = read('growth-record.html');
for (const id of ['recordForm', 'selectPerson', 'recordContent', 'timelineList']) includes(growth, `id="${id}"`, `成长记录页缺少 ${id}`);
includes(growth, 'static/v3a-growth-record.js', '成长记录页必须加载交互脚本');

const cases = read('ai-interpreter-cases.html');
for (const id of ['myCasesSection', 'sharedSection', 'caseModal']) includes(cases, `id="${id}"`, `案例页缺少 ${id}`);
includes(cases, 'static/v3a-case-cards.js', '案例页必须加载案例脚本');

for (const file of [
  'static/v3a-workbench-clues.js',
  'static/v3a-customers-stage.js',
  'static/v3a-client-360.js',
  'static/v3a-coaching.js',
  'static/v3a-growth-record.js',
  'static/v3a-case-cards.js'
]) assert(exists(file), `${file} 必须存在`);

const migrationFile = 'supabase/migrations/033_v3a_advisor_workbench_v4_foundation.sql';
assert(exists(migrationFile), 'V4 foundation migration 必须存在');
const migration = read(migrationFile);
for (const table of ['growth_records', 'coaching_sessions', 'service_stage_log', 'case_card']) {
  includes(migration, `create table public.${table}`, `migration 必须创建 ${table}`);
  includes(migration, `alter table public.${table} enable row level security`, `${table} 必须启用 RLS`);
}
for (const rpc of [
  'v3a_create_growth_record',
  'v3a_create_coaching_session',
  'v3a_create_case_card',
  'v3a_update_case_card',
  'v3a_submit_case_card',
  'v3a_review_case_card',
  'v3a_delete_case_card'
]) includes(migration, `function public.${rpc}`, `migration 缺少 ${rpc}`);
assert(!/delete\s+from\s+public\.(users|advisor_clients|advisor_reports)/i.test(migration), 'migration 不得删除用户、客户或报告');
assert(!/\bauth\.users\b[\s\S]*\b(insert|update|delete)\b/i.test(migration), 'migration 不得修改 Auth identity');
for (const table of ['growth_records', 'coaching_sessions', 'service_stage_log', 'case_card']) {
  assert(!new RegExp(`grant\\s+(?:insert|update|delete)[^;]*public\\.${table}`, 'i').test(migration), `${table} 不得授予浏览器直接写权限`);
}

const attributionApi = read('api/v3a-attribution.js');
for (const action of ['client-data-center', 'client-data-center-clues', 'client-data-center-stage-summary', 'client-data-center-person-list', 'growth-records', 'coaching-sessions', 'case-cards', 'case-candidates']) {
  includes(attributionApi, `'${action}'`, `聚合 BFF 缺少 action ${action}`);
}
includes(attributionApi, 'requireSameOrigin(req, config)', 'V4 写操作必须校验 SameOrigin');
includes(attributionApi, 'requireCsrf(req, loaded)', 'V4 写操作必须校验 CSRF');

const reportImportApi = read('api/v3a-report-import.js');
includes(reportImportApi, "action === 'coaching-suggestion'", '报告 BFF 必须承载 AI 辅导建议路由');
includes(reportImportApi, "'v4-coaching-suggestion-advisor'", 'AI 辅导建议必须使用独立限流作用域');

const workbenchV4 = require('../server/v3a-workbench-v4')._test;
assert(workbenchV4.localizedDomains(['learning', 'emotion']).join('、') === '学习、情绪', '辅导线索领域必须使用中文标签');
assert(workbenchV4.localizedDomains(['unknown']).length === 0, '未知领域值不得直接暴露到用户文案');
assert(workbenchV4.stageFor([{ status: 'ready' }], []) === 'early', '单份 ready 报告应进入早期跟进阶段');
assert(workbenchV4.stageFor([{ status: 'ready' }, { status: 'ready' }], []) === 'deep', '两份 ready 报告应进入深度辅导阶段');
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { atd: 30, fingers: {} } }]) === true, '边界 ATD ≤34 应标记案例候选');
// candidateFromReports 四条规则全覆盖（true + false 双向）
const finger = (trc, sym) => ({ trc, sym });
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { fingers: { L1: finger(3, 'W'), L2: finger(2, 'W'), L3: finger(3, 'W'), L4: finger(2, 'W'), R1: finger(3, 'W'), R2: finger(3, 'W'), R3: finger(2, 'W'), R4: finger(3, 'W'), L5: finger(2, 'W'), R5: finger(2, 'W') } } }]) === true, '总TRC≤50 十指应触发候选');
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { fingers: { L1: finger(30, 'W'), L2: finger(30, 'W'), L3: finger(30, 'W'), L4: finger(30, 'W'), R1: finger(30, 'W'), R2: finger(30, 'W'), R3: finger(30, 'W'), R4: finger(30, 'W'), L5: finger(30, 'W'), R5: finger(30, 'W') } } }]) === true, '总TRC≥280 十指应触发候选');
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { atd: 48, fingers: {} } }]) === true, 'ATD≥46 应触发候选');
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { fingers: { L1: finger(15, 'W'), L2: finger(15, 'W'), L3: finger(15, 'W'), L4: finger(15, 'W'), R1: finger(15, 'W'), R2: finger(15, 'W'), R3: finger(15, 'W'), R4: finger(15, 'W'), L5: finger(15, 'W'), R5: finger(15, 'W') } } }]) === true, '全指同纹型 W 应触发候选');
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { fingers: { L1: finger(15, 'X'), L2: finger(15, 'X'), L3: finger(15, 'X'), L4: finger(15, 'L'), R1: finger(15, 'Xn'), R2: finger(15, 'X'), R3: finger(15, 'L'), R4: finger(15, 'X'), L5: finger(15, 'X'), R5: finger(15, 'L') } } }]) === true, '弧型≥5 指应触发候选（X+Xn≥5）');
// false 分支：正常范围内不应触发
assert(workbenchV4.candidateFromReports([{ status: 'ready', structured_input: { atd: 39, fingers: { L1: finger(15, 'W'), L2: finger(14, 'W'), L3: finger(13, 'W'), L4: finger(12, 'L'), R1: finger(15, 'W'), R2: finger(14, 'L'), R3: finger(13, 'W'), R4: finger(12, 'W'), L5: finger(11, 'L'), R5: finger(10, 'W') } } }]) === false, '正常范围客户不应触发候选');
for (const status of ['pending', 'generating', 'failed']) {
  assert(workbenchV4.candidateFromReports([{ status, structured_input: { atd: 30, fingers: {} } }]) === false, `${status} 状态报告不参与候选检测`);
}
assert(workbenchV4.candidateFromReports([]) === false, '空报告列表不应触发候选');
throwsCode(() => workbenchV4.validateGrowthBody({ person_id: 'bad' }), 'INVALID_GROWTH_RECORD', '成长记录必须拒绝非法客户标识');
throwsCode(() => workbenchV4.validateCaseBody({ person_id: 'bad' }), 'INVALID_CASE_CARD', '案例必须拒绝非法输入');

process.env.SESSION_SECRET ||= 'TEST_ONLY_SESSION_SECRET_NOT_FOR_RUNTIME';
const reportImportTest = require('../api/v3a-report-import')._test;
throwsCode(() => reportImportTest.validateCoachingSuggestionBody({ advisorId: 'forbidden' }), 'ADVISOR_ID_NOT_ALLOWED', '辅导建议不得接收 advisorId');
const validSuggestion = reportImportTest.parseCoachingSuggestion(JSON.stringify({
  understanding: '现有记录显示客户在学习安排上出现反复，需要先确认近期环境和任务是否发生变化。',
  direction: '先邀请家长描述事实，再核对报告中的学习通道和反应节奏，最后共同确定一个可观察的小行动。',
  script: '我们先不急着判断原因。请您回想最近一次出现这个情况时，前后分别发生了什么，再一起看看哪种支持方式更适合。',
  risks: [{ level: 'warning', text: '不要把一次行为直接归因于固定性格。' }],
  knowledge_refs: ['A1:v1.0']
}));
assert(validSuggestion.risks.length === 1, '安全的四段式辅导建议应通过校验');
throwsCode(() => reportImportTest.parseCoachingSuggestion(JSON.stringify({
  understanding: '这段内容足够长但宣称客户未来一定会成功，因此应被安全校验拒绝。',
  direction: '建议先理解情况并逐步确认现实场景中的信息，再形成可以观察和调整的沟通目标。',
  script: '可以先邀请客户描述最近发生的真实事件，再共同确认一个小行动，并约定后续观察反馈。',
  risks: [{ level: 'warning', text: '避免标签。' }]
})), 'AI_COACHING_OUTPUT_INVALID', '辅导建议必须拒绝结果保证');

const coachingClient = read('static/v3a-coaching.js');
for (const field of ["['五功能区']", "['总TRC']", "['ATD']", "['主性格类型']", "['学习通道']", "['主通道']"]) {
  includes(coachingClient, field, `AI 辅导左栏缺少先天配置字段 ${field}`);
}

const vercel = JSON.parse(read('vercel.json'));
assert(Object.keys(vercel.functions || {}).length === 12, 'Vercel Function Budget 必须保持 12/12');
const routeSources = (vercel.routes || []).map((route) => route.src);
for (const route of ['/api/v3a-client-data-center', '/api/v3a-growth-records', '/api/v3a-coaching-suggestion', '/api/v3a-coaching-sessions', '/api/v3a-case-cards']) {
  assert(routeSources.includes(route), `vercel.json 缺少 ${route}`);
}

console.log(`AIPIWEN V4 contract PASS (${assertions} assertions)`);
