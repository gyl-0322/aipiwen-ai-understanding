const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isVercelIgnoreCommand = process.argv.includes('--vercel-ignore-command');
const vercelTarget = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || '';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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
  const login = read('login.html');
  const demoAuth = read('static/preview-demo-auth.js');
  const interpreterDemo = read('static/ai-interpreter.js');
  const vercel = JSON.parse(read('vercel.json'));
  const vercelIgnore = read('.vercelignore');
  const advisorVisibleCopy = advisor.replace(/<!--[\s\S]*?-->/g, '');
  const heroActions = advisor.match(/<div class="hero-actions">([\s\S]*?)<\/div>/);
  const protectedPages = [
    'ai-interpreter-workbench.html',
    'ai-interpreter-customers.html',
    'ai-interpreter-report-intake.html',
    'ai-interpreter-session.html',
    'ai-interpreter-training.html',
    'ai-interpreter-review.html',
    'ai-interpreter-cases.html'
  ];

  assert(count(homepage, /href="\/advisor\.html"/g) === 1, '首页必须且只能保留一个指导师工作台入口');
  assert(homepage.includes('data-preview-demo-no-analytics="true"'), 'Preview 首页必须明确关闭统计写入');
  assert(homepage.includes('PREVIEW_DEMO_NO_REMOTE_WRITES = true'), 'Preview 首页必须在统计请求前短路');
  assert(!homepage.includes('src="/js/error-tracker.js"'), 'Preview 首页不得加载错误上报脚本');
  assert(!homepage.includes('src="/js/growth-tracker.js"'), 'Preview 首页不得加载增长统计脚本');
  assert(!homepage.includes('src="/js/track.js"'), 'Preview 首页不得加载访问统计脚本');
  assert(count(advisor, /class="top-actions"/g) === 0, '指导师介绍页导航栏不得出现重复操作按钮');
  assert(count(advisor, /class="hero-actions"/g) === 1, '指导师介绍页必须且只能有一组主操作按钮');
  assert(heroActions, '未找到指导师介绍页主操作按钮区域');
  assert(count(advisor, />登录指导师工作台<\/a>/g) === 1, '“登录指导师工作台”按钮必须且只能出现一次');
  assert(count(advisor, />联系总部开通账号<\/a>/g) === 1, '“联系总部开通账号”按钮必须且只能出现一次');
  assert(heroActions[1].includes('href="/login.html?demo=advisor">登录指导师工作台</a>'), '登录按钮必须位于主操作区并进入统一 login.html');
  assert(heroActions[1].includes('href="#advisor-contact">联系总部开通账号</a>'), '联系总部按钮必须位于主操作区并指向账号开通方式');
  assert(count(advisor, /id="advisor-contact"/g) === 1, '页面必须且只能有一个账号开通锚点');
  assert(!advisorVisibleCopy.includes('申请开通内测'), '用户可见内容不得恢复“申请开通内测”');
  assert(!advisorVisibleCopy.includes('解读师'), '指导师介绍页不得恢复“解读师”旧称');

  assert(login.includes('data-preview-demo-page="login"'), '统一登录页缺少 Preview 演示标识');
  assert(login.includes('static/preview-demo-auth.js'), '统一登录页必须加载本地模拟登录脚本');
  assert(login.includes('不会发送短信，也不会创建真实账号'), '统一登录页必须明确演示边界');
  assert(!login.includes('static/v3a-auth.js'), '模拟登录页不得加载真实 Supabase 认证脚本');
  assert(!/<script[^>]+src="https?:\/\//.test(login), '模拟登录页不得加载远程脚本');

  assert(demoAuth.includes('sessionStorage'), '演示登录状态必须使用标签页级 sessionStorage');
  assert(demoAuth.includes('crypto.getRandomValues'), '模拟验证码必须在当前页面随机生成');
  assert(!demoAuth.includes('localStorage'), '演示登录不得把状态持久化到 localStorage');
  assert(!/\bfetch\s*\(/.test(demoAuth), '演示登录脚本不得发起 fetch 请求');
  assert(!/XMLHttpRequest|WebSocket|EventSource/.test(demoAuth), '演示登录脚本不得建立远程连接');
  assert(!/createClient\s*\(|supabase\s*\./i.test(demoAuth), '演示登录脚本不得创建 Supabase 客户端');
  assert(!/["']\d{6}["']/.test(demoAuth), '演示登录脚本不得内置固定六位验证码');
  assert(demoAuth.includes("sessionStorage.removeItem(REPORT_STATE_KEY)"), '退出演示必须同时清除报告接入状态');
  assert(!interpreterDemo.includes('localStorage'), '模拟业务额度不得跨浏览器会话持久化');
  assert(!interpreterDemo.includes('mock-register'), '旧的“注册即赠积分”处理不得恢复');

  protectedPages.forEach((pagePath) => {
    const page = read(pagePath);
    const visiblePage = page.replace(/<!--[\s\S]*?-->/g, '');
    assert(page.includes('data-preview-demo-auth="required"'), `${pagePath} 缺少演示登录门禁`);
    assert(page.includes('static/preview-demo-auth.js'), `${pagePath} 未加载演示登录门禁脚本`);
    assert(/<body[^>]+hidden/.test(page), `${pagePath} 必须在会话确认前隐藏内容`);
    assert(!page.includes('static/v3a-auth.js'), `${pagePath} 不得加载真实 Supabase 认证脚本`);
    assert(!/Emma|V1\.1|静态 Demo|\bMock\b/.test(visiblePage), `${pagePath} 含有过时或内部演示用语`);
    assert(!visiblePage.includes('解读师'), `${pagePath} 不得出现“解读师”旧称`);
  });

  const routeSources = vercel.routes.map((route) => route.src);
  const catchAllIndex = routeSources.indexOf('/(.*)');
  assert(
    vercel.routes.every((route) => !route.src.startsWith('/api') && !route.dest.startsWith('/api')),
    'Preview 静态部署不得保留 API 路由'
  );
  assert(!Object.hasOwn(vercel, 'functions'), 'Preview 静态部署不得声明 Serverless Functions');
  assert(!Object.hasOwn(vercel, 'crons'), 'Preview 静态部署不得声明定时任务');
  assert(/^api\/$/m.test(vercelIgnore), '.vercelignore 必须排除 api 目录');
  assert(/^lib\/$/m.test(vercelIgnore), '.vercelignore 必须排除服务端 lib 目录');
  assert(!/^static(?:\/|$)/m.test(vercelIgnore), '.vercelignore 不得排除演示静态资源');
  [
    '/login.html',
    '/login',
    '/ai-interpreter-workbench.html',
    '/ai-interpreter-customers.html',
    '/ai-interpreter-report-intake.html',
    '/ai-interpreter-report-intake',
    '/ai-interpreter-session.html',
    '/ai-interpreter-training.html',
    '/ai-interpreter-review.html',
    '/ai-interpreter-cases.html'
  ].forEach((route) => {
    const index = routeSources.indexOf(route);
    assert(index >= 0, `Vercel 缺少显式路由 ${route}`);
    assert(index < catchAllIndex, `路由 ${route} 必须位于首页 catch-all 之前`);
  });

  [
    'advisor-login-phone.html',
    'phone-login.html',
    'wechat-login.html',
    'google-login.html',
    'email-login.html'
  ].forEach((forbiddenPage) => {
    assert(!fs.existsSync(path.join(root, forbiddenPage)), `禁止创建独立登录页 ${forbiddenPage}`);
  });

  console.log('PASS: homepage → advisor → unified demo login → protected workbench contract is valid.');

  if (isVercelIgnoreCommand) {
    if (vercelTarget !== 'preview') {
      console.error('BLOCKED: 演示登录分支只允许 Vercel Preview 构建。');
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  if (!isVercelIgnoreCommand) throw error;
}
