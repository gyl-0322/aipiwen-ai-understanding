# AIPIWEN Report Upload P0.7 自动化样本测试矩阵

版本：P0.7
状态：本地自动化 dry-run 测试矩阵
适用范围：`lib/report-upload-p0-dryrun.js`

当前为非部署 dry-run 模块，不是生产 API route；后续进入真实 P0 API 时，再决定是否合并到现有 API 或调整部署方案。

## 1. P0.7 目标

P0.7 的目标是把 P0.1-P0.6 期间的手工样本验证固化为本地自动化测试矩阵。

本测试矩阵用于验证：

- R0 / R1 / R2 / R3 风险分流。
- `high / medium / low / insufficient` 置信度分流。
- 输出路径是否符合 P0 规则。
- `promptPlan` 是否正确阻断或允许 Prompt 链。
- `promptRequestDryRun` 是否保持 dry-run 和请求边界。
- `promptPayloadDryRun` 是否脱敏、阻断高风险生成。
- `humanReviewQueueDryRun` 是否正确触发人工复核 dry-run。
- debug 与隐私边界是否稳定。

该测试矩阵不接真实 AI、不接真实上传、不写数据库、不代表生产验收全部完成。

## 2. 测试脚本路径

```text
scripts/test-report-upload-p0.js
```

脚本使用 Node.js 标准库，不引入新依赖，不启动长期服务，直接模拟 req/res 调用 `lib/report-upload-p0-dryrun.js` 导出的 handler。

## 3. 如何运行

```bash
node --check lib/report-upload-p0-dryrun.js
node --check scripts/test-report-upload-p0.js
node scripts/test-report-upload-p0.js
```

脚本会逐个输出 `PASS` / `FAIL`，最后输出汇总：

- `total`
- `passed`
- `failed`
- `failedCases`

如果存在失败样本，脚本会设置 `process.exitCode = 1`。

## 4. 样本列表与预期结果

| 编号 | 样本 | 主要预期 |
| --- | --- | --- |
| 1 | 正常个人报告摘要 | `riskLevel=R0`；`confidence=medium/high`；`promptPayloadDryRun.canSendToModel=true`；不创建人工复核工单 |
| 2 | 家长理解孩子行为 | `riskLevel=R1`；`promptPlan.mode=safe_quick_reading`；payload 可 dry-run；安全指令包含不要标签化孩子、不要归因父母责任 |
| 3 | 未成年人心理诊断 | `riskLevel=R3`；`canSendToModel=false`；创建人工复核；`ticketType=medical_psychological_review/blocked_case_review` |
| 4 | 亲密关系去留 | `riskLevel=R2/R3`；`canSendToModel=false`；`ticketType=relationship_review` |
| 5 | 企业招聘筛选 | `riskLevel=R3`；`canSendToModel=false`；`ticketType=enterprise_school_review` |
| 6 | 学校分层 | `riskLevel=R3`；`canSendToModel=false`；`ticketType=enterprise_school_review` |
| 7 | 升学保证 | `riskLevel=R2/R3`；`canSendToModel=false`；安全指令包含不要输出升学/职业保证 |
| 8 | 命定化 / 玄学化 | `riskLevel=R2/R3`；`canSendToModel=false` |
| 9 | 信息不足 | `confidence=low/insufficient`；`outputDecision=clarification_only/light_hint_with_questions`；`payloadType=clarification_payload` |
| 10 | debugMode=false | 默认不返回 debug |
| 11 | debugMode=true | 返回 debug 分类信息，但不得包含完整 `reportText` |
| 12 | R2/R3 隐私保护 | 高风险文本不允许模型生成；`reportTextExcerpt=omitted_due_to_risk`；人工复核 dry-run 不包含完整原文 |

## 5. 断言覆盖

脚本至少覆盖以下断言：

1. 不返回 Prompt Pack 全文。
2. 不返回完整 `reportText`。
3. R2 / R3 不允许 `canSendToModel=true`。
4. R2 / R3 不生成 `quick_reading_payload`。
5. R3 必须 `shouldCreateTicket=true`。
6. 企业 / 学校筛选必须进入 `enterprise_school_review`。
7. 医学心理诊断必须进入 `medical_psychological_review` 或 `blocked_case_review`。
8. debug 默认不返回。
9. `debugMode=true` 也不得返回完整 `reportText`。
10. `humanReviewQueueDryRun.dryRunOnly=true`。
11. `promptPayloadDryRun.dryRunOnly=true`。
12. `promptRequestDryRun.dryRunOnly=true`。

## 6. 覆盖的安全边界

本矩阵覆盖以下安全边界：

- 未成年人默认提高风险。
- 医学 / 心理 / 诊断类请求阻断生成。
- 关系去留不进入自动判断。
- 企业招聘筛选不进入自动建议。
- 学校分层、淘汰、定岗不进入自动建议。
- 升学 / 职业保证不进入生成路径。
- 命定化 / 玄学化不进入生成路径。
- 信息不足进入追问或澄清。
- R2 / R3 payload 不包含原文节选。
- debug 输出不包含完整原文。

## 7. 当前限制

当前测试矩阵仍有以下限制：

- 不接真实 AI。
- 不接真实上传。
- 不写数据库。
- 不接 Obsidian。
- 不测试真实浏览器页面。
- 不测试真实文件类型、文件大小、OCR/PDF 解析。
- 不测试真实鉴权、CORS、限流和日志系统。
- 不代表生产验收全部完成。

后续进入真实上传或真实 AI dry-run 前，应继续扩展样本矩阵，加入更多正向样本、高风险负向样本、授权缺失样本、文件异常样本和 Prompt 失败降级样本。
