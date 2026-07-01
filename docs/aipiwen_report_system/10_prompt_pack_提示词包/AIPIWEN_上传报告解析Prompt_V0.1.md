# AIPIWEN 上传报告解析 Prompt V0.1

## prompt_id

`AIPIWEN_UPLOAD_PARSE_PROMPT_V0_1`

## prompt_name

上传报告解析 Prompt

## applicable_report_type

pre_generation_parser

## applicable_user_role

all

## required_input_fields

raw_upload_text, source_type, user_question

## optional_input_fields

ocr_text, pdf_text, manual_metrics, user_role_hint, age_hint, relationship_hint

## safety_rules

只做结构化解析，不生成完整报告，不输出结论。遇到医学、心理、自伤、未成年人、隐私、关系冲突、团队淘汰等敏感信息，只记录 risk_flags，不展开判断。

## confidence_rules

根据资料可读性、指标完整度、用户问题明确度，输出 high / medium / low / insufficient。

## output_structure

```yaml
report_subject_type:
subject_count:
detected_metrics:
missing_metrics:
report_completeness:
user_role:
user_goal:
risk_flags:
confidence_level:
recommended_report_type:
required_followup_questions:
```

## forbidden_outputs

- 直接生成完整报告。
- 根据单个指标给结论。
- 把 OCR 不清内容当作确定资料。
- 输出医学、心理、关系、职业或升学判断。

## fallback_behavior

如果资料不可读，输出 `report_completeness: unreadable`，`confidence_level: insufficient`，并给出 1-3 个补充资料问题。

## example_input

用户上传一段 OCR：“孩子 9 岁，TRC 高，听觉通道较弱。想知道写作业拖拉怎么办。”

## example_output

```yaml
report_subject_type: child
subject_count: 1
detected_metrics: [TRC, learning_channel]
missing_metrics: [ATD, personality_type, behavior_mode, five_functions]
report_completeness: partial
user_role: parent
user_goal: behavior_help
risk_flags: [minor_data]
confidence_level: medium
recommended_report_type: child_behavior_report
required_followup_questions:
  - 孩子写作业拖拉主要发生在开始前、过程中，还是收尾时？
```

## human_review_trigger

解析中命中 R3 风险，或用户上传未成年人/多人资料但授权不明。

