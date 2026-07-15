const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isVercelIgnoreCommand = process.argv.includes('--vercel-ignore-command');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function count(content, pattern) {
  return (content.match(pattern) || []).length;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const advisor = read('advisor.html');
  const homepage = read('homepage.html');
  const vercel = JSON.parse(read('vercel.json'));
  const advisorVisibleCopy = advisor.replace(/<!--[\s\S]*?-->/g, '');
  const heroActions = advisor.match(/<div class="hero-actions">([\s\S]*?)<\/div>/);
  const routeSources = vercel.routes.map((route) => route.src);
  const catchAllIndex = routeSources.indexOf('/(.*)');

  assert(count(homepage, /href="\/advisor\.html"/g) === 1, '首页必须且只能保留一个指导师工作台入口');
  assert(homepage.includes('src="/js/error-tracker.js"'), 'Production 首页必须保留错误上报脚本');
  assert(homepage.includes('src="/js/growth-tracker.js"'), 'Production 首页必须保留增长统计脚本');
  assert(homepage.includes('src="/js/track.js"'), 'Production 首页必须保留访问统计脚本');
  assert(homepage.includes("fetch('/api/track'"), 'Production 首页必须保留访客统计接口');

  assert(count(advisor, /class="top-actions"/g) === 0, '指导师入口导航栏不得出现重复操作按钮');
  assert(count(advisor, /class="hero-actions"/g) === 1, '指导师入口必须且只能有一组主操作按钮');
  assert(heroActions, '未找到指导师入口主操作区域');
  assert(count(advisor, />联系总部开通账号<\/a>/g) === 1, '账号开通按钮必须且只能出现一次');
  assert(heroActions[1].includes('href="#advisor-contact">联系总部开通账号</a>'), '账号开通按钮必须指向总部人工开通区域');
  assert(count(advisor, /id="advisor-contact"/g) === 1, '页面必须且只能有一个账号开通锚点');
  ['申请开通内测', '解读师', 'Emma', '登录指导师工作台', 'Preview 演示'].forEach((forbiddenCopy) => {
    assert(!advisorVisibleCopy.includes(forbiddenCopy), `Production 指导师入口不得出现：${forbiddenCopy}`);
  });

  [
    'login.html',
    'ai-interpreter-workbench.html',
    'ai-interpreter-customers.html',
    'ai-interpreter-report-intake.html',
    'ai-interpreter-session.html',
    'ai-interpreter-training.html',
    'ai-interpreter-review.html',
    'ai-interpreter-cases.html',
    'static/preview-demo-auth.js',
    'static/preview-report-intake.js',
    '.vercelignore'
  ].forEach((previewOnlyPath) => {
    assert(!exists(previewOnlyPath), `Production 包不得包含 Preview 演示文件：${previewOnlyPath}`);
  });

  [
    '/api/growth',
    '/api/stats',
    '/api/log-session',
    '/api/wechat',
    '/api/error-log',
    '/api/invite',
    '/api/synthesize',
    '/api/track',
    '/api/knowledge',
    '/api/report-store',
    '/api/(.*)',
    '/js/(.*)',
    '/lib/(.*)',
    '/assets/(.*)',
    '/patterns/(.*)',
    '/static/(.*)',
    '/share/(.*)',
    '/advisor.html',
    '/advisor'
  ].forEach((requiredRoute) => {
    const routeIndex = routeSources.indexOf(requiredRoute);
    assert(routeIndex >= 0, `Production 路由缺失：${requiredRoute}`);
    assert(routeIndex < catchAllIndex, `Production 路由必须位于首页 catch-all 之前：${requiredRoute}`);
  });

  assert(!routeSources.some((route) => route.startsWith('/login') || route.startsWith('/ai-interpreter')), 'Production 不得发布 Preview 登录或工作台演示路由');
  assert(vercel.functions && typeof vercel.functions === 'object', 'Production 必须保留 Serverless Functions 配置');
  [
    'api/auth.js',
    'api/children.js',
    'api/guest-chat.js',
    'api/digest.js',
    'api/admin-convs.js',
    'api/extract-fp.js',
    'api/generate-report.js'
  ].forEach((requiredFunction) => {
    assert(Object.hasOwn(vercel.functions, requiredFunction), `Production Function 配置缺失：${requiredFunction}`);
  });
  assert(Array.isArray(vercel.crons) && vercel.crons.length === 4, 'Production 必须保留四项定时任务');

  console.log('PASS: production advisor entry preserves backend routes and excludes Preview demo assets.');
  if (isVercelIgnoreCommand) process.exitCode = 1;
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  if (!isVercelIgnoreCommand) throw error;
}
