/**
 * api/extract-fp.js — 皮纹总表图片结构化提取
 *
 * POST /api/extract-fp
 * Body: { imageBase64: string, imageMimeType?: string }
 *
 * 返回: {
 *   ok: true,
 *   fingers: { R1:{sym,trc}, R2..., L5:{sym,trc} },
 *   atd: number | null,
 *   name: string | null,
 *   age: number | null,
 *   raw: string          // Vision 原始输出，供前端确认/调试
 * }
 *
 * 失败时: { ok: false, error: string }
 *
 * 手指键: R1~R5 = 右手拇/食/中/无名/小 (左脑)
 *          L1~L5 = 左手拇/食/中/无名/小 (右脑)
 */

const { redisGet, redisSet, callClaude, MODEL_DEEP } = require('./_lib');

// ── 合法纹型符号白名单 ──────────────────────────────────────────────────
const VALID_SYMS = new Set([
  'Ws','Wt','We','Wsp','Wsr','Wl',     // 螺旋/靶心/伸长/侧向螺旋/反侧向螺旋/侧向斗
  'Wc','Wd','Wsc',                      // 双斗类
  'Wpe','Rpe','Rwl',                    // 孔雀眼/反孔雀眼/反侧向
  'Wi',                                 // 内破斗
  'Lu','Ls','Lf',                       // 正箕类
  'Rl',                                 // 反箕
  'X','Xn',                             // 弧型
]);

const FINGERS = ['R1','R2','R3','R4','R5','L1','L2','L3','L4','L5'];

// ── 脑区 → 手指键 固定映射（跨机构通用）──────────────────────────────────
// ⚠️ 拇指映射要按【列标题名称】对应，不能按表格位置/左右顺序：
//   "创造领导/目标憧憬" = 开创力 → R1（右拇指）
//   "沟通管理/计划判断" = 管理力 → L1（左拇指）
// 错误反转会导致高低互换、职业推荐完全相反（陈凯歌案例已确认）
const ZONE_TO_FINGER = {
  create_lead:     'R1',  // 创造领导/目标憧憬   → 右拇指（开创力）
  logic_verbal:    'R2',  // 逻辑推理/语言功能   → 右食指
  kinetic_ops:     'R3',  // 体觉辨识/操作理解   → 右中指
  audio_lang:      'R4',  // 听觉辨识/语言理解   → 右无名指
  visual_obs:      'R5',  // 视觉辨识/观察理解   → 右小指
  comm_plan:       'L1',  // 沟通管理/计划判断   → 左拇指（管理力）
  spatial_imagine: 'L2',  // 空间心像/构思拟想   → 左食指
  kinetic_art:     'L3',  // 体觉感受/艺术欣赏   → 左中指
  audio_music:     'L4',  // 听觉感受/音乐欣赏   → 左无名指
  visual_image:    'L5',  // 视觉感受/图像欣赏   → 左小指
};

