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

    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'qwen-turbo', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    });

    const aiData  = await aiRes.json();
    const summary = aiData.choices?.[0]?.message?.content;
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
  chat:   { bonusKey: (ip) => `quota:bonus:chat:${ip}`,   amount: 3 },
  report: { bonusKey: (ip) => `quota:bonus:report:${ip}`, amount: 1 },
};

// 创建邀请 token（10位hex，TTL 30天）
async function createInviteToken(ip) {
  const token = crypto.randomBytes(5).toString('hex'); // 10 chars
  await redisSet(`invite:${token}`, { ip, created: Date.now() }, 30 * 86400);
  return token;
}

// 给邀请人积分
// callerIp = 被邀请人IP，token = 邀请 token，event = 'chat' | 'report'
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

    const { bonusKey, amount } = REFERRAL_REWARDS[event];
    const bk  = bonusKey(invite.ip);
    const cur = (await redisGet(bk)) || 0;
    await Promise.all([
      redisSet(bk, cur + amount, 30 * 86400), // 奖励 30 天有效
      redisSet(usedKey, 1, 30 * 86400),        // 防重复积分
    ]);
    return true;
  } catch { return false; }
}

module.exports = {
  redisSet, redisGet,
  makeSessionToken, parseSessionToken, getSessionToken, getOpenid,
  generatePortrait, portraitNeedsRefresh, getGlobalPatterns, registerUser,
  archiveRecordsIfNeeded, MAX_RECORDS,
  searchKnowledge,
  createInviteToken, creditReferral,
};
