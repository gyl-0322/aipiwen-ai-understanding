# AIPIWEN V3.0 多环境配置合同

适用环境：Vercel Preview、Vercel Production。

本文只记录变量名称和用途，不记录任何变量值。Preview 与 Production 必须分别配置，禁止跨环境复用凭据或存储实例。

## 1. 环境判定原则

运行代码不根据 `VERCEL_ENV` 或 `VERCEL_TARGET_ENV` 判断 Preview/Production，也不保存任何 Supabase Project Ref。

每个环境必须声明：

- `V3A_SUPABASE_PROJECT_REF`
- `V3A_SUPABASE_URL`

服务端解析 `V3A_SUPABASE_URL` 后，必须同时满足：

- 使用 HTTPS；
- 不包含用户名、密码、端口、路径、查询参数或 fragment；
- hostname 与 `${V3A_SUPABASE_PROJECT_REF}.supabase.co` 完全一致。

缺少变量或两者不一致时，Session、管理接口与 SMS Hook 必须关闭并返回配置错误，不得发起 Supabase 或短信供应商请求。

## 2. Preview 环境变量

### Supabase 与 Session

| 变量 | 用途 |
| --- | --- |
| `V3A_SUPABASE_PROJECT_REF` | 声明当前 Preview Supabase Project Ref |
| `V3A_SUPABASE_URL` | Preview Supabase canonical HTTPS origin |
| `V3A_SUPABASE_ANON_KEY` | BFF 调用 Supabase Auth 的 anon key |
| `V3A_SUPABASE_SERVICE_ROLE_KEY` | 管理端服务端操作所需的 service role key |
| `V3A_SESSION_ENCRYPTION_KEY` | AES-GCM 加密服务端 Session；必须为独立随机密钥 |
| `V3A_ALLOWED_ORIGIN` / `V3A_ALLOWED_ORIGINS` | Preview 允许的同源入口 |
| `V3A_PHONE_OTP_ENABLED` | Phone OTP 显式启用开关 |

### KV

| 变量 | 用途 |
| --- | --- |
| `KV_REST_API_URL` | Preview Session 与限流使用的独立 KV REST URL |
| `KV_REST_API_TOKEN` | Preview KV 写入凭据 |
| `KV_REST_API_READ_ONLY_TOKEN` | Preview KV 只读凭据（使用方需要时） |
| `KV_URL` / `REDIS_URL` | Preview KV/Redis 兼容连接配置（使用方需要时） |

### SMS

| 变量 | 用途 |
| --- | --- |
| `V3A_SEND_SMS_HOOK_ENABLED` | Send SMS Hook 显式启用开关 |
| `V3A_SEND_SMS_HOOK_SECRET` | Preview Supabase Auth Hook 签名验证密钥 |
| `ALIYUN_SMS_ACCESS_KEY_ID` | Preview SMS 供应商访问标识 |
| `ALIYUN_SMS_ACCESS_KEY_SECRET` | Preview SMS 供应商访问密钥 |
| `ALIYUN_SMS_SIGN_NAME` | Preview 短信签名 |
| `ALIYUN_SMS_TEMPLATE_CODE` | Preview 验证码模板 |
| `ALIYUN_SMS_TEMPLATE_PARAM_KEY` | Preview 模板验证码参数名 |

## 3. Production 环境变量

### Supabase 与 Session

| 变量 | 用途 |
| --- | --- |
| `V3A_SUPABASE_PROJECT_REF` | 声明当前 Production Supabase Project Ref |
| `V3A_SUPABASE_URL` | Production Supabase canonical HTTPS origin |
| `V3A_SUPABASE_ANON_KEY` | BFF 调用 Production Supabase Auth 的 anon key |
| `V3A_SUPABASE_SERVICE_ROLE_KEY` | Production 管理端服务端操作所需的 service role key |
| `V3A_SESSION_ENCRYPTION_KEY` | AES-GCM 加密 Production Session；必须为独立随机密钥 |
| `V3A_ALLOWED_ORIGIN` / `V3A_ALLOWED_ORIGINS` | Production 允许的同源入口 |
| `V3A_PHONE_OTP_ENABLED` | Production Phone OTP 显式启用开关 |

### KV

| 变量 | 用途 |
| --- | --- |
| `KV_REST_API_URL` | Production Session 与限流使用的独立 KV REST URL |
| `KV_REST_API_TOKEN` | Production KV 写入凭据 |
| `KV_REST_API_READ_ONLY_TOKEN` | Production KV 只读凭据（使用方需要时） |
| `KV_URL` / `REDIS_URL` | Production KV/Redis 兼容连接配置（使用方需要时） |

### SMS

| 变量 | 用途 |
| --- | --- |
| `V3A_SEND_SMS_HOOK_ENABLED` | Production Send SMS Hook 显式启用开关 |
| `V3A_SEND_SMS_HOOK_SECRET` | Production Supabase Auth Hook 签名验证密钥 |
| `ALIYUN_SMS_ACCESS_KEY_ID` | Production SMS 供应商访问标识 |
| `ALIYUN_SMS_ACCESS_KEY_SECRET` | Production SMS 供应商访问密钥 |
| `ALIYUN_SMS_SIGN_NAME` | Production 短信签名 |
| `ALIYUN_SMS_TEMPLATE_CODE` | Production 验证码模板 |
| `ALIYUN_SMS_TEMPLATE_PARAM_KEY` | Production 模板验证码参数名 |

## 4. 强制隔离

Preview 与 Production 必须独立：

- `V3A_SESSION_ENCRYPTION_KEY`
- KV/Redis instance 及其访问凭据
- `V3A_SEND_SMS_HOOK_SECRET`
- Supabase Project、URL、anon key 与 service role key
- SMS 供应商访问凭据

不得把 Preview Session 解密密钥、KV 数据、Hook 签名密钥或 Supabase 凭据复制到 Production，反之亦然。

## 5. Session 开关决定

本合同不新增 `V3A_SESSION_DISABLED`。

Session 默认按既有 BFF 设计工作；只有在全部必需环境配置合法且一致时才开放。缺失或错配配置会安全关闭服务，因此无需增加第二个容易误配的总开关。

## 6. 不变的安全架构

- Supabase Auth
- BFF Session
- HttpOnly Cookie
- AES-GCM Session
- CSRF
- Error Observability
- RLS

本合同不引入第二套 Session、自签 JWT 或新的身份体系。
