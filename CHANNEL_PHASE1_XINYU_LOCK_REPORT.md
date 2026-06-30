# CHANNEL_PHASE1_XINYU_LOCK_REPORT

生成日期：2026-06-30

## 1. 当前分支名

当前分支：`feature/channel-system-xinyu-phase1`

## 2. 当前 Phase 1 锁版结论

Phase 1 本地闭环进入锁版状态。

当前结论：

- 逻辑闭环：通过
- 页面人工复验：通过
- referral / attribution 方向：通过
- mock order / commission_record 规则：通过
- 权限隔离方向：通过
- 是否可内部演示：可以
- 是否可上线：不可以
- 是否进入 Phase 2：暂不进入

本锁版仅代表本地演示闭环可保留，不代表生产发布许可。

## 3. 本轮已完成能力清单

Phase 1 已完成以下本地可演示能力：

1. 鑫域文化作为一级服务商存在。
2. 一级服务商页面固定展示：`鑫域文化 · 一级服务商`。
3. 一级服务商拥有 C 端推广入口：`tid=xinyu&ref=xinyu_c`。
4. 二级服务商页面固定展示：`测试服务商 · 二级服务商`。
5. 二级服务商拥有 C 端推广入口：`tid=inst_001&ref=inst_001_c`。
6. referral link 与 QR 内容一致。
7. 用户首次通过有效 ref 登录后锁定 attribution。
8. 已锁定 attribution 后续扫码只记录 last_touch，不自动覆盖收益归属。
9. 一级服务商可查看二级服务商统计、订单与佣金概览。
10. 一级服务商不能查看二级服务商客户报告正文、对话内容、上传资料和个人档案。
11. 二级服务商只能查看本服务商数据，不能查看其他服务商数据。
12. 二级服务商不能创建下级服务商。
13. seat 支持 staff / experience / gift / customer 四类账号名额。
14. mock order 与 commission_record 支持本地演示佣金规则。
15. 页面明确标注本地演示、mock 数据、非真实结算。

## 4. 一级服务商页面最终状态

页面：`channel-admin.html`

本地访问：`http://127.0.0.1:3001/channel-admin.html`

最终展示状态：

- 页面标题：`AIPIWEN 鑫域文化服务商后台`
- 顶部身份：`一级服务商`
- 当前身份：`鑫域文化 · 一级服务商`
- 品牌名称：`鑫域文化`
- 角色说明：`可拓展二级服务商，可推广 C 端用户，可查看统计与模拟佣金。`
- 一级推广链接：`http://127.0.0.1:3001/?tid=xinyu&ref=xinyu_c`
- 二级服务商样例：`测试服务商`
- 二级服务商样例状态：`演示中`
- 样例归因用户数：1
- 样例模拟订单数：1
- 样例模拟佣金数：1

页面保留的核心提示：

`本地演示环境 · Phase 1 · 模拟订单/模拟佣金，不代表真实结算`

## 5. 二级服务商页面最终状态

页面：`institution-admin.html`

本地访问：`http://127.0.0.1:3001/institution-admin.html`

最终展示状态：

- 页面标题：`AIPIWEN 服务商后台`
- 顶部身份：`二级服务商`
- 当前身份：`测试服务商 · 二级服务商`
- 品牌名称：`测试服务商`
- 角色说明：`可服务本服务商客户，可推广 C端用户，可查看本服务商统计与模拟佣金。`
- 二级推广链接：`http://127.0.0.1:3001/?tid=inst_001&ref=inst_001_c`
- 核心佣金规则：`本服务商 C 端佣金只归本服务商，不再上返一级服务商。`

## 6. referral / attribution 规则

Phase 1 锁版规则：

1. `tid` 表示租户 / 品牌上下文，用于页面展示、白标品牌和 tenant context。
2. `ref` 表示商业归因码，用于归因、订单收益归属和佣金记录。
3. 一级服务商 C 端入口：`tid=xinyu&ref=xinyu_c`。
4. 二级服务商 C 端入口：`tid=inst_001&ref=inst_001_c`。
5. 新用户首次通过有效 ref 登录后生成 attribution。
6. attribution 一旦 `locked=true`，后续扫码不自动覆盖收益归属。
7. 后续扫码可记录 `last_touch`。
8. 只有平台管理员可以手动修正 attribution。
9. 手动修正必须写入 audit 信息：old_attribution / new_attribution / operator / reason / timestamp。

## 7. mock order / commission_record 规则

当前仍为本地 mock。

mock order 字段方向：

- orderId
- payerOpenid
- payerTenantId
- productType
- amountFen
- attributionId
- status：mock_pending / mock_paid / mock_cancelled
- createdAt

