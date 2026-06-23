/**
 * api/generate-report.js — 专属皮纹报告 AI 生成接口
 *
 * POST /api/generate-report
 * Body: {
 *   engineResult: { 主性格类型, key, 学习通道, 行为模式, 左右脑, 五功能区, ATD, 叠加特质 },
 *   age:          number | null,
 *   name:         string | null,
 *   selectedIssues: string[]   // 用户勾选的高频问题
 * }
 *
 * 返回: { ok: true, sections: Section[], raw: string }
 * Section: { title, type:'foundation'|'required'|'issue', content?, why?, how?, future?, cta? }
 *
 * 失败: { ok: false, error: string }
 */

const { redisGet, redisSet, creditReferral } = require('./_lib');

// ── 限流：每 IP 每分钟最多 3 次（防滥用） ──────────────────────────────
async function checkRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:genrpt:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 3) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

// ── 每日软限额：报告生成 3次/天（UTC+8日期） ────────────────────────────
const SOFT_LIMIT_MSG = `你今天已经深度使用很多次了。\n为了保证每位用户的体验质量，建议明天继续使用。\n如果你愿意邀请朋友一起体验，也可以获得更多免费次数。`;

async function checkDailyQuota(ip) {
  const yyyymmdd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const key      = `quota:genrpt:${ip}:${yyyymmdd}`;
  const bonusKey = `quota:bonus:report:${ip}`;
  const [count, bonus] = await Promise.all([
    redisGet(key).catch(() => 0),
    redisGet(bonusKey).catch(() => 0),
  ]);
  const limit = 3 + (bonus || 0);
  if ((count || 0) >= limit) return false;
  await redisSet(key, (count || 0) + 1, 90000);
  return true;
}

// ── 年龄段判断 ──────────────────────────────────────────────────────────
function getAgeTier(age) {
  if (!age) return 'adult';
  const n = Number(age);
  if (n <= 6)  return 'preschool';
  if (n <= 12) return 'school';
  if (n <= 15) return 'junior_teen';
  if (n <= 18) return 'senior_teen';
  return 'adult';
}

// ── 必给模块（按年龄段） ────────────────────────────────────────────────
const REQUIRED_BY_TIER = {
  preschool:    ['天赋底色', '怎么带不拧巴', '安全感与情绪'],
  school:       ['天赋底色', '怎么学最省力', '行为解读'],
  junior_teen:  ['天赋底色', '学习方法', '自我认知', '情绪压力'],
  senior_teen:  ['天赋底色', '学习方法', '自我认知', '情绪压力'],
  adult:        ['天赋底色', '职业优势', '自我成长'],
};

// ── 系统提示词（AIPIWEN 解读语气底座） ─────────────────────────────────
const SYSTEM_PROMPT = `你是 AIPIWEN 皮纹天赋解读 AI，拥有完整的皮纹科学知识体系。

【解读语气·沐海星辰风格】
- 像一位真正懂孩子/自己的朋友，轻声说话，不评判、不说教
- 看行为背后的信号，不看"问题"
- 每条解读都必须拴在具体手指/脑区/数值上，让解读有根有据
- 禁止：套话模板 / 给特质打分排名 / 贩卖焦虑 / 统一标准

【四大前提（必须融入地基段，不列条目）】
① 数值没有好坏，讲到时都说两面
② 不预测未来、不算命（先天=手里的牌，后天=怎么打）
③ 只和自己的平均值比，不和别人比
④ 不贴标签，先天相似后天各不同

【十指脑区速查】
右手=左脑（理性/逻辑/目标/语言/精细）；左手=右脑（感性/创意/艺术/运动/内省）
- 拇指·精神：目标感/动机/承压能力/执行力（右拇=对外主导，左拇=自我内省）
- 食指·思维：右食=逻辑推理/数学；左食=创意/空间/策略
- 中指·体觉：右中=小肌肉精细（手工/写字/拖拉）；左中=大运动/耐力/坚持
- 无名·听觉：右无名=语言表达/记忆力；左无名=音感/言外之意
- 小指·视觉：右小指=识人/察色/方向感；左小指=色彩审美/图像思考

高于个人均值=先天擅长；低于=先天回避（后天可训练补足，神经元越用越密）。

【输出规则】
- 返回纯文本，用 ===标题=== 分隔每个板块
- 板块内部用 ①②③④ 标记四段式（仅 issue 类型需要）
- 直接开始正文，禁止任何开场白（"收到""好的""当然"等）`;

