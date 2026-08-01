# AIPIWEN V3.0 Beta Launch Report

审计时间：2026-07-24 23:58 PDT

## 结论摘要

- Beta Preview 入口：可访问。
- Vercel：`Ready`，目标为 `preview`。
- 本次是否 Production：否。
- `aipiwen.cn` 指导师入口：未接入本次 V3 Beta 登录页。
- ERROR OBSERVABILITY STATUS：`NOT CONNECTED`。
- 是否建议现在邀请 5-10 名测试用户：暂不建议。
- 当前动作：停止施工；未改产品代码、未部署、未推送。

建议先由 1-2 名内部人员完成三类真机烟测和用户 A-D 的真实账号闭环，再邀请第一批 5-10 人。

## 1. Git 基线

| 项目 | 结果 |
| --- | --- |
| Branch | `feature/v3a-real-auth-integration` |
| HEAD | `4e2c0e4dbffa94cc4b809f49559b317d9cb0bb30` |
| Release Commit 一致性 | PASS |
| 工作区干净 | FAIL |

基线检查开始时已经存在一个非本轮创建的未跟踪文件：

`docs/AIPIWEN_V3_BETA_RELEASE_REPORT.md`

本轮没有删除、覆盖或提交该文件。生成本报告和两份测试文档后，工作区会继续包含未跟踪文档，因此不能声明 clean。

## 2. Vercel 部署信息

| 项目 | 结果 |
| --- | --- |
| Project | `guo-yanling-s-projects/aipiwen-ai-understanding` |
| Project ID | `prj_mq8P2fc85qpQ71sCFD5AVIyqB3Nj` |
| Deployment ID | `dpl_6cCmcHLSTC14kC42vt1X8Hq7LpjL` |
| Target | `preview` |
| Status | `READY` |
| 创建时间 | 2026-07-24 23:25:23 PDT |
| 固定部署 URL | `https://aipiwen-ai-understanding-99r5kuzk9-guo-yanling-s-projects.vercel.app` |
| 当前 Preview 别名 | `https://aipiwen-ai-understanding-gyl0322-8747-guo-yanling-s-projects.vercel.app` |
| Production deploy | 否 |

正式 Beta 测试入口：

`https://aipiwen-ai-understanding-99r5kuzk9-guo-yanling-s-projects.vercel.app/login.html`

该部署由本地 CLI 上传，Vercel 部署元数据未提供 Git SHA。为核对 Release Commit，审计比对了 10 个关键前端文件：

- `static/v3a-auth.js`、`static/ai-interpreter.js` 与 HEAD 哈希完全一致；
- 8 个登录、注册和工作台 HTML 在移除 Vercel 自动注入的 `feedback.js` 标签后，与 HEAD 哈希完全一致。

因此可确认关键 Beta 前端内容对应 Release Commit `4e2c0e4`。本轮没有重新部署，也没有调整任何别名。

注意：历史别名 `aipiwen-v3a-phone-preview.vercel.app` 当前仍指向 2026-07-16 的旧 Preview 部署，不应作为本批测试入口。

## 3. 环境信息

只检查了变量名称、类型和作用域，没有读取、拉取或输出任何变量值。

当前 Preview 中存在指导师工作台所需的变量名称：

- Supabase：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`V3A_SUPABASE_PROJECT_REF`
- Session 和 Origin：`V3A_SESSION_ENCRYPTION_KEY`、`V3A_ALLOWED_ORIGIN`、`V3A_ALLOWED_ORIGINS`
- 手机登录：`V3A_PHONE_OTP_ENABLED`、`V3A_SEND_SMS_HOOK_ENABLED`、`V3A_SEND_SMS_HOOK_SECRET`
- 审核写入：`V3A_ADMIN_REVIEW_WRITES_ENABLED`
- 数据存储：`KV_URL`、`KV_REST_API_URL`、`KV_REST_API_TOKEN`、`KV_REST_API_READ_ONLY_TOKEN`、`REDIS_URL`
- 短信服务：阿里云短信相关变量名称

检查结果只能证明变量已配置，不能证明每个值正确。未执行 Supabase migration，未修改 Auth、Session、积分、身份生命周期或 Production 环境。

## 4. 域名入口状态

`aipiwen.cn` 会 308 跳转到 `www.aipiwen.cn`，以下页面均返回 HTTP 200，但内容路由不符合 V3 Beta 目标：

| 入口 | 当前结果 | 目标 | 状态 |
| --- | --- | --- | --- |
| 首页“指导师工作台” | 指向 `/advisor.html` | 进入 V3 登录页 | FAIL |
| `/advisor` | 旧的人工开通指导师介绍页 | `/login.html` | FAIL |
| `/advisor.html` | 旧的人工开通指导师介绍页 | `/login.html` | FAIL |
| `/login.html` | 回落到 AIPIWEN 首页内容 | V3 登录页 | FAIL |
| `/practitioner-demo` | 旧体验手册仍可访问 | 只记录、不删除 | RECORDED |

建议问题清单：

1. 在后续获得 Production 操作授权后，将 `/advisor` 和 `/advisor.html` 明确路由到 V3 `/login.html`。
2. 确保 Production 实际提供 V3 `login.html`，避免被兜底路由到首页。
3. 首页“指导师工作台”按钮在上述路由完成后再指向正式入口。
4. 保留 `/practitioner-demo`，本轮不删除。

这些修改需要 Production 路由或部署操作，已按停止条件停在问题记录阶段。

## 5. ERROR OBSERVABILITY STATUS

**NOT CONNECTED**

