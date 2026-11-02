'use strict';

const assert = require('assert');
const { Readable } = require('stream');
const { readRawText, readRawBuffer } = require('../lib/read-request-body');
const { readRequestBody } = require('../server/v3a-session-store');
const { readRawBody: readSmsRawBody } = require('../server/v3a-sms-hook');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.REDIS_URL;
delete process.env.DASHSCOPE_API_KEY;

const guestChat = require('../api/guest-chat');
const adminConvs = require('../api/admin-convs');
const generateReport = require('../api/generate-report');
const extractFp = require('../api/extract-fp');
const dryRun = require('../lib/report-upload-p0-dryrun');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function hungRequest(url, fields = {}) {
  const req = new Readable({ read() {} });
  req.method = 'POST';
  req.url = url;
  req.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' };
  req.socket = { remoteAddress: '203.0.113.10' };
  req.query = {};
  let listened = false;
  const originalOn = req.on.bind(req);
  req.on = function on(event, listener) {
    if (event === 'data' || event === 'end') listened = true;
    return originalOn(event, listener);
  };
  Object.defineProperty(req, 'listenedForBody', { get: () => listened });
  Object.assign(req, fields);
  return req;
}

function streamRequest(url, chunks) {
  const req = Readable.from(chunks);
  req.method = 'POST';
  req.url = url;
  req.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' };
  req.socket = { remoteAddress: '203.0.113.10' };
  req.query = {};
  return req;
}

function installRedisMock() {
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/get/')) {
      return { ok: true, status: 200, json: async () => ({ result: null }), text: async () => '{"result":null}' };
    }
    return { ok: true, status: 200, json: async () => ({ result: [] }), text: async () => '{"result":[]}' };
  };
}

async function settle(work, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 1500);
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function testHelper() {
  const fromRaw = await readRawText({ rawBody: '{"a":1}', body: { a: 2 } });
  assert.strictEqual(fromRaw, '{"a":1}', 'rawBody must win over a parsed req.body');

  const fromObject = await readRawText({ body: { content: 'hi' } });
  assert.deepStrictEqual(JSON.parse(fromObject), { content: 'hi' });

  const fromString = await readRawText({ body: '{"event":"ping"}' });
  assert.strictEqual(fromString, '{"event":"ping"}');

  const streamed = await readRawText(streamRequest('/api/stats', [
    Buffer.from('{"event":'),
    Buffer.from('"ok"}'),
  ]));
  assert.strictEqual(streamed, '{"event":"ok"}');

  const ended = Readable.from([]);
  await new Promise((resolve) => {
    ended.on('data', () => {});
    ended.on('end', resolve);
  });
  assert.strictEqual(ended.readableEnded, true);
  const started = Date.now();
  assert.strictEqual(await readRawText(ended), '');
  assert.ok(Date.now() - started < 200, 'an already-consumed stream must not wait for end');

  await assert.rejects(
    () => readRawBuffer({ rawBody: Buffer.alloc(8) }, 4),
    (error) => error && error.code === 413 && error.statusCode === 413
  );
}

async function testGuestChat() {
  const empty = hungRequest('/api/guest-chat', { body: { content: '   ' } });
  const emptyRes = mockRes();
  await settle(() => guestChat(empty, emptyRes), 'guest-chat empty content');
  assert.strictEqual(empty.listenedForBody, false);
  assert.strictEqual(emptyRes.statusCode, 400);
  assert.strictEqual(emptyRes.body.error, '内容不能为空');
  empty.destroy();

  const raw = hungRequest('/api/guest-chat', { rawBody: '{"content":""}' });
  const rawRes = mockRes();
  await settle(() => guestChat(raw, rawRes), 'guest-chat rawBody');
  assert.strictEqual(raw.listenedForBody, false);
  assert.strictEqual(rawRes.statusCode, 400);
  raw.destroy();

  const tooBig = hungRequest('/api/guest-chat', { rawBody: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61) });
  const tooBigRes = mockRes();
  await settle(() => guestChat(tooBig, tooBigRes), 'guest-chat oversize');
  assert.strictEqual(tooBig.listenedForBody, false);
  assert.strictEqual(tooBigRes.statusCode, 413);
  tooBig.destroy();

  const streamed = streamRequest('/api/guest-chat', [Buffer.from('{"content":""}')]);
  const streamedRes = mockRes();
  await settle(() => guestChat(streamed, streamedRes), 'guest-chat stream fallback');
  assert.strictEqual(streamedRes.statusCode, 400);
  assert.strictEqual(streamedRes.body.error, '内容不能为空');

  const logReq = hungRequest('/api/log-session', {
    body: { sessionId: 'sess-preparsed', context: 'child', summary: 'hi', detail: 'ok' },
  });
  const logRes = mockRes();
  await settle(() => guestChat(logReq, logRes), 'log-session');
  assert.strictEqual(logReq.listenedForBody, false);
  assert.strictEqual(logRes.statusCode, 200);
  assert.strictEqual(logRes.body.ok, true);
  logReq.destroy();

  const synthReq = hungRequest('/api/synthesize', { body: { contexts: { child: [{ behavior: 'x' }] } } });
  const synthRes = mockRes();
  await settle(() => guestChat(synthReq, synthRes), 'synthesize');
  assert.strictEqual(synthReq.listenedForBody, false);
  assert.strictEqual(synthRes.statusCode, 400);
  synthReq.destroy();
}

