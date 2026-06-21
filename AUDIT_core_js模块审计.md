# 任务4：aipiwen-core.js 模块审计报告
> 生成时间：2026-06-20 | 文件大小：~3660行 | 审计方法：grep HTML调用，只审计不修改

---

## 一、模块清单（按调用状态分类）

### ✅ 实际被调用的模块（7个）

| 模块 | 行范围 | 行数 | 调用页面 | 职责 |
|------|--------|------|---------|------|
| `UserSystem` | 9-47 | 39行 | full-report / child-chat / light-report | 本地用户ID管理、localStorage存储 |
| `MemorySystem` | 48-137 | 90行 | full-report / child-chat | 行为记忆存储，getRecent() 取最近记录 |
| `AnalysisEngine` | 138-357 | 220行 | full-report / child-chat / light-report | 行为分析，生成 analysis 对象 |
| `ContentLibrary` | 586-1048 | 463行 | full-report / child-chat / light-report | 生成报告文案（lightReport / fullReport）|
| `TrendAnalyzer` | 509-585 | 77行 | full-report / light-report | 行为趋势分析 |
| `LeadSystem` | 1049-1120 | 72行 | full-report / child-chat | 线索存储、转化记录 |
| `TRCTypeLibrary` | 3347-3618 | 271行 | full-report（TRC类型卡片渲染）| 17种类型定义 + renderCard() |

**核心使用层共 7 个模块，约 1232 行（占文件 33%）**

---

### ⚠️ 仅在 admin.html 中被调用（2个，非核心产品路径）

| 模块 | 行范围 | 行数 | 调用位置 | 职责 |
|------|--------|------|---------|------|
| `RetentionAnalyzer` | 3186-3239 | 54行 | admin.html | 留存分析，供后台看板 |
| `BehaviorEngagementEngine` | 3240-3346 | 107行 | admin.html | 行为参与度分析，供后台看板 |

---

### ❌ 从未被任何 HTML 调用的模块（25个，约2100行）

这些模块均已导出到 `window.AIPIWEN`，但在所有 HTML 页面中均未找到 `AIPIWEN.{ModuleName}` 调用。

| 模块 | 行范围 | 行数 | 原设计意图 | 拆分风险 |
|------|--------|------|-----------|---------|
| `BehaviorReasoningEngine` | 358-508 | 151行 | 6层行为推理链（V2设计）| 中：可能是ContentLibrary内部依赖 |
| `ConsultingSessionStore` | 1121-1170 | 50行 | 咨询会话存储（V3-A）| 低 |
| `InformationSufficiencyEvaluator` | 1171-1233 | 63行 | 信息充分性评估（V3-A）| 低 |
| `AgentResponseGenerator` | 1234-1337 | 104行 | AI回复生成器（V3-A）| 低 |
| `ConsultingInsightEngine` | 1338-1447 | 110行 | 咨询洞察提取（V3-B）| 低 |
| `ContradictionDetector` | 1448-1507 | 60行 | 矛盾行为检测（V3-B）| 低 |
| `PriorityQuestionSelector` | 1508-1563 | 56行 | 优先提问选择（V3-B）| 低 |
| `ConsultingPathPlanner` | 1564-1630 | 67行 | 咨询路径规划（V3-B）| 低 |
| `BehaviorInterventionEngine` | 1631-1772 | 142行 | 行为干预方案生成（V3-C）| 低 |
| `FamilyDynamicTracker` | 1773-1851 | 79行 | 家庭动力追踪（V3-C）| 低 |
| `ConsultationFollowUpSystem` | 1852-1899 | 48行 | 咨询跟进系统（V3-C）| 低 |
| `BehaviorChangePlanGenerator` | 1900-1942 | 43行 | 行为改变计划生成（V3-C）| 低 |
| `AIPIWENConsultingAgent` | 1943-2507 | **565行** | 主AI咨询Agent调度（V3统一）| ⚠️ 高：内部集成多模块 |
| `RelationshipStructureEngine` | 2508-2557 | 50行 | 关系结构分析（V3-D）| 低 |
| `BehaviorPatternGraph` | 2558-2592 | 35行 | 行为模式图谱（V3-D）| 低 |
| `FamilyStructureAnalyzer` | 2593-2622 | 30行 | 家庭结构分析（V3-D）| 低 |
| `BehaviorGrowthEngine` | 2623-2664 | 42行 | 行为成长引擎（V4）| 低 |
| `BehaviorChangePlanner` | 2665-2719 | 55行 | 行为改变规划（V4）| 低 |
| `FeedbackLoopSystem` | 2720-2772 | 53行 | 反馈循环系统（V4）| 低 |
| `DailyInsightSystem` | 2773-2893 | 121行 | 日度洞察系统（产品层）| 低 |
| `WeeklyFamilyReport` | 2894-2966 | 73行 | 周度家庭报告（产品层）| 低 |
| `BehaviorHabitLoop` | 2967-3029 | 63行 | 行为习惯循环（产品层）| 低 |
| `FamilyProgressDashboard` | 3030-3101 | 72行 | 家庭成长看板（产品层）| 低 |
| `ProductLayer` | 3102-3130 | 29行 | 产品转化触发层（产品层）| 低 |
| `ProductAnalyticsTracker` | 3131-3185 | 55行 | 产品分析追踪（产品层）| 低 |

