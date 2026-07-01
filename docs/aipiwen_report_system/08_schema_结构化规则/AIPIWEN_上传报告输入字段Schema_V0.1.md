# AIPIWEN 上传报告输入字段 Schema V0.1

## 1. 定位

本 Schema 用于把用户上传报告后的原始资料、用户身份、使用目的、完整度、风险和输出偏好转成产品可调用字段。任何上传报告输出都必须先完成字段识别，再进入模板选择、风险判断和置信度计算。

## 2. 字段清单

| 字段 | 含义 | 类型 | 可选值 | 必填 | 为空时处理 | 对报告生成的影响 |
| --- | --- | --- | --- | --- | --- | --- |
| upload_id | 本次上传唯一编号 | string | 系统生成 | 是 | 拒绝进入流程，要求系统补齐 | 用于记录、追踪、沉淀知识卡 |
| user_id | 上传用户编号 | string | 系统用户 ID / anonymous | 是 | 可用 anonymous，但限制长期记忆 | 影响长期问答和历史上下文 |
| upload_time | 上传时间 | datetime | ISO 时间 | 是 | 系统自动补齐 | 用于版本、审计和后续追问 |
| source_type | 上传资料来源 | enum | image / pdf / text / manual / report_data | 是 | 追问资料类型或标记 unknown | 决定解析方式和置信度 |
| report_subject_type | 报告主体类型 | enum | child / adult / couple / parent_child / team / unknown | 是 | 追问“这份报告是关于谁的” | 决定模板候选范围 |
| subject_count | 主体数量 | enum | 1 / 2 / multiple / unknown | 是 | 从文件或用户描述推断，不能推断则追问 | 决定单人、关系或团队报告 |
| subject_age | 主体年龄 | number / array / unknown | 0-120 / unknown | 条件必填 | 未提供时追问年龄段 | 决定分龄表达和未成年人规则 |
| subject_gender | 主体性别 | enum / array | female / male / undisclosed / unknown | 否 | 默认 undisclosed，不强制追问 | 只用于用户自愿提供的称谓，不做能力判断 |
| relationship_context | 主体关系 | enum / text | self / parent_child / intimate / partner / team / class / other / unknown | 条件必填 | 多人报告必须追问 | 决定关系合看、团队或班级模板 |
| user_role | 当前使用者身份 | enum | parent / child_self / adult_self / teacher / consultant / partner / team_leader / agent / unknown | 是 | 追问“你希望从哪个角度看” | 决定视角、语言和安全边界 |
| user_goal | 用户目标 | enum / text | quick_read / full_understanding / behavior_help / relationship_help / career_learning / class_team / expert_review / unknown | 是 | 先输出温和追问，不直接生成长文 | 决定报告深度和章节 |
| user_question | 用户原始问题 | string | 用户输入 | 条件必填 | 若为空，先问“你最想解决什么” | 决定意图识别和追问 |
| report_completeness | 报告完整度 | enum | complete / partial / unreadable / unknown | 是 | 标记 unknown 并转完整度检测 | 影响置信度和降级输出 |
| detected_metrics | 已识别指标 | array | TRC / ATD / APD / personality_type / learning_channel / behavior_mode / brain_bias / five_functions / other | 是 | 空数组进入 low 或 insufficient | 决定可调用指标卡 |
| missing_metrics | 缺失指标 | array | 同 detected_metrics | 是 | 无法判断时填 unknown | 决定补充资料清单 |
| sensitive_context | 敏感场景 | array | medical / mental_health / self_harm / violence / minor / school / legal / financial / intimate_conflict / career_major / team_elimination / none | 是 | 默认 none，但扫描风险词 | 决定风险等级和人工触发 |
| consent_status | 授权状态 | enum | confirmed / pending / missing / not_required | 是 | 涉及他人或未成年人时必须追问 | 未授权时不能生成深度报告 |
| minor_status | 是否涉及未成年人 | enum | yes / no / unknown | 是 | 年龄未知时标记 unknown 并追问 | 决定校园、家庭和安全话术 |
| privacy_level | 隐私等级 | enum | low / medium / high / restricted | 是 | 默认 medium；涉及多人/未成年人升高 | 决定输出可见范围和脱敏要求 |
| output_language | 输出语言 | enum | zh-CN / zh-HK / en / mixed | 否 | 默认 zh-CN | 决定话术风格 |
| desired_depth | 期望深度 | enum | quick / full / action_plan / expert_review | 是 | 默认 quick，并询问是否需要深入 | 决定章节数量和是否建议人工 |
| risk_flags | 风险标记 | array | medical_diagnosis / mental_health / self_harm / child_labeling / relationship_determinism / career_determinism / school_admission_promise / fortune_telling / legal_financial_claim / privacy_sensitive / minor_data / team_elimination_risk / discrimination_risk | 是 | 空数组表示暂未命中，但仍做安全检查 | 决定 risk_level 和系统动作 |
| confidence_level | 置信度 | enum | high / medium / low / insufficient | 是 | 初始 unknown，经计算后填充 | 决定输出断言强度和是否降级 |
| recommended_next_step | 推荐下一步 | enum / array | generate_report / ask_question / request_more_data / safety_limited_output / refer_human / suggest_professional_help | 是 | 由系统计算，不允许用户直接指定 | 决定流程进入生成、追问、降级或转人工 |

## 3. 最小可生成条件

AI 自动生成报告前至少需要：

1. `source_type` 已识别。
2. `report_subject_type` 已识别。
3. `user_role` 已识别。
4. `user_goal` 或 `user_question` 至少有一项明确。
5. `report_completeness` 不是 unreadable。
6. `risk_flags` 已经过安全扫描。
7. `confidence_level` 已计算。

不满足时，系统只能追问、请求补充资料或输出安全降级版。

