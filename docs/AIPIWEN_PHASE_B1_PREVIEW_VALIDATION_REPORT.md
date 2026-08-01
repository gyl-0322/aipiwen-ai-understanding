# AIPIWEN Phase B-1 Preview Validation Report

## 0. 结论

状态：**STOPPED / PARTIAL PASS**

Phase B-1 的 Preview migration、Attribution RPC、token 生命周期、客户归属写入、无归属写入、source 不可变、指导师隔离和自动化回归均已通过真实运行验证。

本轮不能判定为完整 PASS，原因如下：

1. Preview 当前没有 active `super_admin`，因此无法在不修改 Auth 或身份数据的前提下完成总部成功分配及 `ASSIGN_CLIENT` 成功审计记录验证。
2. Preview 当前没有 active `agent` / `center`，因此无法完成对应真实身份的运行时拒绝验证。
3. 已真实验证 attribution token 到 `/api/report-store` 的归属写入桥接，但未重新执行“图片上传 → OCR → AI 生成”的完整链路；本轮没有获准使用的隔离图片测试样本。
4. Supabase 测试数据已清理；Preview KV 中两条仅含合成内容的报告测试对象因 Sensitive 环境变量不可回读而未能清理。

上述限制均未通过修改身份、降低权限或改动 Report Engine 来绕过。Production 未执行 migration、未部署、未修改。

## 1. Preview 环境与 Migration 结果

### 1.1 环境确认

- Supabase Preview Project Ref：`lmjriqncuopgxwyudfee`
- Supabase 项目：`aipiwen-v3a-preview`
- Production Project Ref `tysbwijizgebnrazxpvo` 未连接、未操作
- Vercel Target：Preview
- 代码基线：`70395c3f6422f439da27e3e70bfac203b2b1380d`

### 1.2 Migration 022

- 文件：`supabase/migrations/022_v3a_advisor_attribution.sql`
- SHA-256：`5a2bc4a398f86d7bc0fd8d20963b4400f565da34213168b649d3555ed242e673`
- 执行目标：Preview Supabase
- 执行方式：Supabase CLI linked database query
- 执行结果：PASS
- 事务结果：成功，无 migration 错误

Postflight 验证：

- `attribution_tokens` 表存在：PASS
- 必需字段存在：PASS
- `advisor_clients.assigned_by_user_id` 存在：PASS
- `advisor_clients.assigned_at` 存在：PASS
- `advisor_user_id` 支持 NULL：PASS
- `source` 支持 `advisor_qr`、`advisor_import`、`unguided`：PASS
- attribution 四个 RPC 存在：PASS
- source 不可变触发器存在：PASS
- `ASSIGN_CLIENT` 已纳入 `admin_audit_logs` action 约束：PASS

## 2. Preview API Deployment

- Deployment ID：`dpl_BBWqyFR5qE5VxPiSmjRRjX6X5Upx`
- 创建时间：2026-07-29 06:40:00 PDT
- 状态：Ready
- Target：Preview
- Deployment URL：`https://aipiwen-ai-understanding-eq0t0sxlq-guo-yanling-s-projects.vercel.app`
- Stable Preview URL：`https://aipiwen-ai-understanding-gyl0322-8747-guo-yanling-s-projects.vercel.app`

部署使用从上述 commit 创建的隔离临时 worktree，并仅叠加 Phase A / Phase B-1 所需运行文件，避免把主工作区其他未提交修改带入部署。未使用 `--prod`。

Preview 原有环境缺少当前 BFF 使用的 `V3A_SUPABASE_SERVICE_ROLE_KEY` 名称。本轮仅在 Preview scope 增加该名称对应的 Sensitive 配置；未读取、输出或写入任何密钥，Production 环境未变更。

## 3. Attribution RPC 验证

### 3.1 创建 token

- active advisor 创建 token：PASS
- 非业务身份创建 token：拒绝，`ATTRIBUTION_FORBIDDEN`，PASS
- token 值未写入日志或报告：PASS

