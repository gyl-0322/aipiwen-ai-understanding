# 指导师录入报告 · 技术设计 V1.1（Codex Corrected）

**日期**：2026-07-29
**类型**：Migration + RLS + BFF + API Contract + Test
**状态**：READY FOR CLAUDE REVIEW
**执行状态**：未执行 Preview migration、未部署、未实施前端
**对应产品草案**：`AIPIWEN_ADVISOR_REPORT_ENTRY_DESIGN.md` V0.2

---

## 1. Phase A 交付物

| 文件 | 作用 | 当前状态 |
|---|---|---|
| `supabase/migrations/020_v3a_advisor_client_tables.sql` | 客户/报告表、RLS、原子写入 RPC | Codex corrected，未执行 |
| `api/v3a-customers.js` | 当前指导师客户与报告摘要查询 | Codex corrected，未部署 |
| `api/v3a-report-import.js` | 图片识别、确认入库、状态查询 BFF | Codex corrected，未部署 |
| `scripts/test-v3a-advisor-report-import.js` | 源码、契约、纯函数和模拟集成测试 | 83 项真实检查 PASS |
| `scripts/test-vercel-function-budget.js` | Hobby Function 数量门禁 | 12/12 PASS |
| `vercel.json` | 两个 BFF 的函数配置 | 工作区已有，未部署 |

原“34/34 PASS”测试已废弃。原测试把每项 `pass` 写死为 `true`，没有读取或执行交付物，不能作为证据。

---

## 2. 冻结架构

保持现有：

- Supabase Auth；
- BFF Session；
- HttpOnly Cookie；
- AES-GCM Session；
- CSRF；
- RLS。

不新增第二套 Session，不把 Supabase access token 交给浏览器，不接受浏览器提交指导师归属字段。

### 2.1 写入方式

BFF 从加密 Session 取出当前用户的 Supabase access token，调用两个只授权 `authenticated` 的事务型 RPC：

- `v3a_create_advisor_report_import(...)`
- `v3a_complete_advisor_report_import(...)`

两个 RPC 均：

- 从 `auth.uid()` 推导当前业务用户；
- 只允许 `role=advisor AND status=active`；
- 不接收 `advisor_id`；
- `SECURITY DEFINER` 且固定 `search_path = pg_catalog, public`；
- 撤销 `public`、`anon`、`service_role` 执行权限；
- 只授权 `authenticated`。

本功能不读取或使用 service-role key。

---

## 3. 数据模型

### 3.1 `advisor_clients`

独立于认证账号 `users`：

```text
id                  uuid primary key
advisor_user_id     uuid not null -> users(id)
auth_user_id        uuid null -> auth.users(id)
source              invite_link | advisor_qr | advisor_import
display_name        1-40 字
birth_date          date null
note                最多 200 字
created_at          timestamptz
updated_at          timestamptz
archived_at         timestamptz null
```

`auth_user_id` 仅预留给未来独立审核的客户账号绑定流程，本次不自动填写。

### 3.2 `advisor_reports`

```text
id                  uuid primary key
advisor_client_id   uuid not null -> advisor_clients(id)
status              draft | reviewed | generating | ready | failed
source              invite_link | advisor_qr | advisor_import
source_file_path    text null，最多 512 字
structured_input    非空 JSON object
generated_report    ready 时为非空 JSON object
age_at_report       0-120 或 null
idempotency_key     uuid unique
error_code          安全错误码或 null
created_at          timestamptz
updated_at          timestamptz
```

状态约束：

- `ready`：必须有非空 `generated_report`，不能有 `error_code`；
- `failed`：必须有安全 `error_code`，不能有 `generated_report`；
- 其他状态：两者均为空。

首期不保存原始图片，`source_file_path` 保留为空。私有对象存储与30天清理任务不在 Phase A 内。

---

## 4. RLS 与表权限

两张表：

- `authenticated` 只有 SELECT；
- 没有 INSERT / UPDATE / DELETE grant；
- 没有浏览器写策略；
- active advisor 只能读取自己的客户和报告；
- active super_admin 可以读取全部；
- pending、rejected、frozen、disabled 和机构角色不能读取。

写入必须经过受控 RPC。migration 尾部包含表权限和 RPC 权限 postflight，失败则整个事务回滚。

---

## 5. 原子入库与幂等

### `v3a_create_advisor_report_import`

单事务完成：

1. 从 `auth.uid()` 确认 active advisor；
2. 校验浏览器生成的 `idempotencyKey`；
3. 精确重试返回已有客户和报告；
4. 相同 key、不同 payload 返回 `IDEMPOTENCY_PAYLOAD_MISMATCH`；
5. 校验已有客户归属，或创建 `advisor_import` 客户；
6. 创建状态为 `generating` 的报告；
7. 并发 unique conflict 在 PL/pgSQL 子事务内回滚孤立客户，再返回已有记录。

失败报告使用同一 key 重试时，RPC 将状态恢复为 `generating` 并返回 `retry=true`。

### `v3a_complete_advisor_report_import`

- 再次从 `auth.uid()` 确认 active advisor；
- 交叉校验 report → client → advisor；
- 成功时写入经过裁剪的结构化报告并标记 `ready`；
- 失败时只写安全错误码并标记 `failed`。

---

## 6. BFF API 契约

### 6.1 `GET /api/v3a-customers`

请求参数：无。特别禁止 `advisor_id`。

服务端：

1. 读取 V3A Session；
2. 确认当前业务用户是 active advisor；
3. 使用 Session access token 读取自己的未归档客户；
4. 返回每个客户的报告摘要。

