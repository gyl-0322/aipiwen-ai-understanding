# AIPIWEN V3.0 指导师服务码实施报告

## 1. 执行结论

- 状态：**READY FOR CLAUDE REVIEW**
- 实施范围：本地代码、补充 migration、契约测试与隔离数据库演练
- Preview migration：**未执行**
- Production migration：**未执行**
- Preview deploy：**未执行**
- Production deploy：**未执行**

本次保持现有二维码 token、无归属上传、注册邀请码、Auth、Session、报告引擎和客户归属入库 RPC 不变，只增加同一 attribution token 的手工服务码备用入口。

## 2. 产品行为

### 二维码主路径

指导师在“我的客户”生成一次性二维码。页面同时显示同一条 attribution token 对应的指导师服务码。二维码仍打开：

`/report-upload.html?token=<REDACTED>`

上传页公开验证 token，只显示指导师展示名，不返回内部指导师 ID。

### 服务码备用路径

客户从首页直接进入上传页后，可以展开“已有指导师服务码”并输入 10 位服务码。服务码验证成功后，BFF 将其换取同一条一次性 attribution token，后续继续调用现有 `v3a_store_attributed_report`。

### 无归属路径

客户不填写服务码时，继续使用现有 `unguided` 路径。填写但未确认服务码时，页面阻止继续识别，避免错误地创建无归属客户。

## 3. 修改文件

- `supabase/migrations/025_v3a_attribution_service_code.sql`
- `api/v3a-attribution.js`
- `ai-interpreter-customers.html`
- `static/v3a-attribution.js`
- `report-upload.html`
- `scripts/test-v3a-attribution-service-code.js`
- `docs/AIPIWEN_V3_ATTRIBUTION_SERVICE_CODE_IMPLEMENTATION_REPORT.md`

未修改 `invite_codes`、`api/generate-report.js`、`v3a_store_attributed_report`、Auth、Session、Vercel 路由或函数数量。

## 4. Migration 025

- 为现有 `attribution_tokens` 增加唯一、非空的 `service_code`。
- 服务码为 10 位大写十六进制随机值，页面按 `4-4-2` 分组显示。
- 服务码与现有 token 共用：
  - 同一有效期；
  - 同一 `max_uses`；
  - 同一撤销、过期和耗尽状态；
  - 同一次原子消耗。
- 更新 `v3a_create_attribution_token(integer)`，同时返回 token 与服务码。
- 新增 `v3a_validate_attribution_service_code(text)`，只用于把有效服务码换取现有 attribution token。
- 原 `v3a_store_attributed_report(text,uuid,text,text,integer,jsonb,jsonb)` 未替换、未复制、未改变签名。
- `attribution_tokens` 继续不向 `anon`、`authenticated` 或 `service_role` 开放表读取。
- 服务码验证 RPC 只授权 `anon`、`authenticated`；创建 RPC 仍只授权 `authenticated`。

## 5. 安全与兼容性

- 不复用指导师注册邀请码。
- 不接受浏览器提交 `advisor_id`。
- 不把服务码或 attribution token 写入 Local Storage。
- 不向公开响应返回内部指导师 ID、手机号或客户数据。
- 手工服务码验证按 IP 限制为每 10 分钟 20 次；限流键由现有 Session 安全组件进行 HMAC 处理，不保存或输出明文 IP。
- 原二维码 token 验证不受新增服务码限流影响。
- QR token 路径保持兼容。
- 无 token 的 `unguided` 路径保持兼容。
- 服务码失效、过期、撤销或耗尽时 fail closed。
- Vercel Function 数量保持 12/12。

## 6. 验证结果

| 验证 | 结果 |
| --- | --- |
| Migration 025 独立 PostgreSQL 全事务演练 | PASS |
| 服务码契约测试 | PASS — 41/41 |
| Phase B attribution 回归 | PASS — 64/64 |
| Phase B-2 hardening 回归 | PASS — 16/16 |
| Phase A report import 回归 | PASS — 93/93 |
| cases:index privacy | PASS — 3/3 |
| Vercel Function budget | PASS — 12/12 |
| Node Check | PASS |
| report-upload inline JavaScript 解析 | PASS |
| Vercel Preview Build | PASS |

隔离 PostgreSQL 实例未连接 Preview 或 Production，演练后已停止并移动到本机废纸篓。

## 7. 发布顺序

为保持现有二维码功能不中断，若 Review 通过，必须严格按以下顺序另行授权执行：

1. Preview 执行 migration 025；
2. Preview 部署代码；
3. 验证旧二维码、服务码、无归属三条路径；
4. Claude Review；
5. 取得单独 Production migration 授权；
6. Production 执行 migration 025；
7. 部署同一审核通过的精确 commit；
8. 完成 Production Smoke Test。

禁止先部署代码再执行 migration；否则二维码创建接口会因为数据库尚未返回服务码而失败。

## 8. 未完成事项

- 未执行任何在线 migration。
- 未执行任何部署。
- 未创建真实服务码、客户或报告。
- 未进入机构服务码或机构客户池设计。
- Claude 首轮只读 Review：PASS WITH CONDITIONS。
- 首轮提出的 IP 限流与“重新编辑输入清除旧 token”专项测试已完成，等待 Claude 增量复核。
