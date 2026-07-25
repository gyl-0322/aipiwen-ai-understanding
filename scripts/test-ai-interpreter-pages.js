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
  'AI 解读助手页必须保留生成方案与积分确认交互');

const customers = read('ai-interpreter-customers.html');
assert((customers.match(/class="table-row js-open-session"/g) || []).length >= 3,
  '我的客户页必须保留客户行点击进入解读助手的交互');

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

console.log('PASS: AI interpreter workbench pages, protected routes, nav links, and interaction hooks');
