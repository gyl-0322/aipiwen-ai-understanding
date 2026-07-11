#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api/generate-report.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'report-upload.html'), 'utf8');
const extractSource = fs.readFileSync(path.join(root, 'api/extract-fp.js'), 'utf8');
const { classify } = require(path.join(root, 'lib/trc-engine.js'));

const expectedCoreModules = [
  '严正申明四原则',
  'TRC（认知结构）',
  'ATD（感受/反应节奏）',
  '左右脑（信息处理风格）',
  '性格类型（核心行为外显模块）',
  '学习通道（学习输入系统）',
  '行为模式（行为解释系统）',
  '精神功能（拇指系统）',
  '思维功能（食指系统）',
  '体觉功能（中指系统）',
  '听觉功能（无名指系统）',
  '视觉功能（小指系统）',
];

const expectedDisplayModules = [
  '严正申明四原则',
  'TRC（认知结构）',
  'ATD（感受/反应节奏）',
  '左右脑（信息处理风格）',
  '性格类型（核心行为外显）',
  '学习通道（学习输入系统）',
  '行为模式（行为解释系统）',
  '五大功能（能力结构地图）',
];

function extractArray(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`未找到 ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertArray(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} 不符合冻结顺序：\n${JSON.stringify(actual, null, 2)}`);
}

assertArray(extractArray(apiSource, 'CORE_REQUIRED_MODULES'), expectedCoreModules, 'API 固定模块');
assertArray(extractArray(pageSource, 'CORE_REQUIRED_MODULES'), expectedCoreModules, '页面提交模块');
assertArray(extractArray(pageSource, 'REQUIRED_MODULES_DISPLAY'), expectedDisplayModules, '页面展示模块');

assert(pageSource.includes('REQUIRED_MODULES_DISPLAY.forEach'), '选择页没有使用分组后的 8 项展示列表');
assert(pageSource.includes('ST.requiredMods = REQUIRED_BY_STAGE'), '页面没有把完整固定模块提交给报告接口');
assert(pageSource.includes('cleanRequiredModuleScaffold'), '页面没有清理机械三段式标题');

assert(apiSource.includes('FUNCTION_MODULE_FINGER_REQUIREMENTS'), 'API 缺少五大功能单指完整性要求');
assert(apiSource.includes('isRequiredModuleComplete(title, content, fingers, engineResult)'), 'API 没有用原始十指数据检查固定模块完整性');
assert(apiSource.includes('rightCompared') && apiSource.includes('leftCompared'), 'API 没有分别校验两根手指与个人均值的比较');
assert(apiSource.includes('invalidPairAverage'), 'API 没有拦截两指合计与单指个人均值的错误比较');
assert(apiSource.includes("'精神功能（拇指系统）': ['右拇', '左拇']"), '精神功能手指映射错误');
assert(apiSource.includes("'思维功能（食指系统）': ['右食', '左食']"), '思维功能手指映射错误');
assert(apiSource.includes("'体觉功能（中指系统）': ['右中', '左中']"), '体觉功能手指映射错误');
assert(apiSource.includes("'听觉功能（无名指系统）': ['右无名', '左无名']"), '听觉功能手指映射错误');
assert(apiSource.includes("'视觉功能（小指系统）': ['右小', '左小']"), '视觉功能手指映射错误');
assert(apiSource.includes("'精神功能（拇指系统）': ['R1', 'L1']"), '精神功能位置映射错误');
assert(extractSource.includes("create_lead:     'R1'"), '图片识别没有把创造/领导映射到右拇 R1');
assert(extractSource.includes("comm_plan:       'L1'"), '图片识别没有把沟通/计划映射到左拇 L1');

const validatorStart = apiSource.indexOf('const FUNCTION_MODULE_FINGER_REQUIREMENTS');
const validatorEnd = apiSource.indexOf('function normalizeSections', validatorStart);
assert(validatorStart >= 0 && validatorEnd > validatorStart, '无法提取固定模块完整性校验器');
const validatorSandbox = {};
vm.runInNewContext(`
  function stripRequiredModuleScaffold(text) { return String(text || ''); }
  ${apiSource.slice(validatorStart, validatorEnd)}
  this.isRequiredModuleComplete = isRequiredModuleComplete;
`, validatorSandbox);
const validate = validatorSandbox.isRequiredModuleComplete;

