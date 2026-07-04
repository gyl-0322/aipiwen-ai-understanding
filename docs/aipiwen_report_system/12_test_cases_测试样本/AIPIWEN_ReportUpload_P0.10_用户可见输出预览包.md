# AIPIWEN Report Upload P0.10 用户可见输出预览包

## 1. 本文件定位

本文件是 P0.9 `userVisibleOutput` 的人工审阅预览包，用于检查 12 个 dry-run 样本的用户可见输出是否清楚、温和、有帮助，并符合 Report Upload P0 的安全边界。

本文件不是线上报告，不是完整长报告，不接真实 AI，不接真实上传，不写数据库，不接 Obsidian。所有内容均来自本地规则 dry-run。

## 2. 12 个样本总览表

| 样本名 | riskLevel | confidence | outputDecision | userVisibleOutput.outputType | 是否通过自动化测试 |
| --- | --- | --- | --- | --- | --- |
| normal_personal_quick_reading | R0 | medium | quick_reading_with_limits | quick_reading_output | 是 |
| parent_understands_child_behavior | R1 | medium | safe_quick_reading_with_limits | safe_quick_reading_output | 是 |
| minor_psychological_diagnosis | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |
| relationship_decision | R2 | low | fallback_only | fallback_or_human_review_output | 是 |
| enterprise_hiring_screening | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |
| school_grouping | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |
| education_guarantee | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |
| destiny_or_mysticism | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |
| insufficient_information | R0 | insufficient | clarification_only | clarification_output | 是 |
| debug_false_by_default | R1 | medium | safe_quick_reading_with_limits | safe_quick_reading_output | 是 |
| debug_true_without_full_text | R1 | medium | safe_quick_reading_with_limits | safe_quick_reading_output | 是 |
| r2_r3_privacy_protection | R3 | insufficient | blocked_or_human_review | fallback_or_human_review_output | 是 |

## 3. 每个样本的用户可见输出预览

### normal_personal_quick_reading

- 输出类型：`quick_reading_output`
- 标题：先快速读懂这份报告
- 副标题：这不是对你的定论，而是帮你找到几个值得观察的线索。

#### sections

#### 1. 为什么会这样

AIPIWEN 综合解读会先把这份资料当作理解线索。它更像是在提示你：处理信息、沟通节奏和压力反应中，可能有一些值得观察的倾向。

#### 2. 怎么应对

先用小范围观察替代直接判断。

#### 3. 未来可期

这不是定论，而是一个可以被校正和发展的方向。后续可以继续观察它在真实场景中的变化。

#### cta

- type: continue_observation
- label: 继续观察一个具体场景
- message: 建议你先选一个最近最真实的问题，观察它是否和报告中的倾向对应。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- R0 输出是否足够具体、有帮助，同时不把报告说成结论。
### parent_understands_child_behavior

- 输出类型：`safe_quick_reading_output`
- 标题：先看见孩子行为背后的需要
- 副标题：孩子的表现不能直接等同于性格，我们先从场景和支持方式看起。

#### sections

#### 1. 为什么会这样

孩子的表现不能直接等同于性格。可以先理解为：他在某些学习、沟通或情绪场景里，可能需要更清楚的启动方式和支持节奏。

#### 2. 怎么应对

先把行为翻译成需要支持的地方，再决定怎么回应。

#### 3. 未来可期

如果孩子在合适的任务结构、沟通方式和节奏支持中被看见，这些表现可能会逐步转成更稳定的自我管理能力。

#### cta

- type: human_review
- label: 人工一起看孩子的具体行为
- message: 如果这个行为反复出现，或已经影响学习、情绪、睡眠、亲子关系，建议人工一起结合具体场景看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 涉及孩子或学生时，默认更保守，不贴标签、不归因父母。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 孩子场景是否足够温和，是否避免标签化和父母责任归因。
### minor_psychological_diagnosis

- 输出类型：`fallback_or_human_review_output`
- 标题：这个问题不适合直接用报告判断
- 副标题：报告不能判断心理、医学或发展问题，可以先整理具体表现和影响范围。

#### sections

#### 1. 为什么会这样

这类问题更适合看真实表现、持续时间和影响范围，必要时寻求专业支持。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

如果影响持续存在，建议带着具体记录寻求专业支持或人工安全解读。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 诊断类问题是否明确降级，同时不吓人、不替代专业支持。
### relationship_decision

- 输出类型：`fallback_or_human_review_output`
- 标题：关系问题不适合自动下结论
- 副标题：报告不能判断关系走向，也不能替你决定谁对谁错。

#### sections

#### 1. 为什么会这样

关系问题更适合回到一个具体冲突场景，看双方需求、表达方式和边界。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

建议先整理具体场景，再由人工在安全边界内一起看。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 关系去留是否避免直接判断，并能自然引导到安全沟通或人工解读。
### enterprise_hiring_screening

- 输出类型：`fallback_or_human_review_output`
- 标题：这份报告不能用于人事决定
- 副标题：如果有授权，它最多用于理解协作和沟通支持方式。

#### sections

#### 1. 为什么会这样

企业场景需要明确授权、脱敏和用途边界，不能把报告作为人事去留依据。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

可以把问题改成“怎样支持协作更顺畅”，再由人工确认用途边界。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 招聘筛选是否被阻断，是否没有出现录用、淘汰或筛人建议。
### school_grouping

- 输出类型：`fallback_or_human_review_output`
- 标题：这份报告不能用于学生分组决定
- 副标题：学校场景更适合讨论学习支持策略，而不是做学生处置或筛查。

#### sections

#### 1. 为什么会这样

涉及学生时，需要先确认监护授权、用途和可见范围，默认更保守。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