响应字段：

```json
{
  "ok": true,
  "clients": [{
    "id": "uuid",
    "displayName": "客户称呼",
    "birthDate": "2018-03-15",
    "source": "advisor_import",
    "note": null,
    "createdAt": "ISO timestamp",
    "reports": [{
      "id": "uuid",
      "status": "ready",
      "createdAt": "ISO timestamp",
      "updatedAt": "ISO timestamp"
    }]
  }],
  "total": 1
}
```

### 6.2 `POST /api/v3a-report-import?action=extract`

安全门禁：Same Origin + V3A Session + CSRF + active advisor。

请求：`multipart/form-data`，字段名固定为 `file`。

限制：

- JPEG / PNG；
- magic bytes 校验；
- 最大 2.5MB；
- PDF 不支持；
- 关闭自动 body parser，手动限制 raw body。

2.5MB 是现有 `/api/extract-fp` 4MB JSON Base64 请求上限下的安全值，不能沿用原草案的10MB。

BFF 调用当前真实 OCR 契约：

```json
{
  "imageBase64": "...",
  "imageMimeType": "image/jpeg"
}
```

返回 `fingers` 为 `R1...L5` 对象，不是数组。BFF剔除 OCR `raw` 字段后再返回浏览器。

### 6.3 `POST /api/v3a-report-import?action=confirm`

安全门禁：Same Origin + V3A Session + CSRF + active advisor。

```json
{
  "idempotencyKey": "browser-generated UUID v4",
  "existingClientId": "uuid or null",
  "newClient": null,
  "dataConfirmed": true,
  "reportType": "儿童天赋报告",
  "selectedIssues": ["注意力", "学习兴趣"],
  "customIssue": "",
  "extractedData": {
    "fingers": {
      "R1": { "sym": "Lu", "trc": 18 },
      "R2": { "sym": "Ws", "trc": 20 }
    },
    "atd": 42,
    "age": 8,
    "name": "OCR识别名称"
  }
}
```

约束：

- `existingClientId` 与 `newClient` 二选一；
- 明确拒绝 `advisor_id` / `advisorId`；
- `dataConfirmed` 必须为 `true`；
- 十指键必须完整且纹型/TRC合法；
- 报告类型必须在首期 allowlist；
- 关注问题 1-4 个；
- BFF 使用服务端 `TRCEngine.classify()` 计算 `engineResult`，不信任浏览器计算结果；
- 客户归属和幂等由创建 RPC 原子处理。

成功返回实际状态 `ready`。生成失败时客户和报告记录保留为 `failed`，响应包含安全 report id，供后续重试。

### 6.4 `GET /api/v3a-report-import?id=<uuid>`

- 要求 V3A Session + active advisor；
- GET 不要求 CSRF；
- UUID 严格校验；
- SELECT 明确包含 `advisor_client_id`；
- RLS 后再执行一次客户归属查询；
- `ready` 才返回 `generatedReport`；
- `failed` 只返回安全 `errorCode`。

---

## 7. 现有报告引擎复用

- OCR：复用 `/api/extract-fp`，发送 JSON Base64；
- TRC：BFF 内部调用 `lib/trc-engine.js`；
- 报告生成：复用 `/api/generate-report`；
- 内部调用使用受控 `VERCEL_URL`，不使用请求 Host；
- 内部限流标识为指导师业务 ID 的 SHA-256 截断值，不发送真实业务 ID；
- 入库前移除 `raw` 模型输出，仅保存 sections、engineResult、fingers 和必要元数据。

已知 Review 项：现有 `api/extract-fp.js` 自身仍有历史诊断日志。新 BFF 不新增、不保存或透传 `raw`，但 Claude 在批准 Preview 前应确认现有 OCR 日志是否满足真实客户隐私要求；如不满足，需要另行授权修改该既有 API。

---

## 8. 测试证据

`scripts/test-v3a-advisor-report-import.js` 当前执行 83 项真实检查：

- 读取并验证 migration、RLS、grant、RPC 与 postflight；
- 确认无 service-role、无服务端随机幂等键、无浏览器 advisor id；
- 实际执行十指、日期、报告类型、人工确认和 multipart 校验函数；
- 验证 JPEG/PNG magic bytes；
- 模拟 confirm 成功、幂等进行中、失败重试、生成失败、状态归属查询和 OCR 请求；
- 验证服务端 TRC 计算与生成结果 `raw` 裁剪。

其他门禁：

- 两个 BFF 与测试脚本 `node --check` PASS；
- `scripts/test-vercel-function-budget.js` PASS；
- 当前 Vercel Functions：12/12，无新增函数余量；
- 一次性本地 PostgreSQL 完整事务演练 PASS：2张表、2张表 RLS、authenticated RPC execute=true、anon/service_role execute=false、authenticated table INSERT=false；
- `git diff --check` PASS。

本地 PostgreSQL 演练数据库已销毁。这些证据不等同于 Preview 数据库执行或真实网络联调。

---

## 9. Claude Review Gate

Claude 必须重点审核：

1. migration 020 的事务、RPC、权限与 RLS；
2. 幂等并发是否会遗留孤立客户；
3. 同 key 不同 payload 是否 fail closed；
4. BFF 是否始终从 Session 推导身份；
5. OCR/生成请求是否匹配现有接口；
6. 失败状态是否可安全重试；
7. 现有 OCR 日志隐私项；
8. Hobby 12/12 Function 边界。

在 Claude Review PASS 和负责人单独授权前：

- 不执行 Preview migration；
- 不部署 Preview；
- 不创建或修改前端页面；
- 不进入 Production。
