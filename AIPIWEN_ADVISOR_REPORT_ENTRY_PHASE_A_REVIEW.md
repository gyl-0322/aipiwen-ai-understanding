# AIPIWEN Advisor Report Entry Phase A · Claude 架构与安全 Review

**Review 日期**: 2026-07-29
**Review 类型**: 只读架构/安全/数据边界/隐私 Review
**Review 范围**: Phase A 全部交付物（Codex 修正版）
**83 项测试**: 全部 PASS
**结论**: PASS

---

## Review 1: Migration 020 数据模型 — PASS

**v3a_create_advisor_report_import RPC** 将客户创建和报告创建包裹在单一 `begin...exception...end` 块内。客户端参数先校验（`p_idempotency_key` 非空、structured_input 非空对象、客户 XOR），通过后进入事务块：查找或插入客户 → 计算年龄 → 插入报告。`unique_violation` 时回退为 idempotency 路径，返回已有报告。同一事务内客户与报告同时存在或同时不存在——原子性闭包完整。

**v3a_complete_advisor_report_import** 从 `auth.uid()` 推导归属，联查 `advisor_clients` 确认报告属于当前指导师，再检查 `v_current_status <> 'generating'` 防止非法跃迁。仅允许 `generating → ready` 或 `generating → failed`。

**检查通过项**:
- 单事务边界（`begin; ... commit;`）
- RPC 参数签名不含 `p_advisor_user_id` 或等效参数
- `auth.uid()` 是 advisor 身份的唯一推导源
- `idempotency_key` UNIQUE 约束 + `unique_violation` 并发处理
- 重复提交返回已有报告，payload 不匹配返回 `IDEMPOTENCY_PAYLOAD_MISMATCH`
- `failed` 状态可直接重试（RPC 自动重置为 `generating`）
- Postflight 断言锁定 `authenticated` 无表级 INSERT/UPDATE 权限

---

## Review 2: RPC 与权限模型 — PASS

当前权限设计：`authenticated` 对 `advisor_clients` 和 `advisor_reports` 仅有 `SELECT`。所有写操作通过两个 `SECURITY DEFINER` RPC 完成，RPC 内部从 `auth.uid()` 推导 advisor 身份。

**RPC 权限**: `revoke all ... from public, anon, authenticated, service_role` → `grant execute to authenticated`。`anon` 和 `service_role` 均被显式排除。

**RLS**: 两张表均启用 RLS，SELECT policy 要求 `v3a_current_role() = 'advisor'` + `v3a_current_status() = 'active'`。advisor_reports 的 SELECT 通过 `exists` 联查 advisor_clients 间接验证归属。

**Postflight**: 事务内的 postflight DO block 在 `commit` 前验证 (a) `authenticated` 无表级 INSERT/UPDATE 权限， (b) `authenticated` 有 RPC EXECUTE 权限， (c) `anon` 和 `service_role` 无 RPC EXECUTE 权限。

---

## Review 3: BFF 客户查询 — PASS

`GET /api/v3a-customers` 不接受任何 `advisor_id` 或等效参数。`requireActiveAdvisor()` 从 Session 推导 `auth_user_id`，查 `users` 表确认 `role = 'advisor'` + `status = 'active'`，再从 `advisor_clients` 按 `advisor_user_id` 过滤。客户端无法通过修改请求参数读取他人的客户。首期仅允许 `role === 'advisor'`，明确排除了 agent/center。

---

## Review 4: 报告导入 BFF — PASS

### 幂等设计

浏览器端生成一次性的 `idempotencyKey`，BFF 读取后传给 `v3a_create_advisor_report_import`。RPC 在插入前先查询已有报告：
- **相同 key + 相同归属 + 相同 payload** → 返回已有报告
- **相同 key + 不同归属** → `IDEMPOTENCY_KEY_CONFLICT`（409）
- **相同 key + 不同 payload** → `IDEMPOTENCY_PAYLOAD_MISMATCH`（409）
- **相同 key + status = failed** → 自动重置为 `generating`（retry）

### OCR 契约

