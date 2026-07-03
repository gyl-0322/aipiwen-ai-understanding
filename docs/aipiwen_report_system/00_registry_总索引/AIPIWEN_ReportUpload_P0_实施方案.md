# AIPIWEN Report Upload P0 实施方案

版本：V0.1  
状态：实施方案，不是代码改造  
适用分支：`feature/report-upload-p0-with-reportos`  
约束：P0 只做上传报告后的快速读懂、安全判断、必要追问、降级和转人工提示；不做完整长报告、关系合看、团队画像、支付、CRM 或部署。

## 1. 当前上传报告功能现状摘要

当前 `report-upload.html` 已经具备一个可运行的上传报告流程，但它的定位更接近“上传皮纹总表页并生成专属解读”，还不是 Report OS 定义的“上传已有报告 P0 入口”。

当前能力：

- 页面已有真实图片上传控件，支持相册上传和相机拍摄，`accept="image/*"`。
- 前端用 `FileReader + canvas` 将图片压缩为 base64 JPEG。
- 前端调用 `/api/extract-fp`，后端从图片中识别十指 TRC、ATD、姓名、生日，并返回整数年龄。
- 用户确认数据后选择自动推荐模块和关注问题。
- 前端调用 `/api/generate-report`，后端调用模型生成 `sections`。
- 页面内部以翻页方式展示报告，并可通过 `/api/report-store` 保存和读取分享报告。
- 深聊入口会把当前报告摘要写入 `sessionStorage.aipiwen_report_deepchat`，再跳转到对话页。

当前不足：

- 只支持图片，不支持文本粘贴、PDF 或多页 OCR。
- 识别目标主要是皮纹总表页，不是任意“已有报告”。
- 没有 Report OS 的资料完整度判断、风险等级 R0-R3、置信度、追问、降级输出和转人工决策。
- `/api/generate-report` 当前直接进入报告生成，缺少“先解析、再判风险、再判置信度、再决定是否生成”的总控流程。
- 当前输出是较完整的专属报告，不符合 P0 “快速读懂”优先的低风险策略。
- `api/report-store.js` 与 `api/generate-report.js` 内置的 report-store handler 存在双实现歧义。

## 2. P0 改造目标

P0 的目标不是把上传报告做成完整报告系统，而是让用户上传或粘贴已有资料后，系统先判断“能不能安全、准确地给一个快速读懂结果”。

P0 必须完成：

1. 保留现有上传皮纹总表页能力。
2. 可选增加文本粘贴入口，用于用户直接粘贴已有报告内容或摘要。
3. 增加用户身份选择，例如家长、本人、从业者、老师、其他。
4. 增加用户目的或关注问题选择，例如快速读懂、孩子学习、沟通建议、自我理解、职业学习。
5. 判断资料完整度：`complete / partial / unreadable / unknown`。
6. 判断风险等级：`R0 / R1 / R2 / R3`。
7. 判断置信度：`high / medium / low / insufficient`。
8. 对 R0/R1 且 high/medium 的输入，输出快速读懂报告。
9. 对信息不足的输入，先追问 1-3 个关键问题。
10. 对 R2 输入，输出安全降级版。
11. 对 R3 输入，不生成普通报告，提示人工专家或专业支持。

P0 的产品结果应是：

- 用户能快速知道“这份报告先看什么”。
- 系统不在信息不足或风险较高时强行输出结论。
- 后续可平滑接入 Report OS 的完整结构，但当前不开放完整复杂报告。

## 3. P0 不做什么

P0 不做以下内容：

- 不做个人完整长报告。
- 不做亲密关系正式合看。
- 不做亲子关系正式合看。
- 不做合伙人合看。
- 不做团队画像。
- 不做班级画像。
- 不做企业画像。
- 不做长期陪伴。
- 不做支付。
- 不做用户系统。
- 不做 CRM。
- 不做真实 PDF 多页解析。
- 不做真实多页 OCR 管线。
- 不做自动知识卡沉淀。
- 不做线上部署。

