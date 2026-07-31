# AIPIWEN V3.0 Attribution Runtime 与工作台 UI · Claude 增量审核交底

## 1. Review 目标

本轮关闭两个 Preview 阻塞面：

1. `v3a_create_attribution_token()` 无法解析 Supabase `extensions.gen_random_bytes()`；
2. 工作台页面存在重复导航、无真实逻辑按钮和后台设计语言。

请只读审核。不要修改文件、不要执行 Migration、不要部署。

## 2. 当前在线状态

- Preview 已执行 Migration 025；
- Preview 当前部署 commit：`f640ec7404045ed1ba126b70bc2ee83c712d6c07`；
- Preview Deployment：`dpl_EBDAvmjM2K7RNX9GSSpZPfwLii91`；
- 该部署的客户列表、Session 与登录正常；
- attribution token 创建因 schema resolution 返回 HTTP 502；
- Migration 026：未执行；
- 本轮 UI 修订：未部署；
- Production：未修改。

## 3. 根因证据

Preview runtime probe 返回：

```text
function gen_random_bytes(integer) does not exist
```

只读数据库检查：

```text
extensions.gen_random_bytes(integer): exists
public.gen_random_bytes(integer): missing
```

025 中创建 RPC 冻结 `search_path = pg_catalog, public`，但函数体使用未限定 schema 的 `gen_random_bytes(5)`，因此运行时失败。

## 4. Migration 026 审核范围

文件：

- `supabase/migrations/026_v3a_attribution_service_code_runtime_fix.sql`
- `scripts/test-v3a-attribution-service-code-runtime-fix.js`

026 只执行：

- preflight 验证 025 基线与 `extensions.gen_random_bytes(integer)`；
- `CREATE OR REPLACE` 原创建 RPC；
- 将随机调用改为 `extensions.gen_random_bytes(5)`；
- 保持函数签名、JSON 契约、SECURITY DEFINER、search_path、24 小时、使用次数和权限不变；
- 在同一事务内使用 active advisor 做 runtime probe；
- 精确删除 probe token并验证不存在；
- 通知 PostgREST 刷新 schema cache。

026 不修改表结构、Auth、Session、邀请码、积分或客户模型。

## 5. UI 审核范围

页面：

- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-session.html`
- `ai-interpreter-training.html`
- `ai-interpreter-review.html`
- `ai-interpreter-cases.html`

客户端与公开错误文案：

- `static/v3a-attribution.js`
- `api/v3a-attribution.js`

测试：

- `scripts/test-ai-interpreter-pages.js`
- `scripts/test-v3a-advisor-attribution.js`

治理规则与逐按钮去向见：

- `docs/AIPIWEN_V3_WORKBENCH_NAVIGATION_GOVERNANCE_MATRIX.md`

## 6. UI 冻结规则

- 左侧主导航是六个栏目唯一的全局切换入口；
- 删除右上、右下和卡片底部的重复栏目链接；
- 删除无事件处理的假按钮；
- 当前页面真实动作继续保留；
- 明确 disabled 且标注“即将开放”的 AI 方案按钮保留；
- 学习示例客户行进入解读示例属于上下文动作，保留；
- 错误页重新加载和返回登录属于恢复动作，保留；
- 前台文案不出现权限隔离、内部归属模型、绑定方式、管道或入库规则。

## 7. 关键行为结论

- “客户扫码上传”和“代客户上传报告”当前失败来自同一个数据库 RPC，不是 DOM click handler 缺失；
- 原“进入解读助手”链接已在 Preview 真实浏览器中确认可以进入 `ai-interpreter-session.html`；
- 该链接仍按产品决定删除，因为左侧导航已提供同一入口；
- 其他所有保留按钮均在治理矩阵中标注当前页动作或恢复目标。

## 8. 测试结果

```text
PASS: attribution service code runtime fix (15 checks)
PASS: attribution service code contract (41 checks)
PASS: advisor attribution contract (68 checks)
PASS: Phase B-2 attribution release hardening (16 checks)
PASS: 93 real advisor report import checks
PASS: hardened AI interpreter pages, example boundaries, protected routes, and real-data guards
PASS: all 16 scripts/test-v3a-*.js
PASS: Vercel Function budget 12/12
PASS: Node Check
PASS: Vercel Preview Build
PASS: git diff check
PASS: isolated PostgreSQL 025 → 026 runtime rehearsal and cleanup
```

测试未发送真实短信，未使用真实客户材料，未创建在线测试数据。

## 9. Claude 重点检查

请确认：

1. 026 是否是已执行 025 后正确的 append-only 修复；
2. `extensions.gen_random_bytes(5)` 是否为 Supabase 正确 schema qualification；
3. runtime probe 是否确保成功后无测试 token 残留；
4. 026 是否保持原函数权限和业务契约；
5. 六页是否仍保留完整左侧导航；
6. 是否误删任何当前页面必要动作；
7. 是否仍有重复栏目快捷入口或无处理按钮；
8. 是否仍有不必要的后台设计语言暴露；
9. 测试是否足以防止本次两类问题回归。

## 10. Claude 输出格式

请输出：

1. 总结论：`PASS` / `PASS WITH CONDITIONS` / `FAIL`；
2. P0/P1/P2，附文件与行号；
3. Migration 026 安全结论；
4. 按钮去向与交互逻辑结论；
5. 前台语言边界结论；
6. 是否批准以下 Preview 恢复顺序：

```text
创建精确修复 commit
→ Preview 执行 Migration 026
→ 部署同一精确 commit
→ 二维码 E2E
→ 服务码 E2E
→ unguided E2E
```

Production 需要后续单独授权。
