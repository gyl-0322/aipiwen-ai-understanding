/**
 * AIPIWEN 对话日志管理接口 + 事件统计埋点（merged stats.js）
 * GET /api/admin-convs?secret=xxx                → 会话列表（最新500条）
 * GET /api/admin-convs?secret=xxx&sid=xxx        → 某次会话的完整对话
 * GET /api/admin-convs?secret=xxx&action=export  → 导出全部会话 JSON（最新300条含消息）
 * POST /api/stats  { event, meta? }              → 埋点（公开）
 * GET  /api/stats?admin=1&secret=xxx             → 查看统计数据（管理端）
 *
 * 需要在 Vercel 环境变量中设置 ADMIN_SECRET
 */

const { redisGet, redisSet } = require('./_lib');

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

module.exports = async function handler(req, res) {
  // 路由分发：/api/stats → handleStats
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/stats') return handleStats(req, res);

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
