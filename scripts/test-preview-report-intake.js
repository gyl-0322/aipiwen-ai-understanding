const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const page = read('ai-interpreter-report-intake.html');
const script = read('static/preview-report-intake.js');
const sharedScript = read('static/ai-interpreter.js');
const sessionPage = read('ai-interpreter-session.html');
const reviewPage = read('ai-interpreter-review.html');
const vercel = JSON.parse(read('vercel.json'));
const customerPreview = page.match(/<article[^>]+id="customer-output-preview"[\s\S]*?<\/article>/);
const protectedPages = [
  'ai-interpreter-workbench.html',
  'ai-interpreter-customers.html',
  'ai-interpreter-report-intake.html',
  'ai-interpreter-session.html',
  'ai-interpreter-training.html',
  'ai-interpreter-review.html',
  'ai-interpreter-cases.html'
];

assert(page.includes('data-page="report-intake"'), '报告接入页缺少导航页面标识');
assert(page.includes('data-preview-demo-auth="required"'), '报告接入页缺少模拟登录门禁');
assert(/<body[^>]+hidden/.test(page), '报告接入页必须在会话确认前隐藏');
assert(page.includes('static/preview-report-intake.js'), '报告接入页未加载本地演示脚本');
assert(!page.includes('static/v3a-auth.js'), '报告接入页不得加载真实认证脚本');
assert(!/<script[^>]+src="https?:\/\//.test(page), '报告接入页不得加载远程脚本');

['intake-step-1', 'intake-step-2', 'intake-step-3', 'intake-step-4'].forEach((id) => {
  assert(page.includes(`id="${id}"`), `缺少完整体验步骤 ${id}`);
});

['魔纹密码', '359', '艾尔发', '一赋一涵', '翟氏', '朱氏', '其他', '无法确认'].forEach((source) => {
  assert(page.includes(`>${source}<`), `私密来源选项缺少 ${source}`);
});
assert(page.includes('id="other-source-name"'), '“其他”来源必须提供仅本页临时使用的名称输入');
assert(page.includes('value="not_confirmable"'), '“无法确认”必须配套不推断的依据选项');

assert(customerPreview, '缺少客户可见的 AIPIWEN 输出预览');
['魔纹密码', '359', '艾尔发', '一赋一涵', '翟氏', '朱氏'].forEach((source) => {
  assert(!customerPreview[0].includes(source), `客户预览不得出现第三方来源：${source}`);
});
assert(!customerPreview[0].includes('切换'), '客户预览不得提供第三方话术切换');
assert(customerPreview[0].includes('AIPIWEN'), '客户预览必须明确使用 AIPIWEN 语言');

assert(!/\bfetch\s*\(/.test(script), '报告接入演示不得发起 fetch 请求');
assert(!/XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(script), '报告接入演示不得建立远程连接');
assert(!/localStorage/.test(script), '报告接入演示不得持久化到 localStorage');
assert(!/createClient\s*\(|supabase\s*\./i.test(script), '报告接入演示不得连接 Supabase');
assert(!/FormData|FileReader/.test(script), '报告接入演示不得读取或上传真实文件');
assert(script.includes('window.clearTimeout'), '切换分支时必须取消尚未结束的模拟处理计时');
assert(!page.includes('id="submit-intake-review"'), '客户结果页不得跳过 AI 解读直接提交复核');
assert(!page.includes('已作为内部私密事实保存'), '零写入演示不得宣称来源已保存');
assert(!page.includes('已进入总部复核队列'), '零写入演示不得宣称已创建复核队列记录');
assert(sessionPage.includes('data-report-intake-context="session" hidden'), 'AI解读页必须默认隐藏报告接入上下文');
assert(sessionPage.includes('id="submit-report-intake-review"'), 'AI解读页必须负责连接总部复核状态');
assert(reviewPage.includes('data-report-intake-context="review" hidden'), '总部复核页必须默认隐藏统一输出检查');
assert(reviewPage.includes('id="complete-report-intake-demo"'), '总部复核页必须提供完整体验终点');
assert(sharedScript.includes('aipiwen.previewReportIntakeState.v1'), '后续页面必须只依据当前标签页的演示状态显示接入上下文');

protectedPages.forEach((pagePath) => {
  const protectedPage = read(pagePath);
  assert(protectedPage.includes('href="ai-interpreter-report-intake.html"'), `${pagePath} 缺少报告接入导航`);
});

const routeSources = vercel.routes.map((route) => route.src);
const catchAllIndex = routeSources.indexOf('/(.*)');
['/ai-interpreter-report-intake.html', '/ai-interpreter-report-intake'].forEach((route) => {
  const index = routeSources.indexOf(route);
  assert(index >= 0, `Vercel 缺少显式路由 ${route}`);
  assert(index < catchAllIndex, `路由 ${route} 必须位于首页 catch-all 之前`);
});

console.log('PASS: preview report intake → private source → normalization → AIPIWEN-only output contract is valid.');
