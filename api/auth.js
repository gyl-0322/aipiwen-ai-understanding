/**
 * AIPIWEN 微信登录 + 用户账号系统 + 企业微信客服自动回复（merged wechat.js）
 *             + 邀请裂变（merged invite.js）
 *
 * 路由：
 *   GET  /api/auth?action=login_url          → 返回微信授权跳转链接
 *   GET  /api/auth?action=callback&code=xxx  → 微信回调，完成登录，写入session
 *   GET  /api/auth?action=me                 → 返回当前登录用户信息
 *   POST /api/auth?action=logout             → 退出登录
 *   GET  /api/invite?action=create           → 创建邀请 token（merged）
 *   GET  /api/invite?action=track&ref=TOKEN  → 积分给邀请人（merged）
 *
 * 环境变量：
 *   WECHAT_OPEN_APPID      微信开放平台 AppID
 *   WECHAT_OPEN_SECRET     微信开放平台 AppSecret（审核通过后填入）
 *   SESSION_SECRET         随机字符串，用于签名 session token
 */

const crypto = require('crypto');
const { redisSet, redisGet, makeSessionToken, getSessionToken, parseSessionToken, registerUser,
        createInviteToken, creditReferral, ensureUserTenant,
        getQuotaStatus, getTenantBrand, getOpenid,
        applyReferralAttribution } = require('./_lib');

const APPID        = process.env.WECHAT_OPEN_APPID || 'wxcd1f11f34b4cf731';
const SECRET       = process.env.WECHAT_OPEN_SECRET || '';
const REDIRECT_URI = 'https://www.aipiwen.cn/api/auth?action=callback';

// ── 企业微信客服自动回复（merged from wechat.js）────────────────────────────
const WX_CORP_ID      = process.env.WECHAT_CORP_ID;
const WX_AGENT_SECRET = process.env.WECHAT_AGENT_SECRET;
const WX_TOKEN        = process.env.WECHAT_TOKEN;
const WX_OPEN_KFID    = process.env.WECHAT_OPEN_KFID;
let _wxCachedToken = null, _wxTokenExpiry = 0;

