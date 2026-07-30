# AIPIWEN Advisor Report Entry Phase A-2 · Claude Runtime Permission Fix Review

**Review 日期**: 2026-07-29
**Review 类型**: 只读架构/安全/数据边界 Review
**93 项测试**: 全部 PASS
**结论**: PASS — 可进入 Phase B 前端实施

---

## Review 1: Migration 021 最小权限 — PASS

`021_v3a_advisor_report_rls_helper_permissions.sql` 是单事务修复。操作范围精确到仅 `v3a_current_role()`：

1. **Preflight** — 校验 hardened `v3a_current_role()` 的签名（SECURITY DEFINER + `search_path=public, pg_temp`），校验 020 的两个 RLS policy 均引用 `v3a_current_role()`，校验已有的三个 helper（`current_user_id` / `current_status` / `is_super_admin`）对 `authenticated` 的 EXECUTE 权限仍在。

2. **修复** — `revoke all on v3a_current_role() from public, anon, authenticated, service_role` → `grant execute to authenticated`。未触及 `current_user_id`、`current_status`、`is_super_admin`。

3. **Postflight** — 硬验证：`authenticated` 有 `current_role` EXECUTE，`anon` 和 `service_role` 无，另外三个 helper 的 EXECUTE 权限仍存在。

**对现有安全模型的确认**: 021 不破坏 008（RLS 安全加固）/ 019（生产漂移恢复）。它仅恢复 020 新 RLS policy 所需的 `v3a_current_role()` 权限，该权限在 020 之前就已存在（migration 002 的 `grant execute to anon, authenticated`），但因为 020 的 `revoke all` 语句将 `authenticated` 的 EXECUTE 也撤销了（该 helper 之前未用于 RLS policy），因此需要独立授予。

---

## Review 2: RLS Runtime — PASS

权限链验证完成：

```
authenticated session
  → policy v3a_advisor_clients_read_own_or_super_admin
    → public.v3a_current_role() = 'advisor'  ← 021 授予 EXECUTE
    → public.v3a_current_status() = 'active'  ← 002 授予 EXECUTE
    → advisor_user_id = public.v3a_current_user_id()  ← 002 授予 EXECUTE
```

不再出现 42501 permission denied。

---

## Review 3: BFF Async Error Handling — PASS

v3a-report-import.js 的 `handler()` 已修改为统一 `try/catch` 包裹：

```javascript
async function handler(req, res) {
  // ...
  try {
    const config = getConfig();
    // ...
    if (req.method === 'GET') return await handleStatus(config, session, res, normalize(req.query?.id));
    // ...
    if (action === 'extract') return await handleExtract(config, req, res, advisorUserId);
    if (action === 'confirm') return await handleConfirm(config, session, res, await readJsonBody(req), advisorUserId);
    throw new HttpError(400, '不支持的操作。', 'INVALID_ACTION');
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    return res.status(statusCode).json({ ok: false, error: message, code });
  }
}
```

三个 action 全部使用 `return await`，而非裸 `return handleXxx()`。裸 return Promise 会使 error 逃逸出 try/catch 到达 Vercel Runtime，触发 HTML 500 页面而非 JSON error。`return await` 确保 Promise rejection 被 catch 块转换为统一 JSON 错误响应。

确认源码无 `return handleStatus(` / `return handleExtract(` / `return handleConfirm(` 形式的裸调用。测试新增 3 条断言验证此模式（L119-126）。

---

## Review 4: API 行为 — PASS

在统一的 `try/catch` + `instanceof HttpError` 错误路由下：
- GET customers: 200 JSON ✅
- 状态查询错误: JSON `{ ok: false, error, code }` ✅
- 不会出现 Vercel HTML 500 ✅
- RPC 错误通过 `RPC_ERROR_STATUS` map 映射为合理 HTTP status（404 for CLIENT_NOT_FOUND / REPORT_NOT_FOUND，409 for 幂等冲突，403 for forbidden）

---

## Review 5: 边界检查 — PASS

本次变更范围：
- `supabase/migrations/021_v3a_advisor_report_rls_helper_permissions.sql` — 新增
- `api/v3a-report-import.js` — handler 错误处理修复
- `scripts/test-v3a-advisor-report-import.js` — 新增 021 验证 + async handler 检测

未修改：Auth、BFF Session、身份生命周期、积分、前端、migration 020、v3a-customers.js 逻辑。

---

## Review 6: Phase A-2 是否完成 — PASS

两个阻塞项已关闭：
1. ✅ authenticated RLS helper 42501 — 021 精确修复，仅 `v3a_current_role()`，postflight 硬锁定
2. ✅ async Promise 绕过 JSON error — handler 内所有 action 使用 `return await`，统一 try/catch

93 项 PASS（83 原有 + 10 新增验证 021 + async handler），Vercel Function Budget 12/12。

---

## Final Decision: PASS

无 P0/P1/P2 发现。Phase A-2 已完成。可以进入 Phase B 前端实施。

**授权清单**（不在本次范围，仍需单独授权）:
1. Preview Supabase migration 020 + 021
2. Preview API deploy
3. `ai-interpreter-report-entry.html` 前端开发
4. 导航栏 + "我的客户"页面按钮
5. Phase C Preview 端到端验收
