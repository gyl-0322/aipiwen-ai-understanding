#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'static/v3a-attribution.js'), 'utf8');
const validFingers = Object.fromEntries(
  ['R1', 'R2', 'R3', 'R4', 'R5', 'L1', 'L2', 'L3', 'L4', 'L5']
    .map((key, index) => [key, { sym: index === 4 ? 'Rl' : 'Lu', trc: index + 1 }])
);
const clients = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: '甲客户',
    source: 'advisor_import',
    createdAt: '2026-07-01T00:00:00Z',
    reports: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'ready', createdAt: '2026-07-03T00:00:00Z' }]
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    displayName: '乙客户',
    source: 'advisor_qr',
    createdAt: '2026-07-02T00:00:00Z',
    reports: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'generating', createdAt: '2026-07-04T00:00:00Z' }]
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    displayName: '丙客户',
    source: 'advisor_import',
    createdAt: '2026-07-05T00:00:00Z',
    reports: []
  }
];

class FakeClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

class FakeNode {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.events = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.files = [];
    this.textContent = '';
    this.innerHTML = '';
    this.scrolled = false;
  }
  addEventListener(type, handler) { this.events[type] = handler; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = String(value); }
  scrollIntoView() { this.scrolled = true; }
  reset() { this.checked = false; }
}