async function wxGetAccessToken() {
  if (_wxCachedToken && Date.now() < _wxTokenExpiry) return _wxCachedToken;
  const res  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WX_CORP_ID}&corpsecret=${WX_AGENT_SECRET}`);
  const data = await res.json();
  if (data.access_token) {
    _wxCachedToken = data.access_token;
    _wxTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return _wxCachedToken;
  }
  throw new Error('gettoken 失败: ' + JSON.stringify(data));
}
async function wxSyncMessages(at, kfToken, openKfId) {
  const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${at}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ token: kfToken, limit: 100, voice_format: 0, open_kfid: openKfId }),
  });
  return res.json();
}
async function wxSendMsg(at, toUser, openKfId, content) {
  await fetch(`https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${at}`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ touser: toUser, open_kfid: openKfId, msgtype: 'text', text: { content } }),
  });
}
function wxVerifySig(token, timestamp, nonce, sig) {
  const sha1 = crypto.createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return sha1 === sig;
}
function wxReadBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}
function wxDecodeReport(text) {
  const m = text.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8')); } catch { return null; }
}
const WX_TYPE_LABELS = { sensitive:'感知力丰富型', autonomy:'自主驱动型', relation:'关系连接型' };

async function handleWechat(req, res) {
  const { msg_signature, signature, timestamp, nonce, echostr } = req.query;
  const sig = msg_signature || signature;
  if (req.method === 'GET') {
    if (!WX_TOKEN || !wxVerifySig(WX_TOKEN, timestamp, nonce, sig)) return res.status(403).send('Invalid signature');
    return res.status(200).send(echostr);
  }
  if (req.method === 'POST') {
    res.status(200).send('success');
    let body = '';
    try { body = await wxReadBody(req); } catch { return; }
    let event = {};
    try { event = JSON.parse(body); } catch {
      const gm = body.match(/<MsgType><!\[CDATA\[(.+?)\]\]><\/MsgType>/);
      const ge = body.match(/<Event><!\[CDATA\[(.+?)\]\]><\/Event>/);
      const gt = body.match(/<Token><!\[CDATA\[(.+?)\]\]><\/Token>/);
      const gk = body.match(/<OpenKfId><!\[CDATA\[(.+?)\]\]><\/OpenKfId>/);
      if (gm) event.MsgType = gm[1]; if (ge) event.Event = ge[1];
      if (gt) event.Token = gt[1];   if (gk) event.OpenKfId = gk[1];
    }
    if (!(event.MsgType === 'event' && event.Event === 'kf_msg_or_event')) return;
    try {
      const at = await wxGetAccessToken();
      const openKfId = event.OpenKfId || WX_OPEN_KFID;
      const kfToken  = event.Token || '';
      const msgData  = await wxSyncMessages(at, kfToken, openKfId);
      if (!msgData.msg_list?.length) return;
      for (const msg of msgData.msg_list) {
        const fromUser = msg.external_userid || msg.open_kfid;
        if (!fromUser) continue;

        // ── 进入会话事件 → 主动发欢迎语（覆盖企微后台静态欢迎语）──────────
        if (msg.msgtype === 'event' && msg.event?.event_type === 'enter_session') {
          await wxSendMsg(at, msg.external_userid, openKfId,
            `你好 👋\n\n` +
            `我是AIPIWEN皮纹天赋顾问助手，很高兴见到你！\n\n` +
            `如果你刚完成了皮纹速测，可以把你的天赋类型告诉我；顾问会在工作时间（9:00–21:00）联系你，帮你了解孩子的成长方案。\n\n` +
            `也可以直接告诉我你最想解答的问题 😊`
          );
          continue;
        }

        if (msg.msgtype !== 'text') continue;
        const text = (msg.text?.content) || '';
        if (!text.trim()) continue;

        // ── 皮纹天赋测评用户（来自速测结果页"联系顾问"按钮）──────────────
        if (text.includes('AIPIWEN皮纹天赋测评') || text.includes('皮纹天赋')) {
          const typeMatch    = text.match(/天赋类型是【(.+?)】/);
          const taglineMatch = text.match(/】（(.+?)）/);
          const typeName = typeMatch    ? typeMatch[1]    : '';
          const tagline  = taglineMatch ? taglineMatch[1] : '';
          const typeGreet = typeName
            ? `收到！你孩子的速测天赋类型是【${typeName}】${tagline ? `——${tagline}` : ''}。\n\n`
            : '收到你的皮纹天赋速测结果！\n\n';
          await wxSendMsg(at, fromUser, openKfId,
            `你好 👋\n\n${typeGreet}` +
            `速测只能看到类型轮廓。完整的10指TRC报告还包括：\n` +
            `✅ 精确五大功能区（哪些能力真正领先）\n` +
            `✅ 学习通道占比（听觉 / 视觉 / 体觉）\n` +
            `✅ ATD反应速度（情绪敏感度）\n` +
            `✅ 高频成长问题四段式解读\n` +
            `✅ 可下载完整翻页报告\n\n` +
            `顾问会在工作时间内联系你了解孩子详细情况（9:00–21:00，通常30分钟内回复），帮你制定匹配天赋的成长方案。\n\n` +
            `等不及的话，也可以先上传10指TRC总表，AI立刻生成完整报告 👇\n` +
            `https://www.aipiwen.cn/report-upload.html`
          );
          continue;
        }

        // ── 旧行为分析系统：发来 aipiwen.cn 报告链接 ─────────────────────
        if (text.includes('aipewen.cn') || text.includes('aipiwen.cn')) {
          const data = wxDecodeReport(text);
          if (data) {
            const rm  = text.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
            const url = rm ? `https://www.aipiwen.cn?r=${rm[1]}` : text.trim();
            await wxSendMsg(at, fromUser, openKfId,
              `✅ 已收到！这是${data.name||'孩子'}的完整行为理解报告。\n\n📋 类型：${WX_TYPE_LABELS[data.type]||'行为理解型'}\n${data.age?`👧 年龄：${data.age}岁\n`:''}\n👉 点击查看完整报告：\n${url}\n\n链接打开后直接显示完整内容，无需重新填写。`);
          } else {
            await wxSendMsg(at, fromUser, openKfId, '收到链接！请确认发送的是在 www.aipiwen.cn 页面上生成的完整链接（网址中包含 ?r= 参数）。');
          }
          continue;
        }

        // ── 旧系统报告编号 ────────────────────────────────────────────────
        if (/AIPIWEN-\d{8}-[A-Z0-9]{4}/i.test(text)) {
          const im = text.match(/AIPIWEN-\d{8}-[A-Z0-9]{4}/i);
          await wxSendMsg(at, fromUser, openKfId, `收到报告编号 ${im[0]}。\n\n请把 www.aipiwen.cn 页面上显示的完整链接（含 ?r= 参数）发给我，我立刻发送完整报告。`);
          continue;
        }

        // ── 默认回复 ──────────────────────────────────────────────────────
        await wxSendMsg(at, fromUser, openKfId,
          `你好 👋\n\n` +
          `我是AIPIWEN皮纹天赋顾问助手。\n\n` +
          `如果你刚完成了皮纹速测，顾问会尽快联系你了解孩子情况（工作时间 9:00–21:00，通常30分钟内回复）。\n\n` +
          `你也可以直接告诉我孩子的年龄和你最关心的成长问题，顾问看到后会第一时间回复你 😊`
        );
      }
    } catch (e) { console.error('处理客服消息失败:', e.message); }
    return;
  }
  res.status(405).send('Method Not Allowed');
}

