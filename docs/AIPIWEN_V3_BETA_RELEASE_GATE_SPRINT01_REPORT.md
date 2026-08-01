# AIPIWEN V3.0 Beta Release Gate Sprint 01 Report

生成时间：2026-07-25 00:58 PDT

## 1. Sprint 结论

两个工程门槛已完成本地实现和验证：

1. 正式入口配置：PASS，Release `4e2c0e4` 已包含正确路由，无需重复修改。
2. 指导师错误可观察性：PASS，八个页面已接入并通过隔离闭环测试。

外部 Beta 用户邀请门槛仍未打开。原因是本 Sprint 明确禁止 Production deploy，当前 `aipiwen.cn` 仍运行旧入口；当前已部署 Preview 也尚未包含本 Sprint 的错误追踪改动。

状态定义：

- 工程实现：PASS
- Claude Review 准备：READY
- 线上正式入口：WAITING FOR AUTHORIZED PRODUCTION DEPLOY
- Beta 用户邀请：NOT READY

## 2. 基线与工作区

| 项目 | 结果 |
| --- | --- |
| Branch | `feature/v3a-real-auth-integration` |
| 基线 HEAD | `4e2c0e4dbffa94cc4b809f49559b317d9cb0bb30` |
| Auth / BFF / Session 架构 | 未修改 |
| Supabase migration | 未修改 |
| Production | 未操作 |

Sprint 开始时已经存在四个未跟踪文档：

- `docs/AIPIWEN_V3_BETA_FEEDBACK_TEMPLATE.md`
- `docs/AIPIWEN_V3_BETA_LAUNCH_REPORT.md`
- `docs/AIPIWEN_V3_BETA_RELEASE_REPORT.md`
- `docs/AIPIWEN_V3_BETA_USER_TEST_PLAN.md`

这些文件没有被删除、覆盖或纳入产品代码修改。工作区状态清晰，但不是 clean；Sprint 改动与既有未跟踪文档可区分。

## 3. 修改文件

页面接入：

