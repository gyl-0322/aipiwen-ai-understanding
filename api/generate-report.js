/**
 * api/generate-report.js — 专属皮纹报告 AI 生成接口 + 报告存储（merged report-store.js）
 *
 * POST /api/generate-report  { engineResult, age, name, selectedIssues }  → 生成报告
 * POST /api/report-store     { sections, engineResult, fingers?, name?, age? } → 保存报告（merged）
 * GET  /api/report-store?id=xxx                                           → 读取报告（merged）
 *
 * 失败: { ok: false, error: string }
 */

const crypto = require('crypto');
const { redisGet, redisSet, creditReferral } = require('./_lib');

// ── 案例库索引（Upstash list，max 2000 条）──────────────────────────────────
function kvUrl()   { return process.env.KV_REST_API_URL   || process.env.REDIS_URL  || ''; }
function kvToken() { return process.env.KV_REST_API_TOKEN || ''; }

async function pushCaseIndex(entry) {
  await fetch(`${kvUrl()}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${kvToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['LPUSH', 'cases:index', JSON.stringify(entry)],
      ['LTRIM', 'cases:index', 0, 1999],
    ]),
  }).catch(e => console.warn('[cases] pushCaseIndex failed:', e.message));
}

// ── 十大能力官方映射（来源：中级研修-十大能力对应兴趣班职业专业）────────────
// ⚠️ 这是官方唯一映射，不用旧版"近似"反推
const ABILITY_MAP = [
  { ability:'开创力', pos:'R1', finger:'右拇（对外目标·企图心·号召力）',
    hobby:'活动发起人、团队领导、自定目标挑战',
    career:'创始人/董事长/投资人/号召型讲师/激励讲师', major:'创业/领导力/号召力' },
  { ability:'管理力', pos:'L1', finger:'左拇（对内目标·自我管理·执行协调）',
    hobby:'写日记/作总结、管理零花钱、计划规划',
    career:'总经理/CEO/中层干部/项目执行者', major:'营销/电商/物流/安保管理' },
  { ability:'推理力', pos:'R2', finger:'右食（逻辑语言·数理）',
    hobby:'数学/魔方/棋类/推理故事',
    career:'会计金融/工程师/软件编程/数学家', major:'财务/计算机/工程师' },
  { ability:'心像力', pos:'L2', finger:'左食（创意构思·空间想象）',
    hobby:'创意美术/制作/灵感点子',
    career:'策划/广告/创新发明者', major:'策划广告/创意设计/表演' },
  { ability:'操控力', pos:'R3', finger:'右中（小肌肉精细灵活）',
    hobby:'串珠/做饭/精细手工/整理收纳',
    career:'工匠/手艺人/精密操作/医疗/维修', major:'操作/制作/维修/驾驶/医学/厨师' },
  { ability:'律动力', pos:'L3', finger:'左中（大肌肉律动协调）',
    hobby:'舞蹈/户外运动/模特/体育竞技',
    career:'舞蹈演员/体育教练/话剧/鉴赏师/模特', major:'舞蹈/表演/体育/鉴赏' },
  { ability:'语言力', pos:'R4', finger:'右无名（语言表达·记忆理解）',
    hobby:'阅读朗读/讲故事/背诵/口才演讲',
    career:'记者/翻译/咨询师/培训讲师/信息收集', major:'教育/传媒/家政/乘务/导游' },
  { ability:'音受力', pos:'L4', finger:'左无名（音感·共鸣·感动）',
    hobby:'唱歌/乐器/诗歌朗诵/音乐欣赏',
    career:'歌手/作曲/乐器演奏/主持人/情感分析师', major:'表演/主持人/音乐/客服' },
  { ability:'观察力', pos:'R5', finger:'右小（辨识·分类·细节专注）',
    hobby:'找不同/捉迷藏/自然观察/植物动物',
    career:'纠察督导/刑侦/校对/督导/检验', major:'物流/安保/流水线/医学' },
  { ability:'图像力', pos:'L5', finger:'左小（图像审美·直觉感知）',
    hobby:'美术/画展博物馆/色彩搭配',
    career:'美术/设计师/形象设计/服装搭配', major:'设计师/形象设计/服装/厨师艺术' },
];

// 手指位置 → 功能区
const POS_ZONE = {
  R1:'精神', L1:'精神', R2:'思维', L2:'思维',
  R3:'体觉', L3:'体觉', R4:'听觉', L4:'听觉',
  R5:'视觉', L5:'视觉',
};

// RULE-F04 修正系数（权威规则）
// 精神/听觉：高≥均值+3才算高；视觉：raw+2后再比（高=adj≥avg）；体觉：直接比；思维：低3才算低
const RULE_F04 = {
  精神: { highDelta: 3,  lowDelta: -3, adj: 0 },
  听觉: { highDelta: 3,  lowDelta: -3, adj: 0 },
  视觉: { highDelta: 0,  lowDelta: -3, adj: 2 }, // raw+2后high=adj-avg≥0
  体觉: { highDelta: 0,  lowDelta: -3, adj: 0 }, // 直接比，≥avg即算高
  思维: { highDelta: 3,  lowDelta: -3, adj: 0 }, // 低2点仍正常，低3才算低
};

// 孔雀眼纹型判断（完美家族·官方"天才型"）
const isPeacockSym = s => s === 'Wpe' || s === 'Rpe';

// RULE-N14: TRC总量 → 建议兴趣班数量
function getRuleN14(totalTRC) {
  if (!totalTRC) return { range:'1–2', note:'建议1–2个兴趣班方向' };
  if (totalTRC <= 120) return { range:'1',   note:'建议聚焦1个兴趣班（TRC≤120，学校进度已偏快）' };
  if (totalTRC <= 140) return { range:'1–2', note:'建议1–2个兴趣班方向（TRC121–140，正常跟随）' };
  if (totalTRC <= 160) return { range:'2–3', note:'建议2–3个方向深耕（TRC141–160，需多方向分散）' };
  return { range:'3',   note:'建议锁定3个方向深度钻研（TRC>160，最晚10岁前确定，否则"广而不精"）' };
}

// 应用 RULE-F04，计算十大能力高/中/低分档
// fingers: { R1:{sym,trc}, ..., L5:{sym,trc} }   avg: 五功能区.个人均值
function compute10Abilities(fingers, avg) {
  if (!fingers || !avg) return null;
  const shunshi = [], buDuan = [], peacock = [], rows = [];
  for (const info of ABILITY_MAP) {
    const f = fingers[info.pos];
    if (!f) continue;
    const raw  = (f.trc != null ? +f.trc : 0);
    const sym  = f.sym || '';
    const rule = RULE_F04[POS_ZONE[info.pos]] || RULE_F04['体觉'];
    const adj  = raw + rule.adj;
    const diff = +(adj - avg).toFixed(1);
    let level;
    if (diff >= rule.highDelta)   level = '高';
    else if (diff <= rule.lowDelta) level = '低';
    else                           level = '中';
    const pc = isPeacockSym(sym);
    if (level === '高') shunshi.push(info.ability);
    if (level === '低') buDuan.push(info.ability);
    if (pc && level !== '高') peacock.push(info.ability);
    rows.push({ ...info, raw, adj, diff, sign: diff >= 0 ? '+' : '', level, sym, pc });
  }
  return { rows, shunshi, buDuan, peacock };
}

// 兴趣班/职业板块专用 Prompt 片段
// 只在相关板块被请求时注入，不影响其他板块
function build兴趣班Prompt(fingers, engineResult, tier) {
  const fp    = engineResult?.['五功能区'] || {};
  const avg   = fp['个人均值'] || 0;
  const total = fp['总TRC']   || 0;
  if (!avg || !fingers) return '';
  const res = compute10Abilities(fingers, avg);
  if (!res) return '';
  const { rows, shunshi, buDuan, peacock } = res;
  const n14 = getRuleN14(total);
  const isChild = ['preschool','school','junior_teen','senior_teen'].includes(tier);

  const tableStr = rows.map(r => {
    const mark = r.level === '高' ? '★顺势' : r.level === '低' ? '△补短' : '—';
    let line = `  · ${r.ability}[${r.pos}·${r.finger.replace(/[（）]/g,'')}]：${r.raw}分 差${r.sign}${r.diff}→${mark}`;
    if (r.pc && r.level !== '高') line += ' ⚠️孔雀眼纹型(纹型天才型，但数值未达高—待栽培潜力，≠当下能力高)';
    return line;
  }).join('\n');

  const mapStr = rows.filter(r => r.level === '高').map(r =>
    `  · ${r.ability}→ 兴趣班：${r.hobby}｜职业：${r.career}${!isChild ? '｜专业：'+r.major : ''}`
  ).join('\n') || '  (当前无高分区，按中分区找出最接近均值的2–3项顺势推荐)';

  return `
【⚙️ RULE-F04已修正·十大能力判定（直接使用，不要重新判断高低）】
个人均值=${avg}（总TRC${total}÷10）
${tableStr}
★顺势天赋（数值高）：${shunshi.length ? shunshi.join('、') : '暂无明显高值'}
△补短区（数值低）：${buDuan.length  ? buDuan.join('、') : '无明显低值'}
${peacock.length ? `⚠️孔雀眼纹型待栽培（数值中上但纹型顶配，报告里要把"纹型好"和"能力高"分开说）：${peacock.join('、')}` : ''}

RULE-N14兴趣班数量：${n14.note}

【官方职业/兴趣班映射（来源：中级研修，勿用旧"近似"版）】
${mapStr}

【兴趣班/职业板块·写作规范（严格四段式，区分顺势vs补短，不混）】
①为什么：说清"测什么"（哪根手指/哪个脑区）→用已修正后的数据说"数据特点"→注意区分"数值高"（RULE-F04判的）vs"纹型质量"（孔雀眼等）→2-3句，不堆术语。
②怎么办：
  【顺势部分】按上面官方映射，推荐${n14.range}个${isChild?'兴趣班':'职业/专业'}方向（每条说出具体项目名）；
  【补短部分】单独另起一段，写补短区对应兴趣班，明确标注"可作兴趣体验，不建议以出名次/出成绩为目标"；
  顺势和补短必须分开写，不能混在一起。
③未来趋势：1-2句讲这组天赋组合的价值；再叠加：性格类型+学习通道+ATD行为特点，给出"组合画像落点"一句话（这个人最适合做什么的交集）。
④还想深聊：一句话邀请，指向最有价值的追问（如"这个通道搭哪类老师更合适？"）。
`;
}

// 需要 RULE-F04 十大能力数据的模块名集合（必给 + 可选均含，用于检测）
const 兴趣班板块Names = new Set([
  // ── 必给模块新名（00i REQUIRED_BY_STAGE 中的模块2，全部需要能力数据）
  '兴趣启蒙与潜能',
  '学科潜能与兴趣特长',
  '选科与升学/专业方向',
  '职业起步方向',
  '职业优势与发展',
  '职业价值与二次发展',
  // ── 旧名（向后兼容已生成报告）
  '报什么兴趣班', '我到底擅长啥', '报什么专业',
  '方向感(专业/职业)', '职业优势',
  // ── 00i 可选池：职业决策类（需要 RULE-F04 + 官方映射）
  '文理/选科，天赋更偏哪边',
  '升学决策：冲名校还是选适合专业',
  '考研还是就业，怎么定',
  '适合哪类细分行业/岗位',
  '考公/进体制 vs 闯市场',
  '我适合团队什么角色',
  '职业瓶颈：突破还是转型',
  '适合创业还是打工',
  '团队里适合带人还是做专家',
  '二次成长/转型/再出发往哪走',
  '退休/半退后做什么有价值感',
  '价值重定位：我还能发力在哪',
  '怎么带教、把经验传下去',
]);

// ── 限流：每 IP 每分钟最多 3 次（防滥用） ──────────────────────────────
async function checkRate(ip) {
  return true; // 🔓 测试阶段：限流关闭（上线前删此行）
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:genrpt:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 3) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

// ── VIP bypass ───────────────────────────────────────────────────────────
async function isVipToken(token) {
  if (!token || typeof token !== 'string' || token.length < 6) return false;
  const val = await redisGet(`vip:token:${token.trim()}`).catch(() => null);
  return !!val;
}

// ── 每日软限额：报告生成 10次/天（UTC+8日期） ───────────────────────────
const SOFT_LIMIT_MSG = `今天的报告生成次数已用完。\n明天继续使用，或邀请朋友体验（每邀请1人+1次）。`;

async function checkDailyQuota(ip) {
  return true; // 🔓 测试阶段：配额关闭（上线前删此行）
  const yyyymmdd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const key      = `quota:genrpt:${ip}:${yyyymmdd}`;
  const bonusKey = `quota:bonus:report:${ip}`;
  const [count, bonus] = await Promise.all([
    redisGet(key).catch(() => 0),
    redisGet(bonusKey).catch(() => 0),
  ]);
  const limit = 10 + (bonus || 0);
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
  if (n <= 18) return 'senior_teen';  // ≤18 → 中学段（00i：18岁高考生用中学段）
  if (n <= 25) return 'young_adult';  // ≥19 → 大学·初入职（00i：19起才进18-25段）
  if (n <= 40) return 'adult';        // 25-40 职业发展期
  return 'mature_adult';              // 40+ 成熟·转型期
}

// ── 必给模块（按人生阶段定制，来源：知识库 00i 规则1 表格） ────────────
// 模块1「天赋底色」全龄通用；模块2 随阶段换主题；模块3 随阶段侧重
const REQUIRED_BY_STAGE = {
  preschool:    ['天赋底色', '兴趣启蒙与潜能',        '性格养育引导'],
  school:       ['天赋底色', '学科潜能与兴趣特长',    '成长引导'],
  junior_teen:  ['天赋底色', '选科与升学/专业方向',   '成长引导'],
  senior_teen:  ['天赋底色', '选科与升学/专业方向',   '成长引导'],
  young_adult:  ['天赋底色', '职业起步方向',           '自我成长'],
  adult:        ['天赋底色', '职业优势与发展',         '自我成长'],
  mature_adult: ['天赋底色', '职业价值与二次发展',     '自我成长'],
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
- 拇指·精神：右拇(R1)=开创力·对外主导（目标感/企图心/号召力/事业型驱动）；左拇(L1)=管理力·对内主导（自我纪律/执行协调/承压能力/自制）
- 食指·思维：右食=逻辑推理/数学；左食=创意/空间/策略
- 中指·体觉：右中=小肌肉精细（手工/写字/拖拉）；左中=大运动/耐力/坚持
- 无名·听觉：右无名=语言表达/记忆力；左无名=音感/言外之意
- 小指·视觉：右小指=识人/察色/方向感；左小指=色彩审美/图像思考

高于个人均值=先天擅长；低于=先天回避（后天可训练补足，神经元越用越密）。

【文风三条红线（来源：话术规范 00i，必须遵守）】
1. 先结论后点缀：每段第一句必须是人话结论（测出什么 / 强在哪 / 该怎么用），比喻修辞放后面，结论不许埋到段尾。
2. 一段一比喻上限：同一段内最多一个比喻或意象，不堆叠多个意象（禁止：旧书+溪流+炭火+将军印 连用）。
3. 可落地动作单独成行：具体可执行的建议（今天就能做的事）用 ▸ 单独列一行，不裹在比喻句里。

【输出规则】
- 返回纯文本，用 ===标题=== 分隔每个板块
- 板块内部用 ①②③④ 标记四段式（仅 issue 类型需要）
- 直接开始正文，禁止任何开场白（"收到""好的""当然"等）`;

// ── 构建用户消息（引擎数据 + 格式规范） ────────────────────────────────
function buildUserMessage(engineResult, age, name, requiredModules, selectedIssues, fingers, tier) {
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

  const ageTierDesc = {
    preschool:'学龄前(0-6岁)', school:'小学阶段(7-12岁)',
    junior_teen:'初中阶段(13-15岁)', senior_teen:'高中阶段(16-18岁)',
    young_adult:'大学·初入职(18-25岁)', adult:'职业发展期(25-40岁)',
    mature_adult:'成熟·转型期(40岁+)',
  }[tier];
  const nameLabel = name ? `【被测者】${name}，${age}岁（${ageTierDesc}）` : `【被测者】${age}岁（${ageTierDesc}）`;

  // 去重：selectedIssues 若包含已在 requiredModules 里的模块，跳过（否则 AI 会生成两遍同一板块）
  const requiredSet = new Set(requiredModules);
  const dedupedIssues = selectedIssues.filter(m => !requiredSet.has(m));
  const allModules = [...requiredModules, ...dedupedIssues];

  // 检测是否有兴趣班/职业相关板块
  const has兴趣班 = allModules.some(m => 兴趣班板块Names.has(m));
  // 预计算兴趣班提示（RULE-F04已修正数据 + 官方映射 + 写作规范）
  const 兴趣班提示 = (has兴趣班 && fingers) ? build兴趣班Prompt(fingers, engineResult, tier) : '';

  // ⚠️ 同源一致：可选问题里的职业/能力类只能延伸必给模块2的结论，不得重新判断高低
  // 用 dedupedIssues（已去掉与必给重复项），避免 AI 收到冗余格式指令
  const issueFormatGuide = dedupedIssues.length > 0
    ? `\n【问题模块格式（每个 issue 严格四段式）】\n` + dedupedIssues.map(issue => {
        if (兴趣班板块Names.has(issue)) {
          // 职业/能力类延伸问题：必须在必给模块2结论基础上展开，禁止重新判断高低
          return `===issue:${issue}===
⚠️ 此板块是上方「${requiredModules[1]}」的延伸决策——直接基于其已给出的能力结论，聚焦「${issue}」这个具体问题，禁止重新做高低判断，数据用上方 RULE-F04 已修正结果。
①为什么：（在「${requiredModules[1]}」结论基础上，点明此决策的关键数据依据，1-2句）
②怎么办：（针对"${issue}"给出3-4条具体可选路径，引用官方职业/方向映射，今天就能落地）
③未来趋势：（这个方向的长期价值，1-2句）
④还想深聊：（一句话邀请，指向最有价值的下一个追问）`;
        }
        return `===issue:${issue}===\n①为什么（基于具体手指/类型的根本原因，2-3句）\n②怎么办（明天就能做的具体动作，2-4条）\n③未来趋势（这个特质在未来值不值钱，2句）\n④还想深聊？（一句话邀请，指出最有价值的追问方向）`;
      }).join('\n\n')
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
${兴趣班提示}
【需要生成的板块】（按顺序）
${allModules.map((m,i)=>`${i+1}. ${m}`).join('\n')}

【必给板块格式】每个必给板块用 ===板块名=== 开头，正文2-3段，具体有比喻，"被说中"型。
⚠️ 同源一致（00i 规则2）：凡涉及职业/能力/兴趣班的必给板块（如「${requiredModules[1]}」），同样严格基于上方 RULE-F04 已修正判定展开，不另行重算高低；后续可选延伸问题将在此结论基础上深化，必须保持一致。

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

// ── 报告存储处理器（merged from report-store.js）─────────────────────────────
async function checkStoreRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:rptstore:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 10) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

async function handleReportStore(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  if (req.method === 'POST') {
    const allowed = await checkStoreRate(ip).catch(() => true);
    if (!allowed) return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });

    const MAX_BODY = 500 * 1024;
    let body;
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = ''; let bytes = 0;
        req.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_BODY) { reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 })); req.destroy(); }
          else data += chunk;
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = JSON.parse(raw);
    } catch(e) {
      const code = e.code === 413 ? 413 : 400;
      return res.status(code).json({ ok: false, error: code === 413 ? '报告数据过大' : '请求体格式错误' });
    }

    const { sections, engineResult, fingers, name, age } = body;
    if (!sections?.length || !engineResult) return res.status(400).json({ ok: false, error: '缺少 sections 或 engineResult' });

    const id = crypto.randomBytes(4).toString('hex');
    const ageNum = age ? Number(age) || null : null;
    const nameStr = name ? String(name).slice(0, 40) : null;
    // 完整报告：TTL 1年（原30天）
    await redisSet(`report:${id}`, { sections, engineResult, fingers: fingers || [], name: nameStr, age: ageNum, createdAt: Date.now(), ip }, 365 * 86400);
    // 案例库索引：只存摘要（不含完整 sections，节省空间）
    pushCaseIndex({
      id,
      type:     engineResult?.主性格类型 || null,
      key:      engineResult?.key || null,
      age:      ageNum,
      name:     nameStr,
      channel:  engineResult?.学习通道?.主通道 || null,
      brain:    engineResult?.左右脑?.结论 || null,
      mType:    engineResult?.叠加特质?.M型 || false,
      plusR:    engineResult?.叠加特质?.逆向思维R || false,
      ip,
      createdAt: Date.now(),
    });
    return res.status(200).json({ ok: true, id });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const id  = url.searchParams.get('id');
    if (!id) return res.status(400).json({ ok: false, error: '缺少 id 参数' });
    const report = await redisGet(`report:${id}`).catch(() => null);
    if (!report) return res.status(404).json({ ok: false, error: '报告不存在或已过期（30天）' });
    return res.status(200).json({ ok: true, report });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}

