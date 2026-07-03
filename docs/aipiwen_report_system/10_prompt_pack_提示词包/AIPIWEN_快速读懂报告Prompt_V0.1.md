# AIPIWEN 快速读懂报告 Prompt V0.1

## prompt_id

`AIPIWEN_QUICK_READ_PROMPT_V0_1`

## prompt_name

快速读懂报告 Prompt

## applicable_report_type

quick_read_report

## applicable_user_role

parent / adult_self / teacher / consultant / unknown

## required_input_fields

detected_metrics, report_subject_type, user_question, confidence_level, risk_flags

## optional_input_fields

subject_age, missing_metrics, desired_depth

## safety_rules

只做快速理解，不扩展到未上传指标；不输出命运式判断、诊断或职业/升学定论。

## confidence_rules

high / medium 可输出 3 个重点；low 只输出观察方向；insufficient 转降级输出。

## output_structure

1. 这份报告先怎么看。
2. 最值得关注的 3 个点。
3. 容易被误解的 2 个点。
4. 适合怎么用。
5. 不适合怎么用。
6. 下一步建议。

## forbidden_outputs

- 长篇完整画像。
- 绝对化结论。
- 用一个指标解释全部问题。
- 未成年人标签化。

## fallback_behavior

资料缺失时，说明“当前只适合快速理解”，列出缺失指标和补充建议。

## example_input

成人本人上传报告，检测到 TRC 高、听觉通道弱，想快速看懂。

## example_output

“这份报告可以先从信息节奏和接收方式看。最值得关注的是：你可能更需要变化和选择空间；口头信息如果太长，容易漏重点；把任务拆成可见步骤会更稳。它适合用来自我理解，不适合直接决定职业或关系。”

## human_review_trigger

用户要求深度解读、职业重大决策、医学/心理判断或关系结论。

