# AIPIWEN Phase B-1 客户归属与指导师服务关系实施报告

**状态**：IMPLEMENTATION COMPLETE / READY FOR CLAUDE REVIEW

**日期**：2026-07-29

**环境动作**：未执行 Preview/Production Migration，未执行 Deploy

## 1. 修改文件

### 数据库

- `supabase/migrations/022_v3a_advisor_attribution.sql`
  - 新建独立 `attribution_tokens` 表；
  - `advisor_clients.advisor_user_id` 改为可空，支持无归属客户；
  - 新增 `assigned_by_user_id`、`assigned_at`；
  - 客户和报告 `source` 增加 `unguided`，保留 Phase A 的历史兼容值；
  - 数据库 trigger 阻止客户和报告 `source` 被修改；
  - `ASSIGN_CLIENT` 加入现有 `admin_audit_logs` action 约束；
  - 新增 token 创建、公开验证、报告归属入库、总部单客户分配四个原子 RPC。

### API 与 Report Engine 接入

- `api/v3a-attribution.js`
  - active advisor 创建一次性归属 token；
  - 公开验证 token，只返回指导师展示名、有效期和剩余次数；
  - 合并 Phase A 客户查询实现，继续兼容 `GET /api/v3a-customers`。
- `api/generate-report.js`
  - 只扩展现有 `/api/report-store`；
  - 有效 token 写入 `advisor_qr` 归属，无 token 写入 `unguided`；
  - 浏览器不能提交 `advisor_id`；
  - Redis 内部记录归属，公开读取时删除内部归属 ID 和 IP；
  - 不修改 OCR 或报告生成流程。
- `api/v3a-admin.js`
  - 增加无归属池查询；
  - 增加 super_admin 单客户分配；
  - 分配继续复用既有 Session、SameOrigin、CSRF、service-role BFF 和审计模型。
- `vercel.json`
  - 增加兼容路由；
  - 用 `v3a-attribution.js` 替换物理 `v3a-customers.js` Function，保持 12/12 配额。

### 页面

- `report-upload.html`
  - 读取当前 URL 的 `token`；
  - token 不写入 localStorage；
  - 报告保存时传递 token 和当前页面生命周期内稳定的 UUID 幂等键。
- `ai-interpreter-customers.html`
  - 增加“替客户上传报告”；
  - 增加“客户归属二维码”；
  - 增加真实客户区，同时保留并明确标注学习示例。
- `static/v3a-attribution.js`
  - 读取真实客户；
  - 通过 CSRF 创建一次性 token；
  - 打开唯一报告入口或生成二维码。
- `admin-unassigned.html`
  - super_admin 无归属客户池 MVP 只读页面。
- `static/v3a-admin-unassigned.js`
  - 只执行 GET，不提供页面分配操作。
- `admin-applications.html`
  - 增加无归属客户池入口。

### 测试

- `scripts/test-v3a-advisor-attribution.js`
  - 64 项 Phase B-1 数据库、API、路由、页面、安全和兼容契约。
- `scripts/test-v3a-advisor-report-import.js`
  - 客户查询测试改为兼容合并后的 attribution Function。
- `scripts/test-vercel-function-budget.js`
  - 更新 12/12 Function 清单和新增兼容路由断言。

未创建 `ai-interpreter-report-entry.html`。

## 2. Migration 结果

Migration 022 为单事务，包含 Preflight 和 Postflight。

关键行为：

- `attribution_tokens` 独立于 `invite_codes`；Migration 022 不修改 `invite_codes`；
- 新 token 为 32 位不透明随机值，默认一次使用、24 小时有效；
- 带无效、过期、撤销或耗尽 token 的请求 fail closed；
- 完全没有 token 的报告进入 `unguided`；
- token 消耗使用行锁，幂等重试不会重复消耗；
- `source` 由数据库 trigger 保持不可变；
- 总部分配只改变 `advisor_user_id`、`assigned_by_user_id`、`assigned_at`；Phase A 的 `updated_at` trigger 已限定为客户资料变化时执行，纯归属分配不会额外修改 `updated_at`。

