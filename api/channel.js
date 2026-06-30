/**
 * AIPIWEN · 渠道 Phase 1 最小 API
 *
 * 只做本地可演示闭环：tenant/referral/attribution/seat/mock order/commission。
 * 不接真实支付、不做自动结算、不做完整财务后台。
 */

const {
  redisGet,
  TENANT_ENABLED, ROLES,
  isChannelRole, isInstitutionRole,
  getTenant, listSubTenants, getTenantContext,
  initXinyuTenant, createInstitutionTenant,
  createReferral, getReferral, getAttribution, applyReferralAttribution, correctAttribution,
  createSeat, listSeats, createMockOrder, listMockOrders, listCommissionRecords,
  canAccessTenant, canReadCustomerPrivateData,
} = require('./_lib');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function requireLogin(res, ctx) {
  if (!ctx || !ctx.openid) {
    res.status(401).json({ error: '未登录' });
    return false;
  }
  return true;
}

function requirePlatform(res, ctx) {
  if (!requireLogin(res, ctx)) return false;
  if (ctx.role !== ROLES.PLATFORM_ADMIN) {
    res.status(403).json({ error: '权限不足' });
    return false;
  }
  return true;
}

async function resolveTenantForDashboard(ctx, requestedTenantId) {
  const tenantId = requestedTenantId || ctx.tenantId;
  if (!(await canAccessTenant(ctx, tenantId))) return null;
  return getTenant(tenantId);
}

async function listReferrals(tenantId) {
  const codes = await redisGet(`referrals:tenant:${tenantId}`).catch(() => []) || [];
  const results = [];
  for (const code of codes) {
    const referral = await getReferral(code);
    if (referral) results.push(referral);
  }
  return results;
}

async function countAttributionUsers(tenantId) {
  const list = await redisGet(`attribution:index:${tenantId}`).catch(() => []) || [];
  return Array.isArray(list) ? list.length : 0;
}

async function listTenantAndChildOrders(tenantId, includeChildren) {
  const orders = await listMockOrders(tenantId);
  if (!includeChildren) return orders;
  const children = await listSubTenants(tenantId);
  for (const child of children) {
    orders.push(...await listMockOrders(child.id));
  }
  return orders;
}

async function enrichSubTenantsForDashboard(subTenants) {
  const results = [];
  for (const child of subTenants || []) {
    results.push({
      ...child,
      attributionUserCount: await countAttributionUsers(child.id),
      mockOrderCount: (await listMockOrders(child.id)).length,
      mockCommissionCount: (await listCommissionRecords(child.id)).length,
    });
  }
  return results;
}

async function handleDashboard(req, res, ctx) {
  if (!requireLogin(res, ctx)) return;
  if (![ROLES.PLATFORM_ADMIN, ROLES.AGENT, ROLES.CHANNEL_PARTNER, ROLES.SCHOOL, ROLES.INSTITUTION].includes(ctx.role)) {
    return res.status(403).json({ error: '权限不足' });
  }
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const tenant = await resolveTenantForDashboard(ctx, url.searchParams.get('tenantId'));
  if (!tenant) return res.status(403).json({ error: '跨租户访问被拒绝' });

  const subTenants = isChannelRole(ctx.role) || ctx.role === ROLES.PLATFORM_ADMIN
    ? await enrichSubTenantsForDashboard(await listSubTenants(tenant.id))
    : [];

  const includeChildren = isChannelRole(ctx.role) || ctx.role === ROLES.PLATFORM_ADMIN;
  return res.status(200).json({
    ok: true,
    role: ctx.role,
    tenant,
    referrals: await listReferrals(tenant.id),
    attributionUserCount: await countAttributionUsers(tenant.id),
    subTenants,
    orders: await listTenantAndChildOrders(tenant.id, includeChildren),
    commissions: await listCommissionRecords(tenant.id),
    seats: await listSeats(tenant.id),
  });
}

async function handleCreateInstitution(req, res, ctx, body) {
  if (!requireLogin(res, ctx)) return;
  if (!(ctx.role === ROLES.PLATFORM_ADMIN || isChannelRole(ctx.role))) {
    return res.status(403).json({ error: '只有平台或一级服务商可开通二级服务商' });
  }
  const parentTenantId = ctx.role === ROLES.PLATFORM_ADMIN ? (body.parentTenantId || 'xinyu') : ctx.tenantId;
  if (!(await canAccessTenant(ctx, parentTenantId))) {
    return res.status(403).json({ error: '跨租户访问被拒绝' });
  }
  try {
    const tenant = await createInstitutionTenant(parentTenantId, body, ctx.openid);
    return res.status(200).json({ ok: true, tenant });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '创建失败' });
  }
}

async function handleCreateReferral(req, res, ctx, body) {
  if (!requireLogin(res, ctx)) return;
  const tenantId = body.tenantId || ctx.tenantId;
  const beneficiaryTenantId = body.beneficiaryTenantId || tenantId;
  if (!(await canAccessTenant(ctx, tenantId))) {
    return res.status(403).json({ error: '跨租户访问被拒绝' });
  }
  if (!(await canAccessTenant(ctx, beneficiaryTenantId))) {
    return res.status(403).json({ error: '跨租户访问被拒绝' });
  }
  try {
    const referral = await createReferral({
      code: body.code,
      tenantId,
      beneficiaryTenantId,
      referralType: body.referralType || 'c_user',
      createdBy: ctx.openid,
    });
    return res.status(200).json({ ok: true, referral });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '创建失败' });
  }
}

