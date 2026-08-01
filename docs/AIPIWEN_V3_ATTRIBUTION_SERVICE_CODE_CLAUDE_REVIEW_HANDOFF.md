# AIPIWEN V3.0 指导师服务码 · Claude Review 交底文件

## 1. Review 目标

请对“AIPIWEN 客户报告上传时手工填写指导师服务码”增量功能进行只读代码与架构审查。

本次解决的问题：

```text
客户从 www.aipiwen.cn 首页进入 report-upload.html
→ 没有扫码、URL 中没有 attribution token
→ 可选填写指导师服务码
→ 确认服务指导师
→ 上传报告
→ 继续复用现有 attribution token 原子入库
→ 客户进入对应指导师的客户列表
```

二维码仍是主路径，服务码只是备用路径。无二维码、无服务码时继续创建 `unguided` 客户。

## 2. 当前执行状态

- 本地实施：完成
- Node Check：PASS
- Phase A / Phase B 回归：PASS
- Vercel Preview Build：PASS
- Migration 025 隔离 PostgreSQL 演练：PASS
- Git commit：未创建
- Preview migration：未执行
- Preview deploy：未执行
- Production migration：未执行
- Production deploy：未执行

Claude Review PASS 前禁止执行任何在线 migration 或 deploy。

## 3. 冻结产品规则

### 3.1 二维码为主

指导师在“我的客户”生成一次性归属凭证：

- 原 32 位 attribution token；
- 新 10 位指导师服务码；
- 两者属于同一条 `attribution_tokens` 记录；
- 共用一次使用、24 小时有效、撤销、过期和耗尽状态。

二维码链接继续使用：

`/report-upload.html?token=<REDACTED>`

### 3.2 服务码兜底

客户从首页进入上传页时可选择填写服务码。服务码验证成功后，公开 BFF 将其换取同一条 attribution token，并只在当前页面内存中保存。

禁止：

- 复用指导师注册邀请码；
- 接受浏览器提交 `advisor_id`；
- 把服务码或 attribution token 写入 Local Storage；
- 新建第二套客户归属和报告入库逻辑。

### 3.3 无归属保持兼容

- 不填写服务码：继续 `source=unguided`；
- 填写但未验证：fail closed，不能继续识别；
- 无效、过期、撤销或耗尽：提示重新向指导师获取；
- 已验证：显示指导师展示名，客户确认后继续。

## 4. Claude 只读审核范围

只审核以下文件：

1. `supabase/migrations/025_v3a_attribution_service_code.sql`
2. `api/v3a-attribution.js`
3. `ai-interpreter-customers.html`
4. `static/v3a-attribution.js`
5. `report-upload.html`
6. `scripts/test-v3a-attribution-service-code.js`
7. `docs/AIPIWEN_V3_ATTRIBUTION_SERVICE_CODE_IMPLEMENTATION_REPORT.md`

工作区存在其他历史或未关联变更，包括 `vercel.json` 等。它们不属于本次 Review，不要修改、恢复、暂存或删除。

## 5. 明确未修改的关键对象

- `supabase/migrations/022_v3a_advisor_attribution.sql`
- `api/generate-report.js`
- `public.v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)`
- `invite_codes`
- Auth
- BFF Session
- CSRF / SameOrigin
- Report Engine
- `cases:index`
- Vercel routes / Function 数量
- Production 配置

## 6. Migration 025 设计

### Preflight

必须存在：

- `public.attribution_tokens`
- `v3a_create_attribution_token(integer)`
- `v3a_validate_attribution_token(text)`
- `v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)`

必须不存在：

- `attribution_tokens.service_code`
- `v3a_validate_attribution_service_code(text)`

### Schema

为 `attribution_tokens` 增加：

```text
service_code text not null unique
check: ^[0-9A-F]{10}$
```

现有 token 在锁定表后逐条回填安全随机服务码。

### RPC

更新：

- `v3a_create_attribution_token(integer)`：同一事务生成 token 和服务码。

新增：

- `v3a_validate_attribution_service_code(text)`：验证服务码并换取同一 attribution token。

不修改：

- `v3a_store_attributed_report(...)`。

### 权限

- 创建 token：仅 `authenticated`；
- 验证服务码：`anon`、`authenticated`；
- `service_role` 无验证 RPC EXECUTE；
- `anon`、`authenticated`、`service_role` 均无 `attribution_tokens` 表 SELECT；
- 不开放浏览器直接写表。

