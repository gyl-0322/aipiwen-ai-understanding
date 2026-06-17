/**
 * AIPIWEN 访客对话接口
 * 无需登录，不保存记录，仅返回 AI 回复
 * POST /api/guest-chat
 * body: { content, history: [{role, content}] }
 */

const { getGlobalPatterns, redisSet, redisGet } = require('./_lib');

// ── IP 限流：每个 IP 每分钟最多10次 ─────────────────────────────────────────
async function checkRateLimit(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:${ip}:${minute}`;
  const count  = (await redisGet(key)) || 0;
  if (count >= 10) return false;
  await redisSet(key, count + 1, 120); // TTL 2分钟
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 限流检查
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const allowed = await checkRateLimit(ip).catch(() => true); // 限流本身失败时放行
  if (!allowed) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => (body += c));
    req.on('end', resolve);
    req.on('error', reject);
  });

  let payload = {};
  try { payload = JSON.parse(body); } catch {}

  const { content, history = [] } = payload;
  if (!content?.trim()) return res.status(400).json({ error: '内容不能为空' });

  // 构建对话历史 + 读取全局高频模式（并行）
  const historyText = history.slice(-8)
    .map(m => `${m.role === 'ai' ? 'AI顾问' : '家长'}：${m.content}`)
    .join('\n');

  const globalPatterns = await getGlobalPatterns().catch(() => null);
  const patternsSection = globalPatterns
    ? `\n【AIPIWEN平台近期家长最常提到的情境，供参考】\n${globalPatterns}\n`
    : '';

  const prompt = `你是AIPIWEN的儿童行为理解顾问，专注帮助家长真正读懂孩子。
${patternsSection}
${historyText ? `此前对话：\n${historyText}\n` : ''}
家长刚说：${content.trim()}

请用温柔、有洞察力的语气回复。要求：
- 先回应家长说的这件具体的事
- 给出1-2条具体可操作的建议
- 语气像真正关心这个家庭的朋友，不说教，不夸张
- 回复控制在150字以内，简洁有温度`;

  const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:      'qwen-turbo',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  const aiData = await aiRes.json();
  const reply  = aiData.choices?.[0]?.message?.content || '收到，我来帮你分析一下…';

  return res.status(200).json({ reply });
};
