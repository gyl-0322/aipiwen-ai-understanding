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
const { redisGet, redisSet, creditReferral, callClaude, MODEL_DEEP, MODEL_FREE, getOpenid } = require('./_lib');

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
    subject:'综合实践/项目学习（目标感强、喜欢主导，项目型题目最发光）',
    hobby:'活动发起人、团队领导、自定目标挑战',
    career:'创始人/董事长/投资人/号召型讲师/激励讲师', major:'创业/领导力/号召力' },
  { ability:'管理力', pos:'L1', finger:'左拇（对内目标·自我管理·执行协调）',
    subject:'数学/语文（执行条理强，书面整理型科目顺势，做事有计划感）',
    hobby:'写日记/作总结、管理零花钱、计划规划',
    career:'总经理/CEO/中层干部/项目执行者', major:'营销/电商/物流/安保管理' },
  { ability:'推理力', pos:'R2', finger:'右食（逻辑语言·数理）',
    subject:'数学/理科（逻辑推理、数理运算天赋区，推理类题目吃香）',
    hobby:'数学/魔方/棋类/推理故事',
    career:'会计金融/工程师/软件编程/数学家', major:'财务/计算机/工程师' },
  { ability:'心像力', pos:'L2', finger:'左食（创意构思·空间想象）',
    subject:'几何/创意构思（空间想象力，数学几何+创意艺术类顺势）',
    hobby:'创意美术/制作/灵感点子',
    career:'策划/广告/创新发明者', major:'策划广告/创意设计/表演' },
  { ability:'操控力', pos:'R3', finger:'右中（小肌肉精细灵活）',
    subject:'手工/精细操作（精细动作天赋，手工课+科学实验操作最顺）',
    hobby:'串珠/做饭/精细手工/整理收纳',
    career:'工匠/手艺人/精密操作/医疗/维修', major:'操作/制作/维修/驾驶/医学/厨师' },
  { ability:'律动力', pos:'L3', finger:'左中（大肌肉律动协调）',
    subject:'体育（大运动协调，运动/舞蹈/律动类课程顺势）',
    hobby:'舞蹈/户外运动/模特/体育竞技',
    career:'舞蹈演员/体育教练/话剧/鉴赏师/模特', major:'舞蹈/表演/体育/鉴赏' },
  { ability:'语言力', pos:'R4', finger:'右无名（语言表达·记忆理解）',
    subject:'语文/英语（语言表达+记忆天赋区，作文/阅读/口语/背诵最先开窍）',
    hobby:'阅读朗读/讲故事/背诵/口才演讲',
    career:'记者/翻译/咨询师/培训讲师/信息收集', major:'教育/传媒/家政/乘务/导游' },
  { ability:'音受力', pos:'L4', finger:'左无名（音感·共鸣·感动）',
    subject:'音乐/英语听力（音感+共鸣，音乐课+英语听说口语天赋兑现区）',
    hobby:'唱歌/乐器/诗歌朗诵/音乐欣赏',
    career:'歌手/作曲/乐器演奏/主持人/情感分析师', major:'表演/主持人/音乐/客服' },
  { ability:'观察力', pos:'R5', finger:'右小（辨识·分类·细节专注）',
    subject:'科学/自然（观察分类能力，自然探索+实验记录顺势）',
    hobby:'找不同/捉迷藏/自然观察/植物动物',
    career:'纠察督导/刑侦/校对/督导/检验', major:'物流/安保/流水线/医学' },
  { ability:'图像力', pos:'L5', finger:'左小（图像审美·直觉感知）',
    subject:'美术/视觉艺术（色彩审美+图像感知，美术课和视觉类创作顺势）',
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
  const isPreschool = tier === 'preschool';                             // 0–6  兴趣启蒙
  const isSchool    = tier === 'school';                                 // 7–12 学科潜能（00k）
  const isTeen      = tier === 'junior_teen' || tier === 'senior_teen'; // 13–18 选科升学
  // young_adult / adult / mature_adult → 职业方向（00d）

  const tableStr = rows.map(r => {
    const mark = r.level === '高' ? '★顺势' : r.level === '低' ? '△补短' : '—';
    let line = `  · ${r.ability}[${r.pos}·${r.finger.replace(/[（）]/g,'')}]：${r.raw}分 差${r.sign}${r.diff}→${mark}`;
    if (r.pc && r.level !== '高') line += ' ⚠️孔雀眼纹型(纹型天才型，但数值未达高—待栽培潜力，≠当下能力高)';
    return line;
  }).join('\n');

  const hiRows  = rows.filter(r => r.level === '高');
  const midRows = rows.filter(r => r.level === '中');
  const loRows  = rows.filter(r => r.level === '低');

  let mapStr;
  if (isPreschool) {
    // 0–6 兴趣启蒙：启蒙玩法，无学科、无职业
    mapStr = hiRows.map(r => `  · ${r.ability}→ 启蒙玩法：${r.hobby}`).join('\n')
          || '  (暂无高分区，从中分区选2–3项顺势活动)';
  } else if (isSchool) {
    // 7–12 学科潜能（00k）：三层（高/中/低）× 学科 + 兴趣班
    mapStr = [
      hiRows.length
        ? `★顺势（高）：\n` + hiRows.map(r => `  · ${r.ability}→ 学科：${r.subject}｜兴趣班：${r.hobby}`).join('\n')
        : `★顺势：(暂无高分区，从中分区选最接近均值的2–3项推荐)`,
      midRows.length ? `→中等（顺其自然）：\n` + midRows.map(r => `  · ${r.ability}→ 学科：${r.subject}`).join('\n') : '',
      loRows.length  ? `△短板（别压名次）：\n`  + loRows.map(r => `  · ${r.ability}→ 学科：${r.subject}`).join('\n')  : '',
    ].filter(Boolean).join('\n');
  } else if (isTeen) {
    // 13–18 选科升学：高中选科 + 大学专业方向 + 兴趣特长（不点成人职位）
    mapStr = hiRows.map(r =>
      `  · ${r.ability}→ 高中选科：${r.subject}｜大学专业方向：${r.major}｜兴趣特长：${r.hobby}`
    ).join('\n') || '  (暂无高分区，从中分区选最接近均值的2–3项推荐)';
  } else {
    // 19+ 职业方向（00d）：完整职业映射
    mapStr = hiRows.map(r =>
      `  · ${r.ability}→ 兴趣班：${r.hobby}｜职业：${r.career}｜专业：${r.major}`
    ).join('\n') || '  (当前无高分区，按中分区找出最接近均值的2–3项顺势推荐)';
  }

  return `
【⚙️ RULE-F04已修正·十大能力判定（直接使用，不要重新判断高低）】
个人均值=${avg}（总TRC${total}÷10）
${tableStr}
★顺势天赋（数值高）：${shunshi.length ? shunshi.join('、') : '暂无明显高值'}
△补短区（数值低）：${buDuan.length  ? buDuan.join('、') : '无明显低值'}
${peacock.length ? `⚠️孔雀眼纹型待栽培（数值中上但纹型顶配，报告里要把"纹型好"和"能力高"分开说）：${peacock.join('、')}` : ''}

RULE-N14兴趣班数量：${n14.note}

【官方${isPreschool ? '启蒙玩法' : isSchool ? '学科+兴趣班' : isTeen ? '选科/专业+兴趣特长' : '职业/兴趣班'}映射（来源：中级研修，勿用旧"近似"版）】
${mapStr}

${isPreschool
  ? `【兴趣启蒙与潜能·写作规范（0–6段·家长视角·六段emoji）】
全程"给家长说话"：用"这孩子""她/他"第三人称，不对孩子直接说话。
板块整体在 ===板块名=== 内，内部六段 emoji 小标题（不用 ===，不用①②③④）：

🌱 天赋信号（2–3句：测什么→数据特点→这是什么类型的宝宝）
  说出最活跃的感官/脑区/纹型；孔雀眼等天才型说"成长潜力顶配，需时间栽培"≠当下就强；
  1句话画出"这是一个什么类型的孩子"（靠眼/靠耳/靠身体/靠直觉……）；

🎨 启蒙方向（顺势活动${n14.range}项 + 补短体验，分开写，不混）
  顺势活动：按顺势映射，给${n14.range}个具体玩法/活动名 + 1句为什么顺（对应哪个天赋）；
  补短体验（可选）：短板区活动，说"可以接触，以开心为目的，不求表现"；

🔭 潜力方向（只轻点，不下结论）
  1句说这孩子未来偏向哪个大类（探索/表达/动手/人际等）；
  明确说"6岁前最重要的是保护好奇心，方向不需要现在定"；

🧬 怎么陪最省力（性格类型×学习通道×ATD×行为，2–3条）
  每条格式：XX×XX → 陪伴方式推论（1–2句，家长今天就能用）；
  点出1个"这年龄段家长最容易踩的坑"（催/强迫/比较）；

🧭 生活化说明（1条）
  用一个家长听得懂的生活比喻，把主通道和当前行为联系起来，再给1条今天能用的陪伴动作；

💡 一句话给家长（▸ 格式）
  ▸ 一句话说清"这孩子的能量频道"：顺着什么方向陪，她/他最开心最活跃。`
: isSchool
  ? `【学科潜能与兴趣特长·写作规范（金标准 00k·7–12段·家长视角·六段emoji）】
全程"给家长说话"：用"这孩子""她/他"第三人称，不要直接对孩子讲话。
板块整体在 ===板块名=== 内，内部六段 emoji 小标题（不用 ===，不用①②③④）：

🎓 学科潜能（核心段，三句话原则：测什么→数据特点→怎么用）
  第1–2句：说"测什么"+"数据特点"（最亮能力/哪指/纹型/数值；孔雀眼天才型说"待栽培潜力"≠当下就强）；
  第3句"怎么用"展开三层（每层用 · 列）：
  · 顺势学科（重点托举）：高分能力对应学科名 + 1句为什么顺；
  · 中等（顺其自然）：中位能力对应学科，说"够用，顺其自然即可"；
  · 短板学科（别压名次）：低分能力对应学科，说"可学要达标，但别拿名次苛责"；

🎨 兴趣特长（顺势深耕${n14.range}项 + 补短体验，分开写，不混）
  顺势深耕：给${n14.range}个具体兴趣班名 + 1句为什么适合（对应哪个天赋）；
  补短体验（可选）：短板区兴趣班，说"目的是补全体验，不求考级出成绩"；

🔭 远期倾向（单独短段，只轻点不下结论）
  1–2句说这组天赋偏向哪个大方向（理工/表达/艺术/探索等大类）；
  明确说"小学阶段不必定死职业，把这股劲保护好就够了"；
  ⚠️禁止出现具体成人职业名（创始人/投资人/工程师/CEO 等）；

🧬 怎么学最省力（性格类型×学习通道×ATD×行为，写2–3条）
  每条格式：XX×XX → 学习方式推论（1–2句，着重"家长怎么配合"）；
  必须点出1个卡点/矛盾，给出保护天赋不被掐断的叮嘱；

🧭 生活化说明（1条）
  用一个家长听得懂的生活比喻，把主学习通道和孩子现实表现联系起来，再给1条家长今天能用的动作；

💡 一句话给家长（▸ 格式）
  ▸ 一句话说清"这孩子的牌面"：押注在哪最顺 + 哪几科别拿名次苛责。`
: isTeen
  ? `【选科与升学/专业方向·写作规范（13–18段·六段emoji）】
板块整体在 ===板块名=== 内，内部六段 emoji 小标题（不用 ===，不用①②③④）：

🎯 天赋赛道（三句话原则：测什么→数据特点→选科怎么用）
  第1–2句：说最亮能力/纹型/数值；孔雀眼天才型说"待栽培潜力"≠当下就强；
  第3句：聚焦"高中哪科顺势、选科怎么省力"；

📚 选科建议（顺势优先，分开写）
  顺势科目：高分能力→具体高中选科组合（物化生/史地政/技术等）+ 1句为什么顺；
  注意科目：低分能力对应的科目，说"不是不能选，但要多花精力才能稳"；
  TRC总量参考：${n14.note}；

🎓 专业/大学方向（只到专业大类，不推具体岗位）
  按顺势能力，给大学专业方向（理工/人文/艺术/社科等大类），每条1–2句；
  末尾给"组合落点"：能力交叉后最适合的1–2个专业大类；
  ⚠️ 不推具体成人职业名，只到"专业方向/行业大类"层级；

🧬 交叉解读（性格类型×学习通道×ATD×行为，2–3条）
  聚焦"如何备考/学习效率最高"；
  点出1个卡点（拖延/厌学/压力等的天赋根因），给出破局建议；

🧭 生活化说明（1条）
  用一个学生和家长都听得懂的比喻，把主通道和当前学习状态联系起来，再给1条高中学习能用的动作；

💡 一句话（▸ 格式，可对本人说）
  ▸ 一句话说清"你的天赋牌面"：选科顺势押在哪 + 哪科别死磕名次。`
  : `【兴趣班/职业板块·写作规范（金标准 00d·19+段·六段emoji）】
板块整体在 ===板块名=== 内，内部六段 emoji 小标题（不用 ===，不用①②③④）：

🎯 天赋赛道（2–3句，三句话原则：测什么→数据特点→怎么用）
  第1句：说"测什么"（哪根手指/哪个脑区/纹型）；
  第2句：说"数据特点"（数值结论 + 纹型潜力分开说——数值高=当下硬优势；孔雀眼等天才型=待栽培潜力，≠当下能力高）；
  第3句："怎么用"一句话定位（这个人的主航道）；

🎨 兴趣班建议（顺势与补短必须分段，绝不混）
  【顺势·天赋方向（重点投入）】推荐${n14.range}个具体兴趣班方向，每条：项目名 + 1句为什么适合（对应数据）；
  【补短·短板体验（可选）】短板区对应班/方向单独一段，明确说：可作兴趣体验，不建议以名次/出成绩为目标——否则易受挫；

💼 职业/专业方向（官方映射，仅写顺势高分能力）
  每条格式：能力→具体职业→专业方向；
  末尾写"组合落点"：顺势能力交叉后最适合的2–3个交集职业（一句话说明交集理由）；

🧬 交叉解读画像（性格类型×学习通道×ATD×行为，写2–3条）
  每条格式：XX×XX → 组合推论 + 用途（1–2句）；
  必须点出1个关键卡点/矛盾（性格与通道/ATD之间的张力）；

🧭 生活化说明（1条）
  用一个成年人听得懂的生活比喻，把主学习通道和当前身份/职业状态联系起来，再给1条落地动作；

💡 一句话应用（▸ 格式，给本人今天就能用）
  ▸ 一句话说清"你的牌面"：押注在哪最顺 + 什么不是TA的赛道（别浪费力气的方向）。`
}
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
  // Beta 宽松上限：每 IP 每分钟最多 10 次（report 比 chat 低频，10次已很宽松）
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:genrpt:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 10) return false;
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

// ── 必给模块（固定骨架）──────────────────────────────────────────────
// 所有上传报告必须先给完整结构，再回答用户选择的问题；AI 只能填内容，不能删减或改顺序。
const CORE_REQUIRED_MODULES = [
  'TRC（认知结构）',
  'ATD（感受/反应节奏）',
  '左右脑（信息处理风格）',
  '性格类型（核心行为外显模块）',
  '学习通道（学习输入系统）',
  '行为模式（行为解释系统）',
  '五大功能区（能力结构系统）',
];

// 兼容旧变量名：页面/API 结构不变，只把各年龄段必给模块统一为 7 大固定骨架。
const REQUIRED_BY_STAGE = {
  preschool:    CORE_REQUIRED_MODULES,
  school:       CORE_REQUIRED_MODULES,
  junior_teen:  CORE_REQUIRED_MODULES,
  senior_teen:  CORE_REQUIRED_MODULES,
  young_adult:  CORE_REQUIRED_MODULES,
  adult:        CORE_REQUIRED_MODULES,
  mature_adult: CORE_REQUIRED_MODULES,
};

// ── 系统提示词（AIPIWEN 解读语气底座） ─────────────────────────────────
const SYSTEM_PROMPT = `你是 AIPIWEN 天赋底色解读 AI，拥有完整的皮纹科学知识体系。

【声音标准·沐海星辰（唯一标尺，来源 00i 第二部分）】
每条解读必须拴在具体手指/脑区/数值上，但先看见人，再给数据：
1. 先"看见你"再解释：开头是共情/画像（"你身上有股劲…""你那个XX，其实是…"），不是先甩数值或标签。
2. 温、亲密、第二人称：像懂你的人轻声说话，不评判、不说教。
3. 把困惑/缺点翻译成"被保护的底色"：用情感去翻（"你的敏感不是脆弱，是你比别人早半拍接住了情绪"），不是用分析去列。
4. 比喻自由、生动地流动（导航仪/海绵/雷达…），让画面立起来——叠加、不要工整分点。
5. 结尾给一件明天能做的具体小事，柔和地落（天赋底色豁免，以定心气的句子收即可）。
禁止：套话模板 / 打分排名 / 贩卖焦虑 / "X是那种…+A+B+C配置"公式句 / 统一标准

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

【分量与丰富度（来源：00i §6）】
- 天赋底色/地基段：2–3段，把主类型×通道×ATD×行为揉成"一个活人"，不逐条念数据。
- 每个必给板块：多段展开、举生活场景，用户读完要觉得"内容很满、被认真对待了"。
- 勾选问题三段式：每段写实写满——"怎么应对"给2–3个具体动作说清怎么做，"积极意义"把那束"光"讲到位。
- ⚠️ 多≠注水：每句话有信息增量，不堆形容词。

【文风分寸（替代旧"三条红线"，不是硬规则）】
- 比喻自由用，别在一段里堆到喧宾夺主（大致2–3个意象内）。
- 开头可以是共情/画像，不必是干巴巴的数值结论——但别把人话结论埋到段尾。
- 给一件明天能做的具体事，融进话里即可，不必硬拆成bullet。
- 数值高低≠纹型质量；映射按右拇=开创力。

【★禁止临床诊断框架出页（来源：19 §六 + 00a 第9条）】
- 任何一页禁止出现：DSM / DSM-IV / ADHD / 多动症 / 注意力缺陷 / 任何临床诊断量表名称
- "好动/坐不住/专注力短"→改写为神经气质/感统中性表达，如"高能量、感官灵敏、坐不住往往是没被喂饱，不是毛病"
- 遇疑似情况→走guardrail转介专业评估，绝不用皮纹下临床诊断

【生活化整合表达】
- 每讲一个核心特质，配一个用户听得懂的生活比喻，让数据回到真实行为里；比喻后接 ▸ 一条能马上使用的动作。
- 写学习/工作相关板块时，尽量讲清三件事：怎么学最快、怎么舒压、怎么沟通最有效，不能只讲单一维度。
- 综合/交叉画像段不要罗列数据，要把类型、通道、ATD、行为和当前场景层层叠加，让用户看到"这说的是我"。
- 数据与用户现实（职业/人生阶段/家庭身份）吻合时，可以温和点出，但不要暴露任何内部来源或流派名称。
- 精神功能偏低者容易低估自己，要主动点出其他优势，不让TA自我否定。

【★术语约束——必须严格遵守，不得违反】
- 性格主类型只能使用引擎字段「主性格类型」的原文（认知型 / 整合型 / 完美型 / 模仿型 / 逆思型 / 开放型 / 超级认知型A / 超级认知型B / 超级认知型C / 超级模仿型 / 各"兼型"如"认知兼开放型"）。
- 禁止用纹型名称（螺旋斗型 / 靶心斗型 / 双斗型 / 孔雀眼型 / 正箕型 / 反箕型 / 弧型 等）代替性格主类型名。纹型名只能出现在"这根手指是螺旋斗纹型"这类数据说明句，不能当"你是XX型人"的类型标签。
- 错误示例（禁止）："你是螺旋斗型，…" / "作为靶心斗型人…"
- 正确示例（必须）："你是认知型，…" / "作为整合型，…"

【输出规则】
- 返回纯文本，用 ===标题=== 分隔每个板块
- 必给板块必须严格按指定 7 个标题输出，不允许删除、合并、改名、调序
- 每个必给板块内部必须固定三段：①是什么 ②对当前用户意味着什么 ③怎么应用到学习/行为/沟通
- issue 板块内部用 ①为什么会这样 ②怎么应对 ③积极意义 标记三段
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
    ? `\n【问题模块格式（每个 issue 严格三段式）】\n` + dedupedIssues.map(issue => {
        if (兴趣班板块Names.has(issue)) {
          // 职业/能力类延伸问题：必须在必给模块2结论基础上展开，禁止重新判断高低
          return `===issue:${issue}===
⚠️ 此板块是上方「五大功能区（能力结构系统）」与「TRC（认知结构）」的延伸决策——直接基于已给出的能力结构，聚焦「${issue}」这个具体问题，禁止重新做高低判断，数据用上方 RULE-F04 已修正结果。
①为什么会这样：（在能力结构结论基础上，点明此决策的关键数据依据，1-2句）
②怎么办：（针对"${issue}"给出3-4条具体可选路径，引用官方职业/方向映射，今天就能落地）
③积极意义：（这个方向的长期价值和潜在优势，1-2句）`;
        }
        return `===issue:${issue}===\n①为什么会这样（机制解释，基于具体手指/类型/通道/ATD，2-3句）\n②怎么应对（可执行动作，明天就能做，2-4条）\n③积极意义（潜力/优势，让用户看到这不是问题本身，2句）`;
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
【需要生成的板块】（按顺序，前7个是固定骨架，不可删除/合并/调序）
${allModules.map((m,i)=>`${i+1}. ${m}`).join('\n')}

【固定骨架强约束】
必须依次输出以下7个模块，标题必须完全一致：
${requiredModules.map((m,i)=>`${i+1}. ===${m}===`).join('\n')}

每个固定模块必须三段式：
①是什么：用用户听得懂的话解释这个指标/系统是什么，可以举生活例子。
②对你意味着什么：结合当前用户数据，和个人均值或区间对比，讲高/低/均衡的优势、代价和理解方式，禁止只讲理论。
③怎么应用：讲这些特征如何应用到学习、行为、沟通；如何理解、接纳、和解、和谐共生。

【重点模块加厚】
- ===性格类型（核心行为外显模块）=== 必须最详细：定义、典型特征、行为表现、真实生活场景、对学习和关系的影响都要写，让用户有代入感。
- ===TRC（认知结构）=== 必须讲清 TRC 高低代表容量差异，并结合当前用户表现与学习方式。
- ===左右脑（信息处理风格）=== 必须讲清左右脑差异代表敏感度/处理风格，说明当前偏向对行为和决策的影响。
- ===ATD（感受/反应节奏）=== 必须讲清不同区间代表反应速度/节奏差异，并说明对学习方式的影响。
- ===五大功能区（能力结构系统）=== 必须结合精神/思维/体觉/听觉/视觉相对个人均值，讲强势区、发展区和使用方式。

⚠️ 同源一致（00i 规则2）：凡涉及职业/能力/兴趣班的内容，严格基于上方 RULE-F04 已修正判定展开，不另行重算高低；后续可选延伸问题将在此结论基础上深化，必须保持一致。

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
      // 三段式拆分（兼容旧版④CTA，但前端只展示前三段）
      const parts = { why:'', how:'', future:'', cta:'' };
      const whyM    = body.match(/①\s*(?:为什么|Why)?(?:[（(][^）)]*[）)])?[：:]?\s*([\s\S]*?)(?=②|$)/i);
      const howM    = body.match(/②\s*(?:怎么办|How)?(?:[（(][^）)]*[）)])?[：:]?\s*([\s\S]*?)(?=③|$)/i);
      const futureM = body.match(/③\s*(?:积极意义|未来趋势|未来|Future)?(?:[（(][^）)]*[）)])?[：:]?\s*([\s\S]*?)(?=④|$)/i);
      const ctaM    = body.match(/④\s*(?:还想深聊|还想聊|深聊|CTA)?[？?:：]?\s*([\s\S]*?)$/i);

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

