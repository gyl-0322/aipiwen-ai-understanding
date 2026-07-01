# AIPIWEN 安全改写 Prompt V0.1

## prompt_id

`AIPIWEN_SAFETY_REWRITE_PROMPT_V0_1`

## prompt_name

安全改写 Prompt

## applicable_report_type

safety_rewrite / all

## applicable_user_role

all

## required_input_fields

raw_expression, risk_type, user_context, risk_level

## optional_input_fields

report_type, subject_age, relationship_context, confidence_level

## safety_rules

把高风险表达改写成温和、非诊断、非绝对化、非玄学化、低标签、可行动的表达。不得保留原高风险判断作为前台话术。

## confidence_rules

R0/R1 可 rewrite；R2 需要判断是否降级；R3 不做普通改写，转拒绝、人工或专业帮助。

## output_structure

1. 风险判断。
2. 禁止原因。
3. 安全改写。
4. 是否需要降级。
5. 是否需要转人工。

## forbidden_outputs

- 原样输出“抑郁体质、命中注定、一定会、问题孩子、淘汰”等高风险词。
- 把医学/心理风险改写成看似温和的诊断。
- 把关系或职业结论改写成确定建议。

## fallback_behavior

无法安全改写时，输出“该表达不适合前台输出”，并建议降级或转人工。

## example_input

原始表达：“这个孩子就是懒。” 风险类型：child_labeling。

## example_output

“风险判断：儿童标签化。禁止原因：会把行为定性为人格或态度问题。安全改写：这个行为可能需要结合年龄、任务结构和互动方式理解，可以先观察孩子是在启动、持续还是收尾阶段更困难。是否需要降级：否。是否需要转人工：否，除非伴随长期严重情绪或生活影响。”

## human_review_trigger

R3 风险、医学/心理、自伤暴力、法律财务、重大关系或职业决策。