**未调用模块合计：约 2100 行，占文件 57%**

---

## 二、TRCTypeLibrary 与知识库重复分析

`TRCTypeLibrary`（第3347-3618行）包含17种类型的展示数据，与 `lib/trc-knowledge-base.js` 存在数据重复：

| 字段 | TRCTypeLibrary | trc-knowledge-base.js | 是否重复 |
|------|---------------|----------------------|---------|
| 类型名称 | ✅ 有 | ✅ 有 | 🔴 重复 |
| 核心天赋描述 | ✅ 有 | ✅ 有 | 🔴 重复（可能不同步）|
| renderCard() | ✅ 有 | ✅ 有 | 🔴 重复 |
| 科学引用 | ❌ 无 | ✅ 有 | - |
| 指纹溯源 | ❌ 无 | ✅ 有 | - |
| fingerprint_key 映射 | ❌ 无 | ❌ 无 | 共同缺失 |

---

## 三、模块版本层级关系

```
V1（基础行为分析）：UserSystem + MemorySystem + AnalysisEngine + ContentLibrary + TrendAnalyzer + LeadSystem
    ↓ 被 HTML 页面调用 ✅

V2（深度推理）：BehaviorReasoningEngine
    ↓ 从未被 HTML 调用 ❌

V3-A（咨询Agent）：ConsultingSessionStore + InformationSufficiencyEvaluator + AgentResponseGenerator
V3-B（洞察层）：ConsultingInsightEngine + ContradictionDetector + PriorityQuestionSelector + ConsultingPathPlanner
V3-C（干预层）：BehaviorInterventionEngine + FamilyDynamicTracker + ConsultationFollowUpSystem + BehaviorChangePlanGenerator
V3-D（关系OS）：RelationshipStructureEngine + BehaviorPatternGraph + FamilyStructureAnalyzer
V3（统一入口）：AIPIWENConsultingAgent（565行）
    ↓ 所有 V3 模块均从未被 HTML 调用 ❌
    
V4（行为成长）：BehaviorGrowthEngine + BehaviorChangePlanner + FeedbackLoopSystem
    ↓ 从未被 HTML 调用 ❌

产品层：DailyInsightSystem + WeeklyFamilyReport + BehaviorHabitLoop + FamilyProgressDashboard + ProductLayer
留存层：ProductAnalyticsTracker + RetentionAnalyzer + BehaviorEngagementEngine
    ↓ 产品层从未被调用 ❌，留存层仅 admin.html 调用

V5（TRC知识）：TRCTypeLibrary
    ↓ 被 full-report.html 调用 ✅，但与 trc-knowledge-base.js 重复
```

---

## 四、拆分路线建议（本阶段只规划，不执行）

### 阶段一：提取可独立的知识模块（低风险）
```
js/aipiwen-core.js → TRCTypeLibrary 部分
    改为引用 lib/trc-knowledge-base.js
    （TRCTypeLibrary 本身可保留作薄包装层）
```

### 阶段二：将 V3-V4 未使用模块移入独立文件（中风险）
```
js/aipiwen-consulting-agent.js  ← AIPIWENConsultingAgent + V3 全部模块
js/aipiwen-growth-system.js     ← V4 + 产品层 + 留存层
```
- 条件：需要在对应HTML中按需引入，不破坏 window.AIPIWEN 导出

### 阶段三：瘦身 core.js（高风险，需大量测试）
```
目标：core.js 只保留 V1 + TRCTypeLibrary 薄层
约 1300 行（当前 3660 行的 35%）
```

---

## 五、结论

| 状态 | 模块数 | 行数 | 占比 |
|------|--------|------|------|
| 被产品页面实际调用 | 7个 | ~1232行 | 33% |
| 仅 admin 调用 | 2个 | ~161行 | 4% |
| 完全未被调用 | 25个 | ~2100行 | 57% |
| 其他（工具函数等） | - | ~167行 | 6% |

**当前 aipiwen-core.js 有约 57% 的代码是"为未来设计的功能"，尚未被任何前端页面使用。**

这不是坏事（代表了系统的未来设计方向），但在维护阶段需要清楚区分"当前运行中的代码"和"待激活的设计代码"。

---

*本报告为纯审计输出，未修改任何代码*
