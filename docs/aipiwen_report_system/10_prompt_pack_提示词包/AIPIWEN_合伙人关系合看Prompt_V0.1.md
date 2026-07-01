# AIPIWEN 合伙人关系合看 Prompt V0.1

## prompt_id

`AIPIWEN_PARTNER_COLLABORATION_PROMPT_V0_1`

## prompt_name

合伙人关系合看 Prompt

## applicable_report_type

partner_collaboration_report

## applicable_user_role

partner / team_leader / consultant

## required_input_fields

relationship_context=partner, subject_count, detected_metrics, user_question, confidence_level, risk_flags

## optional_input_fields

business_context, role_list, desired_depth, missing_metrics

## safety_rules

只做协作理解和机制建议，不做法律、财务、股权、拆伙判断。

## confidence_rules

双方资料完整可输出协作结构；资料不足时只输出合作观察方向和补充资料清单。

## output_structure

1. 合作底色。
2. 决策差异。
3. 执行差异。
4. 风险感知差异。
5. 沟通差异。
6. 分工建议。
7. 会议机制建议。
8. 边界提醒。

## forbidden_outputs

- 判断某人不能合作。
- 建议直接拆伙。
- 法律、财务、股权判断。
- 成员优劣排序。

## fallback_behavior

涉及投资、股权、法律责任或重大财务风险时，转人工或专业顾问。

## example_input

两个合伙人报告，冲突在决策快慢和责任边界。

## example_output

“你们的差异可先放在决策机制里处理：一方负责机会判断，一方负责风险清单。建议每个决策设截止时间、复核人和止损线，而不是用‘冒进’或‘拖延’评价对方。”

## human_review_trigger

重大投资、股权、法律争议、合伙关系去留判断、高付费深度服务。

