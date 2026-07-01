# AIPIWEN 上传报告输出总流程 Schema V0.1

## 1. 定位

本流程是上传报告板块的总控 Schema。它把输入字段、用户意图、模板选择、风险等级、置信度、降级输出和转人工触发串成一个可执行顺序。

## 2. 总流程

| 步骤 | 输入 | 处理逻辑 | 输出 | 失败降级 | 安全注意事项 |
| --- | --- | --- | --- | --- | --- |
| Step 1 接收上传 | 文件、文本、手动录入、结构化报告数据 | 生成 upload_id，记录 upload_time 和 user_id | 上传记录 | 无法接收时提示重新上传 | 不在日志裸露隐私 |
| Step 2 识别资料类型 | source_type 原始资料 | 判断 image / pdf / text / manual / report_data | source_type | 无法识别则标记 unknown 并追问 | 不因截图模糊输出确定结论 |
| Step 3 识别主体与关系 | 报告内容、用户描述 | 识别 child / adult / couple / parent_child / team，判断 subject_count | report_subject_type, subject_count, relationship_context | 无法判断则追问对象和关系 | 多人资料先看授权 |
| Step 4 识别用户身份 | 登录信息、用户自述 | 识别 parent / child_self / adult_self / teacher / consultant / partner / team_leader / agent | user_role | unknown 时追问视角 | 身份决定语言边界 |
| Step 5 识别用户目的 | user_question, user_goal | 匹配用户意图 Schema | intent, user_goal | unknown 时先问目的 | 不默认生成长文 |
| Step 6 检测完整度 | 上传资料、detected_metrics | 提取 TRC、ATD、性格、学习通道、行为模式、五大功能区等 | report_completeness, detected_metrics, missing_metrics | 不完整则标记缺失 | 缺指标必须降置信度 |
| Step 7 检测风险 | 用户问题、报告内容、敏感词 | 命中风险类型并取最高 risk_level | risk_flags, risk_level, action | R2 降级，R3 拒绝直接结论 | 医学、心理、自伤、未成年人优先 |
| Step 8 计算置信度 | 完整度、指标、意图、风险、场景信息 | 按置信度 Schema 计算 high / medium / low / insufficient | confidence_level | 不足则追问或降级 | 置信度控制断言强度 |
| Step 9 选择报告模板 | intent, subject_count, user_role, confidence_level, risk_level | 按模板选择 Schema 选 report_type | selected_report_type | 不匹配则 safety_limited_report | R3 不进入普通模板 |
| Step 10 必要追问 | 缺失字段、低置信度、用户目的不明 | 最多提出 1-3 个温和问题 | follow_up_questions | 用户不答则低置信输出 | 不追问无关隐私 |
| Step 11 生成报告 | 模板、指标卡、案例卡、关系卡、话术库 | 生成结构化草稿 | draft_report | 资料不足则生成安全降级版 | 不直接输出高风险词 |
| Step 12 安全改写 | draft_report, risk_flags | 替换绝对化、诊断、玄学、标签化表达 | safe_report | 无法改写则停止输出 | 保留边界说明 |
| Step 13 输出行动建议 | safe_report, user_goal | 输出近期可做动作、验证方式和补充资料 | action_plan | 只输出观察方向 | 不承诺结果 |
| Step 14 判断是否建议人工专家 | trigger_schema, risk_level, desired_depth | 判断 refer_human 或 suggest_professional_help | expert_referral_note | 不满足转人工则记录原因 | R3 必须转人工或专业帮助 |
| Step 15 记录可沉淀知识卡 | 输出结果、用户反馈、脱敏信息 | 识别可沉淀案例、规则、话术 | knowledge_card_candidate | 未脱敏不沉淀 | 去除隐私和高风险原话 |

## 3. 流程出口

| 出口 | 条件 | 输出 |
| --- | --- | --- |
| generate_report | R0/R1，confidence high/medium，字段完整 | 正常模板报告 |
| ask_question | 意图、年龄、关系、授权或场景不明 | 温和追问 |
| request_more_data | 报告缺失、指标不可读 | 补充资料清单 |
| safety_limited_output | R2 或 confidence low | 安全降级版 |
| refer_human | 深度解读、复杂关系、职业重大转型、团队/学校高风险 | 人工专家建议 |
| suggest_professional_help | 医学、心理、自伤、暴力、法律财务 | 专业帮助建议 |

## 4. 产品实现注意事项

- 流程必须先执行风险检测，再生成完整报告。
- 未成年人、班级、团队报告必须先确认授权和脱敏。
- 任何报告都必须带边界说明和置信度。
- 用户目的变化时，需要重新选择模板。
- 生成内容可沉淀为知识卡前必须人工或规则脱敏。

