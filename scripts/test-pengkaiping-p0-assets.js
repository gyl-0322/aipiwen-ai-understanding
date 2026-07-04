const { Readable } = require('stream');
const handler = require('../lib/report-upload-p0-dryrun.js');
const {
  loadPengKaipingV01Assets,
  buildPengKaipingV01Preview,
  maybeBuildPengKaipingV01Preview,
  validateAssets,
} = require('../lib/p0-expression-assets');

function mockReq(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function callApi(body) {
  const res = mockRes();
  await handler(mockReq(body), res);
  return res.payload;
}

function assertCase(condition, message) {
  if (!condition) throw new Error(message);
}

function visibleText(response) {
  const output = response.userVisibleOutput || {};
  return JSON.stringify({
    title: output.title,
    subtitle: output.subtitle,
    sections: output.sections,
    cta: output.cta,
    safetyNotice: output.safetyNotice,
  });
}

const BASE_CHILD_INPUT = {
  reportText: '孩子最近写作业拖拉、容易生气，家长想结合报告理解孩子行为。',
  reportType: 'child',
  userIdentity: 'parent',
  userIntent: 'understand_child_behavior',
  reportSubject: 'child',
  subjectAge: 11,
  subjectRelation: 'parent_child',
  consentConfirmed: true,
};

const AUTO_EXPRESSION_IDS = ['R06', 'R04', 'R05', 'R07', 'R10', 'R15', 'R16', 'R19', 'R20'];
const FORBIDDEN_TERMS = ['诊断', '治疗', '创伤修复', '心理问题', '孩子就是', '家长必须', '一定', '必然', '病理', '抑郁', '焦虑症', '人格障碍', '创伤', '疗愈'];

async function testFlagOffNoop() {
  process.env.PENGKAIPING_V01_P0_ENABLED = 'false';
  const response = await callApi({ ...BASE_CHILD_INPUT, pengkaipingExpressionId: 'R06' });
  assertCase(response.ok === true, 'flag off response should be ok');
  assertCase(!response.pengkaipingV01, 'flag off must not include pengkaipingV01');
}

function testAssetSchema() {
  const assets = loadPengKaipingV01Assets();
  assertCase(assets.length === 10, 'should load 10 PengKaiping v01 expressions');
  const ids = assets.map(asset => asset.expression_id);
  for (const id of [...AUTO_EXPRESSION_IDS, 'R31']) {
    assertCase(ids.includes(id), `missing expression ${id}`);
  }
  const r31 = assets.find(asset => asset.expression_id === 'R31');
  assertCase(r31.needsHumanReview === true, 'R31 must require human review');
}

async function testAutoExpressions() {
  process.env.PENGKAIPING_V01_P0_ENABLED = 'true';
  for (const id of AUTO_EXPRESSION_IDS) {
    const response = await callApi({ ...BASE_CHILD_INPUT, pengkaipingExpressionId: id });
    assertCase(response.ok === true, `${id} response should be ok`);
    assertCase(response.pengkaipingV01 && response.pengkaipingV01.expressionId === id, `${id} should return preview metadata`);
    assertCase(response.pengkaipingV01.autoInsertAllowed === true, `${id} should allow local dry-run auto insert`);
    assertCase(response.pengkaipingV01.needsHumanReview === false, `${id} should not need human review`);
    assertCase(response.pengkaipingV01.riskGuardrailPassed === true, `${id} should pass risk guardrail`);
    assertCase(response.pengkaipingV01.fieldDraft && response.pengkaipingV01.fieldDraft.userVisibleOutput, `${id} should include field draft`);
    for (const term of FORBIDDEN_TERMS) {
      assertCase(!response.pengkaipingV01.fieldDraft.userVisibleOutput.includes(term), `${id} field draft must not include ${term}`);
    }
  }
}

async function testR31HumanReview() {
  process.env.PENGKAIPING_V01_P0_ENABLED = 'true';
  const response = await callApi({ ...BASE_CHILD_INPUT, pengkaipingExpressionId: 'R31' });
  assertCase(response.ok === true, 'R31 response should be ok');
  assertCase(response.pengkaipingV01.expressionId === 'R31', 'R31 preview should be returned');
  assertCase(response.pengkaipingV01.needsHumanReview === true, 'R31 must need human review');
  assertCase(response.pengkaipingV01.autoInsertAllowed === false, 'R31 must not auto insert');
  assertCase(response.pengkaipingV01.fallbackUsed === true, 'R31 should use fallback in preview');
  assertCase(response.pengkaipingV01.riskReason.includes('R31'), 'R31 should record risk reason');
  assertCase(!visibleText(response).includes('老人带娃冲突沟通'), 'R31 must not be written into userVisibleOutput');
}

function testRiskFallback() {
  const [safeAsset] = loadPengKaipingV01Assets();
  const risky = {
    ...safeAsset,
    expression_id: 'TEST_RISK',
    userVisibleOutput: `${safeAsset.userVisibleOutput}\n孩子就是需要马上纠正。`,
  };
  const preview = buildPengKaipingV01Preview({ expression: risky, assetSource: 'unit-test' });
  assertCase(preview.needsHumanReview === true, 'risk hit should require human review');
  assertCase(preview.autoInsertAllowed === false, 'risk hit should not auto insert');
  assertCase(preview.fallbackUsed === true, 'risk hit should use fallback');
  assertCase(preview.riskReason.includes('孩子就是'), 'risk reason should include hit term');
  assertCase(!preview.fieldDraft.userVisibleOutput.includes('孩子就是'), 'fallback draft should not include risky term');
}

function testMissingAssetFallback() {
  process.env.PENGKAIPING_V01_P0_ENABLED = 'true';
  const preview = maybeBuildPengKaipingV01Preview({
    expressionId: 'R06',
    assetPath: '/tmp/aipiwen-missing-pengkaiping-v01.json',
  });
  assertCase(preview.fallbackUsed === true, 'missing asset should fallback');
  assertCase(preview.needsHumanReview === true, 'missing asset should require review');
  assertCase(preview.riskReason.includes('asset_load_error'), 'missing asset should record asset load error');
}

function testInvalidSchemaFails() {
  const [asset] = loadPengKaipingV01Assets();
  const invalid = { ...asset };
  delete invalid.userVisibleOutput;
  let failed = false;
  try {
    validateAssets([invalid]);
  } catch (error) {
    failed = error.message.includes('missing field');
  }
  assertCase(failed, 'invalid schema should fail clearly');
}

async function run() {
  const tests = [
    ['flag_off_noop', testFlagOffNoop],
    ['asset_schema', testAssetSchema],
    ['auto_expressions', testAutoExpressions],
    ['r31_human_review', testR31HumanReview],
    ['risk_fallback', testRiskFallback],
    ['missing_asset_fallback', testMissingAssetFallback],
    ['invalid_schema_fails', testInvalidSchemaFails],
  ];
  const failed = [];

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed.push({ name, error: error.message });
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }

  const summary = {
    total: tests.length,
    passed: tests.length - failed.length,
    failed: failed.length,
    failedCases: failed,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

run().catch(error => {
  console.error(`FAIL test_runner: ${error.message}`);
  process.exitCode = 1;
});
