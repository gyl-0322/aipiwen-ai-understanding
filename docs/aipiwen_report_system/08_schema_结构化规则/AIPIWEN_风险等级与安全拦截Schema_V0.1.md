# AIPIWEN 风险等级与安全拦截 Schema V0.1

## 1. 风险等级

| risk_level | 定义 | 允许输出 | 系统动作 |
| --- | --- | --- | --- |
| R0 | 普通低风险 | 正常结构化报告和行动建议 | allow |
| R1 | 轻度敏感，需要温和表达 | 倾向性解释、安全改写、低标签建议 | rewrite |
| R2 | 高敏感，需要安全降级 | 只输出观察方向、边界说明、补充信息 | limit / refer_human |
| R3 | 禁止 AI 直接输出 | 不输出结论，只做安全提示或建议专业帮助 | refuse / suggest_professional_help / refer_human |

## 2. 系统动作枚举

| action | 含义 |
| --- | --- |
| allow | 允许按模板输出 |
| rewrite | 安全改写后输出 |
| limit | 限制为安全降级版 |
| refuse | 拒绝直接回答风险结论 |
| refer_human | 建议人工专家解读 |
| suggest_professional_help | 建议医疗、心理、法律、财务等专业支持 |

## 3. 风险类型拦截表

| risk_type | 触发词或触发场景 | 风险等级 | 禁止表达 | 安全替代表达 | 系统动作 |
| --- | --- | --- | --- | --- | --- |
| medical_diagnosis | ADHD、疾病、障碍、脑功能异常、健康风险 | R3 | “报告说明你有某疾病” | “健康和医学问题应以专业医疗评估为准，本报告只能作理解参考” | refuse / suggest_professional_help |
| mental_health | 抑郁、焦虑、心理疾病、人格问题 | R3 | “你是抑郁体质 / 心理有问题” | “如果长期影响睡眠、学习、情绪或生活，建议寻求专业评估” | refuse / suggest_professional_help |
| self_harm | 自伤、自杀、想死、暴力倾向、伤害他人 | R3 | “这是某指标导致的” | “这已经超出报告解读范围，请优先联系可信成年人或专业危机支持” | refuse / suggest_professional_help |
| child_labeling | 问题孩子、叛逆、懒、不努力、白眼狼 | R2 | “孩子就是懒 / 有问题” | “这个行为需要结合年龄、环境和互动方式理解” | rewrite / limit |
| relationship_determinism | 合不合、必然分开、婚姻一定有问题 | R2 | “你们不合适 / 注定冲突” | “你们在某些场景下更容易发生误解，需要具体沟通翻译” | rewrite / refer_human |
| career_determinism | 一定适合、不适合、马上辞职、职业命定 | R2 | “你一定适合某职业” | “可以先用小比例时间验证新方向” | rewrite / limit |
| school_admission_promise | 升学保证、成绩承诺、录取预测 | R3 | “按这个方法一定提分 / 能上某学校” | “只能提供学习方式和支持建议，不承诺升学结果” | refuse / limit |
| fortune_telling | 天命、前世、命中注定、生命密码、命运轨迹 | R3 | “这是你的命” | “可理解为长期偏好、行为模式或关系节奏” | refuse / rewrite |
| legal_financial_claim | 离婚、股权、投资、赔偿、重大财务建议 | R3 | “应该离婚 / 投资 / 放弃股权” | “法律和财务问题需要专业顾问，本报告只辅助沟通和决策准备” | refuse / suggest_professional_help |
| privacy_sensitive | 身份证、电话、学校、住址、未脱敏案例 | R2 | 直接展示隐私细节 | “先脱敏后再用于报告或案例沉淀” | limit |
| minor_data | 未成年人报告、班级资料、监护人授权不明 | R2/R3 | 未授权深度输出或传播 | “需要监护人授权，并限制用途和可见范围” | limit / refuse |
| team_elimination_risk | 淘汰、筛人、风险员工、谁拖后腿 | R3 | “某成员不适合留在团队” | “用于协作机制优化，不作为招聘淘汰依据” | refuse / refer_human |
| discrimination_risk | 按性别、年龄、疾病、人格、学习方式做优劣判断 | R3 | “这类人能力差” | “差异只用于支持策略，不用于优劣排序” | refuse / rewrite |

## 4. 风险决策规则

- 同时命中多个风险时，取最高风险等级。
- 只要命中 R3，普通报告模板停止，进入拒绝、专业帮助或人工专家路径。
- R2 不能输出完整结论，只能输出安全降级版或建议人工复核。
- R1 必须做安全改写，禁止原始高风险词直接出现。
- 未成年人、学校、团队数据默认风险等级至少 R1；授权不明时至少 R2。