commission_record 字段方向：

- commissionId
- orderId
- beneficiaryTenantId
- commissionType
- baseAmountFen
- rate
- commissionAmountFen
- status：pending / confirmed / cancelled
- createdAt

佣金规则：

1. 鑫域文化直推 C 端用户：20%。
2. 二级服务商直推 C 端用户：20%。
3. 二级服务商 C 端用户充值不向鑫域文化上返 C 端佣金。
4. 二级服务商首年服务费：鑫域文化 40%。
5. 二级服务商续费：鑫域文化 30%。

页面展示已业务化：

- `order_inst_c` 展示为 `模拟订单-001`。
- `comm_order_inst_c` 展示为 `模拟佣金-001`。
- `C端用户直推佣金` 展示为 `C端推广佣金`。
- `mock_paid` 展示为 `模拟已支付`。
- `pending` 展示为 `待人工确认`。

## 8. 权限隔离规则

锁版权限规则：

1. 未登录访问后台 API 返回 401。
2. C 端用户访问平台初始化 API 返回 403。
3. 一级服务商不能读取二级服务商客户报告正文。
4. 一级服务商不能读取二级服务商客户会话。
5. 一级服务商不能读取二级服务商客户档案。
6. 一级服务商只能看二级服务商列表、用量统计、订单统计、佣金统计。
7. 二级服务商只能查看本服务商 tenantId 下的数据。
8. 二级服务商访问其他服务商数据返回 403。
9. 二级服务商创建下级服务商返回 403。
10. C 端用户只能按 openid 读取自己的数据。
11. 任何跨 tenant 请求必须返回 403。
12. 低权限访问平台 API 返回 403。

页面展示文案：

- 一级服务商：`一级服务商可以查看二级服务商的统计、订单与佣金概览；不能查看二级服务商客户的报告正文、对话内容、上传资料和个人档案。`
- 二级服务商：`二级服务商只能查看本服务商客户与统计数据；不能查看其他服务商数据，也不能创建下级服务商。`

## 9. 测试结果

本轮锁版前已执行：

`node --test tests/channel-system-phase1.test.js`

结果：

- tests：5
- pass：5
- fail：0

通过项：

1. ref attribution first-lock and admin correction
2. seats keep type, quota, expiry and status
3. mock order and commission rules
4. API permission isolation

页面脚本语法检查此前已通过：

- `channel-admin.html` inline script syntax ok
- `institution-admin.html` inline script syntax ok

## 10. 当前仍为 mock 的内容

以下内容仍为本地 mock，不代表真实生产能力：

1. 模拟订单。
2. 模拟佣金。
3. 佣金金额。
4. 订单状态。
5. 佣金状态。
6. 二级服务商样例。
7. 归因用户数样例。
8. 账号名额展示。
9. referral / QR 的本地演示链路。
10. 后台统计数据。
11. 服务商开通流程。
12. 平台管理员人工修正归因的操作入口。

## 11. 当前不允许上线的原因

当前不建议上线，原因：

1. 仍为 Phase 1 本地演示后台，不是正式生产后台。
2. mock order / mock commission 尚未映射真实支付与真实订单状态。
3. 真实结算、退款、取消订单、佣金冲正规则未实现。
4. 生产 Redis key 命名、迁移和隔离策略未复核。
5. `TENANT_ENABLED=true` 的生产启用策略未确认。
6. 鑫域文化正式 logo、品牌色、入口路径未最终锁定。
7. 鑫域文化管理员 openid 与权限绑定未最终确认。
8. referral code 命名规则仍需生产级规范。
9. 隐私访问审计尚未完善为生产级。
10. 当前工作区存在 `vercel.json` 未提交修改，必须单独 diff 解释。
11. 页面仍是静态演示页，不确定是否作为 Phase 2 正式后台基础。

## 12. 上线前必须确认项

### 上线前必须复核

1. `vercel.json` 当前仍有未提交修改，必须单独 diff 解释，确认是否保留。
2. `TENANT_ENABLED=true` 的上线策略。
3. 生产 Redis key 命名和迁移策略。
4. 鑫域文化正式 logo、品牌色、入口路径。
5. 鑫域文化管理员身份 / openid / 权限绑定。
6. 二级服务商创建规则。
7. referral code 规则。
8. 真实订单状态与 mock order 的映射。
9. 真实佣金状态与 commission_record 的映射。
10. 退款 / 取消订单后的佣金冲正规则。
11. 隐私访问审计。
12. 用户归因人工修正规则。
13. 是否保留 /lite 路由。
14. 是否将 `channel-admin.html` / `institution-admin.html` 继续作为静态页，还是 Phase 2 重构为正式后台。