// ── 构建用户消息（引擎数据 + 格式规范） ────────────────────────────────
function buildUserMessage(engineResult, age, name, requiredModules, selectedIssues) {
  const tier    = getAgeTier(age);
  const fp      = engineResult['五功能区'] || {};
  const chan     = engineResult['学习通道'] || {};
  const behav    = engineResult['行为模式'] || {};
  const brain    = engineResult['左右脑'] || {};
  const atd      = engineResult['ATD'] || {};
  const extra    = engineResult['叠加特质'] || {};
  const avg      = fp['个人均值'] || 0;

  // 功能区相对强弱
  const zones = ['精神','思维','体觉','听觉','视觉'];
  const zoneDesc = zones.map(z => {
    const v = fp[z] || 0;
    const diff = v - avg;
    const tag  = diff >= 5 ? '★强势区' : (diff <= -5 ? '△发展区' : '→均衡区');
    return `${z}(${v}) ${tag}`;
  }).join('  ');

  const ageTierDesc = { preschool:'幼儿期(0-6岁)', school:'学龄期(7-12岁)', junior_teen:'初中阶段(13-15岁)', senior_teen:'高中阶段(16-18岁)', adult:'成人(19岁+)' }[tier];
  const nameLabel = name ? `【被测者】${name}，${age}岁（${ageTierDesc}）` : `【被测者】${age}岁（${ageTierDesc}）`;

  const allModules = [...requiredModules, ...selectedIssues];

  // 每个问题模块的输出格式说明
  const issueFormatGuide = selectedIssues.length > 0
    ? `\n【问题模块格式（每个 issue 严格四段式）】\n` + selectedIssues.map(issue =>
        `===issue:${issue}===\n①为什么（基于具体手指/类型的根本原因，2-3句）\n②怎么办（明天就能做的具体动作，2-4条）\n③未来趋势（这个特质在未来值不值钱，2句）\n④还想深聊？（一句话邀请，指出最有价值的追问方向）`
      ).join('\n\n')
    : '';

  return `${nameLabel}
主性格类型：${engineResult['主性格类型']}
学习通道：${chan['主通道']}（占比 ${Object.entries(chan['占比']||{}).map(([k,v])=>`${k}${v}%`).join(' / ')}）
行为模式：${behav['结论']}（精神${behav['精神']} vs 思维${behav['思维']}，差值${behav['delta%']}%）
左右脑：${brain['结论']}（左脑${brain['左脑']} / 右脑${brain['右脑']}，左脑占${brain['左脑占比']}%）
ATD：${atd['值'] || '未知'}（${atd['分区'] || '未测'}）
叠加特质：M型=${extra['M型']?'是':'否'}  逆向思维R=${extra['逆向思维R']?'是('+extra['R手指']?.join(',')+')':'否'}
个人TRC均值：${avg}

【五功能区】${zoneDesc}
总TRC：${fp['总TRC']}

【需要生成的板块】（按顺序）
${allModules.map((m,i)=>`${i+1}. ${m}`).join('\n')}

【必给板块格式】每个必给板块用 ===板块名=== 开头，正文2-3段，具体有比喻，"被说中"型。

${issueFormatGuide}

===END=== 结尾。现在开始生成：`;
}

