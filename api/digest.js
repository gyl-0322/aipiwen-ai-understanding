/**
 * AIPIWEN 定时摘要任务接口
 *
 * 由 Vercel Cron / 外部定时器调用，需携带 CRON_SECRET 验证身份。
 *
 * GET /api/digest?action=portrait_all   每日凌晨2点：批量刷新所有孩子成长画像
 * GET /api/digest?action=patterns       每周日凌晨3点：提取跨用户高频情境 → global:patterns
 * GET /api/digest?action=weekly         每周日凌晨4点：给每位用户发企业微信周报
 *
 * 环境变量：
 *   CRON_SECRET          保护接口不被外部随意调用（设一个随机字符串）
 *   WECHAT_CORP_ID       企业微信 CorpID
 *   WECHAT_AGENT_SECRET  企业微信客服机器人 Secret（非 agent secret，是客服应用 secret）
 *   WECHAT_OPEN_KFID     企业微信客服 ID
 *   DASHSCOPE_API_KEY    通义千问 API Key
 */

const { redisSet, redisGet, generatePortrait } = require('./_lib');

// ─── 身份验证 ──────────────────────────────────────────────────────────────────
function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 未设置时本地开发允许通过
  const authHeader = req.headers['authorization'] || '';
  const qParam     = req.query.secret || '';
  return authHeader === `Bearer ${secret}` || qParam === secret;
}

// ─── 企业微信：获取 access_token ──────────────────────────────────────────────
async function getWxToken() {
  const corpId  = process.env.WECHAT_CORP_ID || '';
  const secret  = process.env.WECHAT_AGENT_SECRET || '';
  if (!corpId || !secret) return null;
  const res  = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
  const data = await res.json();
  return data.access_token || null;
}

// ─── 企业微信：发客服文本消息 ─────────────────────────────────────────────────
async function sendKfMsg(accessToken, openid, text) {
  const kfid = process.env.WECHAT_OPEN_KFID || '';
  const res  = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${accessToken}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        touser:    openid,
        open_kfid: kfid,
        msgtype:   'text',
        text:      { content: text },
      }),
    }
  );
  return res.json();
}

