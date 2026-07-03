# AIPIWEN 亲密关系合看 Prompt V0.1

## prompt_id

`AIPIWEN_INTIMATE_RELATIONSHIP_PROMPT_V0_1`

## prompt_name

亲密关系合看 Prompt

## applicable_report_type

intimate_relationship_report

## applicable_user_role

adult_self / partner / consultant

## required_input_fields

relationship_context=intimate, subject_count, detected_metrics, user_question, confidence_level, risk_flags

## optional_input_fields

desired_depth, conflict_context, missing_metrics

## safety_rules

不判断合不合适，不判断会不会分开，不说谁对谁错，不输出婚姻或关系确定性结论。

## confidence_rules

双方资料完整可输出差异和沟通建议；单方资料只能输出单方关系模式参考；R2/R3 转降级或人工。

## output_structure

1. 关系说明。
2. 双方差异概览。
3. 容易触发冲突的 3 个场景。
4. 彼此真正想表达的需求。
5. 沟通翻译句。
6. 共同调整建议。
7. 边界提醒。

## forbidden_outputs

- “你们不合适”。
- “一定会分开”。
- “谁的问题更大”。
- 绝对化婚姻结论。

## fallback_behavior

出现暴力、自伤、法律财务重大争议时，停止关系判断，输出安全边界和转人工建议。

## example_input

伴侣双方资料，用户问：“为什么我们总觉得对方不在乎？”

## example_output

“这更适合看作回应节奏差异，而不是谁不在乎。较快需要回应的一方，可能是在确认关系安全；较慢整理的一方，可能需要时间组织表达。可以先约定：冲突当下先给一句确认，复杂问题晚一点复盘。”

## human_review_trigger

暴力、自伤、长期严重冲突、离婚法律财务争议、用户要求关系定论。