async function handleCreateSeat(req, res, ctx, body) {
  if (!requireLogin(res, ctx)) return;
  const ownerTenantId = body.ownerTenantId || ctx.tenantId;
  if (!(await canAccessTenant(ctx, ownerTenantId))) {
    return res.status(403).json({ error: '跨租户访问被拒绝' });
  }
  try {
    const seat = await createSeat({ ...body, ownerTenantId });
    return res.status(200).json({ ok: true, seat });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '创建失败' });
  }
}

async function handleCreateMockOrder(req, res, ctx, body) {
  if (!requireLogin(res, ctx)) return;
  const payerTenantId = body.payerTenantId || ctx.tenantId;
  if (!(await canAccessTenant(ctx, payerTenantId))) {
    return res.status(403).json({ error: '跨租户访问被拒绝' });
  }
  try {
    const result = await createMockOrder({ ...body, payerTenantId });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '创建失败' });
  }
}

async function handleApplyAttribution(req, res, ctx, body) {
  if (!requireLogin(res, ctx)) return;
  const openid = body.openid || ctx.openid;
  if (ctx.role === ROLES.CONSUMER && openid !== ctx.openid) {
    return res.status(403).json({ error: '权限不足' });
  }
  const result = await applyReferralAttribution(openid, body.ref);
  return res.status(result.ok ? 200 : 400).json(result);
}

async function handleCorrectAttribution(req, res, ctx, body) {
  if (!requirePlatform(res, ctx)) return;
  try {
    const attribution = await correctAttribution(body.openid, body.new_attribution || body.newAttribution, ctx.openid, body.reason);
    return res.status(200).json({ ok: true, attribution });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message || '修正失败' });
  }
}

async function enforcePrivateRead(req, res, ctx, resource) {
  if (!requireLogin(res, ctx)) return false;
  const allowed = await canReadCustomerPrivateData(ctx, resource?.ownerOpenid, resource?.ownerTenantId);
  if (!allowed.ok) {
    res.status(allowed.status || 403).json({ error: allowed.status === 401 ? '未登录' : '跨租户访问被拒绝' });
    return false;
  }
  return true;
}

async function handleCustomerReport(req, res, ctx) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const id = url.searchParams.get('id');
  if (!id) return res.status(400).json({ error: '缺少 id' });
  const report = await redisGet(`report:${id}`).catch(() => null);
  if (!report) return res.status(404).json({ error: '报告不存在' });
  if (!(await enforcePrivateRead(req, res, ctx, report))) return;
  return res.status(200).json({ ok: true, report });
}

async function handleCustomerConversation(req, res, ctx) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const sid = url.searchParams.get('sid');
  if (!sid) return res.status(400).json({ error: '缺少 sid' });
  const meta = await redisGet(`conversation:${sid}:meta`).catch(() => null);
  if (!meta) return res.status(404).json({ error: '会话不存在' });
  if (!(await enforcePrivateRead(req, res, ctx, meta))) return;
  const messages = await redisGet(`conversation:${sid}:messages`).catch(() => []) || [];
  return res.status(200).json({ ok: true, messages });
}

async function handleCustomerProfile(req, res, ctx) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const openid = url.searchParams.get('openid');
  if (!openid) return res.status(400).json({ error: '缺少 openid' });
  const user = await redisGet(`user:${openid}`).catch(() => null);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!(await enforcePrivateRead(req, res, ctx, { ownerOpenid: openid, ownerTenantId: user.tenantId }))) return;
  return res.status(200).json({
    ok: true,
    profile: {
      openid: user.openid,
      nickname: user.nickname,
      avatar: user.avatar,
      tenantId: user.tenantId,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!TENANT_ENABLED) {
    return res.status(200).json({ ok: false, error: '多租户功能未启用（TENANT_ENABLED=false）' });
  }

  const ctx = await getTenantContext(req);
  const action = req.query.action;

  if (req.method === 'GET') {
    if (action === 'dashboard') return handleDashboard(req, res, ctx);
    if (action === 'referral_info') {
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const referral = await getReferral(url.searchParams.get('ref'));
      return res.status(referral ? 200 : 404).json({ ok: !!referral, referral });
    }
    if (action === 'attribution') {
      if (!requireLogin(res, ctx)) return;
      const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      const openid = url.searchParams.get('openid') || ctx.openid;
      if (ctx.role !== ROLES.PLATFORM_ADMIN && openid !== ctx.openid) return res.status(403).json({ error: '权限不足' });
      return res.status(200).json({ ok: true, attribution: await getAttribution(openid) });
    }
    if (action === 'customer_report') return handleCustomerReport(req, res, ctx);
    if (action === 'customer_conversation') return handleCustomerConversation(req, res, ctx);
    if (action === 'customer_profile') return handleCustomerProfile(req, res, ctx);
    return res.status(400).json({ error: '无效 action' });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (action === 'init_xinyu') {
      if (!requirePlatform(res, ctx)) return;
      const tenant = await initXinyuTenant(ctx.openid);
      return res.status(200).json({ ok: true, tenant });
    }
    if (action === 'create_institution') return handleCreateInstitution(req, res, ctx, body);
    if (action === 'create_referral') return handleCreateReferral(req, res, ctx, body);
    if (action === 'apply_attribution') return handleApplyAttribution(req, res, ctx, body);
    if (action === 'correct_attribution') return handleCorrectAttribution(req, res, ctx, body);
    if (action === 'create_seat') return handleCreateSeat(req, res, ctx, body);
    if (action === 'create_mock_order') return handleCreateMockOrder(req, res, ctx, body);
    return res.status(400).json({ error: '无效 action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
