# AIPIWEN V3a Phase C 真实 Schema 对照

## 1. 对照来源

已按顺序核对：

- `supabase/migrations/001_v3a_real_accounts_schema.sql`
- `supabase/migrations/002_v3a_rls_policies.sql`
- `supabase/migrations/004_v3a_phase_c1a_core_tables.sql`
- `supabase/migrations/005_v3a_phase_c1a_rls.sql`
- `supabase/migrations/006_v3a_phase_c1b_admin_bootstrap.sql`

同时注意：仓库已存在 `007_v3a_phase_c1c_review_transactions.sql` 和 `008_v3a_phase_c1c_security_hardening.sql`。顺序执行后，008 中的 `v3a_approve_application` / `v3a_reject_application` 是当前有效 RPC 版本。

## 2. public.users

- 主键：`id uuid primary key`
- Auth 关联：`auth_user_id uuid unique references auth.users(id)`
- 角色：`role text`
- 状态：`status text`
- Phase C 相关字段：`approved_at`、`approved_by_user_id`

真实规则：

- 审核通过时 `role` 从 `pending` 更新为 `application_reviews.role`。
- 审核通过时 `status` 从 `pending` 更新为 `active`。
- 审核驳回时 `role` 保持 `pending`，`status` 更新为 `rejected`。

## 3. advisor_profiles

- 主键：`id uuid primary key`
- 用户关联：`user_id uuid unique references public.users(id)`
- 角色：`role text`
- 状态：`status text`

真实规则：

- 审核通过时 `status` 从 `pending` 更新为 `active`。
- 审核驳回时 `status` 从 `pending` 更新为 `rejected`。
- `role` 必须与 `application_reviews.role` 一致。

## 4. application_reviews

- 主键：`id uuid primary key`
- 用户关联：`user_id uuid references public.users(id)`
- 申请角色：`role text`
- 状态：`status text`
- 审核人字段：`reviewer_user_id`
- 审核时间：`reviewed_at`
- 驳回原因：`rejection_reason` 由 007 增加
- 其他审核说明：`review_note`

真实规则：

- 没有 `requested_role` 字段。
- 审核通过写 `status = approved`、`reviewer_user_id`、`reviewed_at`。
- 审核驳回写 `status = rejected`、`reviewer_user_id`、`reviewed_at`、`rejection_reason`。
- `rejection_reason` 至少 10 个字符。

## 5. credit_wallets

- 主键：`id uuid primary key`
- 用户关联：`user_id uuid unique references public.users(id)`
- 余额：`balance integer`

真实规则：

- 004 已收窄钱包表，移除了 Phase A 草案中的 `role`、`status`、`total_earned`、`total_spent`、`locked_balance`。
- Phase C approve 单事务创建或确认钱包，余额必须是 `500`。

## 6. credit_logs

- 主键：`id uuid primary key`
- 钱包字段：`wallet_id`
- 用户字段：`user_id`
- 类型：`type`
- 金额：`amount`
- 变动前：`balance_before`
- 变动后：`balance_after`
- 幂等键：`idempotency_key`
- 操作人字段：`operator_id`
- 备注字段：`note`

真实规则：

- 004 将 `operator_user_id` 重命名为 `operator_id`。
- 004 将 `reason` 重命名为 `note`。
- 004 移除了 `ref_type` / `ref_id`。
- `REGISTER_BONUS` 幂等键为 `REGISTER_BONUS:{user_id}:{application_id}`。
- `REGISTER_BONUS` 必须是 `amount = 500`、`balance_before = 0`、`balance_after = 500`。
- credit log 不更新、不删除，只追加。

## 7. invite_codes

- 邀请码：`code`
- 用户关联：`user_id`
- 角色：`role`
- 状态：`status`

真实规则：

- 004 已收窄邀请码表，移除了 `invite_type`、`max_uses`、`used_count`、`expires_at`。
- 008 增加 `invite_codes.user_id` 唯一约束，保证每个用户只拥有一个 invite code。
- Phase C 不做邀请奖励、邀请计数、分佣或多级邀请。

## 8. admin_audit_logs

- 主键：`id uuid primary key`
- 管理员字段：`admin_id`
- 操作：`action`
- 目标类型：`target_type`
- 目标 ID：`target_id`
- 详情：`details jsonb`
- 审核幂等键：`idempotency_key` 由 008 生成

真实规则：

- 004 将 `operator_user_id` 重命名为 `admin_id`。
- 004 移除了 Phase A 草案中的 `before_snapshot` / `after_snapshot` / `reason` 等字段，改用 `details`。
- 审核通过 action 为 `APPROVE_APPLICATION`。
- 审核驳回 action 为 `REJECT_APPLICATION`。
- 008 为审核类 audit log 建立幂等唯一键，防止重复 audit。

## 9. 实现结论

实现必须以 004 之后的收窄 schema 为准：

- approve/reject 使用 `application_reviews.role`。
- credit log 使用 `operator_id` 和 `note`。
- audit log 使用 `admin_id` 和 `details`。
- 不重复创建已存在表。
- 不擅自 ALTER 非 Phase C 必需结构。
- 不触碰客户系统、Report OS、AI 模型、支付、PDF 或正式报告生成逻辑。
