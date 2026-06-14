/**
 * IP 探测端点
 * 访问 https://your-app.vercel.app/api/myip
 * 返回本 Vercel 函数的出口 IP，用于填写企业微信「企业可信IP」
 */
module.exports = async function handler(req, res) {
  try {
    const r    = await fetch('https://api.ipify.org?format=json');
    const data = await r.json();
    res.status(200).json({
      outbound_ip: data.ip,
      note: '将此 IP 填写到：企业微信管理后台 → 应用管理 → AIPIWEN客服机器人 → 企业可信IP',
    });
  } catch (e) {
    res.status(200).json({ error: e.message });
  }
};