// ── Vision 提取 Prompt ──────────────────────────────────────────────────
// 策略：按脑区【标签名称】提取，而非按手指位置 —— 跨机构版本通用
const EXTRACT_PROMPT = `你是皮纹科学数据提取专家。图片是一份 TRC 皮纹测评报告总表页，可能来自不同机构，排版各异。

报告中包含【五大功能区 × 10 个脑区】，每个脑区有一个纹型符号和 TRC 数值。你的任务是按脑区名称找到对应数值，严格从图中读取，不可猜测。

**只输出 JSON，不输出解释文字。** 格式：

{
  "zones": {
    "logic_verbal":    {"sym": "（逻辑推理/语言功能 的纹型）", "trc": （整数）},
    "spatial_imagine": {"sym": "（空间心像/构思拟想 的纹型）", "trc": （整数）},
    "audio_lang":      {"sym": "（听觉辨识/语言理解 的纹型）", "trc": （整数）},
    "audio_music":     {"sym": "（听觉感受/音乐欣赏 的纹型）", "trc": （整数）},
    "visual_obs":      {"sym": "（视觉辨识/观察理解 的纹型）", "trc": （整数）},
    "visual_image":    {"sym": "（视觉感受/图像欣赏 的纹型）", "trc": （整数）},
    "kinetic_ops":     {"sym": "（体觉辨识/操作理解 的纹型）", "trc": （整数）},
    "kinetic_art":     {"sym": "（体觉感受/艺术欣赏 的纹型）", "trc": （整数）},
    "comm_plan":       {"sym": "（沟通管理/计划判断 的纹型）", "trc": （整数）},
    "create_lead":     {"sym": "（创造领导/目标憧憬 的纹型）", "trc": （整数）}
  },
  "atd": （ATD或反应速度数值，小数，图中无则null）,
  "name": "（姓名，图中无则null）",
  "birthday": "（被测者生日，格式 YYYY-MM-DD，图中无则null；若只有年份则填 YYYY-01-01）"
}

提取规则：
- 按脑区中文标签名在图中定位，再读取该标签旁边的纹型符号和 TRC 数字。
- 各报告版本标签用词可能略有差异，识别关键词：逻辑/语言→logic_verbal；空间/心像→spatial_imagine；听觉辨识→audio_lang；听觉感受/音乐→audio_music；视觉辨识/观察→visual_obs；视觉感受/图像→visual_image；体觉辨识/操作→kinetic_ops；体觉感受/艺术→kinetic_art；沟通/计划→comm_plan；创造/领导→create_lead。
- 纹型符号合法值：Ws/Wt/We/Wsp/Wl/Wc/Wd/Wsc/Wpe/Rpe/Rwl/Wi/Lu/Ls/Lf/Rl/X/Xn。严格照搬图中文字，X型和Xn均有0 TRC。
- 每个脑区 trc 必须独立读取，不可复用相同数值。

⚠️ 每个纹型符号必须按以下三步逐字母拆解识别，禁止直接猜读整体符号：

【第一步 · 只看第一个字母】（四选一，先锁定再往下）
  R — 大写R，右侧有斜腿向外伸出
  L — 大写L，一竖一横成直角，无斜腿
  W — 大写W，像两个V相连
  X — 大写X，两笔交叉

【第二步 · 只看第二个字符】（在已确认第一步之后，单独看第二个字符）
  第一步=R → 第二字符：l（小写字母L，像数字1的细竖线）/ p / w
  第一步=L → 第二字符：u（圆弧，像字母U）/ s / f
  第一步=W → 第二字符：s / t / e / c / d / i / l / p
  第一步=X → 第二字符：n（→ Xn）或无（→ X）

【第三步 · 有无第三字符】（在已完成第二步之后，看是否还有第三个字符）
  有第三字符的情形：c（如 Wsc）/ e（如 Rpe）/ r（如 Wsr）/ p（如 Wsp）/ l（如 Rwl）
  没有第三字符 → 直接结束

【组合】将三步结果拼接为最终符号：c1 + c2 + c3（如有）= sym

⚠️ 最严重误读：Rl（R + 小写字母l）被误读为 Lu（L + u）→ 逆思型变超级模仿型，性格类型完全相反。
   第一步确认首字母 R 后，第二步看到细竖线字符（= 小写字母l，不是圆弧u）→ 必须填 Rl，不能填 Lu。

- 只输出 JSON，首字符必须是 {，末字符必须是 }。`;

// ── IP 限流（防滥用） ────────────────────────────────────────────────────
async function checkRate(ip) {
  // Beta 宽松上限：每 IP 每分钟最多 10 次（视觉识别，比对话更重）
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:extract:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 10) return false;
  await redisSet(key, count + 1, 120);
  return true;
}

