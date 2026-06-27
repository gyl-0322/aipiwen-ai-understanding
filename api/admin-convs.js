/**
 * AIPIWEN 对话日志管理 + 事件统计埋点（merged stats.js）+ 前端错误日志（merged error-log.js）
 *                     + 增长追踪（merged track.js）+ 知识库管理（merged knowledge.js）
 * GET /api/admin-convs?secret=xxx                → 会话列表（最新500条）
 * GET /api/admin-convs?secret=xxx&sid=xxx        → 某次会话的完整对话
 * GET /api/admin-convs?secret=xxx&action=export  → 导出全部会话 JSON（最新300条含消息）
 * GET /api/admin-convs?secret=xxx&action=errors  → 查看最近错误日志
 * GET /api/admin-convs?secret=xxx&action=kf_who  → 查企业微信客服发信人 external_userid
 * GET /api/admin-convs?secret=xxx&action=cases[&n=50&offset=0&type=认知型&age=15&export=1] → 案例库列表
 * GET /api/admin-convs?secret=xxx&action=cases_detail&id=xxx → 某条完整报告
 * POST /api/stats  { event, meta? }              → 埋点（公开）
 * GET  /api/stats?admin=1&secret=xxx             → 查看统计数据（管理端）
 * POST /api/error-log  { msg, stack, page... }   → 前端上报错误（无需登录）
 * GET  /api/error-log?secret=xxx                 → 查看错误日志（同 action=errors）
 * GET/POST /api/track  { event, meta, ... }      → 增长埋点（merged from track.js）
 * GET  /api/growth                               → 增长数据汇总（merged from track.js）
 * GET/POST /api/knowledge?action=search|load|list|delete → 知识库管理（merged from knowledge.js）
 *
 * 需要在 Vercel 环境变量中设置 ADMIN_SECRET
 */

const crypto = require('crypto');
const { redisGet, redisSet } = require('./_lib');

// ── 错误日志 Redis 工具（list 操作，直接调 Upstash HTTP）───────────────────────
const kvUrl   = () => process.env.KV_REST_API_URL   || process.env.REDIS_URL  || '';
const kvToken = () => process.env.KV_REST_API_TOKEN || '';

async function pushError(entry) {
  await fetch(`${kvUrl()}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['LPUSH', 'errors:log', JSON.stringify(entry)],
      ['LTRIM', 'errors:log', 0, 199],
    ]),
  });
}

async function getErrors(n = 50) {
  const res  = await fetch(`${kvUrl()}/lrange/errors:log/0/${n - 1}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
  });
  const data = await res.json();
  return (data.result || []).map(s => { try { return JSON.parse(s); } catch { return s; } });
}