这些能力可以在 Report OS 后续阶段内部测试，但不能混入上传报告 P0。

## 4. 页面层改造范围

建议只改 `report-upload.html` 的局部流程，不改首页、不改其他报告页、不改皮纹速测页。

建议改造区域：

1. 上传入口区
   - 保留图片上传。
   - 新增“粘贴已有报告文字”的可选入口。
   - 明确提示：图片入口适合皮纹总表页，文字入口适合已整理出的报告内容。

2. 数据确认区
   - 保留现有识别结果确认。
   - 对 P0 只突出必要信息：姓名、整数年龄、ATD、十指 TRC。
   - 详细 TRC 可继续保留，但避免让用户误以为必须手工理解所有技术字段。

3. 用户身份与目的区
   - 增加用户身份选择。
   - 增加用户目的或关注问题选择。
   - 关注问题最多建议选择 3 个，降低模型输入复杂度和前端出错概率。

4. 资料判断区
   - 显示资料完整度、风险等级、置信度。
   - 用业务语言展示，不直接把 schema 字段裸露给用户。

5. 追问区
   - 当用户目的、年龄、对象、授权或资料完整度不足时，先显示 1-3 个追问。
   - 用户不回答时，只允许进入低置信度或降级输出。

6. 快速读懂输出区
   - 复用现有翻页展示能力，但内容结构改为短报告。
   - 不输出完整长报告。

不建议改造区域：

- 不改 `homepage.html`。
- 不改 `fingerprint-v2-wizard.html`。
- 不改 `light-report.html` / `full-report.html`。
- 不改支付、企微、深聊承接逻辑。
- 不把关系合看、团队画像入口放进上传报告 P0。

## 5. API 层改造范围

当前 API 的职责边界：

- `/api/extract-fp`：适合继续负责图片总表页结构化识别。
- `/api/generate-report`：当前负责生成完整 sections，也合并了承担 `/api/report-store` 的存取逻辑。
- `/api/report-store`：源码文件存在，但生产路由被 `vercel.json` 指到 `/api/generate-report`。

P0 建议：

1. 保留 `/api/extract-fp`
   - 只负责图片中的 TRC、ATD、姓名、生日、年龄等结构化提取。
   - 不让它承担风险判断、追问和报告生成。

2. 新增一个 P0 总控 API
   - 建议名称：`/api/report-upload-p0`
   - 职责：接收前端整理后的资料、用户身份、用户目的、用户问题，输出完整度、风险等级、置信度、下一步动作。
   - 该 API 可以在内部调用 Report OS prompt 逻辑，或先做规则版本地 mock。

3. 暂不重写 `/api/generate-report`
   - 保持旧流程可回退。
   - 如果需要复用模型调用，可在后续代码改造中新增 `mode: "quick_read_p0"`，但这不是首选，因为会让现有完整报告逻辑变复杂。

4. 暂不改 `vercel.json`
   - 代码 P0 阶段如果新增 API，再单独评估是否需要路由配置。
   - 本实施方案阶段不允许改路由。

## 6. 数据结构设计

P0 建议引入一个最小结构对象：`report_upload_p0_context`。

示例结构：

```json
{
  "upload_id": "upload_...",
  "user_id": "anonymous",
  "upload_time": "ISO_DATETIME",
  "source_type": "image",
  "report_subject_type": "adult",
  "subject_count": 1,
  "subject_age": 36,
  "subject_gender": "undisclosed",
  "relationship_context": "self",
  "user_role": "adult_self",
  "user_goal": "quick_read",
  "user_question": "我想快速看懂这份报告",
  "report_completeness": "partial",
  "detected_metrics": ["TRC", "ATD"],
  "missing_metrics": ["personality_type", "learning_channel", "behavior_mode"],
  "sensitive_context": ["none"],
  "consent_status": "not_required",
  "minor_status": "no",
  "privacy_level": "medium",
  "desired_depth": "quick",
  "risk_flags": [],
  "risk_level": "R0",
  "confidence_level": "medium",
  "recommended_next_step": ["generate_report"],
  "selected_report_type": "quick_read_report"
}
```