验证：

- 本机临时 PostgreSQL 从 001、002、004–018、020、021 完整重建 Phase A 后执行 022：PASS；
- 022 Preflight、DDL、Postflight、COMMIT：PASS；
- 临时数据库与临时角色已在验证后删除；
- Preview：未执行；
- Production：未执行。

## 3. API 结果

### Attribution

- `POST /api/v3a-attribution?action=create`
  - active advisor + HttpOnly Session + SameOrigin + CSRF；
  - 返回一次性 token 和 `/report-upload.html?token=...` 路径；
  - 不接受浏览器 `advisor_id`。
- `GET /api/v3a-attribution?action=validate&token=...`
  - 公开接口；
  - 不返回 advisor UUID、Auth 信息、手机号或其他敏感数据。
- `GET /api/v3a-customers`
  - URL 与响应契约保持兼容；
  - 归属仍由 Session 推导；
  - agent/center 仍未开放。

### Report Store

- 继续复用唯一 Report Engine；
- 未修改 `api/extract-fp.js`；
- 未复制 `report-upload.html`；
- 归属关系和 ready 报告由新的 service-role-only 原子 RPC 写入；
- Redis 写入失败时，可用同一幂等键重试并复用数据库记录；
- public report GET 不返回内部 advisor/client/report UUID 或 IP。

### Admin

- `GET /api/v3a-admin/unassigned`：只返回 `source=unguided AND advisor_user_id IS NULL`；
- `POST /api/v3a-admin/assign`：要求 active super_admin、SameOrigin、CSRF、未分配客户、active advisor 和调整原因；
- 分配调用数据库原子 RPC，不由浏览器直接更新表。

## 4. 权限验证

本机真实 PostgreSQL 运行态验证：

- authenticated advisor 创建 token：PASS；
- anon 公开验证 token：PASS；
- token 绑定正确 advisor：PASS；
- 无 token 创建 `unguided`：PASS；
- advisor RLS 只能读取自己的客户：PASS；
- super_admin RLS 可以读取全部客户：PASS；
- anon 无客户表读取权限：PASS；
- anon 无 assign RPC EXECUTE：PASS；
- authenticated 无 assign RPC EXECUTE：PASS；
- service_role 有 assign RPC EXECUTE：PASS；
- assign RPC 内再次验证 active super_admin 与 active advisor：PASS；
- 分配后 `source=unguided` 保持不变：PASS；
- `ASSIGN_CLIENT` 审计写入：PASS。

## 5. 测试结果

- Vercel 本地 Build（target=preview）：PASS；
- 16 个 `scripts/test-*.js`：全部 PASS；
- Phase B-1 新契约：64/64 PASS；
- Phase A 报告导入回归：93/93 PASS；
- Report Upload P0：12/12 PASS；
- Vercel Function Budget：12/12 PASS；
- `api/`、`server/`、`static/`、`scripts/` 全部 JavaScript `node --check`：PASS；
- `git diff --check`（本 Sprint 涉及的已跟踪文件）：PASS；
- 本 Sprint 文件敏感信息模式扫描：PASS；
- 日志未增加 token、报告结构、儿童姓名、手机号、图片或 OCR 内容输出：PASS。

## 6. 未完成范围

依照 Sprint 边界，本次未执行：

- Preview Migration 022；
- Production Migration 022；
- Preview/Production Deploy；
- PDF、批量上传、自动智能分配、CRM；
- agent/center 权限；
- AI Coach；
- 页面内总部 assign 操作（`admin-unassigned.html` 保持 MVP 只读）；
- 任何 Auth、BFF Session、积分、身份生命周期或 Phase A 核心 RPC 修改。

下一步仅为 Claude Review。Review PASS 且取得单独环境授权后，才能进入 Migration/Deploy 验证阶段。
