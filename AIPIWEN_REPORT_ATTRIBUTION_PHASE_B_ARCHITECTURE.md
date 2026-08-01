# AIPIWEN 报告上传与客户归属系统 · Phase B 产品架构重设计 V1.0

**日期**：2026-07-29
**类型**：架构设计（不涉及代码、不涉及开发、不扩大范围）
**状态**：DRAFT，待 Claude Review
**依赖**：Phase A 后端能力已完成（advisor_clients、advisor_reports、RPC、幂等、状态机、OCR Pipeline）

---

## 1. 背景：为什么需要重设计

Phase A 的设计假设是"指导师上传指纹图片，系统 OCR 识别"。但 AIPIWEN 的实际业务流程是：

> 指纹采集由指导师/采集中心/代理机构使用专业采集设备完成，AIPIWEN 收到的是**已完成采集后的电子版报告**（通常是图片或 PDF）。

因此，Phase A 已有的**OCR 识别 Pipeline**（`api/extract-fp.js` → Claude Vision 提取十指纹型、TRC、ATD）仍然可用，但**入口应从"上传指纹总表图片"改为"上传已有电子报告文件"**。

---

## 2. 两个业务入口：全景流程图

```
                    ┌─────────────────────────┐
                    │   电子报告文件来源        │
                    │  (采集设备/机构已生成)    │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
    ┌──────────────────┐                ┌──────────────────┐
    │  场景 A: C端上传  │                │ 场景 B: 指导师上传 │
    │  (用户自己上传)    │                │  (工作台内上传)    │
    └────────┬─────────┘                └────────┬─────────┘
             │                                   │
    ┌────────┴────────┐                          │
    │                 │                          │
    ▼                 ▼                          ▼
┌─────────┐    ┌──────────┐          ┌──────────────────┐
│扫描二维码│    │输入邀请码 │          │ 登录工作台         │
│识别归属  │    │识别归属   │          │ → 我的客户         │
│(A1)     │    │(A2)      │          │ → 上传报告         │
└────┬────┘    └────┬─────┘          │ → 自动绑定当前     │
     │              │                │   advisor         │
     │              │                └────────┬──────────┘
     │              │                         │
     └──────┬───────┘                         │
            │                                 │
            ▼                                 │
    ┌──────────────┐                          │
    │ 无归属上传     │                         │
    │→总部待分配池  │                         │
    │(A3)          │                         │
    └──────┬───────┘                          │
           │                                  │
           └──────────┬───────────────────────┘
                      │
                      ▼
           ┌──────────────────┐
           │   OCR 识别 Pipeline │  ← Phase A 已完成
           │  (复用 /api/extract-fp) │
           │   文字提取: 姓名/年龄    │
           │   表格提取: 十指/TRC/ATD│
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────┐
           │  人工确认数据      │
           │  (指导师 / C端用户)│
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────┐
           │  生成报告 + 入库   │
           │  → advisor_reports│
           │  → advisor_clients│
           │  → 归属绑定       │
           └──────────────────┘
```

---

## 3. 场景 A：C 端用户上传报告

### 3.1 子场景 A1：二维码扫描绑定指导师

**指导师侧**：
1. 指导师在登录后的工作台生成**客户专属二维码**。
2. 二维码包含参数：`https://www.aipiwen.cn/report-upload.html?advisor=CODE`
3. `CODE` 是一个**短期有效的归属 Token**（与现有的指导师邀请码 `invite_codes` 表不同——邀请码是邀请新指导师注册的，这是客户归属用的）。

**客户侧**：
1. 扫码 → 打开报告上传页。
2. 上传电子报告文件。
3. OCR 提取结构化数据。
4. 人工确认数据。
5. 系统生成报告。

**归属建立**：
- 上传完成后，客户和报告自动归属于该 Token 对应的指导师。
- 来源标记为 `advisor_qr`。
- Token 可设置为**一次性**或**多次使用**（由指导师在生成时选择）。

**归属 Token 数据模型建议**：

```text
attribution_tokens（新增表）
  id              uuid PK
  advisor_user_id uuid NOT NULL → users(id)    -- 生成此 token 的指导师
  token           text NOT NULL UNIQUE          -- 短码，如 AIP-K8F2X
  max_uses        integer DEFAULT 1             -- 1=一次性, null=不限
  used_count      integer DEFAULT 0
  expires_at      timestamptz                    -- 过期时间（建议 7 天）
  status          text DEFAULT 'active'          -- active / exhausted / revoked / expired
  created_at      timestamptz
```

### 3.2 子场景 A2：邀请码绑定

用户手动输入邀请码。与前者的区别是：二维码是"扫了就绑定"，邀请码是"输入才绑定"。

**邀请码生命周期**：

| 阶段 | 操作 | 规则 |
|------|------|------|
| 创建 | 指导师在工作台生成 | 可设置使用次数上限（1 - 不限）和有效期（1-30 天） |
| 使用 | 客户在上传页输入 | 单个用户只能绑定一次（同手机号/同设备去重） |
| 失效 | 自动或手动 | 次数用完 → `exhausted`；过期 → `expired`；指导师手动 → `revoked` |
| 多次使用规则 | — | 同一个客户重复上传 → 追加新报告，不重复创建客户。不同客户使用同一邀请码 → 各自绑定同一指导师 |

