/**
 * AIPIWEN 访客对话接口 + 通用会话日志（merged log-session.js）
 *                     + 跨场景综合分析（merged synthesize.js）
 * 无需登录，仅返回 AI 回复，同时将对话日志写入 Redis
 * POST /api/guest-chat   { content, history, context, sessionId }
 * POST /api/log-session  { sessionId, context, summary, detail }
 * POST /api/synthesize   { contexts: { child?, self?, partner?, business? } }
 */

const { getGlobalPatterns, redisSet, redisGet, creditReferral, callClaude, MODEL_FREE, MODEL_DEEP,
        checkAndConsumeQuota, getOpenid, checkRateLimit: checkApiRateLimit } = require('./_lib');

// ★ 免费对话轮数上限（超过提示升级，既控成本又软付费触发）
const MAX_FREE_ROUNDS = 10;
const { buildTypeReferenceForPrompt } = require('../lib/trc-knowledge-adapter');

// ── log-session 处理器（merged from log-session.js）────────────────────────
async function handleLogSession(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown').slice(0, 20);

  // rate limit: 20/IP/min
  const minute = Math.floor(Date.now() / 60000);
  const rlKey  = `ratelimit:logsess:${ip}:${minute}`;
  const rlCount = (await redisGet(rlKey).catch(() => 0)) || 0;
  if (rlCount >= 20) return res.status(429).json({ error: '请求过于频繁' });
  await redisSet(rlKey, rlCount + 1, 120).catch(() => {});

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || typeof payload !== 'object') throw new Error('no payload');
  } catch {
    let raw = '';
    await new Promise(r => { req.on('data', c => (raw += c)); req.on('end', r); });
    try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const { sessionId, context, summary, detail } = payload || {};
  if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 80)
    return res.status(400).json({ error: 'sessionId 必填且不超过80字符' });
  if (!context || typeof context !== 'string')
    return res.status(400).json({ error: 'context 必填' });

  const ts = Date.now();
  try {
    const msgsKey = `convlog:msgs:${sessionId}`;
    const existing = await redisGet(msgsKey);
    if (existing && existing.length > 0) return res.status(200).json({ ok: true, skipped: true });
    const msgs = [
      { role: 'user', content: String(summary || '').slice(0, 1000), ts },
      { role: 'ai',   content: String(detail  || '').slice(0, 1000), ts: ts + 1 },
    ];
    await redisSet(msgsKey, msgs, 90 * 86400);
    const index = await redisGet('convlog:index') || [];
    index.unshift({ sessionId, context, ts, firstMsg: String(summary || '').slice(0, 120), ip });
    if (index.length > 500) index.splice(500);
    await redisSet('convlog:index', index);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[log-session] error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

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

// ── VIP 白名单：token 存 Redis，永久免限流免限额 ──────────────────────────
async function isVipToken(token) {
  if (!token || typeof token !== 'string' || token.length < 6) return false;
  const val = await redisGet(`vip:token:${token.trim()}`).catch(() => null);
  return !!val;
}

// ── IP 限流：每个 IP 每分钟最多 50 次（Beta 宽松上限，防滥用/bot）─────────
async function checkRateLimit(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:chat:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 50) return false;
  await redisSet(key, count + 1, 120); // TTL 2分钟
  return true;
}

// ── 每日软限额：每 IP 每天最多 10 次 AI 对话（UTC+8日期） ──────────────────
const SOFT_LIMIT_MSG = `你今天已经深度使用很多次了。
为了保证每位用户的体验质量，建议明天继续使用。
如果你愿意邀请朋友一起体验，也可以获得更多免费次数。`;

async function checkDailyQuota(ip) {
  return { ok: true }; // 🔓 测试阶段：配额关闭（上线前删此行）
  const yyyymmdd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const key      = `quota:chat:${ip}:${yyyymmdd}`;
  const bonusKey = `quota:bonus:chat:${ip}`;
  const [count, bonus] = await Promise.all([
    redisGet(key).catch(() => 0),
    redisGet(bonusKey).catch(() => 0),
  ]);
  const limit = 10 + (bonus || 0);
  if ((count || 0) >= limit) return { ok: false };
  await redisSet(key, (count || 0) + 1, 90000);
  return { ok: true };
}

