/**
 * AIPIWEN 专家知识库接口
 *
 * 管理荣格、彭凯平、斯蒂芬·吉利根、阿德勒等专家的转写内容片段，
 * 供 AI 对话时检索注入（关键词匹配型 RAG）。
 *
 * GET  /api/knowledge?action=search&q=关键词        → 搜索相关知识片段
 * POST /api/knowledge?action=load&secret=xxx        → 批量加载知识片段（管理员）
 * GET  /api/knowledge?action=list&secret=xxx        → 列出所有片段概览
 * POST /api/knowledge?action=delete&id=xxx&secret=x → 删除一个片段
 *
 * Redis key 结构：
 *   knowledge:chunks        → [{id, source, tags:[], text, createdAt}]
 *   knowledge:index:{word}  → [chunk_id, ...]  （倒排索引）
 *
 * 每个 chunk：
 *   id        随机6字节hex
 *   source    来源（如 "彭凯平·积极心理学讲座"）
 *   tags      标签数组（如 ["情绪调节","亲子关系"]）
 *   text      正文（建议100-400字/片段，太长影响检索精度）
 *   createdAt ISO时间
 */

const crypto = require('crypto');
const { redisSet, redisGet } = require('./_lib');

function isAdmin(req) {
  const s = process.env.ADMIN_SECRET;
  if (!s) return false; // 未配置视为拒绝，防止意外公开
  return req.query.secret === s || req.headers['x-admin-secret'] === s;
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

// 把文本切分成关键词（中文按字+词，英文按空格）
function extractWords(text) {
  const words = new Set();
  // 提取2-4字中文词组
  const zhMatches = text.match(/[一-龥]{2,4}/g) || [];
  zhMatches.forEach(w => words.add(w));
  // 提取英文单词
  const enMatches = text.toLowerCase().match(/[a-z]{3,}/g) || [];
  enMatches.forEach(w => words.add(w));
  return [...words];
}

module.exports = async function handler(req, res) {
  const { action } = req.query;

  // ── 搜索知识片段（无需鉴权，供 chat 使用）───────────────────────────────────
  if (action === 'search') {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q 参数必填' });

    const queryWords = extractWords(q);
    if (queryWords.length === 0) return res.status(200).json({ chunks: [] });

    // 从倒排索引里找候选 chunk id
    const candidateScores = {};
    for (const word of queryWords.slice(0, 20)) { // 最多用20个词
      const ids = await redisGet(`knowledge:index:${word}`) || [];
      ids.forEach(id => { candidateScores[id] = (candidateScores[id] || 0) + 1; });
    }

    if (Object.keys(candidateScores).length === 0) {
      return res.status(200).json({ chunks: [] });
    }

    // 取 top 3 相关 chunk
    const topIds = Object.entries(candidateScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    const chunks = await redisGet('knowledge:chunks') || [];
    const results = topIds
      .map(id => chunks.find(c => c.id === id))
      .filter(Boolean);

    return res.status(200).json({ chunks: results, query: q });
  }

  // ── 批量加载知识片段（管理员）────────────────────────────────────────────────
  if (action === 'load' && req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: '未授权' });

    const body = await readBody(req);
    // body.chunks = [{ source, tags:[], text }]
    const incoming = body.chunks || [];
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'chunks 数组不能为空' });
    }

    const existing = await redisGet('knowledge:chunks') || [];

    let added = 0;
    for (const item of incoming) {
      if (!item.text?.trim()) continue;
      const chunk = {
        id:        crypto.randomBytes(6).toString('hex'),
        source:    item.source || '未知来源',
        tags:      Array.isArray(item.tags) ? item.tags : [],
        text:      item.text.trim(),
        createdAt: new Date().toISOString(),
      };
      existing.push(chunk);

      // 建倒排索引
      const words = extractWords(chunk.text + ' ' + chunk.tags.join(' '));
      for (const word of words) {
        const ids = await redisGet(`knowledge:index:${word}`) || [];
        if (!ids.includes(chunk.id)) {
          ids.push(chunk.id);
          await redisSet(`knowledge:index:${word}`, ids);
        }
      }
      added++;
    }

    await redisSet('knowledge:chunks', existing);
    return res.status(200).json({ ok: true, added, total: existing.length });
  }

  // ── 列出所有片段（管理员）───────────────────────────────────────────────────
  if (action === 'list') {
    if (!isAdmin(req)) return res.status(401).json({ error: '未授权' });
    const chunks = await redisGet('knowledge:chunks') || [];
    // 只返回概览，不返回全文
    const overview = chunks.map(c => ({
      id:        c.id,
      source:    c.source,
      tags:      c.tags,
      textLen:   c.text?.length || 0,
      preview:   c.text?.slice(0, 60) + '…',
      createdAt: c.createdAt,
    }));
    return res.status(200).json({ total: chunks.length, chunks: overview });
  }

  // ── 删除一个片段（管理员）───────────────────────────────────────────────────
  if (action === 'delete' && req.method === 'POST') {
    if (!isAdmin(req)) return res.status(401).json({ error: '未授权' });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id 必填' });

    const chunks = await redisGet('knowledge:chunks') || [];
    const filtered = chunks.filter(c => c.id !== id);
    await redisSet('knowledge:chunks', filtered);
    return res.status(200).json({ ok: true, remaining: filtered.length });
  }

  return res.status(400).json({ error: '无效的 action' });
};
