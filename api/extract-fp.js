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

const { redisGet, redisSet } = require('./_lib');

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
// 正确对应关系（经 Emma 确认）：
const ZONE_TO_FINGER = {
  comm_plan:       'R1',  // 沟通管理/计划判断   → 右拇指
  logic_verbal:    'R2',  // 逻辑推理/语言功能   → 右食指
  kinetic_ops:     'R3',  // 体觉辨识/操作理解   → 右中指
  audio_lang:      'R4',  // 听觉辨识/语言理解   → 右无名指
  visual_obs:      'R5',  // 视觉辨识/观察理解   → 右小指
  create_lead:     'L1',  // 创造领导/目标憧憬   → 左拇指
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
- 只输出 JSON，首字符必须是 {，末字符必须是 }。`;

// ── IP 限流（防滥用） ────────────────────────────────────────────────────
async function checkRate(ip) {
  const minute = Math.floor(Date.now() / 60000);
  const key    = `ratelimit:extract:${ip}:${minute}`;
  const count  = (await redisGet(key).catch(() => 0)) || 0;
  if (count >= 5) return false;         // 每 IP 每分钟最多 5 次
  await redisSet(key, count + 1, 120);
  return true;
}

// ── 每日软限额：皮纹识别 10次/天（UTC+8日期） ───────────────────────────
const SOFT_LIMIT_MSG = `你今天已经深度使用很多次了。\n为了保证每位用户的体验质量，建议明天继续使用。\n如果你愿意邀请朋友一起体验，也可以获得更多免费次数。`;

async function checkDailyQuota(ip) {
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
function normalizeFingers(fingersRaw) {
  const result = {};
  for (const key of FINGERS) {
    const entry = fingersRaw[key];
    if (!entry) {
      result[key] = { sym: 'Lu', trc: 0 };
      continue;
    }
    const sym = String(entry.sym || 'Lu').trim();
    const trc = Math.max(0, Math.round(Number(entry.trc) || 0));
    result[key] = { sym: VALID_SYMS.has(sym) ? sym : 'Lu', trc };
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

  // ── 调用 DashScope qwen-vl-plus ────────────────────────────────────────
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:      'qwen-vl-plus',
        max_tokens: 800,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!aiRes.ok) {
      const errText = (await aiRes.text()).slice(0, 400);
      console.error('[extract-fp] DashScope HTTP', aiRes.status, errText);
      return res.status(200).json({ ok: false, error: `Vision 服务异常（${aiRes.status}），请重试` });
    }

    const aiData = await aiRes.json().catch(() => null);
    visionRaw = aiData?.choices?.[0]?.message?.content?.trim() || null;

    if (!visionRaw) {
      console.error('[extract-fp] empty vision reply:', JSON.stringify(aiData).slice(0, 300));
      return res.status(200).json({ ok: false, error: 'Vision 未返回内容，请重试' });
    }
  } catch(err) {
    console.error('[extract-fp] fetch error:', err.message);
    return res.status(200).json({ ok: false, error: `Vision 请求失败: ${err.message}` });
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

  const fingers = normalizeFingers(rawFingers);
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
