# AIPIWEN Report Upload P0 实施方案审阅意见

版本：V0.1  
审阅对象：`AIPIWEN_ReportUpload_P0_实施方案.md`  
审阅结论：建议保留，但定位为后续代码实施参考，不直接作为 V1.0 规则冻结包正文。  
处理建议分类：B. 应保留，但作为后续代码实施参考，不进入 V1.0。

## 1. 文件定位

该文件是一份面向上传报告 P0 的代码实施方案草案，不是 Report OS 新资料吸收文件，也不是 V1.0 规则冻结包。

它的核心价值在于把 Report OS V0.9 的 P0 边界，进一步映射到当前产品的页面、API、storage、测试、回滚和不 deploy 验收规则。

因此该文件适合作为后续代码改造前的工程参考材料，不适合直接作为 V1.0 规则冻结包全文。V1.0 规则冻结包应更偏运行规则、流程边界、Schema/Prompt/Test 对接原则，而不是具体讨论 `report-upload.html`、`/api/report-upload-p0`、`report-store` 双实现和 localStorage/sessionStorage。

## 2. 内容摘要

该文件共 649 行，主要内容包括：

- 当前 `report-upload.html` 上传报告流程现状。
- P0 改造目标和不做范围。
- 页面层改造范围。
- API 层改造范围。
- P0 上下文结构和输出结构建议。
- R0-R3 风险等级接入方式。
- high / medium / low / insufficient 置信度接入方式。
- 追问、快速读懂、降级输出、转人工建议。
- `report-store` 双实现歧义处理建议。
- localStorage / sessionStorage 使用建议。
- 是否新增 `/api/report-upload-p0`。
- 现有 API 最小改造建议。
- 前端改造区域和不改区域。
- 测试用例清单、回滚方案、不 deploy 前验收标准、建议执行顺序。

整体判断：内容围绕上传报告 P0，边界意识较强，没有明显试图开放完整报告、关系合看、团队、班级、企业或长期陪伴。

## 3. 与 V0.9 的关系

与 `AIPIWEN_ReportOS_V0.9_总体验收与产品改造准备清单.md` 的关系是互补为主、局部重复。

重复部分：

- P0 只做上传解析、身份/目的识别、风险等级、置信度、快速读懂、追问、降级、转人工。
- 不开放个人完整长报告、关系合看、团队、班级、企业、长期陪伴。
- R2/R3 不进入普通报告生成。
- 低置信度不输出完整结论。
- 需要先用正向、反向、R0-R3 和安全样本测试。

互补部分：

- 明确当前 `report-upload.html` 的现状和不足。
- 指出 `/api/generate-report` 直接生成报告，不符合 P0 的“先解析、再风险、再置信度、再决定输出”。
- 指出 `api/report-store.js` 与 `api/generate-report.js` 内置 `handleReportStore` 存在双实现歧义。
- 提出新增 `/api/report-upload-p0` 而不是直接重写 `/api/generate-report`。
- 明确 storage、回滚和不 deploy 前验收标准。

冲突判断：

- 未发现与 V0.9 “最小 P0”边界的实质冲突。
- 但该文件比 V0.9 更接近代码实施方案，包含页面/API/storage 细节，不应直接混入 V1.0 规则冻结正文。

## 4. 与 Schema / Prompt / Test Case 的关系

### 4.1 Schema

用户指定的路径 `docs/aipiwen_report_system/08_schema_结构化输出/AIPIWEN_上传报告Schema_V0.1.md` 当前不存在。

实际存在的是：

- `docs/aipiwen_report_system/08_schema_结构化规则/AIPIWEN_上传报告输入字段Schema_V0.1.md`
- `docs/aipiwen_report_system/08_schema_结构化规则/AIPIWEN_上传报告输出总流程Schema_V0.1.md`
- `docs/aipiwen_report_system/08_schema_结构化规则/AIPIWEN_风险等级与安全拦截Schema_V0.1.md`
- `docs/aipiwen_report_system/08_schema_结构化规则/AIPIWEN_置信度与降级输出Schema_V0.1.md`

该实施方案与实际 Schema 基本一致：

- `report_upload_p0_context` 与输入字段 Schema 的字段方向一致。
- R0-R3 风险分级与风险等级 Schema 一致。
- high / medium / low / insufficient 与置信度 Schema 一致。
- 追问、降级、转人工与总流程 Schema 一致。

需要注意：

- 实施方案里的 JSON 示例可作为工程草稿，但不应替代后续正式 JSON Schema。
- V1.0 冻结包可以吸收其中的字段方向，但不需要直接复制完整 JSON 示例。

### 4.2 Prompt

该实施方案与 `AIPIWEN_Prompt调用总流程_V0.1.md` 一致：

- 必须先解析。
- 再判断是否追问。
- 再判断风险。
- 再判断置信度。
- 再选择 Prompt。
- 再安全改写。
- 必要时转人工。

可吸收进 V1.0 的内容：

- Prompt 不应是一个大 Prompt。
- 应拆成解析、风险、置信度、输出路径、快速读懂、降级/追问/转人工。

不建议进入 V1.0 正文的内容：

- 具体 API 调用方式。
- 是否新增 `/api/report-upload-p0` 的工程决策。

### 4.3 Test Case

该实施方案与 `AIPIWEN_报告生成质量验收标准_V0.1.md` 一致：

