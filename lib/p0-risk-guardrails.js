const FORBIDDEN_TERMS = [
  '诊断',
  '治疗',
  '创伤修复',
  '心理问题',
  '孩子就是',
  '家长必须',
  '一定',
  '必然',
  '病理',
  '抑郁',
  '焦虑症',
  '人格障碍',
  '创伤',
  '疗愈',
];

const R31_FALLBACK_TEXT = '该内容建议由人工解读时结合家庭具体情况说明。当前报告仅提供观察方向，不直接判断家庭成员对错。';

function scanExpressionRisk(expression, terms = FORBIDDEN_TERMS) {
  const fields = ['userVisibleOutput', 'parentInterpretation', 'parentActionSuggestion'];
  const hits = [];

  for (const field of fields) {
    const value = String(expression && expression[field] ? expression[field] : '');
    for (const term of terms) {
      if (value.includes(term)) hits.push({ field, term });
    }
  }

  return {
    passed: hits.length === 0,
    hits,
    riskReason: hits.length ? hits.map(hit => `${hit.field}:${hit.term}`).join('; ') : '',
  };
}

function applyExpressionGuardrails(expression) {
  const scan = scanExpressionRisk(expression);
  const isR31 = expression && expression.expression_id === 'R31';
  const needsHumanReview = !!(expression && expression.needsHumanReview) || isR31 || !scan.passed;
  const fallbackText = isR31
    ? R31_FALLBACK_TEXT
    : (expression && expression.fallbackText) || '这部分内容更适合由人工结合具体情况解读。当前报告仅提供观察方向，不作为确定判断。';

  return {
    passed: scan.passed && !isR31,
    riskGuardrailPassed: scan.passed,
    needsHumanReview,
    requiresFallback: !scan.passed || isR31,
    riskReason: isR31
      ? 'R31 老人带娃冲突沟通必须人工复核'
      : scan.riskReason,
    forbiddenHits: scan.hits,
    fallbackText,
  };
}

module.exports = {
  FORBIDDEN_TERMS,
  R31_FALLBACK_TEXT,
  scanExpressionRisk,
  applyExpressionGuardrails,
};
