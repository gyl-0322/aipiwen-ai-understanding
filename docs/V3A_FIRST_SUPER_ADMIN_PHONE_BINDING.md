# 历史兼容：V3a 首位 super_admin 同 UUID 绑定手机号

## 目的与边界

本流程仅保留给已经由 009 创建、邮箱已验证并且已经映射为 `active / super_admin` 的历史首位总部账号。它把中国手机号绑定到同一个 Supabase Auth UUID，不创建第二个账号，不修改 009、010，也不开放通用邮箱登录。011 的专用无参数 RPC 会从已验证 Auth 身份派生手机号，并同步到同一 UUID 对应的 `public.users.phone`；客户端不能提交数据库手机号参数，也不能直接更新表。

本流程不是空 Preview 的当前初始化路径。空 Preview 的首位管理员统一通过 Phone OTP 完成 Auth 验证，再使用 012 `public.v3a_create_first_super_admin_from_phone_auth(uuid, text)` 初始化；不要求邮箱或邮箱验证。009 migration 只保留历史记录，其初始化函数由 012 删除；011 仅服务已经存在的旧账号。

工具只允许连接 Preview `lmjriqncuopgxwyudfee`。Production `tysbwijizgebnrazxpvo` 禁止连接。工具不读取 service role，不保存或打印邮箱密码、验证码、anon key、access token 或 refresh token。

仅在处理上述历史账号时，真正运行工具会发送一条短信，并对 Preview Auth 执行手机号换绑；必须另行确认后才能运行：

```text
node scripts/v3a-bind-first-admin-phone.js --preview-write-approved
```

本文件不记录真实邮箱、手机号、UUID 或任何凭据。只在 Supabase Preview SQL Editor 临时替换下面的占位符。
`TARGET_PHONE_E164` 必须替换为完整的 `+86` E.164 手机号。

## 只读预检 A：发送验证码之前

```sql
with target as (
  select id, email
  from auth.users
  where lower(email) = lower('TARGET_EMAIL')
)
select
  to_regprocedure('public.v3a_sync_own_first_super_admin_phone()') is not null as sync_rpc_installed,
  (select count(*) from target) as target_auth_user_count,
  (
    select count(*)
    from public.users u
    join target t on t.id = u.auth_user_id
    where u.role = 'super_admin' and u.status = 'active'
  ) as target_active_super_admin_count,
  (
    select count(*)
    from public.users u
    join target t on t.id = u.auth_user_id
    where lower(u.email) = lower(t.email) and u.phone is null
  ) as target_public_identity_ready_count,
  (
    select count(*)
    from public.admin_audit_logs audit
    join public.users u on u.id = audit.admin_id and u.id = audit.target_id
    join target t on t.id = u.auth_user_id
    where audit.action = 'FIRST_SUPER_ADMIN'
      and audit.details ->> 'auth_user_id' = t.id::text
  ) as target_first_super_admin_audit_count,
  (select count(*) from auth.users where phone = 'TARGET_PHONE_E164') as confirmed_auth_phone_count,
  (select count(*) from auth.users where phone_change = 'TARGET_PHONE_E164') as pending_phone_change_count,
  (select count(*) from public.users where phone = 'TARGET_PHONE_E164') as public_phone_count;
```

八项结果必须精确为：`true / 1 / 1 / 1 / 1 / 0 / 0 / 0`。任何一项不同都立即停止，不发码、不清理、不修复。

## 只读预检 B：收到短信、提交验证码之前

```sql
with target as (
  select id
  from auth.users
  where lower(email) = lower('TARGET_EMAIL')
)
select
  (select count(*) from auth.users where phone = 'TARGET_PHONE_E164') as confirmed_auth_phone_count,
  (select count(*) from auth.users where phone_change = 'TARGET_PHONE_E164') as all_pending_phone_change_count,
  (
    select count(*)
    from auth.users a
    join target t on t.id = a.id
    where a.phone_change = 'TARGET_PHONE_E164'
  ) as target_pending_phone_change_count,
  (select count(*) from public.users where phone = 'TARGET_PHONE_E164') as public_phone_count;
```

四项结果必须精确为：`0 / 1 / 1 / 0`。任何一项不同都立即停止，不提交验证码、不自动重试、不自动清理待确认号码。

## 成功标准

- 验证结果中的 Auth UUID 与邮箱登录得到的原 UUID 完全相同。
- `auth.users.phone` 与 `public.users.phone` 均为同一个目标 E.164 手机号，`phone_confirmed_at` 非空。
- 011 写入一条不含手机号的 `BIND_SUPER_ADMIN_PHONE` 审计，并且重复执行不重复写手机号或审计。
- 之后从统一 `login.html` 进行 Phone OTP 登录，仍路由到 `admin-applications.html`。
- 全程没有创建第二个 Auth 用户，也没有连接 Production。

如果旧邮箱账号没有可用密码、出现遗留 `phone_change`、预检数字不符或验证结果 UUID 不一致，结论只能是 `BLOCKED`，交由人工核查。