`callExtract()` 将图片转 Base64，POST 到 `/api/extract-fp`（现有 Vercel API），契约匹配：`{ imageBase64: string, imageMimeType: string }`。返回通过 `validateFingers()` 二次校验，过滤 `raw` 字段后返回前端。

### BFF 安全属性

- `module.exports.config = { api: { bodyParser: false } }` — multipart 手动解析
- `X-CSRF-Token` 仅在 POST action 要求
- `requireSameOrigin` 覆盖所有 POST
- `x-forwarded-for` 头标记为 `v3a-{advisor_hash}` 的不可逆配额标识
- BFF 无 `console.log` / `console.error` — 日志无泄漏

---

## Review 5: TRC 与归属安全 — PASS

`handleConfirm()` 在 BFF 内调用 `TRCEngine.computeFingerprintEngineResult()` 在服务端计算 engineResult。前端提交的 `extractedData.fingers` 已经过 `validateFingers()` 二次校验（纹型白名单 + TRC 0-40 范围 + 十指完整性）。`advisor_client_id` 由 RPC 返回，不从浏览器输入获取。

---

## Review 6: 状态机 — PASS

`advisor_reports` 表约束：`draft | reviewed | generating | ready | failed`。`v3a_complete_advisor_report_import` 内硬检查 `v_current_status <> 'generating' → INVALID_REPORT_TRANSITION`。仅允许 `generating → ready` 或 `generating → failed`。

---

## Review 7: CSRF 设计 — PASS

`requireActiveAdvisor()` 接收 `csrfRequired` 参数。`extract`（multipart 上传）和 `confirm`（JSON body）传 `true`，调用 `requireCsrf()`。GET 查询传 `false`，不要求 CSRF。与现有 `api/v3a-session.js` 的 CSRF 模型一致。

---

## Review 8: OCR 隐私审查 — PASS

`api/extract-fp.js` 日志仅使用 `console.warn` 输出结构化警告（纹型识别异常），不含 Base64 图片数据、儿童姓名、手机号。BFF 层 `callExtract()` 无 `console.log`，返回前过滤 `raw` 字段。

---

## Review 9: Vercel Function Budget — PASS

12/12 PASS。当前 api/ 目录下 .js 文件恰好 12 个，满足 Hobby 上限。新增 `v3a-customers.js` 和 `v3a-report-import.js` 后不超限。

---

## Review 10: 测试真实性 — PASS

83 项检查覆盖四层：

**源码契约层** (L32-96): `mustMatch` / `mustNotMatch` 直接读取 migration SQL 和 BFF 源码，正则验证表约束、RPC 签名、权限语句和 BFF 模式。

**纯函数层** (L98-182): 调用导出的 `_test` 对象，真实执行 `validateFingers`、`validateConfirmBody`、`parseMultipartFile`、`sanitizeGeneratedReport`、`restUrl`。覆盖边界值（非法 UUID、数组 fingers、越界 TRC、缺少字段）。

**集成流层** (L210-319): 通过 `global.fetch` mock 模拟完整的 `handleConfirm` 三次：成功生成 → ready、幂等重试不重复生成、生成失败落 failed。验证真实内部 fetch 调用链（rest/v1/advisor_clients → rpc/v3a_create → /api/generate-report → rpc/v3a_complete）。

**部署契约层** (L184-192): 验证 vercel.json 路由注册 + Function 数量上限。

没有硬编码 `check(true, ...)` 类型的假断言。

---

## Final Decision: PASS

**无 P0/P1/P2 发现。**

Phase A 已达到进入 Preview migration 前的实施标准。Codex 的修正（RPC 化写操作、幂等 payload 校验、postflight 权限锁定、BFF 无 service_role 依赖、83 项真实测试）消除了 Claude 首版的两个架构缺口——浏览器直接通过 accessToken 写表，和 confirm 缺少 payload 幂等校验。

**下一步授权清单**（不在本次范围）:
1. Preview Supabase migration 020
2. Preview API deploy
3. Phase B 前端实施
4. Phase C Preview 验收
