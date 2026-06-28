/**
 * AIPIWEN · 租户管理 API（里程碑 1）
 *
 * 路由（via vercel.json）：
 *   GET  /api/tenant?action=info              → 当前用户的租户信息
 *   GET  /api/tenant?action=list              → 直属子租户列表（代理看幼儿园）
 *   GET  /api/tenant?action=members           → 本租户下的用户列表
 *   POST /api/tenant?action=create            → 创建子租户（platform_admin 建 L1；agent 建 L2）
 *   POST /api/tenant?action=update            → 更新租户品牌配置
 *   POST /api/tenant?action=set_role          → 给用户分配角色（platform_admin 操作）
 *   POST /api/tenant?action=set_user_tenant   → 将用户移入指定租户（platform_admin 操作）
 *
 * 安全硬控：
 *   - 代理(L1) 只能建幼儿园(L2)，幼儿园不能再建下级（后端硬拒，不靠前端）
 *   - 不在自己租户树内的数据，一律 403
 *   - TENANT_ENABLED=false 时，所有端点返回 { ok:false, error:'多租户功能未启用' }
 */

const crypto = require('crypto');
const {
  redisSet, redisGet,
  getSessionToken, parseSessionToken,
  TENANT_ENABLED, TENANT_LEVEL, ROLES,
  getTenant, saveTenant, listSubTenants,
  getTenantContext, requireRole, ensureUserTenant,
} = require('./_lib');

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

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