async function checkAndMarkDup(hash) {
  const key = `errors:dedup:${hash}`;
  const res = await fetch(`${kvUrl()}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['GET', key],
      ['SET', key, '1', 'EX', 300],
    ]),
  });
  const data = await res.json();
  return !!(data.result?.[0]?.result);
}

async function getWxToken() {
  const corpId = process.env.WECHAT_CORP_ID     || '';
  const secret = process.env.WECHAT_AGENT_SECRET || '';
  if (!corpId || !secret) return null;
  const res  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
  const data = await res.json();
  return data.access_token || null;
}

async function sendAlert(entry) {
  const webhook = process.env.ALERT_WEBHOOK || '';
  if (!webhook) return;   // 未配置就跳过，不影响主流程
  const timeStr = new Date(entry.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const lines = [`🔴 用户出错了`, `时间：${timeStr}`, `页面：${entry.page || '-'}`, `错误：${entry.msg}`];
  if (entry.context) lines.push(`场景：${entry.context.slice(0, 200)}`);
  if (entry.stack)   lines.push(`堆栈：${entry.stack.slice(0, 300)}`);
  await fetch(webhook, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: lines.join('\n') } }),
  }).catch(() => {});
}

async function handleErrorLog(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      let parsed = req.body;
      if (!parsed || typeof parsed === 'string') {
        let raw = '';
        await new Promise(r => { req.on('data', c => (raw += c)); req.on('end', r); });
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      }
      const { msg, stack, page, context, ua } = parsed || {};
      if (!msg) return res.status(400).json({ ok: false, error: 'msg required' });
      const entry = {
        ts: Date.now(), msg: String(msg).slice(0, 500),
        stack:   stack   ? String(stack).slice(0, 800)   : undefined,
        page:    page    ? String(page).slice(0, 200)    : undefined,
        context: context ? String(context).slice(0, 300) : undefined,
        ua:      ua      ? String(ua).slice(0, 200)      : undefined,
      };
      const hash = crypto.createHash('md5').update((entry.msg || '') + (entry.page || '')).digest('hex').slice(0, 8);
      const [, isDup] = await Promise.all([pushError({ ...entry, hash }), checkAndMarkDup(hash)]);
      if (!isDup) await sendAlert(entry);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false });
    }
  }

  if (req.method === 'GET') {
    const adminSecret = process.env.ADMIN_SECRET || 'coco1013';
    const token = req.headers['x-admin-secret'] || req.query.secret;
    if (token !== adminSecret) return res.status(401).json({ error: '未授权，请携带 secret 参数' });
    try {
      const n      = Math.min(parseInt(req.query.n || '50', 10), 200);
      const errors = await getErrors(n);
      return res.status(200).json({ ok: true, count: errors.length, errors });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).end();
}

// ── stats 处理器（merged from stats.js）──────────────────────────────────────
function statsToday() {
  return new Date().toISOString().slice(0, 10);
}

async function handleStats(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'POST') {
    let body = '';
    await new Promise(resolve => { req.on('data', c => (body += c)); req.on('end', resolve); });
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    const { event } = payload;
    if (!event?.trim()) return res.status(400).json({ error: 'event 必填' });
    const date     = statsToday();
    const dailyKey = `stats:daily:${event}:${date}`;
    const totalKey = `stats:total:${event}`;
    const [daily, total, events] = await Promise.all([
      redisGet(dailyKey).then(v => (v || 0) + 1),
      redisGet(totalKey).then(v => (v || 0) + 1),
      redisGet('stats:events').then(v => v || []),
    ]);
    const updatedEvents = events.includes(event) ? events : [...events, event];
    await Promise.all([
      redisSet(dailyKey, daily, 90 * 86400),
      redisSet(totalKey, total),
      redisSet('stats:events', updatedEvents),
    ]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    const adminSecret = process.env.ADMIN_SECRET;
    const provided    = req.query?.secret || req.headers['x-admin-secret'] || '';
    if (!adminSecret) return res.status(500).json({ error: '管理密钥未配置' });
    if (provided !== adminSecret) return res.status(401).json({ error: '未授权' });
    const events = await redisGet('stats:events') || [];
    const dates  = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - i * 86400000);
      return d.toISOString().slice(0, 10);
    }).reverse();
    const result = {};
    for (const event of events) {
      const total = await redisGet(`stats:total:${event}`) || 0;
      const daily = {};
      for (const date of dates) { daily[date] = (await redisGet(`stats:daily:${event}:${date}`)) || 0; }
      result[event] = { total, daily };
    }
    return res.status(200).json({ generatedAt: new Date().toISOString(), dates, events: result });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

const CONTEXT_LABELS = {
  child:       '亲子行为',
  self:        '自我解读',
  partner:     '伴侣解读',
  business:    '合伙解读',
  fingerprint: '皮纹速测',
  report:      '报告解读',
};

// ── 增长追踪处理器（merged from track.js）────────────────────────────────────
const MAX_TRACK_EVENTS = 2000;
function trackKvBase()  { return process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL   || null; }
function trackKvToken() { return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null; }

async function trackKvCmd(cmd, ...args) {
  const base = trackKvBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${trackKvToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([cmd, ...args]),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.result ?? null;
  } catch (e) { console.error('[KV track]', cmd, e.message); return null; }
}

async function trackKvPipeline(commands) {
  const base = trackKvBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${trackKvToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) console.error(`[KV track] pipeline HTTP ${res.status}`);
    return res.ok ? res.json() : null;
  } catch (e) { console.error('[KV track] pipeline error:', e.message); return null; }
}

function trackFlatToObj(arr) {
  if (!Array.isArray(arr)) return {};
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) obj[arr[i]] = Number(arr[i + 1]) || 0;
  return obj;
}

async function handleTrack(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const urlPath = req.url ? req.url.split('?')[0] : '';

  if (req.method === 'GET') {
    if (urlPath === '/api/growth') {
      const kvConnected = !!trackKvBase();
      if (!kvConnected) return res.status(200).json({ kvConnected: false, funnel: {}, typePerf: {}, attribution: {}, eventCount: 0 });
      const [funnelRaw, attrRaw, typesRaw, eventCount] = await Promise.all([
        trackKvCmd('HGETALL', 'gt:funnel'),
        trackKvCmd('HGETALL', 'gt:attr'),
        trackKvCmd('SMEMBERS', 'gt:types'),
        trackKvCmd('LLEN', 'gt:events'),
      ]);
      const funnel      = trackFlatToObj(funnelRaw);
      const attribution = trackFlatToObj(attrRaw);
      const typeKeys    = Array.isArray(typesRaw) ? typesRaw : [];
      let typePerf = {};
      if (typeKeys.length > 0) {
        const cmds    = typeKeys.map(k => ['HGETALL', `gt:type:${k}`]);
        const results = await trackKvPipeline(cmds);
        if (Array.isArray(results)) {
          results.forEach((item, i) => { typePerf[typeKeys[i]] = trackFlatToObj(item.result); });
        }
      }
      return res.status(200).json({ kvConnected: true, funnel, typePerf, attribution, eventCount: Number(eventCount) || 0 });
    }
    // /api/track GET — 首页访问计数
    const data  = await trackKvPipeline([['HGET', 'gt:funnel', 'homepage_visit']]);
    const count = parseInt((data && data[0] && data[0].result) || 0, 10) || 0;
    return res.status(200).json({ ok: true, count });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let payload;
  try { payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { event, meta = {}, session, type, ts, utm = {} } = payload || {};
  if (!event || typeof event !== 'string') return res.status(400).json({ error: 'Missing event' });

  const src   = (utm && utm.source) || 'direct';
  const entry = JSON.stringify({ event, meta, session, type, ts: ts || Date.now(), utm, received: Date.now() });

  const pipeline = [
    ['HINCRBY', 'gt:funnel', event, 1],
    ['HINCRBY', 'gt:attr',   src,   1],
    ['LPUSH',   'gt:events', entry],
    ['LTRIM',   'gt:events', 0, MAX_TRACK_EVENTS - 1],
  ];
  if (type) {
    const typeKey = `gt:type:${type}`;
    pipeline.push(['SADD', 'gt:types', type]);
    if (event === 'result_view')   pipeline.push(['HINCRBY', typeKey, 'views',  1]);
    if (event === 'poster_share')  pipeline.push(['HINCRBY', typeKey, 'shares', 1]);
    if (event === 'wecom_click')   pipeline.push(['HINCRBY', typeKey, 'wecom',  1]);
    if (event === 'lead_captured') pipeline.push(['HINCRBY', typeKey, 'leads',  1]);
  }
  await trackKvPipeline(pipeline);
  return res.status(200).json({ ok: true });
}

// ── 知识库管理处理器（merged from knowledge.js）──────────────────────────────
function knowledgeExtractWords(text) {
  const words = new Set();
  (text.match(/[一-龥]{2,4}/g) || []).forEach(w => words.add(w));
  (text.toLowerCase().match(/[a-z]{3,}/g) || []).forEach(w => words.add(w));
  return [...words];
}

function knowledgeIsAdmin(req) {
  const s = process.env.ADMIN_SECRET;
  if (!s) return false;
  return req.query.secret === s || req.headers['x-admin-secret'] === s;
}

async function handleKnowledge(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action } = req.query;

  if (action === 'search') {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q 参数必填' });
    const queryWords = knowledgeExtractWords(q);
    if (queryWords.length === 0) return res.status(200).json({ chunks: [] });
    const candidateScores = {};
    for (const word of queryWords.slice(0, 20)) {
      const ids = await redisGet(`knowledge:index:${word}`) || [];
      ids.forEach(id => { candidateScores[id] = (candidateScores[id] || 0) + 1; });
    }
    if (Object.keys(candidateScores).length === 0) return res.status(200).json({ chunks: [] });
    const topIds = Object.entries(candidateScores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
    const chunks = await redisGet('knowledge:chunks') || [];
    const results = topIds.map(id => chunks.find(c => c.id === id)).filter(Boolean);
    return res.status(200).json({ chunks: results, query: q });
  }

  if (action === 'load' && req.method === 'POST') {
    if (!knowledgeIsAdmin(req)) return res.status(401).json({ error: '未授权' });
    let b = '';
    const body = await new Promise(resolve => { req.on('data', c => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } }); });
    const incoming = body.chunks || [];
    if (!Array.isArray(incoming) || incoming.length === 0) return res.status(400).json({ error: 'chunks 数组不能为空' });
    const existing = await redisGet('knowledge:chunks') || [];
    let added = 0;
    for (const item of incoming) {
      if (!item.text?.trim()) continue;
      const chunk = { id: crypto.randomBytes(6).toString('hex'), source: item.source || '未知来源', tags: Array.isArray(item.tags) ? item.tags : [], text: item.text.trim(), createdAt: new Date().toISOString() };
      existing.push(chunk);
      const words = knowledgeExtractWords(chunk.text + ' ' + chunk.tags.join(' '));
      for (const word of words) {
        const ids = await redisGet(`knowledge:index:${word}`) || [];
        if (!ids.includes(chunk.id)) { ids.push(chunk.id); await redisSet(`knowledge:index:${word}`, ids); }
      }
      added++;
    }
    await redisSet('knowledge:chunks', existing);
    return res.status(200).json({ ok: true, added, total: existing.length });
  }

  if (action === 'list') {
    if (!knowledgeIsAdmin(req)) return res.status(401).json({ error: '未授权' });
    const chunks = await redisGet('knowledge:chunks') || [];
    const overview = chunks.map(c => ({ id: c.id, source: c.source, tags: c.tags, textLen: c.text?.length || 0, preview: c.text?.slice(0, 60) + '…', createdAt: c.createdAt }));
    return res.status(200).json({ total: chunks.length, chunks: overview });
  }

  if (action === 'delete' && req.method === 'POST') {
    if (!knowledgeIsAdmin(req)) return res.status(401).json({ error: '未授权' });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 必填' });
    const chunks = await redisGet('knowledge:chunks') || [];
    await redisSet('knowledge:chunks', chunks.filter(c => c.id !== id));
    return res.status(200).json({ ok: true, remaining: chunks.length - 1 });
  }

  return res.status(400).json({ error: '无效的 action' });
}

module.exports = async function handler(req, res) {
  // 路由分发
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/stats')      return handleStats(req, res);
  if (urlPath === '/api/error-log')  return handleErrorLog(req, res);
  if (urlPath === '/api/track')      return handleTrack(req, res);
  if (urlPath === '/api/growth')     return handleTrack(req, res);
  if (urlPath === '/api/knowledge')  return handleKnowledge(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 鉴权
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: '管理密钥未配置，请在 Vercel 环境变量中设置 ADMIN_SECRET' });
  }
  const provided = req.query.secret || req.headers['x-admin-secret'] || '';
  if (provided !== adminSecret) {
    return res.status(401).json({ error: '未授权' });
  }

  const { sid, action, ip: targetIp, bonus, token: vipToken, label: vipLabel } = req.query;

  // ── VIP token 管理 ──────────────────────────────────────────────────────────
  // GET /api/admin-convs?secret=xxx&action=vip_list         → 列出所有VIP token
  // GET /api/admin-convs?secret=xxx&action=vip_create&label=姓名 → 创建新VIP token
  // GET /api/admin-convs?secret=xxx&action=vip_delete&token=xxx → 删除VIP token
  if (action === 'vip_list') {
    const list = await redisGet('vip:token:index').catch(() => []) || [];
    return res.status(200).json({ ok: true, vips: list });
  }
  if (action === 'vip_create') {
    const newToken = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    const entry = { token: newToken, label: vipLabel || '内部用户', createdAt: new Date().toISOString() };
    await redisSet(`vip:token:${newToken}`, entry, 0); // 永不过期（TTL=0不支持，用很大值）
    await redisSet(`vip:token:${newToken}`, entry, 365 * 24 * 3600 * 10); // 10年
    const list = await redisGet('vip:token:index').catch(() => []) || [];
    list.push(entry);
    await redisSet('vip:token:index', list, 365 * 24 * 3600 * 10);
    return res.status(200).json({ ok: true, token: newToken, label: entry.label });
  }
  if (action === 'vip_delete') {
    if (!vipToken) return res.status(400).json({ error: '缺少token参数' });
    await redisSet(`vip:token:${vipToken}`, null, 1).catch(() => {}); // 1秒后过期=删除
    const list = await redisGet('vip:token:index').catch(() => []) || [];
    const newList = list.filter(e => e.token !== vipToken);
    await redisSet('vip:token:index', newList, 365 * 24 * 3600 * 10);
    return res.status(200).json({ ok: true, deleted: vipToken });
  }

  // ── 手动加次数（给指定 IP 增加 bonus 配额）──────────────────────────────────
  // GET /api/admin-convs?secret=xxx&action=add_quota&ip=1.2.3.4&bonus=20
  if (action === 'add_quota') {
    if (!targetIp) return res.status(400).json({ error: '缺少ip参数' });
    const addCount = parseInt(bonus || '10', 10);
    const bonusKey = `quota:bonus:chat:${targetIp}`;
    const existing = await redisGet(bonusKey).catch(() => 0) || 0;
    await redisSet(bonusKey, existing + addCount, 365 * 24 * 3600);
    return res.status(200).json({ ok: true, ip: targetIp, totalBonus: existing + addCount });
  }

  // ── 查看最近 AI 报错（generate-report / guest-chat）────────────────────────
  // GET /api/admin-convs?secret=xxx&action=last_err
  if (action === 'last_err') {
    const [genErr, chatErr] = await Promise.all([
      redisGet('lastErr:genrpt').catch(() => null),
      redisGet('lastErr:chat').catch(() => null),
    ]);
    return res.status(200).json({ ok: true, generate_report: genErr, guest_chat: chatErr });
  }

  // ── 单次会话完整对话 ────────────────────────────────────────────────────────
  if (sid) {
    const msgs = await redisGet(`convlog:msgs:${sid}`) || [];
    return res.status(200).json({ sid, msgs });
  }

  // ── 查询企业微信客服最近消息的 external_userid（用于找 ALERT_OPENID）──────────
  if (action === 'kf_who') {
    const corpId = process.env.WECHAT_CORP_ID     || '';
    const secret = process.env.WECHAT_AGENT_SECRET || '';
    const kfid   = process.env.WECHAT_OPEN_KFID   || '';
    if (!corpId || !secret || !kfid) {
      return res.status(200).json({ ok: false, error: '企业微信环境变量未配置' });
    }
    try {
      // 获取 access_token
      const tkRes  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
      const tkData = await tkRes.json();
      const token  = tkData.access_token;
      if (!token) return res.status(200).json({ ok: false, error: '获取微信token失败', detail: tkData });

      // 拉取最新客服消息（不带cursor，从头拉）
      const msgRes  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open_kfid: kfid, limit: 50 }),
      });
      const msgData = await msgRes.json();
      const msgs    = msgData.msg_list || [];

      // 提取最近发过消息的 external_userid 和时间
      const seen = {};
      for (const m of msgs) {
        if (m.origin === 3 && m.external_userid && !seen[m.external_userid]) {
          seen[m.external_userid] = new Date(m.send_time * 1000)
            .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        }
      }
      const senders = Object.entries(seen).map(([uid, time]) => ({ external_userid: uid, last_msg_time: time }));
      return res.status(200).json({ ok: true, tip: '把你刚发的那条消息对应的 external_userid 填到 ALERT_OPENID', senders, raw_count: msgs.length });
    } catch(e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // ── 案例库（皮纹报告上传记录）──────────────────────────────────────────────
  // GET /api/admin-convs?secret=xxx&action=cases           → 案例摘要列表
  //     ?n=50 &offset=0 &type=认知型 &age=15 &export=1
  // GET /api/admin-convs?secret=xxx&action=cases_detail&id=xxx → 某条完整报告
  if (action === 'cases') {
    try {
      const n      = Math.min(parseInt(req.query.n      || '50',  10), 200);
      const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);
      const filterType = req.query.type || '';
      const filterAge  = req.query.age  ? parseInt(req.query.age, 10) : null;
      const wantExport = req.query.export === '1';

      // LRANGE cases:index
      const raw = await fetch(`${kvUrl()}/lrange/cases:index/0/1999`, {
        headers: { Authorization: `Bearer ${kvToken()}` },
      });
      const data = await raw.json();
      let cases = (data.result || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);

      // 过滤
      if (filterType) cases = cases.filter(c => c.type === filterType);
      if (filterAge)  cases = cases.filter(c => c.age === filterAge);

      // 统计（全量，过滤后）
      const total = cases.length;
      const typeDist = {};
      for (const c of cases) {
        const t = c.type || '未知';
        typeDist[t] = (typeDist[t] || 0) + 1;
      }

      // 分页
      const page = cases.slice(offset, offset + n).map(c => ({
        ...c,
        createdAt: c.createdAt ? new Date(c.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
      }));

      if (wantExport) {
        res.setHeader('Content-Disposition', 'attachment; filename="aipiwen-cases.json"');
        return res.status(200).json({ total, cases: page });
      }
      return res.status(200).json({ total, typeDist, offset, n, cases: page });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (action === 'cases_detail') {
    const caseId = req.query.id;
    if (!caseId) return res.status(400).json({ error: '缺少 id 参数' });
    const report = await redisGet(`report:${caseId}`).catch(() => null);
    if (!report) return res.status(404).json({ error: '报告不存在或已过期' });
    return res.status(200).json({ ok: true, id: caseId, report });
  }

  // ── 查看错误日志 ────────────────────────────────────────────────────────────
  if (action === 'errors') {
    try {
      const n      = Math.min(parseInt(req.query.n || '50', 10), 200);
      const errors = await getErrors(n);
      return res.status(200).json({ ok: true, count: errors.length, errors });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── 用户列表（含 openid，管理员用来查自己的 openid）────────────────────────
  if (action === 'users') {
    const allOpenids = await redisGet('users:all') || [];
    const users = [];
    for (const openid of allOpenids.slice(0, 200)) {
      const u = await redisGet(`user:${openid}`) || {};
      users.push({
        openid,
        name:      u.name     || u.nickname || '',
        createdAt: u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
        children:  (u.children || []).map(c => c.name),
      });
    }
    return res.status(200).json({ total: users.length, users });
  }

  // ── 全量导出（最新300条，含消息内容）───────────────────────────────────────
  if (action === 'export') {
    const index = await redisGet('convlog:index') || [];
    const allSessions = [];

    for (const s of index.slice(0, 300)) {
      const msgs = await redisGet(`convlog:msgs:${s.sessionId}`) || [];
      allSessions.push({
        sessionId:    s.sessionId,
        context:      s.context,
        contextLabel: CONTEXT_LABELS[s.context] || s.context,
        ts:           s.ts,
        timeStr:      s.ts ? new Date(s.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
        firstMsg:     s.firstMsg,
        ip:           s.ip,
        msgs,
      });
    }

    // 同时将快照存入 Redis，供 digest.js analyze_convs 读取，保留180天
    const snapshotKey = `export:snapshot:${new Date().toISOString().slice(0, 10)}`;
    await redisSet(snapshotKey, allSessions, 180 * 86400).catch(() => {});

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aipiwen_sessions_${dateStr}.json"`);
    return res.status(200).json(allSessions);
  }

  // ── 会话列表 ────────────────────────────────────────────────────────────────
  const index = await redisGet('convlog:index') || [];
  const sessions = index.map(s => ({
    ...s,
    contextLabel: CONTEXT_LABELS[s.context] || s.context,
    timeStr: s.ts ? new Date(s.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '',
  }));

  return res.status(200).json({ total: sessions.length, sessions });
};