// ── 解析 sections ────────────────────────────────────────────────────────
function parseSections(raw, requiredModules, selectedIssues) {
  const sections = [];

  // 提取所有 ===xxx=== 块
  const blockRegex = /===([^=]+)===([\s\S]*?)(?====|$)/g;
  let m;

  while ((m = blockRegex.exec(raw)) !== null) {
    const rawTitle = m[1].trim();
    const body     = m[2].trim();
    if (!rawTitle || rawTitle === 'END') continue;

    const isIssueKey  = rawTitle.startsWith('issue:');
    const title       = isIssueKey ? rawTitle.slice(6).trim() : rawTitle;
    const isIssue     = isIssueKey || selectedIssues.includes(title);
    const type        = isIssue ? 'issue'
                      : (title === '天赋底色' ? 'foundation' : 'required');

    if (isIssue) {
      // 四段式拆分
      const parts = { why:'', how:'', future:'', cta:'' };
      const whyM    = body.match(/①[为Why\s]*[：:]([\s\S]*?)(?=②|$)/i);
      const howM    = body.match(/②[怎么办How\s]*[：:]([\s\S]*?)(?=③|$)/i);
      const futureM = body.match(/③[未来Future\s]*[：:]([\s\S]*?)(?=④|$)/i);
      const ctaM    = body.match(/④[还想聊深聊CTA\s]*[？？:：]?([\s\S]*?)$/i);

      // fallback: 按段落分
      if (!whyM && !howM) {
        const paras = body.split(/\n{2,}/).filter(Boolean);
        parts.why    = paras[0] || '';
        parts.how    = paras[1] || '';
        parts.future = paras[2] || '';
        parts.cta    = paras[3] || '想聊更多细节？在下面告诉我吧。';
      } else {
        parts.why    = (whyM?.[1] || '').trim();
        parts.how    = (howM?.[1] || '').trim();
        parts.future = (futureM?.[1] || '').trim();
        parts.cta    = (ctaM?.[1] || '').trim() || '想聊更多？在下面继续问我。';
      }
      sections.push({ title, type, ...parts });
    } else {
      sections.push({ title, type, content: body });
    }
  }

  // 如果 AI 没用 === 分隔（fallback：按换行段落分）
  if (sections.length === 0 && raw.trim()) {
    sections.push({ title: '专属解读', type: 'foundation', content: raw.trim() });
  }

  return sections;
}

// ── 主 Handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const allowed = await checkRate(ip).catch(() => true);
  if (!allowed) return res.status(429).json({ ok:false, error:'请求过于频繁，请稍后再试' });
  // 每日软限额（3次/天）
  const quotaOk = await checkDailyQuota(ip).catch(() => true);
  if (!quotaOk) return res.status(200).json({ ok:false, soft:true, error: SOFT_LIMIT_MSG });

  // 读 body
  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => { body += c; });
    req.on('end', resolve);
    req.on('error', reject);
  });

  let payload = {};
  try { payload = JSON.parse(body); } catch {
    return res.status(400).json({ ok:false, error:'请求格式错误' });
  }

  const { engineResult, age, name, selectedIssues = [], refToken = null } = payload;
  if (!engineResult) return res.status(400).json({ ok:false, error:'缺少 engineResult' });

  // 邀请积分（异步，不阻塞主流程）
  if (refToken) creditReferral(ip, refToken, 'report').catch(() => {});

  const tier          = getAgeTier(age);
  const requiredMods  = REQUIRED_BY_TIER[tier] || REQUIRED_BY_TIER.adult;
  const userMessage   = buildUserMessage(engineResult, age, name, requiredMods, selectedIssues);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userMessage },
  ];

  // ── DashScope 调用（qwen-plus，3000 tokens） ──────────────────────────
  let raw = null;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000); // 55s（Vercel function max 60s）
    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ model:'qwen-plus', max_tokens:3000, messages }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!aiRes.ok) {
      const errText = (await aiRes.text()).slice(0, 400);
      console.error('[gen-report] DashScope HTTP', aiRes.status, errText);
      return res.status(200).json({ ok:false, error:`AI 服务异常（${aiRes.status}），请重试` });
    }

    const aiData = await aiRes.json().catch(() => null);
    raw = aiData?.choices?.[0]?.message?.content?.trim() || null;

    if (!raw) {
      console.error('[gen-report] empty reply:', JSON.stringify(aiData).slice(0, 300));
      return res.status(200).json({ ok:false, error:'AI 未返回内容，请重试' });
    }
  } catch(err) {
    console.error('[gen-report] fetch error:', err.message);
    return res.status(200).json({ ok:false, error:`AI 请求失败: ${err.message}` });
  }

  const sections = parseSections(raw, requiredMods, selectedIssues);

  return res.status(200).json({ ok:true, sections, raw, requiredModules: requiredMods });
};
