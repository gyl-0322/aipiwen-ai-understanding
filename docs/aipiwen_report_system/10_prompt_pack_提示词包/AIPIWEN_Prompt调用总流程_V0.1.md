# AIPIWEN Prompt 调用总流程 V0.1

## prompt_id

`AIPIWEN_PROMPT_ROUTING_FLOW_V0_1`

## prompt_name

Prompt 调用总流程

## applicable_report_type

all

## applicable_user_role

all

## required_input_fields

upload_id, source_type, user_question, user_role, risk_flags, confidence_level, recommended_next_step

## optional_input_fields

all_schema_fields

## safety_rules

必须先解析、再追问/风险/置信度判断，不能跳过安全检查直接生成报告。

## confidence_rules

按置信度决定是否调用报告生成 Prompt、降级 Prompt 或转人工 Prompt。

## output_structure

1. 先解析：调用 `AIPIWEN_UPLOAD_PARSE_PROMPT_V0_1`。
2. 再判断是否追问：字段缺失时调用 `AIPIWEN_FOLLOWUP_PROMPT_V0_1`。
3. 再判断风险：命中风险时调用 `AIPIWEN_SAFETY_REWRITE_PROMPT_V0_1` 或降级/转人工。
4. 再判断置信度：low / insufficient 调用 `AIPIWEN_LIMITED_OUTPUT_PROMPT_V0_1`。
5. 再选择 Prompt：按 selected_report_type 调用对应报告生成 Prompt。
6. 再生成报告：输出对应结构。
7. 再安全改写：统一过安全改写 Prompt。
8. 再判断转人工：命中触发时调用 `AIPIWEN_HUMAN_REFERRAL_PROMPT_V0_1`。
9. 最后输出：给用户安全报告、行动建议或下一步。

## forbidden_outputs

- 未解析就生成报告。
- 未检测风险就输出敏感结论。
- R3 继续调用普通报告 Prompt。
- 低置信度输出完整报告。

## fallback_behavior

任何流程节点失败时，进入追问、补资料、安全降级或转人工，不强行输出。

## example_input

上传孩子报告截图，用户问写作业拖拉，资料部分可读，风险为 minor_data，置信度 medium。

## example_output

调用顺序：上传报告解析 Prompt -> 追问生成 Prompt -> 孩子行为理解 Prompt -> 安全改写 Prompt -> 输出报告。如果后续回答出现明显心理困扰，则切换到转人工建议 Prompt。

## human_review_trigger

任一节点命中 R3、复杂关系、重大职业/财务/法律/医学/心理风险、学校或团队个体标签化用途。