function coreModuleFallback(title, engineResult) {
  const fp = engineResult?.['五功能区'] || {};
  const chan = engineResult?.['学习通道'] || {};
  const behav = engineResult?.['行为模式'] || {};
  const brain = engineResult?.['左右脑'] || {};
  const atd = engineResult?.['ATD'] || {};
  const type = engineResult?.['主性格类型'] || '当前类型';
  const avg = fp['个人均值'] || '当前均值';
  const total = fp['总TRC'] || '当前总量';

  const lines = {
    'TRC（认知结构）': [
      `①是什么：TRC可以理解为大脑可调用的信息容量和任务承载空间。它不是聪明不聪明的判断，而是一个人处理信息、承接任务、消化学习内容时，先天更容易呈现出的容量感。`,
      `②对你意味着什么：当前总TRC为${total}，个人均值为${avg}。高于个人均值的区域更像顺手工具，低于个人均值的区域更像需要节奏和方法支持的地方；理解它，是为了知道哪些事可以顺势用力，哪些事不要硬扛。`,
      `③怎么应用：学习或工作中，先把任务拆成能承接的小块，再根据强势区安排输入方式和练习方式；沟通时也可以少一点“你怎么做不到”，多一点“我们换一种承接方式”。`
    ],
    'ATD（感受/反应节奏）': [
      `①是什么：ATD可以理解为一个人接收刺激、产生反应和进入状态的节奏。它更接近“速度感”和“敏感度”，不是好坏分数。`,
      `②对你意味着什么：当前ATD为${atd['值'] || '未识别'}，处于${atd['分区'] || '待确认'}。节奏偏快时容易反应灵敏、先感觉到变化，也可能急；节奏偏慢时更稳、更能沉住气，也可能需要更多启动时间。`,
      `③怎么应用：学习和沟通时，不要只催结果，要给出清楚边界、启动信号和缓冲时间；当节奏被看懂，反应就更容易变成配合，而不是对抗。`
    ],
    '左右脑（信息处理风格）': [
      `①是什么：左右脑代表信息处理风格的偏向。左脑更偏语言、逻辑、目标和规则，右脑更偏画面、感受、关系和整体直觉。`,
      `②对你意味着什么：当前左右脑表现为${brain['结论'] || '相对均衡'}，左脑占比${brain['左脑占比'] || '未识别'}%。偏左时更需要逻辑和步骤，偏右时更需要画面、情境和感受连接；均衡时则要看具体任务调动哪一边。`,
      `③怎么应用：学习上可以把抽象内容转成步骤或图像；沟通上先用对方听得懂的方式进入，再谈要求，决策时也允许自己既看事实，也看身体和情绪给出的提醒。`
    ],
    '性格类型（核心行为外显模块）': [
      `①是什么：${type}是当前最核心的行为外显底色。它不是给人贴标签，而是在说明一个人遇到任务、关系和压力时，最容易先调用哪套反应方式。`,
      `②对你意味着什么：这个类型会影响你如何开始一件事、如何确认安全感、如何学习、如何表达需要，也会影响你在关系里是先观察、先行动、先配合，还是先建立自己的判断。优势用对了会成为稳定能力，用急了也可能变成卡点。`,
      `③怎么应用：学习上要顺着这个类型安排输入和反馈；关系里要先承认它的保护意义，再调整表达方式。真正的改变不是压掉底色，而是让底色被理解后，长出更成熟、更柔和的使用方法。`
    ],
    '学习通道（学习输入系统）': [
      `①是什么：学习通道指信息最容易从哪里进入大脑，是听、看、动手、画面、语言或身体体验等输入方式的偏好。`,
      `②对你意味着什么：当前主通道为${chan['主通道'] || '待确认'}。主通道强，代表这种输入方式更省力；非主通道并不是不能学，而是需要转换成更适合自己的入口。`,
      `③怎么应用：学习新内容时，先用主通道建立理解，再用其他通道补充巩固。沟通时也一样，不是讲更多就有效，而是换成对方真正接得住的方式。`
    ],
    '行为模式（行为解释系统）': [
      `①是什么：行为模式解释的是一个人更容易被情绪、任务、目标、规则还是身体节奏带动。它帮助我们把“表现”翻译成背后的运行方式。`,
      `②对你意味着什么：当前行为模式为${behav['结论'] || '待确认'}。这说明某些行为不是单纯听不听话、努不努力，而可能是启动方式、压力承接方式或反馈节奏不匹配。`,
      `③怎么应用：遇到卡住时，先看行为背后的需求，再给方法。学习上减少空泛催促，沟通上把要求说清楚、把步骤拆开、把反馈放近，行为才更容易回到合作。`
    ],
    '五大功能区（能力结构系统）': [
      `①是什么：五大功能区包括精神、思维、体觉、听觉、视觉，是能力结构的五个入口。它们不是排名，而是说明不同能力在当前结构里谁更顺手、谁更需要支持。`,
      `②对你意味着什么：当前精神${fp['精神'] || '—'}、思维${fp['思维'] || '—'}、体觉${fp['体觉'] || '—'}、听觉${fp['听觉'] || '—'}、视觉${fp['视觉'] || '—'}，个人均值${avg}。高于均值的区域更容易成为优势，低于均值的区域需要更温和的训练和更清楚的环境支持。`,
      `③怎么应用：学习、沟通和行动安排都可以围绕强势区启动，再带动发展区。这样不是逃避短板，而是先从顺手的地方建立成功经验，再让不顺手的地方慢慢跟上。`
    ],
  };

  return (lines[title] || [
    `①是什么：这个模块用于帮助你理解当前资料中呈现出的一个重要特征。`,
    `②对你意味着什么：它需要结合具体数值、年龄阶段和现实场景来看，不能孤立地下结论。`,
    `③怎么应用：先把它当作理解自己和沟通方式的线索，再用低风险的小动作慢慢调整。`,
  ]).join('\n\n');
}