- `login.html`
- `advisor-register.html`
- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-session.html`
- `ai-interpreter-training.html`
- `ai-interpreter-review.html`
- `ai-interpreter-cases.html`

错误系统与安全：

- `admin-convs.html`
- `js/error-tracker.js`
- `api/admin-convs.js`

测试：

- `scripts/test-v3a-error-observability.js`

文档：

- `docs/AIPIWEN_V3_BETA_OBSERVABILITY_REPORT.md`
- `docs/AIPIWEN_V3_BETA_RELEASE_GATE_SPRINT01_REPORT.md`

没有修改 `homepage.html`、`advisor.html` 或 `vercel.json`，因为基线已经满足目标路由契约。

## 4. 正式入口修复结果

源码现状：

- 首页“指导师工作台”指向 `/advisor.html`；
- `/advisor` 在 `vercel.json` 中重写到 `/login.html`；
- `/advisor.html` 在 `vercel.json` 中重写到 `/login.html`；
- `advisor.html` 自身也包含 meta refresh、JavaScript replace 和手工登录链接三层兜底；
- `/login.html` 路由位于首页 catch-all 之前；
- `/practitioner-demo` 保留。

本地 Vercel 验收：

| 路径 | HTTP | 页面标题 | 结果 |
| --- | ---: | --- | --- |
| `/advisor` | 200 | 登录指导师工作台 · AIPIWEN | PASS |
| `/advisor.html` | 200 | 登录指导师工作台 · AIPIWEN | PASS |
| `/login.html` | 200 | 登录指导师工作台 · AIPIWEN | PASS |
| `/practitioner-demo` | 200 | AIPIWEN 客户体验手册 | PASS，未删除 |

当前线上复核：

- `www.aipiwen.cn/advisor` 和 `/advisor.html` 仍是旧指导师介绍页；
- `www.aipiwen.cn/login.html` 仍回落到 AIPIWEN 首页；
- 原因是 Production 尚未部署包含当前路由配置的版本。

本 Sprint 遵守禁令，没有执行 Production deploy。

## 5. Error Tracker 接入情况

八个指定页面均：

- 加载一次 `/js/error-tracker.js`；
- 使用 `defer`；
- 追踪器早于 `static/v3a-auth.js`；
- 保留原有认证和工作台脚本。

采集能力：

- JavaScript error；
- unhandled rejection；
- 本站 API 非 2xx；
- 本站 API 网络失败；
- pathname；
- 浏览器信息；
- 当前指导师产品模块；
- 错误堆栈和安全上下文。

上报：

`/api/error-log` → `api/admin-convs.js` → Redis `errors:log`

没有新增明文用户身份。

## 6. 安全检查结果

PASS：

- 删除错误日志读取接口的硬编码备用管理口令；
- 读取接口只接受环境变量 `ADMIN_SECRET`；
- 管理口令只通过 `x-admin-secret` header 传输，不进入错误日志 URL；
- 未配置时关闭读取；
- 使用常量时间比较；
- 前端和服务端双层脱敏；
- 不读取或记录密码、OTP、Cookie、Session、Token、Secret；
- 不记录 API request body；
- 不记录 API response body；
- 不记录 URL query；
- 不读取浏览器存储；
- 未提交真实密码或密钥；
- 未修改认证和 Session 架构。

已记录但本 Sprint 不扩大：

- 匿名错误写入接口尚无独立速率限制；
- 没有匿名用户 ID、request ID 和部署版本关联；
- 错误日志仅保留最近 200 条。

未发现需要触发停止条件的严重新安全漏洞。

## 7. 测试结果

### Build

命令：

`vercel build --target=preview`

结果：PASS

说明：仅生成本地 `.vercel/output`，没有部署。

### Test

执行全部 `scripts/test-*.js`，共 13 个测试脚本。

结果：PASS

其中新增错误闭环测试确认：

- 四类前端错误事件进入上报队列；
- 服务端实际处理器生成 `LPUSH errors:log`；
- 敏感测试值在最终事件中不存在；
- 测试后清空前端队列和模拟 Redis pipeline；
- Preview 和 Production 没有测试数据写入。

### Lint

仓库没有配置 ESLint、Prettier 或 `lint` script。本 Sprint 按现有工程能力执行：

- `node --check js/error-tracker.js`
- `node --check api/admin-convs.js`
- `node --check scripts/test-v3a-error-observability.js`
- `git diff --check`
- 页面与安全契约测试

结果：PASS

### Browser / Route

- 本地 `/advisor` 呈现 V3 登录页；
- 登录页追踪器和认证脚本各加载一次；
- fetch 已由现有追踪器包装；
- 页面无 console error 或 warning；
- 工作台在本地 Session 配置无效时恢复 body 并显示友好错误边界，没有白屏。

本地 Session capability 返回 `SESSION_CONFIG_INVALID`，属于本机 Vercel dev 未加载受控 Preview Session 配置；本 Sprint未修改 Auth 或 Session，自动测试和现有线上 Preview 的 Session 验收仍通过。

## 8. 未解决问题

1. `aipiwen.cn` 尚未部署正确入口配置。
2. 当前已部署 Preview 尚未包含本 Sprint 的错误追踪接入。
3. 尚未执行部署后的真实错误写入与管理后台读取烟测。
4. 公开错误写入接口没有独立速率限制。
5. 缺少匿名用户 ID、request ID 和部署版本。
6. 开始前已有四个未跟踪文档，工作区不是 clean。

第 1-3 项需要在 Claude Review 通过后，由明确授权的 Preview / Production 发布流程完成。本 Sprint 不越权执行。

## 9. 是否达到 Beta 用户邀请条件

**否。**

工程代码已经达到 Review 条件，但正式用户邀请至少还需要：

1. Claude Review 通过；
2. 将本 Sprint 版本部署到受控 Preview；
3. 在 Preview 完成一次真实错误上报、后台读取和测试记录清理；
4. 获得 Production deploy 明确授权；
5. Production 部署后验证 `aipiwen.cn` → `/advisor` 或 `/advisor.html` → V3 `login.html`；
6. 确认没有 P0 安全或登录回归。

## 10. 停止状态

本 Sprint 已完成并停止：

- 未进入下一 Sprint；
- 未执行 Production deploy；
- 未修改 Production 数据；
- 未修改数据库结构；
- 未修改 Auth、BFF Session、积分或身份生命周期；
- 未删除 `/practitioner-demo`；
- 未 Git push。

当前等待 Claude Review。