**与前者的关系**：二维码 Token 和邀请码可以**统一为同一张表**（`attribution_tokens`），只是分发方式不同——二维码是 URL 参数，邀请码是手动输入。

### 3.3 子场景 A3：无归属上传

用户直接访问 `report-upload.html`，不携带任何归属参数。

**处理流程**：
1. 正常上传、OCR、确认、生成报告。
2. 客户创建时 `source = 'unguided'`，`advisor_user_id = NULL`。
3. 报告状态为 `ready`，但**不进入任何指导师的客户列表**。
4. 进入**总部待分配池**。

**待分配池设计**：

```text
unassigned_pool（视图或查询条件）
  查询条件: advisor_clients.source = 'unguided' AND advisor_user_id IS NULL

  总部后台操作:
  1. 查看无归属客户列表
  2. 选择一个客户
  3. 分配至某指导师 → advisor_user_id 更新
  4. 分配记录写入 audit log
```

**分配记录**：
- 动作记录在 `admin_audit_logs` 中（复用现有表，增加 action `ASSIGN_CLIENT`）。
- 记录分配人（super_admin_id）、被分配客户（client_id）、目标指导师（target_advisor_id）。

---

## 4. 场景 B：指导师工作台上传

指导师在已登录的工作台内替客户上传报告。此场景 Phase A 已设计完整流程，本设计仅做确认和微调：

1. 登录 → 我的客户 → **录入报告**。
2. 选择已有客户或新建客户。
3. 上传报告文件（JPEG / PNG / PDF 首期仅前两者）。
4. OCR 提取 → 人工确认 → 提交入库。
5. 客户归属自动绑定当前指导师，`source = 'advisor_import'`。

**如何避免重复客户**：Phase A 的 `v3a_create_advisor_report_import` RPC 已有幂等保护（`idempotency_key` UNIQUE）。本设计补充：当创建新客户时，若同名 + 同出生日期 + 同指导师已存在，前端提示 "可能已存在该客户，是否选择已有客户？"，引导指导师确认。数据库层面不做强制唯一约束（不同指导师可能有同名客户）。

---

## 5. 客户模型调整

当前 `advisor_clients`（migration 020）字段：

```text
id, advisor_user_id, auth_user_id, source, display_name, birth_date, note, created_at, updated_at, archived_at
source in ('invite_link', 'advisor_qr', 'advisor_import')
```

**建议扩展**：

| 字段 | 类型 | 说明 | 优先级 |
|------|------|------|--------|
| `source` 枚举扩展 | text | 增加 `'unguided'`（无归属上传，进入待分配池） | P0 |
| `attribution_token_id` | uuid FK → attribution_tokens(id) | 记录是通过哪个 token 归属的 | P1 |
| `assigned_by_user_id` | uuid FK → users(id) | 从待分配池分配时，记录分配人 | P2 |
| `assigned_at` | timestamptz | 分配时间 | P2 |

**当前 MVP 最小修改**：
- `source` 增加 `'unguided'`（需要 ALTER constraint）。
- 其他字段可先不加入，Phase C 按需扩展。

---

## 6. 报告模型调整

当前 `advisor_reports`（migration 020）字段已覆盖核心需求：

```text
id, advisor_client_id, status, source, source_file_path, structured_input,
generated_report, age_at_report, idempotency_key, error_code, created_at, updated_at
```

**建议扩展**：

| 字段 | 类型 | 说明 | 优先级 |
|------|------|------|--------|
| `original_file_path` | text | Supabase Storage 中的原文件路径 | P1 |
| `parsing_status` | text | `pending / parsing / parsed / parse_failed` | P2 |
| `parsed_at` | timestamptz | 文件解析完成时间 | P2 |

**当前 MVP 不需要改**：`source_file_path` 可以暂当 `original_file_path` 用。OCR 的 parsed 结果已经体现在 `structured_input` 中。

---

## 7. 文件存储

**决策**：使用 Supabase Storage。

**理由**：
- 已在 Supabase 生态内，无需额外供应商（Vercel Blob）。
- RLS 可控制访问（指导师只能访问自己客户的文件）。
- 成本可控（首期文件限制 2.5MB，JPG/PNG）。
- 隐私合规：Bucket 设为 private，通过 Signed URL 访问。

**存储路径设计**：

```text
reports/{advisor_user_id}/{client_id}/{report_id}.{ext}
```

**保留策略**：
- 原文件：确认入库后保留 30 天自动删除。
- 结构化数据：永久保留在 `advisor_reports.structured_input` 中。

---

## 8. OCR Pipeline（已有，确认可用）

现有 `api/extract-fp.js` 已能：