const completeMental = [
  '精神功能需要分别看右拇和左拇，不把两根手指相加后直接判断强弱。右拇代表开创与对外发起，左拇代表管理与自我约束。',
  '右拇数值26，接近个人均值26.4，行动和目标有可调用基础；左拇数值30，略高于个人均值26.4，内在管理和收尾更容易自然发挥。',
  '左侧比右侧更高，左侧会先被调动。学习中可以先把计划和规则说具体，再给合适的挑战和责任；沟通时观察孩子卡在理解、启动、坚持还是收尾。数值高低都不是好坏结论，需要结合年龄和现实场景连续观察。',
  '如果孩子愿意开始却常在最后一步松掉，可以把目标拆成启动、推进和收尾三个检查点。先让较强的开创入口带动行动，再用清单、时间边界和具体反馈支持管理入口。连续观察一到两周，根据真实变化调整，而不是只凭一次表现下结论。',
].join(' '.repeat(2));
const sampleFingers = { R1:{trc:26}, L1:{trc:30} };
const sampleEngineResult = { 五功能区:{ 精神:56, 个人均值:26.4 } };
assert(validate('精神功能（拇指系统）', completeMental, sampleFingers, sampleEngineResult), '完整的精神功能单指解释被误判为不完整');
assert(!validate('精神功能（拇指系统）', '右拇很高，左拇较低。', sampleFingers, sampleEngineResult), '过短的精神功能内容没有被拦截');
assert(!validate('精神功能（拇指系统）', completeMental.replace('右拇数值26', '右拇数值56'), sampleFingers, sampleEngineResult), '正文中的错误右拇数值没有被拦截');
assert(!validate('精神功能（拇指系统）', `${completeMental} 精神功能合计56，明显高于个人均值26.4。`, sampleFingers, sampleEngineResult), '两指合计与单指均值的错误比较没有被拦截');

const completeBrain = '左右脑不是能力高低，而是信息处理入口不同。左脑更常从语言、逻辑、规则和步骤进入，右脑更常从画面、感受、空间和整体关系进入。当前左脑与右脑相对均衡，遇到熟悉任务时可以调用逻辑整理，进入新场景时也会借助画面和直觉。学习中先用更顺手的一侧建立理解，再用另一侧复述、画图或列步骤进行校正。做决定时既看事实，也看现实感受；沟通时先说明具体目标，再给一个生活例子。比如一道题听懂却写不出时，可以先画出关系，再把画面转成步骤；遇到需要表达感受的场景，也可以先说看到的事实，再说明自己的体验。连续观察哪些任务更容易进入状态、哪些任务容易卡住，才能判断这份线索是否贴近本人。这里看的不是谁更聪明，而是同一份信息用什么方式更容易被接住。';
assert(validate('左右脑（信息处理风格）', completeBrain), '完整的左右脑解释被误判为不完整');
assert(!validate('左右脑（信息处理风格）', '左脑更讲逻辑。'), '缺少右脑和现实应用的短内容没有被拦截');

const engineFingers = {
  R1:{sym:'Ws',trc:26}, L1:{sym:'Lu',trc:30},
  R2:{sym:'Ws',trc:28}, L2:{sym:'Lu',trc:24},
  R3:{sym:'Ws',trc:22}, L3:{sym:'Lu',trc:18},
  R4:{sym:'Ws',trc:26}, L4:{sym:'Lu',trc:16},
  R5:{sym:'Ws',trc:37}, L5:{sym:'Lu',trc:37},
};
const engineResult = classify(engineFingers, { age:10, atd:34 });
assert(engineResult.五功能区.精神 === 56, '精神功能合计必须等于右拇26 + 左拇30');
assert(engineResult.五功能区.个人均值 === 26.4, '个人均值必须等于总TRC264 ÷ 10');
assert(engineFingers.R1.trc === 26 && engineFingers.L1.trc === 30, '引擎不得用精神功能合计覆盖单指数据');

const numericGuardStart = apiSource.indexOf('function validateReportNumericConsistency');
const numericGuardEnd = apiSource.indexOf('// ── 主 Handler', numericGuardStart);
assert(numericGuardStart >= 0 && numericGuardEnd > numericGuardStart, '无法提取报告数值一致性校验器');
const numericSandbox = {};
vm.runInNewContext(`${apiSource.slice(numericGuardStart, numericGuardEnd)}\nthis.validateReportNumericConsistency = validateReportNumericConsistency;`, numericSandbox);
const validateNumerics = numericSandbox.validateReportNumericConsistency;
assert(validateNumerics(engineFingers, engineResult) === null, '正确的十指、功能合计和个人均值未通过一致性校验');
assert(validateNumerics({ ...engineFingers, R1:{sym:'Ws',trc:56} }, engineResult)?.includes('右拇单指 TRC'), '单指 56 没有被 0-40 范围校验拦截');
assert(validateNumerics(engineFingers, { ...engineResult, 五功能区:{ ...engineResult.五功能区, 精神:86 } })?.includes('精神功能合计'), '错误的精神功能合计没有被拦截');

assert(pageSource.includes('trc < 0 || trc > 40'), '确认页面没有拦截超出 0-40 的单指 TRC');
assert(apiSource.includes('validateReportNumericConsistency(fingers, engineResult)'), '生成接口没有执行十指与功能合计一致性校验');

assert(pageSource.includes('paginatePdfDomPage'), 'PDF 没有在 DOM 层分页');
assert(pageSource.includes('data-pdf-flow'), 'PDF 内容缺少可分页 DOM 容器');
assert(!pageSource.includes('function addCanvasToPdfPages'), 'PDF 仍在使用长图固定像素硬切');
assert(pageSource.includes("makePDFQRCodeDataUrl('https://aipiwen.cn')"), 'PDF 封面网站二维码缺失');

console.log(JSON.stringify({
  ok: true,
  coreModules: expectedCoreModules.length,
  displayModules: expectedDisplayModules.length,
  fiveFunctionPages: 5,
  pdfPagination: 'dom',
}, null, 2));
