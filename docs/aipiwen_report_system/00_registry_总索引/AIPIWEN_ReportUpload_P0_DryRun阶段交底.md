# AIPIWEN Report Upload P0 Dry-run 阶段交底

版本：V0.1
状态：阶段交底
适用范围：Report Upload P0 dry-run 链路
当前分支：`feature/report-upload-p0-with-reportos`

## 1. 当前阶段一句话结论

Report Upload P0 已完成规则冻结、mock API、文本解析、Prompt 编排、Prompt Request、Prompt Payload、人工复核队列 dry-run；但它仍然不是生产上传报告服务。

当前成果的价值是：在不接真实 AI、不接真实文件上传、不写数据库、不接 Obsidian 的前提下，把上传报告 P0 的安全分流链路跑通，验证从输入到风险、置信度、输出路径、Prompt 调用计划、脱敏 payload 和人工复核记录的最小闭环。

## 2. commit 基线

| commit | 作用 |
| --- | --- |
| `8528ca8 docs: build AIPIWEN Report OS foundation` | 建立 Report OS V0.1-V0.9 报告底座 |
| `badc11e docs: freeze Report OS V1.0 P0 upload rules` | 冻结上传报告 P0 运行规则 |
| `cdf9b54 feat: add Report Upload P0 rules mock API` | 新增 JSON-only mock/rules API |
| `67f7ca6 fix: align Report Upload P0 mock with sample checks` | 修正样本验证中的年龄、短文本、枚举和场景识别问题 |
| `5f286ad docs: add Report Upload P0 engineering handoff` | 增加 P0 工程对接设计说明 |
| `f6ac1a0 feat: add Report Upload P0.2 text parse dry-run` | 增加文本解析 dry-run 和 `parseResult` |
| `02dd92b feat: add Report Upload P0.3 prompt dry-run` | 增加 Prompt 编排计划 `promptPlan` |
| `21d9dea feat: add Report Upload P0.4 prompt request dry-run` | 增加模型请求包结构 dry-run `promptRequestDryRun` |
| `f63ac86 feat: add Report Upload P0.5 prompt payload dry-run` | 增加脱敏 Prompt Payload dry-run `promptPayloadDryRun` |
| `12f1064 feat: add Report Upload P0.6 human review dry-run` | 增加人工复核队列记录 dry-run `humanReviewQueueDryRun` |
| `6002dfb docs: archive AIPIWEN product handoff` | 归档 AIPIWEN.cn 产品交底文档 |

## 3. 当前 API 定位

`lib/report-upload-p0-dryrun.js` 当前是：

- JSON-only。
- rules / mock / dry-run。
- 非部署 dry-run 模块，不是生产 API route。
- 不接真实 AI。
- 不接 OpenAI / Claude / Gemini 或任何模型 API。
- 不接真实上传。
- 不处理 multipart 文件。
- 不写数据库。
- 不接 Obsidian。
- 不代表生产服务。

它的作用是验证 Report OS V1.0 P0 的最小运行规则，不是最终上传报告接口。后续进入真实 P0 API 时，再决定是否合并到现有 API 或调整部署方案；生产化必须重新补齐鉴权、CORS、限流、真实解析、日志脱敏、人工复核后台和完整测试矩阵。

## 4. 当前 dry-run 链路

