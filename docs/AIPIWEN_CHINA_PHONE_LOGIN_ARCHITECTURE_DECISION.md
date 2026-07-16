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
- 通用注册与登录统一使用 Phone OTP，不再以邮箱或邮箱验证为前置；010 中已验证邮箱分支仅保留为历史兼容能力，不构成当前产品入口。
- Phone OTP 用户通过 `public.v3a_submit_pending_application(...)` 提交申请；RPC 从 `auth.uid()` 对应的 `auth.users` 派生身份字段，并在同一事务创建或确认 `public.users`、`advisor_profiles`、`application_reviews`。
- RPC 只接受数据库白名单中的当前协议版本；客户端不能自行伪造已同意的协议版本。可选邀请码沿用现有 `ADV|AGT|CTR-8位` 格式，但本阶段不创建或核销邀请码。
- 浏览器不再直接 INSERT 三表；普通 authenticated 用户也不能 UPDATE phone。RPC 只创建 pending 申请，不创建 wallet、credit、invite 或 approve audit。
- 空 Preview 的首位管理员统一使用 012 手机号 bootstrap；009 migration 仅保留历史记录，其邮箱初始化函数由 012 关闭；011 仅兼容已经存在的旧管理员。pending 审核、approve/reject 与审核后 500 积分流程不改变。

## 前端后续边界

手机号登录完成后只得到已认证身份，不能替代指导师申请资料。首次手机号用户仍需填写昵称、城市、申请角色、从业类型、邀请码（可选）并确认协议，之后由单一 registration RPC 原子创建：

1. `public.users` pending 映射；
2. `advisor_profiles` pending 资料；
3. `application_reviews` pending 申请。

Phone OTP 登录统一集成到 `login.html` 中，不创建独立手机号登录页面。手机号认证成功后继续复用 `static/v3a-auth.js` 和现有 `routeByStatus`，进入统一的 pending / active 流程。本决策不授权本轮开发页面、配置 Hook、发送短信或部署。

微信登录、邮箱登录与身份合并、手机号换绑和完整 Identity OS 均留到后续阶段；当前通用身份入口不保留邮箱验证前置。

空 Preview 的首位 `active / super_admin` 必须由 012 从已完成中国手机号 OTP 验证的 Auth 用户创建，不要求邮箱或邮箱验证。009 migration 仅保留历史记录，012 安装后其 `public.v3a_create_first_super_admin_from_auth(uuid, text)` 初始化函数不再存在；011 仅兼容已经由 009 创建的旧首管理员在同一 Auth UUID 上补绑手机号，不得用于新的空 Preview 初始化。任何冲突都停止且不自动清理。

## HttpOnly Session 实现边界（2026-07-15）

- `login.html`、申请页、待审核页和总部审核页只访问同源 BFF，不在浏览器加载 Supabase SDK，也不读取、保存或传递 Supabase access token / refresh token。
- 浏览器 Cookie 只保存 32 字节随机生成的 opaque Session ID；Cookie 固定使用 `__Host-aipiwen_v3a_session`、`Path=/`、`HttpOnly`、`Secure`、`SameSite=Lax`，不设置 `Domain`，绝对有效期为 7 天。
- Supabase access token / refresh token 只保存在服务端 KV；KV key 使用 Session ID 的 SHA-256 摘要，value 使用 AES-256-GCM 加密并将对应 KV key 绑定为 AAD，密钥只来自服务端 `V3A_SESSION_ENCRYPTION_KEY`。
- access token 剩余时间大于 60 秒时不轮换；临近过期时使用服务端短锁完成单次 refresh，先回查 Supabase Auth 用户，再覆盖加密 Session。
- 短信发送与验证码校验在 BFF 层按来源 IP 和手机号分别限流；KV 只保存 HMAC 摘要与计数，不保存原始手机号或 IP。
- `GET me` 和总部只读接口返回仅供当前页面内存使用的 CSRF token；申请提交、退出登录及总部审核写操作同时要求精确 Origin、同源请求和 `X-CSRF-Token`。
- 用户接口继续使用 Supabase 用户身份执行 RLS / registration RPC；总部审核接口每次重新确认当前 Auth 用户对应 `public.users` 的 `active / super_admin` 状态，service role 不进入浏览器。
- 服务端配置继续硬锁 Preview Project Ref `lmjriqncuopgxwyudfee`，显式拒绝 Production Project Ref `tysbwijizgebnrazxpvo`。`V3A_PHONE_OTP_ENABLED` 和 `V3A_ADMIN_REVIEW_WRITES_ENABLED` 均保持默认关闭。

本节只记录本地实现合同，不代表已经部署、配置云端环境变量、开放短信发送或开放总部审核写操作。

部署时只允许在 Preview 环境配置以下服务端变量，任何值都不得写入仓库或文档：

- `V3A_SUPABASE_URL`、`V3A_SUPABASE_ANON_KEY`、`V3A_SUPABASE_PROJECT_REF`
- `V3A_ALLOWED_ORIGIN`
- `KV_REST_API_URL`、`KV_REST_API_TOKEN`
- 由 32 字节随机数生成并以 Base64 保存的 `V3A_SESSION_ENCRYPTION_KEY`
- 默认关闭的 `V3A_PHONE_OTP_ENABLED`
- 仅总部审核 API 使用的 `V3A_SUPABASE_SERVICE_ROLE_KEY` 与默认关闭的 `V3A_ADMIN_REVIEW_WRITES_ENABLED`

## Send SMS Hook 本地实现合同（2026-07-15）

- 新增单一 `api/v3a-send-sms-hook.js`，仅接受 Supabase Auth 的 HTTPS POST 回调；不接受浏览器同源请求作为发送依据。
- Hook 读取原始请求体并验证 Standard Webhooks 的 id、timestamp、signature；只接受 `+86` 中国大陆手机号和 6 位 OTP。
- 验签通过后只把去掉 `+86` 的 11 位号码与当前 OTP 交给阿里云 `SendSms`；只有阿里云返回 `Code = OK` 才视为已受理。
- KV 幂等 key 和状态只保存 HMAC 摘要，不保存原始 webhook id、手机号或 OTP。阿里云结果不明时保留短期 claim，禁止盲目重发。
- Hook 同时要求 Preview Project Ref、Vercel 系统的 `VERCEL_ENV=preview` 与 `VERCEL_TARGET_ENV=preview`，并由 `V3A_SEND_SMS_HOOK_ENABLED` 显式控制，默认关闭。它与 `V3A_PHONE_OTP_ENABLED` 是两道独立门禁；Production 部署即使误配业务变量也必须拒绝发送。
- KV 调用使用短超时，阿里云 SDK 禁止自动重试并限制连接/读取时间，整条 Hook 在 Supabase HTTP Hook 的 5 秒窗口前留出响应余量；错误响应遵守 Supabase Auth Hook 的 `error.http_code` / `error.message` 合同。
- 运行时还需要 `V3A_SEND_SMS_HOOK_SECRET`、`ALIYUN_SMS_ACCESS_KEY_ID`、`ALIYUN_SMS_ACCESS_KEY_SECRET`、`ALIYUN_SMS_SIGN_NAME`、`ALIYUN_SMS_TEMPLATE_CODE`、`ALIYUN_SMS_TEMPLATE_PARAM_KEY`；只允许配置在 Vercel Preview，不得写入仓库或文档。

本节只确认本地实现和自动测试合同。当前不代表已部署 Hook、已修改 Supabase Auth、已打开任何发送开关或已发送短信。
