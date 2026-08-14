const assert = require('assert');

const originalFetch = global.fetch;
process.env.DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || 'TEST_ONLY_KEY';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'TEST_ONLY_SESSION_SECRET_32_BYTES';

global.fetch = async () => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: '===模块一===\n内容在这里中断' },
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
  },
});

const { callClaude, MODEL_FREE } = require('../api/_lib');

(async () => {
  try {
    const modelResult = await callClaude({
      model: MODEL_FREE,
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 10,
    });
    assert.strictEqual(modelResult.finishReason, 'length', 'AI wrapper 必须保留 finish_reason');

    const reportTest = require('../api/generate-report')._test;
    assert.strictEqual(typeof reportTest.isCompleteGeneratedPart, 'function', '必须导出完整性检查器');
    assert.strictEqual(typeof reportTest.chunkModules, 'function', '必须导出分块函数');

    const modules = ['模块一', '模块二', '模块三'];
    const complete = [
      '===模块一===\n完整内容。',
      '===模块二===\n完整内容。',
      '===模块三===\n完整内容。',
      '===END===',
    ].join('\n\n');

    assert.strictEqual(
      reportTest.isCompleteGeneratedPart(complete, modules, [], 'stop'),
      true,
      '包含全部模块且正常结束的回复必须通过',
    );
    assert.strictEqual(
      reportTest.isCompleteGeneratedPart(complete, modules, [], 'length'),
      false,
      'finish_reason=length 必须拒绝',
    );
    assert.strictEqual(
      reportTest.isCompleteGeneratedPart(complete.replace(/===END===$/, ''), modules, [], 'stop'),
      false,
      '缺少 END 标记必须拒绝',
    );
    assert.strictEqual(
      reportTest.isCompleteGeneratedPart('===模块一===\n完整内容。\n\n===END===', modules, [], 'stop'),
      false,
      '缺少分组末尾模块必须拒绝',
    );
    assert.strictEqual(
      reportTest.isCompleteGeneratedPart('===issue:关注问题===\n完整内容。\n\n===END===', [], ['关注问题'], 'stop'),
      true,
      '完整 issue 分组必须通过',
    );
    assert.deepStrictEqual(
      reportTest.chunkModules(Array.from({ length: 12 }, (_, index) => index + 1), 3).map(chunk => chunk.length),
      [3, 3, 3, 3],
      '12 个固定模块必须按每组 3 个拆分',
    );

    const allModules = Array.from({ length: 12 }, (_, index) => `模块${index + 1}`);
    for (const group of reportTest.chunkModules(allModules, 3)) {
      const groupText = `${group.map(title => `===${title}===\n完整内容。`).join('\n\n')}\n\n===END===`;
      assert.strictEqual(
        reportTest.isCompleteGeneratedPart(groupText, group, [], 'stop'),
        true,
        `完整分组必须通过：${group.join(',')}`,
      );
      assert.strictEqual(
        reportTest.isCompleteGeneratedPart(groupText.replace(/===END===$/, ''), group, [], 'stop'),
        false,
        `任意分组中途结束都必须拒绝：${group.join(',')}`,
      );
    }

    console.log('PASS: generated report parts reject truncation and preserve all expected modules');
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => {
  global.fetch = originalFetch;
  console.error(error);
  process.exit(1);
});
