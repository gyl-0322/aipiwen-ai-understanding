#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'static/v3a-auth.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!html.includes('id="v3a-existing-session"'), '登录页不得动态插入旧 Session 提示区');
assert(!html.includes('id="v3a-continue-session"'), '登录页不得出现可能造成布局位移的继续按钮');

const initLogin = auth.match(/async function initLogin\(\) \{([\s\S]*?)\n  \}\n\n  async function initRegister/);
assert(initLogin, '无法定位登录页初始化函数');
assert(!initLogin[1].includes("requestSession('me')"), '登录页加载时不得探测旧 Session');
assert(!initLogin[1].includes('stayOnLoginHome'), '登录页不得再依赖 home 参数关闭自动路由');
assert(!initLogin[1].includes('existingSession'), '登录页不得维护动态旧 Session UI');
assert(!initLogin[1].includes('continueSessionButton'), '登录页不得绑定旧 Session 继续按钮');
assert(!/addEventListener\('(focus|input|pointerdown)'[\s\S]*routeByStatus\(/.test(auth), '输入框事件不得触发 Session 跳转');

console.log('PASS: login page never probes or auto-reuses an existing session');
