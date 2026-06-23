/**
 * AIPIWEN 微信登录 + 用户账号系统 + 企业微信客服自动回复（merged wechat.js）
 *
 * 路由：
 *   GET  /api/auth?action=login_url          → 返回微信授权跳转链接
 *   GET  /api/auth?action=callback&code=xxx  → 微信回调，完成登录，写入session
 *   GET  /api/auth?action=me                 → 返回当前登录用户信息
 *   POST /api/auth?action=logout             → 退出登录
 *
 * 环境变量：
 *   WECHAT_OPEN_APPID      微信开放平台 AppID
 *   WECHAT_OPEN_SECRET     微信开放平台 AppSecret（审核通过后填入）
 *   SESSION_SECRET         随机字符串，用于签名 session token
 */

const crypto = require('crypto');
const { redisSet, redisGet, makeSessionToken, getSessionToken, parseSessionToken, registerUser } = require('./_lib');

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
        if (msg.msgtype !== 'text') continue;
        const text = (msg.text?.content) || '';
        const fromUser = msg.external_userid;
        if (!fromUser || !text.trim()) continue;
        if (text.includes('aipewen.cn') || text.includes('aipiwen.cn')) {
          const data = wxDecodeReport(text);
          if (data) {
            const rm = text.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
            const url = rm ? `https://www.aipiwen.cn?r=${rm[1]}` : text.trim();
            await wxSendMsg(at, fromUser, openKfId,
              `✅ 已收到！这是${data.name||'孩子'}的完整行为理解报告。\n\n📋 类型：${WX_TYPE_LABELS[data.type]||'行为理解型'}\n${data.age?`👧 年龄：${data.age}岁\n`:''}\n👉 点击查看完整报告：\n${url}\n\n链接打开后直接显示完整内容，无需重新填写。`);
          } else {
            await wxSendMsg(at, fromUser, openKfId, '收到链接！请确认发送的是在 www.aipiwen.cn 页面上生成的完整链接（网址中包含 ?r= 参数）。');
          }
          continue;
        }
        if (/AIPIWEN-\d{8}-[A-Z0-9]{4}/i.test(text)) {
          const im = text.match(/AIPIWEN-\d{8}-[A-Z0-9]{4}/i);
          await wxSendMsg(at, fromUser, openKfId, `收到报告编号 ${im[0]}。\n\n请把 www.aipiwen.cn 页面上「已成为企业微信好友」区域显示的完整链接（含 ?r= 参数）发给我，我立刻发送完整报告。`);
          continue;
        }
        await wxSendMsg(at, fromUser, openKfId, '你好！👋\n\n请把你在 www.aipiwen.cn 上完成测试后，页面上显示的完整报告链接发给我，我立刻为你发送完整版行为理解报告。\n\n（链接格式：https://www.aipiwen.cn?r=...）');
      }
    } catch (e) { console.error('处理客服消息失败:', e.message); }
    return;
  }
  res.status(405).send('Method Not Allowed');
}

module.exports = async function handler(req, res) {
  // 路由分发：/api/wechat → handleWechat
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/wechat') return handleWechat(req, res);

  const { action, code } = req.query;

  // ── 1. 生成微信授权链接 ──────────────────────────────────────────────────
  if (action === 'login_url') {
    const state = crypto.randomBytes(8).toString('hex');
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
        user = {
          openid,
          unionid:   unionid || '',
          nickname:  userInfo.nickname || '',
          avatar:    userInfo.headimgurl || '',
          createdAt: new Date().toISOString(),
          children:  [],
        };
      } else {
        user.nickname = userInfo.nickname  || user.nickname;
        user.avatar   = userInfo.headimgurl || user.avatar;
      }
      await redisSet(userKey, user);
      // 把 openid 写入全局用户索引，供定时任务遍历
      registerUser(openid).catch(() => {}); // 非阻塞

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

    // 清除 session
    await redisSet(`session:${token}`, null, 1);
    res.setHeader('Set-Cookie', 'aipiwen_session=; Path=/; Max-Age=0');
    return res.status(200).json({ ok: true, message: '账号及全部数据已删除' });
  }

  return res.status(400).json({ error: '无效的 action' });
};
