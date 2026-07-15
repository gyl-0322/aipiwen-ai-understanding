# AIPIWEN 中国手机号登录架构决策

日期：2026-07-11
范围：V3a Phase C1-D

## 决策

正式采用：

> Supabase Phone OTP → HTTPS Send SMS Hook → 阿里云短信服务 `SendSms` → Supabase Auth 校验 OTP 并签发 Session。

职责边界：

- Supabase Auth 生成 OTP、验证 OTP、管理 `auth.users`，并正式签发 access token、refresh token 和 Session。
- HTTPS Send SMS Hook 验证 Supabase Standard Webhooks 签名后，只转交当前 OTP。
- 阿里云短信服务只负责通过审核后的签名和验证码模板发送短信，不生成 AIPIWEN Session，不作为最终身份真相源。
- PostgreSQL RLS 继续以 Supabase 正式签发身份中的 `auth.uid()` 为用户边界。

## 被否决方案

`docs/AIPIWEN_CHINA_PHONE_LOGIN_AUDIT.md` 仅保留为历史审计材料。其中“读取 `SUPABASE_JWT_SECRET` 并由业务服务自行签发 Supabase JWT”的建议已被正式否决，不得实施。

明确禁止：

- 新增 `SUPABASE_JWT_SECRET`。
- 自行签发或仿造 Supabase access token、refresh token 或 Session。
- 建立第二套 OTP 校验结果并把它伪装成 Supabase 身份。
- 让阿里云验证码校验替代 Supabase `verifyOtp`。

## C1-D 数据库边界

- 010 只负责可信手机号绑定与指导师申请原子性，不生成或校验 OTP。
- `public.users.phone` 使用 Supabase Auth 已确认的 E.164 值；中国入口仅接受 `+86` 加 11 位大陆手机号。
- Phone OTP 用户的 `public.users.phone` 必须同时等于当前 Supabase JWT 的 `phone` claim 与 `auth.users.phone`，且 `auth.users.phone_confirmed_at` 非空；不能用 `phone = null` 绕过。
- 现有 `users_phone_unique_idx` 继续负责全局唯一保护。
- 已验证邮箱用户允许 `public.users.phone` 为 null，但不能声明任意手机号。
- 邮箱与 Phone OTP 用户共用 `public.v3a_submit_pending_application(...)`；RPC 从 `auth.uid()` 对应的 `auth.users` 派生身份字段，并在同一事务创建或确认 `public.users`、`advisor_profiles`、`application_reviews`。
- RPC 只接受数据库白名单中的当前协议版本；客户端不能自行伪造已同意的协议版本。可选邀请码沿用现有 `ADV|AGT|CTR-8位` 格式，但本阶段不创建或核销邀请码。
- 浏览器不再直接 INSERT 三表；普通 authenticated 用户也不能 UPDATE phone。RPC 只创建 pending 申请，不创建 wallet、credit、invite 或 approve audit。
- 009 首管理员邮箱 bootstrap、pending 审核、approve/reject 与审核后 500 积分流程不改变。

## 前端后续边界

手机号登录完成后只得到已认证身份，不能替代指导师申请资料。首次手机号用户仍需填写昵称、城市、申请角色、从业类型、邀请码（可选）并确认协议，之后由单一 registration RPC 原子创建：

1. `public.users` pending 映射；
2. `advisor_profiles` pending 资料；
3. `application_reviews` pending 申请。

Phone OTP 登录未来集成到统一 `login.html` 中，不创建独立手机号登录页面。手机号认证成功后继续复用 `static/v3a-auth.js` 和现有 `routeByStatus`，进入统一的 pending / active 流程。本决策不授权本轮开发页面、配置 Hook、发送短信或部署。

微信登录、邮箱与手机号身份合并、手机号换绑和完整 Identity OS 均留到后续阶段。
