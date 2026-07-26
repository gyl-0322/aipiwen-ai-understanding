# AIPIWEN V3.0 Sprint 03A Production Environment Adaptation Report

状态：**IMPLEMENTATION COMPLETE — WAITING FOR CLAUDE REVIEW**

记录时间：2026-07-25 08:15:02 PDT
基线 Commit：`afb7aa75dd6ca5f329c9943340e68fd4158ee25e`
Production deploy：**否**

## 1. 修改文件

运行代码：

- `server/v3a-session-store.js`
- `server/v3a-sms-hook.js`
- `scripts/v3a-bind-first-admin-phone.js`

测试：

- `scripts/test-v3a-httponly-session.js`
- `scripts/test-v3a-admin-flow.js`
- `scripts/test-v3a-send-sms-hook.js`
- `scripts/test-v3a-bind-first-admin-phone.js`
- `scripts/test-advisor-page-contract.js`

文档：

- `docs/AIPIWEN_V3_PRODUCTION_ENVIRONMENT_CONFIG.md`（新增）
- `docs/V3A_FIRST_SUPER_ADMIN_PHONE_BINDING.md`
- `docs/AIPIWEN_V3_PRODUCTION_ENVIRONMENT_ADAPTATION_REPORT.md`（新增）

未修改 Supabase migration、Auth、Session 数据结构、身份模型、积分模型或身份生命周期。

## 2. 环境隔离设计

实现 Claude 批准的方案 B：

- 代码不判断当前运行环境名称；
- 不读取 `VERCEL_ENV` 或 `VERCEL_TARGET_ENV` 作为 Preview/Production 安全门禁；
- 运行代码和测试不保存任何真实 Supabase Project Ref；
- 每个环境通过 `V3A_SUPABASE_PROJECT_REF` 与 `V3A_SUPABASE_URL` 声明自己的 Supabase；
- 服务端只验证当前声明的 Project Ref 与 URL hostname 是否一致。

Supabase URL 必须：

- 使用 HTTPS；
- 不含用户名、密码、端口、路径、查询参数或 fragment；
- hostname 精确等于 `${projectRef}.supabase.co`；
- origin 精确等于规范化后的 `V3A_SUPABASE_URL`。

缺失或错配时返回 503，并在任何 Supabase、KV 或 SMS 供应商请求前停止。

## 3. Session 适配结果

`server/v3a-session-store.js` 已：

- 删除 Preview/Production Project Ref 常量；
- 删除 Production 拒绝逻辑；
- 删除 `VERCEL_ENV=preview` 与 `VERCEL_TARGET_ENV=preview` 限制；
- 改为强制读取 `V3A_SUPABASE_URL`；
- 保留 Supabase URL、KV URL、Allowed Origin、AES-GCM key、Phone OTP 等原安全校验；
- 保留 BFF Session、HttpOnly Cookie、AES-GCM、CSRF、限流和 Session refresh 设计。

两个不同的合成环境在 URL/Project Ref 一致时均通过；URL/Project Ref 错配、缺失或 URL 非 canonical 时均在网络请求前拒绝。

`V3A_SESSION_DISABLED` 决定：**不实现**。现有必需配置校验已经提供安全关闭能力，新增总开关会扩大误配置面。

## 4. SMS Hook 适配结果

`server/v3a-sms-hook.js` 已：

- 删除 Preview/Production Project Ref 常量；
- 删除 Production 拒绝逻辑；
- 删除 Vercel 环境名称判断；
- 新增 `V3A_SUPABASE_URL` 与 `V3A_SUPABASE_PROJECT_REF` hostname 一致性校验；
- 保留 `V3A_SEND_SMS_HOOK_ENABLED` 显式开关；
- 保留 Hook 签名验证、幂等、防重放、KV claim、超时和供应商错误脱敏。

两个不同的合成环境在配置一致时均通过；URL/Project Ref 错配、URL 缺失或 Hook 未启用时返回 503，且不访问 KV、不发送短信。

## 5. 测试结果

| Quality Gate | 结果 |
| --- | --- |
| `vercel build --target=preview` | PASS |
| 全量 `scripts/test-*.js` | PASS，13/13 |
| 全部项目 JavaScript `node --check` | PASS，42 个文件 |
| `git diff --check` | PASS |
| Supabase migration 修改 | PASS，0 个 |

重点覆盖：

- Session 多环境一致配置通过；
- Session URL/Project Ref 错配拒绝；
- 必需的私有 `V3A_SUPABASE_URL` 缺失拒绝；
- SMS Hook 多环境一致配置通过；
- SMS Hook 错配、缺失和显式关闭拒绝；
- 管理端 Session 与同源写入保持；
- 首位管理员绑定工具只能访问当前环境声明的 Supabase；
- 浏览器端不包含 Supabase Project URL。

测试只使用合成环境标识，不保存 Preview 或 Production 的真实 Project Ref。

## 6. 安全检查

| 检查 | 结果 |
| --- | --- |
| JavaScript 中真实 Project Ref 硬编码 | PASS，不存在 |
| Preview/Production Ref 常量 | PASS，已删除 |
| 运行时 Vercel 环境名称分支 | PASS，不存在 |
| Secret 输出 | PASS，未新增 |
| Token 输出或浏览器存储 | PASS，未新增 |
| Session/Auth/RLS 架构变化 | PASS，无变化 |
| 数据库或 Migration 修改 | PASS，0 个 |

配置文档不记录任何环境变量值，并要求 Preview 与 Production 分别使用独立的：

- Session encryption key
- KV/Redis instance 与凭据
- SMS Hook secret
- Supabase 凭据
- SMS 供应商凭据

## 7. 未完成事项

本 Sprint 按范围不执行：

- Vercel Preview/Production 环境变量写入；
- Preview 或 Production 部署；
- DNS 或 `aipiwen.cn` 切换；
- Supabase migration；
- Auth 或 SMS 供应商配置修改；
- Production smoke test。

在任何后续部署前，运维人员必须按照 `AIPIWEN_V3_PRODUCTION_ENVIRONMENT_CONFIG.md` 为 Preview 与 Production 分别配置完整变量，并确认两套 Session key、KV 和 SMS secret 不复用。

本实现到此停止，等待 Claude Review；不进入 Production Release。
