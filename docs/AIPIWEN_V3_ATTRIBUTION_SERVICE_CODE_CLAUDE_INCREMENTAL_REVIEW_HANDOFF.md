# AIPIWEN V3.0 指导师服务码 · Claude 增量复核交底

## 1. 复核目标

Claude 首轮只读审核结论为 `PASS WITH CONDITIONS`。本次只修复首轮报告明确提出的两项条件：

1. 服务码公开验证增加 IP 级速率限制；
2. 增加“验证后修改输入，旧 attribution token 必须失效”的专项测试。

本次没有修改数据库迁移、产品规则或上线顺序。

## 2. 增量复核范围

只审核以下两个代码文件：

1. `api/v3a-attribution.js`
2. `scripts/test-v3a-attribution-service-code.js`

同步更新的实施记录：

- `docs/AIPIWEN_V3_ATTRIBUTION_SERVICE_CODE_IMPLEMENTATION_REPORT.md`

以下文件在本轮条件修正中未修改：

- `supabase/migrations/025_v3a_attribution_service_code.sql`
- `report-upload.html`
- `ai-interpreter-customers.html`
- `static/v3a-attribution.js`
- `server/v3a-session-store.js`
- `vercel.json`

## 3. 修正一：服务码验证 IP 限流

在公开接口：

`GET /api/v3a-attribution?action=validate&code=...`

调用现有 `consumeRateLimit()`：

```text
scope: attribution-service-code-validate-ip
identifier: 当前请求 IP
limit: 20
window: 600 秒
```

边界：

- 仅限制手工服务码验证；
- 不限制原二维码 token 验证；
- 在格式校验前计数，格式错误的枚举尝试同样占用额度；
- IP 只作为 `consumeRateLimit()` 输入，KV 键由现有安全组件 HMAC 处理；
- 不记录、不输出明文 IP；
- 超限沿用标准 JSON 错误：HTTP 429 / `RATE_LIMITED`；
- 未新增环境变量、路由、Vercel Function 或存储结构。

请重点核对：该最窄限流范围是否既阻止服务码枚举，又不影响旧二维码路径。

## 4. 修正二：旧 token 失效专项测试

专项测试从 `report-upload.html` 读取并执行实际的服务码 input 事件处理代码，不复制产品判断逻辑。

新增验证：

1. 输入框可编辑时，初始存在旧 attribution token；触发 input 后 token 必须为 `null`；
2. 验证成功后输入框已锁定时，不得意外清除当前有效 token；
3. 原有“输入非空但 token 为空时阻止 OCR”的 fail-closed 断言继续保留。

因此覆盖路径为：

```text
服务码曾验证成功
→ 输入恢复为可编辑并发生修改
→ 旧 attribution token 清空
→ 直接点击识别
→ fail closed，不会沿用旧归属
```

## 5. 验证结果

```text
PASS: attribution service code contract (41 checks)
PASS: advisor attribution contract (64 checks)
PASS: Phase B-2 attribution release hardening (16 checks)
PASS: 93 real advisor report import checks
PASS: Vercel Function budget is 12/12 with advisor attribution included
PASS: cases:index privacy patch (3 checks)
PASS: report-upload inline scripts parse (1)
PASS: Vercel Preview Build
PASS: Node Check
PASS: git diff --check
```

Migration 025 未发生变化，因此本轮未重复执行数据库演练；首轮隔离 PostgreSQL 全事务演练仍为 PASS。

## 6. 当前执行状态

- Git commit：未创建
- Preview migration：未执行
- Preview deploy：未执行
- Production migration：未执行
- Production deploy：未执行
- 真实客户、报告或服务码：未创建

## 7. Claude 输出要求

请只读输出：

1. 两项条件是否均已关闭；
2. 是否存在新增 P0/P1/P2；
3. IP 限流的范围、阈值、隐私和兼容性是否可接受；
4. 专项测试是否真实覆盖旧 token 失效路径；
5. 是否批准按以下顺序进入 Preview：

```text
Preview migration 025
→ 部署增量复核通过的精确 commit
→ 旧二维码 E2E
→ 服务码 E2E
→ unguided E2E
```

Claude 不要修改文件、不要执行 migration、不要 deploy。