module.exports = async function handler(req, res) {
  // 路由分发：/api/log-session → handleLogSession，/api/synthesize → handleSynthesize
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/log-session') return handleLogSession(req, res);
  if (urlPath === '/api/synthesize')  return handleSynthesize(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // VIP token 检查（内部人员/白名单，免所有限流）
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // 先读 body 中的 vipToken（需在限流前解析header里的token做快速判断）
  const vipTokenFromHeader = req.headers['x-vip-token'] || '';
  const vipPass = await isVipToken(vipTokenFromHeader).catch(() => false);

  if (!vipPass) {
    // 限流检查
    const allowed = await checkRateLimit(ip).catch(() => true); // 限流本身失败时放行
    if (!allowed) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    // 每日软限额检查（10次/天）
    const quota = await checkDailyQuota(ip).catch(() => ({ ok: true }));
    if (!quota.ok) {
      return res.status(200).json({ ok: false, soft: true, reply: SOFT_LIMIT_MSG });
    }
  }

  // P0: 请求体大小限制（Vision 请求含图片，2MB；普通请求 50KB）
  let body = '';
  let bodyBytes = 0;
  const MAX_BODY = 2 * 1024 * 1024; // 2MB
  try {
    await new Promise((resolve, reject) => {
      req.on('data', chunk => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY) {
          reject(Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 }));
          req.destroy();
        } else {
          body += chunk;
        }
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
  } catch(e) {
    if (e.statusCode === 413) {
      return res.status(413).json({ error: '请求体过大，图片请先压缩后再上传' });
    }
    return res.status(500).json({ error: '请求读取失败' });
  }

  let payload = {};
  try { payload = JSON.parse(body); } catch {}

  const {
    content, history = [], context = 'child',
    previousContext = '', sessionId = '',
    imageBase64 = null, imageMimeType = 'image/jpeg',
    subjectAge = null,   // 被测者年龄（数字），用于年龄分层解读
    reportSummary = null, // 第一次vision解读后缓存的报告数据摘要，追问时传入
    refToken = null,     // 邀请裂变 token（被邀请人首次使用时传入，给邀请人积分）
  } = payload;

  // 邀请积分（异步，不阻塞主流程；服务端去重，多次调用安全）
  if (refToken) creditReferral(ip, refToken, 'chat').catch(() => {});

  // 图片上传模式：content 可以为空（纯看图）或追加问题
  const isVisionMode = !!imageBase64;
  if (!isVisionMode && !content?.trim()) return res.status(400).json({ error: '内容不能为空' });

  // ── 防滥用限流（独立层，只打机器人，不影响正常用户）────────────────────────
  const quotaType = isVisionMode ? 'report' : 'chat';
  const rl = await checkApiRateLimit(ip, quotaType);
  if (!rl.allowed) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试', retryAfter: rl.retryAfter });
  }

  // ── 里程碑2：软付费墙 quota 检查（PAYMENT_ENABLED=false 时透明放行）─────────
  const openid = getOpenid(req); // 未登录 guest = null，openid 为 sessionId 兜底
  const quotaKey = openid || `guest:${sessionId || ip}`;
  const qr = await checkAndConsumeQuota(quotaKey, quotaType).catch(() => ({ allowed: true, remaining: 999 }));
  if (!qr.allowed) {
    return res.status(429).json({
      error: qr.reason || '今日额度已用完',
      quota_exhausted: true,
      recover2hAt: qr.recover2hAt,
      upgradeUrl: qr.upgradeUrl || '/membership',
    });
  }

  // ── 年龄/阶段分层：根据 subjectAge / context 决定 AI 解读语气和场景聚焦 ──────
  function getAgeTier(age) {
    if (!age) return null;
    const s = String(age);
    // 儿童年龄段（数字或中文描述）
    if (s.includes('幼儿') || s.includes('4-6') || s.includes('3-6') || s === '4') return 'preschool';
    if (s.includes('小学') || s.includes('7-12') || s === '9') return 'school';
    if (s.includes('大学') || s.includes('18岁以上') || s.includes('大学+')) return 'adult';
    // 初中/高中分开
    if (s.includes('初中') || s.includes('13-15')) return 'junior_teen';
    if (s.includes('高中') || s.includes('16-18')) return 'senior_teen';
    if (s.includes('13-18') || s === '15') return 'junior_teen'; // 旧格式兼容
    if (s.includes('职场')) return 'adult';
    if (s.includes('19') || s === '25') return 'adult';
    const n = Number(age);
    if (!isNaN(n)) {
      if (n <= 6) return 'preschool';
      if (n <= 12) return 'school';
      if (n <= 15) return 'junior_teen';
      if (n <= 18) return 'senior_teen';
      return 'adult';
    }
    return null;
  }
  const ageTier = getAgeTier(subjectAge);

  const AGE_CONTEXT = {
    preschool: `【被测者年龄：学前期（0-6岁）】
语言要求：极度具体，帮家长识别孩子天赋在日常生活中的早期信号（吃饭、睡觉、情绪、探索行为）。
用词方式：对家长说"你的孩子"，避免"他/她"第三人称。避免：学业类建议、抽象概念、升学话题。`,

    school: `【被测者年龄：学童期（7-12岁）】
语言要求：聚焦学校场景，帮家长读懂孩子学习行为背后的天赋逻辑（作业、课堂、同伴关系、兴趣班）。
用词方式：对家长说"你的孩子"，避免"他/她"第三人称。避免：成人化表达、过度升学焦虑。`,

    junior_teen: `【被测者年龄：初中阶段（13-15岁）】
语言要求：双轨输出——对家长用"你的孩子"，必要时也直接对初中生本人说"作为一个X型的你"。
聚焦场景：
- 升初中后性格"变了个人"（更叛逆、更沉默、更喜欢关门）
- 手机/游戏沉迷背后的需求（社交逃避、刺激补偿、被看见感）
- 同伴关系排挤、校园小团体压力、想融入又怕受伤
- 亲子沟通断联（"跟他说不听""他什么都不告诉我"）
- 初中学业压力陡增、厌学苗头
语气：理解初中是情绪最混乱的阶段，不批评行为，帮家长/孩子看见行为背后的真实需求。`,

    senior_teen: `【被测者年龄：高中阶段（16-18岁）】
语言要求：双轨输出——对家长用"你的孩子"，也直接对高中生本人说"作为一个X型的你"。
聚焦场景：
- 高考压力与天赋方向的适配（他适合哪条路？文理选科、志愿方向）
- 孩子开始质疑"读书有什么用"背后的方向迷失感
- 高中住校后亲子关系疏离、见面变少却要管志愿
- 大学志愿填报：如何根据孩子行为特质推断适合的专业方向
- 自我价值感危机（"我就是不如别人""我不知道自己擅长什么"）
语气：务实，承认高中生既有独立思考能力又承受压力，用天赋框架帮他找到方向感，而非只讲励志。`,

    adult: `【被测者年龄：成人（19岁以上）】
语言要求：直接对本人说，全程使用"你"而非"孩子"。
聚焦：职业匹配与发展、亲密关系、自我理解与接纳、天赋如何在工作和生活中发挥。`,
  };

  const ageContextNote = ageTier && AGE_CONTEXT[ageTier]
    ? `\n${AGE_CONTEXT[ageTier]}\n`
    : '';

  // ── 自我理解场景：人生阶段分层 ──────────────────────────────────────────────
  function getSelfStage(age) {
    if (!age) return null;
    const s = String(age);
    if (s.includes('学生') || s.includes('毕业')) return 'early';
    if (s.includes('职场') || s.includes('打拼')) return 'career';
    if (s.includes('成家') || s.includes('育儿')) return 'family';
    if (s.includes('中场')) return 'midlife';
    return null;
  }
  const SELF_STAGE_CONTEXT = {
    early: `【用户人生阶段：学生/初入社会】
聚焦：身份认同、方向迷茫、学习方式、第一份工作的摸索、和父母期待的拉锯。
语气：陪伴式，承认"不知道想做什么"是这个阶段的正常感受，而非问题。`,

    career: `【用户人生阶段：职场打拼期】
聚焦：职场困境（与上司/同事冲突/升职卡壳）、工作与自我价值感的绑定与松绑、驱动力/耗竭感。
语气：真实、精准，承认职场不讲情怀，但天赋特质在职场中是真实的竞争力。`,

    family: `【用户人生阶段：成家育儿期】
聚焦：在伴侣/孩子/工作的多重角色中迷失自我、身份感被稀释、育儿压力与自我成长的拉扯。
语气：理解多角色的重量，帮用户重新找到"我是谁"的稳固感。`,

    midlife: `【用户人生阶段：人生中场期】
聚焦：意义感缺失（"我这辈子到底在做什么"）、关系模式固化、对已走的路的重新评估、第二人生的可能性。
语气：沉稳而有力，看见走过的路的重量，也看见还有的可能。`,
  };
  const selfStage = context === 'self' ? getSelfStage(subjectAge) : null;
  const selfStageNote = selfStage && SELF_STAGE_CONTEXT[selfStage]
    ? `\n${SELF_STAGE_CONTEXT[selfStage]}\n`
    : '';

  // ── 伴侣理解场景：关系阶段分层 ──────────────────────────────────────────────
  function getRelationStage(age) {
    if (!age) return null;
    const s = String(age);
    if (s.includes('恋爱')) return 'dating';
    if (s.includes('新婚') || s.includes('3年内')) return 'newlywed';
    if (s.includes('3-10') || s.includes('3到10')) return 'stable';
    if (s.includes('10年以上') || s.includes('10年')) return 'longterm';
    return null;
  }
  const RELATION_STAGE_CONTEXT = {
    dating: `【关系阶段：恋爱中】
聚焦：这个人"是否适合我"、行为背后是否有深层不安全感、对方的行为模式是天赋差异还是价值观冲突、如何识别真实的TA vs 热恋期的TA。
语气：清醒而温柔，帮用户既看见对方，也看见自己在关系中的期待模式。`,

    newlywed: `【关系阶段：新婚/结婚3年内】
聚焦：生活习惯碰撞、角色期待落差、原生家庭模式的浮现、第一次感到"原来你是这样的人"的震惊与失望。
语气：正常化这些碰撞，帮用户理解这是天赋差异，而非错误选择。`,

    stable: `【关系阶段：结婚3-10年】
聚焦：激情退去后的疏离感、沟通变成事务性的、彼此都忙各自的、情绪积压变成偶尔爆发、"我们之间还剩什么"的困惑。
语气：直面这种平淡，帮用户看见伴侣行为背后的疲惫和未被看见的需求。`,

    longterm: `【关系阶段：结婚10年以上】
聚焦：角色固化（他就是那样了）、互相视而不见、关系维持靠惯性、重新看见彼此的可能性、如何在长期关系中找回真实的连接。
语气：深沉，看见"我们都走了这么远"，也看见"其实还有新的可能"。`,
  };
  const relationStage = context === 'partner' ? getRelationStage(subjectAge) : null;
  const relationStageNote = relationStage && RELATION_STAGE_CONTEXT[relationStage]
    ? `\n${RELATION_STAGE_CONTEXT[relationStage]}\n`
    : '';

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

  // TRC注入策略：previousContext 含类型关键词 或 对话已≥4轮 → 完整 TRC_SECTION
  // 否则注入精简 TRC_HINT，节省约1200 tokens（首次对话时AI无需完整类型库）
  const TRC_TYPE_KEYWORDS = ['认知型','模仿型','开放型','逆思型','整合型','双视型','超级认知型','超级模仿型','弘拓模仿型','弘拓整合','智业集','花茂美','完美型'];
  const hasTRCContext = context === 'report' || TRC_TYPE_KEYWORDS.some(kw => previousContext.includes(kw)) || history.length >= 4;

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

  // ATD反应通道知识（AIPIWEN内部表达）
  const ATD_KNOWLEDGE = `
【ATD反应通道解读框架】
ATD（Angle T-D）是指纹掌纹三叉点角度，反映大脑神经连结密度和情绪反应速度。

ATD数值解读：
- ATD低（≤36.5）：超敏感高能量型。直觉极强，创意爆发，情绪和能量都很大。容易被误认为多动或情绪问题，实际是需要正确疏导的高能量孩子。
- ATD中低（37-42）：敏感灵活型。反应快、直觉强、适应新环境快，但情绪波动较大，容易被外界影响。
- ATD中高（43-50）：均衡型。能感受情绪也能管理，在大多数社交环境游刃有余。
- ATD高（51+）：情绪极稳定型。遇到压力能保持冷静，适应新环境慢但一旦建立关系非常忠诚。有时被误认为"冷漠"，实际是深度处理模式。

使用时机：当用户描述孩子/自己"情绪控制差""反应太慢""太敏感""停不下来"时，结合ATD维度给出解释。
`;

  // 十指脑区全域对照（AIPIWEN内部表达）
  const SHIZHI_NAQU = `
【十指 ↔ 脑区 ↔ 主管方面 · 解读字典】
规则：右手=左脑（理性/逻辑/目标/语言/精细）；左手=右脑（感性/创意/艺术/运动/内省）。
高于个人平均值=先天擅长；低于=先天回避（可后天训练补）。

拇指·精神功能（目标/动机/自我·人际）
- 左拇(L1)右脑：自我反省、自我纪律、承压能力、内在执行力。
  举例：靠"赞美与支持"才有内在执行力；得不到外界肯定会内耗→要学会"我本身就很好"自洽；承压弱的孩子长期高压易抑郁。
- 右拇(R1)左脑：人际互动与主动性、开创新局、目标掌握与主导、外在执行力。
  举例：目标感极强（M型）"不达目的不罢休"；把"你要他干的"变成"他想干的"就好带；双斗整合型知人善用但选择困难→"闭眼想扔掉哪个最难受"。

食指·思维功能（怎么想）
- 左食(L2)右脑：思想方式（感性/创意）、空间想象与方向感、创意能力、策略思考。
  举例：创意点子多、凭感觉想象、设计感强；反箕（逆思R）在此=想法独特、不按牌理、传统里加创意。
- 右食(R2)左脑：逻辑推理、分析能力、学习模式、应变力。
  举例：数学/逻辑型；立体几何卡壳→多拼乐高、下围棋练空间感；低值也能靠目标成为佼佼者。

中指·体觉功能（身体怎么动）
- 左中(L3)右脑：行动力·持续力、律动力、大肢体运动与耐力、协调平衡。
  举例：大运动、跑步打篮球拼体力；坚持度低的遇困难就放弃→要靠精神功能"自己给自己下命令"克服。
- 右中(R3)左脑：双手创造与操控力、小肌肉精细动作、处理小事务的速度与节奏。
  举例：手工、写字、弹琴；此处低=拖拉——凡别人让干的事就拖→拆成小目标克服；"测的大人里这值低的没一个爱做家务"。

无名指·听觉功能（耳朵和嘴）
- 左无名(L4)右脑：音感·节奏·音准、音乐创作力、对声音与言外之意的敏锐度。
  举例：听歌先听旋律；话里有话一点就透；有音乐天赋加以栽培有惊人表现。
- 右无名(R4)左脑：语言表达风格、沟通技巧·措辞、文字内化能力。
  举例：听觉型多听多读→英语大声朗读效果好；此处低="你说五件他记两件还说你没说"；道歉沟通要有理有据否则听出虚。

小指·视觉功能（眼睛看什么）
- 左小(L5)右脑：艺术特质、图像思考力、色彩审美与图像辨识。
  举例：颜控、爱穿漂亮衣服、找对象看脸；设计感强、色彩搭配美感天然好。
- 右小(R5)左脑：环境辨识能力、对自然界的辨识分类、察言观色·识人辨人·方向感。
  举例：此处低="脸盲、见一面记不住、觉得人都是好人、容易迷路找不到停车位"；察言观色靠它，可后天练。

【使用方式】当用户描述某类行为时，定位到对应手指脑区，用"右中指(R3)主管小肌肉精细动作……"的方式说出来，让解读有根、举例精准、维度全面。
场景速查：拖拉→右中(R3)；音乐/语言→无名指；创意设计→左食(L2)；脸盲迷路→右小(R5)；抗压弱/内耗→左拇(L1)；目标感强→右拇(R1)。
`;

  // TRC学习通道知识（AIPIWEN内部表达）
  const TRC_LEARNING_CHANNEL = `
【TRC学习通道解读框架】
TRC（Total Ridge Count）指纹脊线总数，反映大脑神经元网络密度，决定天生学习通道类型。

三大学习通道：
- 视觉学习型：通过"看"进入大脑最高效。图表、视频、思维导图是最佳学习工具。死记硬背效率极低，换成看图/举例立竿见影。
- 听觉学习型：通过"听"进入大脑最高效。朗读、讲解、音频学习效率最高。让孩子把知识"讲"给别人听是最高效复习方式。
- 动觉学习型：通过"做"进入大脑最高效。实验、实操、角色扮演比讲课有效10倍。被误认为"多动"的孩子常常是动觉型学习者。

使用时机：当用户描述"孩子记性差""怎么教都记不住""上课不专注"时，引导用户识别孩子的学习通道，给出换通道的具体建议。
`;

  // 五大功能区知识（AIPIWEN内部表达）
  const WU_DA_GONG_NENG = `
【五大脑区功能解读框架】
皮纹测评报告中的五大功能区数值，反映大脑五个核心功能区的先天发育状态。每个数值分三级：高于平均值（强势区）、等于平均值（均衡区）、低于平均值（发展区），以及X值（未激活——潜力存在，尚未被激发，需要合适的环境触发）。

1. 沟通管理/计划判断
- 高于平均：天生善于表达、主动沟通、擅长规划与判断方向，在群体中自然承担组织协调角色
- 等于平均：能沟通能规划，但较少主动站出来，需要鼓励才能发挥领导潜力
- 低于平均：更倾向内敛，想法有但不易开口，需要"练习场"而非压力环境来培养表达习惯
- X值（未激活）：不是"缺失"，是"按钮还没被按下"——给低压、低风险的练习机会，潜力会被激发

2. 空间心像/构思拟想
- 高于平均：强3D空间感，天生创意人，能把看不见的想法具象化，善于从整体蓝图入手
- 等于平均：具备空间感和创造力，在具体任务中能发挥，但需要更多刺激才能进入创意状态
- 低于平均：偏具象思维，更擅长按步骤执行，不太习惯凭空构思，适合清晰结构化的学习方式
- X值：创造力的火种存在，需要丰富的视觉、空间、艺术体验来激活

3. 听觉辨识/语言理解
- 高于平均：听觉学习型，语言理解力强，能捕捉言外之意，沟通时能听出情绪层次
- 等于平均：听觉和语言能力正常，在安静环境中表现更好
- 低于平均：偏视觉或动觉学习，听讲效果有限，更适合图文、实操方式；不是听不懂，是需要换个输入方式
- X值：需要安静专注的环境；不被固定学习方式束缚，可以"选择"最适合自己的方式；潜力走向取决于后天培养质量

4. 监控管理（自我调控）
- 高于平均：强自我觉察，能主动反思并调整行为，内驱力强，有时会给自己过多压力
- 等于平均：能在他人提醒下自我调整，但主动觉察需要时间
- 低于平均：行动力强但容易冲动，先做后想，需要外部结构和规则帮助形成习惯
- X值：自我监控系统尚未稳定激活，需要温和而一致的外部边界来帮助内化自律

5. 记忆能力/活化功能
- 高于平均：记忆力强，信息激活速度快，容易建立联结，学习新事物上手快
- 等于平均：记忆力正常，多次重复后能稳固掌握
- 低于平均：需要更多重复和多感官输入，不是"记性差"，而是需要找到适合自己的记忆方式（联想、故事化、图像化）
- X值：记忆激活功能待开发，多样的感官刺激和有趣的学习场景能有效唤醒

【核心原则】五大功能区是工具，不是标签。没有好坏，只有"已激活"和"待激活"。X值不是短板，是等待被点燃的潜力。
`;

  // 先天性格类型描述库（AIPIWEN内部统一表达）
  const XINGGE_TYPES = `
【先天性格类型·AIPIWEN统一描述库】
用法：当对话中判断用户/孩子属于某类型时，调用对应描述深化解读，用"这是写在指纹里的性格底色"引入。

■ 逆思型（最常见）
核心：以逆向为中心，先看结果再倒推、先想风险再行动。
表现：思维另类独特，看故事先翻结局，做事先想后果；有出人意料的创意和不按牌理的观点；常被误认为叛逆，其实是天生的批判性思维。
培养：不要打压他的"为什么不行"，那是天赋；给他做策划、研发、审计、法律等逆向思维有价值的出口。

■ 模仿型
核心：以别人为中心，善于模仿学习，情感丰富，重视人际氛围。
表现：好的学、坏的也学，需要正向榜样；渴望被赞美，内心价值感不稳时易随波逐流；不喜冲突，退一步为优先；工作上复制成功方法比自创更顺。
培养：提供正向环境和榜样，给阶段性目标和适当约束；多读伟人传记，设定偶像。

■ 整合型
核心：以整合为中心，灵活多变，擅长资源整合与平台搭建。
表现：同时追多目标，博学多才，公关外交型；选择困难、左右摇摆是核心痛点（"闭眼想扔掉哪个最难受"是决策法）；喜新厌旧，定力需要刻意训练。
培养：提供丰富人脉环境，多参与社交；帮他学会收拢焦点，把资源整合能力变成核心竞争力。

■ 整合兼模仿型
核心：人生大玩家，热情开朗、追求多彩、善于分享。
表现：玩心重，和谁都能玩到一起；博学热情的知识分享型；容易沉浸享乐失去目标，需要外部约束意志力；工作=生活=享受，找喜欢的事做才有动力。
培养：生活环境要丰富多彩；学会抵制诱惑，提高意志力；找到一个"值得为它认真"的方向。

■ 认知兼模仿型
核心：性格中庸，有主见但不唯我独尊，站在巨人肩膀上发挥优势。
表现：听取众人意见后做自己判断；既独立研究又吸收他人成果；领导天赋+服务天赋兼备，最适合承上启下的中层角色；跟任何人都合得来。
培养：发挥人际协调优势，适合人力资源、办公室主任等协调型岗位。

■ 开放型
核心：以吸收为中心，海纳百川，可塑性极强，有教就会、不教就不会。
表现：像海绵一样照单全收；凡事充满好奇、活到老学到老；缺安全感，情绪好坏直接影响学习；基础期（0-8岁）环境决定走向，可能两极分化。
培养：提供安全稳定环境+一对一耐心辅导；尽早选定单一感兴趣领域聚焦；从小设定目标和计划。

■ 模仿兼开放型
核心：辅助者、配合者、跟随者，踏实忠心，沙和尚性格。
表现：奉献付出、柔情博爱；需要简单明确的指令，复杂任务独立完成有困难；需要督促者陪伴成长。
培养：选对正能量平台/团队，任劳任怨发挥支持价值；贴身跟随者是最佳岗位定位。

■ 整合兼开放型
核心：大智若愚，外表呆萌内心丰富，不急于表现，言简意赅一针见血。
表现：能看透本质但不说破，只点醒；冷笑话、冷幽默；熟悉环境热情、陌生环境冷漠退缩，两极分化；学老子无为之治。
注意：三观若偏，会用单纯外表扮猪吃老虎，需要正向引导。

■ 完美兼模仿型
核心：良师益友型（星探+伯乐），善于发现别人独特才华并帮助发扬。
表现：刀子嘴豆腐心，喜挑毛病但出发点是好的；正义感强、路见不平；洞察力极强，注重细节，要求自己高于要求他人。
培养：多培养审美能力，学会用欣赏眼光发现闪光点，委婉表达批评。

■ 认知兼开放型
核心：事务类执行者，坚持自己+简单纯粹，做事只要结果、执行命令、遵守规则。
表现：需要明确目标，一旦确定执行力超强、不达目的誓不罢休；不在乎他人眼神和情感影响；不需要感谢和回报；非常依赖基础期（0-8岁）教养。
培养：给方向和目标，流程简单明了，培养为了结果专注执行的能力。

■ 完美型
核心：追求完美的典范，眼光敏锐独特，注重细节，批判性强，属裁判型。
表现：轻易发现别人忽视的细节；对自身形象和能力要求极高；讲究精致格调；如关注负面会变得挑剔批判，关注正面则是出色的质量把控者。
培养：保护独特性和批判性，用欣赏眼光看待；提供高审美环境；多让孩子"找不同、找区别"。

【解读语气提示】引入类型时说："这不是你教出来的，也不是性格缺陷——这是他天生就写在指纹里的底色。"
`;

  // TRC天赋认知类型框架（精简版，供AI识别行为模式）
  const TRC_SECTION = `
${ATD_KNOWLEDGE}
${TRC_LEARNING_CHANNEL}
【天赋认知类型（TRC）参考框架】
人的认知天赋存在先天差异——这建立在指纹科学三大基石之上（可参考《世界指纹史》《指纹的奥秘》《指纹无谎言》、刘持平等著作与行业研究）：
①先天性：指纹与大脑神经系统在胎儿第13-19周同期形成，皮纹遗传度 h²高达0.94，可作为专业背书线索
②永久性：皮纹终生不变，天赋底色不会随年龄增长消失，但现实表达会受年龄、环境和经历影响
③唯一性：世界上不存在指纹完全相同的两人，每个人的纹型组合和现实表达都不同，必须结合具体行为解读
当描述的行为模式与某类型高度吻合时，可以自然引入类型名称来深化洞察——这种天赋是写在指纹里的，不是性格缺陷，不是被教育出来的，也不会因年龄增长而消失。对外表达必须使用沐海星辰/AIPIWEN统一语言：不暴露商业机构来源，不写成“多家商业观点拼贴”，专业背书只来自著作、论文、行业研究和公开学术人物。

${TRC_REFERENCE}

${WU_DA_GONG_NENG}
${SHIZHI_NAQU}
${XINGGE_TYPES}
使用方式：当你判断行为模式高度匹配某类型时，可以说"这听起来像是【XX型】孩子/人的典型表现——他们天生……不是坏事，而是……这种特质从他还在妈妈肚子里的时候就已经写好了"。
`;

  // 精简版TRC提示（首次对话无先验上下文时使用，节省约1200 tokens）
  const TRC_HINT = `
${ATD_KNOWLEDGE}
${TRC_LEARNING_CHANNEL}
【天赋认知类型（TRC）参考】指纹与大脑神经系统在胎儿第13-19周同期形成，皮纹终生不变，可作为理解人的长期线索；但输出必须结合真实行为观察、年龄阶段和具体场景。当描述的行为模式与某类型高度吻合时可自然引入（勿强行匹配）。17种类型：认知型·模仿型·开放型·逆思型·整合型·双视型·超级认知型A/B/C·超级模仿型·弘拓模仿型·弘拓整合开拓型·智业集道结型·智业集开拓型·花茂美逻辑型·花茂美开拓型·完美型。
${WU_DA_GONG_NENG}`;

  // hasTRCContext=true → 完整知识库（复访用户/长对话）；false → 精简提示（首次/短对话）
  const trcContent = hasTRCContext ? TRC_SECTION : TRC_HINT;

  // ── Task 1B: 报告定制模板（仅注入用户请求的那一个，节省约2000 tokens）──────
  const REPORT_TEMPLATES = {
    '职业发展路径与晋升方向': `结合TRC类型、五大功能区、ATD数值，输出：
【你的核心职业优势】3项最突出的职业竞争力（具体能力，不用模糊形容词）
【最适合的工作类型】技术/管理/创意/销售/执行 哪个方向，说明原因
【最佳工作环境】大公司/小团队/独立工作，节奏快慢，决策自主度偏好
【职业上升通道建议】现阶段→3年后→10年后，每个阶段最关键的1件事
【需要主动回避的方向】2类与天赋不符的岗位类型，说明为什么会耗损
字数：500-700字`,

    '孩子学习方法匹配方案': `【孩子的天生学习通道】视觉/听觉/动觉型 — 用一个真实场景对比说明
【当前学习方式为什么无效】指出孩子现在可能被用错的学习方式
【立竿见影的3个改变】这周就能做到的具体调整（不是泛泛的建议）
【记忆效率提升方案】根据记忆能力功能区，给出最适合的记忆法
【专注力的真相】根据监控管理功能区，解释孩子"不专心"的真实原因及应对
字数：500-600字`,

    '孩子学业发展路径规划': `【孩子的学业天赋底座】核心认知优势与在学习中的体现
【各年龄段的关键任务】
  · 小学阶段（6-12岁）：最重要的1-2件事
  · 初中阶段（12-15岁）：过渡期的天赋保护
  · 高中阶段（15-18岁）：冲刺期的能量分配
  · 大学方向（18岁+）：专业与天赋的匹配原则
【适合孩子的科目方向】根据功能区优势推荐优先发力的学科
【家长能做的3件事】根据天赋调整辅导方式（哪些行为在帮倒忙）
字数：600-700字`,

    '高考选专业与志愿方向': `【天赋与专业的底层逻辑】为什么这个TRC类型适合某类专业（说原因，不只说结论）
【强烈推荐的3-4个专业方向】每个方向配匹配原因 + 对应的大学典型专业举例
【需要慎重考虑的专业】2-3个听起来热门但与天赋不符的专业，说明风险
【院校选择偏好】城市氛围/校园文化/学习节奏 — 什么样的学校环境适合
【填报策略】冲稳保如何分配，结合天赋特质的选择逻辑
字数：600-700字`,

    '毕业生求职方向与行业选择': `面向应届毕业生，核心问题：第一份工作去哪里最值。
【你的求职核心竞争力】根据天赋，面试时最应该强调的3点优势（具体，不空泛）
【优先考虑的行业方向】3-4个行业，每个说明为什么与天赋匹配
【职位类型建议】管培生/技术岗/销售/创意/运营 — 哪类最能发挥天赋
【大厂vs创业公司vs考公】根据ATD和监控管理功能区，哪种工作节奏最适合
【第一份工作的战略意义】不只是薪资，这份工作能为你积累什么核心资产
【试用期如何快速建立价值】根据天赋的行动建议
字数：600-700字`,

    '孩子兴趣班方向建议': `面向家长，核心问题：孩子适合学什么，不要走弯路。
【天赋强烈指向的兴趣领域】根据五大功能区亮点，找出2-3类高潜力方向
【具体兴趣班推荐】每类方向推荐2-3个项目，说明与天赋的具体匹配点
【不建议强推的方向】2类听起来好但与孩子天赋不符的兴趣班，说明为什么会适得其反
【孩子学习节奏建议】根据ATD决定课程频率和每次时长
【如何判断孩子真的喜欢】天赋共鸣的信号 vs 只是新鲜感
字数：400-500字`,

    '情绪管理与压力疏导方案': `面向成人自己，核心问题：为什么控制不住，怎么真正调节。
【你的情绪系统特质】根据ATD值解析情绪反应速度和敏感度（用日常场景举例）
【最容易失控的3个情绪触发点】根据功能区组合具体分析
【为什么常见情绪管理方法对你没用】指出"深呼吸/数数/转移注意力"与你天赋的错位
【天赋适配的3个调节策略】针对这个天赋类型真正有效的具体方法
【能量恢复方式】根据ATD和行为模式：独处/社交/运动/创作 哪种最快恢复你
【给身边人的建议】如何让周围人理解并配合你的情绪节律
字数：500-600字`,

    '创业天赋评估与创业方向': `核心问题：用天赋数据回答"该不该创业，适合什么类型的创业"。
【你的创业天赋特质扫描】从3个关键维度判断：
  · 沟通管理功能区：能否驱动他人、说服客户/合伙人
  · 监控管理功能区：能否自律执行、管理复杂项目
  · ATD值：能否承受高度不确定性和快速变化
【最适合你的创业类型】solo创业/小团队精品/规模化扩张 — 哪种最能发挥天赋
【你的创业核心竞争力】这个天赋类型在创业中最不可替代的能力是什么
【最危险的创业陷阱】哪些常见创业坑对你来说风险最大，为什么
【最佳合伙人天赋画像】你需要什么样的人来补足天赋短板
【建议】结论性判断：现在适不适合创业，以及最优路径
字数：600-700字`,

    '孩子情绪崩溃与脾气处理方案': `面向家长，核心问题：孩子情绪崩溃/发脾气的真正原因和应对方法。
【孩子情绪系统的先天特质】根据ATD值 + 监控管理功能区，解释孩子情绪神经系统的运作方式
【这不是坏脾气，是什么】用天赋语言重新解释家长眼中的"问题行为"
【最容易触发崩溃的3个场景】具体、可识别的触发模式（不是抽象描述）
【崩溃发生时：第一时间做什么/绝对不能做什么】操作性建议，家长明天就能用
【帮助孩子长期建立情绪调节能力的方法】根据天赋定制，不是通用教科书式建议
【家长自身需要调整的反应模式】有时候问题不在孩子，在于家长的应对方式触发了更大的情绪风暴
字数：500-600字`,

    '人际关系冲突与相处模式分析': `核心问题：用天赋数据解释人际摩擦的根源。
【你的天生人际风格】建立关系的方式、沟通节奏偏好、处理冲突的本能反应
【和你"频道最不对"的人是什么类型】从天赋角度描述那类让你最耗能的人的特质
【为什么这些冲突总是重复出现】不是对方的问题，是两种天赋模式的系统性碰撞
【与"难相处"的人共存的具体策略】3条可操作的相处方法（不是"多理解对方"这种废话）
【谁是你的天然盟友】什么类型的人与你相处最顺，以及如何识别他们
【能量管理建议】哪些人际关系在消耗你，值不值得继续投入
字数：500-600字`,
  };

  // 从 content 中提取请求的模板名（chip格式：请根据…生成【XXX】）
  const reportRequestedType = /请.*生成【([^】]+)】/.exec(content)?.[1] || '';
  const reportSingleTemplate = REPORT_TEMPLATES[reportRequestedType] || '';

  // 已缓存的报告摘要注入（Task 2: 后续追问无需重新读图）
  const reportSummarySection = reportSummary
    ? `\n【当前报告完整上下文】\n${String(reportSummary).replace(/^AIPIWEN_DATA\|/, '').replace(/\|/g, ' · ').slice(0, 5000)}\n`
    : '';

  const SYSTEM = {
    child: `你是AIPIWEN的亲子关系顾问。你的核心信念：孩子每一个"问题行为"，都是孩子在用他能找到的唯一方式，向父母传递一个还没被接收到的信号——不是叛逆，是呼唤。
${ageContextNote}${patternsSection}${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 行为背后的情绪 → 这个情绪指向什么未被满足的需求（安全感？连接感？自主权？被看见？）→ 什么样的家庭互动方式让这个信号没有被接到 → 孩子真正想对父母说的那句话是什么
${FIVE_STEPS}
${trcContent}
回复语气：像一个真正懂孩子的朋友在轻声说话，不评判，不说教，让家长感到"你说到我心里了"
字数：200字以内，每一句都要让家长感到被看见。如果识别出TRC类型，用1-2句自然引入，帮家长换一个全新视角看孩子。
${NO_FILLER}`,

    self: `你是AIPIWEN的自我理解顾问。你的核心信念：一个人当下反复出现的行为模式，几乎都是过去某个艰难时期里最聪明的应对策略——它曾经保护过你，但现在可能在消耗你。你不需要被"修复"，你需要被理解。
${selfStageNote}${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 这个行为在调节什么情绪或回避什么感受 → 这个情绪/恐惧在什么样的成长或关系环境中形成 → 这个模式当时保护了什么、现在的代价是什么 → 如果这个模式"会说话"，它在问你：我还需要继续保护你吗？
${FIVE_STEPS}
${trcContent}
回复语气：像真正懂你的人陪你看清自己，温柔而精准，不评判，不说教
字数：200字以内。如果识别出与某TRC类型高度吻合的认知天赋特质，自然引入，帮助用户从"我有什么问题"转变为"我有什么天赋特质"。
${NO_FILLER}`,

    partner: `你是AIPIWEN的亲密关系理解顾问。你的核心信念：伴侣令人费解的行为，几乎从不是"针对你"的——它更多是伴侣在用他/她唯一学会的方式，表达一种深层的需求或恐惧。真正理解它，才能真正回应它。
${relationStageNote}${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 伴侣内心真实的情绪（不是表演出来的那个）→ 这个情绪指向什么深层需求（被看见？安全感？被尊重？不被抛弃？）→ 伴侣在原生家庭或过去的关系中，学到了什么"安全感获取方式"？这个行为是不是这种方式的呈现 → 这个行为其实在用什么方式呼唤什么
${FIVE_STEPS}
${trcContent}
回复语气：温柔理性，不站队，不评判任何一方，让用户感到"原来是这样"
字数：200字以内。如果伴侣的行为模式高度匹配某TRC类型，可以引入："你伴侣的这种方式，很像是【XX型】的人……这不是对你的攻击，而是他们天生的……"
${NO_FILLER}`,

    business: `你是AIPIWEN的合伙关系理解顾问。你的核心信念：合伙人难以理解的行为，几乎都有一套在他自己眼中完全合理的内在逻辑——理解这个逻辑，才能找到真正的合作杠杆点，而不是陷入无效博弈。
${memSection}
行为解读链路（内化于心，不要逐条列出）：
行为表象 → 这个行为背后的核心驱动力（控制感？规避风险？争取认可？保住已有成果？）→ 他/她过往的哪些经历让这个驱动力如此强烈 → 这个行为在他自己的逻辑里是"理性的自我保护"还是"对某种恐惧的回应" → 真正的分歧点在哪里、合作的杠杆点在哪里
${FIVE_STEPS}
${trcContent}
回复语气：商业洞察与人性理解并重，不评判，着眼于找到真正的解法
字数：200字以内。如果合伙人行为匹配某TRC类型，可以引入类型视角来解释其决策逻辑："从天赋认知角度看，你的合伙人可能是【XX型】——他们天生……这解释了为什么他……"
${NO_FILLER}`,

    // ── 报告解读追问模式（非vision，用户已上传报告后的后续对话）─────────────
    report: `你是AIPIWEN的专属报告深聊顾问。用户不是来泛泛描述行为的，而是刚看完一份已经生成的皮纹/天赋报告，正在围绕这份报告继续追问。

你的任务：基于【当前报告完整上下文】继续解释、澄清、举例、落到用户真实生活场景。不要重新做泛行为理解，不要脱离报告数据自由发挥，不要把话题带回普通行为入口。

回答优先级：
1. 先回应用户此刻问的问题。
2. 再回扣报告里的具体数据或板块，例如类型、学习通道、左右脑、ATD、五功能区、已生成正文。
3. 最后给一个可以继续追问的方向。

${ageContextNote}${reportSummarySection}
${reportSingleTemplate
  ? `【解读方向：${reportRequestedType}】\n${reportSingleTemplate}`
  : `【默认解读格式】
【天赋核心】TRC类型最本质的认知特质（2句话，让人觉得"说的就是我"）
【五大功能亮点】1-2个最值得关注的功能区（高分=天赋发力点，X值=待激活潜力）
【典型表现】3个日常具体行为表现
【发展关键】1-2个可立即执行的成长建议
【天赋宣言】一句话点出核心力量（让人想截图收藏）
亲子合盘额外输出：【亲子差异关键】差异最大的功能区及化解方式
亲密关系额外输出：【关系互补洞察】两人天赋如何互补`}

【年龄语气】0-12岁对家长说"你的孩子"；13-18岁兼顾本人与家长；19岁+直接说"你"。
X值处理：不是缺陷，是"未激活的潜力区"，用积极语气表达。

${TRC_REFERENCE}
${WU_DA_GONG_NENG}
格式：用【】标注每个段落开头，段落内容直接展开，不用###标题，不用**加粗**，不用•-数字等列表符号，不换行堆砌短句。称呼用"你"，对家长说"你的孩子"，不用"您"和"他/她/ta"等第三人称。语气专业温暖，必须让用户感觉是在继续解读"我的这份报告"。
${NO_FILLER}`,
  };

  // 视觉模式：读取图片数据 + AIPIWEN语气规范 + 解读模板（精简版，不带完整知识库）
  const VISION_SYSTEM = `你是AIPIWEN的TRC指纹天赋报告解读专家。用户上传了一张测评报告图片，并选择了一个解读方向。

【第一步：读取报告数据】
从图片中提取：被测者姓名/年龄、TRC类型名称、ATD值、三大学习通道占比、五大功能区各项数值（高/等/低/X值）。

【第二步：输出数据摘要行（必须，格式固定，系统自动读取）】
在正文之前，第一行务必输出以下格式（不要修改格式，不要省略，系统将提取并缓存）：
AIPIWEN_DATA|姓名:[从图片读到的姓名或"未知"]|类型:[TRC类型名]|ATD:[数值或"未知"]|沟通:[高/等/低/X]|空间:[高/等/低/X]|听觉:[高/等/低/X]|监控:[高/等/低/X]|记忆:[高/等/低/X]
输出后换一行，再输出用户可见的解读内容。

【第三步：按解读方向输出】
根据用户请求的【解读方向】，结合读取到的数据，输出针对性内容。

═══ 输出规范（必须遵守）═══
格式：用【标题】开头每个段落，不用###标题，不用**加粗**，不用列表符号。
称呼：直接用"你"——像一个老朋友对着报告主人本人说话。不用"他/她/ta/孩子/当事人"等第三人称。
语气：温暖、精准、有温度，像真正懂你的人在说话。不是念数据，是解读这些数据对你意味着什么。每个数值都要落地到你的真实生活场景，让你读完有"说的就是我"的感觉。
X值：是"还没被点燃的潜力"，不是缺陷，要让你感到是机会而非遗憾。
高值：说明在哪些真实场景里这个特质在你身上发挥作用。
低值：不是"不好"，是"换个方式你会更顺"，给出一个具体建议。

═══ 天赋数据全解读模板 ═══
如果用户请求【天赋数据全解读】，按以下结构输出（500-700字）：
【天赋核心】TRC类型的本质认知特质（2-3句，让你读完觉得"说的就是我"）
【学习通道】听觉/视觉/体觉占比的真实含义——用一个你生活里的具体场景解释这对你意味着什么
【五大功能区洞察】挑2-3个最值得关注的区域（高分=你的天赋发力点，低分=换个方式更顺，X值=等待被点燃），每个区域用1-2句说清楚对你的实际影响
【最重要的一件事】基于以上，给你一件现在就可以做的具体的事
【天赋宣言】一句点出你核心力量的话（让你想截图收藏）

如果用户请求其他方向（如职业/高考/学习方法等），结合读取到的数据针对性输出，语气规范同上。
${NO_FILLER}`;

  // ── 知识库检索注入（grounding）：拿用户输入去 knowledge 检索，取前3条作为底座 ──
  // 失败/超时一律静默跳过，绝不影响对话主流程。仅普通对话注入（vision 模式不注入）。
  let kbInjection = '';
  if (!isVisionMode && content && content.trim()) {
    try {
      const host  = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const q     = encodeURIComponent(content.trim().slice(0, 80));
      const kbRes = await fetch(`${proto}://${host}/api/knowledge?action=search&q=${q}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (kbRes.ok) {
        const kbData = await kbRes.json();
        const top = (kbData.chunks || []).slice(0, 3).filter(c => c && c.text);
        if (top.length) {
          kbInjection =
            '\n\n【检索到的专业知识·仅作你的事实底座】\n' +
            top.map(c => '· ' + c.text).join('\n') +
            '\n（用法：把上面的事实用 AIPIWEN 的语气自然融进你的回答，落到用户的具体场景；' +
            '不要照搬原文、不要罗列、不要报来源、不要堆术语。与你已有的知识冲突时以上面为准。）';
        }
      }
    } catch (e) { /* 检索失败不影响主流程 */ }
  }

  const systemPrompt = (isVisionMode ? VISION_SYSTEM : (SYSTEM[context] || SYSTEM.child)) + kbInjection;

  // ── 构建消息结构 ──────────────────────────────────────────────────────────────
  const messages = [{ role: 'system', content: systemPrompt }];

  // 注入历史对话（最多8轮，视觉模式不注入历史）
  if (!isVisionMode) {
    history.slice(-8).forEach(m => {
      messages.push({
        role:    m.role === 'ai' ? 'assistant' : 'user',
        content: m.content,
      });
    });
  }

  // 构建用户消息：视觉模式用多模态格式，普通模式用纯文字
  if (isVisionMode) {
    const userContent = [
      {
        type: 'image_url',
        image_url: { url: `data:${imageMimeType};base64,${imageBase64}` },
      },
    ];
    if (content?.trim()) {
      userContent.push({ type: 'text', text: content.trim() });
    } else {
      userContent.push({ type: 'text', text: '请解读这份测评报告。' });
    }
    messages.push({ role: 'user', content: userContent });
  } else {
    messages.push({ role: 'user', content: content.trim() });
  }

  // ── 免费对话轮数检查（超 MAX_FREE_ROUNDS 轮提示升级/解锁）──────────────
  const isReportContext = context === 'report';
  if (!isVisionMode && !isReportContext) {
    const userTurns = history.filter(m => m.role === 'user').length;
    if (userTurns >= MAX_FREE_ROUNDS) {
      return res.status(200).json({
        ok: true,
        reply: `你已经和我聊了 ${userTurns} 轮，看来你对孩子/自己有很多想深入探索的地方。\n想继续追问更多细节？可以解锁完整版，获得更深度、有数据支撑的专属分析支持。`,
        roundLimitReached: true,
      });
    }
  }

  // ── Claude API 调用（§15 模型选型规范）─────────────────────────────────
  // 视觉 → Sonnet（支持图片）；报告追问 → Sonnet（高质量解读）；普通对话 → Haiku（低成本）
  const model     = (isVisionMode || isReportContext) ? MODEL_DEEP : MODEL_FREE;
  const maxTokens = isVisionMode ? 1200 : (isReportContext ? 1200 : 400);

  let reply = null;

  try {
    const { text } = await callClaude({ model, messages, maxTokens, cache: !isVisionMode, timeoutMs: 25000 });
    reply = text;
    if (!reply) console.error('[guest-chat] Claude empty reply');
  } catch(err) {
    const code = err?.status ? `DS${err.status}` : (err?.name || 'ERR');
    console.error('[guest-chat] AI error:', err.message, '| status:', err.status || '', '| body:', err.body || '');
    redisSet('lastErr:chat', {
      msg: err.message, status: err.status || null, body: err.body || null,
      model, ts: new Date().toISOString(),
    }, 86400).catch(() => {});
    return res.status(200).json({ ok: false, reply: `解读遇到了问题 [${code}]，请重试。` });
  }

  // Task 2: 从 vision 回复中提取 AIPIWEN_DATA 摘要行（供前端缓存，后续追问直接用）
  let extractedReportSummary = null;
  if (isVisionMode && reply) {
    const dataMatch = reply.match(/^AIPIWEN_DATA\|[^\n]+/);
    if (dataMatch) {
      extractedReportSummary = dataMatch[0];
      reply = reply.replace(/^AIPIWEN_DATA\|[^\n]+\n?/, '').trim();
    }
  }

  const FALLBACK = {
    report:   '报告图片已收到，但解读暂时遇到了问题，请重新点击下方的解读方向再试一次。',
    child:    '你说的这些，我需要多一点时间去感受。能再多描述一个细节吗——这个行为通常发生在什么时候？',
    self:     '你说的这些，我听见了。能再多说一点吗——这个模式通常在什么情况下出现？',
    partner:  '你说的这些，我在认真感受。能再描述一个具体的场景吗？',
    business: '我在思考你说的这些。能再说说这个行为在什么情况下最明显吗？',
  };
  const finalReply = reply || FALLBACK[context] || FALLBACK.child;

  // 异步记录对话日志，不阻塞返回
  logConversation(sessionId, context, content, finalReply, ip).catch(() => {});

  return res.status(200).json({
    ok: true,
    reply: finalReply,
    ...(extractedReportSummary ? { reportSummary: extractedReportSummary } : {}),
  });
};

// ── 跨场景综合分析处理器（merged from synthesize.js）─────────────────────────
async function handleSynthesize(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // 限流：每 IP 每分钟最多 3 次
  const minute = Math.floor(Date.now() / 60000);
  const rlKey  = `ratelimit:synth:${ip}:${minute}`;
  const count  = (await redisGet(rlKey).catch(() => 0)) || 0;
  if (count >= 3) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  await redisSet(rlKey, count + 1, 120);

  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => (body += c));
    req.on('end', resolve);
    req.on('error', reject);
  });

  let payload = {};
  try { payload = JSON.parse(body); } catch {}

  const { contexts = {} } = payload;
  const availableContexts = Object.entries(contexts).filter(([, arr]) => arr && arr.length > 0);
  if (availableContexts.length < 2) {
    return res.status(400).json({ error: '至少需要2个场景的数据才能进行综合分析' });
  }

  const CONTEXT_LABELS = {
    child: '亲子场景（孩子的行为）', self: '自我场景（自己的行为）',
    partner: '亲密关系（伴侣的行为）', business: '合伙关系（合伙人的行为）',
  };

  const contextSections = availableContexts.map(([ctx, entries]) => {
    const label = CONTEXT_LABELS[ctx] || ctx;
    const lines = entries.slice(0, 3).map((e, i) =>
      `  ${i + 1}. [${e.date}] 用户描述："${e.behavior}" → AI发现：${e.insight}`
    ).join('\n');
    return `【${label}】\n${lines}`;
  }).join('\n\n');

  const TRC_REFERENCE = buildTypeReferenceForPrompt();

  const systemPrompt = `你是AIPIWEN的家庭关系系统分析顾问。你的核心信念：家庭是一个有机系统，每一个人的行为模式，都是对这个系统整体运作方式的回应——没有人是孤立的"问题"，每个人都在用自己的方式维持系统的某种平衡。\n\n分析原则：\n- 用系统视角，找到多个场景之间真正的内在联系（不是简单罗列各场景）\n- 识别这个人在所有关系中重复出现的核心模式（角色、情绪策略、未被满足的需求）\n- 找到改变的"杠杆点"：改变这一处，可以同时影响多段关系、多个问题\n- 语气温暖有力，像真正懂关系的朋友，不评判任何人，让用户感到"被看见"和"有希望"\n\n【天赋认知类型（TRC）参考框架】\n${TRC_REFERENCE}\n\n【重要格式要求】禁止用"收到""好的""当然""明白""我来帮你"等开场白。直接输出结构化分析。`;

  const userPrompt = `以下是同一个用户在不同关系场景下积累的行为洞察记录：\n\n${contextSections}\n\n请从家庭系统视角进行综合分析。\n\n请按以下结构输出（语言要有洞察力和温度，合计400字以内）：\n\n**系统主题**（1-2句话，说出这个人在所有关系中最核心的那个模式）\n\n**跨场景联系**（2-3条，说明这些场景的行为如何相互影响——要有因果逻辑）\n\n**可能的天赋类型**（如果特征明显，用1-3句话点出；不明显可省略）\n\n**优先改变建议**（3条，按杠杆大小排序。每条说明 在哪里改变 + 为什么能同时让多段关系松动 + 一个明天就能做的具体动作）`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ];

  // 单次重试：第一次失败等 800ms 后再试一次（应对 Claude API 偶发超时）
  let reply = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text } = await callClaude({ model: MODEL_FREE, messages, maxTokens: 600, timeoutMs: 22000 });
      if (text) { reply = text; break; }
    } catch (err) {
      if (attempt === 2) return res.status(503).json({ error: 'AI 服务繁忙，请稍后重试 🔄' });
      await new Promise(r => setTimeout(r, 800));
    }
  }
  if (!reply) return res.status(500).json({ error: 'AI 返回内容为空，请重试' });

  const themeMatch       = reply.match(/\*\*系统主题\*\*[：:]?\s*([\s\S]*?)(?=\*\*跨场景联系\*\*|$)/);
  const connectionsMatch = reply.match(/\*\*跨场景联系\*\*[：:]?\s*([\s\S]*?)(?=\*\*可能的天赋类型\*\*|\*\*优先改变建议\*\*|$)/);
  const trcTypeMatch     = reply.match(/\*\*可能的天赋类型\*\*[：:]?\s*([\s\S]*?)(?=\*\*优先改变建议\*\*|$)/);
  const adviceMatch      = reply.match(/\*\*优先改变建议\*\*[：:]?\s*([\s\S]*?)$/);

  return res.status(200).json({
    theme:       themeMatch?.[1]?.trim()       || '',
    connections: connectionsMatch?.[1]?.trim() || '',
    trcType:     trcTypeMatch?.[1]?.trim()     || '',
    advice:      adviceMatch?.[1]?.trim()      || '',
    raw:         reply,
    contextsUsed: availableContexts.map(([ctx]) => ctx),
  });
}
