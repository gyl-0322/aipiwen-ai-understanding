/**
 * api/report-upload-p0.js - Report OS V1.0 upload-report P0 mock/rules API.
 *
 * This is not a production AI report generator. It accepts JSON only, does not
 * process multipart uploads, does not call AI, does not read/write a database,
 * and does not replace human interpretation. Before production use, add auth,
 * restricted CORS, rate limits, file/type limits, schema validation, log
 * redaction, and a human-review workflow. Production debug output must stay off.
 */

const VERSION = 'report-os-v1-p0-rules-v0.2';
const MAX_BODY_BYTES = 512 * 1024;

const SAFETY_NOTES = [
  '本接口仅做上传报告 P0 mock/rules 决策，不是正式 AI 报告生成服务。',
  '输出只作为理解报告和沟通方式的参考，不替代医学、心理、法律、升学、职业或关系决策。',
  'P0 不生成完整长报告，不开放关系合看、团队、班级、企业画像或长期陪伴。',
];

const RISK_RANK = { R0: 0, R1: 1, R2: 2, R3: 3 };

const HINT_RULES = {
  subject: [
    ['child', ['孩子', '儿童', '未成年', '小孩', 'child', 'minor']],
    ['student', ['学生', '学校', '班级', 'student']],
    ['partner', ['伴侣', '亲密', '婚姻', '分手', '离婚', 'partner', 'relationship']],
    ['candidate', ['候选人', '录用', '招聘', 'candidate']],
    ['team', ['团队', '员工', 'team']],
    ['class', ['班级', '学生分层', '分班', 'class']],
    ['enterprise', ['企业', '公司', '管理者', 'enterprise']],
    ['self', ['我', '自己', '本人', '个人', 'self']],
  ],
  intent: [
    ['diagnosis', ['诊断', '是不是有', '是不是患', '有没有病']],
    ['medical_or_psychological', ['心理疾病', '精神问题', '抑郁', '焦虑', '多动症', '自闭症', '治疗']],
    ['relationship_decision', ['适不适合继续', '要不要分手', '该不该离婚', '合不合适', '是否适合在一起']],
    ['hiring_screening', ['是否适合录用', '应该淘汰', '招聘筛选', '筛选候选人']],
    ['school_grouping', ['分层管理', '重点培养', '分班', '学生分层']],
    ['learning_or_career_direction', ['学习偏好', '职业方向', '升学路线', '适合走哪条']],
    ['parent_child_communication', ['亲子沟通', '家长', '父母', '孩子行为']],
    ['understand_child_behavior', ['写作业拖拉', '孩子行为', '容易生气', '不想给孩子贴标签']],
    ['quick_reading', ['快速读懂', '哪些地方可以参考', '不要直接下结论']],
  ],
  sensitive: [
    ['minor', ['孩子', '儿童', '未成年', '学生', 'child', 'minor']],
    ['diagnosis', ['诊断', '是不是有', '是不是患']],
    ['medical', ['医学', '疾病', '脑病', '治疗']],
    ['psychological', ['心理疾病', '精神问题', '抑郁', '焦虑症', '多动症', '自闭症']],
    ['brain_science_claim', ['脑科学证明', '脑功能', '脑病']],
    ['hypnosis', ['催眠', '催眠治疗']],
    ['therapy', ['疗愈', '治疗']],
    ['trauma', ['创伤']],
    ['relationship_judgment', ['适不适合继续', '要不要分手', '该不该离婚', '是否适合在一起']],
    ['parent_blame', ['父母导致', '父母害了孩子']],
    ['child_labeling', ['孩子就是', '这个孩子天生', '问题孩子']],
    ['destiny_or_mysticism', ['命运', '命中注定', '天生适合', '未来一定', '天赋决定']],
    ['career_or_education_guarantee', ['保证升学', '保证成功', '升学路线', '未来一定']],
    ['enterprise_screening', ['是否适合录用', '应该淘汰', '招聘筛选']],
    ['school_sorting', ['学生分层', '分层管理', '分班', '重点培养']],
    ['privacy_or_consent_unclear', ['未经同意', '没授权', '他人报告']],
  ],
};

