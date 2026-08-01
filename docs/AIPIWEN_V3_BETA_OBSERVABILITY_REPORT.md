# AIPIWEN V3.0 Beta Observability Report

生成时间：2026-07-25 00:58 PDT

## 1. 结论

指导师工作台的现有错误系统已经完成代码接入。

接入状态：

- 源码与本地验收：PASS
- 当前已部署 Preview：尚未包含本 Sprint 改动
- Production：未部署

本 Sprint 没有重新设计监控系统，仅复用 `js/error-tracker.js`、`/api/error-log` 和现有 Redis 错误日志链路。

## 2. 已有错误采集能力

前端追踪器支持：

- 全局 JavaScript error 事件；
- 未处理的 Promise rejection；
- 本站 `/api/` 非 2xx 响应；
- 本站 `/api/` fetch 网络失败；
- `navigator.sendBeacon` 优先上报；
- 不支持 `sendBeacon` 时使用 keepalive fetch；
- 同一错误在前端 5 分钟内去重。

服务端支持：

- 接收错误事件；
- 增加服务端时间戳；
- 写入 Redis `errors:log`；
- 最多保留最近 200 条；
- 使用 5 分钟去重键；
- 可选的告警 Webhook；
- 通过管理密钥读取最近错误。

## 3. 接入页面

以下页面均加载一次 `/js/error-tracker.js`，且加载顺序早于 `static/v3a-auth.js`：

1. `login.html`
2. `advisor-register.html`
3. `ai-interpreter-workbench.html`
4. `ai-interpreter-customers.html`
5. `ai-interpreter-session.html`
6. `ai-interpreter-training.html`
7. `ai-interpreter-review.html`
8. `ai-interpreter-cases.html`

本地 Vercel 路由检查确认八个页面均返回追踪器脚本标签。

## 4. 上报路径

错误链路：

页面错误或本站 API 错误

→ `/js/error-tracker.js`

→ `POST /api/error-log`

→ `vercel.json` 路由到 `api/admin-convs.js`

→ 前后端敏感字段脱敏

→ Redis `errors:log`

→ 可选告警 Webhook

管理端读取：

授权请求

→ `GET /api/error-log`

→ 必须存在 `ADMIN_SECRET`

→ 只从 `x-admin-secret` header 读取

→ 常量时间口令比较

→ 最近错误列表

## 5. 错误事件字段

当前记录：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `ts` | 服务端 | 接收时间 |
| `msg` | 前端 | 错误摘要，最长 500 字符 |
| `stack` | 前端 | 存在时记录，最长 800 字符 |
| `page` | 前端 | 仅 pathname，不记录 query |
| `module` | 前端 | 从页面安全 dataset 派生，例如 `advisor-login`、`advisor-session` |
| `context` | 前端 | 文件位置、HTTP 状态或网络错误摘要 |
| `ua` | 浏览器 | 浏览器 User-Agent，最长 200 字符 |
| `hash` | 服务端 | 用于错误去重 |

没有记录明文用户身份。

## 6. 敏感信息保护

本 Sprint 增加前端和服务端双层脱敏：

- password / 密码
- OTP / 验证码
- token
- secret
- cookie
- session
- authorization
- 中国大陆手机号
- 六位数字验证码

本站 API 错误不再读取或保存响应正文，只记录去掉 query 的 API 路径和 HTTP 状态。

错误追踪器不读取：

- 表单输入值；
- 请求 body；
- `document.cookie`；
- `localStorage`；
- `sessionStorage`；
- HttpOnly Session。

专用测试使用假值覆盖上述敏感类型，并确认前端事件和服务端最终写入事件均不包含原始测试值。

## 7. 错误后台安全

发现并修复：

- 删除错误日志读取接口的硬编码备用管理口令；
- 未配置 `ADMIN_SECRET` 时以 503 关闭读取能力；
- 错误口令返回 401；
- 不再接受 URL query 中的管理口令，避免进入浏览器历史或访问日志；
- 正确配置时使用 `crypto.timingSafeEqual` 比较；
- 本 Sprint 未新增或提交任何真实口令。

最小权限边界：

- 错误写入保持匿名，仅接受受限字段；
- 错误读取继续要求管理密钥；
- 普通指导师页面无法读取错误列表；
- 管理密钥值不进入前端、报告或测试输出。

## 8. 验证方式与测试数据清理

新增测试：

`node scripts/test-v3a-error-observability.js`

测试覆盖：

- 八页接入契约；
- JavaScript error 上报；
- Promise rejection 上报；
- API 503 上报；
- API 网络失败上报；
- pathname、浏览器和产品模块字段；
- 敏感数据前后端脱敏；
- 实际错误处理器写入 `LPUSH errors:log` pipeline；
- 未配置口令、错误口令和正确测试口令；
- 测试完成后清空前端事件数组和模拟 Redis pipeline。

测试使用隔离的内存与模拟 Redis 传输，没有向 Preview 或 Production 写入测试错误。

## 9. 当前限制

- 没有匿名用户编号，无法把同一测试者的多个错误自动关联；
- 没有 request ID，前端错误与 BFF 请求不能一一关联；
- 没有部署 Commit 或 Deployment ID 字段；
- 只记录 pathname，不记录完整 URL，这是有意的隐私保护；
- API 写入接口没有独立的速率限制，仍存在日志噪声或恶意刷写风险；
- 错误列表为最近 200 条，不是长期审计存储；
- 告警 Webhook 是否配置不在本 Sprint 审计范围；
- console warning、业务提示和未抛出的逻辑错误不会自动采集；
- 非项目成员是否能使用 Vercel Feedback 工具尚未验证。

## 10. 后续建议

只记录，不在本 Sprint 开发：

1. 增加隐私安全的匿名 Beta 用户编号；
2. 增加 request ID；
3. 记录部署 Commit 或 Deployment ID；
4. 为公开错误写入接口增加速率限制和滥用保护；
5. 建立错误 hash、Beta 问题编号、修复 Commit 和复测证据的关联；
6. 明确错误数据保留期限和访问审计规则。
