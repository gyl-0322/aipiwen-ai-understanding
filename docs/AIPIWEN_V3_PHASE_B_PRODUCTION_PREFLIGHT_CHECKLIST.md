# AIPIWEN V3.0 Phase B Production Preflight Checklist

**检查时间**：2026-07-29 18:24 PDT
**Release commit**：`cec3f5dd5e8712fecc804452d32aee3e13a04398`
**状态**：PASS — 等待单独的 Production migration 与 deploy 授权

本清单只记录只读检查结果。检查过程未读取或输出任何 secret，未执行 Production migration，未执行 Production deploy。

## 1. Release 身份

- [x] Branch：`feature/v3a-real-auth-integration`
- [x] Release commit：`cec3f5dd5e8712fecc804452d32aee3e13a04398`
- [x] Commit message：`feat: prepare v3 phase b attribution release`
- [x] Release 包含 migration 020、021、022
- [x] Release 包含 Attribution API、工作台入口、总部无归属池、测试和文档
- [x] Release 包含 `cases:index` 停止新增 `name`、`ip` 的 Privacy Patch

## 2. Vercel Production

### 2.1 项目与部署

- [x] Project：`aipiwen-ai-understanding`
- [x] 当前 Production deployment 状态：Ready
- [x] 当前 Production deployment ID：`dpl_DsSdjdr4gLK4jwDthHgGHBcRXxo1`
- [x] 当前 Production URL：`https://aipiwen-ai-understanding-93vkf2h4s-guo-yanling-s-projects.vercel.app`
- [x] `www.aipiwen.cn` 与 `aipiwen.cn` 当前 alias 指向上述 Production deployment
- [x] 根路径 `/` 返回人格理解系统首页
- [x] `/advisor` 返回指导师登录入口

说明：域名检查中可见旧项目的历史关联记录，但当前实际 alias 和 HTTP 响应均指向正确 Production deployment，不构成本次发布阻塞。

### 2.2 Build 与 Function 配置

- [x] Vercel 项目关联正确
- [x] Node.js runtime：24
- [x] 未发现错误的 framework、build 或 output 覆盖
- [x] Function budget：12/12，包含 Phase B Attribution functions
- [x] 本地 Vercel build：PASS

### 2.3 Production 环境变量存在性

以下仅确认变量名称存在于 Production scope，未读取值：

- [x] `V3A_SUPABASE_PROJECT_REF`
- [x] `V3A_SUPABASE_URL`
- [x] `V3A_SUPABASE_ANON_KEY`
- [x] `V3A_SUPABASE_SERVICE_ROLE_KEY`
- [x] `V3A_SESSION_ENCRYPTION_KEY`
- [x] `KV_REST_API_URL`
- [x] `KV_REST_API_TOKEN`
- [x] `KV_REST_API_READ_ONLY_TOKEN`
- [x] `V3A_ALLOWED_ORIGIN`
- [x] `V3A_ALLOWED_ORIGINS`
- [x] `V3A_PHONE_OTP_ENABLED`
- [x] `V3A_SEND_SMS_HOOK_ENABLED`
- [x] `V3A_SEND_SMS_HOOK_SECRET`
- [x] `ALIYUN_SMS_ACCESS_KEY_ID`
- [x] `ALIYUN_SMS_ACCESS_KEY_SECRET`
- [x] `ALIYUN_SMS_SIGN_NAME`
- [x] `ALIYUN_SMS_TEMPLATE_CODE`
- [x] `ALIYUN_SMS_TEMPLATE_PARAM_KEY`
- [x] `ADMIN_SECRET`

## 3. Production Supabase

- [x] Project ref：`tysbwijizgebnrazxpvo`
- [x] 019 注册基线对象存在
- [x] `advisor_clients`、`advisor_reports` 当前不存在
- [x] migration 020 的两个 RPC 当前不存在
- [x] migration 021 所需的 helper 基线存在
- [x] `attribution_tokens` 当前不存在
- [x] migration 022 的 Attribution RPC 当前不存在
- [x] Production 当前状态与计划一致：020、021、022 尚未执行
- [x] 未发现需要加入 Release 的额外 migration
- [x] 本次检查未写数据库

Production 未安装 `supabase_migrations.schema_migrations` 历史表，因此迁移状态按实际对象、函数签名与权限做只读核验。正式发布时必须严格按 `020 → 021 → 022` 顺序执行，并在每一步验证事务 postflight。

## 4. Auth 与 Session

- [x] Phone OTP capability：启用
- [x] Session capabilities endpoint：200
- [x] 未登录访问 Session identity endpoint：401 `UNAUTHENTICATED`
- [x] 未出现 Session 配置 503
- [x] Production 存在 active `super_admin` 与 active `advisor`，可用于授权后的最小 Smoke Test

## 5. Go / No-Go 清单

正式发布前必须逐项满足：

- [ ] 获得 Production migration 020、021、022 的单独明确授权
- [ ] 确认 SQL Editor 选择 `tysbwijizgebnrazxpvo`
- [ ] 按 `020 → 021 → 022` 执行并保存 postflight 结果
- [ ] 获得部署 Release commit 的单独明确授权
- [ ] 部署精确 commit `cec3f5dd5e8712fecc804452d32aee3e13a04398`
- [ ] 执行 `AIPIWEN_V3_PHASE_B_PRODUCTION_SMOKE_TEST_PLAN.md`
- [ ] 发现权限、隐私、Session、归属或审计异常时立即停止

## 6. 本 Sprint 边界确认

- Production migration：**未执行**
- Production deploy：**未执行**
- Production 数据：**未修改**
- Phase C / AI Coach：**未进入**
