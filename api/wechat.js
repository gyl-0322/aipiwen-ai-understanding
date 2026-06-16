/**
 * AIPIWEN 企业微信客服 自动回复
 *
 * 流程：
 * 1. 客户发消息 → 企业微信推 kf_msg_or_event 事件到此 webhook
 * 2. 此 webhook 调用 kf/sync_msg 取出消息内容
 * 3. 解析用户发来的报告链接（含 ?r= 参数）→ 构造完整报告回复
 * 4. 调用 kf/send_msg 发送回复
 *
 * 环境变量（在 Vercel 后台配置）：
 *   WECHAT_CORP_ID       企业ID，如 wwe9a13a3bd1f3948a
 *   WECHAT_AGENT_SECRET  AIPIWEN客服机器人 应用的 Secret
 *   WECHAT_TOKEN         在微信客服后台「接收消息服务器URL」填写的 Token
 *   WECHAT_OPEN_KFID     微信客服账号ID，如 kfc6ce446e6e057c683
 */

const crypto = require('crypto');

const CORP_ID      = process.env.WECHAT_CORP_ID;
const AGENT_SECRET = process.env.WECHAT_AGENT_SECRET;
const TOKEN        = process.env.WECHAT_TOKEN;
const OPEN_KFID    = process.env.WECHAT_OPEN_KFID;

// ─── Access Token 缓存（进程内，Vercel 冷启动后重新获取）─────────────────────
let _cachedToken  = null;
let _tokenExpiry  = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORP_ID}&corpsecret=${AGENT_SECRET}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (data.access_token) {
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return _cachedToken;
  }
  throw new Error('gettoken 失败: ' + JSON.stringify(data));
}

// ─── 拉取客服消息列表 ──────────────────────────────────────────────────────────
async function syncMessages(accessToken, kfToken, openKfId) {
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${accessToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        token:        kfToken,
        limit:        100,
        voice_format: 0,
        open_kfid:    openKfId,
      }),
    }
  );
  return res.json();
}

// ─── 发送客服文本消息 ──────────────────────────────────────────────────────────
async function sendKfMessage(accessToken, toUser, openKfId, content) {
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${accessToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        touser:    toUser,
        open_kfid: openKfId,
        msgtype:   'text',
        text:      { content },
      }),
    }
  );
  return res.json();
}

// ─── 签名验证 ─────────────────────────────────────────────────────────────────
function verifySignature(token, timestamp, nonce, signature) {
  const str  = [token, timestamp, nonce].sort().join('');
  const sha1 = crypto.createHash('sha1').update(str).digest('hex');
  return sha1 === signature;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

// ─── 从消息文本中解码报告数据 ──────────────────────────────────────────────────
function decodeReportFromText(text) {
  const match = text.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    const json    = Buffer.from(decoded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

const TYPE_LABELS = {
  sensitive: '感知力丰富型',
  autonomy:  '自主驱动型',
  relation:  '关系连接型',
};

// ─── 主处理函数 ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const { msg_signature, signature, timestamp, nonce, echostr } = req.query;
  const sig = msg_signature || signature;

  // ── GET：企业微信验证 callback URL ──────────────────────────────────────────
  if (req.method === 'GET') {
    if (!TOKEN || !verifySignature(TOKEN, timestamp, nonce, sig)) {
      return res.status(403).send('Invalid signature');
    }
    return res.status(200).send(echostr);
  }

  // ── POST：接收事件通知 ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    // 立即返回 success，避免企业微信超时重试
    res.status(200).send('success');

    let body = '';
    try { body = await readBody(req); } catch (e) { return; }

    let event = {};
    try { event = JSON.parse(body); } catch (e) {
      // 兼容 XML 格式推送
      const getMsgType = body.match(/<MsgType><!\[CDATA\[(.+?)\]\]><\/MsgType>/);
      const getEvent   = body.match(/<Event><!\[CDATA\[(.+?)\]\]><\/Event>/);
      const getToken   = body.match(/<Token><!\[CDATA\[(.+?)\]\]><\/Token>/);
      const getKfId    = body.match(/<OpenKfId><!\[CDATA\[(.+?)\]\]><\/OpenKfId>/);
      if (getMsgType) event.MsgType  = getMsgType[1];
      if (getEvent)   event.Event    = getEvent[1];
      if (getToken)   event.Token    = getToken[1];
      if (getKfId)    event.OpenKfId = getKfId[1];
    }

    // 只处理客服消息事件
    if (!(event.MsgType === 'event' && event.Event === 'kf_msg_or_event')) return;

    try {
      const accessToken = await getAccessToken();
      const openKfId    = event.OpenKfId || OPEN_KFID;
      const kfToken     = event.Token    || '';

      // 拉取消息列表
      const msgData = await syncMessages(accessToken, kfToken, openKfId);
      if (!msgData.msg_list || msgData.msg_list.length === 0) return;

      for (const msg of msgData.msg_list) {
        // 只处理文本消息
        if (msg.msgtype !== 'text') continue;
        const text     = (msg.text && msg.text.content) || '';
        const fromUser = msg.external_userid;
        if (!fromUser || !text.trim()) continue;

        // 场景 A：用户发来了报告链接
        if (text.includes('aipewen.cn') || text.includes('aipiwen.cn')) {
          const data = decodeReportFromText(text);
          if (data) {
            const rMatch    = text.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
            const reportUrl = rMatch
              ? `https://www.aipiwen.cn?r=${rMatch[1]}`
              : text.trim();
            const name      = data.name || '孩子';
            const typeLabel = TYPE_LABELS[data.type] || '行为理解型';

            await sendKfMessage(accessToken, fromUser, openKfId,
              `✅ 已收到！这是${name}的完整行为理解报告。\n\n` +
              `📋 类型：${typeLabel}\n` +
              (data.age ? `👧 年龄：${data.age}岁\n` : '') +
              `\n👉 点击查看完整报告：\n${reportUrl}\n\n` +
              `链接打开后直接显示完整内容，无需重新填写。`
            );
          } else {
            await sendKfMessage(accessToken, fromUser, openKfId,
              '收到链接！请确认发送的是在 www.aipiwen.cn 页面上生成的完整链接（网址中包含 ?r= 参数）。'
            );
          }
          continue;
        }

        // 场景 B：用户发来了报告编号
        if (/AIPIWEN-\d{8}-[A-Z0-9]{4}/i.test(text)) {
          const idMatch = text.match(/AIPIWEN-\d{8}-[A-Z0-9]{4}/i);
          await sendKfMessage(accessToken, fromUser, openKfId,
            `收到报告编号 ${idMatch[0]}。\n\n` +
            `请把 www.aipiwen.cn 页面上「已成为企业微信好友」区域显示的完整链接（含 ?r= 参数）发给我，` +
            `我立刻发送完整报告。`
          );
          continue;
        }

        // 场景 C：其他消息 → 引导用户发链接
        await sendKfMessage(accessToken, fromUser, openKfId,
          '你好！👋\n\n' +
          '请把你在 www.aipiwen.cn 上完成测试后，页面上显示的完整报告链接发给我，我立刻为你发送完整版行为理解报告。\n\n' +
          '（链接格式：https://www.aipiwen.cn?r=...）'
        );
      }
    } catch (e) {
      console.error('处理客服消息失败:', e.message);
    }

    return;
  }

  res.status(405).send('Method Not Allowed');
};
