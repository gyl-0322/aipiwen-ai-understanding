/**
 * AIPIWEN 微信登录 + 用户账号系统
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

module.exports = async function handler(req, res) {
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