### A. 全局 JS 错误捕获

代码库存在 `js/error-tracker.js`，支持：

- `window` error 事件；
- `unhandledrejection`；
- 5 分钟前端去重；
- 通过 `sendBeacon` 或 `fetch` 上报到 `/api/error-log`。

能力本身存在，但指导师工作台页面没有加载该脚本。

### B. API 错误收集

现有追踪器会拦截本站 `/api/` 请求，记录非 2xx 响应和 fetch 失败。

`/api/error-log` 路由已部署，未授权 GET 返回 401，说明路由存在并受保护。没有发送合成错误 POST，避免污染真实错误日志。

### C. 记录字段

现有系统可记录：

- 时间：服务端 `ts`；
- 页面：仅 `location.pathname`，不含完整 URL 和 query；
- 浏览器：`navigator.userAgent`；
- 错误堆栈：存在时记录；
- 上下文：可选。

缺少：

- 指导师用户身份或脱敏用户编号；
- 完整页面 URL；
- BFF 请求级关联 ID。

### D. 指导师工作台接入情况

以下页面只加载 `static/v3a-auth.js` 和工作台脚本，没有加载 `js/error-tracker.js`：

- `login.html`
- `advisor-register.html`
- `ai-interpreter-workbench.html`
- 其他 `ai-interpreter-*.html` 页面

`api/v3a-session.js` 会捕获异常并返回友好 JSON，但没有把异常写入 `/api/error-log`。因此登录、注册、Session 和工作台错误不会自动进入现有错误后台。

Preview HTML 中观察到 Vercel 自动注入的反馈组件，但它是人工页面反馈工具，不等于自动错误采集；非项目成员是否有权限使用也尚未验证。

安全记录：错误日志读取代码含硬编码备用管理口令。具体值未在本报告展示。Preview 当前存在 `ADMIN_SECRET` 环境变量，但仍建议在 `Beta Feedback Loop V0.1` 中轮换并移除备用值。

### Beta Feedback Loop V0.1 后续任务

本轮不开发，仅登记：

1. 将现有错误追踪器接入登录、注册和工作台页面；
2. 为错误事件增加隐私安全的匿名用户编号和请求关联 ID；
3. 确认 Vercel Feedback 对受控外部测试用户的权限；
4. 移除错误日志读取接口的硬编码备用管理口令；
5. 建立错误事件到 Beta 问题编号、修复 Commit 和复测证据的关联。

## 6. 浏览器与设备验收

### 本轮已完成的 Preview 浏览器检查

| 项目 | 结果 |
| --- | --- |
| 登录页加载 | PASS |
| 密码和短信登录界面可见 | PASS |
| 短信与密码面板切换 | PASS |
| 390 × 844 移动视口横向溢出 | PASS，无横向溢出 |
| 412 × 915 移动视口横向溢出 | PASS，无横向溢出 |
| 邀请链接 query 保留在登录页 | PASS |
| 未登录直接打开工作台 | PASS，返回登录页 |
| 页面 console error/warn | 0 |

上述结果来自桌面 Chrome 的移动视口补充检查，不代表真机验收。

### 真实设备状态

| 设备 | 状态 | 原因 |
| --- | --- | --- |
| iPhone Safari | 未验收 | 当前没有实体 iPhone 操作证据 |
| 微信内置浏览器 | 未验收 | 当前没有微信内打开和输入证据 |
| Android Chrome | 未验收 | 当前没有实体 Android 操作证据 |

不得把移动视口检查填写成真机 PASS。

## 7. 测试与反馈文档

- 测试计划：`docs/AIPIWEN_V3_BETA_USER_TEST_PLAN.md`
- 反馈模板：`docs/AIPIWEN_V3_BETA_FEEDBACK_TEMPLATE.md`

测试计划包含 5-10 人的用户 A-D 分组、钱包和积分流水核验、邀请关系核验、真机矩阵、严重度和问题状态闭环。

## 8. 已知限制

- 工作区基线不干净，存在非本轮创建的未跟踪发布报告。
- 用户 A-D 的真实手机号、验证码和数据库结果尚未完成现场验收。
- iPhone Safari、微信浏览器、Android Chrome 尚无真机证据。
- `aipiwen.cn` 的指导师入口尚未接入本次 Beta。
- 指导师工作台未接入现有自动错误记录系统。
- Vercel Feedback 对外部测试用户的可用权限未确认。
- 客户管理、AI 解读助手、训练和案例页面仍包含明确标识的体验示例数据。
- 支付、充值、微信登录、真实 AI 和真实客户系统不在当前 Beta 范围。

## 9. 是否建议邀请测试用户

**当前不建议直接邀请 5-10 名外部测试用户。**

可以先把固定 Preview 入口交给 1-2 名内部真机测试者。满足以下条件后，再邀请第一批 5-10 人：

1. iPhone Safari、微信浏览器、Android Chrome 均有明确结果；
2. 用户 A-D 至少各完成一次真实账号流程；
3. 没有权限、积分、邀请码或隐私类 P0；
4. 明确采用人工反馈模板作为当前主反馈通道；
5. 确认测试者始终使用本报告记录的固定 Preview URL。

## 10. 施工与安全边界

本轮：

- 未执行 Production deploy；
- 未覆盖生产域名；
- 未修改 Supabase migration；
- 未修改 Auth、BFF Session、积分模型或身份生命周期；
- 未开发支付、充值或微信登录；
- 未 Git push；
- 未读取或输出环境变量值；
- 未修改产品代码。

当前停止施工，等待真机测试和真实账号验收。