- 总分 >= 85。
- R3 样本必须阻断普通报告生成。
- 医学/心理、未成年人、转人工等项目不能为 0。
- 企业/学校样本不得输出筛选、淘汰、排名。

可保留价值：

- 实施方案把测试样本映射到当前 P0 改造前后的测试步骤。
- 明确旧上传路径回归测试、P0 正向样本、高风险反向样本、R0-R3 矩阵和不 deploy 验收。

## 5. 可保留内容

建议保留以下内容，作为后续 V1.0 规则冻结包素材或代码实施参考：

- P0 改造目标。
- P0 不做清单。
- 先解析、再风险、再置信度、再输出路径选择。
- R0-R3 风险等级。
- high / medium / low / insufficient 置信度。
- 追问最多 1-3 个关键问题。
- 快速读懂报告只用低风险结构。
- R2 降级、R3 阻断或转人工。
- 不输出完整人格定型、医学心理判断、职业升学保证、关系结论。
- 不把未成年人行为贴标签。
- 测试清单和不 deploy 前验收标准。
- 回滚前必须查看 `git status`，避免误伤用户未提交改动。

## 6. 需删除或降级内容

该文件没有必须立即删除的高风险内容，但以下内容不适合进入 V1.0 规则冻结包正文，应降级为代码实施参考：

- 页面层改造范围中对 `report-upload.html` 的具体修改区域。
- API 层改造范围中对 `/api/extract-fp`、`/api/generate-report`、`/api/report-store` 的具体实现建议。
- 新增 `/api/report-upload-p0` 的接口命名建议。
- `report-store` 双实现歧义处理。
- localStorage / sessionStorage 的具体 key 设计。
- Redis key、TTL 等存储建议。
- 回滚命令示例。
- 不 deploy 前的工程验收项。

原因：这些内容属于代码改造实施方案，容易让 V1.0 规则冻结包变成工程任务清单。V1.0 应保持在 Report OS 运行规则层。

## 7. 风险检查

### 7.1 是否越过 P0

整体没有越过 P0。文件明确不做：

- 个人完整长报告。
- 亲密关系正式合看。
- 亲子关系正式合看。
- 合伙人合看。
- 团队画像。
- 班级画像。
- 企业画像。
- 长期陪伴。
- 自动知识卡沉淀。
- 线上部署。

### 7.2 是否试图开放复杂报告类型

没有。文件多次说明这些能力只能后续内部测试，不能混入 P0。

### 7.3 是否有医学 / 心理 / 脑科学强判断

未发现。文件把医学诊断、心理诊断、自伤暴力、疾病判断列为 R3，要求阻断或转专业支持。

### 7.4 是否有命定化、标签化、职业/升学保证

未发现。文件明确禁止职业命定、升学保证、未成年人标签化、关系去留判断。

### 7.5 是否与 V0.9 最小 P0 冲突

未发现实质冲突。该文件是 V0.9 的工程化展开。

主要问题不是冲突，而是粒度偏工程实施，不适合直接作为 V1.0 规则冻结包。

## 8. 是否建议纳入 V1.0

建议部分纳入，不建议全文纳入。

可纳入 V1.0 的部分：

- P0 产品边界。
- 主流程。
- 风险等级。
- 置信度。
- 输出路径。
- 快速读懂结构。
- 追问、降级、转人工规则。
- 测试验收规则。

不建议纳入 V1.0 的部分：

- 页面/API/storage/report-store/回滚命令等工程实施细节。

V1.0 文档应作为“运行规则冻结包”，该实施方案应作为“代码实施参考附件”或后续 P0 开发任务的依据。

## 9. 是否建议单独 commit

不建议现在单独 commit 原实施方案。

建议顺序：

1. 先确认当前未跟踪的 `api/report-upload-p0.js` 是否来自其他任务，避免把 API 草稿混入 docs 审阅。
2. 保留 `AIPIWEN_ReportUpload_P0_实施方案.md` 作为未提交草稿或单独 docs 草稿。
3. 基于该文件抽取规则层内容，生成 V1.0 P0 运行规则冻结包。
4. V1.0 冻结包完成后，再决定是否把实施方案和审阅意见一起作为 docs-only commit。

如果要 commit，建议至少保证 commit 范围只包含：

- `AIPIWEN_ReportUpload_P0_实施方案.md`
- `AIPIWEN_ReportUpload_P0_实施方案_审阅意见.md`
- 后续确认后的 V1.0 规则冻结包

不要混入 API、页面、JS 或 `vercel.json`。

## 10. 后续处理建议

推荐处理方式：保留并合并抽取。

具体建议：

1. 保留该实施方案，不删除。
2. 不把全文纳入 V1.0。
3. 从中抽取 P0 边界、主流程、风险、置信度、输出路径、测试验收，写入 V1.0 规则冻结包。
4. 将页面/API/storage/report-store/回滚相关内容保留为后续代码实施参考。
5. 在进入代码前，先处理当前未跟踪 `api/report-upload-p0.js` 的来源和归属。
6. 代码阶段再决定是否真的新增 `/api/report-upload-p0`，不要在规则冻结阶段提前锁死实现方式。

最终建议：该文件下一步应保留，作为 V1.0 规则冻结包的素材和后续代码实施参考；不建议删除，不建议直接全文合并进 V1.0，不建议在未确认 `api/report-upload-p0.js` 来源前单独 commit。

