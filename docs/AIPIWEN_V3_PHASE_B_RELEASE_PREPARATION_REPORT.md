# AIPIWEN V3.0 Phase B Release Preparation Report

**报告时间**：2026-07-29 18:24 PDT
**状态**：PASS — READY FOR CLAUDE RELEASE REVIEW
**Production 状态**：未执行 migration、未部署、未修改数据

## 1. Release 范围

### 1.1 Phase A

- `supabase/migrations/020_v3a_advisor_client_tables.sql`
  - `advisor_clients`
  - `advisor_reports`
  - 创建/完成报告导入 RPC
  - RLS、状态机与幂等约束
- `supabase/migrations/021_v3a_advisor_report_rls_helper_permissions.sql`
  - 仅补充 RLS 运行所需 helper 权限
  - 不扩大 anon 或无关函数权限
- `api/v3a-report-import.js`
  - extract / confirm / status BFF
  - Session、CSRF、SameOrigin 与统一 JSON 错误处理

### 1.2 Phase B Attribution

- `supabase/migrations/022_v3a_advisor_attribution.sql`
  - `attribution_tokens`
  - `advisor_qr`、`advisor_import`、`unguided`
  - `source` 不可变
  - 总部 assign 与 `ASSIGN_CLIENT` 审计
- `api/v3a-attribution.js`
- `api/v3a-admin.js`
- `report-upload.html`
- `ai-interpreter-customers.html`
- `admin-unassigned.html`
- `static/v3a-attribution.js`
- `static/v3a-admin-unassigned.js`
- `vercel.json` 的对应 route/function 注册

Phase B 复用既有 Report Engine，没有建立第二套 OCR 或报告生成系统。

### 1.3 Privacy Patch

- `api/generate-report.js` 的 `cases:index` 新增记录停止写入：
  - `name`
  - `ip`
- 保留：
  - `id`
  - `type`
  - `age`
  - `channel`
  - `brain`
  - `mType`
  - `plusR`
  - `createdAt`

### 1.4 测试与文档

Release commit 包含 Phase A、Phase B-1、Phase B-2、Privacy Patch 的契约测试、Review 输入、技术设计和阶段报告。Release scope audit 共确认并冻结 35 个相关文件；未删除或提交无关工作区文件。

## 2. Commit 信息

- Branch：`feature/v3a-real-auth-integration`
- Parent：`70395c3f6422f439da27e3e70bfac203b2b1380d`
- Release commit：`cec3f5dd5e8712fecc804452d32aee3e13a04398`
- Commit message：`feat: prepare v3 phase b attribution release`
- 变更统计：35 files changed，6334 insertions，19 deletions

本报告、Production Preflight 清单与 Smoke Test 方案在 Release commit 冻结后单独形成证据提交，以便报告引用精确、不可变的 Release commit；不 squash、不修改 Release commit。

## 3. 测试汇总

| Gate | 结果 |
| --- | --- |
| Phase A report import | 93/93 PASS |
| Phase B-1 attribution | 64/64 PASS |
| Phase B-2 hardening | 16/16 PASS |
| Privacy Patch | 3/3 PASS |
| 全部 JS 测试脚本 | 18/18 PASS |
| Node syntax check | 51/51 PASS |
| Vercel Function budget | 12/12 PASS |
| Vercel local build | PASS |
| `git diff --check` | PASS |

测试中的 SMS provider 错误输出来自隔离的失败路径断言，测试进程退出码为 0，不代表 Production SMS 配置回归。

## 4. Production 环境检查

### 4.1 Vercel 与 Domain

- Project：`aipiwen-ai-understanding`
- 当前 Production deployment：Ready
- 当前 Deployment ID：`dpl_DsSdjdr4gLK4jwDthHgGHBcRXxo1`
- `www.aipiwen.cn`、`aipiwen.cn` 当前 alias 正确
- `/`：人格理解系统首页，HTTP 200
- `/advisor`：指导师登录入口，HTTP 200
- Node.js 24；未发现错误 build/output 配置
- 所需 Production 环境变量名称均存在；未读取值

### 4.2 Supabase

- Production project：`tysbwijizgebnrazxpvo`
- 019 注册基线对象存在
- 020、021、022 尚未作为 Phase B Release 执行
- 当前实际对象状态与计划一致
- 未发现额外 migration 需求

Production 没有 migration history 表，因此本次使用表、RPC 签名与权限的只读对象审计确认状态。正式执行必须按 `020 → 021 → 022` 顺序进行，并另行取得明确授权。

### 4.3 Auth 与 Session

- Phone OTP capability：启用
- Session capabilities：200
- 未登录 identity request：401 `UNAUTHENTICATED`
- 未出现 Session 503
- active super_admin 与 active advisor 均存在，满足后续受控 Smoke Test 前置条件

## 5. 已知限制

1. Production migration 020、021、022 尚未执行；这是预期 Release 边界，不是遗漏。
2. Production deploy 尚未执行。
3. Privacy Patch 只停止新增 `cases:index` PII，不读取、清理或修改历史 KV。
4. 总部无归属池 UI 为只读 MVP；assign 通过受保护的管理 API 执行。
5. agent / center 权限、PDF、批量上传、自动智能分配、CRM、AI Coach 与 Phase C 不在范围内。
6. 域名平台仍显示旧项目历史关联，但当前实际 alias 与页面响应正确。

## 6. Beta 建议

结论：**建议进入受控 Production Release 执行阶段，但不得在当前 Sprint 自动发布。**

进入下一步前必须：

1. 通过 Claude Release Review；
2. 单独授权并执行 Production migrations `020 → 021 → 022`；
3. 单独授权部署精确 Release commit `cec3f5dd5e8712fecc804452d32aee3e13a04398`；
4. 按 `docs/AIPIWEN_V3_PHASE_B_PRODUCTION_SMOKE_TEST_PLAN.md` 完成最小真实验收；
5. 仅在归属、权限、审计与隐私全部 PASS 后邀请受控 Beta 用户。

## 7. Sprint 边界确认

- 新功能：未增加
- 架构：未调整
- 数据模型：除已冻结 020/021/022 外未扩展
- Production migration：未执行
- Production deploy：未执行
- Production 数据：未修改
- Phase C / AI Coach：未进入