// ── 每日软限额：皮纹识别 10次/天（UTC+8日期） ───────────────────────────
const SOFT_LIMIT_MSG = `你今天已经深度使用很多次了。\n为了保证每位用户的体验质量，建议明天继续使用。\n如果你愿意邀请朋友一起体验，也可以获得更多免费次数。`;

async function checkDailyQuota(ip) {
  return true; // 🔓 测试阶段：配额关闭（上线前删此行）
  const yyyymmdd = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const key      = `quota:extract:${ip}:${yyyymmdd}`;
  const bonusKey = `quota:bonus:report:${ip}`; // 报告邀请奖励同时覆盖 extract
  const [count, bonus] = await Promise.all([
    redisGet(key).catch(() => 0),
    redisGet(bonusKey).catch(() => 0),
  ]);
  const limit = 10 + (bonus || 0);
  if ((count || 0) >= limit) return false;
  await redisSet(key, (count || 0) + 1, 90000);
  return true;
}

// ── JSON 从 Vision 输出中提取 ─────────────────────────────────────────
function extractJSON(text) {
  // 尝试直接解析
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch {}
  }
  // 从 markdown 代码块提取
  const codeMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1].trim()); } catch {}
  }
  // 找最外层 {...}
  const braceMatch = trimmed.match(/\{[\s\S]+\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  return null;
}

// ── 验证 & 归一化 fingers ──────────────────────────────────────────────
// Rl/Lu 纠错：如果 Vision 返回看起来像 Ri/RI/rL/rl 之类的变体，统一纠正为 Rl
// ⚠️ 重要：'R1'（数字1）也加入变体——模型可能把反箕"Rl"的字母l误读为数字1
//    'R1'（数字1）作为 sym 值 = 误读；'R1' 作为手指位置键（fingers对象的key）= 右拇指，完全不同
const RL_VARIANTS = new Set(['Ri','RI','rL','Rl','rl','rI','R1']);
function normalizeFingers(fingersRaw) {
  const result = {};
  let unknownCount = 0;
  for (const key of FINGERS) {
    const entry = fingersRaw[key];
    if (!entry) {
      result[key] = { sym: 'Lu', trc: 0 };
      continue;
    }
    let sym = String(entry.sym || '').trim();
    const trc = Math.max(0, Math.round(Number(entry.trc) || 0));
    // 大小写归一化：首字母大写 + 其余小写（防止模型输出 'wpe'/'WSP' 等变体漏过白名单）
    if (sym.length >= 1) sym = sym[0].toUpperCase() + sym.slice(1).toLowerCase();
    // Rl 变体纠错（防止大小写/字形变体漏判逆思型）
    if (RL_VARIANTS.has(sym)) sym = 'Rl';
    if (!VALID_SYMS.has(sym)) {
      unknownCount++;
      console.warn(`[extract-fp] unknown sym "${sym}" for ${key}, fallback Lu`);
      sym = 'Lu';
    }
    result[key] = { sym, trc };
  }
  // 后提取校验：若10指全Lu，记录警告（极可能是 Rl 被误读）
  const allLu = Object.values(result).every(f => f.sym === 'Lu');
  if (allLu) {
    console.warn('[extract-fp] ⚠️  ALL 10 fingers = Lu → 超级模仿型风险，请核查是否有 Rl 被误读');
  }
  return result;
}

// ── 主 Handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // 限流
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket?.remoteAddress || 'unknown';

  // VIP bypass（与 guest-chat 共用同一 Redis key 规则）
  const vipToken = req.headers['x-vip-token'] || '';
  let vipPass = false;
  if (vipToken) {
    const vipVal = await redisGet(`vip:token:${vipToken.trim()}`).catch(() => null);
    vipPass = !!vipVal;
  }

  if (!vipPass) {
    const allowed = await checkRate(ip).catch(() => true);
    if (!allowed) {
      return res.status(429).json({ ok: false, error: '请求过于频繁，请稍后再试' });
    }
    // 每日软限额（3次/天）
    const quotaOk = await checkDailyQuota(ip).catch(() => true);
    if (!quotaOk) {
      return res.status(200).json({ ok: false, soft: true, error: SOFT_LIMIT_MSG });
    }
  }

  // 读取 body（最大 4MB，图片可能较大）
  let body = '';
  let bodyBytes = 0;
  const MAX_BODY = 4 * 1024 * 1024;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', chunk => {
        bodyBytes += chunk.length;
        if (bodyBytes > MAX_BODY) {
          reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 }));
          req.destroy();
        } else {
          body += chunk;
        }
      });
      req.on('end', resolve);
      req.on('error', reject);
    });
  } catch(e) {
    const code = e.code === 413 ? 413 : 500;
    return res.status(code).json({ ok: false, error: code === 413 ? '图片过大，请压缩后再试（建议 < 3MB）' : '请求读取失败' });
  }

  let payload = {};
  try { payload = JSON.parse(body); } catch {
    return res.status(400).json({ ok: false, error: '请求格式错误' });
  }

  const { imageBase64, imageMimeType = 'image/jpeg' } = payload;
  if (!imageBase64) {
    return res.status(400).json({ ok: false, error: '缺少 imageBase64 字段' });
  }

  // ── 调用 Claude Sonnet Vision ──────────────────────────────────────────
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    },
  ];

  let visionRaw = null;
  try {
    const { text } = await callClaude({ model: MODEL_DEEP, messages, maxTokens: 800, timeoutMs: 55000 });
    visionRaw = text;
    if (!visionRaw) {
      console.error('[extract-fp] empty vision reply');
      return res.status(200).json({ ok: false, error: 'Vision 未返回内容，请重试' });
    }
  } catch(err) {
    console.error('[extract-fp] AI error:', err.message, '| body:', err.body || '(no body)');
    const userMsg = err.status === 400
      ? '图片识别失败，请确认上传的是总表页并重试'
      : '图片识别暂时失败，请重试';
    return res.status(200).json({ ok: false, error: userMsg });
  }

  // ── 解析 JSON ─────────────────────────────────────────────────────────
  const parsed = extractJSON(visionRaw);
  if (!parsed || (!parsed.zones && !parsed.fingers)) {
    console.warn('[extract-fp] parse fail, raw:', visionRaw.slice(0, 600));
    return res.status(200).json({
      ok:    false,
      error: '无法从图片中读取数据，请确保上传的是总表页，或尝试重新拍摄更清晰的图片',
      raw:   visionRaw,
    });
  }

  // ── 脑区 → 手指键转换（新格式）或直接用 fingers（旧格式兼容）────────────
  let rawFingers;
  if (parsed.zones) {
    rawFingers = {};
    for (const [zoneKey, fingerKey] of Object.entries(ZONE_TO_FINGER)) {
      const z = parsed.zones[zoneKey];
      rawFingers[fingerKey] = z
        ? { sym: z.sym, trc: z.trc }
        : { sym: 'Lu', trc: 0 };
    }
  } else {
    rawFingers = parsed.fingers;
  }

  let fingers = normalizeFingers(rawFingers);

  // ── 二次校验：两条触发路径，prompt 不同 ─────────────────────────────────
  // 路径①  allLu（全10指=Lu）→ W型/X型/Rl 都可能被误读，需全量重询
  //         郭艳玲：Wpe/Wsp 被读成 Lu，导致超级模仿型
  // 路径②  !hasRl 且非 allLu → 只问 Rl，不打扰其他正确读出的符号
  //         白皓博：L2=Rl 混在 Wc/Xn/Lu 中被漏读
  const allLu  = Object.values(fingers).every(f => f.sym === 'Lu');
  const hasRl  = Object.values(fingers).some(f => f.sym === 'Rl');
  const needsVerify = allLu || !hasRl;

  if (needsVerify) {
    console.warn(`[extract-fp] verify pass triggered: allLu=${allLu} hasRl=${hasRl}`);
    try {
      const ZONE_KW_MAP = [
        { keywords: ['逻辑','语言功能'],         key: 'R2' },
        { keywords: ['空间','心像','构思'],       key: 'L2' },
        { keywords: ['听觉辨识','语言理解'],      key: 'R4' },
        { keywords: ['听觉感受','音乐'],          key: 'L4' },
        { keywords: ['视觉辨识','观察'],          key: 'R5' },
        { keywords: ['视觉感受','图像'],          key: 'L5' },
        { keywords: ['体觉辨识','操作'],          key: 'R3' },
        { keywords: ['体觉感受','艺术'],          key: 'L3' },
        { keywords: ['创造','领导','目标憧憬'],   key: 'R1' },  // 开创力 → 右拇
        { keywords: ['沟通','计划'],              key: 'L1' },  // 管理力 → 左拇
      ];
      function zoneToKey(zoneName) {
        for (const { keywords, key } of ZONE_KW_MAP) {
          if (keywords.some(kw => zoneName.includes(kw))) return key;
        }
        return null;
      }

      // ── 路径①：全 Lu → 全量重询（W型/Rl/X型都可能被漏读） ──────────────
      // ── 路径②：非全 Lu 但无 Rl → 只询 Rl ────────────────────────────────
      const VERIFY_PROMPT = allLu
        ? `我刚才把这份皮纹报告的全部10个脑区都读成了 Lu（正箕纹）。这极有可能是错误的——图中可能有斗型（W开头）或反箕（Rl）被误读成了 Lu。

⚠️ 最容易被误读为 Lu 的两种斗型符号（请重点核查）：
- Wpe（孔雀眼）：纹型中心有"眼睛形"或"泪滴形"闭合内核，外圈有环绕弧线，整体是闭合的——不是 Lu
- Wsp（侧向螺旋斗）：斗纹但旋转中心明显偏向一侧，中心也是闭合的——不是 Lu
判断关键：只要纹型圆圈是**闭合的**（没有开口），就是W型，不是Lu（Lu有明显开口/缺口）

请用三步法，仔细重新识别全部10个脑区的纹型符号：

【第一步 c1】只看第一个字母（R / L / W / X 四选一）
  W = 大写W，像两个V相连（≠ L，L只有一竖一横）；闭合纹型首字母必是W
  R = 大写R，右侧有斜腿
  L = 大写L，一竖一横成直角（Lu有开口/缺口）
  X = 大写X

【第二步 c2】再看第二个字符
  c1=W时：s/t/e/c/d/i/p（→ Ws/Wt/We/Wc/Wd/Wi/Wpe等）
    特别注意：Wpe→c2=p，Wsp→c2=s（第三步c3=p）
  c1=R时：l（细竖线）/p/w（→ Rl/Rpe/Rwl）
  c1=L时：u/s/f（→ Lu/Ls/Lf）
  c1=X时：n 或无（→ Xn/X）

【第三步 c3】有无第三字符（c/e/r/p/l）→ 有则填，无则 null
  Wpe：c1=W c2=p c3=e
  Wsp：c1=W c2=s c3=p

将 c1+c2+c3 拼为 sym。

输出严格 JSON（无注释）：
{"decomp":[{"zone":"脑区中文名","c1":"","c2":"","c3":null,"sym":""},...]}`
        : `我在读取这张皮纹报告时，没有检测到任何 Rl（反箕纹）。
请用三步法重新核查所有10个脑区，找出是否有 Rl 被漏读：

【第一步 c1】只看第一个字母：R（有斜腿）/ L（直角）/ W / X
【第二步 c2】c1=R时看第二字符：l（细竖线，非圆弧u）/ p / w
【第三步 c3】有无第三字符（e/l等）

⚠️ c1=R 且 c2=l → 必须是 Rl（反箕纹，逆思型）

输出严格 JSON：
{"decomp":[{"zone":"脑区中文名","c1":"","c2":"","c3":null,"sym":""},...],"has_rl":false,"rl_zones":[]}`;

      const { text: _rlRaw } = await callClaude({
          model: MODEL_DEEP,
          maxTokens: 800,
          timeoutMs: 30000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
              { type: 'text', text: VERIFY_PROMPT },
            ],
          }],
        });
        const rlRaw = _rlRaw || '';
        if (rlRaw) {
        const rlCheck = extractJSON(rlRaw);
        console.log('[extract-fp] verify result:', rlRaw.slice(0, 400));

        if (Array.isArray(rlCheck?.decomp)) {
          for (const entry of rlCheck.decomp) {
            const c1  = String(entry.c1 || '').trim();
            const c2  = String(entry.c2 || '').trim();
            // ⚠️ 大小写归一化：'wpe' → 'Wpe'，'WSP' → 'Wsp'（与 normalizeFingers 保持一致）
            let sym = String(entry.sym || '').trim();
            if (sym.length >= 1) sym = sym[0].toUpperCase() + sym.slice(1).toLowerCase();
            const k   = zoneToKey(entry.zone || '');
            if (!k) continue;

            // ── 程序性兜底 A：c1=R 且 c2=l/L/1 → 强制 Rl ──────────────────
            if (c1 === 'R' && (c2 === 'l' || c2 === 'L' || c2 === '1')) {
              console.log(`[extract-fp] force Rl ${k} (c1=R c2=${c2} sym="${sym}")`);
              fingers = { ...fingers, [k]: { ...fingers[k], sym: 'Rl' } };
              continue;
            }

            // ── 全量校验（allLu路径）：信任 decomp 的 sym（需在白名单内且≠Lu）──
            if (allLu && VALID_SYMS.has(sym) && sym !== 'Lu') {
              console.log(`[extract-fp] allLu correct ${k}: Lu → ${sym} (zone="${entry.zone}")`);
              fingers = { ...fingers, [k]: { ...fingers[k], sym } };
            }
          }
        }

        // ── 路径②兜底：has_rl/rl_zones 字段（decomp 未输出时） ───────────────
        if (!allLu && rlCheck?.has_rl && Array.isArray(rlCheck.rl_zones)) {
          for (const zone of rlCheck.rl_zones) {
            const k = zoneToKey(zone);
            if (k && fingers[k]?.sym !== 'Rl') {
              console.log(`[extract-fp] rl_zones ${k} → Rl`);
              fingers = { ...fingers, [k]: { ...fingers[k], sym: 'Rl' } };
            }
          }
        }
      }
    } catch(e) {
      console.warn('[extract-fp] verify pass error (non-blocking):', e.message);
    }
  }

  const atd     = (parsed.atd !== null && parsed.atd !== undefined)
                  ? parseFloat(String(parsed.atd)) : null;
  const name    = parsed.name  ? String(parsed.name).trim()  : null;

  // 年龄：从生日算（当前时间 - 报告生日），而不是读报告上写的年龄字段
  let age = null;
  if (parsed.birthday) {
    const bd = new Date(String(parsed.birthday));
    if (!isNaN(bd.getTime())) {
      const now = new Date();
      age = now.getFullYear() - bd.getFullYear();
      const monthDiff = now.getMonth() - bd.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd.getDate())) age--;
    }
  } else if (parsed.age) {
    // 兼容旧格式：报告只有年龄字段无生日
    age = parseInt(String(parsed.age)) || null;
  }

  // 合理性检查：TRC 总和不应为 0
  const totalTRC = Object.values(fingers).reduce((s, f) => s + f.trc, 0);
  if (totalTRC === 0) {
    return res.status(200).json({
      ok:    false,
      error: '数据提取失败（所有 TRC 值为 0），请检查图片是否为总表页',
      raw:   visionRaw,
    });
  }

  return res.status(200).json({ ok: true, fingers, atd, name, age, raw: visionRaw });
};
