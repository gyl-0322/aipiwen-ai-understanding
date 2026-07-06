# AIPIWEN 系统与 Obsidian 知识库现状交底

更新时间：2026-07-06

## 1. 一句话结论

当前 AIPIWEN 正式报告生成链路已经不是“完全没有接入知识库”，但也不是“生产系统直接读取整个 Obsidian 原始库”。

现在采用的是一条更安全、可控、节省 token 的中间链路：

```text
Obsidian / 老师录音 / Report OS / 代码内置语料
→ 人工筛选与结构化整理
→ Report Knowledge Index V1
→ /api/generate-report 检索命中
→ 拼入报告生成 grounding block
→ qwen-plus 生成正式报告
```

如果知识索引读取、检索或拼接失败，系统会回到现有兜底链路：

```text
SYSTEM_PROMPT + 硬编码规则 + engineResult + selectedIssues + 指纹/报告指标
```

也就是说：知识库现在是“增强层”，不是唯一依赖；失败时不应该让用户看到报错。

## 2. 当前已经接入了什么

### 2.1 Report Knowledge Index V1

当前结构化索引文件：

```text
data/report-knowledge-index/report-knowledge-index-v1.json
```

当前索引规模：

```text
总条目：15
auto_safe：9
rewrite_required：3
human_only：2
blocked：1
```

来源类型包括：

```text
teacher_transcript：老师现场解读录音提炼
report_library：Report OS 报告库
obsidian_or_expert_card：Obsidian / 专家课程候选卡
obsidian_system_card：从现有系统规则回写到 Obsidian 的系统知识卡
code：现有正式报告生成代码中的 SYSTEM_PROMPT、硬编码规则、engineResult / selectedIssues 契约
source_mapping：来源映射与归属说明
```

这说明现有代码内置语料没有被浪费，已经开始被纳入统一知识资产体系。

### 2.2 知识检索模块

当前检索与拼接模块：

```text
lib/report-knowledge-index.js
```

它负责：

- 读取 Report Knowledge Index JSON
- 按报告指标、年龄、问题、模块关键词做轻量检索
- 根据安全等级过滤可用内容
- 生成给报告模型使用的 grounding block
- 避免把 Obsidian 原文、老师逐字稿全文或外部课程标签直接暴露给用户

### 2.3 正式报告 API 已调用索引

当前正式报告接口：

```text
api/generate-report.js
```

已引入：

```text
searchReportKnowledge
buildReportGroundingBlock
```

当前逻辑是：

1. 从 engineResult、年龄、用户选择的问题、指纹/报告指标构造 knowledgeQuery。
2. 检索 auto_safe / rewrite_required 条目，作为报告生成参考。
3. 检索 human_only / blocked 条目，作为风险边界参考。
4. 把 reportKnowledgeBlock / riskKnowledgeBlock 传入用户消息。
5. 如果检索失败，只记录内部日志，不中断报告生成。

## 3. 当前没有做什么

以下事项目前没有接入，也不建议直接接入：

- 生产系统没有直接读取整个 Obsidian vault。
- 没有把老师录音逐字稿全文直接塞进 Prompt。
- 没有把行业大会原文、外部机构原始话术直接塞进前台报告。
- 没有把 Obsidian 原文实时检索后原样输出给用户。
- 没有自动把用户输入或生成结果沉淀回 Obsidian。
- 没有把 Obsidian 当成生产数据库使用。
- 没有把 human_only / blocked 内容用于普通报告生成。

这不是偷懒，而是为了避免三个风险：

1. 原文太长、token 成本不可控。
2. 原始资料里有大量不适合前台直接输出的诊断化、玄学化、机构来源标签或过度承诺表达。
3. 生产系统需要稳定、可测、可回滚，不能每次生成都依赖整库实时读取。

## 4. Obsidian 当前在系统中的角色

Obsidian 目前更适合定义为：

```text
AIPIWEN 长期知识矿山
```

它不是直接生产输出层，而是上游知识资产层。

正确关系应该是：