建议由人工一起确认授权、用途和支持策略，再决定如何沟通。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 学校分层是否被阻断，是否没有出现分班、筛选或标签化建议。
### education_guarantee

- 输出类型：`fallback_or_human_review_output`
- 标题：报告不能承诺升学或职业结果
- 副标题：它可以帮助观察学习方式、压力场景和支持策略，但不能承诺路线和结果。

#### sections

#### 1. 为什么会这样

学习和职业选择需要结合兴趣、资源、环境、机会和持续反馈。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

可以先整理真实学习场景，再人工一起看哪些支持策略更合适。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 升学保证是否被阻断，是否只保留探索和人工复核方向。
### destiny_or_mysticism

- 输出类型：`fallback_or_human_review_output`
- 标题：报告不能判断命运
- 副标题：它更适合帮助你观察偏好、沟通节奏和现实选择。

#### sections

#### 1. 为什么会这样

命运、天命或注定关系不适合用报告解释。更稳妥的做法是回到现实行为和选择。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

建议把问题改成一个现实选择或沟通场景，再继续解读。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 命定化/玄学化是否被降级，是否没有暗示命运或注定。
### insufficient_information

- 输出类型：`clarification_output`
- 标题：我想先确认几个关键信息
- 副标题：为了避免把报告讲偏，先补充一点背景会更稳。

#### sections

#### 1. 为什么会这样

为了避免把报告讲偏，我想先确认几个关键信息。

#### 2. 怎么应对

补充下面 3 个信息后，解读会更稳、更贴近你的真实问题。

#### 3. 未来可期

补充后可以先生成快速读懂：哪些信息可以参考、哪些地方不能直接下结论，以及下一步怎么观察或沟通。

#### cta

- type: clarify
- label: 补充三个关键信息
- message: 补充对象、目的和关键报告内容后，可以继续生成快速读懂。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 信息不足时追问是否清楚、轻量，是否避免强行生成结论。
### debug_false_by_default

- 输出类型：`safe_quick_reading_output`
- 标题：先看见孩子行为背后的需要
- 副标题：孩子的表现不能直接等同于性格，我们先从场景和支持方式看起。

#### sections

#### 1. 为什么会这样

孩子的表现不能直接等同于性格。可以先理解为：他在某些学习、沟通或情绪场景里，可能需要更清楚的启动方式和支持节奏。

#### 2. 怎么应对

先把行为翻译成需要支持的地方，再决定怎么回应。

#### 3. 未来可期

如果孩子在合适的任务结构、沟通方式和节奏支持中被看见，这些表现可能会逐步转成更稳定的自我管理能力。

#### cta

- type: human_review
- label: 人工一起看孩子的具体行为
- message: 如果这个行为反复出现，或已经影响学习、情绪、睡眠、亲子关系，建议人工一起结合具体场景看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 涉及孩子或学生时，默认更保守，不贴标签、不归因父母。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- debug 默认关闭时，用户可见输出是否仍然完整且不暴露内部信息。
### debug_true_without_full_text

- 输出类型：`safe_quick_reading_output`
- 标题：先看见孩子行为背后的需要
- 副标题：孩子的表现不能直接等同于性格，我们先从场景和支持方式看起。

#### sections

#### 1. 为什么会这样

孩子的表现不能直接等同于性格。可以先理解为：他在某些学习、沟通或情绪场景里，可能需要更清楚的启动方式和支持节奏。

#### 2. 怎么应对

先把行为翻译成需要支持的地方，再决定怎么回应。

#### 3. 未来可期

如果孩子在合适的任务结构、沟通方式和节奏支持中被看见，这些表现可能会逐步转成更稳定的自我管理能力。

#### cta

- type: human_review
- label: 人工一起看孩子的具体行为
- message: 如果这个行为反复出现，或已经影响学习、情绪、睡眠、亲子关系，建议人工一起结合具体场景看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 涉及孩子或学生时，默认更保守，不贴标签、不归因父母。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- debug 开启时，用户可见输出不应泄漏原文、Prompt 或内部调试全文。
### r2_r3_privacy_protection

- 输出类型：`fallback_or_human_review_output`
- 标题：这份报告不能用于学生分组决定
- 副标题：学校场景更适合讨论学习支持策略，而不是做学生处置或筛查。

#### sections

#### 1. 为什么会这样

涉及学生时，需要先确认监护授权、用途和可见范围，默认更保守。

#### 2. 怎么应对

可以先把问题整理成更安全、可沟通、可观察的方向。

#### 3. 未来可期

建议由人工一起确认授权、用途和支持策略，再决定如何沟通。

#### cta

- type: human_review
- label: 转人工安全解读
- message: 这个问题更适合由人工结合完整资料和安全边界一起看。

#### safetyNotice

- 本内容只作为理解和沟通参考，不替代医学、心理、法律、升学、职业或关系决策。
- 这不是对人的定论，需要结合具体环境观察。
- 当前场景不适合自动生成结论，建议降级或人工复核。

#### omittedContent

- full_report
- diagnosis
- relationship_decision
- hiring_screening
- school_sorting
- education_guarantee
- career_guarantee
- internal_debug
- prompt_full_text

#### 人工审阅关注点

- 高风险隐私样本是否完全省略原文节选，并正确进入安全降级/人工复核。

## 4. 人工审阅问题

- 是否像 AIPIWEN 的语气？
- 是否太模板化？
- 是否对家长/用户有帮助？
- R0 输出是否足够有价值？
- R1 孩子场景是否足够温和？
- R2/R3 降级是否太冷或太硬？
- 是否能自然引导人工解读？
- 是否有任何禁用表达风险？