// ─── 主处理函数 ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: '未授权' });
  }

  const { action } = req.query;

  // ── Action 1: 批量刷新所有孩子成长画像 ──────────────────────────────────────
  if (action === 'portrait_all') {
    const openids = await redisGet('users:all') || [];
    let done = 0, skipped = 0, errors = 0;

    for (const openid of openids) {
      const user = await redisGet(`user:${openid}`);
      if (!user?.children?.length) continue;

      for (const child of user.children) {
        try {
          const records = await redisGet(`records:${openid}:${child.id}`) || [];
          if (records.length < 3) { skipped++; continue; }

          // 检查是否需要刷新
          const portrait = await redisGet(`portrait:${openid}:${child.id}`);
          const ageDays  = portrait?.generatedAt
            ? (Date.now() - new Date(portrait.generatedAt).getTime()) / 86400000
            : 999;

          // 超过3天或记录数有明显增长才刷新
          const recordGrowth = portrait ? (records.length - portrait.recordCount) >= 5 : true;
          if (ageDays < 3 && !recordGrowth) { skipped++; continue; }

          await generatePortrait(openid, child.id);
          done++;
          // 避免频繁调用 API，每个画像之间间隔 500ms
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          errors++;
          console.error(`portrait error ${openid}/${child.id}:`, e.message);
        }
      }
    }

    return res.status(200).json({ ok: true, action: 'portrait_all', done, skipped, errors, total: openids.length });
  }

  // ── Action 2: 跨用户提取本周高频情境 ────────────────────────────────────────
  if (action === 'patterns') {
    const openids = await redisGet('users:all') || [];
    if (openids.length === 0) {
      return res.status(200).json({ ok: true, action: 'patterns', message: '暂无用户数据' });
    }

    // 收集最近7天所有家长发言
    const cutoff  = Date.now() - 7 * 24 * 3600 * 1000;
    const samples = [];

    for (const openid of openids.slice(0, 100)) { // 最多处理100用户
      const user = await redisGet(`user:${openid}`);
      for (const child of (user?.children || [])) {
        const records = await redisGet(`records:${openid}:${child.id}`) || [];
        records
          .filter(r => r.role === 'parent' && new Date(r.createdAt).getTime() > cutoff)
          .forEach(r => samples.push(r.content));
        if (samples.length > 300) break; // 足够了
      }
      if (samples.length > 300) break;
    }

    if (samples.length < 5) {
      return res.status(200).json({ ok: true, action: 'patterns', message: '本周样本不足' });
    }

    // 随机抽样最多200条
    const selected = samples.sort(() => Math.random() - 0.5).slice(0, 200);
    const samplesText = selected.map((s, i) => `${i + 1}. ${s}`).join('\n');

    const prompt = `以下是AIPIWEN平台本周家长提交的孩子行为描述（共${selected.length}条，匿名）：

${samplesText}

请归纳总结出本周家长最常遇到的5类情境，每类用一句话描述。格式：
1. [情境名称]：[简短描述，15字以内]

只输出5行，不要解释，不要序号以外的符号。`;

    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'qwen-turbo', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });

    const aiData   = await aiRes.json();
    const patterns = aiData.choices?.[0]?.message?.content || '';
    if (!patterns) return res.status(500).json({ error: 'AI 返回为空' });

    await redisSet('global:patterns', {
      patterns,
      generatedAt: new Date().toISOString(),
      sampleCount: selected.length,
      userCount:   openids.length,
    });

    return res.status(200).json({ ok: true, action: 'patterns', patterns, sampleCount: selected.length });
  }

  // ── Action 3: 发送每周成长报告到企业微信 ─────────────────────────────────────
  if (action === 'weekly') {
    const openids = await redisGet('users:all') || [];
    if (openids.length === 0) return res.status(200).json({ ok: true, sent: 0 });

    const accessToken = await getWxToken();
    if (!accessToken) {
      return res.status(500).json({ error: '获取企业微信 access_token 失败，请检查 WECHAT_CORP_ID / WECHAT_AGENT_SECRET' });
    }

    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    let sent = 0, skipped = 0;

    for (const openid of openids) {
      const user = await redisGet(`user:${openid}`);
      if (!user?.children?.length) { skipped++; continue; }

      // 每个孩子本周的记录数
      const childSummaries = [];
      for (const child of user.children) {
        const records = await redisGet(`records:${openid}:${child.id}`) || [];
        const weekRecords = records.filter(r => r.role === 'parent' && new Date(r.createdAt).getTime() > cutoff);
        if (weekRecords.length === 0) continue;

        // 读取画像摘要
        const portrait = await redisGet(`portrait:${openid}:${child.id}`);
        const parentMsgs = weekRecords.map(r => r.content).slice(0, 5).join('；');

        // 生成本周小结
        const summaryPrompt = `家长本周关于孩子${child.name}（${child.age || ''}岁）的${weekRecords.length}条记录，关键内容：${parentMsgs}。${portrait?.summary ? `孩子画像：${portrait.summary.slice(0, 100)}` : ''}

请用2-3句话生成一段本周成长小结，温暖有洞察，结尾有一句鼓励家长的话。50字以内。`;

        const aiRes  = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
          method:  'POST',
          headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ model: 'qwen-turbo', max_tokens: 150, messages: [{ role: 'user', content: summaryPrompt }] }),
        });
        const aiData = await aiRes.json();
        const summary = aiData.choices?.[0]?.message?.content || '';
        if (summary) childSummaries.push({ name: child.name, count: weekRecords.length, summary });

        await new Promise(r => setTimeout(r, 300));
      }

      if (childSummaries.length === 0) { skipped++; continue; }

      // 组装完整微信消息
      const msgLines = childSummaries.map(c =>
        `👶 ${c.name}（本周记录${c.count}次）\n${c.summary}`
      ).join('\n\n');

      const msgText = `🌱 AIPIWEN 本周成长报告\n\n${msgLines}\n\n点击 www.aipiwen.cn/chat 继续对话，AI 在这里陪你记录成长。`;

      try {
        await sendKfMsg(accessToken, openid, msgText);
        sent++;
      } catch (e) {
        console.error(`发送周报失败 ${openid}:`, e.message);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return res.status(200).json({ ok: true, action: 'weekly', sent, skipped, total: openids.length });
  }

  // ── Action 4: 全域会话分析 → 更新 global:patterns ────────────────────────
  // 读取近7天所有 convlog 会话（含皮纹速测、报告解读、行为分析）
  // AI 提炼跨页面高频模式，写入 global:patterns，自动注入全域对话
  if (action === 'analyze_convs') {
    const index = await redisGet('convlog:index') || [];
    if (index.length === 0) {
      return res.status(200).json({ ok: true, action: 'analyze_convs', message: '暂无会话数据' });
    }

    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const recent = index.filter(s => s.ts && s.ts > cutoff).slice(0, 200);

    if (recent.length < 3) {
      return res.status(200).json({ ok: true, action: 'analyze_convs', message: '近7天样本不足' });
    }

    // 按 context 分组，收集用户消息
    const grouped = {};
    for (const s of recent) {
      const ctx = s.context || 'unknown';
      if (!grouped[ctx]) grouped[ctx] = [];
      const msgs = await redisGet(`convlog:msgs:${s.sessionId}`) || [];
      const userMsgs = msgs.filter(m => m.role === 'user').map(m => m.content);
      if (userMsgs.length > 0) grouped[ctx].push(...userMsgs.slice(0, 2));
    }

    const CTX_NAMES = {
      child: '亲子行为', self: '自我解读', partner: '伴侣解读',
      business: '合伙解读', fingerprint: '皮纹速测', report: '报告解读',
    };

    // 组装分析文本
    const sections = Object.entries(grouped).map(([ctx, msgs]) => {
      const name = CTX_NAMES[ctx] || ctx;
      const sample = msgs.slice(0, 40).map((m, i) => `${i + 1}. ${m.slice(0, 80)}`).join('\n');
      return `【${name}】共${msgs.length}条\n${sample}`;
    }).join('\n\n');

    const prompt = `以下是AIPIWEN平台近7天来自各功能模块的用户行为样本（匿名）：

${sections}

请完成以下分析，输出格式严格遵循：

# 高频需求TOP5
1. [需求]：[15字内描述]
2. ...

# 各模块用户特征
- 皮纹速测：[1句话]
- 行为分析：[1句话]
- 报告解读：[1句话]

# AI回复建议
针对本周高频需求，AI应重点强调的1-2个回答方向（各20字内）：
1. [方向]
2. [方向]

只输出以上内容，不要额外说明。`;

    const aiRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY || ''}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'qwen-plus', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    });

    const aiData   = await aiRes.json();
    const analysis = aiData.choices?.[0]?.message?.content || '';
    if (!analysis) return res.status(500).json({ error: 'AI 返回为空' });

    // 写入 global:patterns（已被 guest-chat.js 注入全域对话）
    await redisSet('global:patterns', {
      patterns:    analysis,
      generatedAt: new Date().toISOString(),
      sampleCount: recent.length,
      source:      'analyze_convs',
    });

    return res.status(200).json({ ok: true, action: 'analyze_convs', analysis, sampleCount: recent.length });
  }

  return res.status(400).json({ error: '无效的 action，支持：portrait_all / patterns / weekly / analyze_convs' });
};
