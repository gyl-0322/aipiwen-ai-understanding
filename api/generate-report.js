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
const { searchReportKnowledge, buildReportGroundingBlock } = require('../lib/report-knowledge-index');

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

function buildReportKnowledgeQuery(engineResult, age, selectedIssues, fingers) {
  const fp = engineResult?.['五功能区'] || {};
  const chan = engineResult?.['学习通道'] || {};
  const behav = engineResult?.['行为模式'] || {};
  const brain = engineResult?.['左右脑'] || {};
  const atd = engineResult?.['ATD'] || {};
  const fingerText = fingers ? Object.entries(fingers)
    .map(([key, value]) => `${key}:${value?.sym || ''}/${value?.trc || ''}`)
    .join(' ') : '';

  return [
    `年龄:${age || ''}`,
    `主性格类型:${engineResult?.['主性格类型'] || ''}`,
    `学习通道:${chan?.['主通道'] || ''}`,
    `行为模式:${behav?.['结论'] || ''}`,
    `左右脑:${brain?.['结论'] || ''}`,
    `ATD:${atd?.['分区'] || atd?.['值'] || ''}`,
    `五功能区:${['精神', '思维', '体觉', '听觉', '视觉'].map(key => `${key}${fp?.[key] || ''}`).join(' ')}`,
    `手指:${fingerText}`,
    `用户问题:${(selectedIssues || []).join(' ')}`,
  ].filter(Boolean).join('\n');
}