function normalizeSections(sections, requiredModules, selectedIssues, engineResult) {
  const byTitle = new Map();
  for (const sec of sections) {
    if (!sec?.title || byTitle.has(sec.title)) continue;
    byTitle.set(sec.title, sec);
  }

  const normalized = requiredModules.map(title => {
    const sec = byTitle.get(title);
    const content = (sec?.content || '').trim();
    return {
      title,
      type: title === '性格类型（核心行为外显模块）' ? 'foundation' : 'required',
      content: content || coreModuleFallback(title, engineResult),
    };
  });

  for (const sec of sections) {
    if (!sec?.title || requiredModules.includes(sec.title)) continue;
    if (sec.type !== 'issue') continue;
    normalized.push(sec);
  }

  return normalized;
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

    // ── 解锁鉴权（PAYMENT_ENABLED=true 时才启用）────────────────────────────
    const paymentEnabled = process.env.PAYMENT_ENABLED === 'true';
    if (paymentEnabled) {
      const openid = getOpenid(req);
      if (!openid) {
        return res.status(401).json({ ok: false, error: '请先登录后查看完整报告', needLogin: true });
      }
      const unlocked = (await redisGet(`unlock_events:${openid}`).catch(() => null)) || [];
      const ids = Array.isArray(unlocked) ? unlocked : Object.keys(unlocked);
      if (!ids.includes(id)) {
        return res.status(402).json({ ok: false, error: '该报告需解锁后查看', needUnlock: true, reportId: id });
      }
    }

    const report = await redisGet(`report:${id}`).catch(() => null);
    if (!report) return res.status(404).json({ ok: false, error: '报告不存在或已过期' });
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

  // ── DashScope 报告生成（qwen-plus 单次调用，无 fallback）──────────────
  // ⚠️ 不使用 qwen-vl-max：视觉模型对文字报告过慢，会超 Vercel 60s 限制 → 504
  // qwen-plus 文字生成（5–15s），timeoutMs=55s，Vercel 60s 内安全完成
  // 不设 fallback：55s 仍超时说明 DashScope 本身过载，turbo 质量不够用于完整报告
  let raw = null;

  // 把错误详情写入 Redis，方便 admin 面板诊断（key=lastErr:genrpt，TTL 1天）
  async function logErr(label, err) {
    const detail = {
      label, msg: err?.message || String(err),
      status: err?.status || null,
      body:   err?.body   || null,
      ts: new Date().toISOString(),
    };
    console.error('[gen-report]', label, detail.msg, detail.status || '', detail.body || '');
    await redisSet('lastErr:genrpt', detail, 86400).catch(() => {});
    return detail;
  }

  // qwen-plus 主力（文字报告，无图片，IAD1→阿里云跨境约35-50s生成完整核心模块）
  // timeoutMs=55s：Vercel 60s 限制内留 5s 余量；maxTokens=2800 覆盖7个必给模块
  // 不设 fallback：55s 内 qwen-plus 仍超时说明 DashScope 本身过载，turbo 质量不够用
  try {
    const { text } = await callClaude({
      model:     MODEL_FREE,       // qwen-plus
      messages,
      maxTokens: 2800,
      timeoutMs: 55000,
    });
    raw = text;
  } catch (err1) {
    const d = await logErr('primary_fail', err1);
    const code = err1?.status ? `DS${err1.status}` : (err1?.name || 'ERR');
    return res.status(200).json({ ok:false, error:`AI 请求失败 [${code}]，请重试` });
  }

  if (!raw) {
    console.error('[gen-report] empty reply after both attempts');
    return res.status(200).json({ ok:false, error:'AI 未返回内容，请重试' });
  }

  const parsedSections = parseSections(raw, requiredMods, selectedIssues);
  const sections = normalizeSections(parsedSections, requiredMods, selectedIssues, engineResult);

  return res.status(200).json({ ok:true, sections, raw, requiredModules: requiredMods });
};