## 13. Phase 2 候选事项

以下仅为候选，不代表已进入 Phase 2：

1. 正式服务商后台架构设计。
2. 服务商后台鉴权入口与管理员绑定。
3. 生产级 tenant 初始化与迁移脚本。
4. referral code 生成、冲突检测和管理规则。
5. 正式订单模型接入。
6. 正式 commission_record 状态机。
7. 退款、取消、冲正规则。
8. 隐私访问审计日志。
9. 服务商客户统计看板。
10. 正式二维码生成与下载。
11. 服务商品牌配置后台。
12. 是否保留静态后台页面或迁移到正式前端路由。
13. 鑫域文化正式入口与 C 端归因路径上线。

## 14. 当前 git status

```text
 M api/_lib.js
 M api/auth.js
 M api/generate-report.js
 M vercel.json
?? CHANNEL_PHASE1_XINYU_ACCEPTANCE_REPORT.md
?? CHANNEL_PHASE1_XINYU_FINAL_REVIEW.md
?? CHANNEL_PHASE1_XINYU_LOCK_REPORT.md
?? api/channel.js
?? channel-admin.html
?? institution-admin.html
?? tests/
```

## 15. 是否触碰线上配置

本轮锁版阶段没有触碰线上配置。

明确状态：

- 未 push。
- 未 deploy。
- 未 merge。
- 未改 Vercel。
- 未改 `.env` / `.env.local`。
- 未触碰生产 Redis。
- 未触碰 aipiwen.cn。
- 未接真实支付。
- 未做自动结算。
- 未做自动开票。
- 未做完整后台。

重要备注：工作区已有 `vercel.json` 未提交修改。锁版阶段未修改它，但上线前必须单独复核。

## 16. 本地 commit 建议

### 16.1 是否建议现在做一个本地 commit

建议做本地 commit，但不要立刻把所有工作区文件混在一个 commit 里。

原因：

- Phase 1 现在已经通过人工页面复验，适合形成可回溯快照。
- 当前工作区同时包含 Phase 1 渠道系统文件和此前已有报告体验改动。
- `vercel.json` 属于上线配置敏感文件，不建议不经 diff 解释就混入 Phase 1 commit。

### 16.2 commit message 建议

建议 Phase 1 单独 commit：

`feat(channel): lock xinyu phase1 local demo`

如果希望更强调未上线：

`chore(channel): preserve xinyu phase1 local demo snapshot`

### 16.3 这个 commit 应该包含哪些文件

建议包含 Phase 1 直接相关文件：

- `api/channel.js`
- `channel-admin.html`
- `institution-admin.html`
- `tests/channel-system-phase1.test.js`
- `CHANNEL_PHASE1_XINYU_ACCEPTANCE_REPORT.md`
- `CHANNEL_PHASE1_XINYU_FINAL_REVIEW.md`
- `CHANNEL_PHASE1_XINYU_LOCK_REPORT.md`

视 diff 内容决定是否包含：

- `api/_lib.js`：如果 diff 仅为 tenant / referral / attribution / seat / mock order / commission_record / 权限隔离相关，应包含在 Phase 1 commit。
- `api/auth.js`：如果 diff 为归因登录链路相关，应包含在 Phase 1 commit；如果混有其他登录或企微改动，应拆分。

### 16.4 不应该直接包含在这个 commit 里的文件

不建议直接混入 Phase 1 commit：

- `vercel.json`：必须先单独 diff 解释，确认是否属于 Phase 1 必要变更。当前不建议直接包含。
- `api/generate-report.js`：如果这是此前报告体验或 PDF/报告输出改动，建议单独 commit，不与 Phase 1 渠道系统混合。
- 与 `/lite`、报告体验、C 端页面、生产部署配置相关的无关改动。

### 16.5 是否建议拆分 commit

建议拆分。

推荐拆分方式：

1. Phase 1 渠道系统本地演示闭环 commit：
   - `api/_lib.js` 中 Phase 1 相关数据结构与权限逻辑
   - `api/auth.js` 中 referral attribution 登录链路相关改动
   - `api/channel.js`
   - `channel-admin.html`
   - `institution-admin.html`
   - `tests/channel-system-phase1.test.js`
   - 三份 Phase 1 验收/锁版报告

2. 报告体验 / 完整报告输出相关 commit：
   - `api/generate-report.js`
   - 其他报告模板、PDF、年龄段主题变量等相关文件

3. 部署 / 路由配置 commit：
   - `vercel.json`
   - 任何线上路由或 rewrite 配置

`vercel.json` 不建议和 Phase 1 本地演示 commit 混在一起。
