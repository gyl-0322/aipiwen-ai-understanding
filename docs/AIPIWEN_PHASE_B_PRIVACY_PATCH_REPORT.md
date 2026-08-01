# AIPIWEN Phase B Release Privacy Patch Report

## 0. 结论

- 状态：PASS / READY FOR CLAUDE REVIEW
- 完成时间：2026-07-29 17:18:15 PDT
- Production：未操作
- Deploy：未执行
- Migration：0 修改
- 历史 KV：未读取、未清理、未修改

本补丁只停止 `cases:index` 新增写入不必要的 PII 字段，没有修改 Report Engine 主流程、report-store、OCR、attribution、Auth 或 Session。

## 1. 修改文件

### 1.1 业务代码

- `api/generate-report.js`
  - 从 `pushCaseIndex({...})` entry 删除 `name`
  - 从 `pushCaseIndex({...})` entry 删除 `ip`

业务代码改动仅为删除上述两行，没有修改 `pushCaseIndex()` 的 Redis 命令、索引 key、长度限制或错误处理。

### 1.2 测试

- `scripts/test-v3a-case-index-privacy.js`
  - 验证非 PII 摘要字段仍然存在
  - 验证 `name` 不再进入 `cases:index` entry
  - 验证 `ip` 不再进入 `cases:index` entry

### 1.3 报告

- `docs/AIPIWEN_PHASE_B_PRIVACY_PATCH_REPORT.md`

## 2. 修改原因

Claude Privacy Review 确认，既有 Report Engine 的 `cases:index` 摘要同时写入 `name` 和来源 `ip`。这两个字段不是案例索引筛选、统计和详情定位所必需的数据，继续新增写入不符合数据最小化原则。

本补丁仅停止后续新增 PII，不改变历史数据，也不改变完整报告对象的既有结构。

## 3. 字段结果

### 3.1 删除字段

- `name`
- `ip`

### 3.2 保留字段

- `id`
- `type`
- `age`
- `channel`
- `brain`
- `mType`
- `plusR`
- `createdAt`

既有非 PII 分类字段 `key` 也保持不变。合同只授权删除 `name` 和 `ip`；删除 `key` 会扩大到案例分类契约，因此未执行。

## 4. 未修改范围

确认未修改：

- `report-upload.html`
- `/api/extract-fp`
- `/api/generate-report` 主生成逻辑
- `/api/report-store` 逻辑与完整报告结构
- `pushCaseIndex()` 的 Redis 写入机制
- `cases:index` Redis key 与 list 结构
- Phase B attribution layer
- Phase A RPC
- Auth
- BFF Session
- Supabase migration
- Redis 配置
- 历史 KV 数据

## 5. 测试结果

### 5.1 指定回归

- Phase A：93/93 PASS
- Phase B-1：64/64 PASS
- Phase B-2：16/16 PASS
- cases:index 隐私专项：3/3 PASS

### 5.2 全量检查

- 全部 `scripts/test-*.js`：18/18 scripts PASS
- JavaScript `node --check`：51/51 files PASS
- `api/generate-report.js` Node Check：PASS
- 隐私测试 Node Check：PASS

测试过程中出现的 SMS hook provider 日志来自既有隔离失败路径断言；测试退出状态为 0，不构成失败。

### 5.3 Build

- 命令：`vercel build --target=preview`
- 结果：PASS
- Target：Preview
- Deploy：未执行

## 6. 安全检查

- 不输出历史 `cases:index` 内容：PASS
- 不输出或读取 Redis secret：PASS
- 不修改 Sensitive 环境变量：PASS
- 不清理历史 KV：PASS
- 不写入手机号、姓名、IP、token、cookie 或 Session 到报告：PASS

## 7. Claude Review 入口

建议 Claude 复查：

1. `api/generate-report.js` 的 diff 是否仅删除 `pushCaseIndex({...})` 中的 `name` 与 `ip`。
2. 完整 `report:*` 对象仍保持现状，确认本补丁没有扩展到 report-store 数据结构。
3. `scripts/test-v3a-case-index-privacy.js` 是否能阻止未来重新加入 `name` / `ip`。

本 Sprint 到此停止。等待 Claude Review，不进入 Production。
