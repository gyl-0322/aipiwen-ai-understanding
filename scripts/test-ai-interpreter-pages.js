const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pages = [
  ['ai-interpreter-workbench.html', 'AIPIWEN指导师工作台'],
  ['ai-interpreter-customers.html', '我的客户'],
  ['ai-interpreter-session.html', 'AI解读助手'],
  ['ai-interpreter-training.html', '解读训练'],
  ['ai-interpreter-review.html', '总部复核 / 使用规范'],
  ['ai-interpreter-cases.html', '优秀案例沉淀']
];
const allowedMissing = new Set(['advisor-dryrun-new-customer.html']);
const allowedExternalScripts = new Set([
  'https://cdn.bootcdn.net/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
]);
const experienceNotice = '当前展示为功能演示数据，正式业务数据将在后续版本接入。';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [page, title] of pages) {
  assert(exists(page), `页面缺失：${page}`);
  const source = read(page);

  assert(source.includes('data-v3a-auth-page="workbench" hidden'), `页面必须先通过真实登录校验：${page}`);
  assert(source.includes('static/v3a-auth.js'), `页面必须加载 V3a 认证脚本：${page}`);
  assert(source.includes('static/ai-interpreter.js'), `页面必须加载旧工作台交互脚本：${page}`);
  assert(source.includes('<strong>体验示例</strong>') && source.includes(experienceNotice),
    `功能演示页必须明确标注体验示例：${page}`);
  assert(source.includes('id="v3a-workbench-error" hidden') &&
    source.includes('id="v3a-workbench-error-message"'),
    `受保护页面必须包含非白屏错误边界：${page}`);
  assert(!/V1\.1|V2 Dry-run|Static Demo|Prototype|Emma|解读师/.test(source),
    `用户可见页面仍包含研发历史或旧角色文案：${page}`);
  assert(source.includes(`<h1>${title}</h1>`) || source.includes(`<h1>${title} · 王小明的妈妈</h1>`),
    `页面标题不符合旧工作台栏目：${page}`);

  const hrefs = Array.from(source.matchAll(/href="([^"#][^"]*\.html)"/g)).map((match) => match[1]);
  for (const href of hrefs) {
    assert(exists(href) || allowedMissing.has(href), `页面链接指向不存在文件：${page} -> ${href}`);
  }

  const scripts = Array.from(source.matchAll(/src="([^"]+)"/g)).map((match) => match[1]);
  for (const script of scripts) {
    if (/^https:\/\//.test(script)) {
      assert(allowedExternalScripts.has(script), `页面加载了未登记的外部脚本：${page} -> ${script}`);
      continue;
    }
    assert(exists(script), `页面脚本指向不存在文件：${page} -> ${script}`);
  }
}

const navLinks = [
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'ai-interpreter-session.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];

for (const [page] of pages) {
  const source = read(page);
  for (const navLink of navLinks) {
    assert(source.includes(`href="${navLink}"`), `左侧导航缺少链接：${page} -> ${navLink}`);
  }
}

const session = read('ai-interpreter-session.html');
assert(session.includes('id="next-step"') && session.includes('id="prev-step"') && session.includes('id="skip-step"'),
  'AI 解读助手页必须保留步骤切换按钮');
assert(session.includes('id="ai-why"') && session.includes('id="ai-say"') && session.includes('id="ai-risk"'),
  'AI 解读助手页必须保留右栏话术渲染容器');
assert(session.includes('id="generate-plan"') && session.includes('id="credit-modal"'),
  'AI 解读助手页必须保留生成方案开放提示');
assert(session.includes('积分消耗功能将在后续版本开放。') &&
  !/ZHANGWEI01|确认消耗积分|确认消耗|data-modal-current/.test(session),
  '未接真实扣费前不得展示假扣积分或硬编码邀请码');
assert(session.includes('id="v3a-workbench-invite-code"'),
  'AI 解读助手页必须读取真实邀请码');

const customers = read('ai-interpreter-customers.html');
assert((customers.match(/class="table-row js-open-session"/g) || []).length >= 3,
  '我的客户页必须保留客户行点击进入解读助手的交互');
assert(!/data-dryrun-customers|V2 Dry-run/.test(customers),
  '我的客户页不得保留隐藏的旧模拟客户面板');

const review = read('ai-interpreter-review.html');
assert(review.includes('data-review-target="waiting"') &&
  review.includes('data-review-target="returned"') &&
  review.includes('data-review-target="draft"'),
  '总部复核页必须保留状态切换 tab');
assert(review.includes('data-review-card="waiting"') &&
  review.includes('data-review-card="returned"') &&
  review.includes('data-review-card="draft"'),
  '总部复核页必须保留状态卡片');

const workbench = read('ai-interpreter-workbench.html');
assert(!workbench.includes('<h2>当前工作台账号</h2>'), '工作台首页不应再展示重复的当前账号卡片');
assert(!workbench.includes('<h2>积分账户</h2>'), '工作台首页不应再展示重复的积分账户卡片');
assert(workbench.includes('data-v3a-detail="profile"') &&
  workbench.includes('data-v3a-detail="credits"') &&
  workbench.includes('data-v3a-detail="invite"'),
  '工作台右上角身份、积分、邀请码必须可点击查看详情');
assert(workbench.includes('id="v3a-workbench-detail-modal"'), '工作台必须包含账号详情弹窗');

const interactions = read('static/ai-interpreter.js');
assert(!/localStorage|getCreditBalance|setCreditBalance|aipiwen_interpreter_demo_credit_balance|ZHANGWEI01/.test(interactions),
  '真实工作台交互脚本不得运行本地 Mock 积分或硬编码邀请码');

const authSource = read('static/v3a-auth.js');
const creditLabelBlock = authSource.match(/const creditTypeLabels = \{([\s\S]*?)\n    \};/);
assert(creditLabelBlock, '前端积分类型标签块缺失');
const frontendCreditTypes = Array.from(creditLabelBlock[1].matchAll(/^\s+([A-Z_]+):/gm))
  .map((match) => match[1])
  .sort();
const creditMigration = read('supabase/migrations/004_v3a_phase_c1a_core_tables.sql');
const databaseConstraint = creditMigration.match(
  /add constraint credit_logs_type_check\s+check \(type in \(([^)]+)\)\)/
);
assert(databaseConstraint, '数据库积分类型约束缺失');
const databaseCreditTypes = Array.from(databaseConstraint[1].matchAll(/'([A-Z_]+)'/g))
  .map((match) => match[1])
  .sort();
assert(JSON.stringify(frontendCreditTypes) === JSON.stringify(databaseCreditTypes),
  `前端与数据库积分类型不一致：front=${frontendCreditTypes.join(',')} db=${databaseCreditTypes.join(',')}`);

console.log('PASS: hardened AI interpreter pages, example boundaries, protected routes, and real-data guards');
