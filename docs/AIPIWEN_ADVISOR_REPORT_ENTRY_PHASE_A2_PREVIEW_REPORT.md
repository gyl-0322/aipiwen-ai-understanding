# AIPIWEN Advisor Report Entry Phase A-2 Preview Report

## 0. 结论

- 状态：**STOPPED / NOT PASS**
- 停止条件：权限模型运行时不符合 Review（Stop Condition 3）。
- 已完成：Preview migration 020、数据库对象/静态授权核验、隔离 Preview API build/deploy、未登录 API smoke、已登录 Session 核验。
- 未完成：已登录客户查询契约、OCR → create RPC → generate-report → complete RPC、真实幂等、状态机完整验证。
- 边界确认：未连接或修改 Production；未执行 Production migration/deploy；未修改前端、Auth、BFF Session、积分或身份生命周期。

## 1. Migration 执行结果

- 目标：Preview Supabase 项目 `lmjriqncuopgxwyudfee`（`aipiwen-v3a-preview`）。
- Production 项目 `tysbwijizgebnrazxpvo` 未连接、未执行。
- 执行文件：`supabase/migrations/020_v3a_advisor_client_tables.sql`。
- 执行方式：Supabase Dashboard SQL Editor，全文件单事务执行。
- SQL Editor 结果：成功，未返回行。
- 表验证：`advisor_clients`、`advisor_reports` 均存在。
- RPC 验证：`v3a_create_advisor_report_import`、`v3a_complete_advisor_report_import` 均存在。
- RLS：两张表均已启用。
- 为排除 schema cache，额外在 Preview 执行一次 `NOTIFY pgrst, 'reload schema'`；该操作不修改表结构或业务数据。刷新后 API 仍返回相同错误，因此 cache 不是最终根因。

## 2. Preview 环境确认

- Supabase：仅 Preview，项目 ref 与页面 URL 一致。
- Vercel Project：`guo-yanling-s-projects/aipiwen-ai-understanding`。
- Git 基线：`70395c3f6422f439da27e3e70bfac203b2b1380d`。
- 部署类型：Preview；部署命令未使用 `--prod`。
- Preview Deployment ID：`dpl_2YBy56FZqD7Dk9dUneG4U3qwezR4`。
- Preview URL：`https://aipiwen-ai-understanding-nr89vhn5v-guo-yanling-s-projects.vercel.app`。
- 稳定 Preview Alias：`https://aipiwen-ai-understanding-gyl0322-8747-guo-yanling-s-projects.vercel.app`。
- 部署时间：2026-07-29 02:40:08 PDT。
- 部署状态：READY。
- 为使 Preview Session 使用已确认的 Preview Supabase，补充了缺失的 `V3A_SUPABASE_URL` Preview 环境变量；未读取或输出任何 secret，未修改 Production scope。

## 3. RPC 验证

静态 catalog 验证结果：

- `authenticated`：两个 RPC 均有 `EXECUTE`。
- `anon`：两个 RPC 均无 `EXECUTE`。
- `service_role`：两个 RPC 均无 `EXECUTE`。

真实 RPC 写入验证未执行。原因是已登录读取先触发权限模型运行时失败；按 Stop Condition 必须先停止，不能继续写入测试数据。

## 4. 权限验证

静态授权验证：

- `authenticated` 对 `advisor_clients` 无 `INSERT`。
- `authenticated` 对 `advisor_reports` 无 `INSERT`、无 `UPDATE`。
- 两张表的 RLS 已启用。
- RPC 的角色授权符合冻结设计。

运行时 RLS 验证：**FAIL**。

以 `authenticated` 角色和有效 Preview advisor claim 执行只读查询时，PostgreSQL 返回：

```text
42501: permission denied for function v3a_current_role
```

020 的读取 policy 调用了 `v3a_current_role()`（以及同组身份 helper），但现场 `authenticated` 角色没有所需 helper 执行权限，导致 `advisor_clients` / `advisor_reports` 无法经 RLS 正常读取。该问题属于权限设计修正范围，本 Sprint 未擅自修改。

## 5. API 测试

本地与部署门禁：

- Build：PASS。
- Node check：PASS。
- Phase A 契约测试：83 项 PASS。
- Vercel Function Budget：12/12 PASS。
- 仓库 15 个 JS 测试脚本：PASS。

未登录 smoke：

- `GET /api/v3a-customers`：401 `UNAUTHENTICATED`，PASS。
- 带 `advisor_id` 查询参数的未登录请求：仍为 401，未绕过 Session，PASS。
- 报告状态 GET：401，PASS。
- 正确 Origin、无 Session 的 POST：401，PASS。
- 缺失 Origin 的 POST：403，PASS。

已登录 smoke：

- `GET /api/v3a-session?action=me`：200；Session 与 CSRF token 存在，PASS。
- `GET /api/v3a-customers`：502 `DATA_UPSTREAM_ERROR`，FAIL。
- 带 `advisor_id` 查询参数的已登录客户请求：同样 502；因为读取层先失败，无法完成“参数被忽略且结果一致”的最终断言。
- 报告状态 GET：上游读取失败后表现为平台 500；Vercel 日志确认内部错误为 `DATA_UPSTREAM_ERROR`。

额外发现：`v3a-report-import` handler 对异步 `handleStatus` / `handleExtract` / `handleConfirm` 直接返回 Promise 而未在 `try` 内 `await`。异步拒绝可能绕过外层错误 JSON 处理并表现为平台 500。该项需要 Claude 在下一轮 Review 中确认，本 Sprint 未修改代码。

完整 OCR → create RPC → generate-report → complete RPC 链路未执行，因为读取权限失败已触发停止条件。

## 6. 幂等测试与状态机

- 第一次提交：未执行。
- 相同 key + 相同 payload：未执行。
- 相同 key + 不同 payload：未执行。
- `generating → ready`：未执行真实 API 写入验证。
- `generating → failed`：未执行真实 API 写入验证。
- `ready → generating` 拒绝：未执行真实 API 写入验证。

原因：权限模型运行时 FAIL 后立即停止。没有创建任何 Phase A-2 合成客户或报告记录。

## 7. 隐私检查

- 最近 Preview Vercel 日志仅见路由、状态码与安全错误栈；未见 Base64 图片、raw OCR、儿童姓名、手机号、Cookie、Session、token 或 secret。
- 未执行 OCR/报告生成完整链路，因此“真实完整链路日志脱敏”仍为未完成门禁，不能标记 PASS。
- 测试输出仅记录 HTTP 状态、布尔契约与安全错误码；未记录客户列表内容、邀请码或会话值。

## 8. 已知限制与下一步 Review 输入

1. 必须由 Claude 复核 helper function 的最小权限方案，至少覆盖 020 RLS policy 实际调用的身份 helper；不得扩大到 `anon` 或无关函数。
2. 修正后需重新执行 authenticated RLS 只读查询，再继续 API 契约、幂等与状态机验证。
3. 需确认 `v3a-report-import` 异步 handler 的错误捕获是否应使用 `await`，避免运行时错误绕过标准 JSON 响应。
4. 020 已在 Preview 执行；后续应采用可审计的补充 migration，不应静默手工改权限或重写已执行 migration。
5. 本报告不授权 Production，也不授权 Phase B 前端实施。

## 9. 安全备注

验证过程中，Chrome 中一个与本 Sprint 无关的第三方 API key 创建弹窗已处于打开状态，密钥因此进入屏幕记录。Codex 未复制、保存或写入本报告该值。负责人应立即在对应第三方平台轮换该密钥。
