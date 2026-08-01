#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api/generate-report.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceBetween(startMarker, endMarker) {
  const start = apiSource.indexOf(startMarker);
  const end = apiSource.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `无法提取源码：${startMarker}`);
  return apiSource.slice(start, end);
}

assert(apiSource.includes('FUNCTION_MODULE_FINGER_POSITIONS'), '缺少五大功能单指位置映射');
assert(apiSource.includes('validateReportNumericConsistency(fingers, engineResult)'), '生成前没有校验十指与功能合计');
assert(apiSource.includes('isRequiredModuleComplete(title, content, fingers, engineResult)'), '生成后没有校验板块完整性与单指数值');
assert(apiSource.includes('normalizeSections(parsedSections, requiredMods, selectedIssues, engineResult, tier, fingers)'), '正文归一化没有使用原始十指数据');
assert(apiSource.includes('【五大功能区单指明细】'), 'Prompt 没有向模型提供五大功能单指明细');

const coreTokenMatch = apiSource.match(/maxTokens:\s*partIssues\.length\s*\?\s*(\d+)\s*:\s*(\d+)/);
assert(coreTokenMatch && Number(coreTokenMatch[1]) >= 1200, '两题一批的问题输出 token 上限不足');
assert(coreTokenMatch && Number(coreTokenMatch[2]) >= 1700, '两个固定模块一批的输出 token 上限不足');
assert(apiSource.includes('chunkModules(requiredMods, 2)'), '固定模块没有按两个一批拆分，仍有截断风险');
assert(apiSource.includes('chunkModules(selectedIssues, 2)'), '用户问题没有按两个一批拆分，仍有截断风险');

const helperSource = [
  sourceBetween('function getAudienceStyle', '// ── 必给模块'),
  sourceBetween('function stripRequiredModuleScaffold', 'function parseSections'),
  sourceBetween('function coreModuleFallback', 'function classifyIssueType'),
  sourceBetween('const FUNCTION_MODULE_FINGER_REQUIREMENTS', 'function chunkModules'),
  sourceBetween('function validateReportNumericConsistency', 'module.exports = async function handler'),
].join('\n');

const sandbox = {};
vm.runInNewContext(`${helperSource}
this.coreModuleFallback = coreModuleFallback;
this.isRequiredModuleComplete = isRequiredModuleComplete;
this.normalizeSections = normalizeSections;
this.validateReportNumericConsistency = validateReportNumericConsistency;`, sandbox);

const fingers = {
  R1:{trc:14}, L1:{trc:17},
  R2:{trc:12}, L2:{trc:13},
  R3:{trc:7},  L3:{trc:16},
  R4:{trc:15}, L4:{trc:14},
  R5:{trc:11}, L5:{trc:12},
};

const engineResult = {
  主性格类型: '完美兼模仿型',
  五功能区: {
    精神:31, 思维:25, 体觉:23, 听觉:29, 视觉:23,
    总TRC:131, 个人均值:13.1,
  },
  学习通道:{ 主通道:'听觉型' },
  行为模式:{ 结论:'动机型' },
  左右脑:{ 结论:'右脑型', 左脑占比:45 },
  ATD:{ 值:39, 分区:'敏感灵活型' },
};

function uniformSample(value) {
  const uniformFingers = Object.fromEntries(
    ['R1','L1','R2','L2','R3','L3','R4','L4','R5','L5'].map(position => [position, { trc:value }])
  );
  const areaTotal = value * 2;
  return {
    fingers: uniformFingers,
    engineResult: {
      五功能区: {
        精神:areaTotal, 思维:areaTotal, 体觉:areaTotal, 听觉:areaTotal, 视觉:areaTotal,
        总TRC:value * 10, 个人均值:value,
      },
    },
  };
}

assert(sandbox.validateReportNumericConsistency(fingers, engineResult) === null, '正确的真实样本未通过数值一致性校验');
for (const boundary of [0, 40]) {
  const sample = uniformSample(boundary);
  assert(
    sandbox.validateReportNumericConsistency(sample.fingers, sample.engineResult) === null,
    `单指边界值 ${boundary} 未通过数值一致性校验`
  );
}
assert(
  sandbox.validateReportNumericConsistency(fingers, { ...engineResult, 五功能区:{ ...engineResult.五功能区, 精神:62 } })
    ?.includes('精神功能合计'),
  '错误功能合计没有被拦截'
);