P0 输出结构建议：

```json
{
  "ok": true,
  "upload_id": "upload_...",
  "decision": {
    "risk_level": "R0",
    "confidence_level": "medium",
    "recommended_next_step": "generate_report",
    "selected_report_type": "quick_read_report"
  },
  "followup_questions": [],
  "quick_report": {
    "sections": [
      {"title": "这份报告先怎么看", "content": "..."},
      {"title": "最值得关注的 3 个点", "content": "..."},
      {"title": "容易被误解的 2 个点", "content": "..."},
      {"title": "适合怎么用", "content": "..."},
      {"title": "不适合怎么用", "content": "..."},
      {"title": "下一步建议", "content": "..."}
    ]
  }
}
```

存储建议：

- 短期流程状态：`sessionStorage.aipiwen_report_p0_context`
- 分享报告：继续使用 `report:{id}`。
- 不建议把原始图片 base64 或完整原文长期写入 `localStorage`。
- 如后端存储 P0 记录，可使用 Redis key：`report_upload:{upload_id}`，TTL 建议 30-90 天，后续再按隐私策略决定。

## 7. 风险等级 R0-R3 接入方式

P0 必须在生成报告前执行风险判断。

风险等级接入规则：

- R0：普通低风险，可生成快速读懂报告。
- R1：轻度敏感，必须安全改写后输出快速读懂报告。
- R2：高敏感，不能生成普通报告，只输出安全降级版和补充建议。
- R3：禁止 AI 直接输出结论，转人工或建议专业支持。

P0 的判断入口：

1. 用户问题文本。
2. 粘贴报告文本。
3. 识别出的报告对象年龄和身份。
4. 用户角色和使用目的。
5. 是否涉及多人、未成年人、学校、团队、亲密关系、职业重大选择等敏感场景。

必须拦截的高风险方向：

- 医学诊断、心理诊断、自伤暴力。
- 升学成绩承诺。
- 职业命定、重大职业或财务决策。
- 关系去留判断。
- 未成年人标签化。
- 学校或企业个体筛查、淘汰、排名。
- 玄学化、命定化表达。

## 8. 置信度接入方式

P0 必须用置信度控制输出强度。

置信度规则：

- `high`：资料完整、核心指标齐全、用户目的明确、风险不超过 R1，可输出结构化快速读懂和行动建议。
- `medium`：资料基本可读但缺少部分指标，或用户场景不够完整，可输出倾向性解释和补充建议。
- `low`：资料缺失较多、只有片段或问题模糊，只输出观察方向和追问。
- `insufficient`：资料不可读、授权缺失、风险过高或信息矛盾，不输出实质性结论。

当前上传图片总表页如果只识别出 TRC/ATD/姓名/年龄，可视为：

- 对“皮纹总表快速读懂”：可能为 medium。
- 对“完整个人报告”：不足，不应直接生成 full report。
- 对“关系合看、团队画像、职业重大决策”：low 或 insufficient。

## 9. 追问流程接入方式

追问不是问得越多越好。P0 每轮最多问 1-3 个关键问题。

触发追问条件：

- 用户没有选择身份。
- 用户没有说明目的。
- 报告对象不清楚。
- 涉及孩子但年龄不清楚。
- 涉及他人或多人但授权不清楚。
- 资料完整度为 partial / unknown。
- 用户问题过大，例如“你帮我看看”。
- 用户要求的输出深度超过当前资料支持范围。

追问示例：

- “这份报告是你自己、孩子，还是客户的？”
- “你这次更想快速看懂报告，还是解决一个具体问题？”
- “如果是孩子，大概几岁？你最想看学习、情绪，还是亲子沟通？”

用户不补充时：

- 不阻断体验。
- 但只能进入 medium/low 的快速读懂或安全降级输出。

## 10. 快速读懂报告生成方式

P0 快速读懂报告只使用 `quick_read_report`。

推荐章节：

