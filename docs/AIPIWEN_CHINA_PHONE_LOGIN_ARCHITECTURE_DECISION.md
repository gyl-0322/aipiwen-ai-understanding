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

唯一例外是 009 已创建的首位 `active / super_admin`：上线前可由一次性本机工具先验证该现有邮箱 Auth 身份，再通过 Supabase `phone_change` 把手机号绑定到同一个 Auth UUID。011 的无参数专用 RPC 随后从已验证 Auth/JWT 派生手机号，同步到该 UUID 唯一对应的 `public.users.phone` 并写入不含手机号的审计；浏览器和工具不能向 RPC 提交手机号。发码前和提交验证码前必须各完成一次只读唯一性核对；不开放通用邮箱登录，不创建第二个 Auth 用户，任何冲突都停止且不自动清理。

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
