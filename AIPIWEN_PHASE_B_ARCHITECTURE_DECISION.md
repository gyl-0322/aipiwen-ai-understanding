# AIPIWEN Phase B Architecture Decision Record

**日期**: 2026-07-29
**类型**: Architecture Decision
**状态**: FOR REVIEW — READY FOR CLAUDE APPRAISAL
**前置条件**: Phase A backend complete (migration 020/021, RPCs, RLS, BFFs)

---

## 核心决策: 取消工作台独立报告上传，复用 Report Engine

AIPIWEN.cn 已有成熟的上传与识别能力（`report-upload.html` → `api/extract-fp` → `api/generate-report` → `api/report-store`）。Phase B 不重复建设第二套 Report Engine。

**边界划分**:

```
Report Engine (已有，Phase B 只是连通它)
  ├── report-upload.html         ← 唯一上传入口，C端 + 指导师共用
  ├── api/extract-fp.js           ← Claude Vision OCR
  ├── api/generate-report.js      ← AI 报告生成
  └── api/report-store (via generate-report.js)  ← 报告存储

Advisor Attribution (Phase B 新建)
  ├── attribution_tokens 表        ← 归属Token（独立于invite_codes）
  ├── advisor_clients 表          ← Phase A 已完成
  ├── advisor_reports 表          ← Phase A 已完成
  ├── api/v3a-customers.js        ← Phase A 已完成
  ├── api/v3a-attribution.js      ← 新增: Token生成/验证
  └── report-store 归属注入       ← 新增: 报告入库时写入advisor_id
```

---

## 审核重点 1: 是否取消工作台报告上传页面

**结论: 取消 `ai-interpreter-report-entry.html`**

**理由**:
- `report-upload.html` 已具备完整的上传→OCR→确认→生成流程。在指导师工作台内重建一套同样功能的页面会增加维护负担和代码重复。
- 指导师场景 B（替客户上传报告）可以通过:**指导师用自己的归属Token打开 `report-upload.html`** 实现。指导师在同一个上传页面操作，报告生成后自动绑定到自己名下。
- 工作台内不需要另一个上传入口——只需要在"我的客户"页提供"替客户上传报告"按钮，跳转到带归属Token的 `report-upload.html`。

**保留 Phase A 的设计: `ai-interpreter-report-entry.html` 不再创建。**

---

## 审核重点 2: attribution_tokens vs invite_codes

**结论: 独立表。invite_codes = 招募指导师，attribution_tokens = 客户归属。**

**证据**: `invite_codes` 的 schema 约束已经锁死了用途——

```sql
constraint invite_codes_role_check
  check (role in ('advisor', 'agent', 'center')),
constraint invite_codes_invite_type_check
  check (invite_type = 'practitioner'),
```

- `role` 字段枚举的是指导师角色，target user 是新指导师。
- `invite_type = 'practitioner'` 硬编码，设计意图是招募从业者。
- 生命周期完全不同: 邀请新指导师需要注册审核流程；客户归属只是扫码上传。

**attribution_tokens 设计**:

```text
attribution_tokens
  id              uuid PK
  advisor_user_id uuid NOT NULL → users(id)
  token           text NOT NULL UNIQUE            -- 短码，如 AIP-K8F2X
  max_uses        integer DEFAULT 1               -- 1=一次性, null=不限
  used_count      integer DEFAULT 0
  expires_at      timestamptz DEFAULT now() + interval '7 days'
  status          text DEFAULT 'active'           -- active | exhausted | revoked | expired
  created_at      timestamptz NOT NULL DEFAULT now()

  constraint attribution_tokens_status_check
    check (status in ('active', 'exhausted', 'revoked', 'expired'))
```

**与 invite_codes 的关键区别**:
- 无 `role` 字段 — 不区分指导师角色
- 无 `invite_type` — 只有一种用途（客户归属）
- `advisor_user_id` 而非 `user_id` — 语义清晰
- 默认 1 次使用，7 天过期 — 安全默认值

---

## 审核重点 3: 最小 Migration

**Migration 022 包含**:

1. `attribution_tokens` 建表（独立于 invite_codes）
2. 扩展 `advisor_clients.source` 枚举，增加 `'unguided'`
3. Preflight: 校验 020 tables + 021 helpers 存在
4. Postflight: `attribution_tokens` 对 authenticated 仅有 SELECT，写走 RPC

**Migration 022 不包含**:
- 修改 `invite_codes` — 不碰现有表
- 修改 RPC — `v3a_create_advisor_report_import` 保持不变的 advisor_import 路径
- 新建 report-store — 归属注入通过 BFF 层实现，不在 SQL 层

---

## 审核重点 4: API 边界