1. 这份报告先怎么看。
2. 最值得关注的 3 个点。
3. 容易被误解的 2 个点。
4. 适合怎么用。
5. 不适合怎么用。
6. 下一步建议。

生成条件：

- 风险等级为 R0 或 R1。
- 置信度为 high 或 medium。
- 用户目的为 quick_read / understand_self / understand_child / learning_method 等低风险方向。
- 至少识别到一组可解释指标，例如 TRC、ATD、学习通道、行为模式中的一部分。

输出边界：

- 不输出完整人格定型。
- 不输出医学、心理、升学、职业、关系结论。
- 不使用“必然、注定、一定会”等绝对化表达。
- 对孩子只说行为理解和支持方式，不贴标签。

## 11. 降级输出方式

降级输出用于 R2、low、insufficient 或资料不足场景。

降级输出结构：

1. 当前资料还不足以直接判断。
2. 目前可以先观察的方向。
3. 还需要补充哪些资料。
4. 可以先尝试的低风险动作。
5. 是否建议人工专家解读。

降级输出禁止：

- 不生成完整报告。
- 不给关系成败、职业方向、升学结果、疾病心理结论。
- 不用低置信度资料包装成确定判断。

适用场景：

- 只有模糊截图。
- 只有报告片段。
- 用户问题非常敏感。
- 用户要求超过当前资料支持范围。
- 涉及未成年人、关系冲突、学校或团队数据但授权不足。

## 12. 转人工建议方式

转人工不是失败，而是为了保护用户和产品边界。

必须转人工或建议专业支持的场景：

- R3 风险。
- 用户要求医学、心理、疾病、ADHD、自伤、暴力解释。
- 未成年人长期严重情绪、睡眠、学习或安全困扰。
- 亲密关系重大冲突、暴力、法律或财务问题。
- 职业重大转型、投资、离职等现实高影响决策。
- 企业或学校要求个体筛查、淘汰、排名。
- 用户要求深度专家解读或完整交付。

建议话术方向：

- 先承接问题。
- 说明这个场景更适合人工复核或专业支持。
- AI 可以先整理资料摘要和关键问题。
- 不制造焦虑，不销售压迫。

## 13. report-store 当前双实现歧义怎么处理

当前存在两个 report-store 实现：

1. `api/report-store.js`
   - 独立文件。
   - 注释显示 TTL 为 30 天。

2. `api/generate-report.js` 内部的 `handleReportStore`
   - 已合并 report-store 功能。
   - 注释显示 `/api/report-store` 由此处理。
   - 存储 TTL 为 365 天。

同时，`vercel.json` 中 `/api/report-store` 路由指向 `/api/generate-report`，因此运行时更可能以 `api/generate-report.js` 中的 `handleReportStore` 为准。

P0 处理建议：

- 本轮实施方案不改 `vercel.json`。
- P0 代码改造初期不要同时改两个 store。
- 短期以当前线上路由为准：`/api/report-store` 继续由 `api/generate-report.js` 承接。
- 在 P0 后续单独开一个“report-store 路由清理”任务，明确只保留一个实现。
- 清理前不要让新 P0 数据依赖两个不同 TTL 或两个不同响应格式。

## 14. localStorage / sessionStorage 需要保留或调整什么

建议保留：

- `localStorage.aipiwen_ref`
- `localStorage.aipiwen_invite_token`
- `localStorage.aipiwen_vip`
- `sessionStorage.aipiwen_report_deepchat`

建议新增：

- `sessionStorage.aipiwen_report_p0_context`
  - 存当前上传流程的短期上下文。
  - 只保存结构化摘要、用户选择、风险、置信度、追问状态。

不建议：

- 不把图片 base64 长期存入 `localStorage`。
- 不把完整报告原文长期存入 `localStorage`。
- 不把敏感问题、未成年人资料、他人资料长期保存在前端。

刷新行为建议：

- 用户未生成报告前，刷新可丢失原始图片，但应尽量保留身份、目的、关注问题等低敏选择。
- 已生成报告后，继续通过 `/api/report-store?id=...` 读取分享报告。