const TEXT_RULES = [
  {
    level: 'R3',
    code: 'medical_or_psychological_diagnosis',
    terms: ['ADHD', '自闭症', '抑郁症', '精神病', '心理疾病', '诊断', '治疗', '疾病', '障碍'],
    reason: '医学/心理/诊断类问题必须阻断普通报告。',
  },
  {
    level: 'R3',
    code: 'self_harm_or_violence',
    terms: ['自杀', '自伤', '想死', '杀人', '暴力', '伤害他人'],
    reason: '自伤、他伤或暴力风险需要专业支持。',
  },
  {
    level: 'R3',
    code: 'screening_or_elimination',
    terms: ['淘汰', '筛选', '不录用', '风险学生', '分层', '排名', '定岗', '录用'],
    reason: 'P0 禁止用于企业/学校筛选、淘汰、排名或分层。',
  },
  {
    level: 'R3',
    code: 'guarantee_or_determinism',
    terms: ['保证考上', '保证成功', '一定考上', '一定成功', '预测命运', '前世', '改命', '天命', '命中注定', 'education_guarantee'],
    reason: 'P0 禁止升学/职业保证、命定化和玄学化表达。',
  },
  {
    level: 'R2',
    code: 'relationship_decision',
    terms: ['该不该离婚', '能不能结婚', '适不适合结婚', '合不合适', '分手', '离婚吗', 'relationship_decision'],
    reason: '关系去留判断必须降级或转人工。',
  },
  {
    level: 'R2',
    code: 'child_labeling_or_parent_blame',
    terms: ['孩子没救了', '孩子废了', '懒', '笨', '白眼狼', '父母导致', '家长害了'],
    reason: 'P0 禁止孩子标签化和父母责任归因。',
  },
  {
    level: 'R2',
    code: 'strong_brain_science_or_healing',
    terms: ['脑科学证明', '脑功能异常', '催眠', '疗愈', '症状转化', '潜意识'],
    reason: '脑科学强结论、催眠、疗愈或症状转化不能进入普通报告。',
  },
  {
    level: 'R2',
    code: 'career_or_admission_determinism',
    terms: ['一定适合', '一定不适合', '必须学', '不能学', '马上辞职'],
    reason: '职业/学习方向只能做探索建议，不能给保证或定论。',
  },
  {
    level: 'R1',
    code: 'mild_child_or_behavior_concern',
    terms: ['拖拉', '顶嘴', '情绪大', '不爱学习', '不回应', '注意力', '兴趣班'],
    reason: '孩子行为或学习问题需要安全话术和后天环境校正。',
  },
  {
    level: 'R1',
    code: 'mild_relationship_or_career_context',
    terms: ['沟通冲突', '职业方向', '学习方式', '自我理解'],
    reason: '轻度关系、职业或自我理解问题可安全改写后输出。',
  },
];

