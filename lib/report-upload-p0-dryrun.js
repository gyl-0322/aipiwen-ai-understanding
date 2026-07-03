/**
 * lib/report-upload-p0-dryrun.js - Report OS V1.0 upload-report P0 mock/rules dry-run module.
 *
 * This is a non-deployed dry-run module, not a production API route.
 * It is not a production AI report generator. It accepts JSON only, does not
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

const BASE_PROMPT_CHAIN = [
  'report_parse_prompt',
  'user_identity_intent_prompt',
  'risk_assessment_prompt',
  'confidence_assessment_prompt',
  'output_decision_prompt',
];

const ALWAYS_BLOCKED_PROMPTS = [
  'full_personal_report_prompt',
  'parent_child_formal_joint_report_prompt',
  'intimate_relationship_joint_report_prompt',
  'partner_joint_report_prompt',
  'team_profile_prompt',
  'class_profile_prompt',
  'enterprise_profile_prompt',
  'hiring_screening_prompt',
  'medical_diagnosis_prompt',
  'psychological_diagnosis_prompt',
  'education_guarantee_prompt',
  'career_guarantee_prompt',
];

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
      '不做职业、学习、关系或机构处置类保证。',
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

function buildPromptPlan({ riskLevel, confidence, outputDecision, allowedOutputType, parseResult, humanReview }) {
  const sensitive = parseResult.detectedSensitiveHints || [];
  const hasProfessionalRisk = sensitive.some(hint => (
    ['diagnosis', 'medical', 'psychological', 'brain_science_claim', 'hypnosis', 'therapy', 'trauma'].includes(hint)
  ));
  const hasRelationshipRisk = sensitive.includes('relationship_judgment');
  const hasScreeningRisk = sensitive.includes('enterprise_screening') || sensitive.includes('school_sorting');
  const hasGuaranteeRisk = sensitive.includes('career_or_education_guarantee') || sensitive.includes('destiny_or_mysticism');
  const isMinor = sensitive.includes('minor') || parseResult.detectedSubjectHints.includes('child') || parseResult.detectedSubjectHints.includes('student');
  const blockedPromptTypes = [...ALWAYS_BLOCKED_PROMPTS];
  let mode = 'clarification';
  let allowed = false;
  let promptChain = [...BASE_PROMPT_CHAIN];
  let reason = '需要先澄清信息，不能直接进入生成类 Prompt。';
  let requiresHumanReview = !!humanReview.recommended;
  let requiresSafetyRewrite = false;
  let nextStep = 'ask_clarification_questions';

  if (riskLevel === 'R3' || hasProfessionalRisk || hasScreeningRisk) {
    mode = humanReview.required || hasProfessionalRisk ? 'human_review' : 'blocked';
    allowed = false;
    promptChain = ['human_review_prompt'];
    reason = '命中 R3 或专业/筛选风险，只能转人工或阻断生成。';
    requiresHumanReview = true;
    requiresSafetyRewrite = false;
    nextStep = humanReview.required ? 'route_to_human_review' : 'block_generation';
  } else if (riskLevel === 'R2' || hasRelationshipRisk || hasGuaranteeRisk) {
    mode = 'fallback';
    allowed = false;
    promptChain = ['fallback_output_prompt'];
    if (humanReview.recommended) promptChain.push('human_review_prompt');
    reason = '命中 R2 或关系/保证类风险，只能降级输出，不进入 quick_reading_prompt。';
    requiresHumanReview = !!humanReview.recommended;
    requiresSafetyRewrite = false;
    nextStep = humanReview.recommended ? 'route_to_human_review' : 'show_fallback_message';
  } else if (confidence === 'insufficient') {
    mode = humanReview.recommended ? 'human_review' : 'clarification';
    allowed = false;
    promptChain = [humanReview.recommended ? 'human_review_prompt' : 'clarification_prompt'];
    reason = '资料不足或授权/目的不明确，不允许进入生成类 Prompt。';
    requiresHumanReview = !!humanReview.recommended;
    requiresSafetyRewrite = false;
    nextStep = humanReview.recommended ? 'route_to_human_review' : 'ask_clarification_questions';
  } else if ((riskLevel === 'R0' || riskLevel === 'R1') && confidence === 'low') {
    mode = 'clarification';
    allowed = false;
    promptChain = ['clarification_prompt'];
    reason = '低置信度优先追问，必要时再降级输出。';
    requiresHumanReview = false;
    requiresSafetyRewrite = riskLevel === 'R1' || isMinor;
    nextStep = 'ask_clarification_questions';
  } else if (riskLevel === 'R1' && (confidence === 'high' || confidence === 'medium')) {
    mode = 'safe_quick_reading';
    allowed = true;
    promptChain = [...BASE_PROMPT_CHAIN, 'quick_reading_prompt', 'safety_rewrite_prompt'];
    reason = 'R1 且资料可用，可 dry-run 快速读懂 Prompt，但必须安全改写。';
    requiresHumanReview = false;
    requiresSafetyRewrite = true;
    nextStep = 'run_quick_reading_prompt_dry_run';
  } else if (riskLevel === 'R0' && (confidence === 'high' || confidence === 'medium')) {
    mode = 'quick_reading';
    allowed = true;
    promptChain = [...BASE_PROMPT_CHAIN, 'quick_reading_prompt'];
    if (isMinor) {
      promptChain.push('safety_rewrite_prompt');
      requiresSafetyRewrite = true;
      mode = 'safe_quick_reading';
      reason = '低风险未成年人场景可 dry-run 快速读懂，但必须安全改写。';
    } else {
      reason = 'R0 且资料可用，可 dry-run 快速读懂 Prompt。';
      requiresSafetyRewrite = false;
    }
    requiresHumanReview = false;
    nextStep = 'run_quick_reading_prompt_dry_run';
  }

  if (requiresSafetyRewrite && !promptChain.includes('safety_rewrite_prompt') && allowed) {
    promptChain.push('safety_rewrite_prompt');
  }

  return {
    mode,
    allowed,
    promptChain: unique(promptChain),
    blockedPromptTypes: unique(blockedPromptTypes),
    reason,
    requiresHumanReview,
    requiresSafetyRewrite,
    nextStep,
    allowedOutputType,
  };
}

function buildPromptRequestDryRun({
  promptPlan,
  parseResult,
  riskLevel,
  confidence,
  outputDecision,
  allowedOutputType,
  blockedReasons,
  clarificationQuestions,
  humanReview,
  safetyNotes,
  ctx,
}) {
  const sensitive = parseResult.detectedSensitiveHints || [];
  const isMinor = sensitive.includes('minor') || parseResult.detectedSubjectHints.includes('child') || parseResult.detectedSubjectHints.includes('student');
  const hasProfessionalRisk = sensitive.some(hint => (
    ['diagnosis', 'medical', 'psychological', 'brain_science_claim', 'hypnosis', 'therapy', 'trauma'].includes(hint)
  ));
  const hasBlockedUse = sensitive.some(hint => (
    ['relationship_judgment', 'enterprise_screening', 'school_sorting', 'career_or_education_guarantee', 'destiny_or_mysticism'].includes(hint)
  ));
  const modelCallAllowed = promptPlan.allowed
    && (promptPlan.mode === 'quick_reading' || promptPlan.mode === 'safe_quick_reading')
    && !['R2', 'R3'].includes(riskLevel)
    && !hasProfessionalRisk
    && !hasBlockedUse;
  let requestType = 'none';

  if (modelCallAllowed && promptPlan.mode === 'safe_quick_reading') requestType = 'safe_quick_reading_request';
  else if (modelCallAllowed && promptPlan.mode === 'quick_reading') requestType = 'quick_reading_request';
  else if (promptPlan.mode === 'clarification') requestType = 'clarification_request';
  else if (promptPlan.mode === 'fallback') requestType = 'fallback_request';
  else if (promptPlan.mode === 'human_review') requestType = 'human_review_request';
  else if (promptPlan.mode === 'blocked') requestType = 'blocked_request';

  const blocked = !modelCallAllowed;
  const safetyGuards = unique([
    'risk_assessment_before_generation',
    'confidence_check_before_generation',
    'no_r2_r3_quick_reading_generation',
    'no_medical_or_psychological_diagnosis',
    'no_relationship_decision',
    'no_hiring_or_school_sorting',
    'no_education_or_career_guarantee',
    'no_child_labeling',
    'no_parent_blame',
    'human_review_for_high_risk',
    ...(isMinor ? ['minor_requires_extra_redaction', 'minor_human_review_condition'] : []),
  ]);
  const expectedOutputContracts = {
    quick_reading_request: {
      report_overview: 'string',
      user_main_question: 'string',
      reference_points: 'array',
      environment_observation_points: 'array',
      no_direct_conclusion_points: 'array',
      communication_or_observation_suggestions: 'array',
      human_review_suggestion: 'string',
    },
    safe_quick_reading_request: {
      report_overview: 'string',
      user_main_question: 'string',
      reference_points: 'array',
      environment_observation_points: 'array',
      no_direct_conclusion_points: 'array',
      communication_or_observation_suggestions: 'array',
      human_review_suggestion: 'string',
      safety_rewrite_required: true,
      forbidden_outputs: ['child_labeling', 'parent_blame', 'diagnosis', 'deterministic_conclusion'],
    },
    clarification_request: {
      questions: 'array',
      reason: 'string',
      next_step: 'string',
    },
    fallback_request: {
      safe_explanation: 'string',
      unsupported_reason: 'string',
      safer_next_step: 'string',
      human_review_suggestion: 'string',
    },
    human_review_request: {
      reason: 'string',
      risk_summary: 'array',
      suggested_manual_review_path: 'string',
    },
    blocked_request: {
      reason: 'string',
      risk_summary: 'array',
      suggested_manual_review_path: 'string',
    },
    none: {
      reason: 'string',
      next_step: 'string',
    },
  };

  return {
    enabled: true,
    requestType,
    targetPromptTypes: unique(promptPlan.promptChain),
    blocked,
    blockedReason: blocked
      ? promptPlan.reason
      : '当前路径仅允许未来模型生成 P0 快速读懂请求，且必须使用脱敏/节选输入。',
    modelCallAllowed,
    inputContract: {
      reportTextPolicy: 'redacted_or_excerpt_only',
      maxReportExcerptChars: 1200,
      allowedStructuredInputs: [
        'parseResult',
        'riskLevel',
        'confidence',
        'outputDecision',
        'allowedOutputType',
        'blockedReasons',
        'clarificationQuestions',
        'safetyNotes',
        'userIdentity',
        'userIntent',
        'reportType',
        'reportSubject',
        'subjectAge',
        'subjectRelation',
        'consentConfirmed',
      ],
      requiredFields: ['parseResult', 'riskLevel', 'confidence', 'outputDecision', 'promptPlan'],
      forbiddenFields: ['reportText', 'rawText', 'promptFullText', 'apiKey', 'environmentVariables', 'contactInfo', 'realName', 'medicalRecord'],
      structuredInputPreview: {
        reportTextLength: parseResult.reportTextLength,
        readableStatus: parseResult.readableStatus,
        detectedSubjectHints: parseResult.detectedSubjectHints,
        detectedIntentHints: parseResult.detectedIntentHints,
        detectedSensitiveHints: parseResult.detectedSensitiveHints,
        userIdentity: ctx.userIdentity,
        userIntent: ctx.userIntent,
        reportType: ctx.reportType,
        reportSubject: ctx.reportSubject,
        subjectAge: ctx.subjectAge,
        subjectRelation: ctx.subjectRelation,
        consentConfirmed: ctx.consentConfirmed,
      },
    },
    redactionPolicy: {
      noFullReportTextInApiResponse: true,
      noPromptFullTextInApiResponse: true,
      noRawRiskTermsInProduction: true,
      redactNames: true,
      redactContactInfo: true,
      redactMedicalDetails: true,
      redactChildIdentifiableInfo: true,
      debugDisabledByDefault: true,
    },
    safetyGuards,
    expectedOutputContract: expectedOutputContracts[requestType],
    humanReviewGate: {
      required: !!humanReview.required || riskLevel === 'R3' || hasProfessionalRisk,
      reason: humanReview.reason || (isMinor ? '未成年人场景建议条件触发人工复核。' : ''),
      route: humanReview.required || riskLevel === 'R3' || hasProfessionalRisk
        ? 'required_human_review'
        : (humanReview.recommended || isMinor ? 'conditional_human_review' : 'not_required'),
    },
    dryRunOnly: true,
    meta: {
      riskLevel,
      confidence,
      outputDecision,
      allowedOutputType,
      blockedReasonCodes: blockedReasons.map(reason => reason.code),
      clarificationQuestionCount: clarificationQuestions.length,
      safetyNoteCount: safetyNotes.length,
    },
  };
}

function buildRedactedExcerpt(reportText, riskLevel, canSendToModel) {
  if (!canSendToModel) return ['R2', 'R3'].includes(riskLevel) ? 'omitted_due_to_risk' : 'omitted_until_clarified';
  const source = text(reportText)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
    .replace(/1[3-9]\d{9}/g, '[redacted_phone]')
    .replace(/\d{6,}/g, '[redacted_number]');
  if (source.length <= 12) return 'omitted_due_to_short_text';
  const maxChars = Math.min(300, Math.max(12, source.length - 8));
  return `${source.slice(0, maxChars)}...[redacted_excerpt]`;
}

function outputContractForPayload(payloadType) {
  const quickReadingContract = {
    report_overview: 'string',
    user_main_question: 'string',
    reference_points: 'array',
    environment_observation_points: 'array',
    no_direct_conclusion_points: 'array',
    communication_or_observation_suggestions: 'array',
    human_review_suggestion: 'string',
    forbidden_outputs: ['diagnosis', 'deterministic_conclusion', 'relationship_decision', 'career_or_education_guarantee'],
  };
  const contracts = {
    quick_reading_payload: quickReadingContract,
    safe_quick_reading_payload: {
      ...quickReadingContract,
      safety_rewrite_required: true,
      forbidden_outputs: [...quickReadingContract.forbidden_outputs, 'child_labeling', 'parent_blame', 'anxiety_triggering_language'],
    },
    clarification_payload: {
      questions: 'array',
      reason: 'string',
      next_step: 'string',
    },
    fallback_payload: {
      safe_explanation: 'string',
      unsupported_reason: 'string',
      safer_next_step: 'string',
      human_review_suggestion: 'string',
    },
    human_review_payload: {
      reason: 'string',
      risk_summary: 'array',
      suggested_manual_review_path: 'string',
    },
    blocked_payload: {
      reason: 'string',
      risk_summary: 'array',
      suggested_manual_review_path: 'string',
    },
    none: {
      reason: 'string',
      next_step: 'string',
    },
  };
  return contracts[payloadType] || contracts.none;
}

function buildPromptPayloadDryRun({
  promptPlan,
  promptRequestDryRun,
  parseResult,
  riskLevel,
  confidence,
  outputDecision,
  allowedOutputType,
  blockedReasons,
  clarificationQuestions,
  quickReading,
  fallbackMessage,
  humanReview,
  safetyNotes,
  ctx,
}) {
  const payloadTypeMap = {
    quick_reading_request: 'quick_reading_payload',
    safe_quick_reading_request: 'safe_quick_reading_payload',
    clarification_request: 'clarification_payload',
    fallback_request: 'fallback_payload',
    human_review_request: 'human_review_payload',
    blocked_request: 'blocked_payload',
    none: 'none',
  };
  const payloadType = payloadTypeMap[promptRequestDryRun.requestType] || 'none';
  const canSendToModel = !!promptRequestDryRun.modelCallAllowed
    && ['quick_reading_payload', 'safe_quick_reading_payload'].includes(payloadType)
    && !['R2', 'R3'].includes(riskLevel);
  const blocked = !canSendToModel;
  const reportTextExcerpt = buildRedactedExcerpt(ctx.reportText, riskLevel, canSendToModel);
  const safetyInstructions = [
    '不要输出医学/心理诊断',
    '不要输出脑科学强结论',
    '不要输出关系去留判断',
    '不要输出招聘/筛选/淘汰建议',
    '不要输出学生分层建议',
    '不要输出升学/职业保证',
    '不要标签化孩子',
    '不要归因父母责任',
    '不要制造焦虑',
    '只输出 P0 允许结构',
  ];
  const outputContract = outputContractForPayload(payloadType);

  return {
    enabled: true,
    dryRunOnly: true,
    payloadType,
    canSendToModel,
    targetPromptTypes: unique(promptRequestDryRun.targetPromptTypes || []),
    blocked,
    blockedReason: blocked
      ? promptRequestDryRun.blockedReason
      : '当前 payload 仅为未来模型调用前的脱敏草稿，可用于 P0 快速读懂 dry-run。',
    payload: {
      promptPurpose: canSendToModel ? 'generate_p0_quick_reading' : 'prepare_safe_non_generation_path',
      promptType: payloadType,
      userContext: {
        userIdentity: ctx.userIdentity,
        userIntent: ctx.userIntent,
        subjectAge: ctx.subjectAge,
        subjectRelation: ctx.subjectRelation,
        consentConfirmed: ctx.consentConfirmed,
      },
      reportContext: {
        reportTextExcerpt,
        reportTextLength: parseResult.reportTextLength,
        readableStatus: parseResult.readableStatus,
        reportType: ctx.reportType,
        reportSubject: ctx.reportSubject,
        excerptPolicy: canSendToModel ? 'redacted_excerpt_max_300_chars' : reportTextExcerpt,
      },
      parsedSignals: {
        detectedSubjectHints: parseResult.detectedSubjectHints,
        detectedIntentHints: parseResult.detectedIntentHints,
        detectedSensitiveHints: parseResult.detectedSensitiveHints,
        textQualityHints: parseResult.textQualityHints,
      },
      riskContext: {
        riskLevel,
        blockedReasonCodes: blockedReasons.map(reason => reason.code),
        blockedReasonCount: blockedReasons.length,
      },
      confidenceContext: {
        confidence,
        readableStatus: parseResult.readableStatus,
      },
      outputDecisionContext: {
        outputDecision,
        allowedOutputType,
        promptPlanMode: promptPlan.mode,
        promptRequestType: promptRequestDryRun.requestType,
      },
      safetyBoundary: {
        safetyNotes,
        safetyInstructions,
        omittedFields: ['full_report_text', 'prompt_pack_full_text', 'api_keys', 'raw_risk_terms', 'contact_info', 'medical_details', 'child_identifiable_info'],
      },
      requestedOutputShape: outputContract,
      nonModelOutputsAvailable: {
        clarificationQuestionCount: clarificationQuestions.length,
        hasFallbackMessage: !!fallbackMessage,
        hasQuickReadingDraft: !!quickReading,
      },
    },
    redactionApplied: {
      fullReportTextOmitted: true,
      promptFullTextOmitted: true,
      namesRedacted: true,
      contactInfoRedacted: true,
      medicalDetailsRedacted: true,
      childIdentifiableInfoRedacted: true,
      highRiskTermsNotEchoed: true,
    },
    omittedFields: ['full_report_text', 'prompt_pack_full_text', 'api_keys', 'raw_risk_terms', 'contact_info', 'medical_details', 'child_identifiable_info'],
    safetyInstructions,
    outputContract,
    humanReviewGate: {
      required: !!humanReview.required || !!promptRequestDryRun.humanReviewGate.required,
      reason: humanReview.reason || promptRequestDryRun.humanReviewGate.reason,
      route: promptRequestDryRun.humanReviewGate.route,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      version: 'P0.5',
      source: 'prompt_payload_dry_run',
      noModelCall: true,
      canSendToModel,
      dryRunOnly: true,
    },
  };
}

function buildHumanReviewQueueDryRun({
  riskLevel,
  confidence,
  outputDecision,
  allowedOutputType,
  blockedReasons,
  clarificationQuestions,
  fallbackMessage,
  humanReview,
  safetyNotes,
  parseResult,
  promptPlan,
  promptRequestDryRun,
  promptPayloadDryRun,
  ctx,
}) {
  const sensitive = parseResult.detectedSensitiveHints || [];
  const blockedCodes = blockedReasons.map(reason => reason.code);
  const isMinor = sensitive.includes('minor') || parseResult.detectedSubjectHints.includes('child') || parseResult.detectedSubjectHints.includes('student');
  const hasProfessionalRisk = sensitive.some(hint => (
    ['diagnosis', 'medical', 'psychological', 'brain_science_claim', 'hypnosis', 'therapy', 'trauma'].includes(hint)
  )) || blockedCodes.includes('professional_domain_request') || blockedCodes.includes('medical_or_psychological_diagnosis');
  const hasRelationshipRisk = sensitive.includes('relationship_judgment') || blockedCodes.some(code => code.includes('relationship'));
  const hasEnterpriseSchoolRisk = sensitive.includes('enterprise_screening') || sensitive.includes('school_sorting')
    || blockedCodes.includes('enterprise_or_team_context') || blockedCodes.includes('school_context')
    || blockedCodes.includes('sorting_or_screening_from_text') || blockedCodes.includes('screening_or_elimination');
  const hasGuaranteeRisk = sensitive.includes('career_or_education_guarantee') || sensitive.includes('destiny_or_mysticism')
    || blockedCodes.includes('guarantee_request') || blockedCodes.includes('guarantee_or_determinism');
  const hasConsentRisk = blockedCodes.includes('third_party_without_confirmed_consent') || (!ctx.consentConfirmed && needsConsent(ctx));
  const insufficient = confidence === 'insufficient' || outputDecision === 'clarification_only' || clarificationQuestions.length > 0;
  const shouldCreateTicket = riskLevel === 'R2' || riskLevel === 'R3' || hasProfessionalRisk || hasRelationshipRisk
    || hasEnterpriseSchoolRisk || hasGuaranteeRisk || humanReview.required || (confidence === 'insufficient' && hasConsentRisk);

  let ticketType = 'none';
  if (hasProfessionalRisk) ticketType = 'medical_psychological_review';
  else if (hasEnterpriseSchoolRisk) ticketType = 'enterprise_school_review';
  else if (hasRelationshipRisk) ticketType = 'relationship_review';
  else if (riskLevel === 'R3') ticketType = 'blocked_case_review';
  else if (hasGuaranteeRisk) ticketType = riskLevel === 'R3' ? 'blocked_case_review' : 'safety_review';
  else if (riskLevel === 'R2') ticketType = 'fallback_review';
  else if (isMinor && (riskLevel === 'R1' || promptPlan.requiresSafetyRewrite)) ticketType = 'child_review';
  else if (confidence === 'insufficient' || (confidence === 'low' && clarificationQuestions.length)) ticketType = 'clarification_review';

  let priority = 'none';
  if (ticketType !== 'none') priority = 'low';
  if (riskLevel === 'R2' || hasRelationshipRisk || hasGuaranteeRisk) priority = 'medium';
  if (riskLevel === 'R3' || hasProfessionalRisk || hasEnterpriseSchoolRisk) priority = 'high';
  if (riskLevel === 'R3' && hasProfessionalRisk && isMinor) priority = 'urgent';

  const reviewReasons = [];
  if (riskLevel === 'R3') reviewReasons.push('high_risk_r3');
  if (riskLevel === 'R2') reviewReasons.push('medium_high_risk_r2');
  if (isMinor) reviewReasons.push('minor_involved');
  if (hasProfessionalRisk) reviewReasons.push('medical_or_psychological', 'diagnosis_request');
  if (hasRelationshipRisk) reviewReasons.push('relationship_decision');
  if (hasEnterpriseSchoolRisk) reviewReasons.push('enterprise_or_school_screening');
  if (hasConsentRisk) reviewReasons.push('consent_unclear');
  if (insufficient) reviewReasons.push('insufficient_information');
  if (promptPlan.requiresSafetyRewrite) reviewReasons.push('safety_rewrite_required');
  if (!promptPayloadDryRun.canSendToModel) reviewReasons.push('model_call_blocked');

  const reviewerInstructions = [
    '不要做医学/心理诊断',
    '不要做关系去留判断',
    '不要给招聘/筛选/淘汰建议',
    '不要用于学生分层/淘汰/定岗',
    '不要给升学/职业保证',
    '不要做命定化判断',
    '不要标签化孩子',
    '不要归因父母责任',
    '必要时建议专业支持或人工解读',
  ];

  let status = 'not_required';
  if (ticketType === 'clarification_review') status = 'clarification_needed_dry_run';
  else if (shouldCreateTicket && riskLevel === 'R3') status = 'blocked_dry_run';
  else if (shouldCreateTicket) status = 'queued_dry_run';

  const userVisibleMessage = (() => {
    if (status === 'not_required') return '当前可按 P0 快速读懂流程继续，输出仍会保持安全边界。';
    if (status === 'clarification_needed_dry_run') return '当前信息还不够完整，建议先补充你希望解决的问题，再继续解读。';
    if (riskLevel === 'R3') return '这个场景不适合自动给出结论，建议转为人工解读或寻求相关专业支持。';
    return '这个问题涉及较敏感的判断，建议由人工顾问进一步确认后再解读。';
  })();

  return {
    enabled: true,
    dryRunOnly: true,
    shouldCreateTicket,
    ticketType: shouldCreateTicket || ticketType === 'clarification_review' ? ticketType : 'none',
    priority: shouldCreateTicket || ticketType === 'clarification_review' ? priority : 'none',
    reviewReasons: unique(reviewReasons),
    riskSummary: {
      riskLevel,
      confidence,
      outputDecision,
      allowedOutputType,
      detectedSensitiveHints: sensitive,
      blockedReasons,
      canSendToModel: promptPayloadDryRun.canSendToModel,
    },
    reviewerInstructions,
    userVisibleMessage,
    privacyPolicy: {
      noFullReportTextInTicket: true,
      noPromptFullTextInTicket: true,
      noRawDebugInTicket: true,
      redactChildInfo: true,
      redactContactInfo: true,
      redactMedicalDetails: true,
      keepOnlyStructuredSignals: true,
    },
    allowedReviewerFields: [
      'riskLevel',
      'confidence',
      'outputDecision',
      'parseResult.detectedSubjectHints',
      'parseResult.detectedIntentHints',
      'parseResult.detectedSensitiveHints',
      'blockedReasons',
      'safetyNotes',
      'promptPlan.mode',
      'promptRequestDryRun.requestType',
      'promptPayloadDryRun.payloadType',
    ],
    omittedReviewerFields: ['full_report_text', 'prompt_pack_full_text', 'api_keys', 'raw_debug', 'raw_risk_terms', 'contact_info', 'medical_details', 'child_identifiable_info'],
    suggestedSLA: {
      responseWindow: priority === 'urgent' ? 'same_day' : (priority === 'high' ? '24_hours' : (priority === 'medium' ? '48_hours' : 'best_effort')),
      reason: priority === 'none' ? '未触发人工复核。' : '按风险等级、未成年人/专业边界和使用场景确定处理窗口。',
    },
    routing: {
      queue: ticketType === 'none' ? 'none' : 'report_upload_p0_human_review',
      assigneeRole: hasProfessionalRisk ? 'senior_safety_reviewer' : (isMinor ? 'child_safety_reviewer' : 'report_review_operator'),
      requiresSeniorReviewer: priority === 'high' || priority === 'urgent' || hasProfessionalRisk || hasEnterpriseSchoolRisk,
    },
    status,
    meta: {
      generatedAt: new Date().toISOString(),
      version: 'P0.6',
      source: 'human_review_queue_dry_run',
      noDatabaseWrite: true,
      noModelCall: true,
      noRawTextIncluded: true,
      safetyNoteCount: safetyNotes.length,
      fallbackAvailable: !!fallbackMessage,
    },
  };
}


function userVisibleOutputType(riskLevel, confidence) {
  if (riskLevel === 'R2' || riskLevel === 'R3') return 'fallback_or_human_review_output';
  if (confidence === 'low' || confidence === 'insufficient') return 'clarification_output';
  if (riskLevel === 'R1' && (confidence === 'high' || confidence === 'medium')) return 'safe_quick_reading_output';
  if (riskLevel === 'R0' && (confidence === 'high' || confidence === 'medium')) return 'quick_reading_output';
  return 'clarification_output';
}

function safeMainQuestion(ctx, riskLevel) {
  const source = `${ctx.userIntent} ${ctx.reportType} ${ctx.reportSubject} ${ctx.subjectRelation}`;
  if (includesAny(source, ['孩子', '儿童', '未成年', '学生', 'child', 'minor', 'student'])) return '理解孩子或学生的行为、学习方式和沟通需求';
  if (includesAny(source, ['关系', '伴侣', '亲密', '婚姻', '合伙', '合作', 'partner', 'relationship'])) return '整理关系或合作中的具体沟通场景';
  if (includesAny(source, ['企业', '团队', '员工', '候选人', '招聘', '录用', '淘汰', 'team', 'enterprise', 'candidate'])) return '在授权前提下理解协作和支持方式';
  if (includesAny(source, ['学校', '班级', '分层', '分班', 'teacher', 'school', 'class'])) return '在授权前提下理解学习支持方式';
  if (includesAny(source, ['心理', '医学', '诊断', '疾病', '治疗', 'ADHD'])) return '整理需要专业支持的问题边界';
  if (includesAny(source, ['升学', '职业', '保证', '成功', '方向'])) return '把学习或职业问题放回现实场景中观察';
  if (riskLevel === 'R2' || riskLevel === 'R3') return '先确认这个问题适合怎样安全讨论';
  if (ctx.userIntent === 'unknown') return '先确认你想用这份报告解决什么问题';
  return '快速读懂报告中可参考的倾向和沟通线索';
}

function buildSection(id, heading, body, bullets, sectionType) {
  return {
    id,
    heading,
    body,
    bullets: bullets || [],
    sectionType,
  };
}

function baseQualityGuards() {
  return {
    noDiagnosis: true,
    noRelationshipDecision: true,
    noHiringOrSchoolSorting: true,
    noEducationCareerGuarantee: true,
    noChildLabeling: true,
    noParentBlame: true,
    noMysticism: true,
    noFullReport: true,
  };
}

function baseOmittedContent() {
  return [
    'full_report',
    'diagnosis',
    'relationship_decision',
    'hiring_screening',
    'school_sorting',
    'education_guarantee',
    'career_guarantee',
    'internal_debug',
    'prompt_full_text',
  ];
}

function safeDiscussionDirections(ctx, blockedReasons) {
  const blockedCodes = blockedReasons.map(reason => reason.code).join(' ');
  const source = `${ctx.userIntent} ${ctx.reportType} ${ctx.reportSubject} ${ctx.subjectRelation} ${blockedCodes}`;
  if (includesAny(source, ['medical', 'psychological', 'diagnosis', '心理', '医学', '诊断', '疾病'])) {
    return ['具体表现出现的场景、持续时间和影响范围', '是否已经影响睡眠、学习、情绪或生活', '需要专业评估或专业支持的信号'];
  }
  if (includesAny(source, ['enterprise', 'team', 'candidate', '招聘', '录用', '淘汰', '企业', '团队'])) {
    return ['授权和脱敏后的沟通方式', '协作偏好和支持策略', '团队机制如何减少误解'];
  }
  if (includesAny(source, ['school', 'class', 'student', '学校', '班级', '分层', '分班'])) {
    return ['学习方式和支持策略', '家校沟通中可以确认的问题', '授权、用途和可见范围'];
  }
  if (includesAny(source, ['relationship', 'partner', '关系', '伴侣', '婚姻', '合伙'])) {
    return ['最近一次具体冲突或卡点', '双方各自表达出的需求', '下一次沟通可以先确认的问题'];
  }
  if (includesAny(source, ['guarantee', 'destiny', 'mysticism', '升学', '成功', '命运'])) {
    return ['现实中的学习或职业问题', '可以短期验证的观察点', '哪些因素需要结合环境和资源判断'];
  }
  return ['用户最想解决的具体场景', '报告中可读、可确认的部分', '下一步需要补充的关键信息'];
}

function buildQuickVisibleSections(ctx, quickReading, outputType) {
  const isSafe = outputType === 'safe_quick_reading_output';
  const referencePoints = quickReading ? quickReading.referencePoints : [
    '先看报告中已经可读、可确认的部分。',
    '把报告内容连接到一个具体场景。',
    '结合年龄、后天环境和现实观察验证。',
  ];
  const noConclusion = quickReading ? quickReading.noConclusionAreas : [
    '不做医学、心理或疾病判断。',
    '不做职业、学习、关系或机构处置类结论。',
    '不把单一指标当成完整判断。',
  ];
  const suggestions = quickReading ? quickReading.communicationSuggestions : [
    '先选一个真实场景观察 1-2 周。',
    '用低压力问题确认需求。',
    '资料不足时先补充年龄、身份、授权和关键指标。',
  ];

  return [
    buildSection(
      'safety_intro',
      isSafe ? '先说明边界' : '先把报告放在合适的位置',
      isSafe
        ? '涉及孩子、学生或轻敏场景时，这份报告只能作为理解行为和沟通方式的参考，不能给人下定义。'
        : '这份报告可以作为理解倾向和沟通方式的参考，不是对人的定论。',
      isSafe ? ['不标签化孩子', '不归因父母责任', '不判断未来'] : ['不做诊断', '不预测未来', '不替代现实观察'],
      'safety_intro'
    ),
    buildSection(
      'report_overview',
      '这份报告大概在讲什么',
      'P0 阶段只做快速读懂，帮助你先看见可参考的信息和需要谨慎使用的地方。',
      ['可读信息先解释', '缺失信息不补写', '复杂问题不自动下结论'],
      'report_overview'
    ),
    buildSection(
      'main_question',
      '你当前最关心的问题',
      safeMainQuestion(ctx, isSafe ? 'R1' : 'R0'),
      [],
      'main_question'
    ),
    buildSection(
      'reference_points',
      '可以参考的理解点',
      '这些点只能作为观察线索，需要和真实生活场景互相校正。',
      referencePoints.slice(0, 5),
      'reference_points'
    ),
    buildSection(
      'environment_observation',
      '需要结合后天环境观察的地方',
      '先天倾向、后天环境和当前场景会一起影响当下表现。',
      ['看这个表现出现在哪些场景', '看它持续多久、影响多大', '看近期环境或角色是否有变化'],
      'environment_observation'
    ),
    buildSection(
      'no_direct_conclusion',
      '不建议直接下结论的地方',
      '报告不能替代医学、心理、教育、职业、关系或组织管理中的专业判断。',
      noConclusion,
      'no_direct_conclusion'
    ),
    buildSection(
      'communication_suggestions',
      '可以尝试的沟通 / 观察建议',
      isSafe ? '先把行为翻译成需求，再决定怎么回应。' : '先用小范围观察替代直接判断。',
      suggestions,
      'communication_suggestions'
    ),
    buildSection(
      'human_review_suggestion',
      '是否建议人工解读',
      quickReading && quickReading.humanReviewSuggestion ? quickReading.humanReviewSuggestion : '如果你希望把报告讲到具体场景里，这个问题更适合人工一起看。',
      [],
      'human_review_suggestion'
    ),
  ];
}

function buildClarificationVisibleSections(ctx, clarificationQuestions) {
  const questions = clarificationQuestions.length ? clarificationQuestions : [
    '这份报告是看你自己、孩子，还是他人/客户？',
    '你这次最想解决的具体问题是什么？',
    '能否补充更清晰的报告文字或关键指标？',
  ];
  return [
    buildSection(
      'safety_intro',
      '当前先不直接生成解读',
      '为了避免把报告讲偏，我需要先确认关键信息。',
      ['不硬生成', '不补写缺失资料', '不诱导过度隐私'],
      'safety_intro'
    ),
    buildSection(
      'clarification_questions',
      '需要你补充的信息',
      '这些问题会帮助系统判断能否输出快速读懂、追问、降级或转人工建议。',
      questions.slice(0, 5),
      'clarification_questions'
    ),
    buildSection(
      'report_overview',
      '为什么需要这些信息',
      '报告对象、年龄、关系、授权和使用目的不同，输出边界会不同。',
      ['涉及孩子会更保守', '涉及他人资料要确认授权', '涉及重大判断会建议人工复核'],
      'report_overview'
    ),
    buildSection(
      'communication_suggestions',
      '补充后可以输出什么',
      '补充后可以先生成快速读懂：哪些信息可以参考、哪些地方不能直接下结论，以及下一步怎么观察或沟通。',
      [],
      'communication_suggestions'
    ),
  ];
}

function buildFallbackVisibleSections(ctx, blockedReasons, fallbackMessage, humanReviewQueueDryRun) {
  return [
    buildSection(
      'fallback_explanation',
      '当前问题不适合自动生成结论',
      fallbackMessage || '这个问题需要先降级处理，不能由系统直接给出判断。',
      ['系统不会自动给重大结论', '不会把报告用于人事、学校或专业判断', '复杂场景建议人工一起看'],
      'fallback_explanation'
    ),
    buildSection(
      'report_overview',
      '为什么需要降级或人工复核',
      '当前问题可能涉及未成年人、医学心理、关系重大判断、学校企业用途、隐私授权或结果保证等边界。',
      ['这些场景容易误导用户', '需要结合授权、真实环境和专业判断', '不能只依据一份报告下结论'],
      'report_overview'
    ),
    buildSection(
      'environment_observation',
      '可以安全讨论的方向',
      '系统仍可以帮助你把问题整理成更安全、可沟通的方向。',
      safeDiscussionDirections(ctx, blockedReasons),
      'environment_observation'
    ),
    buildSection(
      'no_direct_conclusion',
      '不会自动判断的内容',
      'P0 不输出完整长报告，也不输出诊断、关系定论、人事处置、学校处置或结果承诺。',
      ['不做医学/心理诊断', '不做关系或合作结论', '不做人事、学校或结果承诺类判断'],
      'no_direct_conclusion'
    ),
    buildSection(
      'human_review_suggestion',
      '建议下一步',
      humanReviewQueueDryRun && humanReviewQueueDryRun.userVisibleMessage
        ? humanReviewQueueDryRun.userVisibleMessage
        : '建议补充具体场景，并由人工在安全边界内一起看。',
      ['先说明你真正想解决的问题', '准备完整、清晰且已授权的资料', '必要时寻求专业支持'],
      'human_review_suggestion'
    ),
  ];
}

function buildUserVisibleOutput({
  riskLevel,
  confidence,
  outputDecision,
  allowedOutputType,
  blockedReasons,
  clarificationQuestions,
  quickReading,
  fallbackMessage,
  humanReview,
  safetyNotes,
  parseResult,
  promptPlan,
  promptRequestDryRun,
  promptPayloadDryRun,
  humanReviewQueueDryRun,
  userIdentity,
  userIntent,
  reportType,
  reportSubject,
  subjectAge,
  subjectRelation,
  consentConfirmed,
}) {
  const ctx = {
    userIdentity,
    userIntent,
    reportType,
    reportSubject,
    subjectAge,
    subjectRelation,
    consentConfirmed,
  };
  const outputType = userVisibleOutputType(riskLevel, confidence);
  let title = '先安全读懂这份报告';
  let subtitle = '这不是对人的定论，更适合用来帮助沟通和观察。';
  let sections = [];
  let cta = { type: 'none', label: '', message: '' };

  if (outputType === 'quick_reading_output') {
    title = '快速读懂这份报告';
    subtitle = '先看可参考的倾向，再结合现实场景观察。';
    sections = buildQuickVisibleSections(ctx, quickReading, outputType);
    cta = {
      type: 'continue_observation',
      label: '继续观察一个具体场景',
      message: '建议你先选一个最近最真实的问题，观察它是否和报告中的倾向对应。',
    };
  } else if (outputType === 'safe_quick_reading_output') {
    title = '先安全理解这个行为';
    subtitle = '涉及孩子或轻敏场景时，只做行为观察和沟通参考。';
    sections = buildQuickVisibleSections(ctx, quickReading, outputType);
    cta = {
      type: 'human_review',
      label: '需要时人工一起看',
      message: '如果这个问题反复出现，或已经影响学习、情绪、睡眠、关系，建议人工解读或专业支持。',
    };
  } else if (outputType === 'clarification_output') {
    title = '先补充几个关键信息';
    subtitle = '当前信息还不足以支持自动判断。';
    sections = buildClarificationVisibleSections(ctx, clarificationQuestions);
    cta = {
      type: 'clarify',
      label: '补充信息后再生成',
      message: '补充对象、目的、授权和关键指标后，可以继续生成快速读懂。',
    };
  } else if (outputType === 'fallback_or_human_review_output') {
    title = '这个问题更适合谨慎处理';
    subtitle = '系统不会自动给出重大判断，可以先整理安全讨论方向。';
    sections = buildFallbackVisibleSections(ctx, blockedReasons, fallbackMessage, humanReviewQueueDryRun);
    cta = {
      type: humanReview && humanReview.recommended ? 'human_review' : 'clarify',
      label: humanReview && humanReview.recommended ? '建议人工复核' : '先补充具体场景',
      message: humanReview && humanReview.recommended
        ? '这个问题更适合人工在安全边界内一起看。'
        : '请先补充你真正想解决的具体场景。',
    };
  }

  return {
    enabled: true,
    dryRunOnly: true,
    outputType,
    title,
    subtitle,
    sections,
    cta,
    safetyNotice: unique([
      '本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。',
      '这不是对人的定论，需要结合具体环境观察。',
      ...(riskLevel === 'R1' ? ['涉及孩子或学生时，默认更保守，不贴标签、不归因父母。'] : []),
      ...(riskLevel === 'R2' || riskLevel === 'R3' ? ['当前场景不适合自动生成结论，建议降级或人工复核。'] : []),
    ]),
    qualityGuards: baseQualityGuards(),
    omittedContent: baseOmittedContent(),
    meta: {
      version: 'P0.9',
      source: 'user_visible_output_dry_run',
      generatedAt: new Date().toISOString(),
      noModelCall: true,
      riskLevel,
      confidence,
      outputDecision,
      allowedOutputType,
      promptPlanMode: promptPlan && promptPlan.mode,
      promptRequestType: promptRequestDryRun && promptRequestDryRun.requestType,
      promptPayloadType: promptPayloadDryRun && promptPayloadDryRun.payloadType,
      humanReviewStatus: humanReviewQueueDryRun && humanReviewQueueDryRun.status,
      reportTextLength: parseResult && parseResult.reportTextLength,
      safetyNoteCount: safetyNotes ? safetyNotes.length : 0,
    },
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
  const promptPlan = buildPromptPlan({
    riskLevel: risk.riskLevel,
    confidence,
    outputDecision,
    allowedOutputType: allowedOutputType(outputDecision),
    parseResult: ctx.parseResult,
    humanReview,
  });
  const promptRequestDryRun = buildPromptRequestDryRun({
    promptPlan,
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
    ctx,
  });
  const promptPayloadDryRun = buildPromptPayloadDryRun({
    promptPlan,
    promptRequestDryRun,
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
    ctx,
  });
  const humanReviewQueueDryRun = buildHumanReviewQueueDryRun({
    riskLevel: risk.riskLevel,
    confidence,
    outputDecision,
    allowedOutputType: allowedOutputType(outputDecision),
    blockedReasons,
    clarificationQuestions,
    fallbackMessage,
    humanReview,
    safetyNotes: SAFETY_NOTES,
    parseResult: ctx.parseResult,
    promptPlan,
    promptRequestDryRun,
    promptPayloadDryRun,
    ctx,
  });
  const userVisibleOutput = buildUserVisibleOutput({
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
    parseResult: ctx.parseResult,
    promptPlan,
    promptRequestDryRun,
    promptPayloadDryRun,
    humanReviewQueueDryRun,
    userIdentity: ctx.userIdentity,
    userIntent: ctx.userIntent,
    reportType: ctx.reportType,
    reportSubject: ctx.reportSubject,
    subjectAge: ctx.subjectAge,
    subjectRelation: ctx.subjectRelation,
    consentConfirmed: ctx.consentConfirmed,
  });
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
    promptPlan,
    promptRequestDryRun,
    promptPayloadDryRun,
    humanReviewQueueDryRun,
    userVisibleOutput,
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