## 15. 是否新增 API，建议新增哪些

建议新增一个最小 P0 API：

### `/api/report-upload-p0`

职责：

- 接收图片识别结果或粘贴文本。
- 接收用户身份、用户目的、用户问题。
- 生成 P0 上下文。
- 判断资料完整度、风险等级、置信度。
- 返回下一步动作：快速读懂、追问、补资料、降级、转人工。
- 在可生成时返回 quick_read sections。

请求示例：

```json
{
  "sourceType": "image",
  "extracted": {
    "fingers": {},
    "atd": 34,
    "name": "某用户",
    "age": 36
  },
  "rawText": "",
  "userRole": "adult_self",
  "userGoal": "quick_read",
  "userQuestion": "我想快速看懂这份报告"
}
```

返回示例：

```json
{
  "ok": true,
  "decision": {
    "riskLevel": "R0",
    "confidenceLevel": "medium",
    "nextStep": "generate_report"
  },
  "followupQuestions": [],
  "sections": []
}
```

是否必须后端：

- 如果要调用模型、做统一风险判断、避免前端暴露规则细节，必须后端。
- 如果只是本地演示，可以先用前端 mock，但不建议作为正式 P0。

是否需要环境变量：

- 如果沿用现有模型调用配置，不新增环境变量。
- 如果接入新的模型供应商或独立安全服务，需要另行评估，不属于 P0。

## 16. 是否改现有 API，怎么最小改

建议最小改动：

1. `/api/extract-fp`
   - 不改核心识别逻辑。
   - 保持返回 `fingers / atd / name / age / birthday / raw`。
   - 只在后续必要时统一年龄显示逻辑，不扩展为报告生成。

2. `/api/generate-report`
   - P0 初期不建议直接重写。
   - 如必须复用，可新增 `mode: "quick_read_p0"` 分支，避免影响旧完整报告生成。
   - 但首选方案是新增 `/api/report-upload-p0`，让旧生成接口可回退。

3. `/api/report-store`
   - 不在 P0 中清理双实现。
   - 只复用现有分享读取能力。
   - 路由清理另开任务。

4. `vercel.json`
   - P0 实施方案阶段不改。
   - 代码阶段若新增 API 文件，先在本地验证 Vercel 默认函数路由是否可用，再决定是否需要配置。

## 17. 前端改哪些区域，不改哪些区域

建议修改 `report-upload.html` 的以下区域：

- 上传入口文案与入口结构。
- 文件处理后进入确认页前的状态说明。
- 确认页的展示重点。
- 用户身份选择。
- 用户目的和关注问题选择。
- 关注问题数量限制。
- 资料完整度、风险等级、置信度展示。
- 追问页或追问模块。
- 输出页报告结构。
- 错误提示和降级提示。

不建议修改：

- 首页入口。
- 皮纹速测页。
- 行为理解页。
- `light-report.html`。
- `full-report.html`。
- 深聊页面主逻辑。
- 邀请、VIP、推广、支付相关逻辑。
- CSS 大重构或视觉重做。

前端文案原则：

- 使用“快速读懂”“资料完整度”“当前只适合做倾向性参考”等用户能理解的表达。
- 不把 `risk_level`、`confidence_level` 等技术字段直接裸露给 C 端用户。
- 所有高敏场景用温和语气，不制造恐慌。

## 18. 测试用例清单

P0 代码改造前后至少测试以下内容。

### 18.1 当前能力回归

1. 上传清晰皮纹总表页，能识别十指 TRC、ATD、姓名、年龄。
2. 上传非图片文件，前端拒绝并提示。
3. 上传模糊图片，`/api/extract-fp` 失败时能友好提示。
4. 确认数据后能继续进入下一步。
5. 旧分享报告 `?rid=` 仍能读取。

### 18.2 P0 正向样本

优先覆盖：