async function testStats() {
  const recorded = hungRequest('/api/stats', { body: { event: 'page_view' } });
  const recordedRes = mockRes();
  await settle(() => adminConvs(recorded, recordedRes), 'stats record event');
  assert.strictEqual(recorded.listenedForBody, false);
  assert.strictEqual(recordedRes.statusCode, 200);
  assert.strictEqual(recordedRes.body.ok, true);
  recorded.destroy();

  const missing = hungRequest('/api/stats', { body: {} });
  const missingRes = mockRes();
  await settle(() => adminConvs(missing, missingRes), 'stats missing event');
  assert.strictEqual(missing.listenedForBody, false);
  assert.strictEqual(missingRes.statusCode, 400);
  assert.strictEqual(missingRes.body.error, 'event 必填');
  missing.destroy();

  const raw = hungRequest('/api/stats', { rawBody: '{"event":""}' });
  const rawRes = mockRes();
  await settle(() => adminConvs(raw, rawRes), 'stats rawBody');
  assert.strictEqual(raw.listenedForBody, false);
  assert.strictEqual(rawRes.statusCode, 400);
  raw.destroy();

  const streamed = streamRequest('/api/stats', [
    Buffer.from('{"event":'),
    Buffer.from('""}'),
  ]);
  const streamedRes = mockRes();
  await settle(() => adminConvs(streamed, streamedRes), 'stats stream fallback');
  assert.strictEqual(streamedRes.statusCode, 400);
  assert.strictEqual(streamedRes.body.error, 'event 必填');
}

async function testOtherHandlers() {
  const storeReq = hungRequest('/api/report-store', { rawBody: 'not-json' });
  const storeRes = mockRes();
  await settle(() => generateReport(storeReq, storeRes), 'report-store');
  assert.strictEqual(storeReq.listenedForBody, false);
  assert.strictEqual(storeRes.statusCode, 400);
  assert.strictEqual(storeRes.body.error, '请求体格式错误');
  storeReq.destroy();

  const reportReq = hungRequest('/api/generate-report', { body: {} });
  const reportRes = mockRes();
  await settle(() => generateReport(reportReq, reportRes), 'generate-report');
  assert.strictEqual(reportReq.listenedForBody, false);
  assert.strictEqual(reportRes.statusCode, 400);
  assert.strictEqual(reportRes.body.error, '缺少 engineResult');
  reportReq.destroy();

  const fpReq = hungRequest('/api/extract-fp', { body: {} });
  const fpRes = mockRes();
  await settle(() => extractFp(fpReq, fpRes), 'extract-fp');
  assert.strictEqual(fpReq.listenedForBody, false);
  assert.strictEqual(fpRes.statusCode, 400);
  assert.strictEqual(fpRes.body.error, '缺少 imageBase64 字段');
  fpReq.destroy();

  const dryReq = hungRequest('/api/report-upload-p0', {
    body: {
      reportText: '一份普通个人报告。',
      reportType: 'personal',
      userIdentity: 'self',
      userIntent: 'quick_reading',
      reportSubject: 'self',
      subjectAge: 32,
      subjectRelation: 'self',
      consentConfirmed: true,
    },
  });
  const dryRes = mockRes();
  await settle(() => dryRun(dryReq, dryRes), 'report-upload dry-run');
  assert.strictEqual(dryReq.listenedForBody, false);
  assert.strictEqual(dryRes.statusCode, 200);
  assert.strictEqual(dryRes.body.ok, true);
  dryReq.destroy();
}

async function testSessionAndSms() {
  assert.deepStrictEqual(readRequestBody({ body: { phone: '1' }, rawBody: '{"phone":"2"}' }), { phone: '1' });
  assert.deepStrictEqual(readRequestBody({ rawBody: '{"phone":"13800000000"}' }), { phone: '13800000000' });
  assert.deepStrictEqual(readRequestBody({}), {});

  const hung = new Readable({ read() {} });
  hung.headers = { 'content-type': 'application/json', 'content-length': '15' };
  hung.rawBody = '{"phone":"138"}';
  Object.defineProperty(hung, 'body', {
    get() { throw new Error('签名校验不得读取或重建 req.body'); },
  });
  assert.strictEqual(await readSmsRawBody(hung), '{"phone":"138"}');
  hung.destroy();

  const streamed = Readable.from([Buffer.from('{"ok":true}')]);
  streamed.headers = { 'content-type': 'application/json' };
  Object.defineProperty(streamed, 'body', {
    get() { throw new Error('签名校验不得读取或重建 req.body'); },
  });
  assert.strictEqual(await readSmsRawBody(streamed), '{"ok":true}');
}

async function main() {
  installRedisMock();
  await testHelper();
  await testGuestChat();
  await testStats();
  await testOtherHandlers();
  await testSessionAndSms();
  console.log('PASS: pre-parsed req.body/rawBody is used and stream reads stay a fallback');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
