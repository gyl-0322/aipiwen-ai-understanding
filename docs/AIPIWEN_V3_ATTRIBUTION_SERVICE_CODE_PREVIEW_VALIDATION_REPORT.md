# AIPIWEN V3.0 指导师服务码 Preview 验证报告

## 1. 执行结论

- 状态：**STOPPED / NOT PASS**
- Stop Condition：Preview 运行时无法创建 attribution token
- Production：**未修改**
- 代码现场修复：**未执行**
- 数据库现场修复：**未执行**

Migration 025 与 Preview 部署均成功，但在第一条二维码业务回归中发现数据库函数运行时错误。按照发布纪律，后续服务码与 unguided E2E 未继续执行。

## 2. Release 信息

- Git commit：`f640ec7404045ed1ba126b70bc2ee83c712d6c07`
- Vercel target：Preview
- Deployment ID：`dpl_EBDAvmjM2K7RNX9GSSpZPfwLii91`
- Deployment 状态：READY
- Preview Supabase Project Ref：`lmjriqncuopgxwyudfee`

原工作区中既有 `vercel.json` 暂存/工作区修改未进入本次 commit 或部署。部署来自该 commit 的隔离干净 worktree。

## 3. Migration 025

### 3.1 Preflight

执行前只读核验：

- `attribution_tokens` 存在：PASS
- `service_code` 不存在：PASS
- 原 `v3a_create_attribution_token(integer)` 存在：PASS
- 新 `v3a_validate_attribution_service_code(text)` 不存在：PASS
- 页面项目名与 URL 均指向 Preview：PASS

### 3.2 执行

- 冻结 SQL SHA-256 与编辑器粘贴内容逐字一致：PASS
- 单事务执行：PASS
- SQL Editor 结果：成功，无返回行

### 3.3 独立 Postflight

以下 12 项全部返回 `true`：

1. `service_code` 为 NOT NULL；
2. 创建 RPC 存在；
3. 服务码验证 RPC 存在；
4. authenticated 可执行创建 RPC；
5. anon 不可执行创建 RPC；
6. anon 可执行服务码验证 RPC；
7. service_role 不可执行服务码验证 RPC；
8. anon 不可 SELECT token 表；
9. authenticated 不可 SELECT token 表；
10. service_role 不可 SELECT token 表；
11. 不存在空服务码；
12. 不存在重复服务码。

## 4. Preview 部署

- 精确 commit：PASS
- Preview Build：PASS
- Vercel READY：PASS
- 指导师 Preview 登录：PASS
- BFF Session：PASS
- `GET /api/v3a-attribution?action=customers`：PASS
- 客户页面加载：PASS

## 5. E2E 阻塞

点击“客户归属二维码”后：

- `POST /api/v3a-attribution?action=create`：HTTP 502
- 页面公开提示：客户归属链接暂时无法创建
- Vercel Preview 日志确认失败请求仅发生在 `api/v3a-attribution`
- 没有输出或记录 token、服务码、手机号、Session 或客户数据

后续未执行：

- 二维码上传 E2E：NOT RUN
- 服务码上传 E2E：NOT RUN
- unguided 上传 E2E：NOT RUN

## 6. 根因

在 Preview SQL Editor 中使用事务性、无持久写入的运行时诊断调用创建 RPC，数据库返回：

```text
function gen_random_bytes(integer) does not exist
```

失败位置为 `v3a_create_attribution_token(integer)` 内生成服务码的语句。

Migration 025 创建该 SECURITY DEFINER 函数时冻结了：

```text
search_path = pg_catalog, public
```

但 Preview Supabase 的 `gen_random_bytes(integer)` 实际位于 `extensions` schema。独立只读检查结果：

- `extensions.gen_random_bytes(integer)` 存在：true
- `public.gen_random_bytes(integer)` 存在：false

因此，函数运行时无法解析未限定 schema 的 `gen_random_bytes(5)`。

## 7. 数据影响

- UI 创建请求在 INSERT 前失败，没有创建 attribution token。
- SQL 诊断调用在生成随机服务码时即失败，没有进入 INSERT。
- 未创建客户、报告或 KV 对象。
- 临时隔离图片未上传。
- Production 未连接、未迁移、未部署。

## 8. 最小恢复建议

不得修改已在 Preview 执行的 Migration 025。建议新增：

`supabase/migrations/026_v3a_attribution_service_code_runtime_fix.sql`

修复范围仅限：

1. `CREATE OR REPLACE FUNCTION public.v3a_create_attribution_token(integer)`；
2. 将函数内 `gen_random_bytes(5)` 改为 `extensions.gen_random_bytes(5)`；
3. 保持函数签名、返回 JSON、权限、SECURITY DEFINER、search_path、有效期和使用次数逻辑不变；
4. 增加 `extensions.gen_random_bytes(integer)` 存在性 preflight；
5. 增加事务内 authenticated runtime probe，并回滚探针生成的数据；
6. 增加静态与临时 PostgreSQL 演练测试。

建议顺序：

```text
Codex 准备 Migration 026 + 测试
→ Claude 增量 Review
→ Preview 执行 026
→ 部署包含 026 的精确 commit
→ 恢复二维码、服务码、unguided E2E
```

在取得新的修复授权前，不继续操作 Preview 数据库或部署。

## 9. 本地恢复准备

发现阻塞后，仅在本地完成以下准备，尚未执行在线变更：

- 新增 Migration 026，使用 `extensions.gen_random_bytes(5)`；
- 增加 15 项运行时修复契约测试；
- 在隔离 PostgreSQL 中模拟 Supabase `extensions` schema，执行 025 → 026：PASS；
- 事务内创建 RPC runtime probe：PASS；
- probe 回滚与清理后 token 数量为 0：PASS；
- 统一治理六个工作台页面的重复导航、无处理按钮和后台设计文案；
- 生成工作台按钮与导航治理矩阵。

Migration 026 未在 Preview 执行，修订代码未部署，等待 Claude 增量 Review。