// ── 主 Handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // 路由分发：/api/report-store → handleReportStore
  const urlPath = req.url ? req.url.split('?')[0] : '';
  if (urlPath === '/api/report-store') return handleReportStore(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const vipToken = req.headers['x-vip-token'] || '';
  const vipPass = await isVipToken(vipToken).catch(() => false);
  if (!vipPass) {
    const allowed = await checkRate(ip).catch(() => true);
    if (!allowed) return res.status(429).json({ ok:false, error:'请求过于频繁，请稍后再试' });
    const quotaOk = await checkDailyQuota(ip).catch(() => true);
    if (!quotaOk) return res.status(200).json({ ok:false, soft:true, error: SOFT_LIMIT_MSG });
  }

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

  const { engineResult, age, name, selectedIssues = [], refToken = null, fingers = null } = payload;
  if (!engineResult) return res.status(400).json({ ok:false, error:'缺少 engineResult' });

  // 邀请积分（异步，不阻塞主流程）
  if (refToken) creditReferral(ip, refToken, 'report').catch(() => {});

  const tier          = getAgeTier(age);
  const requiredMods  = REQUIRED_BY_STAGE[tier] || REQUIRED_BY_STAGE.adult;
  const userMessage   = buildUserMessage(engineResult, age, name, requiredMods, selectedIssues, fingers, tier);

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
