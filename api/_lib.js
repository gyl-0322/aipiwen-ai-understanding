/**
 * AIPIWEN 公共工具库
 * 供 auth.js / children.js 等 API 文件引用
 * 不直接对外暴露路由
 */

const crypto = require('crypto');

const SESSION_KEY = process.env.SESSION_SECRET || 'aipiwen-session-secret';

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

// ─── 用户索引（注册/追加） ────────────────────────────────────────────────────
// 用于 digest.js 遍历所有用户
async function registerUser(openid) {
  const list = await redisGet('users:all') || [];
  if (!list.includes(openid)) {
    list.push(openid);
    await redisSet('users:all', list);
  }
}

module.exports = {
  redisSet, redisGet,
  makeSessionToken, parseSessionToken, getSessionToken, getOpenid,
  generatePortrait, portraitNeedsRefresh, getGlobalPatterns, registerUser,
};
