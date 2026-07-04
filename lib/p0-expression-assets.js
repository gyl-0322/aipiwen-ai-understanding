const fs = require('fs');
const path = require('path');
const { applyExpressionGuardrails } = require('./p0-risk-guardrails');

const ASSET_PATH = path.join(__dirname, '..', 'data', 'p0-expression-assets', 'pengkaiping-v01.json');
const REQUIRED_FIELDS = [
  'expression_id',
  'theme',
  'module',
  'userVisibleOutput',
  'parentInterpretation',
  'parentActionSuggestion',
  'riskLevel',
  'p0Ready',
  'needsHumanReview',
  'allowedFields',
  'blockedFields',
  'boundaryNotes',
  'fallbackText',
];

function isPengKaipingP0Enabled(env = process.env) {
  return env.PENGKAIPING_V01_P0_ENABLED === 'true' && env.NODE_ENV !== 'production';
}

function validateExpression(expression, seenIds) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in expression)) throw new Error(`PengKaiping v01 asset missing field: ${field}`);
  }
  if (seenIds.has(expression.expression_id)) throw new Error(`Duplicate PengKaiping v01 expression_id: ${expression.expression_id}`);
  seenIds.add(expression.expression_id);
  if (expression.expression_id === 'R31' && expression.needsHumanReview !== true) {
    throw new Error('R31 must be marked needsHumanReview=true');
  }
  if (!Array.isArray(expression.allowedFields)) throw new Error(`Expression ${expression.expression_id} allowedFields must be an array`);
  if (!Array.isArray(expression.blockedFields)) throw new Error(`Expression ${expression.expression_id} blockedFields must be an array`);
}

function validateAssets(assets) {
  if (!Array.isArray(assets)) throw new Error('PengKaiping v01 asset must be an array');
  const seenIds = new Set();
  for (const expression of assets) validateExpression(expression, seenIds);
  return assets;
}

function loadPengKaipingV01Assets(assetPath = ASSET_PATH) {
  const raw = fs.readFileSync(assetPath, 'utf8');
  return validateAssets(JSON.parse(raw));
}

function findExpression(assets, expressionId) {
  return assets.find(asset => asset.expression_id === expressionId);
}

function buildFieldDraft(expression, guardrail) {
  if (guardrail.requiresFallback) {
    return {
      userVisibleOutput: guardrail.fallbackText,
      parentInterpretation: guardrail.fallbackText,
      parentActionSuggestion: '',
      boundaryNote: expression.boundaryNotes,
      internalReviewNote: guardrail.riskReason,
    };
  }

  return {
    userVisibleOutput: expression.userVisibleOutput,
    parentInterpretation: expression.parentInterpretation,
    parentActionSuggestion: expression.parentActionSuggestion,
    boundaryNote: expression.boundaryNotes,
    internalReviewNote: '',
  };
}

function buildPengKaipingV01Preview({ expression, assetSource }) {
  const guardrail = applyExpressionGuardrails(expression);
  return {
    enabled: true,
    assetVersion: 'pengkaiping-v01',
    assetSource,
    expressionId: expression.expression_id,
    theme: expression.theme,
    module: expression.module,
    p0Ready: expression.p0Ready === true,
    autoInsertAllowed: expression.p0Ready === true && !guardrail.needsHumanReview && guardrail.passed,
    needsHumanReview: guardrail.needsHumanReview,
    riskGuardrailPassed: guardrail.riskGuardrailPassed,
    fallbackUsed: guardrail.requiresFallback,
    riskReason: guardrail.riskReason,
    allowedFields: expression.allowedFields,
    blockedFields: expression.blockedFields,
    fieldDraft: buildFieldDraft(expression, guardrail),
  };
}

function maybeBuildPengKaipingV01Preview({ expressionId, env = process.env, assetPath = ASSET_PATH } = {}) {
  if (!isPengKaipingP0Enabled(env)) return null;
  if (!expressionId) {
    return {
      enabled: true,
      assetVersion: 'pengkaiping-v01',
      noMatch: true,
      reason: 'No pengkaipingExpressionId provided',
    };
  }

  try {
    const assets = loadPengKaipingV01Assets(assetPath);
    const expression = findExpression(assets, expressionId);
    if (!expression) {
      return {
        enabled: true,
        assetVersion: 'pengkaiping-v01',
        noMatch: true,
        expressionId,
        reason: 'Expression not found',
      };
    }
    return buildPengKaipingV01Preview({ expression, assetSource: assetPath });
  } catch (error) {
    return {
      enabled: true,
      assetVersion: 'pengkaiping-v01',
      fallbackUsed: true,
      needsHumanReview: true,
      riskGuardrailPassed: false,
      riskReason: `asset_load_error:${error.message}`,
    };
  }
}

module.exports = {
  ASSET_PATH,
  REQUIRED_FIELDS,
  isPengKaipingP0Enabled,
  validateAssets,
  loadPengKaipingV01Assets,
  findExpression,
  buildPengKaipingV01Preview,
  maybeBuildPengKaipingV01Preview,
};
