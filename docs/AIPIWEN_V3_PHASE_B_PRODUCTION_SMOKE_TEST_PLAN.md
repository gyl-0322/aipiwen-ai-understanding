# AIPIWEN V3.0 Phase B Production Smoke Test Plan

**适用 Release commit**：`cec3f5dd5e8712fecc804452d32aee3e13a04398`
**执行时机**：Production migration 020、021、022 与精确 Release commit 部署均获单独授权并成功后
**当前状态**：PLAN ONLY — 本 Sprint 不执行

## 1. 测试边界与准备

1. 确认 Production Supabase project 为 `tysbwijizgebnrazxpvo`。
2. 确认 migration 已按 `020 → 021 → 022` 完成且 postflight 全部 PASS。
3. 确认部署 commit 与本文件记录的 Release commit 完全一致。
4. 仅使用受控测试账号和不包含真实客户、儿童、手机号或生物特征隐私的隔离 fixture。
5. 不绕过 OTP、CSRF、SameOrigin、Session 或 RLS。
6. 记录页面、时间、HTTP 状态、业务结果和必要截图；不记录 secret、cookie、token、验证码、原始 OCR 或 Base64 图片。

## 2. C 端入口

| 步骤 | 操作 | 预期 |
| --- | --- | --- |
| C-01 | 访问 `https://www.aipiwen.cn/` | 显示人格理解系统首页，不跳入指导师登录 |
| C-02 | 检查首页主要业务入口 | 原有人格理解系统功能保持 |
| C-03 | 点击“指导师工作台” | 进入 `/advisor` |
| C-04 | 检查 `/advisor` | 进入 V3 登录页 `/login.html` |
| C-05 | 未登录访问工作台 | 返回或跳转登录页，不暴露工作台数据 |

## 3. 指导师归属闭环

使用一个 active advisor 测试账号：

1. 通过手机号与密码或合规 OTP 完成登录。
2. 进入指导师工作台与“我的客户”。
3. 创建一个客户归属 token / 二维码。
4. 确认二维码 URL 指向 `/report-upload.html?token=...`，证据中遮蔽 token。
5. 使用隔离 fixture 完成上传。
6. 验证 OCR 契约成功，不在日志记录原始图片或 raw OCR。
7. 完成 generate-report 与 report-store。
8. 验证 Attribution 消费成功：
   - `source = advisor_qr`
   - 当前 `advisor_user_id` 为登录指导师
   - token 使用次数正确
9. 验证指导师“我的客户”出现该客户且只出现一次。
10. 重试同一幂等请求，确认不会创建重复客户或报告。

## 4. 无归属客户与总部调整

1. 不携带 token，使用另一份隔离 fixture 完成报告流程。
2. 验证客户状态：
   - `source = unguided`
   - `advisor_user_id IS NULL`
3. 使用 active super_admin 登录总部后台。
4. 打开无归属客户池，确认该测试客户可见。
5. 调用总部 assign 操作，将其分配给 active advisor。
6. 验证：
   - `advisor_user_id` 已更新
   - `assigned_by_user_id` 为执行管理员
   - `assigned_at` 非空
   - `source` 仍为 `unguided`，不可因分配而改变
7. 验证 `admin_audit_logs` 新增 `ASSIGN_CLIENT`，包含客户、原归属、新归属、原因与时间，不含 secret 或隐私载荷。
8. 验证目标指导师客户列表出现该客户且只出现一次。

## 5. Token 生命周期与安全负向测试

| 检查 | 预期 |
| --- | --- |
| 非 active advisor 创建 token | 拒绝 |
| 过期 token | 拒绝 |
| exhausted token | 拒绝 |
| revoked token | 拒绝 |
| anon 执行 assign | 拒绝 |
| advisor 执行 assign | 拒绝 |
| agent / center 执行 assign | 拒绝 |
| 缺失或错误 CSRF | 拒绝 |
| 非允许 Origin | 拒绝 |
| 试图修改 `source` | 拒绝 |
| 试图通过请求传入 `advisor_id` 越权 | 忽略或拒绝；归属只能从 Session / token 推导 |

## 6. Privacy Patch

1. 仅检查本次新建的隔离测试索引记录。
2. 确认新 `cases:index` entry 不包含 `name`。
3. 确认新 `cases:index` entry 不包含 `ip`。
4. 确认保留：`id`、`type`、`age`、`channel`、`brain`、`mType`、`plusR`、`createdAt`。
5. 不读取、不输出、不清理历史 `cases:index` 内容。

## 7. 清理

仅清理本次 Production Smoke Test 明确创建的 fixture 数据、token 和测试 KV 对象。执行删除前逐一解析精确 ID，不使用宽泛条件，不影响任何真实用户或既有数据。清理结果应记录对象类型与数量，不记录隐私内容。

## 8. PASS 标准

- C 端根域名与指导师入口正确
- 指导师登录、token、上传、报告、客户列表闭环成功
- 无 token 客户进入无归属池
- super_admin assign 与 `ASSIGN_CLIENT` audit 成功
- 权限与 `source` 不可变规则无越界
- 新 `cases:index` 不再写入 `name`、`ip`
- 无敏感信息进入测试证据或日志

## 9. Stop Conditions

出现以下任一项立即停止，不继续邀请 Beta 用户：

1. 登录、Session 或 OTP 失败；
2. advisor、anon、agent 或 center 可越权 assign；
3. `source` 可被修改；
4. 归属错误、重复客户或重复报告；
5. 审计记录缺失；
6. 新索引仍写入 `name` 或 `ip`；
7. 日志或证据泄露 secret、token、验证码、图片或客户隐私；
8. 需要新增 migration、修改 Auth、Session 或 Report Engine 架构。