function buildRiskKnowledgeBlock(results) {
  if (!results?.length) return '';
  return [
    '【Report Knowledge Index 安全边界命中｜只用于降级、禁用和转人工判断】',
    '使用规则：这些内容不得作为普通报告结论输出；遇到相关问题时，只能安全改写、降级或建议人工/专业支持。',
    ...results.map((item, index) => [
      `${index + 1}. ${item.title}`,
      `边界：${item.safeGrounding}`,
      item.doNotUse?.length ? `禁用：${item.doNotUse.join(' / ')}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n\n');
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

function getAudienceStyle(tier) {
  const childTiers = new Set(['preschool', 'school', 'junior_teen', 'senior_teen']);
  const isChildReport = childTiers.has(tier);
  if (isChildReport) {
    return {
      mode: 'minor',
      subject: '孩子',
      reader: '家长',
      readerAndSubject: '你和孩子',
      behaviorSubject: '孩子',
      context: '家庭节奏、学校环境、年龄阶段和最近压力',
      addressRule: '当前是未成年人报告：可以使用“孩子、这孩子、家长、亲子沟通”等表达；语气面向家长，重点是帮助家长理解孩子，不直接给孩子贴标签。',
      understoodButBlocked: '如果一个孩子看起来“听懂了但做不出来”，有时不是态度问题',
      atdScene: '放在孩子身上，ATD常常会影响他被催时的反应：有的孩子一催就炸，有的孩子越催越慢，还有的孩子需要先把规则听完整才愿意动。',
      behaviorScene: '当一个孩子反复在同一类场景里卡住，我们更需要问：他是没理解、没开始、没坚持，还是被情绪打断？'
    };
  }
  return {
    mode: 'adult',
    subject: '你',
    reader: '本人',
    readerAndSubject: '你',
    behaviorSubject: '你',
    context: '生活节奏、工作环境、关系压力、近期状态和成长经历',
    addressRule: '当前是成年人/本人报告：必须直接面向本人说“你”；禁止无故使用“孩子、家长、亲子、这孩子、我家孩子”等未成年人语境，除非用户选择的问题明确是在谈自己的孩子。',
    understoodButBlocked: '如果你常觉得自己“听懂了但做不出来”，有时不是能力问题',
    atdScene: '放在成年人身上，ATD常常会影响启动、沟通和压力反应：有的人一被催就急，有的人越急越慢，还有的人需要先把边界和步骤想清楚才愿意动。',
    behaviorScene: '当你反复在同一类场景里卡住，我们更需要问：是没理解、没开始、没坚持，还是被情绪和压力打断？'
  };
}

// ── 必给模块（固定骨架）──────────────────────────────────────────────
// 所有上传报告必须先给完整结构，再回答用户选择的问题；AI 只能填内容，不能删减或改顺序。
const CORE_REQUIRED_MODULES = [
  '严正申明四原则',
  'TRC（认知结构）',
  'ATD（感受/反应节奏）',
  '左右脑（信息处理风格）',
  '性格类型（核心行为外显模块）',
  '学习通道（学习输入系统）',
  '行为模式（行为解释系统）',
  '精神功能（拇指系统）',
  '思维功能（食指系统）',
  '体觉功能（中指系统）',
  '听觉功能（无名指系统）',
  '视觉功能（小指系统）',
];

// 兼容旧变量名：页面/API 结构不变，只把各年龄段必给模块统一为固定骨架。
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
- 固定骨架不是目录页：每个必给模块的①②③都要认真展开，不能每段只写一句话；宁可少用空泛形容词，也要把"是什么、为什么和我有关、明天怎么用"讲透。
- ===性格类型（核心行为外显模块）=== 是高转化核心页，必须写得最有画面感、最像在理解这个人：三个段落都要比其他模块更厚，每段至少包含3个信息点，必须写出真实生活表现、学习影响、人际影响、压力下的卡点、优势被支持后的样子。禁止只写"你是XX型，所以…"这种短句。
- 全报告最低信息量：每个固定模块总量建议350-650字；性格类型和五大功能模块建议600-900字。每个①②③至少2-4句，必须包含"指标解释 + 当前数据/个人均值关系 + 现实行为画面 + 优势与限制 + 可执行建议"中的至少3类信息。
- 五大功能区每页都要讲清对应的两根手指：精神=右拇/左拇，思维=右食/左食，体觉=右中/左中，听觉=右无名/左无名，视觉=右小/左小；分别说明每根手指代表什么、数值高/低可能怎么表现、优势在哪里、日常如何使用或补足。禁止只写"这个功能高/低"就结束。
- 如果某个模块内容放不下一屏或一页，允许自然分页/滚动，不要压缩成摘要；用户宁愿多读一点，也不要读到空泛、短、像糊弄的报告。
- 勾选问题采用"四要素自然表达"：内部必须包含机制解释、具体做法、积极意义、继续观察/承接，但前台不要写成八股文；"具体做法"给2–3个具体动作，"积极意义"讲清这个特质值得如何被看见。
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
- 必给板块必须严格按指定标题输出，不允许删除、合并、改名、调序
- 每个必给板块内部必须固定三段：①是什么 ②对当前用户意味着什么 ③怎么应用到学习/行为/沟通
- 五大功能必须拆成五个独立板块：精神功能、思维功能、体觉功能、听觉功能、视觉功能；禁止合并成一页。
- issue 类型仍用 ①②③④ 标记，供系统解析；但内容要按"四要素自然表达"写，禁止机械套"为什么/怎么办/未来趋势/还想深聊"四个标题
- 直接开始正文，禁止任何开场白（"收到""好的""当然"等）`;

// ── 构建用户消息（引擎数据 + 格式规范） ────────────────────────────────
function buildUserMessage(engineResult, age, name, requiredModules, selectedIssues, fingers, tier, knowledgeContext = {}) {
  const fp      = engineResult['五功能区'] || {};
  const chan     = engineResult['学习通道'] || {};
  const behav    = engineResult['行为模式'] || {};
  const brain    = engineResult['左右脑'] || {};
  const atd      = engineResult['ATD'] || {};
  const extra    = engineResult['叠加特质'] || {};
  const avg      = fp['个人均值'] || 0;

  const fingerValue = (pos) => {
    const v = Number(fingers?.[pos]?.trc);
    return Number.isFinite(v) ? v : null;
  };
  const fingerState = (pos) => {
    const v = fingerValue(pos);
    const a = Number(avg);
    if (!Number.isFinite(v) || !Number.isFinite(a)) return '未识别';
    const diff = +(v - a).toFixed(1);
    const tag = diff >= 5 ? '明显高于个人均值'
      : diff >= 2 ? '略高于个人均值'
      : diff <= -5 ? '明显低于个人均值'
      : diff <= -2 ? '略低于个人均值'
      : '接近个人均值';
    return `${v}（${tag}，差值${diff >= 0 ? '+' : ''}${diff}）`;
  };
  const pairState = (rightPos, leftPos) => {
    const rv = fingerValue(rightPos);
    const lv = fingerValue(leftPos);
    if (!Number.isFinite(rv) || !Number.isFinite(lv)) return '左右差异待确认';
    const diff = +(rv - lv).toFixed(1);
    if (diff >= 3) return `右侧比左侧高${diff}，右侧代表的功能更容易先被调动`;
    if (diff <= -3) return `左侧比右侧高${Math.abs(diff)}，左侧代表的功能更容易先被调动`;
    return `左右差值${Math.abs(diff)}，两侧相对接近，需要结合真实场景看哪边更常被使用`;
  };
  const functionFingerDesc = [
    `精神功能：右拇R1=${fingerState('R1')}；左拇L1=${fingerState('L1')}；${pairState('R1','L1')}`,
    `思维功能：右食R2=${fingerState('R2')}；左食L2=${fingerState('L2')}；${pairState('R2','L2')}`,
    `体觉功能：右中R3=${fingerState('R3')}；左中L3=${fingerState('L3')}；${pairState('R3','L3')}`,
    `听觉功能：右无名R4=${fingerState('R4')}；左无名L4=${fingerState('L4')}；${pairState('R4','L4')}`,
    `视觉功能：右小R5=${fingerState('R5')}；左小L5=${fingerState('L5')}；${pairState('R5','L5')}`,
  ].join('\n');
  const zoneTotalDesc = ['精神','思维','体觉','听觉','视觉']
    .map(z => `${z}合计${fp[z] || 0}`)
    .join(' / ');

  const ageTierDesc = {
    preschool:'学龄前(0-6岁)', school:'小学阶段(7-12岁)',
    junior_teen:'初中阶段(13-15岁)', senior_teen:'高中阶段(16-18岁)',
    young_adult:'大学·初入职(18-25岁)', adult:'职业发展期(25-40岁)',
    mature_adult:'成熟·转型期(40岁+)',
  }[tier];
  const audienceStyle = getAudienceStyle(tier);
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
    ? `\n【问题模块格式（每个 issue 使用四要素自然表达）】\n` + dedupedIssues.map(issue => {
        if (兴趣班板块Names.has(issue)) {
          // 职业/能力类延伸问题：必须在必给模块2结论基础上展开，禁止重新判断高低
          return `===issue:${issue}===
⚠️ 此板块是上方五个功能板块与「TRC（认知结构）」的延伸决策——直接基于已给出的能力结构，聚焦「${issue}」这个具体问题，禁止重新做高低判断，数据用上方 RULE-F04 已修正结果。
①机制解释：（在能力结构结论基础上，点明此决策的关键数据依据，1-2句；不要写成系统分析）
②具体做法：（针对"${issue}"给出3-4条具体可选路径，引用官方职业/方向映射，今天就能落地）
③积极意义：（这个方向如果被合适支持，长期可能长成什么价值；不做保证）
④继续观察：（一句自然承接，指向最值得继续补充的真实场景或追问）`;
        }
        return `===issue:${issue}===\n①机制解释：（基于具体手指/类型/通道/ATD解释背后的可能机制，2-3句；先讲场景，不要像系统规则）\n②具体做法：（给明天就能做的具体动作，2-4条；低风险、可执行）\n③积极意义：（说明这个特质被看见和支持后，可以发展成什么优势；不预测、不保证）\n④继续观察：（一句自然承接，建议观察一个具体场景、补充信息或人工一起看）`;
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

【年龄与称谓一致性规则】（必须先执行，再写任何板块）
- 当前年龄段：${ageTierDesc}；当前报告对象语境：${audienceStyle.reader}阅读 / ${audienceStyle.subject}为被测对象。
- ${audienceStyle.addressRule}
- 所有固定模块、严正申明、勾选问题回答，都必须和当前年龄段一致；成年人报告不得出现“您孩子怎样怎样”“这孩子”“家长怎么配合”等错位表达。
- 如果需要泛化表达，用“这个人/本人/你”替代“孩子”；只有0-18岁报告才使用“孩子/家长”表达。

【五大功能区总览】${zoneTotalDesc}
说明：上面的功能区合计只允许用于总览图或能力地图，禁止拿“两根手指合计值”和“单指个人均值”直接比较后写结论。五个独立功能页必须按下面的单指明细写。

【五大功能区单指明细】（五个独立功能页必须优先使用这里，不得只写合计值）
${functionFingerDesc}
总TRC：${fp['总TRC']}
${兴趣班提示}
${knowledgeContext.reportKnowledgeBlock ? `\n${knowledgeContext.reportKnowledgeBlock}\n` : ''}
${knowledgeContext.riskKnowledgeBlock ? `\n${knowledgeContext.riskKnowledgeBlock}\n` : ''}
【需要生成的板块】（按顺序，前${requiredModules.length}个是固定骨架，不可删除/合并/调序）
${allModules.map((m,i)=>`${i+1}. ${m}`).join('\n')}

【固定骨架强约束】
必须依次输出以下${requiredModules.length}个模块，标题必须完全一致：
${requiredModules.map((m,i)=>`${i+1}. ===${m}===`).join('\n')}

每个固定模块必须三段式：
①是什么：用用户听得懂的话解释这个指标/系统是什么，可以举生活例子；不能只给定义，要讲这个指标在真实生活里通常会怎么出现。
②对你意味着什么：结合当前用户数据，和个人均值或区间对比，讲高/低/均衡的优势、代价和理解方式，禁止只讲理论；必须落到当前年龄对应对象的行为画面。
③怎么应用：讲这些特征如何应用到学习、行为、沟通；如何理解、接纳、和解、和谐共生；必须给2-4个具体可做动作或观察点。

【重点模块加厚】
- ===严正申明四原则=== 必须独立成页，但不要写成法律免责声明或冷冰冰的免责条款。它更像正式解读前的一段温和开场：先安住用户，再教用户怎么读报告。必须讲清：数值没有好坏、不预测未来不算命、只和自己均值比、不贴标签；同时要说清这四条为什么重要、读报告时怎么用，语气要有人味、有边界、有信任感。
- ===性格类型（核心行为外显模块）=== 必须最详细，是整份报告的"用户共鸣页"：必须写清类型定义、典型行为画面、学习中的表现、人际或对应年龄段沟通中的表现、压力下容易被误解的地方、优势如何被看见和使用。不要只讲理论；未成年人报告让家长觉得"这说的就是我家孩子"，成年人报告让本人觉得"这说的就是我"。
- ===TRC（认知结构）=== 必须讲清 TRC 高低代表容量差异，并结合当前用户表现与学习方式。
- ===左右脑（信息处理风格）=== 必须讲清左右脑差异代表敏感度/处理风格，说明当前偏向对行为和决策的影响。
- ===ATD（感受/反应节奏）=== 必须讲清不同区间代表反应速度/节奏差异，并说明对学习方式的影响。
- ===精神功能（拇指系统）=== 必须说明右拇=开创力/对外主导，左拇=管理力/对内主导；分别讲高低体现、行为表现、优势与应用。
- ===思维功能（食指系统）=== 必须说明右食=逻辑推理/数学，左食=创意/空间/策略；分别讲高低体现、行为表现、优势与应用。
- ===体觉功能（中指系统）=== 必须说明右中=小肌肉精细，左中=大运动/耐力/坚持；分别讲高低体现、行为表现、优势与应用。
- ===听觉功能（无名指系统）=== 必须说明右无名=语言表达/记忆，左无名=音感/言外之意；分别讲高低体现、行为表现、优势与应用。
- ===视觉功能（小指系统）=== 必须说明右小指=识人/察色/方向感，左小指=色彩审美/图像思考；分别讲高低体现、行为表现、优势与应用。
- 以上每个五大功能模块都要像单独一页报告来写，不允许合并、不允许一句带过。必须至少包含：两根手指定义、每根手指各自与个人均值的对比、左右两根手指谁更容易先被调动、数值偏高/偏低的优势和可能卡点、学习/行为/沟通中的应用建议。
- 严禁把两根手指的合计值拿去和个人单指均值比较后写成“当前某功能为X，明显高于个人均值”。这种写法会误判强弱。

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
      // 四要素拆分：内部仍用 ①②③④ 稳定解析，前台标题可自然化，避免八股文。
      const parts = { why:'', how:'', future:'', cta:'' };
      const whyM    = body.match(/①[^：:\n]*[：:]?([\s\S]*?)(?=②|$)/i);
      const howM    = body.match(/②[^：:\n]*[：:]?([\s\S]*?)(?=③|$)/i);
      const futureM = body.match(/③[^：:\n]*[：:]?([\s\S]*?)(?=④|$)/i);
      const ctaM    = body.match(/④[^：:\n]*[？?:：]?([\s\S]*?)$/i);

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

function coreModuleFallback(title, engineResult, tier = 'adult', fingers = null) {
  const fp = engineResult?.['五功能区'] || {};
  const chan = engineResult?.['学习通道'] || {};
  const behav = engineResult?.['行为模式'] || {};
  const brain = engineResult?.['左右脑'] || {};
  const atd = engineResult?.['ATD'] || {};
  const type = engineResult?.['主性格类型'] || '当前类型';
  const audience = getAudienceStyle(tier);
  const avg = fp['个人均值'] || '当前均值';
  const total = fp['总TRC'] || '当前总量';

  const fingerValue = (pos) => {
    const v = Number(fingers?.[pos]?.trc);
    return Number.isFinite(v) ? v : null;
  };
  const fingerState = (pos) => {
    const v = fingerValue(pos);
    const a = Number(avg);
    if (!Number.isFinite(v) || !Number.isFinite(a)) return '数值待确认';
    const diff = +(v - a).toFixed(1);
    if (diff >= 5) return `明显高于个人均值${a}（高${diff}）`;
    if (diff >= 2) return `略高于个人均值${a}（高${diff}）`;
    if (diff <= -5) return `明显低于个人均值${a}（低${Math.abs(diff)}）`;
    if (diff <= -2) return `略低于个人均值${a}（低${Math.abs(diff)}）`;
    return `接近个人均值${a}（差${Math.abs(diff)}）`;
  };
  const pairState = (rightPos, leftPos, rightLabel, leftLabel) => {
    const rv = fingerValue(rightPos);
    const lv = fingerValue(leftPos);
    if (!Number.isFinite(rv) || !Number.isFinite(lv)) return '左右两侧差异需要结合原始数值继续确认。';
    const diff = +(rv - lv).toFixed(1);
    if (diff >= 3) return `${rightLabel}比${leftLabel}高${diff}，说明这个功能更容易先从${rightLabel}代表的方向启动；${leftLabel}并不是没有，而是需要更多结构、练习或场景来调动。`;
    if (diff <= -3) return `${leftLabel}比${rightLabel}高${Math.abs(diff)}，说明这个功能更容易先从${leftLabel}代表的方向启动；${rightLabel}需要更明确的目标、步骤或反馈来带动。`;
    return `${rightLabel}和${leftLabel}比较接近，说明两边都有可用入口，真正表现要看当下任务是在调用哪一种能力。`;
  };
  const functionBlocks = {
    '精神功能（拇指系统）': {
      rightPos:'R1', leftPos:'L1', rightName:'右拇', leftName:'左拇',
      rightRole:'开创力、目标感、对外发起、号召和主导',
      leftRole:'管理力、自我纪律、执行协调、承压和自制',
      high:'更容易有目标、有主见、愿意扛事，也可能因为太想推进而显得急、硬、没耐心',
      low:'不代表没能力，而是需要被点燃、被看见，适合先用小目标和外部结构启动',
      apply:'学习或做事时，右拇强可以给挑战和责任，左拇强可以给计划和规则；偏低的一侧不要硬压大目标，先从一个能完成的小胜利开始。'
    },
    '思维功能（食指系统）': {
      rightPos:'R2', leftPos:'L2', rightName:'右食', leftName:'左食',
      rightRole:'逻辑推理、数学、规则理解、因果分析',
      leftRole:'创意、空间想象、策略、跳出框架看问题',
      high:'更容易抓结构、想办法、找规律，也可能标准高、想太多、卡在还没想清楚',
      low:'不代表笨，而是不能只靠抽象讲道理，需要例子、图像、步骤或体验来带动',
      apply:'学习上，右食强先讲公式和逻辑，左食强先用图像和策略；偏低的一侧用复述、画图、举例把思考落下来。'
    },
    '体觉功能（中指系统）': {
      rightPos:'R3', leftPos:'L3', rightName:'右中', leftName:'左中',
      rightRole:'小肌肉精细、写字、手工、操作细节、手眼协调',
      leftRole:'大运动、身体节奏、耐力、坚持和律动',
      high:'更适合通过做、摸、练、动来理解，身体记忆和实践感会更明显',
      low:'不代表懒或没执行力，而是身体入口需要更短、更清楚、更可见的训练节奏',
      apply:'学习上把知识变成动作：写出来、摆出来、演出来；精细侧偏低就少量多次练，律动侧偏低就先降低持续时间要求。'
    },
    '听觉功能（无名指系统）': {
      rightPos:'R4', leftPos:'L4', rightName:'右无名', leftName:'左无名',
      rightRole:'语言表达、口语记忆、听到后复述和讲出来',
      leftRole:'音感、语气、节奏、言外之意和情绪声调',
      high:'更容易从声音和语言里抓重点，也更容易被语气、音量和环境噪声影响',
      low:'不代表听不懂，而是单靠口头讲解不够，需要文字、图像或动作一起辅助',
      apply:'听觉强可以朗读、讲题、复述；偏低时把口头指令写下来，一次确认一个重点，先降低声音压力再谈要求。'
    },
    '视觉功能（小指系统）': {
      rightPos:'R5', leftPos:'L5', rightName:'右小', leftName:'左小',
      rightRole:'识人、察色、方向感、观察外部线索和细节辨识',
      leftRole:'色彩审美、图像思考、画面感和内在想象',
      high:'更容易看见细节、画面和氛围变化，优势是观察、审美、图像记忆和空间感',
      low:'不代表没审美或没判断力，而是不能只靠图像输入，需要声音、步骤或逻辑辅助',
      apply:'视觉强适合图表、颜色、流程图和空间定位；偏低时不要只给图，要配合口头解释、文字步骤和真实例子。'
    },
  };
  const functionFallback = (cfg) => {
    const rv = fingerValue(cfg.rightPos);
    const lv = fingerValue(cfg.leftPos);
    const rightValue = Number.isFinite(rv) ? rv : '待确认';
    const leftValue = Number.isFinite(lv) ? lv : '待确认';
    return [
      `①是什么：这个板块不把两根手指简单相加来判断强弱，而是分别看${cfg.rightName}和${cfg.leftName}。${cfg.rightName}代表${cfg.rightRole}；${cfg.leftName}代表${cfg.leftRole}。两边合在一起，才构成这一项功能在生活里的完整样子。`,
      `②对当前用户意味着什么：${cfg.rightName}数值为${rightValue}，${fingerState(cfg.rightPos)}；${cfg.leftName}数值为${leftValue}，${fingerState(cfg.leftPos)}。${pairState(cfg.rightPos, cfg.leftPos, cfg.rightName, cfg.leftName)} 当某一侧偏高时，${cfg.high}；当某一侧偏低时，${cfg.low}。所以这里看的不是“这个功能好不好”，而是它从哪一侧更容易被唤起、哪一侧更需要环境支持。`,
      `③怎么应用：${cfg.apply} 如果两侧都高，要给空间和出口，避免能量被压成急躁；如果两侧都低，要先搭脚手架，不要用“你怎么做不到”去刺激。真正有效的用法，是把高的一侧当入口，把低的一侧当需要慢慢补足的节奏。`
    ].join('\n\n');
  };

  const lines = {
    '严正申明四原则': [
      `①是什么：在正式看报告之前，先把一件事说清楚：这份报告不是给${audience.subject}下结论，也不是把人分成好坏高低。它更像一张理解自己的地图，帮${audience.readerAndSubject}看见哪些地方更省力、哪些地方需要方法，哪些反应是天生更容易出现的倾向，哪些又会被${audience.context}影响。数值只是线索，不是判决；报告的价值不在于“说中了多少”，而在于它能不能帮${audience.readerAndSubject}更温和、更具体地理解自己。`,
      `②对当前用户意味着什么：接下来你会看到TRC、ATD、左右脑、性格类型、学习通道、行为模式和五大功能区。看到高的地方，不要只理解成“优势”，它也可能因为用得太顺而变成急、满、停不下来；看到低的地方，也不要理解成“短板”，它可能只是说明这个入口更需要节奏、提醒、练习或安全感。所有数值都只和自己的个人均值比，不拿你和别人比；同样的先天线索，放在不同家庭、不同学校、不同成长经历里，也会长出完全不同的样子。`,
      `③怎么应用：读这份报告时，可以带着四个原则往下看：第一，数值没有好坏，只看它在生活里怎么被使用；第二，报告不预测未来，也不替你做重大决定；第三，高低都回到自己的均值和真实表现里理解；第四，不用任何一个类型或指标给人贴标签。最好的读法不是急着判断“准不准”，而是拿它去对照真实场景：最近哪里更顺，哪里总卡住，哪里一被催就乱，哪里一被看见就能发挥。这样，这份报告才会从一张数据表，变成一份可以帮助学习、沟通和自我接纳的说明书。`
    ],
    'TRC（认知结构）': [
      `①是什么：TRC可以理解为大脑可调用的信息容量和任务承载空间。它不是聪明不聪明的判断，而是一个人处理信息、承接任务、消化学习内容时，先天更容易呈现出的容量感。容量高的人不一定轻松，因为接收得多也容易想得多；容量低的人也不是不行，而是更需要清楚边界和合适节奏。换句话说，它讲的不是“能不能学”，而是“一次能装多少、用什么方式装、装完以后要不要整理”。`,
      `②对当前用户意味着什么：当前总TRC为${total}，个人均值为${avg}。高于个人均值的区域更像顺手工具，低于个人均值的区域更像需要节奏和方法支持的地方；理解它，是为了知道哪些事可以顺势用力，哪些事不要硬扛。比如学习或处理任务时，容量强的部分可以承担理解和整合，容量弱的部分就不要用连续轰炸式练习硬推。${audience.understoodButBlocked}，而是信息量、步骤量和输出要求同时压上来，超过了当下最舒服的承接方式。`,
      `③怎么应用：学习或工作中，先把任务拆成能承接的小块，再根据强势区安排输入方式和练习方式；沟通时也可以少一点“你怎么做不到”，多一点“我们换一种承接方式”。具体可以先做三件事：第一，把大任务拆成第一步；第二，先用强势通道建立理解，再补发展区；第三，观察他在哪个环节开始卡住，是听不懂、记不住、写不出，还是一被催就乱。真正有效的支持，是让强势区先建立成功经验，再温和带动发展区。`
    ],
    'ATD（感受/反应节奏）': [
      `①是什么：ATD可以理解为一个人接收刺激、产生反应和进入状态的节奏。它更接近“速度感”和“敏感度”，不是好坏分数。ATD偏快的人，往往更容易先捕捉到变化、先有情绪或判断；ATD偏慢的人，往往需要多一点时间进入状态，但进入以后可能更稳。它像一个人的“启动速度”和“反应刹车”，会影响学习、沟通和压力下的表现。`,
      `②对你意味着什么：当前ATD为${atd['值'] || '未识别'}，处于${atd['分区'] || '待确认'}。节奏偏快时容易反应灵敏、先感觉到变化，也可能急、抢答、被一句话点燃；节奏偏慢时更稳、更能沉住气，也可能被误会为拖、慢热、不积极。${audience.atdScene}`,
      `③怎么应用：学习和沟通时，不要只催结果，要给出清楚边界、启动信号和缓冲时间。可以试着这样做：开始任务前先给预告，比如“还有五分钟开始写”；提要求时一次只说一件事；遇到情绪反应时先降速，再讨论对错。ATD不是要被改掉，而是要被配速；当节奏被看懂，反应就更容易变成配合，而不是对抗。`
    ],
    '左右脑（信息处理风格）': [
      `①是什么：左右脑代表信息处理风格的偏向。左脑更偏语言、逻辑、目标、规则和步骤，右脑更偏画面、感受、关系、空间和整体直觉。它不是说一个人只用左脑或只用右脑，而是看他遇到信息时，习惯先从哪边进入：是先问“规则是什么、步骤是什么”，还是先感到“这个氛围对不对、画面有没有感觉”。`,
      `②对你意味着什么：当前左右脑表现为${brain['结论'] || '相对均衡'}，左脑占比${brain['左脑占比'] || '未识别'}%。偏左时更需要逻辑和步骤，优势是能整理、能推理、能按规则推进，但压力大时可能显得较真、卡细节；偏右时更需要画面、情境和感受连接，优势是有直觉、有共情、有想象，但也可能因为感受太多而分心。均衡时则不是“没有特点”，而是要看具体任务调动哪一边。`,
      `③怎么应用：学习或处理任务时，可以把抽象内容转成步骤或图像：偏左时先给公式、框架、清单；偏右时先给故事、图像、例子，再回到规则。沟通上，先用对方听得懂的方式进入，再谈要求；比如先画出任务流程，或者先说明这件事和他有什么关系。做选择时，也允许自己既看事实，也看身体和情绪给出的提醒，这样判断会更完整。`
    ],
    '性格类型（核心行为外显模块）': [
      `①是什么：${type}是当前最核心的行为外显底色。它不是给人贴标签，而是在说明一个人遇到任务、关系和压力时，最容易先调用哪套反应方式。你可以把它理解成“默认操作系统”：有的人先观察再行动，有的人先试试看再修正，有的人先确认规则，有的人先建立自己的判断。这个类型真正有价值的地方，不是告诉你“他是什么人”，而是帮你看懂他为什么会用这种方式保护自己、推进事情、确认安全感。`,
      `②对当前用户意味着什么：放到现实生活里，${type}往往会影响一个人怎么开始一件事、怎么判断自己有没有把握、怎么面对催促、怎么接收批评，也会影响他在学习和关系里的第一反应。你可能会看到：他不是没有想法，而是需要先弄懂规则和意义；不是故意慢，而是心里要先把路径排清楚；不是不在乎别人，而是表达方式常常先从自己的判断出发。这个底色用好了，会长成稳定的判断力、理解力、整合力或自我驱动力；用急了，也可能表现为拖延、反复确认、怕错、抗拒被管，或者在压力下显得“不好沟通”。`,
      `③怎么应用：学习上，不要只用“快点、认真点、别磨蹭”去推他，而要顺着这个类型给入口：先讲清目标，再给第一步动作，再让他看到完成后的反馈。沟通上，先承认他的反应背后有保护意义，再提出具体要求，会比直接评价性格更有效。关系里也一样，不必急着把这个底色改掉，而是找到更适合它的任务入口、沟通语言和反馈节奏。真正的成长不是压掉底色，而是让底色被理解之后，长出更成熟、更柔和、更能和别人协作的使用方法。`
    ],
    '学习通道（学习输入系统）': [
      `①是什么：学习通道指信息最容易从哪里进入大脑，是听、看、动手、画面、语言或身体体验等输入方式的偏好。它不是判断一个人只能用哪一种方式学习，而是在提醒我们：同样一段内容，有的人听一遍就抓住重点，有的人看图更快，有的人必须动手做过才真正明白。通道对了，学习会省力；通道不对，${audience.subject}可能不是不会，而是入口没打开。`,
      `②对你意味着什么：当前主通道为${chan['主通道'] || '待确认'}。主通道强，代表这种输入方式更省力；非主通道并不是不能学，而是需要转换成更适合自己的入口。如果主通道偏视觉，图表、颜色、位置、流程会更有帮助；如果偏听觉，朗读、讲题、复述会更容易进脑；如果体觉参与感强，写出来、摆出来、做出来会比只听讲更有效。`,
      `③怎么应用：学习新内容时，先用主通道建立理解，再用其他通道补充巩固。具体做法是：先找到最顺的入口，再安排复习方式；不要只用一种方法硬推所有科目。沟通时也一样，不是讲更多就有效，而是换成对方真正接得住的方式。比如讲不明白时，可以换成画流程、让他复述、让他做一遍，学习就会从“被要求”变成“能进入”。`
    ],
    '行为模式（行为解释系统）': [
      `①是什么：行为模式解释的是一个人更容易被情绪、任务、目标、规则还是身体节奏带动。它帮助我们把“表现”翻译成背后的运行方式。比如拖拉不一定是不想做，可能是启动入口不清；顶嘴不一定是故意对抗，可能是在争取边界；三分钟热度也不一定是没毅力，可能是反馈太远、成就感太少。行为模式看的就是这些表面表现背后的机制。`,
      `②对你意味着什么：当前行为模式为${behav['结论'] || '待确认'}。这说明某些行为不是单纯听不听话、努不努力，而可能是启动方式、压力承接方式或反馈节奏不匹配。${audience.behaviorScene}如果只评价“懒、不认真、脾气大”，就容易错过真正能调整的入口。`,
      `③怎么应用：遇到卡住时，先看行为背后的需求，再给方法。学习上减少空泛催促，沟通上把要求说清楚、把步骤拆开、把反馈放近，行为才更容易回到合作。可以先观察三个点：这个行为通常发生在什么任务前；外界要求或提醒出现后是否加重；完成哪一步后会明显放松。找到这些线索，再给支持，效果会比单纯讲道理稳定得多。`
    ],
    '精神功能（拇指系统）': functionFallback(functionBlocks['精神功能（拇指系统）']),
    '思维功能（食指系统）': functionFallback(functionBlocks['思维功能（食指系统）']),
    '体觉功能（中指系统）': functionFallback(functionBlocks['体觉功能（中指系统）']),
    '听觉功能（无名指系统）': functionFallback(functionBlocks['听觉功能（无名指系统）']),
    '视觉功能（小指系统）': functionFallback(functionBlocks['视觉功能（小指系统）']),
  };

  const fallbackContent = lines[title] || [
    `①是什么：这个模块用于帮助你理解当前资料中呈现出的一个重要特征。`,
    `②对你意味着什么：它需要结合具体数值、年龄阶段和现实场景来看，不能孤立地下结论。`,
    `③怎么应用：先把它当作理解自己和沟通方式的线索，再用低风险的小动作慢慢调整。`,
  ];
  return Array.isArray(fallbackContent) ? fallbackContent.join('\n\n') : fallbackContent;
}

function issueFallback(issueTitle, tier = 'adult') {
  const subject = issueTitle || '这个问题';
  const text = String(subject);
  const has = (...words) => words.some(w => text.includes(w));
  const isChild = ['preschool', 'school', 'junior_teen', 'senior_teen'].includes(tier);
  const isTeen = ['junior_teen', 'senior_teen'].includes(tier);
  const stage = isTeen ? '青春期和升学压力阶段'
    : isChild ? '当前成长阶段'
      : ['young_adult', 'adult'].includes(tier) ? '当前学习、职业和关系阶段'
        : '当前人生阶段';
  const person = isChild ? '孩子' : '你';
  const reader = isChild ? '家长' : '本人';

  if (has('文理', '选科', '天赋更偏')) {
    return {
      why: `「${subject}」不能只看一门课现在分数高低。它更像是在问：${person}更容易从哪种信息入口进入学习，是逻辑推理更顺、图像空间更顺，还是需要听觉复述、身体操作来帮忙。放在${stage}，还要看课程压力、老师讲法、作业形式和最近信心是否被消耗。`,
      how: `先做一个小型观察：选两门最有代表性的科目，分别看${person}是“听得懂但做不出”，还是“题会做但不愿开始”，或是“有兴趣但持续不久”。再把学习方式换一换：逻辑强的科目先建公式和步骤，图像强的内容先画图，听觉强的内容用讲题复述，体觉参与强的内容用动手和演示。处理「${subject}」时，先试两周，不急着下定论。`,
      future: `偏科背后不一定是短板，也可能是入口没有对上。真正值得保留的是${person}已经显露出来的理解方式：有的孩子靠结构，有的靠画面，有的靠讲出来，有的靠做一遍。把入口找准，比简单说“适合文科/理科”更稳。`,
      cta: isChild ? '可以先拿最近一次作业或考试场景来看，别急着替孩子定方向。' : '可以先拿最近一个学习或选择场景来看，别急着把自己定型。'
    };
  }

  if (has('偏科', '学习方法', '科目')) {
    return {
      why: `「${subject}」更像是学习入口和训练方法的问题，不一定说明${person}能力差。偏科常常发生在“听课入口、做题入口、复盘入口”不一致的时候：课堂上好像懂了，作业一变形就卡；或者能背下来，却不会迁移到题目里。放在${stage}，还要看老师讲法、作业难度和最近是否因为挫败而先关上了学习通道。`,
      how: `先不要一次改所有科目，挑最卡的一科做三步：第一，把错题分成“没听懂、会但慢、粗心、不会迁移”四类；第二，换一种输入方式，能画图就画图，能讲题就讲出来，能动手就做一遍；第三，每天只追一个小改进，比如先把第一题做出来。处理「${subject}」时，重点不是加时长，而是换入口。`,
      future: `学习方法调对以后，原来所谓的偏科可能会慢慢露出优势：有的孩子不是不适合理科，而是需要先看结构；有的不是不适合文科，而是需要先找到表达框架。稳定的学习力，是从找到自己的入口开始的。`,
      cta: '可以先拿一门最卡的科目和最近一次错题表现来拆。'
    };
  }

  if (has('升学', '名校', '专业', '志愿', '路线', '方向')) {
    return {
      why: `「${subject}」牵涉的是方向选择，不适合用报告直接给保证。报告能帮忙看的，是${person}在哪些能力入口更省力、在哪些压力场景容易卡住、哪种学习和环境更容易持续。放在${stage}，现实成绩、兴趣稳定度、家庭资源和试错成本也必须一起看。`,
      how: `先把选择拆成三层：第一，哪些科目或活动让${person}更容易进入状态；第二，哪些任务虽然重要但明显消耗过大；第三，哪些方向可以用一次课程、一次访谈或一次真实体验去验证。不要只问“冲名校还是选专业”，先做一个低风险的小验证，再决定要不要加码。`,
      future: `方向不是保证书，而是逐步校准出来的路线。报告里真正有价值的，是帮${reader}看见${person}更可能长期投入的方式、承压边界和需要补足的支持条件。这样做选择会更稳，也不容易被一时焦虑带着跑。`,
      cta: '如果要继续看，可以把候选方向、当前成绩和最担心的卡点放在一起拆。'
    };
  }

  if (has('父母', '三观', '亲子', '顶嘴', '叛逆', '沟通', '相处')) {
    return {
      why: `「${subject}」表面像是态度问题，背后常常是节奏、边界和表达方式撞在一起。尤其在${stage}，${person}一边需要被理解，一边又想保留自己的判断；${reader}越急着纠正，对方越容易先防御，再沟通。`,
      how: `先不要从“谁对谁错”开始，可以从最近一次冲突复盘：当时谁先急了、哪句话让对方关上门、真正争的是规则、尊重、自由，还是安全感。下一次沟通先只说一个具体请求，比如“今晚先完成第一步”，不要连续讲道理，也不要把一次行为上升成人品或未来。`,
      future: `这类冲突里也有积极面：有主见、敏感、想被尊重、想证明自己，都是可以被引导的力量。只要沟通方式从压服变成拆场景，很多对抗会慢慢变成可谈、可商量、可合作。`,
      cta: '可以先选一次最典型的冲突场景，我们从那一句话开始拆。'
    };
  }

  if (has('主动', '内驱', '拖拉', '磨蹭', '作业', '不想学', '手机', '游戏')) {
    return {
      why: `「${subject}」不一定是懒，也可能是启动困难、反馈太远、任务颗粒度太大，或者压力一上来就先回避。放在${stage}，越是被催、被比较、被连续否定，越容易把学习和压力绑定在一起。`,
      how: `先把目标缩到“第一步”：不是写完全部作业，而是打开本子、写第一题、计时十分钟。再把反馈放近一点，让${person}知道自己完成了什么。手机或游戏问题也不要只靠没收，可以先约定时间、触发条件和替代动作，让规则具体到能执行。`,
      future: `拖拉和不主动背后，常常也藏着谨慎、怕错、想做好，或者对兴趣和成就感很敏感。方法对了，这些特质不一定拖后腿，反而能慢慢转成稳定的自我管理。`,
      cta: '可以先把最近一次拖拉/不启动的具体场景告诉我。'
    };
  }

  if (has('焦虑', '情绪', '生气', '输不起', '压力', '崩溃', '害怕')) {
    return {
      why: `「${subject}」先不要急着解释成脆弱或不懂事。很多情绪反应，是因为信息量、期待、失败感和身体疲惫一起压上来，超过了当下能承接的节奏。放在${stage}，情绪往往不是问题本身，而是在提醒我们哪里已经超载。`,
      how: `先观察三个点：这种反应通常发生在什么任务前后，持续多久，结束后${person}是后悔、逃开，还是还能复盘。应对时先降速，不急着讲道理；可以用短句确认感受，再给一个小动作，比如喝水、离开现场三分钟、只处理下一步。`,
      future: `情绪敏感也可能代表觉察快、在意结果、对环境变化很灵。被好好看见以后，它不一定是麻烦，也可能转成更细腻的表达、更强的同理心和更好的自我调节。`,
      cta: '如果这种状态反复影响睡眠、学习或生活，建议人工一起看具体场景。'
    };
  }

  if (has('朋友', '人际', '同学', '老师', '课堂', '社交')) {
    return {
      why: `「${subject}」不能只看会不会说话。它还和听觉接收、视觉观察、反应速度、边界感和自我保护方式有关。放在${stage}，一个人在人际里卡住，可能是表达慢，也可能是太敏感、太想被接纳，或不知道怎么开始。`,
      how: `先选一个具体关系场景：是交朋友、被误会、怕老师，还是课堂不敢表达。再给一个可执行动作，比如提前准备一句开场白、把想说的话写下来、先找一个低压力对象练习。不要要求一下子变外向，先让${person}有一个安全的成功经验。`,
      future: `人际能力不是天生固定的。观察力、共情、谨慎、慢热、表达欲，都可以在合适场景里变成优势。关键不是逼自己变成别人，而是找到更舒服、更有效的连接方式。`,
      cta: '可以先从一个具体的人际场景开始看。'
    };
  }

  if (has('职业', '工作', '转型', '事业', '创业')) {
    return {
      why: `「${subject}」不能由报告替你做决定，但可以帮你看清：什么类型的任务更耗能，什么场景更容易让你发挥，压力下你是先冲、先想、先退，还是先照顾关系。放在${stage}，方向选择还要结合经历、资源和现实约束。`,
      how: `先不要直接推翻现状，可以做小范围验证：列出当前工作里最消耗的三件事、最有成就感的三件事，再找一个低成本试错动作，比如副项目、访谈、短课程或一周任务模拟。报告只提供理解线索，真正的选择要用现实反馈校准。`,
      future: `职业优势往往不是单一能力，而是能力组合：目标感、思维方式、沟通方式、身体节奏和环境匹配度。看清组合以后，选择会更像调整路线，而不是赌博。`,
      cta: '可以把当前职业卡点和候选方向放在一起，我帮你拆成可验证的小步骤。'
    };
  }

  if (has('伴侣', '婚姻', '关系', '分手', '在一起')) {
    return {
      why: `「${subject}」不适合直接用报告判断去留。关系里的卡点通常不是谁好谁坏，而是需求、节奏、表达和边界没有对齐。报告可以帮你看沟通方式差异，但不能替你做重大关系决定。`,
      how: `先选一个具体冲突，不要泛泛讨论“合不合适”。看那次冲突里，双方各自在要什么：安全感、尊重、自由、确定性，还是被看见。下一步只做一个低风险动作，比如换一种提问方式、约定冷静时间、把需求说成请求而不是评价。`,
      future: `关系里的差异不一定都是坏事，有些差异会带来互补，有些差异需要边界。真正值得保留的，是你能不能更清楚地表达自己，也更准确地听懂对方。`,
      cta: '如果要继续看，建议从一次具体冲突开始，而不是直接问该不该继续。'
    };
  }

  return {
    why: `「${subject}」不能只看表面行为，需要放回${stage}、TRC容量、ATD反应节奏、左右脑处理风格和五个功能区一起看。很多时候，外在表现只是结果，背后真正影响的是启动方式、承压方式、信息输入方式和沟通环境是否匹配。`,
    how: `先从一个低风险、能马上执行的小动作开始：把要求说得更具体，把任务拆成更小一步，把反馈放近一点，并连续观察1-2周变化。处理「${subject}」时，不急着评价对错，先确认当下最卡的是理解、节奏、情绪、身体状态，还是沟通方式。`,
    future: `这个问题背后通常也藏着一部分优势：谨慎、敏感、反应快、有主见、想做好，或对环境很有觉察。只要方法对了，它不一定是阻碍，也可能慢慢转化成更稳定的自我管理、学习适应和关系沟通能力。`,
    cta: '想继续深聊这个问题，可以把具体场景告诉我。'
  };
}

function normalizeSections(sections, requiredModules, selectedIssues, engineResult, tier = 'adult', fingers = null) {
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
      content: content || coreModuleFallback(title, engineResult, tier, fingers),
    };
  });

  const includedIssues = new Set();
  for (const sec of sections) {
    if (!sec?.title || requiredModules.includes(sec.title)) continue;
    if (sec.type !== 'issue') continue;
    const fallback = issueFallback(sec.title, tier);
    normalized.push({
      ...sec,
      type: 'issue',
      why: (sec.why || '').trim() || fallback.why,
      how: (sec.how || '').trim() || fallback.how,
      future: (sec.future || '').trim() || fallback.future,
      cta: (sec.cta || '').trim() || fallback.cta,
    });
    includedIssues.add(sec.title);
  }

  for (const title of selectedIssues) {
    if (!title || requiredModules.includes(title) || includedIssues.has(title)) continue;
    normalized.push({ title, type: 'issue', ...issueFallback(title, tier) });
    includedIssues.add(title);
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
  let knowledgeContext = {};
  // 知识索引是增强层，不是硬依赖：检索失败时必须回退到原有 SYSTEM_PROMPT + 硬编码规则 + engineResult + selectedIssues 生成链路。
  try {
    const knowledgeQuery = buildReportKnowledgeQuery(engineResult, age, selectedIssues, fingers);
    const reportKnowledgeHits = searchReportKnowledge(knowledgeQuery, {
      topK: 6,
      allowedStatuses: ['auto_safe', 'rewrite_required'],
    });
    const riskKnowledgeHits = searchReportKnowledge(knowledgeQuery, {
      topK: 4,
      allowedStatuses: ['human_only', 'blocked'],
    });
    knowledgeContext = {
      reportKnowledgeBlock: buildReportGroundingBlock(reportKnowledgeHits, { maxItems: 6 }),
      riskKnowledgeBlock: buildRiskKnowledgeBlock(riskKnowledgeHits),
    };
  } catch (e) {
    console.warn('[gen-report] report knowledge index skipped:', e.message);
  }
  const userMessage   = buildUserMessage(engineResult, age, name, requiredMods, selectedIssues, fingers, tier, knowledgeContext);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userMessage },
  ];

  // ── DashScope 报告生成（qwen-plus 正式路径 + 本地保命兜底）──────────────
  // ⚠️ 不使用 qwen-vl-max：视觉模型对文字报告过慢，会超 Vercel 60s 限制 → 504
  // qwen-plus 是正式报告主路径；本地兜底只在模型接近函数上限仍失败时保命，不能作为默认输出策略
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

  // 给 qwen-plus 尽量接近 60s 函数上限的生成窗口，优先使用知识索引和完整提示词生成
  // 只有真的超时/失败时才返回本地兜底，避免红叉，但不把兜底当常态
  try {
    const { text } = await callClaude({
      model:     MODEL_FREE,       // qwen-plus
      messages,
      maxTokens: 5000,
      timeoutMs: 52000,
    });
    raw = text;
  } catch (err1) {
    await logErr('primary_fail', err1);
    const sections = normalizeSections([], requiredMods, selectedIssues, engineResult, tier, fingers);
    return res.status(200).json({
      ok: true,
      sections,
      raw: '',
      requiredModules: requiredMods,
      degraded: true,
      message: 'AI 生成较慢，已先返回安全兜底报告。',
    });
  }

  if (!raw) {
    console.error('[gen-report] empty reply after both attempts');
    return res.status(200).json({ ok:false, error:'AI 未返回内容，请重试' });
  }

  const parsedSections = parseSections(raw, requiredMods, selectedIssues);
  const sections = normalizeSections(parsedSections, requiredMods, selectedIssues, engineResult, tier, fingers);

  return res.status(200).json({ ok:true, sections, raw, requiredModules: requiredMods });
};
