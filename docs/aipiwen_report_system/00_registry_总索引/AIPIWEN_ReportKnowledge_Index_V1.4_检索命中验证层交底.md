# AIPIWEN Report Knowledge Index V1.4 检索命中验证层交底

状态：后台检索验证层  
日期：2026-07-07  
范围：只新增 Report Knowledge Index dry-run 检索命中能力，不修改网站结构、不修改报告页面、不修改 PDF、不修改支付、不部署。

## 1. 本轮定位

V1.4 不是继续扩写内容库，也不是把 Obsidian 原文直接接入前台。

它解决的是一个更基础的问题：

> 当用户输入年龄、报告模块、五大功能区数值和四个问题时，系统到底能不能检索到对应的知识卡？

此前 V1.1-V1.3 已经补了知识索引，但如果没有检索命中验证，就仍然无法证明后续报告生成真的用到了这些内容。

V1.4 的目标是先建立一个后台 dry-run：

```text
结构化输入
→ 分阶段检索
→ 返回命中的知识卡 id
→ 标记哪些可自动输出、哪些需要改写、哪些只做风险护栏
```

## 2. 本轮新增能力

代码文件：

`lib/report-knowledge-index.js`

新增函数：

```js
buildReportKnowledgeRetrievalDryRun(input, options)
```

该函数只做检索验证，不生成报告，不调用 AI，不接 Obsidian 原文，不写数据库。

## 3. 检索阶段

V1.4 将检索拆成 5 个阶段。

### 3.1 age_stage

用途：

- 按年龄阶段召回对应问题库。
- 防止幼儿、小学、初中、高中、成人使用同一套问题。
- 防止成年人报告出现“您孩子”等称谓错位。

输入线索：

- ageBand
- lifeStage
- userIdentity
- reportSubject
- subjectAge
- selectedIssues

典型命中：

- `RKI-V1.3-PRESCHOOL-ROUTINE`
- `RKI-V1.3-SCHOOL-HOMEWORK`
- `RKI-V1.3-JUNIOR-BOUNDARY`
- `RKI-V1.3-ADULT-WORK`
- `RKI-V1.3-AGE-TITLE-VOICE`

### 3.2 user_questions

用途：

- 按用户选择的四个问题和自定义问题逐个检索。
- 避免四个问题都套同一组三段式回答。
- 让不同问题能命中不同回答素材。

关键调整：

V1.4 不把四个问题拼成一坨查，而是按问题分开查：

```text
问题 1 → 单独检索
问题 2 → 单独检索
问题 3 → 单独检索
问题 4 → 单独检索
自定义问题 → 单独检索
```

这一步是为了后续让：

- 学习方法问题可以走观察清单。
- 沟通问题可以走场景复盘。
- 升学问题可以走安全改写。
- 关系/诊断/筛选问题可以走风险护栏。

### 3.3 fixed_modules

用途：

- 按固定报告模块召回表达底座。
- 覆盖 TRC、ATD、左右脑、性格类型、学习通道、行为模式。

输入线索：

- reportModules
- personalityType
- learningChannel
- behaviorPattern
- trc
- atd

这一步只验证“模块表达素材能否被召回”，不负责改报告结构。

### 3.4 five_functions

用途：

- 按五大功能区和单指数据召回对应知识卡。
- 防止再出现“两根手指相加后和个人均值比较”的错误逻辑。

关键调整：

V1.4 不把五大功能区混成一个大查询，而是按功能区分开查：

```text
精神功能 → 单独检索右拇 / 左拇 / 左右差异
思维功能 → 单独检索右食 / 左食 / 左右差异
体觉功能 → 单独检索右中 / 左中 / 左右差异
听觉功能 → 单独检索右无名 / 左无名 / 左右差异
视觉功能 → 单独检索右小 / 左小 / 左右差异
```

这一步只是确认知识卡命中，不改变前台五大功能区页面。

### 3.5 risk_guardrails

用途：

- 召回禁用边界、人工复核线索和高风险问题护栏。
- 确保心理诊断、升学保证、关系去留、招聘筛选、学生分层等问题不会进入自动结论。

允许召回：

- `auto_safe`
- `rewrite_required`
- `human_only`
- `blocked`

注意：

`human_only` 和 `blocked` 只用于风险识别与安全边界，不得直接进入用户前台报告正文。

