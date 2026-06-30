/**
 * AIPIWEN 公共工具库
 * 供 auth.js / children.js 等 API 文件引用
 * 不直接对外暴露路由
 */

const crypto = require('crypto');

// SESSION_SECRET 未配置时不允许使用默认值，防止生产环境 session 被伪造
const SESSION_KEY = process.env.SESSION_SECRET;
if (!SESSION_KEY) {
  console.error('[FATAL] SESSION_SECRET 未配置，请在 Vercel 环境变量中设置');
}

// ─── Redis 封装 ───────────────────────────────────────────────────────────────
function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.REDIS_URL  || ''; }
function kvToken() { return process.env.KV_REST_API_TOKEN || ''; }

async function redisSet(key, value, exSeconds) {
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];
  await fetch(`${kvUrl()}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([cmd]),
  });
}

async function redisGet(key) {
  const res  = await fetch(`${kvUrl()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

// ─── Session 工具 ─────────────────────────────────────────────────────────────
function makeSessionToken(openid) {
  const payload = `${openid}:${Date.now()}`;
  const sig     = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function parseSessionToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts   = decoded.split(':');
    const sig     = parts.pop();
    const payload = parts.join(':');
    const expected = crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('hex');
    if (sig !== expected) return null;
    return parts[0]; // openid
  } catch { return null; }
}

function getSessionToken(req) {
  const match = (req.headers.cookie || '').match(/aipiwen_session=([^;]+)/);
  return match ? match[1] : null;
}

function getOpenid(req) {
  const token = getSessionToken(req);
  return token ? parseSessionToken(token) : null;
}

// ─── 孩子画像生成 ─────────────────────────────────────────────────────────────
// 读取孩子全部对话记录 → Qwen 压缩成成长摘要 → 写入 Redis
// portrait:{openid}:{childId} = { summary, generatedAt, recordCount }
async function generatePortrait(openid, childId) {
  try {
    const user    = await redisGet(`user:${openid}`);
    const child   = (user?.children || []).find(c => c.id === childId);
    const records = await redisGet(`records:${openid}:${childId}`) || [];

    if (!child || records.length < 3) return null; // 数据太少，不生成

    const fp = child.fingerprint || {};
    const fingerprintDesc = fp.trc
      ? `指纹数据：TRC总嵴线数=${fp.trc}，ATD角度=${fp.atd || '未知'}，大拇指类型=${fp.thumbType || '未知'}。`
      : '';

    // 按时间正序，取最多80条
    const sorted = [...records].reverse().slice(0, 80);
    const recordsText = sorted.map(r => {
      const role = r.role === 'ai' ? 'AI顾问' : '家长';
      return `[${r.createdAt?.slice(0, 10) || ''}][${role}] ${r.content}`;
    }).join('\n');

    const prompt = `你是一位儿童发展分析专家。请基于以下家长与AI顾问的对话记录，生成一段关于孩子的"成长画像摘要"。

孩子基本信息：
- 姓名：${child.name}，${child.age || '未知'}岁
- ${fingerprintDesc}
- 共有${records.length}条记录，以下展示最近${sorted.length}条：

${recordsText}

请生成一段300字以内的成长画像摘要，包含：
1. 孩子突出的2-3个行为/性格特征（用具体例子支撑）
2. 家长最关注的问题领域
3. 孩子近期的变化趋势（如有）

语气客观专业，这段摘要会作为上下文注入给AI顾问，帮助AI更了解这个孩子。不需要给建议，只需要描述事实和规律。`;

    const { text: summary } = await callClaude({
      model: MODEL_FREE, messages: [{ role: 'user', content: prompt }], maxTokens: 600,
    }).catch(() => ({ text: null }));
    if (!summary) return null;

    const portrait = { summary, generatedAt: new Date().toISOString(), recordCount: records.length };
    await redisSet(`portrait:${openid}:${childId}`, portrait);
    return portrait;
  } catch (e) {
    console.error('generatePortrait error:', e.message);
    return null;
  }
}

// 画像是否需要刷新（超过3天或不存在）
async function portraitNeedsRefresh(openid, childId) {
  const p = await redisGet(`portrait:${openid}:${childId}`);
  if (!p?.generatedAt) return true;
  const ageDays = (Date.now() - new Date(p.generatedAt).getTime()) / 86400000;
  return ageDays > 3;
}

// ─── 跨用户全局模式读取 ───────────────────────────────────────────────────────
// 供 chat prompt 注入用，值由 digest.js action=patterns 写入
async function getGlobalPatterns() {
  const gp = await redisGet('global:patterns');
  return gp?.patterns || null;
}

// ─── Redis 记录归档 ───────────────────────────────────────────────────────────
// records 超过 MAX_RECORDS 条时，把旧记录压缩进归档 key
const MAX_RECORDS = 200;

async function archiveRecordsIfNeeded(openid, childId, records) {
  if (records.length <= MAX_RECORDS) return records;

  // 把第 MAX_RECORDS+1 条之后的旧记录单独存档（最多保留50条供回顾）
  const toArchive = records.slice(MAX_RECORDS, MAX_RECORDS + 50);
  const archiveKey = `records_archive:${openid}:${childId}:${Date.now()}`;
  await redisSet(archiveKey, toArchive, 365 * 86400); // 保留1年

  // 主列表只保留最新 MAX_RECORDS 条
  return records.slice(0, MAX_RECORDS);
}

// ─── 专家知识库搜索（直接读 Redis，不走 HTTP）────────────────────────────────
function extractWords(text) {
  const words = new Set();
  (text.match(/[一-龥]{2,4}/g) || []).forEach(w => words.add(w));
  (text.toLowerCase().match(/[a-z]{3,}/g) || []).forEach(w => words.add(w));
  return [...words];
}

async function searchKnowledge(query) {
  if (!query?.trim()) return [];
  const queryWords = extractWords(query.slice(0, 80));
  if (queryWords.length === 0) return [];

  const candidateScores = {};
  for (const word of queryWords.slice(0, 15)) {
    const ids = await redisGet(`knowledge:index:${word}`) || [];
    ids.forEach(id => { candidateScores[id] = (candidateScores[id] || 0) + 1; });
  }
  if (Object.keys(candidateScores).length === 0) return [];

  const topIds = Object.entries(candidateScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  const chunks = await redisGet('knowledge:chunks') || [];
  return topIds.map(id => chunks.find(c => c.id === id)).filter(Boolean);
}

// ─── 用户索引（注册/追加） ────────────────────────────────────────────────────
// 用于 digest.js 遍历所有用户
async function registerUser(openid) {
  const list = await redisGet('users:all') || [];
  if (!list.includes(openid)) {
    list.push(openid);
    await redisSet('users:all', list);
  }
}

// ─── 邀请裂变 ─────────────────────────────────────────────────────────────────
// event → { bonusKey(ip), amount }
const REFERRAL_REWARDS = {
  chat:         { bonusKey: (ip) => `quota:bonus:chat:${ip}`,         amount: 3 },
  report:       { bonusKey: (ip) => `quota:bonus:report:${ip}`,       amount: 1 },
  practitioner: { bonusKey: (ip) => `quota:bonus:practitioner:${ip}`, amount: 2 },
};

// 创建邀请 token（10位hex，TTL 30天）
async function createInviteToken(ip) {
  const token = crypto.randomBytes(5).toString('hex'); // 10 chars
  await redisSet(`invite:${token}`, { ip, created: Date.now() }, 30 * 86400);
  return token;
}

// 给邀请人积分
// callerIp = 被邀请人IP，token = 邀请 token，event = 'chat' | 'report' | 'practitioner'
// 返回 true=积分成功，false=已积分/无效/自邀
async function creditReferral(callerIp, token, event) {
  if (!token || !REFERRAL_REWARDS[event]) return false;
  const usedKey = `invite:used:${token}:${callerIp}:${event}`;
  try {
    const [alreadyUsed, invite] = await Promise.all([
      redisGet(usedKey),
      redisGet(`invite:${token}`),
    ]);
    if (alreadyUsed || !invite?.ip) return false;
    if (invite.ip === callerIp) return false; // 自邀无效

    // ⚠️ 先写 usedKey 防重（写成功后即使 bonus 写失败也不会双倍积分）
    await redisSet(usedKey, 1, 30 * 86400);

    const { bonusKey, amount } = REFERRAL_REWARDS[event];
    const bk  = bonusKey(invite.ip);
    const cur = (await redisGet(bk)) || 0;
    await redisSet(bk, cur + amount, 30 * 86400); // 奖励 30 天有效
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AI API 共享封装 — 使用阿里云 DashScope（通义千问，支持支付宝充值）
//  接口格式 OpenAI-compatible，与 Claude 调用签名完全相同，其他文件无需改动
// ═══════════════════════════════════════════════════════════════════════════

// ★ 模型常量
const MODEL_FREE = 'qwen-plus';    // 对话/文本解读（便宜快速）
const MODEL_DEEP = 'qwen-vl-max'; // 视觉识别 + 深度报告（支持图片）

const DS_API = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 统一 AI 调用入口（DashScope OpenAI-compatible）
 * 调用签名与原 callClaude 完全一致，上层代码无需修改
 */
async function callClaude({ model, system, messages, maxTokens = 600, cache = false, timeoutMs = 25000 }) {
  const apiKey = process.env.DASHSCOPE_API_KEY || '';

  // 合并 system 提示（DashScope 走 role:system message）
  const sysMsg = messages.find(m => m.role === 'system');
  const systemText = system || sysMsg?.content || '';
  const filteredMsgs = messages.filter(m => m.role !== 'system');

  const allMessages = systemText
    ? [{ role: 'system', content: systemText }, ...filteredMsgs]
    : filteredMsgs;

  // DashScope Qwen-VL 原生支持 image_url 格式，无需转换
  const body = {
    model,
    max_tokens: maxTokens,
    messages:   allMessages,
  };

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(DS_API, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      const err = Object.assign(new Error(`DS ${res.status}`), { status: res.status, body: rawText.slice(0, 300) });
      console.error('[DashScope]', err.message, err.body);
      throw err;
    }
    const data = JSON.parse(rawText);
    // OpenAI-compatible 响应格式
    const text = data.choices?.[0]?.message?.content?.trim() || null;
    trackApiSpend(model, data.usage?.prompt_tokens || 0, data.usage?.completion_tokens || 0).catch(() => {});
    return { text, usage: data.usage || {} };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── 每日 API Spend 追踪（DashScope 人民币计费） ──────────────────────────────
const _PRICING = {
  [MODEL_FREE]: { in: 0.0008 / 1000, out: 0.002 / 1000 }, // qwen-plus CNY/token
  [MODEL_DEEP]: { in: 0.12   / 1000, out: 0.12  / 1000 }, // qwen-vl-max CNY/token
};
const _USD_TO_CNY = 1; // DashScope 已是人民币，直接用

async function trackApiSpend(model, inputTokens, outputTokens) {
  if (!inputTokens && !outputTokens) return;
  const p = _PRICING[model] || _PRICING[MODEL_DEEP];
  const costCNY = (inputTokens * p.in + outputTokens * p.out) * _USD_TO_CNY;
  const yyyymmdd = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  const key = `spend:daily:${yyyymmdd}`;
  const prev = (await redisGet(key).catch(() => null)) || 0;
  const total = prev + costCNY;
  await redisSet(key, total, 3 * 86400);
  const threshold = Number(process.env.SPEND_ALERT_CNY || '50');
  if (total >= threshold && prev < threshold) {
    sendSpendAlert(total, yyyymmdd, threshold).catch(() => {});
  }
}

async function sendSpendAlert(totalCNY, date, threshold) {
  const corpId      = process.env.WECHAT_CORP_ID;
  const agentSecret = process.env.WECHAT_AGENT_SECRET;
  if (!corpId || !agentSecret) return;
  try {
    const tk = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${agentSecret}`)
      .then(r => r.json()).then(d => d.access_token);
    if (!tk) return;
    await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tk}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: process.env.SPEND_ALERT_RECIPIENT || '@all',
        agentid: process.env.WECHAT_AGENT_ID || '',
        msgtype: 'text',
        text: { content: `⚠️ AIPIWEN API 消耗告警\n日期：${date}\n今日已消耗：¥${totalCNY.toFixed(2)}\n告警阈值：¥${threshold}\n请检查是否有异常流量。` },
      }),
    });
  } catch (e) { console.error('[spend-alert]', e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 里程碑 1 — 多租户地基
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TENANT_ENABLED=true  → 多租户逻辑生效
 * TENANT_ENABLED=false（默认）→ 所有现有逻辑完全不变，本节代码透明
 *
 * PLATFORM_ADMIN_OPENIDS → 逗号分隔的超管 openid 列表
 */
const TENANT_ENABLED          = process.env.TENANT_ENABLED === 'true';
const PLATFORM_ADMIN_OPENIDS  = (process.env.PLATFORM_ADMIN_OPENIDS || '').split(',').filter(Boolean);

// ─── 租户等级常量 ─────────────────────────────────────────────────────────────
const TENANT_LEVEL = { CONSUMER: 0, AGENT: 1, SCHOOL: 2, CHANNEL_PARTNER: 1, INSTITUTION: 2 };

// ─── 角色常量 ─────────────────────────────────────────────────────────────────
const ROLES = {
  PLATFORM_ADMIN : 'platform_admin', // 平台超管
  AGENT          : 'agent',          // 代理（L1）
  SCHOOL         : 'school',         // 幼儿园（L2）
  CHANNEL_PARTNER: 'channel_partner',// 渠道服务商（L1，兼容 agent）
  INSTITUTION    : 'institution',    // 合作机构（L2，兼容 school）
  CONSULTANT     : 'consultant',     // 顾问
  CONSUMER       : 'consumer',       // C 端用户（默认）
};

const TENANT_TYPES = {
  CONSUMER        : 'consumer',
  AGENT           : 'agent',
  SCHOOL          : 'school',
  CHANNEL_PARTNER : 'channel_partner',
  INSTITUTION     : 'institution',
};

const SEAT_TYPES = ['staff', 'experience', 'gift', 'customer'];
const ORDER_STATUS = ['mock_pending', 'mock_paid', 'mock_cancelled'];
const COMMISSION_STATUS = ['pending', 'confirmed', 'cancelled'];

function isChannelRole(role) {
  return role === ROLES.AGENT || role === ROLES.CHANNEL_PARTNER;
}

function isInstitutionRole(role) {
  return role === ROLES.SCHOOL || role === ROLES.INSTITUTION;
}

// ─── 租户 CRUD ────────────────────────────────────────────────────────────────

/** 读取租户对象；consumer 租户不存在时返回默认对象 */
async function getTenant(tenantId) {
  if (!tenantId || tenantId === 'consumer') {
    return { id: 'consumer', level: TENANT_LEVEL.CONSUMER, parentId: null,
             canInvite: false, brandName: 'AIPIWEN', status: 'active' };
  }
  return redisGet(`tenant:${tenantId}`);
}

/** 保存租户并维护索引 */
async function saveTenant(tenant) {
  await redisSet(`tenant:${tenant.id}`, tenant);
  const all = await redisGet('tenants:all') || [];
  if (!all.includes(tenant.id)) {
    all.push(tenant.id);
    await redisSet('tenants:all', all);
  }
  if (tenant.subdomain) {
    await redisSet(`tenant:by:subdomain:${tenant.subdomain}`, tenant.id);
  }
  return tenant;
}

function buildReferralLink(refCode, tenantId) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tid', tenantId);
  if (refCode) params.set('ref', refCode);
  return `/?${params.toString()}`;
}

function normalizeTenantForChannel(raw) {
  const tenant = { ...(raw || {}) };
  if (tenant.level === TENANT_LEVEL.AGENT && !tenant.tenantType) tenant.tenantType = TENANT_TYPES.AGENT;
  if (tenant.level === TENANT_LEVEL.SCHOOL && !tenant.tenantType) tenant.tenantType = TENANT_TYPES.SCHOOL;
  if (tenant.tenantType === TENANT_TYPES.CHANNEL_PARTNER) tenant.level = TENANT_LEVEL.CHANNEL_PARTNER;
  if (tenant.tenantType === TENANT_TYPES.INSTITUTION) tenant.level = TENANT_LEVEL.INSTITUTION;
  tenant.brand = tenant.brand || {
    name: tenant.brandName || tenant.name || 'AIPIWEN',
    logoUrl: tenant.logo || '',
    primaryColor: tenant.themeColor || '#C2692A',
    accentColor: '#FDE8D6',
  };
  return tenant;
}

async function saveChannelTenant(rawTenant) {
  return saveTenant(normalizeTenantForChannel(rawTenant));
}

/** 列出某父级下的直属子租户 */
async function listSubTenants(parentId) {
  const all = await redisGet('tenants:all') || [];
  const results = [];
  for (const id of all) {
    const t = await getTenant(id);
    if (t && t.parentId === parentId && t.status !== 'disabled') results.push(t);
  }
  return results;
}

async function getTenantTreeIds(rootTenantId) {
  const ids = [rootTenantId];
  const direct = await listSubTenants(rootTenantId);
  for (const t of direct) ids.push(t.id);
  return ids;
}

async function createReferral({ code, tenantId, beneficiaryTenantId, referralType = 'c_user', createdBy = 'system' }) {
  const cleanCode = String(code || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  if (!cleanCode) throw new Error('referral code required');
  const tenant = await getTenant(beneficiaryTenantId || tenantId);
  if (!tenant) throw new Error('beneficiary tenant not found');
  const now = new Date().toISOString();
  const referral = {
    code: cleanCode,
    tenantId: tenantId || tenant.id,
    beneficiaryTenantId: beneficiaryTenantId || tenant.id,
    referralType,
    link: buildReferralLink(cleanCode, tenantId || tenant.id),
    status: 'active',
    createdBy,
    createdAt: now,
  };
  await redisSet(`referral:${cleanCode}`, referral);
  const idxKey = `referrals:tenant:${referral.beneficiaryTenantId}`;
  const list = await redisGet(idxKey).catch(() => []) || [];
  if (!list.includes(cleanCode)) {
    list.push(cleanCode);
    await redisSet(idxKey, list);
  }
  return referral;
}

async function getReferral(code) {
  if (!code) return null;
  const cleanCode = String(code).replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  const referral = await redisGet(`referral:${cleanCode}`).catch(() => null);
  return referral?.status === 'active' ? referral : null;
}

async function getAttribution(openid) {
  if (!openid) return null;
  return redisGet(`attribution:user:${openid}`).catch(() => null);
}

async function recordAttributionTouch(openid, referral) {
  if (!openid || !referral) return null;
  const now = new Date().toISOString();
  const existing = await getAttribution(openid);
  if (existing?.locked) {
    existing.lastTouch = { ref: referral.code, tenantId: referral.beneficiaryTenantId, at: now };
    await redisSet(`attribution:user:${openid}`, existing);
    return { attribution: existing, locked: true, changed: false };
  }
  const record = {
    attributionId: `attr_${openid}`,
    openid,
    ref: referral.code,
    sourceTenantId: referral.tenantId,
    beneficiaryTenantId: referral.beneficiaryTenantId,
    referralType: referral.referralType || 'c_user',
    locked: true,
    firstTouchAt: now,
    lockedAt: now,
    lastTouch: { ref: referral.code, tenantId: referral.beneficiaryTenantId, at: now },
  };
  await redisSet(`attribution:user:${openid}`, record);
  const idxKey = `attribution:index:${record.beneficiaryTenantId}`;
  const list = await redisGet(idxKey).catch(() => []) || [];
  if (!list.includes(openid)) {
    list.push(openid);
    await redisSet(idxKey, list);
  }
  return { attribution: record, locked: true, changed: true };
}

async function applyReferralAttribution(openid, refCode) {
  const referral = await getReferral(refCode);
  if (!referral) return { ok: false, reason: 'invalid_ref' };
  const result = await recordAttributionTouch(openid, referral);
  return { ok: true, referral, ...result };
}

async function correctAttribution(openid, newAttribution, operator, reason) {
  if (!openid || !newAttribution?.beneficiaryTenantId) throw new Error('invalid attribution correction');
  const old = await getAttribution(openid);
  const now = new Date().toISOString();
  const updated = {
    ...(old || { attributionId: `attr_${openid}`, openid }),
    ...newAttribution,
    locked: true,
    correctedAt: now,
    correctedBy: operator,
  };
  await redisSet(`attribution:user:${openid}`, updated);
  if (old?.beneficiaryTenantId && old.beneficiaryTenantId !== updated.beneficiaryTenantId) {
    const oldKey = `attribution:index:${old.beneficiaryTenantId}`;
    const oldList = await redisGet(oldKey).catch(() => []) || [];
    await redisSet(oldKey, oldList.filter(id => id !== openid));
  }
  const auditKey = `attribution:audit:${openid}`;
  const audit = await redisGet(auditKey).catch(() => []) || [];
  audit.push({
    old_attribution: old || null,
    new_attribution: updated,
    operator,
    reason: reason || '',
    timestamp: now,
  });
  await redisSet(auditKey, audit.slice(-50));
  const idxKey = `attribution:index:${updated.beneficiaryTenantId}`;
  const list = await redisGet(idxKey).catch(() => []) || [];
  if (!list.includes(openid)) {
    list.push(openid);
    await redisSet(idxKey, list);
  }
  return updated;
}

async function initXinyuTenant(createdBy = 'local') {
  const tenant = normalizeTenantForChannel({
    id: 'xinyu',
    tenantType: TENANT_TYPES.CHANNEL_PARTNER,
    level: TENANT_LEVEL.CHANNEL_PARTNER,
    parentId: null,
    canInvite: true,
    brandName: '鑫域文化',
    name: '鑫域文化',
    logo: '/assets/xinyu-logo.png',
    themeColor: '#123B5D',
    referralCode: 'xinyu_c',
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy,
  });
  await saveChannelTenant(tenant);
  const referral = await createReferral({
    code: 'xinyu_c',
    tenantId: tenant.id,
    beneficiaryTenantId: tenant.id,
    referralType: 'c_user',
    createdBy,
  });
  tenant.referralLink = referral.link;
  await saveChannelTenant(tenant);
  return tenant;
}

async function createInstitutionTenant(parentTenantId, input = {}, createdBy = 'system') {
  const parent = await getTenant(parentTenantId);
  if (!parent || ![TENANT_LEVEL.AGENT, TENANT_LEVEL.CHANNEL_PARTNER].includes(parent.level)) {
    throw new Error('only channel partner can create institution');
  }
  const id = String(input.id || `inst_${crypto.randomBytes(3).toString('hex')}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  const tenant = normalizeTenantForChannel({
    id,
    tenantType: TENANT_TYPES.INSTITUTION,
    level: TENANT_LEVEL.INSTITUTION,
    parentId: parentTenantId,
    canInvite: false,
    brandName: input.brandName || input.name || '合作机构',
    name: input.name || input.brandName || '合作机构',
    logo: input.logo || '',
    themeColor: input.themeColor || '#C2692A',
    referralCode: input.referralCode || `${id}_c`,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy,
  });
  await saveChannelTenant(tenant);
  const referral = await createReferral({
    code: tenant.referralCode,
    tenantId: tenant.id,
    beneficiaryTenantId: tenant.id,
    referralType: 'c_user',
    createdBy,
  });
  tenant.referralLink = referral.link;
  await saveChannelTenant(tenant);
  return tenant;
}

async function createSeat(input = {}) {
  if (!SEAT_TYPES.includes(input.seatType)) throw new Error('invalid seatType');
  const now = new Date().toISOString();
  const seat = {
    seatId: input.seatId || `seat_${crypto.randomBytes(5).toString('hex')}`,
    ownerTenantId: input.ownerTenantId,
    assignedOpenid: input.assignedOpenid || '',
    seatType: input.seatType,
    status: input.status || 'active',
    quotaLimit: input.quotaLimit || { chat: 0, report: 0 },
    expiresAt: input.expiresAt || null,
    createdAt: now,
  };
  if (!seat.ownerTenantId) throw new Error('ownerTenantId required');
  await redisSet(`seat:${seat.seatId}`, seat);
  const key = `seats:${seat.ownerTenantId}`;
  const list = await redisGet(key).catch(() => []) || [];
  const next = list.filter(id => id !== seat.seatId).concat(seat.seatId);
  await redisSet(key, next);
  return seat;
}

async function listSeats(ownerTenantId) {
  const ids = await redisGet(`seats:${ownerTenantId}`).catch(() => []) || [];
  const seats = [];
  for (const id of ids) {
    const seat = await redisGet(`seat:${id}`).catch(() => null);
    if (seat) seats.push(seat);
  }
  return seats;
}

function calcCommission(order, attribution, tenant) {
  if (!order || order.status !== 'mock_paid') return null;
  const now = new Date().toISOString();
  let beneficiaryTenantId = null;
  let rate = 0;
  let commissionType = '';
  if (order.productType === 'institution_first_year') {
    beneficiaryTenantId = tenant?.parentId || attribution?.beneficiaryTenantId;
    rate = 0.4;
    commissionType = 'institution_first_year';
  } else if (order.productType === 'institution_renewal') {
    beneficiaryTenantId = tenant?.parentId || attribution?.beneficiaryTenantId;
    rate = 0.3;
    commissionType = 'institution_renewal';
  } else {
    beneficiaryTenantId = attribution?.beneficiaryTenantId || order.payerTenantId;
    rate = 0.2;
    commissionType = 'c_user_direct';
  }
  if (!beneficiaryTenantId) return null;
  return {
    commissionId: `comm_${order.orderId}`,
    orderId: order.orderId,
    beneficiaryTenantId,
    commissionType,
    baseAmountFen: order.amountFen,
    rate,
    commissionAmountFen: Math.round(order.amountFen * rate),
    status: 'pending',
    createdAt: now,
  };
}

async function createMockOrder(input = {}) {
  const now = new Date().toISOString();
  const attribution = input.attributionId
    ? await redisGet(`attribution:user:${input.payerOpenid}`).catch(() => null)
    : await getAttribution(input.payerOpenid);
  const tenant = input.payerTenantId ? await getTenant(input.payerTenantId) : null;
  const order = {
    orderId: input.orderId || `mock_${crypto.randomBytes(5).toString('hex')}`,
    payerOpenid: input.payerOpenid,
    payerTenantId: input.payerTenantId || attribution?.beneficiaryTenantId || 'consumer',
    productType: input.productType || 'c_report',
    amountFen: Number(input.amountFen || 0),
    attributionId: attribution?.attributionId || input.attributionId || '',
    status: ORDER_STATUS.includes(input.status) ? input.status : 'mock_pending',
    createdAt: now,
  };
  await redisSet(`mock_order:${order.orderId}`, order);
  const orderIdxTenant = order.payerTenantId || 'consumer';
  const orderListKey = `mock_orders:${orderIdxTenant}`;
  const orderList = await redisGet(orderListKey).catch(() => []) || [];
  if (!orderList.includes(order.orderId)) {
    orderList.push(order.orderId);
    await redisSet(orderListKey, orderList);
  }
  let commission = null;
  if (order.status === 'mock_paid') {
    commission = calcCommission(order, attribution, tenant);
    if (commission) {
      await redisSet(`commission_record:${commission.commissionId}`, commission);
      const cKey = `commission_records:${commission.beneficiaryTenantId}`;
      const cList = await redisGet(cKey).catch(() => []) || [];
      if (!cList.includes(commission.commissionId)) {
        cList.push(commission.commissionId);
        await redisSet(cKey, cList);
      }
    }
  }
  return { order, commission };
}

async function listMockOrders(tenantId) {
  const ids = await redisGet(`mock_orders:${tenantId}`).catch(() => []) || [];
  const orders = [];
  for (const id of ids) {
    const order = await redisGet(`mock_order:${id}`).catch(() => null);
    if (order) orders.push(order);
  }
  return orders;
}

async function listCommissionRecords(tenantId) {
  const ids = await redisGet(`commission_records:${tenantId}`).catch(() => []) || [];
  const records = [];
  for (const id of ids) {
    const record = await redisGet(`commission_record:${id}`).catch(() => null);
    if (record) records.push(record);
  }
  return records;
}

async function canAccessTenant(ctx, tenantId) {
  if (!ctx || !ctx.openid) return false;
  if (ctx.role === ROLES.PLATFORM_ADMIN) return true;
  if (ctx.tenantId === tenantId) return true;
  if (isChannelRole(ctx.role)) {
    const target = await getTenant(tenantId);
    return !!target && target.parentId === ctx.tenantId;
  }
  return false;
}

async function canReadCustomerPrivateData(ctx, ownerOpenid, ownerTenantId) {
  if (!ctx || !ctx.openid) return { ok: false, status: 401 };
  if (ctx.role === ROLES.PLATFORM_ADMIN) return { ok: true };
  if (ctx.role === ROLES.CONSUMER) return { ok: ctx.openid === ownerOpenid, status: ctx.openid === ownerOpenid ? 200 : 403 };
  if (isInstitutionRole(ctx.role)) return { ok: ctx.tenantId === ownerTenantId, status: ctx.tenantId === ownerTenantId ? 200 : 403 };
  if (isChannelRole(ctx.role)) return { ok: false, status: 403 };
  return { ok: false, status: 403 };
}

// ─── 用户租户上下文 ───────────────────────────────────────────────────────────

/**
 * 从请求中提取当前用户的租户上下文。
 * TENANT_ENABLED=false 时直接返回 consumer 默认值，不读 Redis。
 * 返回：{ openid, role, tenantId, tenant } 或 null（未登录）
 */
async function getTenantContext(req) {
  if (!TENANT_ENABLED) {
    const token  = getSessionToken(req);
    const openid = token ? parseSessionToken(token) : null;
    return { openid, role: ROLES.CONSUMER, tenantId: 'consumer', tenant: null };
  }
  const token = getSessionToken(req);
  if (!token) return null;
  const openid = parseSessionToken(token);
  if (!openid) return null;
  const user = await redisGet(`user:${openid}`);
  if (!user) return null;
  const role     = user.role     || ROLES.CONSUMER;
  const tenantId = user.tenantId || 'consumer';
  const tenant   = await getTenant(tenantId);
  return { openid, role, tenantId, tenant };
}

/**
 * 角色校验：context 满足 allowedRoles 则返回 ctx，否则写 4xx 并返回 null。
 * 用法：const ctx = await requireRole(req, res, 'platform_admin', 'agent');
 *       if (!ctx) return;
 */
async function requireRole(req, res, ...allowedRoles) {
  const ctx = await getTenantContext(req);
  if (!ctx || !ctx.openid) {
    res.status(401).json({ error: '未登录' });
    return null;
  }
  if (!allowedRoles.includes(ctx.role)) {
    res.status(403).json({ error: '权限不足', required: allowedRoles, actual: ctx.role });
    return null;
  }
  return ctx;
}

/**
 * 首次登录时给老用户补充 role / tenantId（幂等，已设置则跳过）。
 * TENANT_ENABLED=false 时直接返回。
 * sourceTenantId：注册时记录的来源租户，M3 开启后作为用户归属依据。
 */
async function ensureUserTenant(openid) {
  if (!TENANT_ENABLED) return;
  const user = await redisGet(`user:${openid}`);
  if (!user) return;
  if (user.role && user.tenantId) return; // 已设置，跳过
  user.role     = PLATFORM_ADMIN_OPENIDS.includes(openid) ? ROLES.PLATFORM_ADMIN : ROLES.CONSUMER;
  // 优先用注册时记录的来源租户（M3 B端家长归属）；无则默认 consumer
  user.tenantId = user.sourceTenantId || 'consumer';
  await redisSet(`user:${openid}`, user);
}

/**
 * 获取租户品牌配置（logo / 名称 / 主色）。
 * M3 B端租户可在 tenant 记录中配置 brand 字段；现阶段只有 consumer = aipiwen 默认。
 * @param {string} tenantId
 * @returns {{ name: string, logoUrl: string, primaryColor: string, accentColor: string }}
 */
const CONSUMER_BRAND = {
  name:         '沐海星辰',
  logoUrl:      '/assets/logo.png',
  primaryColor: '#D97706', // amber-600
  accentColor:  '#FDE68A', // amber-200
};

async function getTenantBrand(tenantId) {
  if (!tenantId || tenantId === 'consumer') return CONSUMER_BRAND;
  try {
    const tenant = await getTenant(tenantId);
    if (!tenant?.brand) return CONSUMER_BRAND;
    return { ...CONSUMER_BRAND, ...tenant.brand }; // 未配置项 fallback 到 consumer 默认值
  } catch {
    return CONSUMER_BRAND;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 里程碑 2 — 软付费墙 / Quota 系统
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PAYMENT_ENABLED=false（默认）→ 所有 quota 检查通过，只记录用量，不拦截。
 * PAYMENT_ENABLED=true → 严格按 tier 限额执行。
 *
 * 套餐 tier: 'free' | 'lite' | 'pro'
 *
 * 每日限额（PAYMENT_ENABLED=true 时生效）：
 *   free:  chat=5,  report=1
 *   lite:  chat=999(无限), report=5
 *   pro:   chat=999, report=999
 *
 * 2h 恢复槽：免费用户当日 chat 耗尽后，每 2 小时补 2 次。
 * Redis keys：
 *   quota:daily:{type}:{openid}:{YYYYMMDD}     — 当日已用量
 *   quota:2h:{openid}:{slot}                  — 该 2h 槽已领取的恢复次数
 *   membership:{openid}                        — 用户套餐 { tier, expiresAt }
 */

const PAYMENT_ENABLED = process.env.PAYMENT_ENABLED === 'true';

// 每日限额配置（PAYMENT_ENABLED=true 时）
const QUOTA_LIMITS = {
  free: { chat: 5,   report: 1   },
  lite: { chat: 999, report: 5   },
  pro:  { chat: 999, report: 999 },
};

// 2h 恢复量（free 用户专属，每 2h 槽补充 chat 次数）
const RECOVER_CHAT_PER_SLOT = 2;

/** 获取当前日期字符串 YYYYMMDD（北京时间） */
function todayKey() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
}

/** 获取当前 2h 槽号（UTC时间每2小时一个槽）*/
function current2hSlot() {
  return Math.floor(Date.now() / (2 * 3600 * 1000));
}

// ── 独立防滥用限流（与 quota 完全隔离，只针对异常高频 / 机器人）─────────────────
// 正常真人用户几乎不会触发，触发返回 429 + retryAfter
const RATE_LIMIT_PER_MINUTE = {
  chat:    30,  // 1分钟内最多30次 chat（真人极限已够宽）
  report:  10,  // 1分钟内最多10次 report
  default: 60,
};

/**
 * 检查 IP 级别防滥用限流（独立于 quota，不影响正常用户）。
 * @param {string} ip
 * @param {'chat'|'report'|'default'} type
 * @returns {{ allowed: boolean, retryAfter?: number }}
 */
async function checkRateLimit(ip, type = 'default') {
  if (!ip) return { allowed: true };
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${type}:${ip}:${minute}`;
  try {
    const count = ((await redisGet(key)) || 0) + 1;
    const limit = RATE_LIMIT_PER_MINUTE[type] ?? RATE_LIMIT_PER_MINUTE.default;
    if (count > limit) return { allowed: false, retryAfter: 60 };
    await redisSet(key, count, 120); // 2分钟 TTL，自动清理
    return { allowed: true };
  } catch {
    return { allowed: true }; // Redis 异常不影响业务
  }
}

// ── 升级钩子：触顶埋点 + 高意向信号 ────────────────────────────────────────────
/**
 * 每次触顶时调用，记录日触顶次数并写高意向信号（>=2次即标记）。
 * @param {string} openid
 * @param {'chat'|'report'} type
 * @returns {{ hitCount: number, isHighIntent: boolean }}
 */
async function trackQuotaHit(openid, type) {
  if (!openid) return { hitCount: 1, isHighIntent: false };
  try {
    const hitKey = `quota_hits:${openid}:${todayKey()}`;
    const count = ((await redisGet(hitKey)) || 0) + 1;
    await redisSet(hitKey, count, 2 * 86400);

    const isHighIntent = count >= 2;
    if (isHighIntent) {
      const intentKey = `intent:high:${openid}`;
      const existing = (await redisGet(intentKey)) || {};
      await redisSet(intentKey, {
        firstSeenAt:   existing.firstSeenAt || new Date().toISOString(),
        lastHitAt:     new Date().toISOString(),
        totalHitCount: (existing.totalHitCount || 0) + 1,
        lastType:      type,
      }, 90 * 86400); // 保留90天供运营分析
    }
    return { hitCount: count, isHighIntent };
  } catch {
    return { hitCount: 1, isHighIntent: false };
  }
}

/**
 * 按触顶次数返回差异化的升级引导文案（温暖，不施压）。
 * PAYMENT_ENABLED=false 时：钩子文案仍展示，CTA 收集意向，不强推付款。
 */
function buildUpgradeMessage(type, hitCount) {
  if (type === 'report') {
    if (hitCount >= 3) {
      return '你已经多次想出深度报告了 💛 看来对孩子的了解你一直在认真追。升级会员后每天可出更多份，随时查看完整天赋图谱。';
    } else if (hitCount >= 2) {
      return '今日深度报告次数用完了，但你还想要更多——这说明报告对你有用！轻会员 ¥99/年，每年 5 份深度报告随时出，感兴趣可以提前登记早鸟意向。';
    }
    return `今日深度报告额度已用完（免费 1 次）。请明日再试，或登记早鸟意向，付费开放后第一时间通知你。`;
  }
  // chat
  if (hitCount >= 3) {
    return '你今天已经多次触到对话上限了 🌟 说明你很依赖这个工具——真的很好！升级轻会员（¥99/年）可以无限对话，2h 刷新也不用等了。';
  } else if (hitCount >= 2) {
    return '今日对话次数又用完了，你用得很频繁 💛 说明沐海星辰对你是真有帮助。现阶段付费还未开放，可以先登记早鸟意向，我们优先通知你。';
  }
  return `今日行为解读额度已用完（免费 5 次）。2小时后刷新 ${RECOVER_CHAT_PER_SLOT} 次，或登记早鸟意向以便付费开放时第一时间升级。`;
}

/** 读取用户套餐；未设置则返回 free */
async function getUserTier(openid) {
  if (!openid) return 'free';
  const m = await redisGet(`membership:${openid}`);
  if (!m || !m.tier) return 'free';
  if (m.expiresAt && new Date(m.expiresAt) < new Date()) return 'free'; // 过期降级
  return m.tier;
}

/**
 * 检查并消费一次配额。
 * @param {string} openid
 * @param {'chat'|'report'} type
 * @returns {{ allowed: boolean, remaining: number, reason?: string, recover2hAt?: number }}
 */
async function checkAndConsumeQuota(openid, type) {
  // PAYMENT_ENABLED=false → 全部放行，只记录用量（不拦截，但埋点高意向）
  if (!PAYMENT_ENABLED) {
    const dayKey = `quota:daily:${type}:${openid}:${todayKey()}`;
    const used = (await redisGet(dayKey).catch(() => 0)) || 0;
    await redisSet(dayKey, used + 1, 2 * 86400).catch(() => {});
    // 免费阶段：高频用户埋点（超过免费限额后仍继续用 = 高意向信号）
    if (openid) {
      const freeLimit = (QUOTA_LIMITS.free)[type] || 0;
      if (used >= freeLimit) {
        trackQuotaHit(openid, type).catch(() => {}); // 异步，不阻塞
      }
    }
    return { allowed: true, remaining: 999 };
  }

  const tier = await getUserTier(openid);
  const limit = (QUOTA_LIMITS[tier] || QUOTA_LIMITS.free)[type] || 0;

  // 无限额度直接放行
  if (limit >= 999) {
    return { allowed: true, remaining: 999 };
  }

  const dayKey = `quota:daily:${type}:${openid}:${todayKey()}`;
  const used = (await redisGet(dayKey).catch(() => 0)) || 0;

  // 2h 恢复槽（仅 free + chat）
  let bonus = 0;
  if (tier === 'free' && type === 'chat' && used >= limit) {
    const slot = current2hSlot();
    const slotKey = `quota:2h:${openid}:${slot}`;
    const slotUsed = (await redisGet(slotKey).catch(() => 0)) || 0;
    bonus = Math.max(0, RECOVER_CHAT_PER_SLOT - slotUsed);
    if (bonus > 0) {
      await redisSet(slotKey, slotUsed + 1, 4 * 3600).catch(() => {});
    }
  }

  const effective = used - bonus;
  if (effective >= limit) {
    const nextSlot = current2hSlot() + 1;
    const nextSlotMs = nextSlot * 2 * 3600 * 1000;
    // 触顶埋点：记日触顶次数 + 写高意向信号（异步，不阻塞返回）
    const { hitCount } = await trackQuotaHit(openid, type);
    return {
      allowed: false,
      remaining: 0,
      reason: buildUpgradeMessage(type, hitCount),
      recover2hAt: nextSlotMs,
      upgradeUrl: '/membership',
    };
  }

  // 消费
  await redisSet(dayKey, used + 1, 2 * 86400).catch(() => {});
  return { allowed: true, remaining: limit - used - 1 };
}

/**
 * 返回用户当日 quota 摘要（用于 membership 页显示）。
 */
async function getQuotaStatus(openid) {
  const tier = await getUserTier(openid);
  const limits = QUOTA_LIMITS[tier] || QUOTA_LIMITS.free;
  const today = todayKey();

  const [chatUsed, reportUsed] = await Promise.all([
    redisGet(`quota:daily:chat:${openid}:${today}`).catch(() => 0),
    redisGet(`quota:daily:report:${openid}:${today}`).catch(() => 0),
  ]);

  const chatRemain   = Math.max(0, limits.chat   - (chatUsed   || 0));
  const reportRemain = Math.max(0, limits.report - (reportUsed || 0));

  return {
    tier,
    paymentEnabled: PAYMENT_ENABLED,
    quota: {
      chatRemain:   PAYMENT_ENABLED ? chatRemain   : 999,
      reportRemain: PAYMENT_ENABLED ? reportRemain : 999,
      chatLimit:    limits.chat,
      reportLimit:  limits.report,
    },
  };
}

module.exports = {
  redisSet, redisGet,
  makeSessionToken, parseSessionToken, getSessionToken, getOpenid,
  generatePortrait, portraitNeedsRefresh, getGlobalPatterns, registerUser,
  archiveRecordsIfNeeded, MAX_RECORDS,
  searchKnowledge,
  createInviteToken, creditReferral,
  // Claude API (DashScope)
  callClaude, MODEL_FREE, MODEL_DEEP, trackApiSpend,
  // 里程碑 1：多租户
  TENANT_ENABLED, TENANT_LEVEL, ROLES, TENANT_TYPES,
  SEAT_TYPES, ORDER_STATUS, COMMISSION_STATUS,
  isChannelRole, isInstitutionRole,
  getTenant, saveTenant, saveChannelTenant, listSubTenants, getTenantTreeIds,
  buildReferralLink, createReferral, getReferral,
  getAttribution, applyReferralAttribution, correctAttribution,
  initXinyuTenant, createInstitutionTenant,
  createSeat, listSeats, createMockOrder, listMockOrders, listCommissionRecords,
  canAccessTenant, canReadCustomerPrivateData,
  getTenantContext, requireRole, ensureUserTenant, getTenantBrand,
  // 里程碑 2：软付费墙 + 升级钩子 + 防滥用
  PAYMENT_ENABLED, checkAndConsumeQuota, getQuotaStatus, getUserTier,
  checkRateLimit, trackQuotaHit, buildUpgradeMessage,
};
