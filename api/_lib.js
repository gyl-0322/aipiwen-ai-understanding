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
const TENANT_LEVEL = { CONSUMER: 0, AGENT: 1, SCHOOL: 2 };

// ─── 角色常量 ─────────────────────────────────────────────────────────────────
const ROLES = {
  PLATFORM_ADMIN : 'platform_admin', // 平台超管
  AGENT          : 'agent',          // 代理（L1）
  SCHOOL         : 'school',         // 幼儿园（L2）
  CONSULTANT     : 'consultant',     // 顾问
  CONSUMER       : 'consumer',       // C 端用户（默认）
};

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
 */
async function ensureUserTenant(openid) {
  if (!TENANT_ENABLED) return;
  const user = await redisGet(`user:${openid}`);
  if (!user) return;
  if (user.role && user.tenantId) return; // 已设置，跳过
  user.role     = PLATFORM_ADMIN_OPENIDS.includes(openid) ? ROLES.PLATFORM_ADMIN : ROLES.CONSUMER;
  user.tenantId = 'consumer';
  await redisSet(`user:${openid}`, user);
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
  // PAYMENT_ENABLED=false → 全部放行，只记录
  if (!PAYMENT_ENABLED) {
    const dayKey = `quota:daily:${type}:${openid}:${todayKey()}`;
    const used = (await redisGet(dayKey).catch(() => 0)) || 0;
    await redisSet(dayKey, used + 1, 2 * 86400).catch(() => {});
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
    return {
      allowed: false,
      remaining: 0,
      reason: type === 'chat'
        ? `今日行为解读额度已用完（${limit}次）。2小时后刷新 ${RECOVER_CHAT_PER_SLOT} 次，或升级会员继续使用。`
        : `今日深度报告额度已用完（${limit}次）。请明日再试，或升级会员获得更多次数。`,
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
  TENANT_ENABLED, TENANT_LEVEL, ROLES,
  getTenant, saveTenant, listSubTenants,
  getTenantContext, requireRole, ensureUserTenant,
  // 里程碑 2：软付费墙
  PAYMENT_ENABLED, checkAndConsumeQuota, getQuotaStatus, getUserTier,
};
