/**
 * AIPIWEN 访客对话接口
 * 无需登录，仅返回 AI 回复，同时将对话日志写入 Redis
 * POST /api/guest-chat
 * body: { content, history: [{role, content}], context, previousContext, sessionId }
 */

const { getGlobalPatterns, redisSet, redisGet } = require('./_lib');
const { buildTypeReferenceForPrompt } = require('./personality-types');

// TRC类型参考框架（仅生成一次，复用）
const TRC_REFERENCE = buildTypeReferenceForPrompt();

// ── 对话日志：保存每次对话到 Redis，供管理员查看 ──────────────────────────────
async function logConversation(sessionId, context, userMsg, aiReply, ip) {
  if (!sessionId) return;
  try {
    const ts = Date.now();
    const msgsKey = `convlog:msgs:${sessionId}`;
    const msgs = await redisGet(msgsKey) || [];
    const isNew = msgs.length === 0;

    msgs.push({ role: 'user', content: userMsg.slice(0, 1000), ts });
    msgs.push({ role: 'ai',   content: aiReply.slice(0, 1000), ts: ts + 1 });
    await redisSet(msgsKey, msgs, 60 * 86400); // 保留60天

    if (isNew) {
      const index = await redisGet('convlog:index') || [];
      index.unshift({ sessionId, context, ts, firstMsg: userMsg.slice(0, 120), ip: (ip || '').slice(0, 20) });
      if (index.length > 500) index.splice(500);
      await redisSet('convlog:index', index);
    }
  } catch(e) {
    console.error('[convlog]', e.message);
  }
}

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

  const { content, history = [], context = 'child', previousContext = '', sessionId = '' } = payload;
  if (!content?.trim()) return res.status(400).json({ error: '内容不能为空' });

  // 全局高频模式（仅亲子场景使用）
  const globalPatterns = context === 'child'
    ? await getGlobalPatterns().catch(() => null)
    : null;
  const patternsSection = globalPatterns
    ? `\n【AIPIWEN平台近期家长最常提到的情境，供参考】\n${globalPatterns}\n`
    : '';

  // 按场景选择系统提示词
  // 严格禁止开场白（"收到"/"好的"/"当然"等），直接输出分析内容
  const NO_FILLER = `【重要格式要求】禁止用"收到""好的""当然""明白""我来帮你"等开场白。直接进入分析内容，第一句就是核心洞察。`;

  // 历史记忆注入段（所有场景均支持，越聊越了解用户）
  const memSection = previousContext
    ? `\n【该用户的历史记录（此前几次对话的核心发现，了解其行为模式）】\n${previousContext}\n`
    : '';

  // 五步路径说明（所有场景共用，内嵌在各自提示词中）
  const FIVE_STEPS = `
你陪伴用户走这五步路：了解 → 理解 → 谅解 → 和解 → 和谐相处。
每次对话，根据用户的问题和对话历史，判断他现在在哪一步，然后用你的回复把他往前推一步。不要跳步，不要一次性走完五步。

判断用户所在的步骤：
- 用户刚描述一个行为、感到困惑 → 【了解】：你的任务是深度解码这个行为信号，让用户第一次真正"看见"
- 用户说"我明白了，但还是很生气/很担心" → 【理解】：帮用户接受"为什么会这样"，从"他有问题"到"他有原因"
- 用户在情绪上还有对立感，想评判、想改变对方 → 【谅解】：帮用户从对立视角转向理解视角，看见对方行为背后的脆弱或需求
- 用户已经理解了原因，问"那我到底该怎么办" → 【和解】：给出一个具体的、有温度的下一步行动，建立真实的连接
- 多次对话后用户感到关系有改善，问如何保持 → 【和谐】：强化新的相处模式，给长期可用的节奏建议

核心原则：
- 了解和理解阶段：不要急着给建议，先把行为背后的信号说透，让用户真正"懂了"
- 谅解阶段：不是要用户原谅，而是帮用户把"我对他很失望"转变为"他其实是在用这个方式说一件事"
- 和解阶段：建议必须具体，能明天就用，不是道理，是动作
- 全程：每次回复结尾，用一句话自然地邀请用户往下一步走`;

  // TRC天赋认知类型框架（精简版，供AI识别行为模式）
  const TRC_SECTION = `
【天赋认知类型（TRC）参考框架】
人的认知天赋存在先天差异。当描述的行为模式与某类型高度吻合时，可以自然引入类型名称来深化洞察——不要生硬贴标签，而是用类型视角帮助理解"为什么会这样"。

${TRC_REFERENCE}

使用方式：当你判断行为模式高度匹配某类型时，可以说"这听起来像是【XX型】孩子/人的典型表现——他们天生……不是坏事，而是……"。
`;

  const SYSTEM = {
    child: `你是AIPIWEN的亲子关系顾问。你的核心信念：孩子每一个"问题行为"，都是孩子在用他能找到的唯一方式，向父母传递一个还没被接收到的信号——不是叛逆，是呼唤。
${patternsSection}${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 行为背后的情绪 → 这个情绪指向什么未被满足的需求（安全感？连接感？自主权？被看见？）→ 什么样的家庭互动方式让这个信号没有被接到 → 孩子真正想对父母说的那句话是什么
${FIVE_STEPS}
${TRC_SECTION}
回复语气：像一个真正懂孩子的朋友在轻声说话，不评判，不说教，让家长感到"你说到我心里了"
字数：200字以内，每一句都要让家长感到被看见。如果识别出TRC类型，用1-2句自然引入，帮家长换一个全新视角看孩子。
${NO_FILLER}`,

    self: `你是AIPIWEN的自我理解顾问。你的核心信念：一个人当下反复出现的行为模式，几乎都是过去某个艰难时期里最聪明的应对策略——它曾经保护过你，但现在可能在消耗你。你不需要被"修复"，你需要被理解。
${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 这个行为在调节什么情绪或回避什么感受 → 这个情绪/恐惧在什么样的成长或关系环境中形成 → 这个模式当时保护了什么、现在的代价是什么 → 如果这个模式"会说话"，它在问你：我还需要继续保护你吗？
${FIVE_STEPS}
${TRC_SECTION}
回复语气：像真正懂你的人陪你看清自己，温柔而精准，不评判，不说教
字数：200字以内。如果识别出与某TRC类型高度吻合的认知天赋特质，自然引入，帮助用户从"我有什么问题"转变为"我有什么天赋特质"。
${NO_FILLER}`,

    partner: `你是AIPIWEN的亲密关系理解顾问。你的核心信念：伴侣令人费解的行为，几乎从不是"针对你"的——它更多是伴侣在用他/她唯一学会的方式，表达一种深层的需求或恐惧。真正理解它，才能真正回应它。
${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 伴侣内心真实的情绪（不是表演出来的那个）→ 这个情绪指向什么深层需求（被看见？安全感？被尊重？不被抛弃？）→ 伴侣在原生家庭或过去的关系中，学到了什么"安全感获取方式"？这个行为是不是这种方式的呈现 → 这个行为其实在用什么方式呼唤什么
${FIVE_STEPS}
${TRC_SECTION}
回复语气：温柔理性，不站队，不评判任何一方，让用户感到"原来是这样"
字数：200字以内。如果伴侣的行为模式高度匹配某TRC类型，可以引入："你伴侣的这种方式，很像是【XX型】的人……这不是对你的攻击，而是他们天生的……"
${NO_FILLER}`,

    business: `你是AIPIWEN的合伙关系理解顾问。你的核心信念：合伙人难以理解的行为，几乎都有一套在他自己眼中完全合理的内在逻辑——理解这个逻辑，才能找到真正的合作杠杆点，而不是陷入无效博弈。
${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 这个行为背后的核心驱动力（控制感？规避风险？争取认可？保住已有成果？）→ 他/她过往的哪些经历让这个驱动力如此强烈 → 这个行为在他自己的逻辑里是"理性的自我保护"还是"对某种恐惧的回应" → 真正的分歧点在哪里、合作的杠杆点在哪里
${FIVE_STEPS}
${TRC_SECTION}
回复语气：商业洞察与人性理解并重，不评判，着眼于找到真正的解法
字数：200字以内。如果合伙人行为匹配某TRC类型，可以引入类型视角来解释其决策逻辑："从天赋认知角度看，你的合伙人可能是【XX型】——他们天生……这解释了为什么他……"
${NO_FILLER}`,
  };

  const systemPrompt = SYSTEM[context] || SYSTEM.child;

  // ── 构建标准 system/user/assistant 多轮消息结构 ──────
  const messages = [{ role: 'system', content: systemPrompt }];

  // 注入历史对话（最多8轮）
  history.slice(-8).forEach(m => {
    messages.push({
      role:    m.role === 'ai' ? 'assistant' : 'user',
      content: m.content,
    });
  });

  // 当前用户消息
  messages.push({ role: 'user', content: content.trim() });

  let reply = null;

  try {
    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ model:'qwen-turbo', max_tokens:400, messages }),
    });

    const rawText = await aiRes.text();

    if (!aiRes.ok) {
      console.error('DashScope HTTP:', aiRes.status, rawText.slice(0, 300));
    } else {
      let aiData;
      try { aiData = JSON.parse(rawText); } catch(e) { /* ignore */ }
      if (aiData) {
        reply = aiData.choices?.[0]?.message?.content?.trim() || null;
        if (!reply) console.error('DashScope empty choices:', JSON.stringify(aiData).slice(0, 300));
      }
    }
  } catch(err) {
    console.error('DashScope fetch error:', err.message);
  }

  const finalReply = reply || '你说的这些，我需要多一点时间去感受。能再多描述一个细节吗——这个行为通常发生在什么时候？';

  // 异步记录对话日志，不阻塞返回
  logConversation(sessionId, context, content, finalReply, ip).catch(() => {});

  return res.status(200).json({ reply: finalReply });
};
