# AIPIWEN Phase B-2 Attribution Release Hardening Report

## 0. 结论

执行时间：2026-07-29 16:38:42 PDT

状态：**STOPPED / THREE CONDITIONS PASS / RELEASE READY BLOCKED**

Phase B-1 Preview Validation 的三个既定条件均已关闭：

1. Super Admin 真实归属调整：PASS
2. Report Upload 完整图片 E2E：PASS
3. Preview KV 合成数据清理：PASS

自动化测试、Node Check 和 Preview Build 全部 PASS。

但在 KV 清理过程中发现：现有 Report Engine 的 `cases:index` 历史记录同时保存姓名和来源 IP。该数据最小化风险属于既有 Report Engine 核心，修复会超出本 Sprint 边界，并命中以下 Stop Conditions：

- 需要修改 Report Engine 核心；
- 发现客户隐私风险。

因此，本报告不能把 Attribution Layer 标记为最终 Release Ready。已停止，等待 Claude Review；未进入 Phase C。

Production 未执行 migration、未部署、未修改。

## 1. Super Admin Assignment E2E

### 1.1 受控 Preview 身份

Preview 执行前状态：

- active `super_admin`：0
- active advisor：2

本轮创建了一套独立、随机凭据的 Preview-only Auth fixture，凭据仅存在于进程内存，未写入聊天、文件、Git、终端输出或报告。

现有 owner-only bootstrap RPC 存在格式兼容问题：

- Supabase Auth 实际规范化存储为 `86…`
- bootstrap RPC 只接受 `+86…`

修改 Auth、Session 或 bootstrap RPC 超出本 Sprint 边界，因此没有修改这些组件。测试使用受控 `public.users` fixture 映射验证现有 BFF/RPC 运行链路；没有修改任何既有真实用户身份。

验收后：

- 测试业务身份：`disabled`
- 测试 Auth 身份：已封禁
- active `super_admin`：恢复为 0
- 不存在可登录的测试高权限账号

因 `admin_audit_logs` 为 append-only 且对管理员外键使用 `ON DELETE RESTRICT`，测试管理员映射不能物理删除；保留 disabled 行是维持审计完整性的必要结果。

### 1.2 五重校验

使用真实 Preview HttpOnly BFF Session 执行：

`POST /api/v3a-admin/assign`

结果：

- active `super_admin` Session：PASS
- 缺少 CSRF：403，PASS
- 错误 Origin：403，PASS
- 客户存在且当前未分配：PASS
- 目标指导师存在且 active：PASS
- 正确请求：HTTP 200，PASS

未使用 Bearer token 替代浏览器 Session，未绕过 CSRF 或 SameOrigin。

### 1.3 数据更新

使用 `source = unguided` 的隔离客户执行分配后验证：

- `advisor_user_id` 更新为目标 active advisor：PASS
- `assigned_by_user_id` 更新为测试 super_admin：PASS
- `assigned_at` 非空：PASS
- `source` 仍为 `unguided`：PASS

分配验证完成后，隔离客户及其报告行已删除。

## 2. Audit 结果

真实分配产生恰好一条 `ASSIGN_CLIENT` 记录：PASS。

审计内容验证：

- client：存在
- previous advisor：存在且为 NULL
- new advisor：存在
- reason：存在且与本轮受控原因一致
- assigned timestamp：存在
- audit `created_at`：存在

审计记录为 append-only，按设计保留。报告不记录任何内部 UUID、手机号、Session、token 或 secret。

## 3. Report Upload 图片 E2E

### 3.1 隔离 Fixture

使用程序生成的 PNG 总表：

- 明确标注“Preview 隔离测试 · 非真实客户”
- 成人虚构样本，年龄 30
- 不对应任何自然人
- 不包含真实儿童或客户数据
- SHA-256：`1be3f86f2554ab1527022438283264b48ea68d83fd12f76501ff7e546ed24a81`

本地临时 SVG 与执行脚本已删除；PNG 已移动到 macOS Trash，可恢复但不再位于工作目录或 `/tmp`。

### 3.2 完整网页链路

使用当前 active advisor 的真实 Preview 浏览器 Session：

1. “客户归属二维码”通过 BFF Session + CSRF 创建一次性 token：PASS
2. 打开唯一入口 `/report-upload.html?token=...`：PASS
3. 通过真实网页文件选择器上传 PNG：PASS
4. `/api/extract-fp` OCR：PASS
5. 确认识别数据并运行既有 TRC Engine：PASS
6. `/api/generate-report`：PASS
7. `/api/report-store`：PASS
8. `v3a_store_attributed_report`：PASS

未复制上传页面，未修改 OCR、Report Engine 或 Phase A RPC。

### 3.3 OCR 结果

- 虚构姓名准确：PASS
- 成人年龄准确：PASS
- ATD = 42：PASS
- 10 个脑区全部识别：PASS
- 十指纹型与 TRC 共 10 组全部与 fixture 一致：PASS
- raw OCR 未写入报告或日志：PASS

### 3.4 Attribution 结果