// ── 邀请裂变处理器（merged from invite.js）─────────────────────────────────
async function handleInvite(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';

  if (req.method === 'GET') {
    const url    = new URL(req.url, `https://${req.headers.host}`);
    const action = url.searchParams.get('action');

    if (action === 'create') {
      // 简单防刷：每 IP 每分钟最多创建 5 个 token
      const minute = Math.floor(Date.now() / 60000);
      const rlKey  = `ratelimit:invite:${ip}:${minute}`;
      const count  = (await redisGet(rlKey).catch(() => 0)) || 0;
      if (count >= 5) return res.status(429).json({ ok: false, error: '请求过于频繁' });
      await redisSet(rlKey, count + 1, 120);
      const token = await createInviteToken(ip);
      return res.status(200).json({ ok: true, token });
    }

    if (action === 'track') {
      const ref = url.searchParams.get('ref');
      if (!ref) return res.status(200).json({ ok: true, credited: false });
      const credited = await creditReferral(ip, ref, 'practitioner').catch(() => false);
      return res.status(200).json({ ok: true, credited });
    }

    return res.status(400).json({ ok: false, error: '缺少 action 参数' });
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

module.exports = async function handler(req, res) {
  // 路由分发：/api/wechat → handleWechat，/api/invite → handleInvite
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/wechat') return handleWechat(req, res);
  if (urlPath === '/api/invite') return handleInvite(req, res);

  const { action, code } = req.query;

  // ── 1. 生成微信授权链接 ──────────────────────────────────────────────────
  if (action === 'login_url') {
    // tid：页面展示/品牌上下文；ref：商业归因码。两者不能混用。
    // 编入 state：{c: csrf, t: tenantId, r: referralCode}，base64url 编码（URL 安全、无 =）
    const csrf = crypto.randomBytes(8).toString('hex');
    const tid  = (req.query.tid || 'consumer').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
    const ref  = (req.query.ref || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    const state = Buffer.from(JSON.stringify({ c: csrf, t: tid, r: ref }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const url = `https://open.weixin.qq.com/connect/qrconnect`
      + `?appid=${APPID}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&response_type=code`
      + `&scope=snsapi_login`
      + `&state=${state}#wechat_redirect`;
    return res.status(200).json({ url });
  }

  // ── 2. 微信回调：用 code 换 access_token，获取用户信息 ───────────────────
  if (action === 'callback' && code) {
    try {
      // 解析 state，提取展示租户 tid 与商业归因 ref（兼容旧格式纯 hex state）
      let sourceTenantId = 'consumer';
      let referralCode = '';
      try {
        const stateRaw = req.query.state || '';
        const padded = stateRaw.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(padded, 'base64').toString();
        const parsed  = JSON.parse(decoded);
        if (parsed.t && /^[a-z0-9_-]+$/i.test(parsed.t)) sourceTenantId = parsed.t;
        if (parsed.r && /^[a-z0-9_-]+$/i.test(parsed.r)) referralCode = parsed.r;
      } catch {} // 旧格式或空 state：保持 consumer

      const tokenRes  = await fetch(
        `https://api.weixin.qq.com/sns/oauth2/access_token`
        + `?appid=${APPID}&secret=${SECRET}&code=${code}&grant_type=authorization_code`
      );
      const tokenData = await tokenRes.json();
      if (!tokenData.openid) return res.redirect('/?login_error=1');

      const { openid, unionid, access_token } = tokenData;

      const infoRes  = await fetch(
        `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`
      );
      const userInfo = await infoRes.json();

      const userKey = `user:${openid}`;
      let user = await redisGet(userKey);
      if (!user) {
        // 新用户：记录来源租户（M3 B端返点/归属依据）
        user = {
          openid,
          unionid:        unionid || '',
          nickname:       userInfo.nickname || '',
          avatar:         userInfo.headimgurl || '',
          createdAt:      new Date().toISOString(),
          sourceTenantId, // ★ 来源租户，一旦写入不再覆盖
          children:       [],
        };
      } else {
        user.nickname = userInfo.nickname  || user.nickname;
        user.avatar   = userInfo.headimgurl || user.avatar;
        // 老用户：仅在 sourceTenantId 未设置时补写（避免覆盖历史归属）
        if (!user.sourceTenantId) user.sourceTenantId = sourceTenantId;
      }
      await redisSet(userKey, user);
      if (referralCode) {
        applyReferralAttribution(openid, referralCode).catch(() => {});
      }
      // 把 openid 写入全局用户索引，供定时任务遍历
      registerUser(openid).catch(() => {}); // 非阻塞
      ensureUserTenant(openid).catch(() => {}); // 里程碑1：补充 role/tenantId（幂等，TENANT_ENABLED=false 时无操作）

      const sessionToken = makeSessionToken(openid);
      await redisSet(`session:${sessionToken}`, openid, 30 * 24 * 3600);

      res.setHeader('Set-Cookie',
        `aipiwen_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
      );
      return res.redirect('/');
    } catch (e) {
      console.error('微信登录失败:', e.message);
      return res.redirect('/?login_error=1');
    }
  }

  // ── 3. 获取当前用户信息 ──────────────────────────────────────────────────
  if (action === 'me') {
    const token  = getSessionToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    const openid = parseSessionToken(token);
    if (!openid) return res.status(401).json({ error: 'session无效' });
    const user = await redisGet(`user:${openid}`);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    await ensureUserTenant(openid).catch(() => {}); // 里程碑1：补 role/tenantId（幂等）
    return res.status(200).json({ user });
  }

  // ── 4. 退出登录 ──────────────────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (token) await redisSet(`session:${token}`, null, 1);
    res.setHeader('Set-Cookie', 'aipiwen_session=; Path=/; Max-Age=0');
    return res.status(200).json({ ok: true });
  }

  // ── 5. 注销账号（删除全部数据）────────────────────────────────────────────
  if (action === 'delete_account' && req.method === 'POST') {
    const token  = getSessionToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    const openid = parseSessionToken(token);
    if (!openid) return res.status(401).json({ error: 'session无效' });

    const user = await redisGet(`user:${openid}`);
    if (user) {
      // 删除每个孩子的记录和画像
      for (const child of (user.children || [])) {
        await redisSet(`records:${openid}:${child.id}`,  [], 1);
        await redisSet(`portrait:${openid}:${child.id}`, null, 1);
        await redisSet(`analysis:${openid}:${child.id}`, null, 1);
      }
      // 删除用户档案
      await redisSet(`user:${openid}`, null, 1);

      // 从用户索引移除
      const list = await redisGet('users:all') || [];
      await redisSet('users:all', list.filter(id => id !== openid));
    }

    // 清除订单、解锁记录、安全事件（user_openid 存在的所有表）
    await Promise.all([
      redisSet(`orders:${openid}`,         null, 1),
      redisSet(`unlock_events:${openid}`,  null, 1),
      redisSet(`safety_events:${openid}`,  null, 1),
    ]);

    // 清除 session
    await redisSet(`session:${token}`, null, 1);
    res.setHeader('Set-Cookie', 'aipiwen_session=; Path=/; Max-Age=0');
    return res.status(200).json({ ok: true, message: '账号及全部数据已删除' });
  }

  // ── migrate_account: 将旧 openid 的所有数据迁移到新 openid ─────────────────
  // 场景：微信网页授权换绑、游客转正式账号
  if (action === 'migrate_account' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    const newOpenid = parseSessionToken(token);
    if (!newOpenid) return res.status(401).json({ error: 'session无效' });

    let body = {};
    try {
      const raw = await new Promise((resolve, reject) => {
        let d = '';
        req.on('data', c => { d += c; });
        req.on('end', () => resolve(d));
        req.on('error', reject);
      });
      body = JSON.parse(raw);
    } catch(e) { return res.status(400).json({ error: '请求体格式错误' }); }

    const oldOpenid = body.oldOpenid;
    if (!oldOpenid || oldOpenid === newOpenid) {
      return res.status(400).json({ error: '无效的 oldOpenid' });
    }

    // 需要迁移的顶层 key（含 user_openid 的所有表）
    const topLevelKeys = [
      `user:${oldOpenid}`,
      `orders:${oldOpenid}`,
      `unlock_events:${oldOpenid}`,
      `safety_events:${oldOpenid}`,
    ];

    const errors = [];
    for (const oldKey of topLevelKeys) {
      try {
        const val = await redisGet(oldKey).catch(() => null);
        if (val !== null && val !== undefined) {
          const newKey = oldKey.replace(oldOpenid, newOpenid);
          await redisSet(newKey, val, 365 * 86400);
          await redisSet(oldKey, null, 1); // 清除旧 key
        }
      } catch(e) { errors.push(oldKey); }
    }

    // 迁移孩子记录（子 key 以 openid 为前缀）
    const oldUser = await redisGet(`user:${newOpenid}`).catch(() => null)
                 || await redisGet(`user:${oldOpenid}`).catch(() => null);
    const children = oldUser?.children || [];
    for (const child of children) {
      const childKeys = [
        `records:${oldOpenid}:${child.id}`,
        `portrait:${oldOpenid}:${child.id}`,
        `analysis:${oldOpenid}:${child.id}`,
      ];
      for (const oldKey of childKeys) {
        try {
          const val = await redisGet(oldKey).catch(() => null);
          if (val !== null && val !== undefined) {
            const newKey = oldKey.replace(oldOpenid, newOpenid);
            await redisSet(newKey, val, 365 * 86400);
            await redisSet(oldKey, null, 1);
          }
        } catch(e) { errors.push(oldKey); }
      }
    }

    // 更新 users:all 索引
    const allUsers = await redisGet('users:all').catch(() => []) || [];
    const updated = allUsers.filter(id => id !== oldOpenid);
    if (!updated.includes(newOpenid)) updated.push(newOpenid);
    await redisSet('users:all', updated);

    console.log(`[migrate_account] ${oldOpenid} → ${newOpenid}`, errors.length ? `errors: ${errors.join(',')}` : 'ok');
    return res.status(200).json({ ok: true, migrated: topLevelKeys.length + children.length * 3, errors });
  }

  // ── 里程碑2：quota_status — 返回当前用户额度摘要 ─────────────────────────
  if (action === 'quota_status') {
    const token = getSessionToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    const openid = parseSessionToken(token);
    if (!openid) return res.status(401).json({ error: 'session无效' });
    const status = await getQuotaStatus(openid);
    return res.status(200).json({ ok: true, ...status });
  }

  // ── 里程碑2：upgrade_intent — 记录用户升级意向（付费未开放时收集）────────
  if (action === 'upgrade_intent' && req.method === 'POST') {
    const token = getSessionToken(req);
    const openid = token ? parseSessionToken(token) : null;
    let body = {};
    try {
      const raw = await new Promise((resolve, reject) => {
        let d = ''; req.on('data', c => { d += c; }); req.on('end', () => resolve(d));
      });
      body = JSON.parse(raw);
    } catch {}
    const { tier = 'unknown', label = '' } = body;
    if (openid) {
      const key = `upgrade_intent:${openid}`;
      const existing = await redisGet(key).catch(() => []) || [];
      existing.push({ tier, label, at: new Date().toISOString() });
      await redisSet(key, existing.slice(-10), 90 * 86400).catch(() => {}); // 保留最近10条，90天
    }
    return res.status(200).json({ ok: true });
  }

  // ── 里程碑2/M3预埋：返回当前会话所属租户的品牌配置 ─────────────────────────
  // 未登录时用 ?tid= 查询参数（公开营销页按 B端链接渲染品牌）
  if (action === 'brand') {
    let tenantId = 'consumer';
    // 优先从登录用户 session 读取 sourceTenantId
    const token = getSessionToken(req);
    if (token) {
      const openid = parseSessionToken(token);
      if (openid) {
        const user = await redisGet(`user:${openid}`).catch(() => null);
        if (user?.sourceTenantId) tenantId = user.sourceTenantId;
      }
    }
    // 未登录时：用 ?tid= 参数（B端链接带过来）
    if (tenantId === 'consumer' && req.query.tid) {
      tenantId = req.query.tid.replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'consumer';
    }
    const brand = await getTenantBrand(tenantId);
    return res.status(200).json({ ok: true, tenantId, ...brand });
  }

  return res.status(400).json({ error: '无效的 action' });
};
