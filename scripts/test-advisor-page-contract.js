const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '..', 'advisor.html');
const html = fs.readFileSync(pagePath, 'utf8');
const isVercelIgnoreCommand = process.argv.includes('--vercel-ignore-command');

function count(pattern) {
  return (html.match(pattern) || []).length;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const heroActions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/);

  assert(count(/class="top-actions"/g) === 0, '导航栏不得出现重复操作按钮');
  assert(count(/class="hero-actions"/g) === 1, '页面必须且只能有一组主操作按钮');
  assert(heroActions, '未找到主操作按钮区域');
  assert(count(/>申请开通内测<\/a>/g) === 1, '“申请开通内测”按钮必须且只能出现一次');
  assert(count(/>联系 AIPIWEN 总部<\/a>/g) === 1, '“联系 AIPIWEN 总部”按钮必须且只能出现一次');
  assert(heroActions[1].includes('href="#advisor-contact">申请开通内测</a>'), '内测申请按钮必须位于主操作区并指向联系方式');
  assert(heroActions[1].includes('href="#advisor-contact">联系 AIPIWEN 总部</a>'), '联系总部按钮必须位于主操作区并指向联系方式');
  assert(count(/id="advisor-contact"/g) === 1, '页面必须且只能有一个联系方式锚点');

  console.log('PASS: advisor page keeps one hero CTA group with a valid contact anchor.');
  if (isVercelIgnoreCommand) process.exitCode = 1;
} catch (error) {
  console.error(`BLOCKED: ${error.message}`);
  if (!isVercelIgnoreCommand) throw error;
}
