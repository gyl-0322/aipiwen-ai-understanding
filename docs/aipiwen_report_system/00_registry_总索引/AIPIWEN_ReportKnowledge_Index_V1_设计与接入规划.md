# AIPIWEN Report Knowledge Index V1 设计与接入规划

## 1. 当前结论

当前线上/本地正式报告生成链路尚未真正接入 Obsidian 知识库。

已确认：

- `/api/generate-report` 主要依赖内置系统提示词、报告结构数据、用户选择问题和硬编码规则。
- `/api/generate-report` 没有调用 `/api/knowledge`。
- `/api/generate-report` 没有调用 `searchKnowledge`。
- `/api/generate-report` 没有读取 Obsidian 原始文件。
- 当前只有 `guest-chat.js` 对话链路存在 `/api/knowledge?action=search` 的知识片段检索。

因此，过去“报告输出要调用 Obsidian/现场解读资料”的目标，在正式报告生成链路中尚未完成。

## 2. V1 处理原则

Report Knowledge Index V1 的目标不是把 Obsidian 全量导入生产报告，也不是让模型自由读取原始课程。

正确方式是：

1. 先把老师现场解读、Report OS 表达库、Obsidian/专家课程候选内容整理为结构化索引。
2. 每条索引必须标注来源、模块、场景、关键词、安全等级和禁用表达。
3. 用户上传报告后，先根据报告数据和用户问题检索索引。
4. 只把命中的少量安全知识卡作为报告生成事实底座。
5. 不向用户展示内部来源路径、课程名称或原文。
6. 不让中高风险原文直接进入前台输出。

核心目标：

- 让报告不再凭空生成。
- 让报告调用真实现场解读和知识库资产。
- 节省 token，只注入命中的 3-8 条知识卡。
- 保留 AIPIWEN 专业来源感，但不把来源标签暴露给用户。

## 3. 本轮已新增资产

### 3.1 索引数据

路径：

`data/report-knowledge-index/report-knowledge-index-v1.json`

内容：

- 12 条第一版报告知识索引。
- 覆盖写作业拖拉、容易生气、报告不像、不主动学习、被催就炸、怕难不自信、不爱阅读、报告线索保留、心理/医学边界、关系去留边界、企业/学校筛选边界、人工解读承接。
- 每条包含：
  - `id`
  - `title`
  - `status`
  - `modules`
  - `scenarios`
  - `ageBands`
  - `retrievalKeywords`
  - `sourceRefs`
  - `safeGrounding`
  - `outputGuidance`
  - `doNotUse`

### 3.2 本地检索器

路径：

`lib/report-knowledge-index.js`

能力：

- 加载 Report Knowledge Index JSON。
- 根据用户问题、场景、模块关键词做本地检索。
- 按 `auto_safe` / `rewrite_required` / `human_only` / `blocked` 分级过滤。
- 生成给报告 Prompt 使用的 grounding block。
- grounding block 不暴露本地路径、不暴露原始转写稿路径、不暴露 Obsidian 原文路径。

### 3.3 验证脚本

路径：

`scripts/test-report-knowledge-index.js`

验证：

- 写作业拖拉命中 `RKI-V1-001`。
- 容易生气命中 `RKI-V1-002`。
- 报告不像命中 `RKI-V1-003`。
- 不主动学习命中 `RKI-V1-004`。
- 被催就炸命中 `RKI-V1-005`。
- 怕难不自信命中 `RKI-V1-006`。
- 不爱阅读命中 `RKI-V1-007`。
- 皮纹/报告线索命中 `RKI-V1-008`。
- 心理/医学条目不进入自动输出，但可作为风险 grounding。
- 企业/学校筛选条目可被检索用于安全拦截。
- grounding block 不暴露本地绝对路径和原始来源路径。

### 3.4 代码内置语料入 Obsidian

2026-07-05 已将 `api/generate-report.js` 中原本只存在于代码里的关键语料，归档到 Obsidian：