| 能力 | 状态 |
|------|------|
| 接收 Base64 图片 → Claude Vision 提取 | ✅ 生产就绪 |
| 识别十指纹型（Ws/Wt/We/…/Rl/X/Xn） | ✅ 含 Rl/Lu 纠错 pass |
| 识别 TRC 数值 | ✅ |
| 识别 ATD | ✅ |
| 识别姓名（OCR 文字） | ✅ |
| 识别年龄（从生日计算） | ✅ |
| 二次校验（allLu / hasRl 路径） | ✅ |
| IP 限流 | ✅ |

**Phase B 需要做的**：不需要修改 OCR Pipeline 本身。只需在 BFF 层（`v3a-report-import.js`）将 OCR 结果与归属逻辑对接即可。入口从"上传指纹总表图片"改为"上传已有电子报告文件的照片"——对于 OCR 引擎来说，输入仍是图片，没有区别。

---

## 9. 总部后台

### 9.1 无归属报告池

**查询**：
```sql
SELECT * FROM advisor_clients
WHERE source = 'unguided' AND advisor_user_id IS NULL
ORDER BY created_at DESC
```

**操作**：
1. 查看客户和报告详情。
2. 分配到指定指导师。
3. 批量分配（后续 Phase）。

### 9.2 已有归属的报告管理

总部可查看所有报告（通过 `v3a_is_super_admin()` RLS），但**不修改报告内容**——只能做归属转移和归档。

### 9.3 后台页面

建议新增 `admin-unassigned.html`（或扩展现有 `admin.html`），仅 super_admin 可访问。

---

## 10. 权限模型

| 角色 | 读取范围 | 写入权限 | 备注 |
|------|----------|----------|------|
| C端用户（未登录） | 无 | 无 | 仅能上传报告 |
| C端用户（已登录，如有） | 自己的报告 | 无 | 未来开放客户登录后 |
| 指导师（active advisor） | 自己名下的客户和报告 | 通过 RPC 写入 | 已在 migration 020/021 实现 |
| 机构（agent/center） | 首期不开放 | 首期不开放 | 待单独确认 |
| 总部（super_admin） | 全部客户和报告 | 分配/归档/review | 分配逻辑需新增 |

---

## 11. API 设计

Phase A 已有：
- `GET /api/v3a-customers` — 客户列表
- `POST /api/v3a-report-import?action=extract` — OCR 提取
- `POST /api/v3a-report-import?action=confirm` — 确认入库
- `GET /api/v3a-report-import?id=xxx` — 报告状态查询

Phase B 建议新增：

| API | 方法 | 功能 | 鉴权 |
|-----|------|------|------|
| `/api/v3a-attribution/generate-token` | POST | 生成客户归属 Token/二维码 | active advisor + CSRF |
| `/api/v3a-attribution/validate-token` | GET | 验证 Token 有效性，返回指导师信息 | 公开（C 端无登录） |
| `/api/v3a-report-upload` | POST | C 端上传报告（公开入口） | 公开 + IP 限流 |
| `/api/v3a-report-upload?action=confirm` | POST | C 端确认入库（含归属信息） | 公开 + Token 校验 |
| `/api/v3a-admin/clients/unassigned` | GET | 总部查看待分配池 | super_admin |
| `/api/v3a-admin/clients/assign` | POST | 总部分配客户给指导师 | super_admin + CSRF |

---

## 12. 前端页面结构

| 页面 | 用户 | 功能 |
|------|------|------|
| `report-upload.html`（已有，扩展） | C端用户 | 上传报告 + 确认数据（增加归属参数读取） |
| `ai-interpreter-report-entry.html`（新建） | 指导师 | 工作台内上传报告（Phase A 已设计） |
| `ai-interpreter-customers.html`（已有，扩展） | 指导师 | 真实客户列表（待数据驱动改造） |
| `admin-unassigned.html`（新建） | 总部 | 无归属客户池管理 |

---

## 13. MVP 范围

**包含**：
1. attribution_tokens 表（migration 022）
2. `advisor_clients.source` 扩展 `'unguided'`
3. `/api/v3a-attribution/generate-token` + `/validate-token`
4. 场景 A1（二维码归属）MVP：指导师生成二维码 → 客户扫码上传 → 归属完成
5. 场景 A3（无归属）MVP：客户直接上传 → 进入待分配池
6. 场景 B（指导师工作台上传）MVP：Phase A 已有
7. 总部查看待分配池（只读）
8. 文件存储：Supabase Storage bucket `reports`

**不包含（后续 Phase）**：
- 场景 A2（邀请码手动输入）— 与二维码共享底层 token 机制，UI 后续追加
- 总部分配/转移操作 — 先做只读查看
- PDF 文件支持
- 批量上传
- 客户本人登录查看报告
- agent/center 角色的上传权限

---

## 14. 与 Phase A 的关系

Phase A 的 `advisor_clients`、`advisor_reports`、RPC、幂等、状态机、BFF 全部保留。Phase B 在此之上叠加：

- **新增**：归属 Token 机制（场景 A1/A2）
- **新增**：无归属池（场景 A3）
- **微调**：`source` 枚举扩展 + 文件存储
- **不删不改**：Phase A 的 RLS、RPC、幂等、CSRF、Session 安全模型
