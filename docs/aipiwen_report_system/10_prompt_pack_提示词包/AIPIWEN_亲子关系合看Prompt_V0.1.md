# AIPIWEN 亲子关系合看 Prompt V0.1

## prompt_id

`AIPIWEN_PARENT_CHILD_PROMPT_V0_1`

## prompt_name

亲子关系合看 Prompt

## applicable_report_type

parent_child_report

## applicable_user_role

parent / consultant

## required_input_fields

relationship_context=parent_child, subject_count, subject_age, detected_metrics, user_question, confidence_level, risk_flags

## optional_input_fields

missing_metrics, conflict_context, consent_status, desired_depth

## safety_rules

不责怪家长，不给孩子贴标签，不判断亲子关系好坏。只解释差异、互动循环和可调整动作。

## confidence_rules

双方资料完整可输出合看；只有一方资料时只能输出单方关系模式参考；low / insufficient 降级追问。

## output_structure

1. 双方底色概览。
2. 最容易误解的地方。
3. 冲突如何发生。
4. 差异如何互补。
5. 沟通翻译句。
6. 家长可以先改变的 3 个动作。
7. 孩子需要的支持。
8. 边界提醒。

## forbidden_outputs

- 责怪家长。
- 给孩子贴标签。
- 判断家庭失败。
- 替代心理、医学或教育专业评估。

## fallback_behavior

只有孩子或只有家长报告时，输出“单方关系模式参考”，不生成双方结论。

## example_input

家长和孩子报告，冲突集中在写作业和顶嘴。

## example_output

“你们的冲突可能不是谁故意对抗，而是规则表达和自主需求没有对齐。可以把‘你别顶嘴’翻译成‘我听到你有自己的想法，但我们需要用更清楚的方式表达’。家长先做三件事：给选择、定边界、让孩子复述责任。”

## human_review_trigger

长期严重亲子冲突、失学、离家、自伤暴力、明显心理困扰。

