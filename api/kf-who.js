/**
 * GET /api/kf-who?secret=xxx
 * 查询企业微信客服最近收到的消息，列出发信人的 external_userid
 * 用途：找到管理员自己的 external_userid，填入 ALERT_OPENID 环境变量
 */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const adminSecret = process.env.ADMIN_SECRET;
  const provided    = req.query.secret || '';
  if (!adminSecret || provided !== adminSecret) {
    return res.status(401).json({ error: '未授权' });
  }

  const corpId = process.env.WECHAT_CORP_ID      || '';
  const secret = process.env.WECHAT_AGENT_SECRET  || '';
  const kfid   = process.env.WECHAT_OPEN_KFID    || '';

  if (!corpId || !secret || !kfid) {
    return res.status(200).json({ ok: false, error: '企业微信环境变量未配置', corpId: !!corpId, secret: !!secret, kfid: !!kfid });
  }

  try {
    // 1. 获取 access_token
    const tkRes  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
    const tkData = await tkRes.json();
    const token  = tkData.access_token;
    if (!token) return res.status(200).json({ ok: false, error: '获取微信token失败', detail: tkData });

    // 2. 拉取客服消息
    const msgRes  = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${token}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ open_kfid: kfid, limit: 100 }),
      }
    );
    const msgData = await msgRes.json();

    if (msgData.errcode && msgData.errcode !== 0) {
      return res.status(200).json({ ok: false, error: '微信API报错', detail: msgData });
    }

    const msgList = msgData.msg_list || [];

    // 3. 提取所有外部用户（origin=3 表示客户发来的消息）
    const seen = {};
    for (const m of msgList) {
      if (m.origin === 3 && m.external_userid) {
        if (!seen[m.external_userid]) {
          seen[m.external_userid] = {
            external_userid: m.external_userid,
            last_msg_time: new Date(m.send_time * 1000)
              .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
          };
        }
      }
    }

    const senders = Object.values(seen);
    return res.status(200).json({
      ok: true,
      tip: '找到时间最近的那条，external_userid 就是你的 ALERT_OPENID',
      total_msgs: msgList.length,
      senders,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