function setCors(res) {
  // Mock default only. Production must restrict origin and add auth/rate limits.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function readJson(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { code: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('BAD_JSON'), { code: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function text(value) {
  return String(value || '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function includesAny(haystack, values) {
  const low = lower(haystack);
  return values.some(value => low.includes(lower(value)));
}

function unique(values) {
  return [...new Set(values)];
}

function detectHints(value, rules) {
  const found = [];
  for (const [hint, terms] of rules) {
    if (includesAny(value, terms)) found.push(hint);
  }
  return unique(found);
}

function parseReportText(reportText) {
  const content = text(reportText);
  const reportTextLength = content.length;
  let readableStatus = 'empty';
  if (reportTextLength > 0 && reportTextLength < 12) readableStatus = 'too_short';
  else if (reportTextLength >= 12 && reportTextLength < 120) readableStatus = 'partial';
  else if (reportTextLength >= 120 && reportTextLength < 800) readableStatus = 'readable';
  else if (reportTextLength >= 800) readableStatus = 'long';

  const detectedSubjectHints = detectHints(content, HINT_RULES.subject);
  const detectedIntentHints = detectHints(content, HINT_RULES.intent);
  const detectedSensitiveHints = detectHints(content, HINT_RULES.sensitive);
  const textQualityHints = [];
  const questionCount = (content.match(/[?？]/g) || []).length;
  const hasReportTerms = includesAny(content, ['报告', '测评', '指标', '表达方式', '学习偏好', '决策习惯', '沟通特点', 'TRC', 'ATD']);
  const hasDecisionRequest = includesAny(content, ['判断', '是否', '能不能', '要不要', '该不该', '适不适合']);

  if (hasReportTerms) textQualityHints.push('has_report_like_content');
  if (questionCount > 0 || hasDecisionRequest) textQualityHints.push('mostly_question');
  if (readableStatus === 'empty' || readableStatus === 'too_short') textQualityHints.push('missing_report_content');
  if (detectedSensitiveHints.length) textQualityHints.push('contains_high_risk_request');
  if (hasDecisionRequest) textQualityHints.push('contains_decision_request');

  return {
    readableStatus,
    reportTextLength,
    detectedSubjectHints: detectedSubjectHints.length ? detectedSubjectHints : ['unknown'],
    detectedIntentHints: detectedIntentHints.length ? detectedIntentHints : ['unknown'],
    detectedSensitiveHints: unique(detectedSensitiveHints),
    textQualityHints: unique(textQualityHints),
  };
}

function pushRisk(risks, level, code, reason) {
  risks.push({ level, code, reason });
}

function maxRisk(risks) {
  return risks.reduce((current, risk) => (
    RISK_RANK[risk.level] > RISK_RANK[current] ? risk.level : current
  ), 'R0');
}

function normalizePayload(payload) {
  const reportText = text(payload.reportText ?? payload.rawText);
  const userIntent = text(payload.userIntent ?? payload.userGoal ?? payload.userQuestion);
  const userIdentity = text(payload.userIdentity ?? payload.userRole);
  const reportSubject = text(payload.reportSubject ?? payload.subjectType);
  const subjectAge = numberOrNull(payload.subjectAge);
  const consentConfirmed = bool(payload.consentConfirmed);
  const parseResult = parseReportText(reportText);
  return {
    reportText,
    reportType: text(payload.reportType || 'unknown') || 'unknown',
    userIdentity: userIdentity || 'unknown',
    userIntent: userIntent || 'unknown',
    reportSubject: reportSubject || 'unknown',
    subjectAge,
    subjectRelation: text(payload.subjectRelation || payload.relationshipContext || 'unknown') || 'unknown',
    consentConfirmed,
    debugMode: payload.debugMode === true,
    parseResult,
  };
}

function assessReadability(ctx) {
  if (ctx.parseResult.readableStatus === 'empty') return 'unreadable';
  if (ctx.parseResult.readableStatus === 'too_short') return 'unknown';
  if (ctx.parseResult.readableStatus === 'partial') return 'partial';
  if (ctx.parseResult.readableStatus === 'readable') return 'partial';
  if (ctx.parseResult.readableStatus === 'long') return 'complete';
  return 'unknown';
}

function detectTextRisks(ctx) {
  const haystack = `${ctx.reportText}\n${ctx.userIntent}\n${ctx.reportType}\n${ctx.userIdentity}\n${ctx.reportSubject}\n${ctx.subjectRelation}`;
  const hits = [];
  for (const rule of TEXT_RULES) {
    const matched = rule.terms.filter(term => includesAny(haystack, [term]));
    if (matched.length) {
      hits.push({
        level: rule.level,
        code: rule.code,
        reason: rule.reason,
        matchedTerms: matched,
      });
    }
  }
  return hits;
}

function assessContextRisks(ctx) {
  const risks = [];
  const identity = lower(ctx.userIdentity);
  const intent = lower(ctx.userIntent);
  const subject = lower(ctx.reportSubject);
  const relation = lower(ctx.subjectRelation);
  const type = lower(ctx.reportType);
  const isMinor = ctx.subjectAge !== null && ctx.subjectAge < 18;
  const parse = ctx.parseResult;

  if (isMinor || includesAny(`${subject} ${relation} ${type}`, ['孩子', '儿童', '未成年', '学生', 'child', 'minor', 'student']) || parse.detectedSensitiveHints.includes('minor')) {
    pushRisk(risks, 'R1', 'minor_data', '涉及未成年人时默认至少 R1。');
  }

  if (includesAny(identity, ['父母', '监护', '老师', '学校', '机构', '顾问']) && !ctx.consentConfirmed) {
    pushRisk(risks, 'R2', 'third_party_without_confirmed_consent', '他人或未成年人报告授权不清，至少 R2。');
  }

  const scenarioText = `${identity} ${intent} ${subject} ${relation} ${type}`;

  if (includesAny(scenarioText, ['学校', '班级', '机构', '分层', '学生'])) {
    pushRisk(risks, includesAny(intent, ['分层', '排名', '筛查', '风险']) ? 'R3' : 'R2', 'school_context', '学校/班级场景不得用于个体标签、分层或筛查。');
  }

  if (includesAny(scenarioText, ['企业', '团队', '员工', '招聘', '录用', '淘汰', '定岗'])) {
    pushRisk(risks, includesAny(intent, ['招聘', '录用', '淘汰', '筛选', '定岗']) ? 'R3' : 'R2', 'enterprise_or_team_context', '企业/团队场景不得用于筛选、淘汰、定岗或排序。');
  }

  if (includesAny(`${intent} ${subject} ${relation} ${type}`, ['关系', '伴侣', '亲密', '婚姻', '合不合', '合伙人', '合作', 'relationship', 'partner'])) {
    pushRisk(risks, 'R2', 'relationship_or_partner_context', 'P0 不开放正式关系或合伙人判断。');
  }

  if (includesAny(intent, ['诊断', '心理', '医学', '疾病', '脑科学', '催眠', '疗愈', '症状'])
    || parse.detectedSensitiveHints.some(hint => ['diagnosis', 'medical', 'psychological', 'brain_science_claim', 'hypnosis', 'therapy', 'trauma'].includes(hint))) {
    pushRisk(risks, 'R3', 'professional_domain_request', '医学、心理、脑科学强结论、催眠或疗愈请求必须阻断普通报告。');
  }

  if (includesAny(intent, ['保证', '一定', '预测', '升学', '录取', '职业命定', 'guarantee'])
    || parse.detectedSensitiveHints.includes('career_or_education_guarantee')
    || parse.detectedSensitiveHints.includes('destiny_or_mysticism')) {
    pushRisk(risks, 'R3', 'guarantee_request', 'P0 禁止升学、职业或未来结果保证。');
  }

  if (parse.detectedSensitiveHints.includes('relationship_judgment')) {
    pushRisk(risks, 'R2', 'relationship_decision_from_text', '文本中包含关系去留判断，P0 必须降级。');
  }

  if (parse.detectedSensitiveHints.includes('enterprise_screening') || parse.detectedSensitiveHints.includes('school_sorting')) {
    pushRisk(risks, 'R3', 'sorting_or_screening_from_text', '文本中包含筛选、淘汰、分层或录用用途，必须阻断普通报告。');
  }

  if (parse.detectedSensitiveHints.includes('child_labeling') || parse.detectedSensitiveHints.includes('parent_blame')) {
    pushRisk(risks, 'R2', 'labeling_or_blame_from_text', '文本中包含孩子标签化或父母责任归因，必须降级。');
  }

  return risks;
}

function assessRisk(ctx) {
  const risks = [...detectTextRisks(ctx), ...assessContextRisks(ctx)];
  const riskLevel = maxRisk(risks);
  return {
    riskLevel,
    blockedReasons: risks
      .filter(risk => risk.level === riskLevel || riskLevel === 'R3')
      .map(risk => ({ code: risk.code, level: risk.level, reason: risk.reason })),
    debugHits: risks.map(risk => ({
      level: risk.level,
      code: risk.code,
      matchedTerms: (risk.matchedTerms || []).slice(0, 5),
    })),
  };
}

function assessConfidence(ctx, readability, riskLevel) {
  if (riskLevel === 'R3' || readability === 'unreadable') return 'insufficient';
  if (!ctx.consentConfirmed && needsConsent(ctx)) return 'insufficient';
  if (riskLevel === 'R2') return 'low';
  if (ctx.parseResult.readableStatus === 'too_short') return 'low';
  if (readability === 'unknown' || ctx.userIntent === 'unknown' || ctx.userIdentity === 'unknown') return 'low';
  if (ctx.parseResult.readableStatus === 'readable' && riskLevel === 'R0' && ctx.userIntent !== 'unknown') return 'high';
  if (readability === 'complete' && riskLevel === 'R0') return 'high';
  if (readability === 'complete' && riskLevel === 'R1') return 'high';
  if (readability === 'partial') return 'medium';
  return 'low';
}

function needsConsent(ctx) {
  const identity = lower(ctx.userIdentity);
  const subject = lower(ctx.reportSubject);
  const relation = lower(ctx.subjectRelation);
  return includesAny(`${identity} ${subject} ${relation}`, ['孩子', '未成年', '学生', '他人', '客户', '伴侣', '合伙人', '团队', '班级', '企业', '学校']);
}

function decideOutput(riskLevel, confidence) {
  if (riskLevel === 'R3') return 'blocked_or_human_review';
  if (riskLevel === 'R2') return 'fallback_only';
  if (riskLevel === 'R1' && confidence === 'high') return 'safe_quick_reading';
  if (riskLevel === 'R1' && confidence === 'medium') return 'safe_quick_reading_with_limits';
  if (riskLevel === 'R1' && confidence === 'low') return 'clarification_first';
  if (riskLevel === 'R1') return 'clarification_or_human_review';
  if (confidence === 'high') return 'quick_reading';
  if (confidence === 'medium') return 'quick_reading_with_limits';
  if (confidence === 'low') return 'light_hint_with_questions';
  return 'clarification_only';
}

function allowedOutputType(outputDecision) {
  const map = {
    quick_reading: 'quick_reading',
    quick_reading_with_limits: 'quick_reading',
    safe_quick_reading: 'safe_quick_reading',
    safe_quick_reading_with_limits: 'safe_quick_reading',
    light_hint_with_questions: 'light_hint',
    clarification_only: 'clarification_questions',
    clarification_first: 'clarification_questions',
    clarification_or_human_review: 'clarification_or_human_review',
    fallback_only: 'fallback_only',
    blocked_or_human_review: 'blocked_or_human_review',
  };
  return map[outputDecision] || 'clarification_questions';
}

function buildClarificationQuestions(ctx, readability, riskLevel, confidence) {
  const questions = [];
  if (ctx.userIdentity === 'unknown') questions.push('这份报告是你自己、孩子，还是他人/客户的？');
  if (ctx.userIntent === 'unknown') questions.push('你这次更想快速读懂报告，还是想解决一个具体问题？');
  if (ctx.reportSubject === 'unknown') questions.push('这份报告主要对应谁：成人本人、孩子，还是多人关系/团队？');
  if (needsConsent(ctx) && !ctx.consentConfirmed) questions.push('这份报告是否已经获得本人或监护人授权用于解读？');
  if (ctx.subjectAge === null && includesAny(`${ctx.reportSubject} ${ctx.subjectRelation}`, ['孩子', '学生', '未成年'])) {
    questions.push('如果涉及孩子或学生，大概年龄是多少？');
  }
  if (readability === 'unreadable' || readability === 'unknown') questions.push('请补充更清晰的报告文字、关键指标，或说明你最想看的问题。');
  if ((riskLevel === 'R1' || confidence === 'low') && questions.length === 0) questions.push('你最希望先围绕哪个低风险场景做快速理解？');
  return questions.slice(0, 3);
}

function buildQuickReading(ctx, outputDecision) {
  if (!['quick_reading', 'quick_reading_with_limits', 'safe_quick_reading', 'safe_quick_reading_with_limits'].includes(outputDecision)) {
    return null;
  }
  const withLimits = outputDecision.includes('limits') || outputDecision.startsWith('safe_');
  return {
    reportOverview: '这份报告在 P0 阶段只用于快速理解可读信息、用户关注点和低风险下一步，不生成完整长报告。',
    currentConcern: ctx.userIntent === 'unknown' ? '当前目的还不够明确，需要先确认你最想解决的问题。' : ctx.userIntent,
    referencePoints: [
      '先看报告中已经可读、可确认的部分，不补写缺失信息。',
      '把报告内容落到一个具体场景，而不是直接定义一个人。',
      '所有理解点都需要结合年龄、后天环境和现实观察验证。',
      '涉及孩子、关系、职业或学校/企业用途时，只能做支持性参考。',
      withLimits ? '当前输出已按安全话术收敛，不能作为确定结论。' : '当前风险较低，可做快速读懂和轻量建议。',
    ].slice(0, 5),
    environmentObservation: '建议按“表现 -> 可能机制 -> 后天环境影响 -> 可观察验证 -> 轻量建议”来使用，不把单一表现等同于性格或天赋定论。',
    noConclusionAreas: [
      '不做医学、心理、疾病或脑科学强判断。',
      '不做职业、升学、关系、招聘、分层或淘汰保证。',
      '不把孩子、父母、伴侣、员工或学生标签化。',
    ],
    communicationSuggestions: [
      '先选一个真实场景观察 1-2 周。',
      '用低压力问题确认对方需求，而不是直接纠正或下结论。',
      '如资料不足，先补充年龄、身份、授权、具体问题和关键指标。',
    ],
    humanReviewSuggestion: withLimits ? '如问题涉及未成年人、关系冲突、职业重大决策、学校/企业用途，建议人工复核。' : '如果需要深度解读或完整交付，建议进入人工解读。',
  };
}

function buildFallback(outputDecision, riskLevel, confidence, blockedReasons) {
  if (!['fallback_only', 'blocked_or_human_review', 'clarification_only', 'clarification_first', 'clarification_or_human_review', 'light_hint_with_questions'].includes(outputDecision)) {
    return null;
  }
  if (riskLevel === 'R3') {
    return '这个问题超出上传报告 P0 的自动解读范围。系统不会生成报告结论，建议转人工或寻求相关专业支持。';
  }
  if (riskLevel === 'R2') {
    return '当前场景风险较高，P0 只能输出边界说明、观察方向和补充问题，不给确定判断或决策结论。';
  }
  if (confidence === 'insufficient') {
    return '当前资料不足以生成报告，需要先补充报告对象、用户身份、使用目的、授权或可读内容。';
  }
  if (blockedReasons.length) {
    return '当前输入需要先澄清场景和边界，系统不会直接生成完整报告。';
  }
  return '当前只能提供轻量提示和追问，不能生成完整结论。';
}

function buildHumanReview(riskLevel, outputDecision, blockedReasons) {
  const required = riskLevel === 'R3' || outputDecision === 'blocked_or_human_review';
  const recommended = required || riskLevel === 'R2' || outputDecision === 'clarification_or_human_review';
  return {
    required,
    recommended,
    reason: required
      ? '命中高风险或专业边界，必须阻断普通报告并转人工/专业支持。'
      : (recommended ? '场景较复杂，建议人工复核后再输出。' : ''),
    triggerCodes: blockedReasons.map(reason => reason.code),
  };
}

function buildResponse(payload) {
  const ctx = normalizePayload(payload);
  const stage = 'p0_rules_decision';
  const readability = assessReadability(ctx);
  const risk = assessRisk(ctx);
  const confidence = assessConfidence(ctx, readability, risk.riskLevel);
  const outputDecision = decideOutput(risk.riskLevel, confidence);
  const blockedReasons = risk.blockedReasons;
  const clarificationQuestions = buildClarificationQuestions(ctx, readability, risk.riskLevel, confidence);
  const quickReading = buildQuickReading(ctx, outputDecision);
  const fallbackMessage = buildFallback(outputDecision, risk.riskLevel, confidence, blockedReasons);
  const humanReview = buildHumanReview(risk.riskLevel, outputDecision, blockedReasons);
  const response = {
    ok: true,
    stage,
    parseResult: ctx.parseResult,
    riskLevel: risk.riskLevel,
    confidence,
    outputDecision,
    allowedOutputType: allowedOutputType(outputDecision),
    blockedReasons,
    clarificationQuestions,
    quickReading,
    fallbackMessage,
    humanReview,
    safetyNotes: SAFETY_NOTES,
  };

  if (ctx.debugMode) {
    response.debug = {
      version: VERSION,
      readability,
      normalizedInput: {
        reportType: ctx.reportType,
        userIdentity: ctx.userIdentity,
        userIntent: ctx.userIntent,
        reportSubject: ctx.reportSubject,
        subjectAge: ctx.subjectAge,
        subjectRelation: ctx.subjectRelation,
        consentConfirmed: ctx.consentConfirmed,
        reportTextLength: ctx.reportText.length,
      },
      ruleHits: risk.debugHits,
      note: 'Debug is for local testing only. Do not enable in production.',
    };
  }

  return response;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      stage: 'health_check',
      version: VERSION,
      service: 'report-upload-p0',
      safetyNotes: SAFETY_NOTES,
    });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, stage: 'method_check', error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (err) {
    if (err.code === 413) return res.status(413).json({ ok: false, stage: 'read_json', error: '请求内容过大' });
    return res.status(400).json({ ok: false, stage: 'read_json', error: '请求格式错误' });
  }

  return res.status(200).json(buildResponse(payload));
};