### 3.2 公开验证契约

公开 validate API 对 active token 返回的顶层字段仅包含：

- `ok`
- `valid`
- `advisor`
- `expiresAt`
- `remainingUses`

不返回 `advisor_user_id`、内部主键、secret 或其他敏感字段：PASS。

## 4. Token 生命周期验证

- active：验证成功，PASS
- expired：拒绝并返回 `ATTRIBUTION_TOKEN_EXPIRED`，PASS
- exhausted：拒绝并返回 `ATTRIBUTION_TOKEN_EXHAUSTED`，PASS
- revoked：拒绝并返回 `ATTRIBUTION_TOKEN_REVOKED`，PASS
- `max_uses` / `used_count` 消耗生效：PASS

## 5. Attribution 运行验证

### 5.1 带 token 流程

使用真实 Preview API 验证：

`attribution token → /api/report-store → advisor_client → advisor_report`

结果：

- 客户创建成功：PASS
- `source = advisor_qr`：PASS
- `advisor_user_id` 与 token 所属指导师一致：PASS
- 报告状态为 `ready`：PASS
- token 使用次数被消费：PASS

本项验证的是 Report Engine 存储出口与 attribution layer 的真实桥接。未修改 OCR、生成器或现有 Report Engine 核心逻辑。

### 5.2 无 token 流程

使用真实 Preview API 验证：

- 客户创建成功：PASS
- `source = unguided`：PASS
- `advisor_user_id IS NULL`：PASS
- 满足总部 unassigned pool 查询条件：PASS

### 5.3 完整图片链路

- `report-upload.html` Preview 页面：HTTP 200
- OCR / generate / store 既有自动化回归：PASS
- 新的真实图片上传、OCR 与 AI 生成端到端：NOT RUN

原因：本轮没有获准使用的隔离图片 fixture。没有使用真实客户材料，也没有伪造敏感客户数据。

## 6. Advisor Workspace 验证

使用 Preview 中已有 active advisor 的真实浏览器 Session 验证：

- “我的客户”页面加载：PASS
- 新归属客户在“我的真实客户”中出现且仅出现一次：PASS
- advisor 可以看到自己的 `advisor_qr` 客户：PASS
- 同一 advisor 看不到无归属客户：PASS
- 页面“客户归属二维码”按钮通过 BFF Session + CSRF 创建 token：PASS
- 页面生成 `/report-upload.html?token=...` 入口与二维码：PASS
- 浏览器控制台无错误：PASS

页面和报告均未记录实际 token 值。

## 7. Source 不可变与权限验证

### 7.1 Source immutability

对已创建客户尝试修改 `source`：

- 数据库拒绝：`SOURCE_IS_IMMUTABLE`
- 结果：PASS

### 7.2 Assign 权限

- active advisor 调用 assign：拒绝，`ASSIGN_CLIENT_FORBIDDEN`，PASS
- anon 对 assign RPC 无 EXECUTE：PASS
- authenticated 对 assign RPC 无 EXECUTE：PASS
- service_role 保留 BFF 所需 EXECUTE：PASS
- 浏览器侧没有归属写权限：PASS

### 7.3 Agent / Center

- 静态权限与契约测试：PASS
- 真实身份运行时测试：NOT RUN

原因：Preview 当前 active `agent` / `center` 数量为 0。创建或更改身份超出本 Sprint 授权。

## 8. Headquarters Assignment 与 Audit 验证

### 8.1 Unassigned pool

- `source = unguided AND advisor_user_id IS NULL` 的数据库查询结果正确：PASS
- 未登录访问 `/api/v3a-admin/unassigned`：401，PASS
- active advisor 不能读取无归属客户：PASS
- 使用真实 super_admin Session 查询：BLOCKED

### 8.2 成功归属调整

- 五重校验的代码与契约测试：PASS
- advisor 越权 assign 被拒绝：PASS
- super_admin 成功 assign：BLOCKED
- `advisor_user_id` / `assigned_by_user_id` / `assigned_at` 成功更新：BLOCKED

