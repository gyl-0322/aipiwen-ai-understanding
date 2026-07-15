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

  assert(!routeSources.some((route) => route.startsWith('/server')), '服务端 Session helper 目录不得配置为公开静态路由');

  assert(count(homepage, /href="\/advisor\.html"/g) === 1, '首页必须且只能保留一个指导师工作台入口');
  assert(homepage.includes('src="/js/error-tracker.js"'), 'Production 首页必须保留错误上报脚本');
  assert(homepage.includes('src="/js/growth-tracker.js"'), 'Production 首页必须保留增长统计脚本');
  assert(homepage.includes('src="/js/track.js"'), 'Production 首页必须保留访问统计脚本');
  assert(homepage.includes("fetch('/api/track'"), 'Production 首页必须保留访客统计接口');

  assert(count(advisor, /class="top-actions"/g) === 0, '指导师入口导航栏不得出现重复操作按钮');
  assert(count(advisor, /class="hero-actions"/g) === 1, '指导师入口必须且只能有一组主操作按钮');
  assert(heroActions, '未找到指导师入口主操作区域');
  assert(count(advisor, />登录指导师工作台<\/a>/g) === 1, '真实登录按钮必须且只能出现一次');
  assert(heroActions[1].includes('href="/login.html">登录指导师工作台</a>'), '真实登录按钮必须指向统一 login.html');
  assert(count(advisor, />联系总部开通账号<\/a>/g) === 1, '账号开通按钮必须且只能出现一次');
  assert(heroActions[1].includes('href="#advisor-contact">联系总部开通账号</a>'), '账号开通按钮必须指向总部人工开通区域');
  assert(count(advisor, /id="advisor-contact"/g) === 1, '页面必须且只能有一个账号开通锚点');
  assert(!advisor.includes('static/ai-interpreter.js'), '正式入口不得加载包含模拟积分逻辑的演示脚本');
  ['申请开通内测', '解读师', 'Emma', 'Preview 演示'].forEach((forbiddenCopy) => {
    assert(!advisorVisibleCopy.includes(forbiddenCopy), `Production 指导师入口不得出现：${forbiddenCopy}`);
  });

  [
    'ai-interpreter-customers.html',
    'ai-interpreter-report-intake.html',
    'ai-interpreter-session.html',
    'ai-interpreter-training.html',
    'ai-interpreter-review.html',
    'ai-interpreter-cases.html',
    'static/preview-demo-auth.js',
    'static/preview-report-intake.js'
  ].forEach((previewOnlyPath) => {
    assert(!exists(previewOnlyPath), `Production 包不得包含 Preview 演示文件：${previewOnlyPath}`);
  });

  assert(exists('ai-interpreter-workbench.html'), '正式 active 指导师必须有真实工作台落地页');
  const workbench = read('ai-interpreter-workbench.html');
  assert(workbench.includes('data-v3a-auth-page="workbench" hidden'), '工作台必须先完成真实 Session 校验再显示');
  assert(workbench.includes('static/v3a-auth.js') && !workbench.includes('static/ai-interpreter.js'),
    '正式工作台只能加载真实 V3a 认证脚本，不得加载演示业务脚本');
  [
    'preview-demo-auth', 'preview-report-intake', 'sessionStorage', 'localStorage',
    '模拟客户', '模拟积分', '模拟报告', 'ZHANGWEI01', '王小明', '500'
  ].forEach((forbiddenCopy) => {
    assert(!workbench.includes(forbiddenCopy), `正式工作台不得包含模拟资产或数据：${forbiddenCopy}`);
  });

  assert(exists('api/v3a-session.js'), 'HttpOnly Session 服务端路由必须存在');
  assert(exists('server/v3a-session-store.js'), '加密服务端 Session 存储模块必须存在且不得放入公开 lib 路由');

  if (exists('login.html')) {
    const login = read('login.html');
    const v3aAuth = read('static/v3a-auth.js');
    const sessionStore = read('server/v3a-session-store.js');
    assert(login.includes('static/v3a-auth.js'), '统一登录页必须使用真实 V3a 认证脚本');
    assert(!login.includes('preview-demo-auth'), '统一登录页不得加载 Preview 模拟认证脚本');
    assert(!login.includes('Preview 演示') && !login.includes('模拟验证码'), '统一登录页不得包含模拟登录文案');
    assert(v3aAuth.includes("const SESSION_API = '/api/v3a-session'"),
      '浏览器认证必须只调用同源 HttpOnly Session API');
    assert(count(v3aAuth, /\bfetch\s*\(/g) === 1, '浏览器认证必须集中使用唯一 Session API 请求入口');
    assert(v3aAuth.includes('fetch(`${SESSION_API}?${query.toString()}`'),
      '浏览器认证请求必须固定发送到 /api/v3a-session');
    assert(v3aAuth.includes("credentials: 'same-origin'"),
      '浏览器 Session 请求必须显式携带同源 HttpOnly Cookie');
    const browserApiPaths = [...v3aAuth.matchAll(/[\"'`](\/api\/[A-Za-z0-9._/-]+)/g)]
      .map((match) => match[1]);
    assert(browserApiPaths.length > 0 && browserApiPaths.every((apiPath) => apiPath === '/api/v3a-session'),
      '浏览器认证不得访问 /api/v3a-session 以外的 API');
    assert(!/supabase|AIPIWEN_V3A_SUPABASE|createClient|getSession|signInWithOtp|verifyOtp|persistSession/i.test(v3aAuth),
      '浏览器认证不得依赖 Supabase SDK 或浏览器端 Supabase 配置');
    assert(!v3aAuth.includes('lmjriqncuopgxwyudfee'), '浏览器认证不得包含 Preview Project Ref');
    assert(!/access[_A-Za-z]*token|refresh[_A-Za-z]*token/i.test(v3aAuth),
      '浏览器认证不得读取、保存或发送 Supabase access/refresh token');
    assert(!v3aAuth.includes('localStorage') && !v3aAuth.includes('sessionStorage'),
      '真实认证脚本不得把手机号、验证码或 Session 写入浏览器存储');
    assert(sessionStore.includes("process.env.V3A_PHONE_OTP_ENABLED === 'true'"),
      '短信发送门禁必须转移到服务端并保持显式默认关闭');
    assert(!login.includes('cdn.jsdelivr.net') && !login.includes('esm.sh'), '中国用户登录页不得依赖境外 CDN 加载认证组件');
  }

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
    '/advisor',
    '/login.html',
    '/login',
    '/advisor-register.html',
    '/advisor-register',
    '/advisor-pending.html',
    '/advisor-pending',
    '/ai-interpreter-workbench.html',
    '/ai-interpreter-workbench',
    '/admin-applications.html',
    '/admin-applications'
  ].forEach((requiredRoute) => {
    const routeIndex = routeSources.indexOf(requiredRoute);
    assert(routeIndex >= 0, `Production 路由缺失：${requiredRoute}`);
    assert(routeIndex < catchAllIndex, `Production 路由必须位于首页 catch-all 之前：${requiredRoute}`);
  });

  assert(!routeSources.includes('/api/v3a-session'),
    'V3a Session 继续由通用同源 API route 接收，不得增加额外公开别名');
  assert(vercel.functions && typeof vercel.functions === 'object', 'Production 必须保留 Serverless Functions 配置');
  [
    'api/auth.js',
    'api/children.js',
    'api/guest-chat.js',
    'api/digest.js',
    'api/admin-convs.js',
    'api/extract-fp.js',
    'api/generate-report.js',
    'api/v3a-session.js',
    'api/v3a-admin.js'
  ].forEach((requiredFunction) => {
    assert(Object.hasOwn(vercel.functions, requiredFunction), `Production Function 配置缺失：${requiredFunction}`);
  });
  assert(Array.isArray(vercel.crons) && vercel.crons.length === 4, 'Production 必须保留四项定时任务');

  console.log('PASS: formal advisor entry, real login/workbench routes, backend functions, and zero-mock boundary');
  if (isVercelIgnoreCommand) process.exitCode = 1;
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  if (!isVercelIgnoreCommand) throw error;
}