## 4. dry-run 输出结构

`buildReportKnowledgeRetrievalDryRun` 返回：

```text
ok
dryRunOnly
indexVersion
totalEntries
inputSummary
stageResults
uniqueHitIds
summary
```

其中 `stageResults` 会列出每个阶段：

- stage
- purpose
- hasQuery
- queryCount
- queryLabels
- hitCount
- hitIds
- hits

`hits` 中会标记：

- canUseForAutoOutput
- needsRewrite
- isGuardrailOnly

这样后续接入 `generate-report` 时，可以明确区分：

- 可以进入自动输出的素材
- 需要安全改写的素材
- 只能做风险护栏的素材

## 5. 已验证样本

测试文件：

`scripts/test-report-knowledge-index.js`

本轮新增 3 类 dry-run 验证。

### 5.1 初中 13-15 样本

输入：

- 顶嘴 / 叛逆
- 考试焦虑
- 手机边界
- 精神功能右拇高、左拇低
- 听觉功能右无名低

验证命中：

- `RKI-V1.3-JUNIOR-BOUNDARY`
- `RKI-V1.3-JUNIOR-STUDY-EMOTION`
- `RKI-V1.2-SPIRIT-R_HIGH`
- `RKI-V1.2-SPIRIT-L_LOW`
- `RKI-V1.2-AUDIO-R_LOW`

意义：

证明初中阶段问题、五大功能区单指逻辑可以同时命中。

### 5.2 成人 26-40 样本

输入：

- 职业瓶颈
- 创业还是打工
- 伴侣沟通
- 工作很累
- 思维功能右食高
- 视觉功能左小高

验证命中：

- `RKI-V1.3-ADULT-WORK`
- `RKI-V1.3-ADULT-FAMILY`
- `RKI-V1.2-THINK-R_HIGH`
- `RKI-V1.2-VISUAL-L_HIGH`

同时验证：

- 不应依赖初中青春期边界卡。

意义：

证明成人问题不会继续套孩子/家长问题库。

### 5.3 高风险样本

输入：

- 高中升学
- 保证升学成功
- 心理疾病
- 诊断

验证命中：

- `RKI-V1.3-SENIOR-EDUCATION`
- 至少一个 guardrail-only 知识卡

意义：

证明系统既能召回高中升学上下文，也能召回风险护栏，避免把升学保证和心理诊断写成普通建议。

## 6. 当前验证结果

执行：

```bash
node --check lib/report-knowledge-index.js
node --check scripts/test-report-knowledge-index.js
node scripts/test-report-knowledge-index.js
```

结果：

```json
{
  "ok": true,
  "totalEntries": 90,
  "sampleGroundingItems": 6,
  "dryRunStages": 5,
  "dryRunUniqueHits": 19
}
```

## 7. 本轮没有做什么

本轮没有：

- 修改 `report-upload.html`
- 修改 `api/generate-report.js`
- 修改 `api/report-upload-p0.js`
- 修改 PDF 下载
- 修改支付逻辑
- 修改首页
- 接真实 AI
- 接真实 Obsidian 检索
- 生产部署

## 8. 下一步建议

V1.4 之后，建议进入：

### V1.5：generate-report 检索上下文接入 dry-run

目标：

- 在 `generate-report` 生成前调用检索层。
- 把命中的 `auto_safe` / `rewrite_required` 知识卡变成模型可用上下文。
- 不向用户展示知识卡 id、来源路径或内部标签。
- 如果检索失败，继续使用现有 SYSTEM_PROMPT / 硬编码规则 / engineResult / selectedIssues 兜底。

### V1.6：四问回答表达质量回归

目标：

- 不再强制所有问题三段式。
- 按问题类型选择回答形态。
- 学习类可以给观察清单。
- 沟通类可以给场景复盘。
- 升学/关系/诊断/筛选类必须降级或转人工。

## 9. 结论

Report Knowledge Index V1.4 已经建立“检索命中验证层”。

它证明：

1. 年龄阶段可以命中不同知识卡。
2. 用户四问可以逐题检索，而不是混成同一个模板。
3. 五大功能区可以按功能区、按单指数据分别检索。
4. 高风险问题可以召回护栏卡。
5. 当前仍不改变网站结构，不影响线上报告生成。