const correctMental = [
  '精神功能分别看右拇和左拇，不把合计值拿去和单指均值比较。右拇代表开创、目标和对外发起；左拇代表管理、执行和自我约束。两边共同构成一个人启动事情和管理自己的方式。',
  '右拇数值为14，略高于个人均值13.1；左拇数值为17，明显高于个人均值13.1。左拇比右拇高3，说明管理和收尾更容易先被调动，开创入口并不是没有，而是更需要明确目标来启动。',
  '学习中可以先把计划和完成标准说清楚，再给一个能够自己决定的小挑战。右拇负责把事情发起，左拇负责维持节奏；连续观察真实表现，再校正报告线索，不用一次表现给人定型。'
].join('\n\n');

assert(sandbox.isRequiredModuleComplete('精神功能（拇指系统）', correctMental, fingers, engineResult), '正确精神功能页被误判为不完整');
assert(sandbox.isRequiredModuleComplete('精神功能（拇指系统）', correctMental.replace(/。$/, '……'), fingers, engineResult), '中文省略号结尾被误判为截断');
assert(!sandbox.isRequiredModuleComplete('精神功能（拇指系统）', correctMental.replace('右拇数值为14', '右拇数值为31').replace('左拇数值为17', '左拇数值为31'), fingers, engineResult), '合计31被复制成两根拇指数值时没有被拦截');

const reversedBody = correctMental
  .replaceAll('精神功能', '体觉功能')
  .replaceAll('右拇', '右中')
  .replaceAll('左拇', '左中')
  .replace('右中数值为14', '右中数值为7')
  .replace('左中数值为17', '左中数值为16')
  .replace('略高于个人均值13.1', '明显低于个人均值13.1')
  .replace('左中比右中高3', '右中比左中高9');
assert(!sandbox.isRequiredModuleComplete('体觉功能（中指系统）', reversedBody, fingers, engineResult), '左右中指高低写反时没有被拦截');

const hearingWrongRank = correctMental
  .replaceAll('精神功能', '听觉功能')
  .replaceAll('右拇', '右无名')
  .replaceAll('左拇', '左无名')
  .replace('右无名数值为14', '右无名数值为15')
  .replace('左无名比右无名高3', '右无名比左无名高1')
  .replace('左无名数值为17', '左无名数值为14')
  .concat('\n听觉功能29是五大功能里最高的一项。');
assert(!sandbox.isRequiredModuleComplete('听觉功能（无名指系统）', hearingWrongRank, fingers, engineResult), '非最高功能被写成最高时没有被拦截');

assert(!sandbox.isRequiredModuleComplete('性格类型（核心行为外显模块）', '你希望事情有纹路、关系有温度，像把散落的彩色玻璃珠，一颗颗', fingers, engineResult), '半截性格类型正文没有被拦截');
assert(!sandbox.isRequiredModuleComplete('视觉功能（小指系统）', '你看黑板时会先扫过整体，再落定在某一行字上——', fingers, engineResult), '半截视觉功能正文没有被拦截');
assert(!sandbox.isRequiredModuleComplete('TRC（认知结构）', '当前总TRC为131，远高于个人均值13.1。这里还有足够长的解释和建议。'.repeat(8), fingers, engineResult), '总TRC与单指均值直接比较没有被拦截');
assert(!sandbox.isRequiredModuleComplete('ATD（感受/反应节奏）', '你生来带着一套特别的神经地图。ATD39说明神经系统已经证明了你的固定反应。'.repeat(8), fingers, engineResult), '脑科学或命定化强断言没有被拦截');
assert(!sandbox.isRequiredModuleComplete('左右脑（信息处理风格）', '你天生懂语言韵律，右脑的共情力决定了你在人际中的固定表现。'.repeat(12), fingers, engineResult), '隐性脑科学或天生能力强断言没有被拦截');

const normalized = sandbox.normalizeSections([
  { title:'精神功能（拇指系统）', type:'required', content:'右拇31，左拇31。' },
  { title:'视觉功能（小指系统）', type:'required', content:'你看黑板时会先扫过整体——' },
], ['精神功能（拇指系统）','视觉功能（小指系统）'], [], engineResult, 'school', fingers);

assert(normalized.length === 2, '固定模块归一化数量错误');
assert(normalized[0].content.includes('右拇数值为14') && normalized[0].content.includes('左拇数值为17'), '精神功能安全兜底没有恢复真实单指数值');
assert(normalized[1].content.includes('右小数值为11') && normalized[1].content.includes('左小数值为12'), '视觉功能安全兜底没有恢复真实单指数值');
assert(!normalized.some(sec => /①是什么|②对当前用户意味着什么|③怎么应用/.test(sec.content)), '安全兜底把机械三段标题展示给用户');

console.log(JSON.stringify({
  ok: true,
  sampleTotalTRC: 131,
  sampleAverage: 13.1,
  checked: [
    'input_numeric_consistency',
    'single_finger_values',
    'left_right_direction',
    'function_ranking',
    'truncated_modules',
    'unsafe_assertions',
    'natural_safe_fallback',
  ],
}, null, 2));