当前链路如下：

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
```

各层职责：

| 阶段 | 输出 | 职责 |
| --- | --- | --- |
| 文本输入 | `reportText` | 当前仅接受 JSON 文本，不接真实上传 |
| 文本解析 | `parseResult` | 判断可读性、主体线索、意图线索、敏感线索和文本质量 |
| 风险判断 | `riskLevel` | 输出 R0 / R1 / R2 / R3 |
| 置信度判断 | `confidence` | 输出 high / medium / low / insufficient |
| 输出决策 | `outputDecision` | 决定快速读懂、追问、降级、阻断或转人工 |
| Prompt 编排 | `promptPlan` | 判断允许调用哪些 Prompt 类型，禁用哪些 Prompt 类型 |
| 请求包 dry-run | `promptRequestDryRun` | 生成未来模型请求结构，不包含 Prompt 全文和原文全文 |
| Payload dry-run | `promptPayloadDryRun` | 生成脱敏版结构化 payload 草稿 |
| 人工复核 dry-run | `humanReviewQueueDryRun` | 生成未来人工复核队列记录，不写数据库 |

## 5. 已验证的 10 类样本

当前 dry-run 已覆盖以下样本类型：

1. 正常个人报告摘要：R0，可进入快速读懂 dry-run。
2. 家长理解孩子行为：R1，可进入安全快速读懂 dry-run，并保留未成年人边界。
3. 未成年人心理诊断：R3，进入医学/心理人工复核，不生成报告结论。
4. 亲密关系去留：R2，进入关系复核或降级，不判断关系去留。
5. 企业招聘筛选：R3，进入企业/学校复核，不给招聘筛选建议。
6. 学校分层：R3，进入企业/学校复核，不给学生分层、淘汰、定岗建议。
7. 升学保证：R3，阻断保证类输出，进入高风险复核。
8. 命定化 / 玄学化：R3，阻断命定化判断，进入高风险复核。
9. 信息不足：insufficient，进入追问或澄清路径。
10. debug true / false：debug 默认关闭；开启时不返回 `reportText` 原文全文。

## 6. 当前安全边界

当前仍禁止：

- 完整长报告。
- 亲子正式合看。
- 亲密关系合看。
- 合伙人合看。
- 团队 / 班级 / 企业画像。
- 招聘筛选。
- 学生分层。
- 医学 / 心理诊断。
- 脑科学强结论。
- 催眠 / 疗愈建议。
- 职业 / 升学保证。
- 命定化 / 玄学化判断。
- 孩子标签化。
- 父母责任归因。
- Obsidian 直接生产接入。

R2 / R3 不进入 quick reading 生成路径。涉及医学、心理、关系去留、企业筛选、学校分层、升学保证等场景时，必须降级、阻断或进入人工复核。

## 7. 当前还不能上线的原因

当前 dry-run 链路还不能上线，原因包括：

- 无鉴权。
- CORS 生产未收敛。
- 无速率限制。
- 无真实文件上传。
- 无真实文件解析。
- 无真实 AI 调用。
- 无人工复核后台。
- 无日志脱敏落库。
- 无完整自动化测试矩阵。
- 无灰度开关。
- 无生产级错误处理和告警。
- 无真实用户授权链路。
- 无文件大小、文件类型和内容安全限制。

因此当前阶段只能作为本地 dry-run 和工程对接基础，不能直接接入线上用户入口。

## 8. 下一阶段建议

下一步不建议直接上线。建议路线：

1. P0.7：自动化测试脚本 / 样本矩阵。
   - 固化 10 类样本。
   - 增加 R0-R3 风险矩阵。
   - 增加未成年人、关系、学校、企业、医学心理、debug 安全样本。

2. P0.8：文本输入前端内测入口。
   - 只允许文本输入。
   - 不接真实文件上传。
   - 前台只展示用户可理解的追问、快速读懂、降级、转人工结果。

3. P0.9：鉴权、CORS、限流、日志脱敏。
   - 收敛 CORS。
   - 增加访问控制。
   - 增加请求频率限制。
   - 确认日志不保存原文全文、Prompt 全文、API key 或调试原始信息。

4. P1.0：真实 AI dry-run。
   - 可调用模型，但不保存、不上线。
   - 仅在 R0/R1 + high/medium 且 payload 脱敏后 dry-run。
   - 继续阻断 R2/R3 的生成类路径。

5. 文件上传放到更后面。
   - 先做文本输入可控闭环。
   - 再做图片/PDF/多页文件解析。
   - 不承诺完整 OCR 和完整报告生成。

## 9. push / PR 前检查清单

push / PR 前必须检查：

- `git status --short` 干净，或只包含明确要提交的文件。
- `node --check lib/report-upload-p0-dryrun.js` 通过。
- 样本测试通过。
- 无页面改动。
- 无 deploy。
- 无 API key。
- 无真实用户数据。
- 无 `reportText` 原文全文进入 debug、payload、工单 dry-run 或日志。
- 无 Prompt Pack 全文进入 API 返回。
- 当前分支确认。
- commit 范围与任务一致。

## 10. 给后续开发者的禁止事项

后续开发者必须遵守：

- 不要把 dry-run 当生产服务。
- 不要直接接 AI。
- 不要直接接文件上传。
- 不要开放高风险报告类型。
- 不要开放完整长报告、关系合看、团队/班级/企业画像。
- 不要把 Obsidian 原文接入生产生成。
- 不要跳过人工复核。
- 不要在未完成鉴权、限流、CORS 前上线。
- 不要在日志、debug、payload、工单中保存或返回原文全文。
- 不要输出医学/心理诊断、脑科学强结论、招聘筛选、学生分层、升学/职业保证或关系去留判断。
