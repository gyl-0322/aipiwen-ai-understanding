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
//  Claude API 共享封装（§15 模型选型规范）
// ═══════════════════════════════════════════════════════════════════════════

// ★ 模型常量 — C 端任何路径禁止使用 Opus
const MODEL_FREE = 'claude-haiku-4-5-20251001'; // 免费/轻解读/对话  $1/$5 per M tokens
const MODEL_DEEP = 'claude-sonnet-4-6';          // 付费/深度报告      $3/$15 per M tokens

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

/**
 * 统一 Claude API 调用入口
 * @param {object} opts
 * @param {string}   opts.model      MODEL_FREE | MODEL_DEEP
 * @param {string}   opts.system     系统提示（纯字符串；如需 caching 会自动包装）
 * @param {Array}    opts.messages   消息数组 [{role:'user'|'assistant', content}]
 *                                   role:'system' 的消息会被自动提取到 system 字段
 * @param {number}   opts.maxTokens  最大输出 token（默认 600）
 * @param {boolean}  opts.cache      是否对 system 开启 prompt caching（默认 false）
 * @param {number}   opts.timeoutMs  超时毫秒（默认 25000）
 * @returns {Promise<{text:string, usage:object}>}
 */
async function callClaude({ model, system, messages, maxTokens = 600, cache = false, timeoutMs = 25000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  // 从 messages 里提取 role:system（兼容 OpenAI 格式传入的 messages）
  const sysMsg = messages.find(m => m.role === 'system');
  const systemText = system || sysMsg?.content || '';
  const filteredMsgs = messages.filter(m => m.role !== 'system');

  // 将 OpenAI image_url 格式转为 Claude source 格式
  const claudeMsgs = filteredMsgs.map(m => {
    if (!Array.isArray(m.content)) return m;
    const parts = m.content.map(p => {
      if (p.type === 'image_url' && p.image_url?.url) {
        const match = p.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
      }
      return p;
    });
    return { ...m, content: parts };
  });

  const body = { model, max_tokens: maxTokens, messages: claudeMsgs };

  if (systemText) {
    body.system = cache
      ? [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
      : systemText;
  }

  const headers = {
    'x-api-key':         apiKey,
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
    ...(cache ? { 'anthropic-beta': 'prompt-caching-2024-07-31' } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(CLAUDE_API, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      const err = Object.assign(new Error(`Claude ${res.status}`), { status: res.status, body: rawText.slice(0, 300) });
      console.error('[Claude]', err.message, err.body);
      throw err;
    }
    const data = JSON.parse(rawText);
    const text = data.content?.[0]?.text?.trim() || null;
    trackApiSpend(model, data.usage?.input_tokens || 0, data.usage?.output_tokens || 0).catch(() => {});
    return { text, usage: data.usage || {} };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ─── 每日 API Spend 追踪 + WeCom 告警 ────────────────────────────────────────
const _PRICING = {
  [MODEL_FREE]: { in: 1 / 1e6, out: 5 / 1e6  },
  [MODEL_DEEP]: { in: 3 / 1e6, out: 15 / 1e6 },
};
const _USD_TO_CNY = 7.2;

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

module.exports = {
  redisSet, redisGet,
  makeSessionToken, parseSessionToken, getSessionToken, getOpenid,
  generatePortrait, portraitNeedsRefresh, getGlobalPatterns, registerUser,
  archiveRecordsIfNeeded, MAX_RECORDS,
  searchKnowledge,
  createInviteToken, creditReferral,
  // Claude API
  callClaude, MODEL_FREE, MODEL_DEEP, trackApiSpend,
};