- `advisor_clients` 创建恰好 1 条：PASS
- `advisor_reports` 创建恰好 1 条：PASS
- `source = advisor_qr`：PASS
- `advisor_user_id` 为 token 所属 active advisor：PASS
- 报告状态 `ready`：PASS
- generated report 非空：PASS
- attribution token 状态 `exhausted`：PASS
- `used_count = max_uses`：PASS

## 4. Advisor 客户结果

真实浏览器刷新“我的客户”后：

- 隔离客户出现在“我的真实客户”：PASS
- 只出现一次：PASS
- 来源显示为归属二维码：PASS
- 报告数为 1：PASS
- 报告状态为已生成：PASS

完成证据确认后：

- B2 `advisor_clients` fixture：已删除
- B2 `advisor_reports` fixture：已删除
- 对应 attribution token：已删除
- 再次刷新客户页，隔离客户不存在：PASS

## 5. Preview KV 清理结果

清理通过 Vercel Marketplace 官方 SSO 打开的 Preview 独立 Upstash 资源完成，未读取或降低任何 Sensitive 环境变量。

目标资源：`upstash-kv-beige-compass`

精确清理：

- B1 Preview QR 合成报告对象：已删除
- B1 Preview Unguided 合成报告对象：已删除
- B2 图片 E2E 合成报告对象：已删除
- 三条对应 `cases:index` 项：已删除

验证：

- 三个精确 `report:*` key 均不存在：PASS
- `cases:index` 长度由 83 降至 80：PASS
- 删除数量恰好为 3：PASS
- 未删除或修改其他 key：PASS

清理只使用合成名称和精确 8 位测试 report ID 作为目标，没有读取 secret。

## 6. Regression 与 Quality Gate

### 6.1 自动化

- Phase A advisor report import：93/93 PASS
- Phase B-1 attribution：64/64 PASS
- Phase B-2 release hardening：16/16 PASS
- 全部 `scripts/test-*.js`：17/17 scripts PASS
- JavaScript `node --check`：50/50 files PASS

测试期间出现的 SMS hook provider 日志是既有隔离失败路径断言，不是测试失败；测试进程退出状态为 0。

### 6.2 Build

- `vercel build --target=preview`：PASS
- Function target：Preview
- 本轮未执行新的 deploy
- Production 未触碰

## 7. 隐私与安全检查

本轮未在代码、报告、Git 或临时文件中保存：

- Auth 密码
- 手机号
- OTP
- Session / Cookie
- attribution token
- Supabase / Vercel / KV secret
- raw OCR
- Base64 图片

测试图片不含真实客户数据。受控测试凭据未输出。

### 7.1 新发现的 Stop Condition

在 Upstash Data Browser 精确删除三条合成索引时，现有 `cases:index` 的其他历史项目被控制台渲染；其数据结构同时包含姓名和来源 IP。

风险判断：

- 姓名与来源 IP 同时保存，超出客户列表归属验证所需的最小数据；
- 该问题来自既有 Report Engine `pushCaseIndex` 存储结构；
- 本 Sprint 禁止修改 Report Engine 核心；
- 未继续读取、导出或复制其他历史项目内容；
- 未对其他历史项目执行删除或更新。

处理结果：**触发 Stop Condition，停止并交 Claude Review。**

## 8. 已知限制

1. Preview phone-first super_admin bootstrap 对 Supabase Auth 的手机号规范化格式不兼容；本轮未修改。
2. 受控测试管理员因 append-only audit 外键必须保留 disabled 映射；Auth 已封禁，不能登录。
3. `cases:index` 同时保存姓名与来源 IP，Release Ready 必须由独立的隐私/Report Engine 修复 Sprint 处理。
4. Agent/Center 权限、PDF、AI Coach、Phase C 均未进入。

## 9. Gate 汇总

| Gate | 结果 | 说明 |
|---|---|---|
| Super Admin assign E2E | PASS | Session / CSRF / SameOrigin / 五重校验 |
| ASSIGN_CLIENT audit | PASS | 完整字段，恰好一条 |
| 图片 OCR E2E | PASS | 10 指、年龄、ATD 全部命中 |
| Report Engine | PASS | 真实生成成功，核心未修改 |
| Attribution | PASS | advisor_qr、正确 advisor、token consumed |
| Advisor Workspace | PASS | 客户出现一次 |
| Preview KV cleanup | PASS | 3 个 report key + 3 个索引项 |
| Phase A regression | PASS | 93/93 |
| Phase B regression | PASS | 64/64 |
| Phase B-2 tests | PASS | 16/16 |
| Build / Node Check | PASS | Preview build；50/50 checks |
| Test fixture teardown | PASS | 高权限账号不可用；可删数据已清 |
| Privacy Stop Condition | **TRIGGERED** | cases:index 保存姓名 + IP |
| Production untouched | PASS | 无 migration、deploy、配置修改 |
| Release Ready | **BLOCKED** | 等待隐私风险处置与 Claude Review |

## 10. 下一步边界

本 Sprint 到此停止。

等待 Claude Review 判断：是否单独开启一个最小隐私修复 Sprint，对 Report Engine `cases:index` 做数据最小化、历史数据治理和回归验证。

在 Claude Review 和新的明确授权前：

- 不进入 Phase C；
- 不修改 Report Engine；
- 不部署；
- 不触碰 Production。
