const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

process.env.SESSION_SECRET = 'test_session_secret';
process.env.TENANT_ENABLED = 'true';
process.env.PLATFORM_ADMIN_OPENIDS = 'admin_openid';
process.env.KV_REST_API_URL = 'https://mock-redis.local';
process.env.KV_REST_API_TOKEN = 'test_token';

const store = new Map();

global.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.endsWith('/pipeline')) {
    const commands = JSON.parse(options.body || '[]');
    for (const cmd of commands) {
      const op = String(cmd[0]).toUpperCase();
      if (op === 'SET') {
        store.set(cmd[1], cmd[2]);
      } else if (op === 'LPUSH') {
        const key = cmd[1];
        const current = store.has(key) ? JSON.parse(store.get(key)) : [];
        current.unshift(JSON.parse(cmd[2]));
        store.set(key, JSON.stringify(current));
      } else if (op === 'LTRIM') {
        const key = cmd[1];
        const current = store.has(key) ? JSON.parse(store.get(key)) : [];
        store.set(key, JSON.stringify(current.slice(cmd[2], cmd[3] + 1)));
      }
    }
    return { json: async () => ({ result: commands.map(() => 'OK') }) };
  }
  const match = u.match(/\/get\/(.+)$/);
  if (match) {
    const key = decodeURIComponent(match[1]);
    return { json: async () => ({ result: store.get(key) || null }) };
  }
  throw new Error(`unexpected fetch: ${u}`);
};

const lib = require('../api/_lib');
const channelApi = require('../api/channel');

async function setJson(key, value) {
  await lib.redisSet(key, value);
}

function cookieFor(openid) {
  return `aipiwen_session=${lib.makeSessionToken(openid)}`;
}

