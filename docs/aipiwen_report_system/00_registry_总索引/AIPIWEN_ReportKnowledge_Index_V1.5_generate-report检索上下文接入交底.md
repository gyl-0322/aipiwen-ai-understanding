# AIPIWEN Report Knowledge Index V1.5 generate-report 检索上下文接入交底

状态：后台生成链路增强  
日期：2026-07-07  
范围：只把 V1.4 检索命中结果接入 `api/generate-report.js` 的模型提示词上下文，不修改网站结构、不修改报告页面、不修改 PDF、不修改支付、不部署。

## 1. 本轮定位

V1.5 的目标不是新建报告结构，也不是直接读取 Obsidian 原文。

它做的是：

```text
用户上传报告 / 选择问题
→ 生成报告前
→ 调用 Report Knowledge Index V1.4 检索层
→ 生成可给模型参考的知识上下文
→ 注入 user message
→ 模型仍按原固定报告结构输出
```

也就是说，V1.5 让现有报告生成链路开始真实使用后台知识索引，但仍保持原报告结构、原 API 入口、原页面不变。

## 2. 接入位置

接入文件：

`api/generate-report.js`

接入点：

```text
engineResult / age / selectedIssues / fingers
→ buildReportKnowledgeContextInput(...)
→ buildReportKnowledgePromptContext(...)
→ buildUserMessage(..., knowledgeContext)
→ qwen-plus 生成报告
```

## 3. 新增上下文组装能力

核心库文件：

`lib/report-knowledge-index.js`

新增函数：

```js
buildReportKnowledgePromptContext(input, options)
```

作用：

- 调用 `buildReportKnowledgeRetrievalDryRun`
- 收集可用于自动输出的知识卡
- 收集只用于风险护栏的知识卡
- 生成两个安全文本块：
  - `reportKnowledgeBlock`
  - `riskKnowledgeBlock`

## 4. generate-report 输入如何进入检索

V1.5 会从正式报告请求中抽取：

- age
- age tier
- selectedIssues
- customUserQuestion / extraQuestion
- requiredModules
- 主性格类型
- 学习通道
- 行为模式
- TRC 均值与总量
- ATD
- 五大功能区
- 十指单指数据

然后映射成 V1.4 检索输入。

## 5. 五大功能区接入规则

V1.5 继续遵守 V1.4 规则：

```text
精神功能：右拇 / 左拇分别检索
思维功能：右食 / 左食分别检索
体觉功能：右中 / 左中分别检索
听觉功能：右无名 / 左无名分别检索
视觉功能：右小 / 左小分别检索
```

每根手指会转换为：

```text
数值 + 高于/低于/接近个人均值 + 差值
```

用于召回对应知识卡。

这一步的目的，是防止报告再把两根手指合计后与单指个人均值比较。

## 6. 风险护栏接入规则

V1.5 将检索结果分成两类。

### 6.1 可进入报告生成参考

状态：

- `auto_safe`
- `rewrite_required`

使用方式：

- 可作为模型写报告时的事实底座。
- 必须自然融入。
- 不展示知识卡 id。
- 不展示来源路径。
- 不照搬原文。
- 不输出禁用表达。

### 6.2 只用于安全边界

状态：

- `human_only`
- `blocked`

使用方式：

- 只能用于降级、禁用、转人工判断。
- 不得作为普通报告结论输出。
- 不得写成诊断、保证、关系去留、筛选建议。

## 7. 三层回退策略

V1.5 明确保持可回退。

### 第一层：V1.5 分阶段检索上下文

优先使用：

```js
buildReportKnowledgePromptContext(...)
```

### 第二层：旧版单查询知识索引

如果 V1.5 出错，回退到原有：

```js
searchReportKnowledge(...)
buildReportGroundingBlock(...)
buildRiskKnowledgeBlock(...)
```

### 第三层：完全不注入知识块

如果旧版检索也失败：

```text
继续使用原有 SYSTEM_PROMPT + 硬编码规则 + engineResult + selectedIssues 生成报告
```

因此，知识索引失败不会导致用户生成报告报错。

## 8. 本轮测试

执行：

```bash
node --check api/generate-report.js
node --check lib/report-knowledge-index.js
node --check scripts/test-report-knowledge-index.js
node scripts/test-report-knowledge-index.js
```

结果：

```json
{
  "ok": true,
  "totalEntries": 90,
  "sampleGroundingItems": 6,
  "dryRunStages": 5,
  "dryRunUniqueHits": 19,
  "promptContextHits": 17
}
```

## 9. 测试覆盖

本轮测试确认：

1. V1.5 能生成 `reportKnowledgeBlock`。
2. V1.5 能生成 `riskKnowledgeBlock`。
3. 初中样本能命中年龄阶段知识卡。
4. 五大功能区能命中单指知识卡。
5. 高风险样本能命中风险护栏。
6. prompt context 不暴露本地路径。
7. prompt context 不暴露原始转写稿文件名。

## 10. 本轮没有做什么

本轮没有：

- 修改 `report-upload.html`
- 修改 `report-viewer.html`
- 修改首页
- 修改 PDF 下载
- 修改支付逻辑
- 修改 `vercel.json`
- 修改报告结构
- 接真实 Obsidian 在线检索
- 接真实 AI 之外的新模型
- 写数据库
- 部署

## 11. 与 Obsidian 的关系

当前仍不是“运行时直接读取 Obsidian 原文”。

当前链路是：

```text
Obsidian / Report OS / 录音资料 / 表达库
→ 人工整理为 Report Knowledge Index 知识卡
→ generate-report 运行时检索知识卡
→ 知识卡作为模型上下文
```

这样做的原因：

- 节省 token。
- 避免每次读取大量原文。
- 避免把未清洗原文直接暴露给前台。
- 可以区分可自动输出、需安全改写、仅人工参考、禁用。

后续如要接“真实 Obsidian 在线检索”，也应先经过知识卡准入和安全分级，而不是直接把原文塞进生成报告。

## 12. 下一步建议

下一步建议做：

### V1.6：报告内容质量回归测试

重点检查：

- 性格类型页是否足够丰富。
- 固定模块是否还像“是什么 / 意味着什么 / 怎么应用”的八股文。
- 五大功能区是否按单指逻辑讲清楚。
- 用户四问是否真的差异化。
- 成人报告是否不再出现孩子称谓。
- 高风险问题是否只做降级/转人工。

### V1.7：小样本线上前 dry-run 对照

用同一份 engineResult，换不同年龄、不同四问，确认输出确实变化。

## 13. 结论

Report Knowledge Index V1.5 已经把检索结果接入正式报告生成前的上下文。

当前结论：

- 知识索引已经不只是静态文档。
- `generate-report` 已经会在生成前尝试检索知识卡。
- 检索失败不会阻断报告生成。
- 网站结构、页面、PDF、支付均未改动。

