# AIPIWEN 用户意图与追问 Schema V0.1

## 1. 定位

上传报告后，系统必须先判断用户目的。追问用于减少误判，不用于审问用户；每次最多问 1-3 个关键问题，语气要温和、具体、可回答。

## 2. 意图识别表

| intent | 识别关键词 / 场景 | 适合报告类型 | 必要追问 | 可选追问 | 禁止直接回答 | 示例追问话术 |
| --- | --- | --- | --- | --- | --- | --- |
| understand_self | 了解自己、看懂报告、我是什么类型 | quick_read_report / individual_full_report | 你更想快速看懂，还是做完整解读？ | 最近是否有具体困惑 | 直接给人生结论 | “你想先快速看懂核心特点，还是围绕某个问题深入看？” |
| understand_child | 看懂孩子、孩子特点、怎么带孩子 | quick_read_report / child_behavior_report | 孩子年龄多大？你最想理解哪个场景？ | 学习、情绪、兴趣哪个更重要 | 给孩子贴标签 | “我先按孩子的年龄和具体场景来看，会更准确。你最想解决哪件事？” |
| behavior_problem | 不写作业、拖拉、顶嘴、情绪大、肚子疼 | child_behavior_report | 行为发生在什么场景？持续多久？ | 家长通常怎么回应 | 用报告解释严重身心症状 | “这个行为一般在什么时候出现？你希望我重点看原因还是回应方式？” |
| learning_method | 学习方法、作业、专注、记忆、听课 | quick_read_report / child_behavior_report / career_learning_report | 年龄段和学习场景是什么？ | 更困扰输入、输出还是执行 | 承诺成绩提升 | “你更想看孩子适合怎么学，还是想处理某个学习卡点？” |
| interest_selection | 兴趣班、天赋、适合学什么 | child_behavior_report / career_learning_report | 当前考虑哪些兴趣或方向？ | 试过什么、孩子反馈如何 | 一次性决定长期方向 | “可以先用短周期体验来验证。你现在纠结的具体选项是什么？” |
| parent_child_conflict | 亲子冲突、管不住、孩子反抗、沟通困难 | parent_child_report | 是否有双方报告？最常发生的冲突是什么？ | 孩子年龄、家长回应方式 | 判断谁对谁错 | “我会先看互动循环，不判断谁有问题。你们最常卡在哪个场景？” |
| intimate_conflict | 伴侣、婚姻、亲密关系、对方不懂我 | intimate_relationship_report | 是否有双方资料？当前冲突是否涉及安全风险？ | 想看沟通、需求还是行动计划 | 劝分劝合、断定不合适 | “我可以帮你把差异翻译成需求。你更想看冲突原因还是下一步怎么沟通？” |
| career_direction | 职业、转型、适合什么工作、专业选择 | career_learning_report | 当前行业、过往经历、最想解决的问题 | 是否涉及收入/家庭重大影响 | 直接建议辞职或定职业 | “我会先看可验证的小方向，不建议直接推翻现状。你现在是想转型还是优化当前工作？” |
| team_collaboration | 团队、合伙、协作、会议、角色分工 | team_collaboration_report / partner_collaboration_report | 团队人数、角色、是否有授权 | 当前协作卡点 | 成员排名、淘汰建议 | “我可以按协作机制看，不做成员优劣判断。你最想改善会议、分工还是沟通？” |
| class_management | 班级、老师、学生群体、家校沟通 | class_group_report | 是否有授权和脱敏？看群体还是个体？ | 年级、班级人数、应用场景 | 个体风险筛查或排名 | “班级画像只适合做群体支持建议，不做学生标签。你希望用于课堂还是家校沟通？” |
| expert_interpretation | 深度解读、找老师、人工专家、复杂个案 | safety_limited_report / expert_review | 希望专家重点看什么？是否有紧急风险？ | 可先生成资料摘要 | AI 冒充专家深度结论 | “这类问题适合人工专家复核。我可以先帮你整理资料和关键问题。” |
| unknown | 用户只上传文件，无问题或目标模糊 | quick_read_report / safety_limited_report | 你想用这份报告解决什么？ | 是否快速读懂即可 | 默认生成长文 | “我先确认一下：你想快速看懂报告，还是想解决学习、关系、职业里的某个具体问题？” |

## 3. 追问规则

- 先问目的，再问资料缺口。
- 每轮追问最多 3 个问题。
- 对未成年人和关系冲突使用低压表达。
- 不问与当前输出无关的隐私。
- 用户不愿补充时，转为低置信度输出。

## 4. 追问触发条件

| 条件 | 系统动作 |
| --- | --- |
| user_goal=unknown | 先追问目的 |
| report_subject_type=unknown | 追问报告对象 |
| subject_age=unknown 且涉及孩子 | 追问年龄段 |
| relationship_context=unknown 且 subject_count 不为 1 | 追问关系类型 |
| consent_status=missing | 追问授权或限制输出 |
| risk_flags 非空 | 先安全确认，再决定是否输出 |

## 5. V0.8 外部培训补充意图与追问状态

外部培训资料提示：用户经常不是上传完整报告，而是先描述一个行为、质疑报告准确性，或只给出当前困境。此时系统必须先补场景和后天环境，不得直接生成完整画像。

| state_id | 触发条件 | 必要追问字段 | 允许输出 | 禁止输出 | 示例追问话术 |
| --- | --- | --- | --- | --- | --- |
| behavior_only_input | 用户只描述行为，未提供完整报告或关键指标 | behavior_context, subject_age, duration, trigger_scene, user_goal | 场景复述、可能方向、低风险观察动作 | 人格判断、诊断、完整报告、类型定性 | “我先不急着下结论。这个行为通常发生在什么场景？持续多久了？” |
| user_disagrees_with_report | 用户说报告不准、不像自己、不像孩子、和现实不一致 | disagreed_section, report_quality, life_stage, environment_history, current_role | 接住反馈、校正说明、低置信度解释、补充追问 | 争辩报告一定准、要求用户接受、强行解释 | “你觉得哪一段最不像？我们可以把它当成后天环境或表达方式的校正线索。” |
| environment_context_required | 报告可读但行为解释依赖家庭、学校、职业、训练或当前关系场景 | family_context, school_context, work_context, training_history, relationship_context | 倾向性解释、后天校正、下一步观察 | 单一指标定因、直接给重大决策 | “这类表现和环境关系很大。最近是在家庭、学校、工作还是关系里更明显？” |

### 5.1 追问优先级

1. 未成年人优先追问年龄和安全风险。
2. 行为输入优先追问场景和持续时间。
3. 用户不认同报告时优先追问“不像的段落”。
4. 涉及后天环境时优先追问长期训练、家庭/学校/职业角色和当前压力。
5. 用户不愿补充时，置信度降为 low 或 insufficient。

### 5.2 Schema 输出要求

新增状态应写入上传报告流程中的 `intent_state` 或等价字段：

- `behavior_only_input=true/false`
- `user_disagrees_with_report=true/false`
- `environment_context_required=true/false`
- `confidence_level=high/medium/low/insufficient`
- `recommended_next_step=ask_followup/limited_output/upload_report/refer_human`
