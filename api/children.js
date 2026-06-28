/**
 * AIPIWEN 孩子档案 + 行为记录 API
 *
 * 路由：
 *   GET  /api/children                          → 获取当前用户所有孩子
 *   POST /api/children?action=add               → 新增孩子档案
 *   POST /api/children?action=update&id=xxx     → 更新孩子基本信息
 *   POST /api/children?action=delete&id=xxx     → 删除孩子档案
 *   GET  /api/children?action=records&id=xxx    → 获取某孩子的行为记录列表
 *   POST /api/children?action=add_record&id=xxx → 新增一条行为记录
 *   POST /api/children?action=analyze&id=xxx    → AI综合分析（基于所有记录）
 */

const crypto = require('crypto');
const { redisSet, redisGet, getOpenid, generatePortrait, portraitNeedsRefresh, getGlobalPatterns, archiveRecordsIfNeeded, searchKnowledge, callClaude, MODEL_FREE } = require('./_lib');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end',  () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  const openid = getOpenid(req);
  if (!openid) return res.status(401).json({ error: '未登录' });

  const user = await redisGet(`user:${openid}`);
  if (!user) return res.status(401).json({ error: '用户不存在' });

  const { action, id } = req.query;

  // ── 年龄辅助：从生日动态计算整数年龄 ───────────────────────────────────
  function calcAge(bdStr) {
    if (!bdStr) return null;
    const bd = new Date(String(bdStr));
    if (isNaN(bd.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - bd.getFullYear();
    const md = now.getMonth() - bd.getMonth();
    if (md < 0 || (md === 0 && now.getDate() < bd.getDate())) a--;
    return a > 0 ? a : null;
  }

  // ── 获取所有孩子（若有 birthday，动态重算 age） ──────────────────────────
  if (req.method === 'GET' && !action) {
    const children = (user.children || []).map(c => {
      if (c.birthday) {
        const currentAge = calcAge(c.birthday);
        if (currentAge !== null) return { ...c, age: currentAge };
      }
      return c;
    });
    return res.status(200).json({ children });
  }

  // ── 新增孩子 ─────────────────────────────────────────────────────────────
  if (action === 'add' && req.method === 'POST') {
    const { name, age, birthday, fingerprint } = await readBody(req);
    if (!name) return res.status(400).json({ error: '孩子姓名不能为空' });
    // birthday 优先；存在时动态算龄，否则用传入的 age
    const resolvedAge = birthday ? (calcAge(birthday) ?? age ?? '') : (age || '');
    const child = {
      id:          crypto.randomBytes(6).toString('hex'),
      name,
      birthday:    birthday || null,
      age:         resolvedAge,
      fingerprint: fingerprint || {},
      createdAt:   new Date().toISOString(),
    };
    user.children = [...(user.children || []), child];
    await redisSet(`user:${openid}`, user);
    return res.status(200).json({ child });
  }

  // ── 更新孩子信息 ─────────────────────────────────────────────────────────
  if (action === 'update' && id && req.method === 'POST') {
    const body  = await readBody(req);
    const index = (user.children || []).findIndex(c => c.id === id);
    if (index === -1) return res.status(404).json({ error: '孩子不存在' });
    user.children[index] = { ...user.children[index], ...body, id };
    await redisSet(`user:${openid}`, user);
    return res.status(200).json({ child: user.children[index] });
  }

  // ── 删除孩子 ─────────────────────────────────────────────────────────────
  if (action === 'delete' && id && req.method === 'POST') {
    user.children = (user.children || []).filter(c => c.id !== id);
    await redisSet(`user:${openid}`, user);
    await redisSet(`records:${openid}:${id}`, [], 1);
    return res.status(200).json({ ok: true });
  }

  // ── 获取行为记录 ─────────────────────────────────────────────────────────
  if (action === 'records' && id) {
    const records = await redisGet(`records:${openid}:${id}`) || [];
    return res.status(200).json({ records });
  }

  // ── 新增行为记录 ─────────────────────────────────────────────────────────
  if (action === 'add_record' && id && req.method === 'POST') {
    const { content } = await readBody(req);
    if (!content?.trim()) return res.status(400).json({ error: '记录内容不能为空' });

    const child = (user.children || []).find(c => c.id === id);
    if (!child) return res.status(404).json({ error: '孩子不存在' });

    const records = await redisGet(`records:${openid}:${id}`) || [];
    const record  = {
      id:        crypto.randomBytes(6).toString('hex'),
      content:   content.trim(),
      createdAt: new Date().toISOString(),
    };
    records.unshift(record);
    await redisSet(`records:${openid}:${id}`, records);
    return res.status(200).json({ record });
  }

  // ── 查看孩子成长画像 ─────────────────────────────────────────────────────
  if (action === 'portrait' && id) {
    const child = (user.children || []).find(c => c.id === id);
    if (!child) return res.status(404).json({ error: '孩子不存在' });
    const portrait = await redisGet(`portrait:${openid}:${id}`);
    if (!portrait) {
      // 尝试实时生成（如果记录够3条）
      const records = await redisGet(`records:${openid}:${id}`) || [];
      if (records.length >= 3) {
        const newPortrait = await generatePortrait(openid, id);
        return res.status(200).json({ portrait: newPortrait, fresh: true });
      }
      return res.status(200).json({ portrait: null, recordCount: records.length });
    }
    return res.status(200).json({ portrait });
  }

  // ── AI综合分析 ───────────────────────────────────────────────────────────
  if (action === 'analyze' && id) {
    const child = (user.children || []).find(c => c.id === id);
    if (!child) return res.status(404).json({ error: '孩子不存在' });

    const records = await redisGet(`records:${openid}:${id}`) || [];
    if (records.length === 0) return res.status(400).json({ error: '还没有行为记录，请先添加一些观察' });

    const fp = child.fingerprint || {};
    const fingerprintDesc = fp.trc
      ? `指纹数据：TRC总嵴线数=${fp.trc}，ATD角度=${fp.atd || '未知'}，大拇指类型=${fp.thumbType || '未知'}。`
      : '（暂无指纹数据）';

    const recordsText = records
      .slice(0, 20)
      .map((r, i) => `${i + 1}. [${r.createdAt.slice(0, 10)}] ${r.content}`)
      .join('\n');

    const prompt = `你是一位专业的儿童行为分析顾问，擅长结合孩子的天赋特征和日常行为进行综合分析。

孩子信息：
- 姓名：${child.name}
- 年龄：${child.age || '未知'}岁
- ${fingerprintDesc}

家长记录的行为观察（共${records.length}条，以下展示最近${Math.min(records.length, 20)}条）：
${recordsText}

请综合以上信息，用温柔、理性、有洞察力的语气：
1. 分析孩子最突出的3个行为模式（用家长能理解的语言，不用专业术语）
2. 解释这些行为背后的原因（结合天赋特征）
3. 给出3条具体可操作的指导建议
4. 最后一句话给家长一个温暖的鼓励

语气要像一位真正理解这个家庭的朋友，不要说教，不要夸张，要让家长感觉"对！就是这样！"`;

    const { text: analysisText } = await callClaude({
      model: MODEL_FREE, messages: [{ role: 'user', content: prompt }], maxTokens: 1000,
    }).catch(() => ({ text: null }));
    const analysis = analysisText || '分析生成失败，请稍后重试。';

    await redisSet(`analysis:${openid}:${id}`, {
      analysis,
      recordCount: records.length,
      generatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ analysis, recordCount: records.length });
  }

  // ── 对话聊天（即时AI回复）────────────────────────────────────────────────
  if (action === 'chat' && id && req.method === 'POST') {
    const { content } = await readBody(req);
    if (!content?.trim()) return res.status(400).json({ error: '内容不能为空' });

    const child = (user.children || []).find(c => c.id === id);
    if (!child) return res.status(404).json({ error: '孩子不存在' });

    // 并行读取：历史记录 + 孩子成长画像 + 全局高频模式 + 专家知识检索
    const [records, portrait, globalPatterns, expertChunksRaw] = await Promise.all([
      redisGet(`records:${openid}:${id}`).then(r => r || []),
      redisGet(`portrait:${openid}:${id}`),
      getGlobalPatterns(),
      searchKnowledge(content.trim()).catch(() => []),
    ]);

    // 构建最近15条对话历史
    const historyText = records.slice(0, 15).reverse()
      .map(r => `${r.role === 'ai' ? 'AI顾问' : '家长'}：${r.content}`)
      .join('\n');

    const fp = child.fingerprint || {};
    const fingerprintDesc = fp.trc
      ? `孩子指纹数据：TRC总嵴线数=${fp.trc}，ATD角度=${fp.atd || '未知'}，大拇指类型=${fp.thumbType || '未知'}。`
      : '';

    // 成长画像摘要（若存在）
    const portraitSection = portrait?.summary
      ? `\n【${child.name}的成长画像摘要（基于${portrait.recordCount}条历史记录）】\n${portrait.summary}\n`
      : '';

    // 全局高频情境（若存在）
    const patternsSection = globalPatterns
      ? `\n【AIPIWEN平台近期家长最常提到的情境，供参考】\n${globalPatterns}\n`
      : '';

    // 专家知识库片段（若检索到）
    const expertChunks = expertChunksRaw || [];
    const expertSection = expertChunks.length > 0
      ? `\n【相关专家观点，仅供参考，不要直接引用，融入回答即可】\n` +
        expertChunks.map(c => `[${c.source}] ${c.text}`).join('\n') + '\n'
      : '';

    const prompt = `你是AIPIWEN的儿童行为理解顾问，专注帮助家长真正读懂孩子。

孩子信息：姓名${child.name}，${child.age || ''}岁。${fingerprintDesc}
${portraitSection}${patternsSection}${expertSection}
${historyText ? `此前对话记录（最近15条）：\n${historyText}\n` : ''}
家长刚说：${content.trim()}

请用温柔、有洞察力的语气回复这位家长。要求：
- 优先结合成长画像摘要中已知的孩子特征来回应
- 如有专家观点，自然融入回答，不要说"某某专家认为"，而是化为你自己的洞察
- 先回应家长说的这件具体的事
- 给出1-2条具体可操作的建议
- 语气像真正关心这个家庭的朋友，不说教，不夸张
- 回复控制在150字以内，简洁有温度`;

    const { text: replyText } = await callClaude({
      model: MODEL_FREE, messages: [{ role: 'user', content: prompt }], maxTokens: 300,
    }).catch(() => ({ text: null }));
    const aiReply = replyText || '收到，我来帮你分析一下……';

    // 保存家长消息 + AI回复
    const parentMsg = { id: crypto.randomBytes(6).toString('hex'), role: 'parent', content: content.trim(), createdAt: new Date().toISOString() };
    const aiMsg     = { id: crypto.randomBytes(6).toString('hex'), role: 'ai',     content: aiReply,        createdAt: new Date().toISOString() };
    records.unshift(aiMsg);
    records.unshift(parentMsg);
    // 归档检查（超过200条时自动压缩旧记录）
    const trimmed = await archiveRecordsIfNeeded(openid, id, records);
    await redisSet(`records:${openid}:${id}`, trimmed);

    // 异步触发画像刷新（不阻塞本次回复）
    // 每积累10条新记录、或画像超过3天，就重新生成
    const shouldRefresh = !portrait || records.length % 10 === 0 || await portraitNeedsRefresh(openid, id);
    if (shouldRefresh) {
      generatePortrait(openid, id).catch(() => {});
    }

    return res.status(200).json({ reply: aiReply });
  }

  return res.status(400).json({ error: '无效的 action' });
};
