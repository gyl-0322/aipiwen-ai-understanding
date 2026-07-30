# AIPIWEN Advisor Report Entry Phase A-2 Runtime Permission Fix Report

## 0. 结论

- 状态：**PASS / READY FOR CLAUDE REVIEW**
- 两个阻塞均已关闭：
  1. authenticated 可通过 020 的 RLS policy 读取 `advisor_clients` 与 `advisor_reports`；
  2. `v3a-report-import` 的异步 action 异常由统一 `try/catch` 转换为标准 JSON。
- 本次仅修改补充 migration、报告导入 BFF、对应测试与本报告。
- 未修改 migration 020、Auth、BFF Session、业务模型、前端、积分或身份生命周期。
- 未执行 Production migration/deploy，未进入 Phase B。

## 1. 根因

### 1.1 RLS helper permission denied

`v3a_current_user_id()`、`v3a_current_role()`、`v3a_current_status()`、`v3a_is_super_admin()` 均位于 `public` schema，均为 `SECURITY DEFINER`，并已固定 `search_path = public, pg_temp`。

历史安全加固 migration 008/019 只保留了以下三个 helper 给 `authenticated`：

- `v3a_current_user_id()`
- `v3a_current_status()`
- `v3a_is_super_admin()`

当时的最终 RLS policy 不再依赖 `v3a_current_role()`，因此该函数的 authenticated EXECUTE 被撤销。migration 020 新增的两条读取 policy 再次调用 `v3a_current_role()`，却没有恢复这一项最小权限，运行时因此返回：

```text
42501: permission denied for function v3a_current_role
```

### 1.2 异步错误绕过统一 JSON 处理

`api/v3a-report-import.js` 的 handler 在 `try/catch` 内直接返回以下 Promise：

- `handleStatus(...)`
- `handleExtract(...)`
- `handleConfirm(...)`

没有 `await` 时，异步拒绝可能在 handler 离开 `try` 后发生，绕过标准 `HttpError` JSON 转换，表现为 Vercel 500 HTML。

## 2. 修复方式

### 2.1 最小权限修复

新增 migration 021，只处理 `v3a_current_role()`：

1. preflight 验证函数位于 `public`、返回 `text`、为 `SECURITY DEFINER`、固定安全 search path；
2. 验证 migration 020 的两条 policy 确实引用该 helper；
3. 先从 `public`、`anon`、`authenticated`、`service_role` 撤销该函数全部权限；
4. 仅向 `authenticated` 授予 EXECUTE；
5. postflight 验证 `authenticated=true`、`anon=false`、`service_role=false`；
6. 验证另外三个既有 helper 的 authenticated 权限仍然存在。

没有授权无关函数，也没有向 anon 或 service_role 扩权。

### 2.2 BFF 异步错误修复

以下三个分支均改为在统一 `try/catch` 内 `return await`：

- `handleStatus`
- `handleExtract`
- `handleConfirm`

没有改变请求契约、业务流程、Session、CSRF、RPC 或错误码设计。

## 3. 新增 Migration

- 文件：`supabase/migrations/021_v3a_advisor_report_rls_helper_permissions.sql`
- SHA-256：`d7c69303a20542925e49e1dd4a2bbca74d5e107d940ce15a973414a60c4d02a7`
- 事务：单事务，包含 preflight 与 postflight。
- Preview 执行结果：成功，未返回行。
- Production：未执行。
- migration 020：内容未修改。

## 4. 权限变化

| 函数 | authenticated | anon | service_role | 本次变化 |
|---|---:|---:|---:|---|
| `v3a_current_role()` | EXECUTE | 无 | 无 | 仅恢复 authenticated |
| `v3a_current_user_id()` | EXECUTE | 无 | 无 | 无变化 |
| `v3a_current_status()` | EXECUTE | 无 | 无 | 无变化 |
| `v3a_is_super_admin()` | EXECUTE | 无 | 无 | 无变化 |

真实 Preview Session 验证：

- `advisor_clients` authenticated RLS 读取：PASS；
- `advisor_reports` authenticated RLS 读取：PASS；
- 不再出现 42501。

## 5. API 修复与真实验证

Preview Deployment：

- Deployment ID：`dpl_3LR8cLeysAecC9nieEykkYFyx5yY`
- URL：`https://aipiwen-ai-understanding-an5kl3qvt-guo-yanling-s-projects.vercel.app`
- Stable Preview Alias：`https://aipiwen-ai-understanding-gyl0322-8747-guo-yanling-s-projects.vercel.app`
- 创建时间：2026-07-29 03:44:54 PDT
- Target：Preview
- 状态：READY

真实已登录 Session 结果：

- `GET /api/v3a-customers`：200 JSON，PASS；
- 带 `advisor_id` 查询参数：200，结果总数与不带参数一致，服务端仍从 Session 推导 advisor，PASS；
- `GET /api/v3a-report-import?id=<不存在的合法 UUID>`：404 JSON；
- 错误码：`REPORT_NOT_FOUND`；
- Content-Type：JSON；
- 未返回 Vercel 500 HTML。

该隔离 404 请求先执行 `advisor_reports` 的真实 Session/RLS 查询，因此同时证明报告表读取权限已恢复。

## 6. 测试结果

- 专项测试：93 项 PASS；
- 全仓库 JS 测试：15 个脚本 PASS；
- Node check：PASS；
- git diff check：PASS；
- Preview build：PASS；
- Vercel Function Budget：12/12 PASS；
- migration 演练：PASS。

本地 PostgreSQL 演练顺序：

1. 使用 020 + 安全加固后的旧 helper 权限复现 `v3a_current_role` 42501；
2. 执行 021；
3. authenticated 读取两张表均返回成功；
4. 最终权限为 `authenticated=true / anon=false / service_role=false`；
5. 临时数据库已删除，临时创建的 rehearsal 角色已清理。

Preview Vercel 运行日志：

- customers 请求为 200；
- 隔离错误请求为 404；
- 未出现手机号、儿童姓名、客户内容、Cookie、Session、token 或 secret；
- 仅见 Node/Vercel 的 `url.parse()` DEP0169 警告，不影响本次两个修复门禁。

## 7. 是否进入 Claude Review

**是。当前状态为 READY FOR CLAUDE REVIEW。**

建议 Claude 复核：

1. migration 021 是否保持单函数、单角色的最小授权；
2. 020 的两条 policy 是否仅依赖四个已审核 helper；
3. 三个 handler 分支的 `await` 是否完整覆盖异步拒绝；
4. 真实 Preview 200/404 JSON 证据是否足以关闭 Phase A-2 两个阻塞。

本报告不授权 Production，也不授权 Phase B。
