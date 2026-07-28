# AIPIWEN V3.0 Production Migration 019 Codex Correction Report

日期：2026-07-28

范围：仅修正与本地验证 Migration 019

Production 执行状态：**未执行**

## 1. 结论

Claude 生成的原始 019 不能直接用于 Production。Codex 已基于 Production 只读对象证据重建并修正：

- `supabase/migrations/019_v3a_production_drift_recovery_and_auto_activate.sql`
- `scripts/test-v3a-production-drift-recovery-migration.js`

修正版已通过静态契约测试、相关既有测试和临时本地 PostgreSQL 完整事务演练，并已获得 Claude 条件批准。产品负责人已明确本次 Production Beta 暂不开放邀请码自动关系和 `other` 从业类型，保留现有安全门禁。

2026-07-28 的 Production 只读 Preflight 已通过，但尚未取得 Migration 执行授权。

## 2. Production Live Object Matrix

以下结论来自 Production Supabase 的只读对象查询；没有读取或记录手机号、验证码、密钥、Token、Cookie、Session 或用户身份内容。

| 对象阶段 | 现场证据 | 判断 |
| --- | --- | --- |
| 001 | 核心表存在，且 `admin_audit_logs.operator_user_id`、`credit_logs.operator_user_id/reason` 等旧列存在 | 001 基线对象存在 |
| 002 | 4 个 current-user helper、旧资产读取策略、旧注册奖励触发器存在 | 002 基线对象存在 |
| 004 | `admin_id/details`、`operator_id/note` 等最终列不存在 | 004 最终结构未生效 |
| 006 | `v3a_bootstrap_first_super_admin(uuid,text)` 存在 | 006 对象存在 |
| 007–008 | 审核 RPC、最终安全约束和最终注册奖励触发器不存在 | 最终对象未生效 |
| 010、013–016 | 手机约束和 `v3a_submit_pending_application` 最终 RPC 不存在 | 最终对象未生效 |
| 017 | `v3a_auto_activate_advisor` 不存在 | 未生效 |
| 018 | `v3a_rebind_verified_phone_account` 不存在 | 未生效 |
| 005、009、011、012 | 本次没有足够的独立对象证据建立精确迁移账本 | 不作已执行/未执行推断 |

现场聚合行数：

- `admin_audit_logs`：0
- `credit_logs`：0
- `credit_wallets`：0
- `invite_codes`：0
- `invite_relations`：0
- `application_reviews`：1

019 会重新检查以上冻结条件；任何漂移都会在结构变更前终止。

## 3. 原始 019 的阻断问题

原始文件存在以下不可接受风险：

1. 顶层 `RAISE NOTICE` 不是合法的独立 SQL 语句。
2. Review 对 Production 迁移状态的判断包含推断，与只读现场对象不一致。
3. 已存在的 002 RLS policy 名称可能与新 policy 冲突。
4. 邀请码输入经过校验后没有建立邀请关系。
5. `practitioner_type = 'other'` 的说明经过校验后没有按批准规则保存。
6. 验收建议包含宽泛 `select *`，不满足最小化和脱敏要求。
7. Postflight 未充分验证 RPC 签名、权限、触发器绑定、约束、策略和数据不变性。
8. 替换 014 从业分类约束前没有检查旧分类值，可能在事务中途才失败。

## 4. Codex 修正

修正版 019：

- 使用单一原子事务、5 秒锁超时和 120 秒语句超时。
- 锁定相关表后执行严格 preflight。
- 只接受已核验的 001/002/006 对象基线。
- 要求 5 个资产/审计/邀请表为空且审核表恰好 1 行。
- 在替换从业分类约束前检查现有值；需要业务映射时立即停止，不读取或输出具体值。
- 删除旧 policy 名称后再创建最终 policy，避免对象冲突。
- 恢复 004、007、008、010、014、016、017、018 所需最终对象。
- 明确限制 RPC 权限：用户 RPC 只给 `authenticated`，审核 RPC 只给 `service_role`。
- 验证最终函数签名、权限、触发器绑定、约束、策略及聚合行数不变性。
- 禁止宽泛 `select *` 验收，仅允许布尔值和聚合结果。
- 邀请码或 `other` 说明进入自动开通 RPC 时返回明确业务门禁错误，不静默丢弃。

## 5. 本地数据库演练