function makeReq(method, action, { openid, body = {}, query = {}, urlExtra = '' } = {}) {
  const req = method === 'POST'
    ? Readable.from([JSON.stringify(body)])
    : Readable.from([]);
  req.method = method;
  req.query = { action, ...query };
  req.url = `/api/channel?action=${action}${urlExtra}`;
  req.headers = { host: 'localhost', cookie: openid ? cookieFor(openid) : '' };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

async function callApi(method, action, opts) {
  const req = makeReq(method, action, opts);
  const res = makeRes();
  await channelApi(req, res);
  return res;
}

async function seedUsers() {
  await setJson('user:admin_openid', { openid: 'admin_openid', role: lib.ROLES.PLATFORM_ADMIN, tenantId: 'consumer' });
  await setJson('user:xinyu_admin', { openid: 'xinyu_admin', role: lib.ROLES.CHANNEL_PARTNER, tenantId: 'xinyu' });
  await setJson('user:inst_admin', { openid: 'inst_admin', role: lib.ROLES.INSTITUTION, tenantId: 'inst_001' });
  await setJson('user:inst2_admin', { openid: 'inst2_admin', role: lib.ROLES.INSTITUTION, tenantId: 'inst_002' });
  await setJson('user:consumer_1', { openid: 'consumer_1', role: lib.ROLES.CONSUMER, tenantId: 'inst_001' });
  await setJson('user:consumer_2', { openid: 'consumer_2', role: lib.ROLES.CONSUMER, tenantId: 'inst_002' });
}

test('Phase 1 channel system local loop', async (t) => {
  await seedUsers();
  await lib.initXinyuTenant('admin_openid');
  await lib.createInstitutionTenant('xinyu', { id: 'inst_001', name: '测试机构一', referralCode: 'inst_001_c' }, 'xinyu_admin');
  await lib.createInstitutionTenant('xinyu', { id: 'inst_002', name: '测试机构二', referralCode: 'inst_002_c' }, 'xinyu_admin');

  await t.test('ref attribution first-lock and admin correction', async () => {
    let r = await lib.applyReferralAttribution('new_user_a', 'xinyu_c');
    assert.equal(r.ok, true);
    assert.equal(r.attribution.beneficiaryTenantId, 'xinyu');

    r = await lib.applyReferralAttribution('new_user_a', 'inst_001_c');
    assert.equal(r.changed, false);
    assert.equal(r.attribution.beneficiaryTenantId, 'xinyu');
    assert.equal(r.attribution.lastTouch.ref, 'inst_001_c');

    r = await lib.applyReferralAttribution('new_user_b', 'inst_001_c');
    assert.equal(r.attribution.beneficiaryTenantId, 'inst_001');

    r = await lib.applyReferralAttribution('new_user_b', '');
    assert.equal(r.ok, false);
    const locked = await lib.getAttribution('new_user_b');
    assert.equal(locked.beneficiaryTenantId, 'inst_001');

    const corrected = await lib.correctAttribution('new_user_a', {
      ref: 'inst_001_c',
      sourceTenantId: 'inst_001',
      beneficiaryTenantId: 'inst_001',
      referralType: 'c_user',
    }, 'admin_openid', 'manual test correction');
    assert.equal(corrected.beneficiaryTenantId, 'inst_001');
    const audit = await lib.redisGet('attribution:audit:new_user_a');
    assert.equal(audit.length, 1);
    assert.equal(audit[0].old_attribution.beneficiaryTenantId, 'xinyu');
    assert.equal(audit[0].new_attribution.beneficiaryTenantId, 'inst_001');
    assert.equal(audit[0].operator, 'admin_openid');
  });

  await t.test('seats keep type, quota, expiry and status', async () => {
    for (const seatType of lib.SEAT_TYPES) {
      const seat = await lib.createSeat({
        ownerTenantId: 'xinyu',
        assignedOpenid: `${seatType}_openid`,
        seatType,
        status: seatType === 'gift' ? 'revoked' : 'active',
        quotaLimit: { chat: 3, report: 1 },
        expiresAt: '2026-12-31T00:00:00.000Z',
      });
      assert.equal(seat.seatType, seatType);
      assert.equal(seat.quotaLimit.report, 1);
      assert.equal(seat.expiresAt, '2026-12-31T00:00:00.000Z');
    }
    const seats = await lib.listSeats('xinyu');
    assert.equal(seats.length, 4);
  });

  await t.test('mock order and commission rules', async () => {
    await lib.applyReferralAttribution('buyer_xinyu', 'xinyu_c');
    let result = await lib.createMockOrder({
      payerOpenid: 'buyer_xinyu',
      payerTenantId: 'xinyu',
      productType: 'c_report',
      amountFen: 10000,
      status: 'mock_paid',
    });
    assert.equal(result.commission.beneficiaryTenantId, 'xinyu');
    assert.equal(result.commission.rate, 0.2);
    assert.equal(result.commission.commissionAmountFen, 2000);

    await lib.applyReferralAttribution('buyer_inst', 'inst_001_c');
    result = await lib.createMockOrder({
      payerOpenid: 'buyer_inst',
      payerTenantId: 'inst_001',
      productType: 'c_report',
      amountFen: 10000,
      status: 'mock_paid',
    });
    assert.equal(result.commission.beneficiaryTenantId, 'inst_001');
    assert.equal(result.commission.rate, 0.2);
    const xinyuCommissions = await lib.listCommissionRecords('xinyu');
    assert.equal(xinyuCommissions.filter(c => c.orderId === result.order.orderId).length, 0);

    result = await lib.createMockOrder({
      payerOpenid: 'inst_001',
      payerTenantId: 'inst_001',
      productType: 'institution_first_year',
      amountFen: 360000,
      status: 'mock_paid',
    });
    assert.equal(result.commission.beneficiaryTenantId, 'xinyu');
    assert.equal(result.commission.rate, 0.4);

    result = await lib.createMockOrder({
      payerOpenid: 'inst_001',
      payerTenantId: 'inst_001',
      productType: 'institution_renewal',
      amountFen: 360000,
      status: 'mock_paid',
    });
    assert.equal(result.commission.beneficiaryTenantId, 'xinyu');
    assert.equal(result.commission.rate, 0.3);
  });

  await t.test('API permission isolation', async () => {
    await setJson('report:r1', {
      ownerOpenid: 'consumer_1',
      ownerTenantId: 'inst_001',
      sections: [{ title: 'private', content: 'secret report' }],
    });
    await setJson('conversation:s1:meta', { ownerOpenid: 'consumer_1', ownerTenantId: 'inst_001' });
    await setJson('conversation:s1:messages', [{ role: 'user', content: 'secret conversation' }]);

    let res = await callApi('GET', 'dashboard');
    assert.equal(res.statusCode, 401);

    res = await callApi('POST', 'init_xinyu', { openid: 'consumer_1', body: {} });
    assert.equal(res.statusCode, 403);

    res = await callApi('GET', 'customer_report', { openid: 'xinyu_admin', urlExtra: '&id=r1' });
    assert.equal(res.statusCode, 403);

    res = await callApi('GET', 'customer_conversation', { openid: 'xinyu_admin', urlExtra: '&sid=s1' });
    assert.equal(res.statusCode, 403);

    res = await callApi('GET', 'customer_profile', { openid: 'xinyu_admin', urlExtra: '&openid=consumer_1' });
    assert.equal(res.statusCode, 403);

    res = await callApi('GET', 'customer_report', { openid: 'inst_admin', urlExtra: '&id=r1' });
    assert.equal(res.statusCode, 200);

    res = await callApi('GET', 'customer_report', { openid: 'inst2_admin', urlExtra: '&id=r1' });
    assert.equal(res.statusCode, 403);

    res = await callApi('GET', 'customer_report', { openid: 'consumer_1', urlExtra: '&id=r1' });
    assert.equal(res.statusCode, 200);

    res = await callApi('GET', 'customer_report', { openid: 'consumer_2', urlExtra: '&id=r1' });
    assert.equal(res.statusCode, 403);

    res = await callApi('POST', 'create_institution', { openid: 'inst_admin', body: { name: '不应创建' } });
    assert.equal(res.statusCode, 403);

    res = await callApi('POST', 'correct_attribution', {
      openid: 'consumer_1',
      body: {
        openid: 'new_user_b',
        new_attribution: { ref: 'xinyu_c', sourceTenantId: 'xinyu', beneficiaryTenantId: 'xinyu', referralType: 'c_user' },
        reason: 'should fail',
      },
    });
    assert.equal(res.statusCode, 403);

    res = await callApi('POST', 'correct_attribution', {
      openid: 'admin_openid',
      body: {
        openid: 'new_user_b',
        new_attribution: { ref: 'xinyu_c', sourceTenantId: 'xinyu', beneficiaryTenantId: 'xinyu', referralType: 'c_user' },
        reason: 'api correction test',
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attribution.beneficiaryTenantId, 'xinyu');

    res = await callApi('GET', 'dashboard', { openid: 'xinyu_admin' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.subTenants.length, 2);
  });
});