```text
Obsidian 原始知识
→ 人工整理为知识卡
→ 标注模块、适用年龄、适用场景、安全等级、可输出方式
→ 进入 Report Knowledge Index
→ 被正式报告生成链路检索使用
```

这样做的好处：

- 省 token
- 可追溯
- 可审核
- 可灰度
- 可防止敏感内容直接进入前台
- 可以保留老师录音、专家课程、现场解读里的真实语言质感

## 5. 现有内置规则是否已经写入 Obsidian

已经开始写入。

当前已有一批系统知识卡，记录了正式报告生成链路里的核心内置语料，包括：

- 正式报告生成链路总索引
- generate-report 的 SYSTEM_PROMPT 知识卡
- generate-report 的硬编码规则知识卡
- engineResult / selectedIssues 输入契约
- ReportKnowledgeIndex 统一接入说明

这些内容进入 Obsidian 和 Report Knowledge Index 的意义是：

1. 防止系统规则只散落在代码里。
2. 让报告表达、结构、安全边界可以统一维护。
3. 后续主系统、报告库、Prompt、测试样本可以围绕同一套知识资产迭代。

## 6. 当前生成报告主要靠什么

当前正式报告生成不是单靠 Obsidian。

它由四层共同组成：

1. **结构化输入层**
   - engineResult
   - age
   - selectedIssues
   - 指纹/报告指标
   - 用户问题

2. **内置规则层**
   - SYSTEM_PROMPT
   - 固定报告结构
   - 年龄适配
   - 安全边界
   - 输出格式要求

3. **知识索引增强层**
   - Report Knowledge Index V1
   - 老师录音提炼
   - Report OS 表达库
   - Obsidian / 专家课程候选卡
   - 系统知识卡

4. **兜底层**
   - 当索引失败或命中不足时，继续使用内置规则和结构化输入生成报告
   - 不让用户看到知识库失败、索引失败或内部路径

这也是当前最稳的方式：先让生产报告可用，再逐步把 Obsidian 中更好的内容纳入结构化索引。

## 7. 当前最大误区

### 7.1 误区一：以为“接入 Obsidian”就是生产直接读整个库

不建议这样做。

Obsidian 原库是知识矿山，不是生产 Prompt 仓库。里面既有可直接使用的表达，也有需要改写、只能内部参考、甚至不能前台使用的内容。

### 7.2 误区二：以为“没直接读 Obsidian”就是“没接入知识库”

也不准确。

当前已经通过 Report Knowledge Index V1 接入了一批筛选后的知识卡。它不是全量接入，但已经是生产可控的第一版知识库增强层。

### 7.3 误区三：以为兜底报告会让知识库变成摆设

不会。

兜底只在索引失败、模型超时或生成异常时保护用户体验。正常情况下，正式报告链路会优先尝试检索 Report Knowledge Index，并把命中的安全内容作为报告生成依据。

正确策略不是“只用知识库”或“只用兜底”，而是：

```text
优先使用结构化知识增强；
失败时用内置规则兜底；
持续把高质量语料补进索引。
```

## 8. 当前限制

当前仍有明显不足：

1. Report Knowledge Index V1 只有 15 条，覆盖还很薄。
2. 五大功能区的独立知识卡还不够完整。
3. 用户四个问题的答案仍需要更多年龄段、场景、问题类型映射。
4. 老师录音逐字稿中的手指数值解释、左右手差异、功能区细节还没有全部结构化。
5. Obsidian 尚未形成完整的“模块索引 + 场景索引 + 年龄索引 + 安全索引”。
6. 目前是 JSON 轻量检索，不是向量数据库或复杂 RAG。
7. 检索命中质量依赖人工整理质量，需要继续补卡、分级和测试。

## 9. 五大功能区下一步必须补的知识

用户已经明确指出：五大功能区不能把两个手指数值加起来和平均值比较。

下一步应该按以下方式补知识卡：

```text
精神功能
思维功能
体觉功能
听觉功能
视觉功能
```

每个功能区需要单独建立知识卡，并写清楚：