环境：临时本地 PostgreSQL，模拟已核验的 001/002/006 基线；使用完全虚构的测试 UUID 和测试文本，不连接 Production。

### 兼容路径

- 019 整段事务执行：PASS
- 最终自动开通 RPC 存在：PASS
- 原 1 条审核记录数量保持：PASS
- 钱包、积分、邀请码、邀请关系、审计表保持 0 行：PASS
- 原 pending 状态保持：PASS

### 不兼容旧分类路径

- preflight 在结构变更前阻断：PASS
- 整段事务回滚：PASS
- 旧列结构保持：PASS
- 未创建最终自动开通 RPC：PASS

### 普通指导师自动开通运行路径

迁移完成后，使用新的虚构已验证手机号 Auth 账号连续调用自动开通 RPC 两次：

- `users` / `advisor_profiles` 均为 `advisor + active`：PASS
- 钱包唯一且余额为 500：PASS
- `REGISTER_BONUS` 唯一且金额为 500：PASS
- Active 邀请码唯一：PASS
- 自动开通审计记录唯一：PASS
- 未提供邀请码时不创建邀请关系：PASS

## 6. 测试

- `node scripts/test-v3a-production-drift-recovery-migration.js`：PASS
- `node scripts/test-v3a-auto-advisor-migration.js`：PASS
- `node scripts/test-v3a-httponly-session.js`：PASS
- `node --check scripts/test-v3a-production-drift-recovery-migration.js`：PASS
- 全部 14 个 `scripts/test-*.js`：PASS
- `scripts/`、`server/`、`api/` 全部 JavaScript `node --check`：PASS
- 目标文件 `git diff --check`：PASS

当前 SHA-256：

- Migration 019：`cb72efca1d0b5c01d21294899fd623368704c78d295291ec249ba506420a2b47`
- 019 静态测试：`174803ceec1a9608024d052a2af6cb884a99100c4daa6e78a19b504f96b83ed9`

最终质量检查后若文件发生变化，应重新生成哈希。

## 7. Production Beta 范围决定

产品负责人于 2026-07-28 明确：

- 本次 Production Beta 暂不开放邀请码自动关系。
- 本次 Production Beta 暂不开放 `other` 从业类型。
- 保持现有 fail-closed 门禁，不静默接受、不静默丢弃输入。

修正版当前行为：

- 有邀请码：`AUTO_ACTIVATION_INVITE_RULE_UNAPPROVED`
- `other` 说明：`AUTO_ACTIVATION_OTHER_NOTE_RULE_UNAPPROVED`

普通指导师使用已批准分类且不携带邀请码时，不受这两个门禁影响。

## 8. Production 只读 Preflight

执行时间：2026-07-28 03:50 PDT

执行位置：Production Supabase SQL Editor

查询范围：仅 `SELECT`、布尔值和聚合数量。没有执行 Migration，没有修改数据库，没有读取或输出用户身份内容、手机号、验证码或任何 Secret。

结果：

- `admin_audit_logs` 为空：PASS
- `credit_logs` 为空：PASS
- `credit_wallets` 为空：PASS
- `invite_codes` 为空：PASS
- `invite_relations` 为空：PASS
- `application_reviews` 恰好 1 行：PASS
- 审核状态分布为 pending 1、approved 0、rejected 0、withdrawn 0：PASS
- `advisor_profiles` 现有从业分类兼容：PASS
- `application_reviews` 现有从业分类兼容：PASS
- pre-004 `admin_audit_logs` 列结构匹配：PASS
- pre-004 `credit_logs` 列结构匹配：PASS
- 001/002/006 helper 数量为 5：PASS
- 意外 007–018 RPC 数量为 0：PASS
- 意外最终约束数量为 0：PASS
- 意外最终触发器数量为 0：PASS
- 已核验旧资产读取策略数量为 4：PASS

Preflight 结论：**PASS**。

注意：这是执行前现场快照。019 自身仍会在未来获得执行授权后，通过事务锁和内部 preflight 再次检查现场漂移。

## 9. 下一步

1. 取得单独、明确的 Production Migration 019 执行授权。
2. 获得授权后，仅在确认 Production 项目无误的情况下执行 019。
3. 执行后按 019 的脱敏 postflight 和人工验收步骤核验。

当前停止点：**Production Migration 未执行。**