const ids = [
  'v3a-attribution-qr', 'v3a-customer-upload', 'v3a-real-customers-error',
  'v3a-real-customers', 'v3a-real-customers-title', 'v3a-real-customers-count',
  'v3a-real-customers-list', 'v3a-real-customers-table',
  'v3a-real-customers-empty', 'v3a-customer-search', 'v3a-customer-status-filter',
  'v3a-customer-sort', 'v3a-attribution-panel', 'v3a-attribution-qr-image',
  'v3a-attribution-url', 'v3a-attribution-service-code', 'v3a-attribution-code-copy',
  'v3a-attribution-close', 'v3a-customer-guidance-title', 'v3a-customer-guidance-text',
  'v3a-report-import-panel', 'v3a-report-import-close', 'v3a-report-import-status',
  'v3a-report-import-file', 'v3a-report-import-extract', 'v3a-report-import-confirm',
  'v3a-report-import-client', 'v3a-report-import-name-wrap', 'v3a-report-import-name',
  'v3a-report-import-type', 'v3a-report-import-issue', 'v3a-report-import-extracted-name',
  'v3a-report-import-extracted-age', 'v3a-report-import-extracted-atd',
  'v3a-report-import-fingers', 'v3a-report-import-data-confirmed', 'v3a-report-import-submit'
];

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function boot(options = {}) {
  const nodes = new Map(ids.map((id) => [id, new FakeNode('div', id)]));
  nodes.get('v3a-customer-status-filter').value = 'all';
  nodes.get('v3a-customer-sort').value = 'latest';
  nodes.get('v3a-report-import-client').value = 'new';
  nodes.get('v3a-report-import-type').value = '儿童天赋报告';
  const created = [];
  const calls = [];
  let assignedUrl = '';
  let customerReads = 0;
  const document = {
    body: { dataset: { page: 'customers' } },
    createElement(tag) {
      const node = new FakeNode(tag);
      created.push(node);
      return node;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return nodes.get(selector.slice(1)) || null;
      let match = selector.match(/^\[data-finger-(symbol|trc)="([RL]\d)"\]$/);
      if (match) {
        const property = match[1] === 'symbol' ? 'fingerSymbol' : 'fingerTrc';
        return created.find((node) => node.dataset[property] === match[2]) || null;
      }
      return null;
    }
  };
  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/v3a-customers') {
      customerReads += 1;
      return response(200, { ok: true, csrfToken: 'TEST_CSRF_NOT_REAL', clients });
    }
    if (url.includes('action=extract')) {
      if (options.extractError) return response(502, { ok: false, error: '隔离识别失败' });
      return response(200, {
        ok: true,
        data: { fingers: validFingers, atd: 42, age: 12, name: '识别客户' }
      });
    }
    if (url.includes('action=confirm')) {
      if (options.confirmError) return response(502, { ok: false, error: '隔离入库失败' });
      return response(200, {
        ok: true,
        client: { id: '44444444-4444-4444-8444-444444444444', name: '识别客户' },
        report: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'ready' }
      });
    }
    if (url.includes('action=create')) {
      return response(200, {
        ok: true,
        uploadPath: '/report-upload.html?token=TEST_TOKEN_REDACTED',
        serviceCode: 'A1B2C3D4E5'
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  function QRCode() {}
  QRCode.CorrectLevel = { M: 1 };
  const context = {
    document,
    window: {
      location: {
        search: options.search || '',
        origin: 'https://www.aipiwen.cn',
        assign(url) { assignedUrl = url; }
      },
      QRCode
    },
    navigator: { clipboard: { async writeText() {} } },
    crypto: webcrypto,
    fetch,
    FormData,
    URL,
    URLSearchParams,
    Uint8Array,
    console: { warn() {}, error() {}, log() {} }
  };
  vm.runInNewContext(source, context, { filename: 'static/v3a-attribution.js' });
  await nextTurn();
  await nextTurn();
  return {
    nodes,
    created,
    calls,
    get assignedUrl() { return assignedUrl; },
    get customerReads() { return customerReads; },
    async trigger(id, type, extra = {}) {
      const node = nodes.get(id);
      assert.equal(typeof node.events[type], 'function', `${id} 缺少 ${type} 处理器`);
      return await node.events[type]({ currentTarget: node, preventDefault() {}, ...extra });
    }
  };
}

function makeFile(type = 'image/jpeg', bytes = 16) {
  return new Blob([new Uint8Array(bytes)], { type });
}

(async () => {
  const runtime = await boot();
  const list = runtime.nodes.get('v3a-real-customers-list');
  assert.equal(list.children.length, 3, '初始必须显示全部真实客户');
  const readyRow = list.children.find((row) => row.children[0]?.textContent === '甲客户');
  assert(readyRow && !readyRow.events.click, '真实客户整行不得绑定点击');
  const startButton = readyRow.children.at(-1);
  assert.equal(startButton.textContent, '开始解读');
  await startButton.events.click();
  assert.match(runtime.assignedUrl, /^ai-interpreter-session\.html\?clientId=.*&reportId=/,
    '独立开始解读按钮必须携带客户和报告进入');

  runtime.nodes.get('v3a-customer-search').value = '乙';
  await runtime.trigger('v3a-customer-search', 'input');
  assert.equal(list.children.length, 1, '客户姓名搜索必须过滤真实列表');
  runtime.nodes.get('v3a-customer-search').value = '';
  runtime.nodes.get('v3a-customer-status-filter').value = 'ready';
  await runtime.trigger('v3a-customer-status-filter', 'change');
  assert.equal(list.children.length, 1, '报告状态筛选必须过滤真实列表');
  runtime.nodes.get('v3a-customer-status-filter').value = 'all';
  runtime.nodes.get('v3a-customer-sort').value = 'name';
  await runtime.trigger('v3a-customer-sort', 'change');
  const expectedNameOrder = clients.map((client) => client.displayName)
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  assert.deepEqual(list.children.map((row) => row.children[0].textContent), expectedNameOrder,
    '客户姓名排序必须实际改变真实列表顺序');

  const interpretationRuntime = await boot({ search: '?intent=interpret' });
  assert.equal(interpretationRuntime.nodes.get('v3a-real-customers-title').textContent, '选择客户开始解读',
    'AI 解读助手入口必须显示明确的客户选择标题');
  assert.equal(interpretationRuntime.nodes.get('v3a-real-customers').scrolled, true,
    'AI 解读助手入口必须自动定位到真实客户列表');

  const fetchCountBeforeOpen = runtime.calls.length;
  await runtime.trigger('v3a-customer-upload', 'click');
  assert.equal(runtime.nodes.get('v3a-report-import-panel').hidden, false, '代客户上传必须打开工作台面板');
  assert.equal(runtime.calls.length, fetchCountBeforeOpen, '打开代传面板不得创建归属 token');
  assert.equal(runtime.assignedUrl.includes('report-upload.html'), false, '代传不得跳转公开上传页');

  await runtime.trigger('v3a-report-import-extract', 'click');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /先选择报告图片/,
    '未选择文件必须被拦截');
  runtime.nodes.get('v3a-report-import-file').files = [makeFile('image/gif')];
  await runtime.trigger('v3a-report-import-extract', 'click');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /仅支持/,
    '错误图片格式必须被拦截');
  runtime.nodes.get('v3a-report-import-file').files = [{ type: 'image/jpeg', size: 3 * 1024 * 1024 }];
  await runtime.trigger('v3a-report-import-extract', 'click');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /2\.5MB/,
    '超限图片必须被拦截');

  runtime.nodes.get('v3a-report-import-file').files = [makeFile()];
  await runtime.trigger('v3a-report-import-extract', 'click');
  assert.equal(runtime.nodes.get('v3a-report-import-confirm').hidden, false, '识别成功必须显示确认表单');
  assert.equal(runtime.nodes.get('v3a-report-import-name').value, '识别客户', '识别姓名必须带入新客户称呼');
  assert.equal(runtime.nodes.get('v3a-report-import-fingers').children.length, 10, '必须显示十指确认控件');

  runtime.nodes.get('v3a-report-import-name').value = '';
  await runtime.trigger('v3a-report-import-confirm', 'submit');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /客户称呼/, '新客户缺少称呼必须拦截');
  runtime.nodes.get('v3a-report-import-name').value = '确认客户';
  await runtime.trigger('v3a-report-import-confirm', 'submit');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /最想了解的问题/, '缺关注问题必须拦截');
  runtime.nodes.get('v3a-report-import-issue').value = '学习与沟通';
  await runtime.trigger('v3a-report-import-confirm', 'submit');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /核对并确认/, '未勾选人工确认必须拦截');
  runtime.nodes.get('v3a-report-import-data-confirmed').checked = true;
  await runtime.trigger('v3a-report-import-confirm', 'submit');
  const newConfirm = runtime.calls.find((call) => call.url.includes('action=confirm'));
  const newPayload = JSON.parse(newConfirm.init.body);
  assert.equal(newPayload.newClient.displayName, '确认客户');
  assert.equal(newPayload.existingClientId, null);
  assert.equal(newPayload.dataConfirmed, true);
  assert.equal(Object.keys(newPayload.extractedData.fingers).length, 10);
  assert(!('advisorId' in newPayload) && !('advisor_id' in newPayload), '浏览器不得提交指导师 ID');
  assert(runtime.customerReads >= 2, '成功入库后必须刷新真实客户列表');
  assert.match(runtime.nodes.get('v3a-report-import-status').textContent, /已保存到“我的客户”/,
    '成功后必须给出下一步提示');

  const existingRuntime = await boot();
  await existingRuntime.trigger('v3a-customer-upload', 'click');
  existingRuntime.nodes.get('v3a-report-import-file').files = [makeFile()];
  await existingRuntime.trigger('v3a-report-import-extract', 'click');
  existingRuntime.nodes.get('v3a-report-import-client').value = clients[0].id;
  await existingRuntime.trigger('v3a-report-import-client', 'change');
  assert.equal(existingRuntime.nodes.get('v3a-report-import-name-wrap').hidden, true,
    '选择已有客户后必须隐藏新客户称呼');
  existingRuntime.nodes.get('v3a-report-import-issue').value = '已有客户复测';
  existingRuntime.nodes.get('v3a-report-import-data-confirmed').checked = true;
  await existingRuntime.trigger('v3a-report-import-confirm', 'submit');
  const existingConfirm = existingRuntime.calls.find((call) => call.url.includes('action=confirm'));
  const existingPayload = JSON.parse(existingConfirm.init.body);
  assert.equal(existingPayload.existingClientId, clients[0].id);
  assert.equal(existingPayload.newClient, null);

  const extractFailure = await boot({ extractError: true });
  await extractFailure.trigger('v3a-customer-upload', 'click');
  extractFailure.nodes.get('v3a-report-import-file').files = [makeFile()];
  await extractFailure.trigger('v3a-report-import-extract', 'click');
  assert.match(extractFailure.nodes.get('v3a-report-import-status').textContent, /隔离识别失败/,
    '识别失败必须显示服务端安全错误');

  const confirmFailure = await boot({ confirmError: true });
  await confirmFailure.trigger('v3a-customer-upload', 'click');
  confirmFailure.nodes.get('v3a-report-import-file').files = [makeFile()];
  await confirmFailure.trigger('v3a-report-import-extract', 'click');
  confirmFailure.nodes.get('v3a-report-import-issue').value = '失败分支';
  confirmFailure.nodes.get('v3a-report-import-data-confirmed').checked = true;
  await confirmFailure.trigger('v3a-report-import-confirm', 'submit');
  assert.match(confirmFailure.nodes.get('v3a-report-import-status').textContent, /隔离入库失败/,
    '入库失败必须显示服务端安全错误');
  assert(confirmFailure.customerReads >= 2, '入库失败后也必须刷新列表以反映可能已创建的失败记录');

  console.log('PASS: advisor report import and customer controls runtime branches (24 checks)');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
