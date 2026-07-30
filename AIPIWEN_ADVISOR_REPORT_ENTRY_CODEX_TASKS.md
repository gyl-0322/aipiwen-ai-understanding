# 指导师录入报告 · Codex 后续实施任务书 V1.1

**当前状态**：Phase A 已由 Codex 修正，等待 Claude Review。
**当前授权边界**：禁止执行 migration、禁止 deploy、禁止前端实施。

---

## 1. Phase A Review 输入

Claude 应审核：

- `supabase/migrations/020_v3a_advisor_client_tables.sql`
- `api/v3a-customers.js`
- `api/v3a-report-import.js`
- `scripts/test-v3a-advisor-report-import.js`
- `scripts/test-vercel-function-budget.js`
- `AIPIWEN_ADVISOR_REPORT_ENTRY_TECH_DESIGN.md`

本地证据：

- 专项真实检查：83项 PASS；
- Vercel Function Budget：12/12 PASS；
- Node Check：PASS；
- 一次性本地 PostgreSQL 完整 migration 020 演练：PASS，临时数据库已销毁；
- SQL 尚未执行；
- Preview/Production 均未部署。

---

## 2. Claude Review 前禁止事项

- 不执行 Preview migration 020；
- 不执行任何 Production migration；
- 不部署 Preview 或 Production；
- 不创建 `ai-interpreter-report-entry.html`；
- 不修改六个工作台页面导航；
- 不修改“我的客户”前端；
- 不新增 Serverless Function（当前已经 12/12）。

---

## 3. Claude PASS 后仍需单独授权

Claude Review PASS 不自动授权执行。负责人还需分别授权：

1. Preview migration 020；
2. Preview API deploy；
3. 前端实施；
4. Preview 端到端验收。

Production migration 和 Production deploy 必须在后续 Sprint 单独授权。

---

## 4. 后续 Phase B（暂不执行）

### B1. Preview migration

只允许在确认 Preview Supabase 项目后执行完整 migration 020。不得拆段执行。事务中的 preflight 或 postflight 失败时必须保留回滚结果并停止。

### B2. Preview API deploy

部署后验证：

- 未登录请求返回 401；
- pending/机构账号返回 403；
- GET 不要求 CSRF；
- POST 缺少 Origin/CSRF 时返回拒绝；
- 指导师 A 不能读取指导师 B 的客户或报告；
- 浏览器请求中没有 `advisor_id`；
- 错误日志不含姓名、原图、Cookie、Session、Token 或 Secret。

### B3. 前端页面

创建 `ai-interpreter-report-entry.html`，五步流程：

1. 选择已有客户或新建客户；
2. 上传 JPEG/PNG，最大 2.5MB；
3. 编辑并人工确认十指、TRC、ATD；
4. 选择首期 allowlist 报告类型和1-4个问题；
5. 使用浏览器 `crypto.randomUUID()` 生成一次性的 `idempotencyKey`，确认入库并生成报告。

前端 POST 必须：

- `credentials: 'same-origin'`；
- `X-CSRF-Token` 使用 `/api/v3a-session?action=me` 返回的 token；
- confirm 发送 `dataConfirmed: true`；
- 不发送 `advisor_id` / `advisorId`；
- 网络重试复用原 `idempotencyKey`，不能重新生成。

### B4. 导航和客户页

Claude Review 和前端实施授权后，才允许：

- 六个工作台页面在“我的客户”和“AI解读助手”之间增加“录入报告”；
- “我的客户”标题区增加“录入报告”按钮；
- 真实客户与两条学习示例保持分区，不混入真实统计。

---

## 5. Phase C Preview 验收（暂不执行）

- 新客户上传 → OCR → 人工修正 → ready；
- 已有客户追加报告；
- 双击提交只产生一个客户和一个报告；
- 同 key、不同 payload 被拒绝；
- failed 使用原 key 重试；
- 指导师 A/B 越权测试；
- pending、agent、center 权限测试；
- 示例与真实客户分区；
- 日志脱敏与测试记录清理。

完成后生成独立 Preview 验收报告，再决定是否进入 Production Release Sprint。
