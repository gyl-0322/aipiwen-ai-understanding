# AIPIWEN 报告类型与模板选择 Schema V0.1

## 1. 定位

本 Schema 用于把用户上传报告后的字段组合映射到报告模板。模板只决定结构，不决定结论；所有模板都必须先通过风险等级、置信度和资料完整度检查。

## 2. 模板选择总表

| report_type | 中文名称 | 适用入口 | 必需字段 | 可选字段 | 不适用情况 | 输出章节 | 风险边界 | AI 自动生成 | 人工复核 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| quick_read_report | 快速读懂版 | 用户只想看懂报告、资料基本完整或部分完整 | source_type, report_subject_type, user_role, detected_metrics | subject_age, user_question | 用户要求深度关系判断、医学/心理结论 | 核心指标、最明显倾向、可行动建议、边界说明 | 不做长期判断，不解释缺失指标 | 允许 | 通常不需要 |
| individual_full_report | 个人完整解读版 | 成人本人或单个孩子完整报告 | subject_count=1, report_completeness=complete, detected_metrics | subject_age, user_goal | 资料缺失、多人关系、未授权他人资料 | 总览、TRC、ATD、性格、学习通道、行为模式、五大功能区、建议 | 不做命运、职业定论、心理诊断 | 允许，需安全检查 | 中风险建议复核 |
| child_behavior_report | 孩子行为理解版 | 家长询问孩子行为、学习、兴趣班 | report_subject_type=child, user_role=parent, user_question | subject_age, relationship_context | 涉及自伤、暴力、明显心理困扰 | 行为场景、常见误判、可能需要、回应建议、观察点 | 不贴标签，不说问题孩子 | 允许 R0/R1 | R2 以上复核 |
| parent_child_report | 亲子关系理解版 | 家长和孩子资料或亲子冲突 | relationship_context=parent_child, subject_count=2 或 partial | subject_age, detected_metrics | 只有一方资料却要求双方结论 | 双方底色、误解场景、冲突循环、沟通翻译、行动计划 | 不诊断家庭，不评价老师 | 中低风险允许 | 建议复核 |
| intimate_relationship_report | 亲密关系理解版 | 伴侣关系、婚恋关系合看 | relationship_context=intimate, subject_count=2 | desired_depth, user_question | 暴力、自伤、法律财务重大争议 | 差异、冲突、互补、需求翻译、行动计划、边界 | 不劝分、不劝合、不判断谁有问题 | R0/R1 可生成 | R2/R3 必须复核 |
| partner_collaboration_report | 合伙人关系理解版 | 合伙、创业、夫妻共同事业 | relationship_context=partner, subject_count=2 | business_context, desired_depth | 涉及投资、法律、股权定论 | 角色底色、决策节奏、风险识别、权责边界、会议机制 | 不给法律/财务结论 | R0/R1 可生成 | 涉及重大利益需复核 |
| team_collaboration_report | 团队协作理解版 | 团队多人报告、管理者使用 | relationship_context=team, subject_count=multiple, consent_status=confirmed | role_list, org_context | 无授权、用于淘汰筛查 | 团队画像、角色分布、冲突矩阵、会议机制、协作建议 | 不排名、不淘汰、不筛查风险人员 | 允许群体级生成 | 建议复核 |
| career_learning_report | 职业与学习建议版 | 成人职业、专业选择、学习方式 | user_goal=career_learning 或 career_direction | education_background, work_context | 用户要求确定职业命运或重大财务承诺 | 当前优势、学习方式、职业探索、过渡比例、验证计划 | 不说一定适合/不适合 | R0/R1 可生成 | 重大转型需复核 |
| class_group_report | 班级画像版 | 老师或学校看班级群体 | user_role=teacher, relationship_context=class, subject_count=multiple, consent_status=confirmed | grade, class_size | 无授权、输出个体排名 | 群体学习通道、任务节奏、沟通建议、家校话术 | 只输出群体，不输出个体标签 | 可生成群体摘要 | 建议人工复核 |
| safety_limited_report | 安全降级版 | 资料不足、风险较高、授权不明 | risk_level=R2 或 confidence_level=low/insufficient | any | R3 必须拒绝直接结论 | 可做范围、缺失信息、观察方向、下一步追问 | 不做判断，只做边界和追问 | 允许 | R3 转人工或专业帮助 |

## 3. 模板选择优先级

1. 先看风险：R3 优先转人工或专业帮助，不进入普通模板。
2. 再看授权：未成年人、多人、班级、团队无授权时，只能安全降级。
3. 再看主体数量：单人、双人、多人分别进入个人、关系、团队/班级模板。
4. 再看用户目的：快速读懂、行为问题、关系冲突、职业学习、专家深度解读。
5. 最后看完整度和置信度：不完整时降级或追问。

## 4. 默认降级路径

| 原始候选模板 | 降级条件 | 降级到 |
| --- | --- | --- |
| individual_full_report | 缺少核心指标 | quick_read_report 或 safety_limited_report |
| parent_child_report | 只有一方报告 | child_behavior_report 或单方关系模式参考 |
| intimate_relationship_report | 暴力、自伤、法律风险 | safety_limited_report + refer_human |
| team_collaboration_report | 无授权或涉及淘汰 | safety_limited_report |
| class_group_report | 要求个体排名 | safety_limited_report |
| career_learning_report | 要求确定职业结论 | safety_limited_report + 过渡验证建议 |

