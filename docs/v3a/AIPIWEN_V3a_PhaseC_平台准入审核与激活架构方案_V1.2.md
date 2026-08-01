# AIPIWEN V3a Phase C 平台准入审核与激活架构方案 V1.2

## 1. 本轮唯一闭环

本阶段只完成第一个真实指导师闭环：

注册申请 -> 平台准入审核 -> 审核通过 -> 账号激活 -> 开通钱包 -> 发放注册积分 -> 生成邀请码 -> 进入指导师工作台

不重新设计架构，不扩大范围，不修改 Production，只允许本地开发和 Preview 验收。

## 2. 正式命名

产品内统一使用：

- 平台准入审核
- 平台准入审核后台
- 平台超级管理员 / Super Admin
- 指导师准入审核中心
- 审核通过
- 审核驳回

后台页面主标题统一为：

`AIPIWEN 指导师准入审核中心`

数据库角色名和技术字段保持 `super_admin`，不修改已冻结角色枚举。

## 3. Phase C 范围

Phase C 只做：

- 平台准入审核
- `active`
- `credit_wallets`
- `REGISTER_BONUS`
- `invite_codes`
- `admin_audit_logs`
- active 指导师工作台

Phase C 不做：

- 客户系统
- Report OS
- AI 模型
- 支付
- 分佣
- 邀请奖励
- 冻结/解冻 UI

`frozen` 状态继续保留在 schema 中，但本阶段不做冻结 UI。

## 4. 字段事实

真实 schema 中申请角色字段是：

`application_reviews.role`

审核通过时：

`public.users.role` 从 `pending` 更新为 `application_reviews.role`。

不得使用不存在的 `application_reviews.requested_role` 字段。注册 RPC 的参数名可以继续叫 `p_requested_role`，但落库字段必须是 `application_reviews.role`。

## 5. 单事务要求

`public.v3a_approve_application(...)` 必须是 PostgreSQL 单事务。

任一步失败全部 rollback，禁止出现：

- active 无 wallet
- wallet 500 无 credit log
- credit log 有积分无 invite code
- approved 无 audit log
- 重复 `REGISTER_BONUS`

不得在 Node.js 中连续调用多次 Supabase 写操作模拟事务。`api/v3a-admin.js` 只能做身份校验、生成邀请码候选、调用 RPC 和返回安全结果。

## 6. approve_application 事务

事务前校验：

- 调用方必须是 active `super_admin`。
- application 存在。
- 申请关联的 `users` 和 `advisor_profiles` 存在。
- application 当前为 `pending`，或已经是同一申请的 `approved` 幂等状态。
- `application_reviews.role` 必须是当前 schema 允许的正式角色：`advisor` / `agent` / `center`。

同一事务内完成：

- `users.status`: `pending` -> `active`
- `users.role`: `pending` -> `application_reviews.role`
- `advisor_profiles.status`: `pending` -> `active`
- 创建或确认 `credit_wallets`，余额为 `500`
- 写入唯一 `REGISTER_BONUS` credit log
- 创建或确认一个 active invite code
- `application_reviews.status`: `pending` -> `approved`
- 写入 `reviewer_user_id` 和 `reviewed_at`
- 写入 `admin_audit_logs`

注册积分幂等键固定为：

`REGISTER_BONUS:{user_id}:{application_id}`

用户可读结果文案：

`平台准入审核通过`

## 7. approve 幂等

重复 approve 同一个 application 必须返回 `already_processed` 或等价幂等成功结果。

不得重复创建：

- wallet
- `REGISTER_BONUS`
- invite code
- audit log

必须返回或可读取已有：

- active 状态
- wallet 余额
- invite code

如缺少“每个用户只能一个 invite code”的数据库保护，只允许增加最小唯一约束或索引，不扩展邀请奖励、计数、分佣或上下级体系。

## 8. reject_application 事务

`public.v3a_reject_application(...)` 必须是 PostgreSQL 单事务。

要求：

- 仅 active `super_admin` 可调用。
- rejection reason 至少 10 个字符。
- application 必须为 `pending`，或已经是同一申请的 `rejected` 幂等状态。
- `users.status` -> `rejected`
- `advisor_profiles.status` -> `rejected`
- `application_reviews.status` -> `rejected`
- 写入 `reviewer_user_id` / `reviewed_at` / `rejection_reason`
- 写入 `admin_audit_logs`，action 为 `REJECT_APPLICATION`

不得创建：

- wallet
- credit log
- invite code

用户可读结果文案：

`平台准入审核驳回`

## 9. RPC 安全

API 与 RPC 双重校验：

- `api/v3a-admin.js` 验证同源请求、HttpOnly session、CSRF 和当前用户身份。
- 当前 session 映射到 `public.users`。
- API 校验 `role = super_admin` 且 `status = active`。
- RPC 内再次校验调用角色为 `service_role`，并校验 reviewer 是 active `super_admin`。
- RPC revoke `public` / `anon` / `authenticated` execute。
- 仅 `service_role` 获得 RPC execute。
- 普通 advisor 直接调用 RPC 必须失败。

`SUPABASE_SERVICE_ROLE_KEY` 或 `V3A_SUPABASE_SERVICE_ROLE_KEY` 只能在服务端环境变量读取，不能写入 HTML、static JS、migration、日志或错误响应。

## 10. 当前 migration 事实

`007_v3a_phase_c1c_review_transactions.sql` 安装 Phase C1-C 的初始事务函数。

`008_v3a_phase_c1c_security_hardening.sql` 在 007 之后覆盖并加固同名 RPC，是当前顺序执行后的有效版本。评审和测试时必须按 `001 -> 002 -> 004 -> 005 -> 006 -> 007 -> 008` 的最终状态判断。

本阶段不要擅自在 Supabase Preview 执行 migration，也不要点击真实申请的“审核通过”。需要由人工在 Supabase Preview SQL Editor 执行并确认。