| 能力 | 归属方 | API |
|------|--------|-----|
| 文件上传 | Report Engine | `POST /api/extract-fp` (已有) |
| OCR 识别 | Report Engine | 同上，Claude Vision |
| 报告生成 | Report Engine | `POST /api/generate-report` (已有) |
| 报告存储 | Report Engine | `POST /api/report-store` (已有，需扩展归属字段) |
| Token 生成 | Attribution | `POST /api/v3a-attribution?action=create` |
| Token 验证 | Attribution | `GET /api/v3a-attribution/validate?token=CODE` |
| 归属写入 | Attribution | report-store 的 advisor_id 字段注入 |
| 客户列表 | Attribution | `GET /api/v3a-customers` (Phase A 已完成) |
| 报告查询 | Attribution | `GET /api/v3a-report-import?id=xxx` (Phase A 已完成) |
| 待分配池 | Attribution | `GET /api/v3a-admin/unassigned` |
| 客户分配 | Attribution | `POST /api/v3a-admin/assign` (super_admin only) |

**Report Engine 需要的最小改动**: `report-store` 保存时如果请求中包含有效的 `attribution_token`，则:
1. 验证 token（调用 `validate-token` 或内联查询）
2. 在 Redis `report:{id}` 对象中增加 `advisor_id` 字段
3. 同时在 `advisor_clients` 和 `advisor_reports` 中创建记录（source = `advisor_qr` 或 `advisor_import`）

**归属注入的安全约束**: Token 验证必须在服务端完成。浏览器只传 token 字符串，不传 advisor_id。

---

## 审核重点 5: 三个场景的数据流

### 场景 1: 客户扫码指导师二维码

```
指导师 → 工作台生成 Token (POST /api/v3a-attribution)
       → 获得二维码 https://www.aipiwen.cn/report-upload.html?token=AIP-XXXX
       → 发给客户

客户   → 扫码 → report-upload.html?token=AIP-XXXX
       → 上传报告图片 → OCR → 确认数据 → 生成报告
       → report-store 在服务端验证 token
       → 发现 token 属于 advisor X
       → 创建 advisor_client (source=advisor_qr, advisor_user_id=X)
       → 创建 advisor_report (source=advisor_qr)
       → Redis report:{id} 增加 advisor_id: X
       → report-store 返回 report_id + client_id

指导师 → 刷新"我的客户"页 → 看到新客户
```

### 场景 2: 指导师替客户上传

```
指导师 → 登录工作台 → 我的客户 → "替客户上传报告"
       → 生成一次性 Token (max_uses=1)
       → 在新标签页打开 report-upload.html?token=AIP-XXXX
       → 上传 → OCR → 确认 → 生成
       → 客户自动归属到自己名下 (source=advisor_qr)

与场景 1 的区别: 指导师自己操作上传，但归属逻辑完全相同。
```

### 场景 3: 无归属上传

```
用户   → 直接访问 report-upload.html（无 token 参数）
       → 上传 → OCR → 确认 → 生成
       → report-store 发现无 token
       → 创建 advisor_client (source=unguided, advisor_user_id=NULL)
       → 创建 advisor_report (source=unguided)
       → Redis report:{id} 无 advisor_id

总部   → 后台 → 查看待分配池 → 分配指导师
       → advisor_user_id 更新
       → source 保持 'unguided'（原始来源不变，分配记录在 admin_audit_logs）
```

---

## MVP 范围

### 必须做

| 项目 | 说明 |
|------|------|
| Migration 022 | attribution_tokens 表 + source 扩展 'unguided' |
| attestation tokens RPC | `v3a_create_attribution_token` + `v3a_validate_attribution_token` |
| API v3a-attribution.js | create + validate |
| report-store 归属注入 | 现有的 handleReportStore 增加 token → advisor_id 注入逻辑 |
| 工作台生成 Token UI | 邀请码弹窗增加"生成客户归属二维码"tab |
| "我的客户"页"替客户上传"按钮 | 跳转 report-upload.html?token=CODE |
| 无归属池查看 | super_admin 只读查看 unassigned clients |

### 不做

| 项目 | 说明 |
|------|------|
| ai-interpreter-report-entry.html | 取消，不创建 |
| 邀请码手动输入 (A2) | 后续 Phase，共享同一 token 机制 |
| 总部分配操作 | 先只读查看，分配在后续 Phase |
| PDF 支持 | 后续 |
| agent/center 角色上传 | 首期仅 ordinary advisor |
| Supabase Storage | 首期不存原文件，仅结构化数据入库 |

---

## Risks

| 风险 | 缓解 |
|------|------|
| report-store 是公开 API，增加归属逻辑可能影响现有 C 端直接上传用户 | Token 验证失败时回退到无归属模式 (unguided)，不破坏现有流程 |
| attribution_token 泄露被滥用（扫码后多设备上传） | 默认 max_uses=1，单次使用后 exhausted |
| 指导师生成大量 Token 刷客户数 | IP 限流 + daily limit |
| Phase A 创建的 "advisor_import" 与 Phase B "advisor_qr" 重复 | "advisor_import" 保留为 Phase A 工作台直接上传的 legacy source；Phase B 场景 1/2 统一用 "advisor_qr" |

---

## Final Decision

**APPROVE FOR IMPLEMENTATION** — 附带条件:
1. `attribution_tokens` 独立于 `invite_codes` 建表
2. 取消 `ai-interpreter-report-entry.html`
3. report-store 归属注入保持向后兼容（无 token → unguided）
4. Phase B MVP 仅覆盖上述"必须做"清单
