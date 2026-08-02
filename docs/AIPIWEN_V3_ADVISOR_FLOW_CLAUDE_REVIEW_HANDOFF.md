# AIPIWEN V3.0 指导师流程修复 · Claude 只读审核交底

冻结时间：2026-08-01  
审核类型：只读增量审核  
当前状态：**CANDIDATE / NOT DEPLOYED**

## 1. 审核目标

请审核本候选相对当前 Production 可追溯基线 `f84e2b8f9917c03a13445f70aa450ee240900450` 的两组修复：

1. 报告生成完整性：避免模型输出被截断后仍作为成功报告展示；
2. 指导师业务流程：按钮目标、代客户上传、真实客户解读、自动生成方案、列表搜索/筛选/排序。

当前 Production Deployment：`dpl_5Ru6WAX6qBe4N23xzJxAJa8YgDWq`。六个指导师页面和归属脚本的公开文件哈希均可追溯到上述 Git 基线。

## 2. 产品链路冻结

### 2.1 客户扫码上传（保持）

客户扫码 → 公开 `report-upload.html?token=...` → OCR → 客户可见报告 → 进入指导师客户列表 → `source=advisor_qr`。

### 2.2 指导师代客户上传（修复）

指导师“我的客户” → 代客户上传报告 → 工作台内受保护面板 → OCR → 指导师确认客户、十指纹型与 TRC → 现有 `v3a-report-import` BFF → 客户/报告入库 → `source=advisor_import`。

该路径不得创建 attribution token，不得跳转客户公开报告页，不得由浏览器提交指导师 ID。

### 2.3 AI 解读（修复）

真实客户行只允许通过独立“开始解读”按钮进入，必须携带 `clientId + reportId`。首次进入且没有已有方案时自动生成；已有方案直接读取，不重复生成；指导师编辑后人工保存。

侧栏“AI解读助手”进入“我的客户”选择状态，不得打开无客户上下文的空页。学习示例行不伪装成真实可进入记录。

## 3. 精确候选文件

### 3.1 运行文件

- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-session.html`
- `ai-interpreter-training.html`
- `ai-interpreter-review.html`
- `ai-interpreter-cases.html`
- `static/v3a-attribution.js`
- `static/ai-interpreter.js`
- `static/ai-interpreter.css`
- `api/v3a-report-import.js`
- `server/v3a-interpretation.js`
- `api/_lib.js`
- `api/generate-report.js`
- `vercel.json`

### 3.2 数据库契约（仅供核对，不授权执行）

- `supabase/migrations/029_v3a_advisor_interpretation_data.sql`
- `supabase/tests/029_v3a_advisor_interpretation_data_test.sql`

Migration 029 已在此前授权阶段完成环境验证。本次候选不新增、不修改 migration，也不授权重新执行。

### 3.3 测试与报告

- `scripts/test-generate-report-completeness.js`
- `scripts/test-ai-interpreter-pages.js`
- `scripts/test-v3a-ai-interpretation-mvp.js`
- `scripts/test-v3a-advisor-navigation-controls.js`
- `scripts/test-v3a-advisor-report-import-ui.js`
- `scripts/test-v3a-advisor-report-import-ui-runtime.js`
- `scripts/test-v3a-advisor-report-import.js`
- `scripts/test-v3a-workbench-button-inventory.js`
- `docs/AIPIWEN_V3_ADVISOR_BUTTON_FLOW_AUDIT_REPORT.md`
- `docs/AIPIWEN_V3_END_TO_END_BUTTON_FLOW_TEST_REPORT.md`
- 本交底文件

## 4. 明确排除

候选不包含以下本地未关联变更：

- Growth Credit / Growth Snapshot；
- Memory Engine / V3.1；
- 订阅、支付、充值；
- Organization 新模型；
- Auth、Session、SMS、环境变量修改；
- Supabase schema 新变更；
- 用户、客户、报告、积分、邀请码、KV 数据清理。

特别说明：`api/v3a-attribution.js` 当前工作区含 Growth Snapshot 未审核改动，因此不进入候选；候选继续使用基线版本。`static/v3a-attribution.js` 只承载本次客户列表和代传前端修复，必须进入候选。

`ai-interpreter-workbench.html` 与 `static/ai-interpreter.css` 的工作区版本也含 Growth Snapshot 展示代码。最终候选包没有携带这些片段：工作台页面只保留本次侧栏目标修复和学习示例去伪跳转，样式只保留代传面板及独立“开始解读”按钮所需内容。**最终 ZIP 内容是本次审核的唯一候选，不应直接审核或部署当前脏工作区。**

## 5. 重点审核清单

1. 报告完整性检查是否会将缺模块、缺 `===END===`、`finish_reason=length` 的输出安全降级，而不是展示半截正文；
2. 分组生成 12 个模块时是否维持现有报告结构与客户公开页兼容；
3. 代传是否严格使用 Session、SameOrigin、CSRF，并从 Session 推导指导师；
4. 浏览器是否从未提交 `advisor_id`；
5. 上传文件是否限制为 JPG/PNG 且不超过 2.5MB；
6. OCR 结果是否必须由指导师确认后才能入库；
7. 代传是否不会创建 attribution token，不会进入公开报告页；
8. 真实客户整行是否不可点击，独立按钮是否准确携带客户/报告标识；
9. 无上下文入口是否 fail closed；
10. 首次自动生成、已有方案复用、编辑保存是否符合幂等与权限边界；
11. 搜索、状态筛选、三种排序是否只使用接口实际返回的数据；
12. 学习示例是否不再伪装为真实业务记录；
13. Function Budget 是否仍为 12/12；
14. 是否存在秘密、Token、OTP、Cookie、Session、客户隐私日志泄露；
15. 是否夹带第 4 节明确排除的文件或功能。

## 6. 精确候选复测

- 从最终 ZIP 使用 macOS `ditto` 解压后，25 个安全测试脚本：25/25 PASS；
- Report Import：93 项 PASS；
- 代传前端真实脚本隔离 DOM 分支：24/24 PASS；
- 工作台按钮登记：19/19 PASS；
- Attribution：68 项 PASS；
- Attribution Hardening：16 项 PASS；
- Service Code：41 项 PASS；
- Service Code Runtime：15 项 PASS；
- Privacy：3 项 PASS；
- AI Interpretation MVP：PASS；
- 6 个运行 JS 文件 `node --check`：6/6 PASS；
- Vercel Function Budget：12/12 PASS。
- ZIP 完整性：PASS；
- 包内 `.env`、`.vercel`、`.git`、`node_modules`、缓存：0；
- 秘密模式扫描：仅命中仓库基线中明确带 `test` 标记的合成测试常量，未发现环境密钥文件或真实凭据；
- Growth Snapshot、Memory Engine、订阅/支付关键词范围检查：PASS（未进入候选）。

测试复用现有工作区已安装的 Node 依赖目录；依赖缓存没有复制进 ZIP。为避免在 Claude Review 前把 Preview 环境变量下载到临时目录，最终候选没有再次执行本地 `vercel build`。此前相同运行代码的 Preview Build 已 PASS；本候选在 Claude PASS 后、Preview deploy 前仍须执行云端或不落地密钥的 Build Gate。

## 7. Claude 输出要求

请输出：

1. 结论：PASS / PASS WITH CONDITIONS / FAIL；
2. P0/P1/P2 问题列表，带文件和证据；
3. 报告完整性修复结论；
4. 代客户上传安全与数据归属结论；
5. 按钮目标和无效入口结论；
6. AI 解读自动生成/复用/保存结论；
7. 是否批准进入 Preview Deploy；
8. Preview E2E 必测清单。

Claude PASS 前禁止 Preview deploy；本轮始终禁止 Production deploy。