- POS_001：成人完整报告，快速读懂。
- POS_003：家长问孩子学习方式。
- POS_004：家长问孩子写作业拖拉。
- POS_008：青少年本人自我理解。
- POS_018：从业者给客户温和版解释。
- POS_019：资料不完整，只输出降级方向。
- POS_020：用户问题模糊，先追问目的。

### 18.3 高风险反向样本

必须覆盖：

- NEG_001：抑郁判断。
- NEG_002：ADHD 判断。
- NEG_004：成绩预测。
- NEG_006：孩子没救了。
- NEG_008：适不适合结婚。
- NEG_011：淘汰团队成员。
- NEG_012：标记风险学生。
- NEG_016：自伤危机。
- NEG_018：未成年人未授权。
- NEG_019：未获同意分析他人。
- NEG_025：资料严重不足但要求结论。

### 18.4 R0-R3 矩阵

- R0 能生成快速读懂。
- R1 必须安全改写。
- R2 必须降级或建议人工复核。
- R3 必须阻断普通报告生成。

### 18.5 质量验收

- 总体质量分 >= 85。
- 风险识别、医学/心理边界、未成年人安全、转人工判断不得为 0。
- R3 样本不得进入普通报告生成。

## 19. 回滚方案

P0 代码改造必须可快速回滚。

建议：

1. 单独开发分支。
2. P0 改动拆成小 commit。
3. 不改 `vercel.json`，除非独立确认。
4. 新增 API 与旧 API 并行，不替换旧 API。
5. 前端保留旧上传和旧生成路径的可回退能力。
6. 如新增入口有风险，可用前端开关隐藏 P0 新流程。
7. 回滚时优先恢复 `report-upload.html` 和新增 API，不影响 `extract-fp`。

最小回滚命令思路：

- 本地阶段：`git restore report-upload.html lib/report-upload-p0-dryrun.js`
  - `lib/report-upload-p0-dryrun.js` 当前为非部署 dry-run 模块，不是生产 API route；后续进入真实 P0 API 时，再决定是否合并到现有 API 或调整部署方案。
- 已 commit 阶段：`git revert <P0_COMMIT_HASH>`

注意：实际回滚前必须先查看 `git status`，避免误伤用户未提交改动。

## 20. 不 deploy 前的验收标准

未满足以下条件前，不允许 deploy：

1. `git status --short` 清楚可解释。
2. 只改 P0 范围内文件。
3. `report-upload.html` 旧图片上传路径通过。
4. `/api/extract-fp` 旧识别路径通过。
5. 新 P0 流程能识别资料完整度、风险、置信度。
6. 信息不足时先追问，不强行生成。
7. R0/R1 + high/medium 能输出快速读懂报告。
8. R2 输出安全降级。
9. R3 阻断普通报告并转人工或专业支持。
10. 正向样本核心用例通过。
11. 反向样本 R3 拦截通过率 100%。
12. 未成年人、学校、团队、关系场景不出现标签化、淘汰、诊断、预测或决定论。
13. `report-store` 双实现风险已记录，未在 P0 中误改路由。
14. 未新增支付、CRM、用户系统、PDF/OCR 多页解析。
15. 未修改生产环境变量。
16. 未 push。
17. 未 deploy。

## 21. 建议执行顺序

后续如果进入代码阶段，建议顺序如下：

1. 建立 P0 流程测试清单。
2. 新增 `/api/report-upload-p0` 的本地 mock 版。
3. 前端接入身份、目的、关注问题和追问状态。
4. 接入完整度、风险等级、置信度显示。
5. 接入快速读懂输出。
6. 接入 R2/R3 降级和转人工提示。
7. 用 Report OS 正向、反向、R0-R3 样本做本地验收。
8. 再决定是否接真实模型调用。
9. 最后再评估是否 deploy。

## 22. 本文档边界

本文档只定义 P0 实施方案，不代表已经完成代码改造。

本轮不修改：

- `report-upload.html`
- `api/`
- `homepage.html`
- `vercel.json`
- 任何前台页面

本轮不执行：

- push
- deploy
- commit
