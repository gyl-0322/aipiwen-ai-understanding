# V3a Phase C1-C：第一位 super_admin 初始化

## 为什么需要 009

原函数 `public.v3a_bootstrap_first_super_admin(uuid, text)` 只能提升已经同时存在于 `auth.users` 和 `public.users` 的映射。空 Preview 数据库中，第一位管理员只存在于 Supabase Auth 时，没有一条不会生成指导师申请的正式初始化路径。

009 新增 `public.v3a_create_first_super_admin_from_auth(uuid, text)`。它从一个已验证邮箱、未删除、未封禁的 Auth 用户原子创建第一条 `public.users` active/super_admin 映射，并写入唯一的初始化审计。它不会创建 `advisor_profiles`、`application_reviews`、wallet、credit、invite 或 login 记录。

旧函数仍然保留，继续用于“已有 `public.users` 映射”的兼容场景；新函数专用于“只有 `auth.users`、尚无 `public.users` 映射”的第一位管理员。

## Preview 初始化顺序

1. 在独立 Preview 项目的 Auth 中创建 Emma 测试用户。
2. 完成该用户的邮箱验证。
3. 回读并核对该 Auth 用户的 UUID。
4. 由数据库 owner/postgres 在受控 SQL Editor 中只调用一次：

   ```sql
   select public.v3a_create_first_super_admin_from_auth(
     p_user_id => '00000000-0000-0000-0000-000000000000'::uuid,
     p_display_name => 'Emma'
   );
   ```

5. 只读回查 `public.users` 中对应的 active/super_admin 映射，以及 `admin_audit_logs` 中的 `FIRST_SUPER_ADMIN:{user_id}` 审计键。

函数只允许数据库 owner/postgres 执行；`PUBLIC`、`anon`、`authenticated`、`service_role` 均无 EXECUTE。固定事务级 advisory lock 会串行化并发初始化。首次成功后，其他 Auth 用户会收到 `FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED`；同一个已成功初始化的用户重复调用会返回原 user/audit，并标记 `already_initialized = true`。

`public.users.city` 在当前 schema 中为必填字段，而初始化函数没有城市输入，因此 009 使用固定占位值“未设置”。这不会创建指导师资料或申请。

## 安全边界

- 不要让 Emma 走指导师注册页面；该流程会创建 pending `public.users`、`advisor_profiles` 和 `application_reviews`。
- 不要手工 INSERT `public.users`。
- 不要把密码、access token、refresh token、anon key 或 service_role key 写进 SQL。
- 不要执行 `supabase/tests/009_v3a_first_super_admin_bootstrap_test.sql`；它只用于可销毁的本地数据库，并会提交合成并发测试数据。
- 不要直接运行 `supabase db push`；当前 Preview 的 migration history 不是由 CLI 建立。
- 未获得独立上线批准前，不得在 Production 执行 009 或调用新函数。
