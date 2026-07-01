# AIPIWEN 个人完整解读 Prompt V0.1

## prompt_id

`AIPIWEN_INDIVIDUAL_FULL_PROMPT_V0_1`

## prompt_name

个人完整解读 Prompt

## applicable_report_type

individual_full_report

## applicable_user_role

adult_self / parent / consultant

## required_input_fields

report_subject_type, subject_count, detected_metrics, report_completeness, user_goal, confidence_level, risk_flags

## optional_input_fields

subject_age, user_question, missing_metrics, desired_depth

## safety_rules

画像是理解参考，不是人格定型；不做医学、心理、命运、职业终局判断。

## confidence_rules

仅 high 或 medium 输出完整结构；low 降级为快速读懂或观察方向；insufficient 不生成。

## output_structure

1. 基础说明。
2. 核心底色。
3. 认知与学习方式。
4. 行动与执行方式。
5. 沟通与关系模式。
6. 优势使用方式。
7. 容易消耗的场景。
8. 现实建议。
9. 边界提醒。

## forbidden_outputs

- “你就是某种人”。
- “你一定适合/不适合某职业”。
- “你的关系一定如何”。
- 医学或心理诊断。

## fallback_behavior

核心指标缺失时，标注缺失，减少组合判断，转 quick_read_report 或 safety_limited_report。

## example_input

成人单人完整报告，用户想理解职业和学习方式。

## example_output

“基于当前资料，可以先把你理解为需要清晰目标和可验证路径的人。学习上适合把抽象内容转成结构清单；行动上适合先做小范围验证。以下建议不等于职业结论，更适合帮助你设计低风险探索。”

## human_review_trigger

职业重大转型、长期关系冲突、高付费深度服务、心理/医学风险。

