# AIPIWEN 置信度与降级输出 Schema V0.1

## 1. 置信度等级

| confidence_level | 判断条件 | 输出策略 | 禁止输出 |
| --- | --- | --- | --- |
| high | 报告完整、核心指标齐全、用户问题明确、风险为 R0/R1、场景信息足够 | 可以输出结构化建议、模板完整章节、行动计划 | 绝对化、诊断、命运判断 |
| medium | 报告基本可读但缺少部分指标，或场景信息不够完整，风险不超过 R1 | 输出倾向性解释 + 建议补充信息 | 写成确定结论 |
| low | 报告缺失较多、只看到截图/口述、多人关系资料不完整、用户问题模糊 | 只输出观察方向 + 温和追问 | 完整报告、关系结论、职业定论 |
| insufficient | 无法识别资料、缺关键授权、风险过高、信息矛盾严重 | 不做判断，只说明缺少信息并追问或转人工 | 任何实质性结论 |

## 2. 判断依据

| 维度 | high | medium | low | insufficient |
| --- | --- | --- | --- | --- |
| 报告完整度 | complete | partial 但核心指标可读 | partial 且核心指标缺失 | unreadable / unknown |
| 指标齐全度 | TRC、ATD、性格、学习通道、行为模式、五大功能区基本齐全 | 缺 1-2 类关键指标 | 只识别少量指标 | 无法识别指标 |
| 用户问题 | 明确 | 大致明确 | 模糊 | 无问题且无法追问 |
| 多人关系 | 双方 / 多方资料齐全 | 部分资料缺失 | 只有一方资料 | 无法确认关系或授权 |
| 未成年人 | 有年龄、监护人授权、场景明确 | 年龄或场景部分缺失 | 授权不清或场景敏感 | 涉及高风险心理/安全 |
| 心理/医学/升学/职业重大决策 | 无 | 轻度相关 | 明显相关但未到危机 | 命中 R3 |
| 场景信息 | 具体 | 部分具体 | 很少 | 矛盾或缺失 |
| 矛盾信息 | 无 | 可标注 | 明显矛盾 | 矛盾到无法判断 |

## 3. 降级输出策略

| 原置信度 | 降级触发 | 输出方式 |
| --- | --- | --- |
| high -> medium | 缺少用户具体场景、用户要求过深 | 保留指标解释，减少行动断言 |
| medium -> low | 多人资料不全、关键指标缺失、授权不明确 | 输出观察方向和补充资料清单 |
| low -> insufficient | 资料不可读、用户拒绝补充、风险升高 | 停止判断，只追问或提示边界 |
| any -> insufficient | 命中 R3 或专业领域风险 | 转人工或建议专业帮助 |

## 4. 不同置信度输出模板

### high

可输出：

- “基于当前报告和你提供的问题，可以先看到三个较稳定的倾向。”
- “下面建议可作为近期行动计划。”

必须保留：

- “仍需结合真实环境和阶段验证。”

### medium

可输出：

- “目前资料支持做倾向性解释，但还不适合下结论。”
- “如果补充某项指标或场景，判断会更稳。”

### low

可输出：

- “现在只能作为初步观察方向。”
- “我建议先补充这几个信息，再生成正式报告。”

### insufficient

可输出：

- “当前资料不足以生成报告。”
- “我需要先确认报告对象、年龄段、用户目的或授权情况。”

## 5. 置信度与模板关系

| confidence_level | 可用模板 |
| --- | --- |
| high | quick_read_report, individual_full_report, child_behavior_report, parent_child_report, intimate_relationship_report, partner_collaboration_report, team_collaboration_report, career_learning_report |
| medium | quick_read_report, child_behavior_report, career_learning_report, safety_limited_report |
| low | safety_limited_report, 行为观察方向, 单方关系模式参考 |
| insufficient | 追问、请求补充资料、转人工或专业帮助 |