function newTenantId() {
  return `t_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/** 检查 ctx.tenantId 是否在 targetTenantId 的祖先链上或相等（防跨租户操作） */
async function isInTree(ctx, targetTenantId) {
  if (ctx.role === ROLES.PLATFORM_ADMIN) return true;
  if (ctx.tenantId === targetTenantId) return true;
  // 检查 target 的 parentId 是否等于 ctx.tenantId
  const target = await getTenant(targetTenantId);
  return target && target.parentId === ctx.tenantId;
}

// ─── 处理器 ───────────────────────────────────────────────────────────────────

async function handleInfo(req, res, ctx) {
  const tenant = await getTenant(ctx.tenantId);
  return res.status(200).json({
    ok: true,
    role: ctx.role,
    tenantId: ctx.tenantId,
    tenant,
  });
}

async function handleList(req, res, ctx) {
  // 平台超管看所有 L1；代理看自己的 L2
  let subs;
  if (ctx.role === ROLES.PLATFORM_ADMIN) {
    const all = await redisGet('tenants:all') || [];
    subs = [];
    for (const id of all) {
      const t = await getTenant(id);
      if (t && t.level === TENANT_LEVEL.AGENT) subs.push(t);
    }
  } else {
    subs = await listSubTenants(ctx.tenantId);
  }
  return res.status(200).json({ ok: true, tenants: subs });
}

async function handleMembers(req, res, ctx) {
  // 列出 tenantId = ctx.tenantId 的用户（从 users:all 扫描，适合初期规模）
  const allOpenids = await redisGet('users:all') || [];
  const members = [];
  for (const openid of allOpenids) {
    const u = await redisGet(`user:${openid}`);
    if (u && (u.tenantId || 'consumer') === ctx.tenantId) {
      members.push({
        openid: u.openid,
        nickname: u.nickname,
        avatar: u.avatar,
        role: u.role || ROLES.CONSUMER,
        tenantId: u.tenantId || 'consumer',
        createdAt: u.createdAt,
      });
    }
  }
  return res.status(200).json({ ok: true, members });
}

async function handleCreate(req, res, ctx, body) {
  // 只有 platform_admin 能建 L1（代理），agent 能建 L2（幼儿园）
  if (ctx.role !== ROLES.PLATFORM_ADMIN && ctx.role !== ROLES.AGENT) {
    return res.status(403).json({ error: '无权创建租户' });
  }

  const parentLevel = ctx.role === ROLES.PLATFORM_ADMIN ? -1 : TENANT_LEVEL.AGENT;
  const newLevel    = parentLevel + 1;

  // 硬控：最多 2 级（0=consumer,1=agent,2=school），school 不能创建子级
  if (newLevel > TENANT_LEVEL.SCHOOL) {
    return res.status(403).json({ error: '超出最大层级（L2 不能再建子租户）' });
  }

  const { brandName, logo, themeColor, subdomain, contactName, contactPhone } = body;
  if (!brandName) return res.status(400).json({ error: '缺少 brandName' });

  // subdomain 唯一性检查
  if (subdomain) {
    const existing = await redisGet(`tenant:by:subdomain:${subdomain}`);
    if (existing) return res.status(409).json({ error: 'subdomain 已被占用' });
  }

  const tenant = {
    id:          newTenantId(),
    level:       newLevel,
    parentId:    ctx.tenantId,
    canInvite:   newLevel === TENANT_LEVEL.AGENT, // 只有 L1 可邀请
    brandName:   brandName.trim(),
    logo:        logo || '',
    themeColor:  themeColor || '#C2692A',
    subdomain:   subdomain || '',
    contactName: contactName || '',
    contactPhone:contactPhone || '',
    status:      'active',
    createdAt:   new Date().toISOString(),
    createdBy:   ctx.openid,
  };

  await saveTenant(tenant);
  console.log(`[tenant.create] ${ctx.openid} 创建租户 ${tenant.id} (L${newLevel} ${brandName})`);
  return res.status(200).json({ ok: true, tenant });
}

async function handleUpdate(req, res, ctx, body) {
  const { tenantId, brandName, logo, themeColor, subdomain, contactName, contactPhone, status } = body;
  const tid = tenantId || ctx.tenantId;

  if (!await isInTree(ctx, tid)) {
    return res.status(403).json({ error: '无权修改该租户' });
  }

  const tenant = await getTenant(tid);
  if (!tenant || tid === 'consumer') return res.status(404).json({ error: '租户不存在' });

  // 更新允许的字段
  if (brandName)    tenant.brandName    = brandName.trim();
  if (logo !== undefined) tenant.logo   = logo;
  if (themeColor)   tenant.themeColor   = themeColor;
  if (contactName)  tenant.contactName  = contactName;
  if (contactPhone) tenant.contactPhone = contactPhone;
  // subdomain 变更需重建索引
  if (subdomain && subdomain !== tenant.subdomain) {
    const existing = await redisGet(`tenant:by:subdomain:${subdomain}`);
    if (existing && existing !== tid) return res.status(409).json({ error: 'subdomain 已被占用' });
    if (tenant.subdomain) await redisSet(`tenant:by:subdomain:${tenant.subdomain}`, null, 1);
    tenant.subdomain = subdomain;
  }
  // 只有 platform_admin 能停用租户
  if (status && ctx.role === ROLES.PLATFORM_ADMIN) tenant.status = status;

  tenant.updatedAt = new Date().toISOString();
  await saveTenant(tenant);
  return res.status(200).json({ ok: true, tenant });
}

async function handleSetRole(req, res, ctx, body) {
  // 只有 platform_admin 才能分配角色
  if (ctx.role !== ROLES.PLATFORM_ADMIN) {
    return res.status(403).json({ error: '只有平台超管可分配角色' });
  }
  const { targetOpenid, role, tenantId } = body;
  if (!targetOpenid || !role) return res.status(400).json({ error: '缺少 targetOpenid / role' });

  const allowedRoles = Object.values(ROLES);
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: `无效角色，可选：${allowedRoles.join(', ')}` });
  }

  const user = await redisGet(`user:${targetOpenid}`);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 如果指定了 tenantId，验证该租户存在
  if (tenantId && tenantId !== 'consumer') {
    const t = await getTenant(tenantId);
    if (!t) return res.status(404).json({ error: '租户不存在' });
  }

  user.role     = role;
  user.tenantId = tenantId || user.tenantId || 'consumer';
  user.roleSetAt = new Date().toISOString();
  user.roleSetBy = ctx.openid;
  await redisSet(`user:${targetOpenid}`, user);

  console.log(`[tenant.set_role] ${ctx.openid} → ${targetOpenid} role=${role} tenant=${user.tenantId}`);
  return res.status(200).json({ ok: true, openid: targetOpenid, role, tenantId: user.tenantId });
}

async function handleSetUserTenant(req, res, ctx, body) {
  if (ctx.role !== ROLES.PLATFORM_ADMIN) {
    return res.status(403).json({ error: '只有平台超管可移动用户租户' });
  }
  const { targetOpenid, tenantId } = body;
  if (!targetOpenid || !tenantId) return res.status(400).json({ error: '缺少参数' });

  const user = await redisGet(`user:${targetOpenid}`);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  user.tenantId     = tenantId;
  user.tenantSetAt  = new Date().toISOString();
  user.tenantSetBy  = ctx.openid;
  await redisSet(`user:${targetOpenid}`, user);
  return res.status(200).json({ ok: true });
}

// ─── 主路由 ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!TENANT_ENABLED) {
    return res.status(200).json({ ok: false, error: '多租户功能未启用（TENANT_ENABLED=false）' });
  }

  // 所有端点都需要登录
  const ctx = await getTenantContext(req);
  if (!ctx || !ctx.openid) return res.status(401).json({ error: '未登录' });

  const action = req.query.action;

  // GET 端点
  if (req.method === 'GET') {
    if (action === 'info')    return handleInfo(req, res, ctx);
    if (action === 'list')    return handleList(req, res, ctx);
    if (action === 'members') return handleMembers(req, res, ctx);
    return res.status(400).json({ error: '无效 action' });
  }

  // POST 端点
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (action === 'create')          return handleCreate(req, res, ctx, body);
    if (action === 'update')          return handleUpdate(req, res, ctx, body);
    if (action === 'set_role')        return handleSetRole(req, res, ctx, body);
    if (action === 'set_user_tenant') return handleSetUserTenant(req, res, ctx, body);
    return res.status(400).json({ error: '无效 action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
