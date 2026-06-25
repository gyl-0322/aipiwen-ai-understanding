/**
 * AIPIWEN 前端错误收集接口
 *
 * POST /api/error-log        — 前端上报错误（无需登录，静默调用）
 * GET  /api/error-log        — 管理员查看最近错误（需 x-admin-secret 或 ?secret=）
 *
 * 环境变量：
 *   ALERT_OPENID         你自己的企业微信 openid（客服机器人给你发消息用）
 *   WECHAT_CORP_ID       企业微信 CorpID（已有）
 *   WECHAT_AGENT_SECRET  企业微信客服 Secret（已有）
 *   WECHAT_OPEN_KFID     企业微信客服 ID（已有）
 *   ADMIN_SECRET         管理员密码（查看错误列表时需要）
 *   KV_REST_API_URL / KV_REST_API_TOKEN  — Vercel KV / Upstash Redis（与其他 API 共用）
 */

const crypto = require('crypto');

const kvUrl   = () => process.env.KV_REST_API_URL   || process.env.REDIS_URL  || '';
const kvToken = () => process.env.KV_REST_API_TOKEN || '';

// ── Redis 工具 ──────────────────────────────────────────────────────────────

/** LPUSH + LTRIM：把新错误插到列表头，只保留最近 200 条 */
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

/** LRANGE：取最近 n 条 */
async function getErrors(n = 50) {
  const res  = await fetch(`${kvUrl()}/lrange/errors:log/0/${n - 1}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
  });
  const data = await res.json();
  return (data.result || []).map(s => { try { return JSON.parse(s); } catch { return s; } });
}

/**
 * 防重：同一错误（msg + page 的 MD5）5 分钟内只推一次微信
 * 返回 true 表示"已推过，跳过本次推送"
 */
async function checkAndMarkDup(hash) {
  const key = `errors:dedup:${hash}`;
  const res = await fetch(`${kvUrl()}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['GET', key],
      ['SET', key, '1', 'EX', 300],   // 300 秒 = 5 分钟
    ]),
  });
  const data = await res.json();
  // data.result[0].result 非 null 表示之前已经设置过
  return !!(data.result?.[0]?.result);
}

// ── 企业微信客服消息推送（复用现有 WECHAT_* 环境变量） ───────────────────────

async function getWxToken() {
  const corpId = process.env.WECHAT_CORP_ID     || '';
  const secret = process.env.WECHAT_AGENT_SECRET || '';
  if (!corpId || !secret) return null;
  const res  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
  const data = await res.json();
  return data.access_token || null;
}

async function sendAlert(entry) {
  // 需要在 Vercel 环境变量里额外加一条：ALERT_OPENID = 你自己的微信 openid
  const adminOpenid = process.env.ALERT_OPENID || '';
  const kfid        = process.env.WECHAT_OPEN_KFID || '';
  if (!adminOpenid || !kfid) return;           // 未配置就跳过，不报错

  const token = await getWxToken().catch(() => null);
  if (!token) return;

  const timeStr = new Date(entry.ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12:   false,
  });

  const lines = [
    `🔴 用户出错了`,
    `时间：${timeStr}`,
    `页面：${entry.page || '-'}`,
    `错误：${entry.msg}`,
  ];
  if (entry.context) lines.push(`场景：${entry.context.slice(0, 200)}`);
  if (entry.stack)   lines.push(`堆栈：${entry.stack.slice(0, 300)}`);
  if (entry.ua)      lines.push(`设备：${entry.ua.slice(0, 100)}`);

  await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${token}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser:    adminOpenid,
        open_kfid: kfid,
        msgtype:   'text',
        text:      { content: lines.join('\n') },
      }),
    }
  ).catch(() => {});   // 推送失败不影响主流程
}

// ── 主处理函数 ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST：前端上报错误 ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      // 兼容 Vercel 自动解析 和 raw stream 两种情况（sendBeacon 走 stream）
      let parsed = req.body;
      if (!parsed || typeof parsed === 'string') {
        let raw = '';
        await new Promise(r => { req.on('data', c => (raw += c)); req.on('end', r); });
        try { parsed = JSON.parse(raw); } catch { parsed = {}; }
      }
      const { msg, stack, page, context, ua } = parsed || {};
      if (!msg) return res.status(400).json({ ok: false, error: 'msg required' });

      const entry = {
        ts:      Date.now(),
        msg:     String(msg).slice(0, 500),
        stack:   stack   ? String(stack).slice(0, 800)   : undefined,
        page:    page    ? String(page).slice(0, 200)    : undefined,
        context: context ? String(context).slice(0, 300) : undefined,
        ua:      ua      ? String(ua).slice(0, 200)      : undefined,
      };

      // 错误指纹（msg + page 的 MD5 前8位）
      const hash = crypto
        .createHash('md5')
        .update((entry.msg || '') + (entry.page || ''))
        .digest('hex')
        .slice(0, 8);

      // 存档 & 防重检查并行执行，加快响应
      const [, isDup] = await Promise.all([
        pushError({ ...entry, hash }),
        checkAndMarkDup(hash),
      ]);

      // 不重复才推微信，避免刷屏
      if (!isDup) await sendAlert(entry);

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[error-log POST]', e);
      return res.status(500).json({ ok: false });
    }
  }

  // ── GET：管理员查看错误列表 / 查询企业微信 external_userid ────────────────────
  if (req.method === 'GET') {
    const adminSecret = process.env.ADMIN_SECRET || 'coco1013';
    const token = req.headers['x-admin-secret'] || req.query.secret;
    if (token !== adminSecret) {
      return res.status(401).json({ error: '未授权，请携带 secret 参数' });
    }

    // action=kf_who：查企业微信客服最近消息，找 ALERT_OPENID
    if (req.query.action === 'kf_who') {
      const corpId = process.env.WECHAT_CORP_ID      || '';
      const sec    = process.env.WECHAT_AGENT_SECRET  || '';
      const kfid   = process.env.WECHAT_OPEN_KFID    || '';
      if (!corpId || !sec || !kfid) {
        return res.status(200).json({ ok: false, error: '企业微信变量未配置' });
      }
      try {
        const tkRes  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${sec}`);
        const tkData = await tkRes.json();
        const wxToken = tkData.access_token;
        if (!wxToken) return res.status(200).json({ ok: false, error: '获取微信token失败', detail: tkData });

        const msgRes  = await fetch(
          `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${wxToken}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ open_kfid: kfid, limit: 100 }) }
        );
        const msgData = await msgRes.json();
        if (msgData.errcode && msgData.errcode !== 0) {
          return res.status(200).json({ ok: false, error: '微信API报错', detail: msgData });
        }
        const seen = {};
        for (const m of (msgData.msg_list || [])) {
          if (m.origin === 3 && m.external_userid && !seen[m.external_userid]) {
            seen[m.external_userid] = new Date(m.send_time * 1000)
              .toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
          }
        }
        const senders = Object.entries(seen).map(([uid, t]) => ({ external_userid: uid, time: t }));
        return res.status(200).json({ ok: true, tip: '找最近的那条，external_userid 填入 ALERT_OPENID', senders });
      } catch(e) {
        return res.status(200).json({ ok: false, error: e.message });
      }
    }

    try {
      const n      = Math.min(parseInt(req.query.n || '50', 10), 200);
      const errors = await getErrors(n);
      return res.status(200).json({ ok: true, count: errors.length, errors });
    } catch (e) {
      console.error('[error-log GET]', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).end();
};
