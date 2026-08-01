# V3a Phase C1-C：第一位 super_admin 初始化

## 当前决策：空 Preview 使用 012

原函数 `public.v3a_bootstrap_first_super_admin(uuid, text)` 只能提升已经同时存在于 `auth.users` 和 `public.users` 的映射。空 Preview 数据库中，第一位管理员只存在于 Supabase Auth 时，没有一条不会生成指导师申请的正式初始化路径。

009 曾新增邮箱时代的 `public.v3a_create_first_super_admin_from_auth(uuid, text)`；012 安装后该函数被删除，009 migration 只保留为历史记录。011 只用于已经由 009 创建的旧首管理员在同一 Auth UUID 上补绑手机号，不是空 Preview 的当前初始化路径。

空 Preview 当前必须使用 012 新增的 `public.v3a_create_first_super_admin_from_phone_auth(uuid, text)`。它从一个已完成中国手机号 OTP 验证、未删除、未封禁、非匿名的 Auth 用户原子创建第一条 `public.users` active/super_admin 映射，并写入唯一的初始化审计；不要求邮箱或邮箱验证，也不创建 `advisor_profiles`、`application_reviews`、wallet、credit、invite 或 login 记录。012 同时删除旧 006 bootstrap 函数和 009 邮箱初始化函数，关闭并发与邮箱初始化旁路。

## Preview 初始化顺序

1. 在独立 Preview 项目中通过统一 Phone OTP 流程创建并验证 Emma 的中国手机号 Auth 用户。
2. 回读并核对该 Auth 用户的 UUID、手机号与非空 `phone_confirmed_at`。
3. 由数据库 owner/postgres 在受控 SQL Editor 中只调用一次：

   ```sql
   select public.v3a_create_first_super_admin_from_phone_auth(
     p_user_id => '00000000-0000-0000-0000-000000000000'::uuid,
     p_display_name => 'Emma'
   );
   ```

4. 只读回查 `public.users` 中对应的 active/super_admin 映射、已验证手机号，以及 `admin_audit_logs` 中的 `FIRST_SUPER_ADMIN:{user_id}` 审计键。

函数只允许数据库 owner/postgres 执行；`PUBLIC`、`anon`、`authenticated`、`service_role` 均无 EXECUTE。固定事务级 advisory lock 会串行化并发初始化。首次成功后，其他 Auth 用户会收到 `FIRST_SUPER_ADMIN_BOOTSTRAP_CLOSED`；同一个已成功初始化的用户重复调用会返回原 user/audit，并标记 `already_initialized = true`。

`public.users.city` 在当前 schema 中为必填字段，而初始化函数没有城市输入，因此 012 使用固定占位值“未设置”。这不会创建指导师资料或申请。

## 安全边界

- 不要让 Emma 走指导师注册页面；该流程会创建 pending `public.users`、`advisor_profiles` 和 `application_reviews`。
- 不要把 009 或 011 用作当前空 Preview 的首位管理员初始化路径。
- 不要手工 INSERT `public.users`。
- 不要把密码、access token、refresh token、anon key 或 service_role key 写进 SQL。
- 不要执行 `supabase/tests/009_v3a_first_super_admin_bootstrap_test.sql`；它只用于可销毁的本地数据库，并会提交合成并发测试数据。
- 安装 012 前必须只读确认 Preview 仅记录 001～011；安装后必须保留 012 的 migration version 记录，禁止以任何方式触碰 Production。
- 未获得独立上线批准前，不得在 Production 执行 012 或调用新函数。