目录：

`/Users/gyl0322gmail.com/AI-CEO-System/AI-CEO-Vault/知识库/自建系统/AIPIWEN_Report_OS/`

新增 Obsidian 知识卡：

| 文件 | 入库内容 |
|---|---|
| `AIPIWEN_正式报告生成链路总索引.md` | 记录正式报告生成链路总览 |
| `AIPIWEN_generate-report_SYSTEM_PROMPT_知识卡.md` | 沐海星辰语言底座、四大前提、输出规则、安全边界 |
| `AIPIWEN_generate-report_硬编码规则_知识卡.md` | 十大能力、五功能区、RULE-F04、RULE-N14、年龄段模块 |
| `AIPIWEN_generate-report_engineResult_selectedIssues_输入契约.md` | engineResult、fingers、selectedIssues 的输入契约 |
| `AIPIWEN_ReportKnowledgeIndex_统一接入说明.md` | Obsidian、Report OS、代码生成链路的统一方式 |

同时已将这些 Obsidian 知识卡登记进 `report-knowledge-index-v1.json`：

- `RKI-V1-013`：正式报告语言底座。
- `RKI-V1-014`：正式报告硬编码规则底座。
- `RKI-V1-015`：正式报告输入契约。

这些条目默认用于 grounding 和结构约束，不把 `SYSTEM_PROMPT`、`RULE_F04`、`ABILITY_MAP` 等内部术语直接展示给用户。

2026-07-05 追加：

`RKI-V1-015` 已从“issue 四段式”更新为“issue 四要素自然表达”：

- 内部仍保留 ①②③④ 解析锚点，保证机制解释、具体做法、积极意义、继续观察不缺失。
- 前台标题不再固定写“为什么 / 怎么办 / 未来趋势 / 还想深聊”。
- Web 与 PDF 输出应根据问题类型生成更自然的标题，减少八股感。

## 4. 安全等级定义

| status | 含义 | 是否可自动进入报告 | 用途 |
|---|---|---|---|
| `auto_safe` | 已经过 Report OS 安全改写，可用于前台输出 | 是 | 自动报告、快速读懂、家长共鸣表达 |
| `rewrite_required` | 可作为素材，但需要再改写 | 暂不直接输出 | Prompt grounding 或人工改写 |
| `human_only` | 只用于人工复核或降级判断 | 否 | 心理、医学、关系去留等风险场景 |
| `blocked` | 只用于阻断和禁用判断 | 否 | 招聘、分班、筛选、淘汰等禁用场景 |

## 5. 与 7 大报告模块的关系

Report Knowledge Index V1 不改变报告结构，只给结构提供内容底座。

对应关系：

| 报告模块 | 索引用途 |
|---|---|
| TRC | 后续补充认知容量、吸收节奏、学习负荷表达 |
| ATD | 已可支持反应节奏、启动速度、压力反应场景 |
| 左右脑 | 后续补充信息处理、理性/感性权重表达 |
| 性格类型 | 后续补充行为画面、学习影响、人际影响表达 |
| 学习通道 | 已可支持阅读、学习方式、输入方式相关场景 |
| 行为模式 | 已可支持拖拉、顶嘴、怕难、情绪反应、被催就炸 |
| 五大功能区 | 已保留报告线索和功能区接入方向，后续需拆精神/思维/体觉/听觉/视觉五类独立索引 |

后续要继续扩展：

- 精神功能：右拇、左拇对应目标感、主导、管理、自我控制。
- 思维功能：右食、左食对应逻辑、推理、空间、创意。
- 体觉功能：右中、左中对应精细操作、大运动律动。
- 听觉功能：右无名、左无名对应语言表达、音感共鸣。
- 视觉功能：右小、左小对应观察辨识、图像审美。

每个功能区都应独立建立索引卡，而不是只写在一页里。

## 6. 推荐接入 `/api/generate-report` 的方式

下一步只建议做最小接入，不直接大改报告生成。