- 对应哪两个手指
- 每个手指分别代表什么
- 每个手指各自与平均值比较，而不是两个手指相加
- 左右两个手指谁高、谁低分别代表什么倾向
- 单指高的表现
- 单指低的表现
- 两指差异明显时的表现
- 对学习、行为、沟通、接纳方式的应用建议
- 前台可输出表达
- 需要安全改写的表达
- 禁止直接输出的表达

这部分应该优先从老师解读录音逐字稿中提炼，而不是凭空写。

## 10. 行为问题与年龄阶段下一步必须补的知识

当前行为理解入口已经暴露出一个问题：不同年龄段不能共用同一批问题和同一套回答。

下一步应该建立：

```text
年龄段 → 常见问题 → 行为机制 → 可观察线索 → 可执行建议 → 安全边界
```

至少拆为：

- 幼儿 3-6 岁
- 小学 7-12 岁
- 初中 13-15 岁
- 高中 16-18 岁
- 大学 / 刚毕业
- 职场打拼期
- 成家育儿期
- 人生中场期

每个阶段的问题必须不同。比如：

- 幼儿：分离焦虑、规则感、情绪表达、亲子依恋
- 小学：作业拖拉、阅读困难、专注、课堂适应
- 初中：情绪波动、同伴关系、顶嘴、学习动力
- 高中：考试焦虑、选科、升学压力、自我认同
- 成年：拖延、压力反应、沟通边界、职业节奏

这部分未来也应该进入 Obsidian 和 Report Knowledge Index，而不是写死在前端。

## 11. 建议的后续建设顺序

### 第一步：补五大功能区知识卡

优先级最高。

因为这部分涉及正式报告核心专业度，且用户已经指出当前逻辑错误。

### 第二步：补年龄阶段问题库

让不同年龄段看到不同的问题选项和不同解释。

### 第三步：补用户四个问题的回答模板库

每个问题不能只套同一段三卡片模板，而要根据：

- 年龄段
- 问题类型
- 报告指标
- 性格类型
- TRC / ATD
- 学习通道
- 行为模式

生成差异化回答。

### 第四步：扩充 Report Knowledge Index

把补好的知识卡按以下字段进入索引：

- module
- ageStage
- issueType
- metricKey
- safetyStatus
- outputUse
- sourceType
- sourceRef
- safeExpression
- rewriteNeeded
- doNotUse

### 第五步：补测试样本

每补一批知识卡，都要增加测试样本，至少覆盖：

- 儿童
- 青少年
- 成人
- 高风险问题
- 指标缺失
- 知识索引无命中
- 知识索引命中但不可前台输出

## 12. 当前可以对外怎么理解

对外或对内部团队可以这样讲：

```text
AIPIWEN 现在不是简单让模型凭空写报告。
它已经开始把老师真实解读录音、Report OS、Obsidian 知识卡和现有系统规则统一整理成 Report Knowledge Index。
正式报告生成时，会优先检索这套结构化知识索引，把可安全输出的内容作为参考。
如果索引失败，系统会用现有内置规则兜底，保证用户不报错。
下一步重点不是继续乱改页面，而是继续把 Obsidian 里的真实知识拆成可检索、可追溯、可安全输出的内容资产。
```

## 13. 当前验证结果

已执行知识索引测试：

```text
node scripts/test-report-knowledge-index.js
```

结果：

```text
ok: true
totalEntries: 15
sampleGroundingItems: 6
```

说明当前索引文件可以读取，检索模块可用，grounding block 可以生成。

## 14. 最终结论

当前状态可以总结为：

```text
Obsidian 已作为知识资产上游接入，但不是直接生产读取层；
Report Knowledge Index V1 已作为正式报告生成的安全增强层接入；
现有 SYSTEM_PROMPT、硬编码规则、engineResult、selectedIssues 已开始回写为知识卡；
检索失败时仍由内置规则兜底；
下一步关键不是改页面，而是继续补齐五大功能区、年龄阶段问题库、四个用户问题回答库和测试样本。
```

这条路线是对的：既不浪费 Obsidian 里的真实知识，也不让生产系统被未经筛选的原始资料拖垮。
