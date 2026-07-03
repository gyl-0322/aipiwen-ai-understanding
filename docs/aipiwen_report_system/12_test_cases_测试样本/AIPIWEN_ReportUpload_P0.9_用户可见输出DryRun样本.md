# AIPIWEN Report Upload P0.9 用户可见输出 Dry-run 样本

版本：P0.9  
状态：本地 dry-run 测试说明  
适用范围：`lib/report-upload-p0-dryrun.js` 的 `userVisibleOutput` 字段  
约束：不接真实 AI，不接真实上传，不写数据库，不接 Obsidian，不代表已上线。

## 1. P0.9 目标

P0.9 的目标是把 P0.8 报告输出内容契约落到 dry-run 响应结构里，生成未来页面可渲染的用户可见输出：

```text
reportText
→ parseResult
→ riskLevel
→ confidence
→ outputDecision
→ promptPlan
→ promptRequestDryRun
→ promptPayloadDryRun
→ humanReviewQueueDryRun
→ userVisibleOutput
```

本阶段不是正式报告生成，不调用模型，不读取真实文件，不写数据库。

## 2. userVisibleOutput 结构

每个 dry-run 响应必须包含：

```js
userVisibleOutput: {
  enabled,
  dryRunOnly,
  outputType,
  title,
  subtitle,
  sections,
  cta,
  safetyNotice,
  qualityGuards,
  omittedContent,
  meta
}
```

字段要求：

| 字段 | 要求 |
| --- | --- |
| `enabled` | 必须为 `true` |
| `dryRunOnly` | 必须为 `true` |
| `outputType` | 只能为 `quick_reading_output` / `safe_quick_reading_output` / `clarification_output` / `fallback_or_human_review_output` / `none` |
| `title` | 用户可见标题，温和、清楚、不夸大 |
| `subtitle` | 一句话边界说明，不下定论 |
| `sections` | 页面可渲染章节数组 |
| `cta` | 用户下一步动作 |
| `safetyNotice` | 温和边界说明 |
| `qualityGuards` | 输出红线保护开关 |
| `omittedContent` | 明确哪些内容不会输出 |
| `meta` | dry-run 元信息，不含原文全文 |

## 3. 12 个样本的输出类型预期

| 编号 | 样本 | 预期输出类型 |
| --- | --- | --- |
| 1 | `normal_personal_quick_reading` | `quick_reading_output` |
| 2 | `parent_understands_child_behavior` | `safe_quick_reading_output` |
| 3 | `minor_psychological_diagnosis` | `fallback_or_human_review_output` |
| 4 | `relationship_decision` | `fallback_or_human_review_output` |
| 5 | `enterprise_hiring_screening` | `fallback_or_human_review_output` |
| 6 | `school_grouping` | `fallback_or_human_review_output` |
| 7 | `education_guarantee` | `fallback_or_human_review_output` |
| 8 | `destiny_or_mysticism` | `fallback_or_human_review_output` |
| 9 | `insufficient_information` | `clarification_output` |
| 10 | `debug_false_by_default` | `safe_quick_reading_output` |
| 11 | `debug_true_without_full_text` | `safe_quick_reading_output` |
| 12 | `r2_r3_privacy_protection` | `fallback_or_human_review_output` |

## 4. 禁用表达检查项

`userVisibleOutput` 不得包含：

- 你就是……
- 这个孩子就是……
- 这个人一定……
- 天生适合……
- 天生不适合……
- 未来一定……
- 父母导致……
- 这是心理问题
- 这是精神问题
- 可以诊断为……
- 适合录用
- 不适合录用
- 应该分班
- 应该淘汰
- 保证升学
- 保证成功
- 命中注定
- 这是脑科学证明
- 问题孩子
- 风险学生
- 你们不合适
- 他就是不爱你
- 报告已经证明
- 报告一定比你更懂你

专项样本检查：

- 未成年人样本不得出现孩子标签化或父母责任归因。
- 企业/学校样本不得出现人事或学校处置建议。
- 升学样本不得出现结果保证。
- 关系样本不得出现关系去留定论。
- debug/隐私样本不得出现 Prompt Pack 全文、内部 Prompt 全文或完整 `reportText`。

## 5. 当前限制

当前 P0.9 仍然是 dry-run：

- 不调用真实 AI。
- 不接真实上传。
- 不写数据库。
- 不接 Obsidian。
- 不修改页面 / JS。
- 不代表线上报告输出。
- 不生成完整长报告。
- 不开放亲子正式合看、亲密关系合看、团队/班级/企业画像。

`userVisibleOutput` 当前由规则模板生成，只用于验证未来页面可渲染数据结构和安全边界。

## 6. 如何运行测试

在仓库根目录运行：

```bash
node --check lib/report-upload-p0-dryrun.js
node --check scripts/test-report-upload-p0.js
node scripts/test-report-upload-p0.js
```

期望输出：

```json
{
  "total": 12,
  "passed": 12,
  "failed": 0,
  "failedCases": []
}
```

## 7. 通过标准

P0.9 通过条件：

- 每个响应都有 `userVisibleOutput`。
- `userVisibleOutput.dryRunOnly=true`。
- 12 个样本 outputType 与预期一致。
- R2/R3 不出现 quick reading 用户可见类型。
- `userVisibleOutput` 不包含完整 `reportText`。
- `userVisibleOutput` 不包含 Prompt Pack 全文。
- `userVisibleOutput` 不包含禁用表达。
- 未成年人、企业、学校、关系、升学和隐私样本专项检查通过。

