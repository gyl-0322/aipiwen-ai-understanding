/**
 * AIPIWEN 跨场景综合分析接口
 * 读取用户在多个场景下积累的行为记忆，生成家庭/关系系统级别的综合洞察
 * POST /api/synthesize
 * body: { contexts: { child?, self?, partner?, business? } }
 *       每个 context 是 [{date, behavior, insight}] 数组
 */

const { redisSet, redisGet } = require('./_lib');
const { buildTypeReferenceForPrompt } = require('./personality-types');

// 综合分析限流：每 IP 每分钟最多 3 次（成本比 guest-chat 高）
async function checkRateLimit(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:synth:${ip}:${minute}`;
  const count  = (await redisGet(key)) || 0;
  if (count >= 3) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const allowed = await checkRateLimit(ip).catch(() => true);
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

  const { contexts = {} } = payload;

  // 至少需要 2 个场景才能综合
  const availableContexts = Object.entries(contexts).filter(([, arr]) => arr && arr.length > 0);
  if (availableContexts.length < 2) {
    return res.status(400).json({ error: '至少需要2个场景的数据才能进行综合分析' });
  }

  // 构建每个场景的描述段落
  const CONTEXT_LABELS = {
    child:    '亲子场景（孩子的行为）',
    self:     '自我场景（自己的行为）',
    partner:  '亲密关系（伴侣的行为）',
    business: '合伙关系（合伙人的行为）',
  };

  const contextSections = availableContexts.map(([ctx, entries]) => {
    const label = CONTEXT_LABELS[ctx] || ctx;
    const lines = entries.slice(0, 3).map((e, i) =>
      `  ${i + 1}. [${e.date}] 用户描述："${e.behavior}" → AI发现：${e.insight}`
    ).join('\n');
    return `【${label}】\n${lines}`;
  }).join('\n\n');

  const TRC_REFERENCE = buildTypeReferenceForPrompt();

  const systemPrompt = `你是AIPIWEN的家庭关系系统分析顾问。你的核心信念：家庭是一个有机系统，每一个人的行为模式，都是对这个系统整体运作方式的回应——没有人是孤立的"问题"，每个人都在用自己的方式维持系统的某种平衡。

你要做的，不是评判这个系统的好坏，而是帮助用户看清：这个系统是如何运转的，哪个地方存在"隐性张力"，以及改变哪一处，可以同时让多段关系松动、呼吸。

分析原则：
- 用系统视角，找到多个场景之间真正的内在联系（不是简单罗列各场景）
- 识别这个人在所有关系中重复出现的核心模式（角色、情绪策略、未被满足的需求）
- 找到改变的"杠杆点"：改变这一处，可以同时影响多段关系、多个问题
- 语气温暖有力，像真正懂关系的朋友，不评判任何人，让用户感到"被看见"和"有希望"

【天赋认知类型（TRC）参考框架】
以下是17种天赋认知类型。在综合分析时，如果用户/孩子/伴侣/合伙人的行为模式高度匹配某类型，可以在"系统主题"或"跨场景联系"中自然引入——这能帮助用户用天赋视角重新理解整个系统的运作。

${TRC_REFERENCE}

【重要格式要求】禁止用"收到""好的""当然""明白""我来帮你"等开场白。直接输出结构化分析。`;

  const userPrompt = `以下是同一个用户在不同关系场景下积累的行为洞察记录：

${contextSections}

请从家庭系统视角进行综合分析，帮助用户走向「了解→理解→谅解→和解→和谐相处」这条路。

请按以下结构输出（语言要有洞察力和温度，合计400字以内）：

**系统主题**（1-2句话，说出这个人在所有关系中最核心的那个模式——让用户看到就觉得"对，就是这个"。如果模式高度匹配某TRC天赋类型，可以说"从天赋认知角度看，你/你孩子/你伴侣可能是【XX型】——这解释了为什么……"。这是「了解」阶段：先让用户真正看见自己的系统）

**跨场景联系**（2-3条，说明这些场景的行为如何相互影响——要有因果逻辑，不是罗列。帮用户从「了解」走向「理解」：为什么这些关系会形成现在这个样子）

**可能的天赋类型**（如果分析中识别出明显的TRC类型特征，用1-3句话点出："根据你描述的模式，Ta很可能是【XX型】——这类人天生……对他们来说最有效的方式是……"。如果特征不明显，此项可省略）

**优先改变建议**（3条，按杠杆大小排序。这是「谅解→和解」阶段：每条说明 在哪里改变 + 这个改变为什么能同时让多段关系松动 + 一个明天就能做的具体动作。语气要让用户感到：改变是可以的，而且从这里开始）`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  let reply = null;
  try {
    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ model:'qwen-turbo', max_tokens:600, messages }),
    });

    const rawText = await aiRes.text();

    if (!aiRes.ok) {
      console.error('Synthesize: DashScope HTTP', aiRes.status, rawText.slice(0, 300));
      return res.status(500).json({ error: `AI 调用失败（${aiRes.status}）：${rawText.slice(0, 80)}` });
    }

    let aiData;
    try { aiData = JSON.parse(rawText); }
    catch(e) { return res.status(500).json({ error: 'AI 返回格式错误：' + rawText.slice(0, 80) }); }

    reply = aiData.choices?.[0]?.message?.content?.trim() || null;
    if (!reply) {
      console.error('Synthesize: empty choices:', JSON.stringify(aiData).slice(0, 300));
      return res.status(500).json({ error: 'AI 返回空内容，请检查 Vercel 环境变量 DASHSCOPE_API_KEY 是否配置' });
    }
  } catch(err) {
    console.error('Synthesize: fetch error:', err.message);
    return res.status(500).json({ error: 'AI 网络请求失败：' + err.message });
  }

  // 解析 AI 输出的各部分
  const themeMatch       = reply.match(/\*\*系统主题\*\*[：:]?\s*([\s\S]*?)(?=\*\*跨场景联系\*\*|$)/);
  const connectionsMatch = reply.match(/\*\*跨场景联系\*\*[：:]?\s*([\s\S]*?)(?=\*\*可能的天赋类型\*\*|\*\*优先改变建议\*\*|$)/);
  const trcTypeMatch     = reply.match(/\*\*可能的天赋类型\*\*[：:]?\s*([\s\S]*?)(?=\*\*优先改变建议\*\*|$)/);
  const adviceMatch      = reply.match(/\*\*优先改变建议\*\*[：:]?\s*([\s\S]*?)$/);

  return res.status(200).json({
    theme:       themeMatch?.[1]?.trim()       || '',
    connections: connectionsMatch?.[1]?.trim() || '',
    trcType:     trcTypeMatch?.[1]?.trim()     || '',  // 新增：天赋类型识别
    advice:      adviceMatch?.[1]?.trim()      || '',
    raw:         reply,
    contextsUsed: availableContexts.map(([ctx]) => ctx),
  });
};
