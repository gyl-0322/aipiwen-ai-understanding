/**
 * AIPIWEN 企业微信消息自动回复
 *
 * 触发场景：
 * 1. 已是好友的用户发来报告链接 → 解码 ?r= 参数 → 自动回复完整报告链接
 * 2. 新用户关注/添加企业微信 → 发送引导消息
 * 3. 用户发来 reportId（AIPIWEN-XXXXXXXX-XXXX）→ 引导发送完整链接
 */

const crypto = require('crypto');

// ─── 环境变量（在 Vercel 后台配置，不要硬编码）────────────────
const CORP_ID     = process.env.WECHAT_CORP_ID;
const AGENT_ID    = process.env.WECHAT_AGENT_ID;
const AGENT_SECRET = process.env.WECHAT_AGENT_SECRET;
const TOKEN       = process.env.WECHAT_TOKEN;

// ─── Access Token 缓存（进程内，冷启动后重新获取）────────────
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORP_ID}&corpsecret=${AGENT_SECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.access_token) {
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return _cachedToken;
  }
  throw new Error('获取 access_token 失败: ' + JSON.stringify(data));
}

// ─── 发送文本消息给用户 ────────────────────────────────────────
async function sendTextMessage(toUser, content) {
  const token = await getAccessToken();
  const body = {
    touser: toUser,
    msgtype: 'text',
    agentid: parseInt(AGENT_ID),
    text: { content },
    safe: 0
  };
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
  );
  return res.json();
}

// ─── 发送图文消息（news）────────────────────────────────────────
async function sendNewsMessage(toUser, title, description, url, picurl) {
  const token = await getAccessToken();
  const body = {
    touser: toUser,
    msgtype: 'news',
    agentid: parseInt(AGENT_ID),
    news: {
      articles: [{ title, description, url, picurl: picurl || '' }]
    }
  };
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
  );
  return res.json();
}

// ─── 简单 XML 解析（无需外部依赖）────────────────────────────
function parseXML(xml) {
  const get = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };
  return {
    ToUserName: get('ToUserName'),
    FromUserName: get('FromUserName'),
    MsgType: get('MsgType'),
    Content: get('Content'),
    Event: get('Event'),
    MsgId: get('MsgId'),
    AgentID: get('AgentID'),
  };
}

// ─── 解码报告链接 ─────────────────────────────────────────────
function decodeReportURL(text) {
  // 尝试从文本中提取 ?r= 参数
  const match = text.match(/[?&]r=([A-Za-z0-9+/=_-]+)/);
  if (!match) return null;
  try {
    const r = decodeURIComponent(match[1]);
    const json = Buffer.from(r, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch(e) {
    return null;
  }
}

const TYPE_LABELS = {
  sensitive: '感知力丰富型',
  autonomy: '自主驱动型',
  relation: '关系连接型',
};

// ─── 生成完整报告回复消息 ──────────────────────────────────────
function buildReportReply(data, reportUrl) {
  const name = data.name || '孩子';
  const typeLabel = TYPE_LABELS[data.type] || '行为理解型';
  return `✅ 已收到！这是${name}的完整行为理解报告。\n\n` +
    `📋 报告类型：${typeLabel}\n` +
    (data.age ? `👧 年龄：${data.age}岁\n` : '') +
    `\n👉 点击查看完整报告：\n${reportUrl}\n\n` +
    `链接打开后无需重新填写，直接显示完整内容。\n\n` +
    `如果有任何问题，或者想进一步了解${name}的情况，随时回复我。`;
}

// ─── SHA1 签名验证 ────────────────────────────────────────────
function verifySignature(token, timestamp, nonce, signature) {
  const str = [token, timestamp, nonce].sort().join('');
  const sha1 = crypto.createHash('sha1').update(str).digest('hex');
  return sha1 === signature;
}

// ─── 读取请求 body ─────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── 主处理函数 ───────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const { msg_signature, signature, timestamp, nonce, echostr } = req.query;
  const sig = msg_signature || signature;

  // GET：企业微信验证
  if (req.method === 'GET') {
    if (!TOKEN || !verifySignature(TOKEN, timestamp, nonce, sig)) {
      return res.status(403).send('Invalid signature');
    }
    return res.status(200).send(echostr);
  }

  // POST：接收消息
  if (req.method === 'POST') {
    // 验证签名
    if (TOKEN && !verifySignature(TOKEN, timestamp, nonce, sig)) {
      return res.status(403).send('Invalid signature');
    }

    let body;
    try {
      body = await readBody(req);
    } catch(e) {
      return res.status(200).send('success');
    }

    const xml = parseXML(body);
    const fromUser = xml.FromUserName;
    const msgType  = xml.MsgType;
    const content  = xml.Content || '';
    const event    = xml.Event;

    try {
      // 场景 1：用户发来包含报告链接的消息
      if (msgType === 'text' && content.includes('aipewen.cn')) {
        const data = decodeReportURL(content);
        if (data) {
          // 提取原始 r 参数重新构造链接
          const rMatch = content.match(/[?&]r=([A-Za-z0-9+/=_%-]+)/);
          const reportUrl = rMatch
            ? `https://www.aipewen.cn?r=${rMatch[1]}`
            : content.trim();
          await sendNewsMessage(
            fromUser,
            (data.name || '孩子') + '的完整行为理解报告',
            TYPE_LABELS[data.type] || '行为理解型' + ' · 点击查看完整内容',
            reportUrl,
            'https://www.aipewen.cn/images/share_cover.png'
          );
        } else {
          await sendTextMessage(fromUser,
            '收到链接，正在为你整理完整报告...\n\n请确认发送的是 www.aipewen.cn 页面上显示的完整链接。'
          );
        }
      }
      // 场景 2：用户发来 reportId
      else if (msgType === 'text' && /AIPIWEN-\d{8}-[A-Z0-9]{4}/.test(content)) {
        await sendTextMessage(fromUser,
          `收到报告编号 ${content.match(/AIPIWEN-\d{8}-[A-Z0-9]{4}/)[0]}。\n\n` +
          `请把 www.aipewen.cn 页面上「已是企业微信好友」区域显示的完整链接发给我，` +
          `我会立刻发送完整报告给你。`
        );
      }
      // 场景 3：新用户关注/添加
      else if (msgType === 'event' && (event === 'subscribe' || event === 'change_contact')) {
        await sendTextMessage(fromUser,
          `欢迎！👋\n\n我是 AIPIWEN 孩子行为理解助手。\n\n` +
          `你可以先去 www.aipewen.cn 做一次免费测试，生成孩子的行为理解报告。\n\n` +
          `生成后，把页面上的报告链接发给我，我会立刻把完整版分析发送给你。`
        );
      }
    } catch(e) {
      console.error('处理消息失败:', e.message);
    }

    return res.status(200).send('success');
  }

  res.status(405).send('Method Not Allowed');
};
