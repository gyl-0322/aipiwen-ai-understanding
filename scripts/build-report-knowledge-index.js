const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const VAULT_ROOT = process.env.AIPIWEN_OBSIDIAN_VAULT
  || path.join(process.env.HOME || '', 'AI-CEO-System', 'AI-CEO-Vault');
const SOURCES = [
  {
    rootLabel: 'repo_report_os',
    rootPath: path.join(PROJECT_ROOT, 'docs', 'aipiwen_report_system'),
  },
  {
    rootLabel: 'obsidian_report_os',
    rootPath: path.join(VAULT_ROOT, '知识库', '自建系统', 'AIPIWEN_Report_OS'),
  },
  {
    rootLabel: 'obsidian_teacher_course',
    rootPath: path.join(VAULT_ROOT, '知识库', '宋老师天赋测评教学'),
  },
  {
    rootLabel: 'obsidian_aipiwen_system',
    rootPath: path.join(VAULT_ROOT, '知识库', '自建系统'),
    includePattern: /AIPIWEN|aipiwen|皮纹|报告|话术|天赋/,
  },
];

const OUT_DIR = path.join(PROJECT_ROOT, 'data', 'report-knowledge-index');
const OUT_FILE = path.join(OUT_DIR, 'report-knowledge-index-v1.json');
const MAX_FILE_CHARS = 120000;
const MAX_CHUNK_CHARS = 950;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === '_备份') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(md|txt)$/i.test(name)) out.push(full);
  }
  return out;
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, match => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function redactLocalPaths(text) {
  return String(text || '')
    .replace(/\/Users\/[^\s`'")，。]+/g, '<LOCAL_PATH>')
    .replace(/\/private\/tmp\/[^\s`'")，。]+/g, '<LOCAL_PATH>');
}

function splitIntoChunks(text) {
  const clean = redactLocalPaths(stripMarkdown(text)).slice(0, MAX_FILE_CHARS);
  const blocks = clean
    .split(/\n(?=#{1,4}\s)|\n{2,}/)
    .map(s => s.trim())
    .filter(s => s.length >= 30);
  const chunks = [];
  let buf = '';
  for (const block of blocks) {
    if ((buf + '\n\n' + block).length > MAX_CHUNK_CHARS && buf) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = buf ? `${buf}\n\n${block}` : block;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.flatMap(chunk => {
    if (chunk.length <= MAX_CHUNK_CHARS * 1.4) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += MAX_CHUNK_CHARS) parts.push(chunk.slice(i, i + MAX_CHUNK_CHARS));
    return parts;
  });
}

function tagsFor(text, filePath) {
  const s = `${filePath}\n${text}`;
  const tags = [];
  const rules = [
    ['atd', /ATD|反应节奏|速度|敏感/],
    ['trc', /TRC|容量|总量|纹线|认知结构/],
    ['brain', /左右脑|左脑|右脑|信息处理/],
    ['personality', /性格|认知型|逆思|模仿|开放|整合|完美/],
    ['learning', /学习|作业|拖拉|专注|升学|兴趣班|专业|职业/],
    ['parent_child', /亲子|孩子|家长|老人带娃|沟通|作业|幼儿/],
    ['relationship', /伴侣|夫妻|亲密关系|关系合看/],
    ['business', /团队|企业|合伙|客户|成交|协作/],
    ['risk', /风险|禁用|诊断|治疗|疾病|ADHD|心理|转人工|降级|安全/],
    ['language', /话术|表达|共鸣|沐海星辰|不要这样说|可以这样说/],
    ['report_structure', /模板|模块|Prompt|输出|结构|Schema|报告/],
  ];
  for (const [tag, re] of rules) if (re.test(s)) tags.push(tag);
  return [...new Set(tags)];
}

function riskLevelFor(text) {
  if (/诊断|治疗|疾病|ADHD|多动症|心理疾病|自杀|伤害|创伤|疗愈/.test(text)) return 'guardrail';
  if (/风险|禁用|转人工|降级|专业支持/.test(text)) return 'caution';
  return 'normal';
}

function audienceFor(text) {
  const audiences = [];
  if (/家长|孩子|亲子|幼儿|作业/.test(text)) audiences.push('parent');
  if (/本人|自我|成人|职业|价值/.test(text)) audiences.push('self');
  if (/伴侣|夫妻|亲密/.test(text)) audiences.push('partner');
  if (/团队|企业|合伙|客户|成交/.test(text)) audiences.push('business');
  if (/AI|Prompt|Schema|规则|模板|系统/.test(text)) audiences.push('system');
  return audiences.length ? audiences : ['general'];
}

function titleFor(file, chunk) {
  const heading = chunk.match(/^#{1,4}\s+(.+)$/m)?.[1];
  return (heading || path.basename(file, path.extname(file))).trim().slice(0, 80);
}

function build() {
  const chunks = [];
  const sourceStats = [];
  for (const source of SOURCES) {
    const files = walk(source.rootPath)
      .filter(file => !source.includePattern || source.includePattern.test(file));
    sourceStats.push({ rootLabel: source.rootLabel, files: files.length });
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(source.rootPath, file);
      const stat = fs.statSync(file);
      splitIntoChunks(text).forEach((chunkText, index) => {
        const idBase = `${source.rootLabel}:${rel}:${index}:${chunkText.slice(0, 80)}`;
        chunks.push({
          id: crypto.createHash('sha1').update(idBase).digest('hex').slice(0, 16),
          sourceRoot: source.rootLabel,
          sourcePath: rel,
          title: titleFor(file, chunkText),
          chunkIndex: index,
          tags: tagsFor(chunkText, file),
          audience: audienceFor(chunkText),
          riskLevel: riskLevelFor(chunkText),
          updatedAt: stat.mtime.toISOString(),
          charCount: chunkText.length,
          text: chunkText,
        });
      });
    }
  }
  const index = {
    version: 'report-knowledge-index-v1',
    generatedAt: new Date().toISOString(),
    sourceStats,
    chunkCount: chunks.length,
    chunks,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(index, null, 2)}\n`);
  console.log(JSON.stringify({
    output: path.relative(PROJECT_ROOT, OUT_FILE),
    chunkCount: index.chunkCount,
    sourceStats,
  }, null, 2));
}

build();