### 8.3 审计

- `ASSIGN_CLIENT` action 数据库约束存在：PASS
- 审计写入代码与契约测试：PASS
- 真实成功分配产生 `admin_audit_logs` 记录：BLOCKED

阻塞原因：Preview 当前 active `super_admin` 数量为 0。为完成该验证而创建管理员或修改用户身份会违反“不修改 Auth / 身份体系”的强制边界，因此停止在安全门前。

## 9. API 与回归测试结果

### 9.1 实际 HTTP

- `/report-upload.html`：200
- `/ai-interpreter-customers.html`：200
- `/admin-unassigned.html`：200
- `/api/v3a-session?action=me` 未登录：401
- `/api/v3a-customers` 未登录：401
- `/api/v3a-admin/unassigned` 未登录：401
- attribution invalid token：400

### 9.2 自动化

- Phase A report import：93/93 PASS
- Phase B-1 attribution：64/64 PASS
- Report Upload P0：12/12 PASS
- Vercel Function Budget：12/12 PASS
- `scripts/test-*.js`：16/16 scripts PASS
- 全部 JavaScript `node --check`：PASS
- Preview build：PASS
- Vercel Preview deploy：PASS

## 10. 隐私与清理

### 10.1 隐私

本轮日志和报告不包含：

- Base64 图片
- raw OCR
- 真实儿童姓名
- 真实手机号
- OTP
- attribution token
- Session / Cookie
- Supabase / Vercel / KV secret

结果：PASS。

### 10.2 测试数据清理

- Supabase 测试客户：已清理
- Supabase 测试报告：已清理
- attribution token：已清理
- 页面创建的 token：已清理
- expired / revoked 测试 token：已清理
- Preview KV 合成测试对象：2 条未清理

KV 未清理原因：相关 Preview 环境变量已标记为 Vercel Sensitive，不能通过 CLI 回读。未通过降低 Sensitive 属性、输出 token 或增加清理后门绕过安全边界。残留对象只包含本轮合成名称与“Preview validation / isolated test”内容，不含真实客户、手机号、儿童信息、OTP 或 secret。

## 11. Quality Gate 汇总

| Gate | 结果 | 说明 |
|---|---|---|
| Preview Migration 022 | PASS | 仅 Preview |
| Schema / RPC Postflight | PASS | 结构与权限符合设计 |
| Token lifecycle | PASS | active / expired / exhausted / revoked |
| Attribution store bridge | PASS | advisor_qr 与 unguided 均真实写入验证 |
| Source immutability | PASS | 修改被数据库拒绝 |
| Advisor workspace | PASS | 真实 Session 可见自己的归属客户 |
| Advisor / anon assign denial | PASS | 越权拒绝 |
| Super admin assign | BLOCKED | Preview 无 active super_admin |
| ASSIGN_CLIENT runtime audit | BLOCKED | 依赖成功 super_admin assign |
| Agent / center runtime denial | NOT RUN | Preview 无对应 active 身份 |
| Full image → OCR → generation flow | NOT RUN | 无获准隔离图片 fixture |
| Phase A regression | PASS | 93/93 |
| Phase B tests | PASS | 64/64 |
| Build / Node check | PASS | 通过 |
| Test-data cleanup | PARTIAL | Supabase 已清；KV 留有 2 条合成对象 |
| Production untouched | PASS | 无 migration、deploy 或配置修改 |

## 12. Claude Review 入口

本轮应进入 Claude Review，但不能表述为 Phase B-1 Preview 全量验收 PASS。

建议 Review 重点确认：

1. 是否提供现有 Preview `super_admin` 测试身份，或另行授权受控身份准备，以完成成功 assign 与 audit 验证。
2. 是否提供获准的无敏感隔离图片 fixture，以完成真实图片上传全链路。
3. 是否提供安全的 Preview KV 管理清理路径，以删除两条合成报告对象。

在上述缺口关闭前，不进入 Phase C。