建议流程：

1. 从请求中取：
   - `engineResult`
   - `age`
   - `selectedIssues`
   - `fingers`
   - `name`
2. 构造检索 query：
   - 用户选择问题
   - 补充描述
   - 年龄段
   - 主性格类型
   - 学习通道
   - 需要解读的功能区
3. 调用：
   - `searchReportKnowledge(query, { topK: 6 })`
4. 自动报告只允许注入：
   - `auto_safe`
   - 必要时少量 `rewrite_required`，但必须让 Prompt 安全改写
5. `human_only` 和 `blocked` 不进入普通报告内容，只进入风险判断和降级提示。
6. 用 `buildReportGroundingBlock(results)` 生成 grounding block。
7. 把 grounding block 注入 `SYSTEM_PROMPT` 或 `userMessage` 的专门段落。

### 6.1 失败兜底规则

Report Knowledge Index 是报告生成增强层，不是生产硬依赖。

如果出现以下情况：

- 索引 JSON 读取失败。
- 索引格式异常。
- 检索器报错。
- grounding block 构造失败。
- Obsidian 侧知识卡路径不可用。

系统必须继续使用原有稳定链路生成报告：

```text
SYSTEM_PROMPT
+ 硬编码规则
+ engineResult
+ fingers
+ age
+ selectedIssues
→ 生成正式报告
```

也就是说：

- 知识索引命中时，报告更有来源、更精准。
- 知识索引失败时，不能让用户报告生成失败。
- 失败时不得暴露内部错误、路径或知识库状态给用户。
- 失败时只允许在服务端日志中记录 `report knowledge index skipped`。

当前 `api/generate-report.js` 已按此方式实现：`knowledgeContext` 默认为空对象，检索失败会被 `try/catch` 捕获，随后继续调用原有 `buildUserMessage(...)` 和模型生成流程。

禁止：

- 把 Obsidian 原文全文塞进 Prompt。
- 把本地路径展示给用户。
- 把老师录音原文直接输出。
- 把外部机构/课程标签展示在前台。
- 让 `human_only` 和 `blocked` 内容生成普通报告。

## 7. Token 节省方式

不采用“整库塞入 Prompt”。

采用：

1. 关键词/模块/场景初筛。
2. 只取 top 3-8 条。
3. 每条只注入：
   - 安全理解方式
   - 输出提示
   - 禁用表达
4. 不注入：
   - 原始转写全文
   - 课程全文
   - 长篇理论
   - 本地路径

这样每次报告只增加少量 grounding token，但能明显提升准确性和真实来源感。

## 8. 下一步执行建议

建议分三步：

### Step 1：提交索引资产

先提交本轮新增：

- `data/report-knowledge-index/report-knowledge-index-v1.json`
- `lib/report-knowledge-index.js`
- `scripts/test-report-knowledge-index.js`
- 本设计文档

### Step 2：只做 `/api/generate-report` 最小接入

在不动页面、不动 PDF、不改报告结构的前提下：

- 引入 `searchReportKnowledge`
- 在生成 Prompt 前检索
- 把 grounding block 注入
- 新增测试确认命中拖拉/情绪/报告不像/心理医学降级等场景

### Step 3：扩展五大功能区索引

按用户最新报告结构要求，继续补：

- 精神功能索引卡
- 思维功能索引卡
- 体觉功能索引卡
- 听觉功能索引卡
- 视觉功能索引卡

每个功能区必须拆成独立页面/模块内容，并标明对应两个手指、表现、高低值体现、优势与应用建议。

## 9. 当前边界

本轮不做：

- 不修改 `report-upload.html`。
- 不修改 `homepage.html`。
- 不修改 `vercel.json`。
- 不修改生产 API。
- 不部署。
- 不把 Obsidian 全量导入生产。
- 不让报告生成直接读取原始转写稿。

本轮完成的是：建立 Report Knowledge Index V1 的第一版数据资产、检索器和接入规划。