### Postflight

验证：

- 列、约束和函数存在；
- 所有现有行服务码非空、格式正确且唯一；
- RPC 权限符合最小权限；
- token 表权限没有扩大。

## 7. BFF 和前端契约

### `api/v3a-attribution.js`

公开验证接口只接受一种凭证：

```text
GET /api/v3a-attribution?action=validate&token=...
```

或：

```text
GET /api/v3a-attribution?action=validate&code=...
```

同时提交或同时缺少两种凭证必须拒绝。

服务码验证成功只返回：

- 指导师展示名；
- 有效期；
- 剩余使用次数；
- 用于现有报告归属入库的 attribution token。

不得返回内部指导师 ID、手机号或客户数据。

### 指导师客户页

- 二维码生成行为保持不变；
- 同一面板显示格式化服务码；
- 提供复制服务码按钮；
- 不显示或复制内部 token。

### 客户上传页

- URL token 路径继续工作；
- 首页直达时可展开服务码输入；
- 验证成功显示指导师名称；
- resolved token 只保存在页面内存；
- 报告保存继续提交现有 `attributionToken` 字段；
- 填写但未验证的服务码阻止进入 OCR；
- 空服务码保持 `unguided`。

## 8. 请重点检查的风险

请逐项给出 PASS / FAIL 和证据：

1. Migration 025 能否在已执行 022 的数据库上安全运行；
2. 旧 token 回填是否可能产生空值、重复值或长时间锁风险；
3. 10 位十六进制、24 小时、一次使用的服务码风险是否可接受；
4. 公开服务码换取 token 是否扩大了不必要的数据或权限面；
5. 无效服务码是否可能静默降级为错误的 `unguided` 客户；
6. 旧二维码 token 是否完整兼容；
7. 无 token 的首页上传是否完整兼容；
8. `invite_codes` 是否确实未被复用或修改；
9. 是否存在 token、客户信息或内部 ID 日志泄露；
10. 是否需要增加速率限制才能进入 Preview；
11. Migration 与代码的上线顺序是否能避免二维码创建中断；
12. 是否有本次测试未覆盖的 P0/P1 风险。

## 9. 已执行验证

```text
PASS: attribution service code contract (36 checks)
PASS: advisor attribution contract (64 checks)
PASS: Phase B-2 attribution release hardening (16 checks)
PASS: 93 real advisor report import checks
PASS: Vercel Function budget is 12/12
PASS: cases:index privacy patch (3 checks)
PASS: report-upload inline scripts parse
PASS: migration 025 isolated PostgreSQL rehearsal
PASS: Vercel Preview Build
```

建议 Claude 自行重跑：

```bash
node --check api/v3a-attribution.js
node --check static/v3a-attribution.js
node --check scripts/test-v3a-attribution-service-code.js
node scripts/test-v3a-attribution-service-code.js
node scripts/test-v3a-advisor-attribution.js
node scripts/test-v3a-attribution-release-hardening.js
node scripts/test-v3a-advisor-report-import.js
node scripts/test-vercel-function-budget.js
node scripts/test-v3a-case-index-privacy.js
vercel build
```

## 10. 强制发布顺序

如果 Claude Review PASS，仍需单独授权，且必须严格按照：

```text
Preview migration 025
→ Preview deploy 精确审核 commit
→ 旧二维码回归
→ 服务码完整 E2E
→ 无服务码 unguided 回归
→ Claude Preview Review
→ Production migration 单独授权
→ Production deploy 单独授权
```

禁止先部署代码再执行 migration。新代码要求创建 RPC 返回 `serviceCode`，若数据库尚未执行 025，会导致二维码创建接口失败。

## 11. Claude 输出格式

请输出：

1. 总结论：`PASS` / `PASS WITH CONDITIONS` / `FAIL`；
2. P0/P1/P2 问题列表，必须附文件和行号；
3. Migration 安全结论；
4. BFF 权限与隐私结论；
5. 二维码、服务码、unguided 兼容性结论；
6. 测试充分性结论；
7. 是否批准进入 Preview Migration & Deploy；
8. Production 前必须补齐的条件。

Claude 不要直接修改文件、不要执行 migration、不要 deploy。Review 完成后将报告交回 Codex 修正或进入下一授权阶段。
