# AIPIWEN V3.0 Beta Release Report

生成时间：2026-07-25T06:25:08Z

## 1. 发布信息

- 项目：AIPIWEN 指导师工作台 V3.0
- 分支：feature/v3a-real-auth-integration
- Release Commit：4e2c0e4dbffa94cc4b809f49559b317d9cb0bb30
- Vercel Project：guo-yanling-s-projects/aipiwen-ai-understanding
- Deployment ID：dpl_6cCmcHLSTC14kC42vt1X8Hq7LpjL
- Preview URL：https://aipiwen-ai-understanding-99r5kuzk9-guo-yanling-s-projects.vercel.app
- Vercel 状态：Ready
- 本次部署类型：Preview/Beta
- Production deploy：否

## 2. 环境确认

### Vercel Preview

以下变量在 Vercel Preview 环境中存在，值保持 encrypted，未拉取、未输出：

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- V3A_SUPABASE_PROJECT_REF
- V3A_SESSION_ENCRYPTION_KEY
- V3A_ALLOWED_ORIGIN
- V3A_ALLOWED_ORIGINS
- V3A_PHONE_OTP_ENABLED
- V3A_SEND_SMS_HOOK_ENABLED
- V3A_SEND_SMS_HOOK_SECRET
- V3A_ADMIN_REVIEW_WRITES_ENABLED
- KV_URL
- KV_REST_API_URL
- KV_REST_API_TOKEN
- KV_REST_API_READ_ONLY_TOKEN
- REDIS_URL
- ALIYUN_SMS_ACCESS_KEY_ID
- ALIYUN_SMS_ACCESS_KEY_SECRET
- ALIYUN_SMS_SIGN_NAME
- ALIYUN_SMS_TEMPLATE_CODE
- ALIYUN_SMS_TEMPLATE_PARAM_KEY

### Supabase

- Beta/Preview 代码锁定 Project Ref：lmjriqncuopgxwyudfee
- Production Project Ref 被服务端保护逻辑拒绝：tysbwijizgebnrazxpvo
- BFF capability 探针结果：ok=true，phoneOtpEnabled=true
- 本轮未执行 Supabase migration
- 本轮未修改 Supabase Auth 配置
- 本轮未修改 Production Supabase 数据

## 3. 域名与入口

- `/advisor`：已路由到 `/login.html`
- `/advisor.html`：已路由到 `/login.html`
- `/login.html`：可访问
- `/ai-interpreter-workbench.html`：可访问
- 首页顶部“指导师工作台”按钮：指向 `/advisor.html`
- 首页仍存在“查看体验手册”链接指向 `/practitioner-demo`：已记录，本轮未修改

## 4. 部署后烟测

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| Vercel 部署 | PASS | Preview 部署完成，状态 Ready |
| `/advisor` 入口 | PASS | 返回 `login.html` |
| `/login.html` | PASS | 页面 200 |
| `/ai-interpreter-workbench.html` | PASS | 页面 200 |
| BFF capability | PASS | `{"ok":true,"phoneOtpEnabled":true}` |
| 邀请链接页面加载 | PASS | `/login.html?invite=...` 页面 200，邀请码由前端逻辑带入 |

## 5. 账号流程验收状态

以下项目需要真实手机号、短信验证码或真实设备配合完成。本轮未伪造账号、未绕过验证码、未直接写库。

| 场景 | 状态 | 说明 |
| --- | --- | --- |
| 普通指导师新注册 | 待人工验收 | 需要新的测试手机号和短信验证码 |
| 普通指导师自动 active | 待人工验收 | 需完成注册后检查 users/advisor_profiles/wallet/credit_logs/invite_codes |
| 机构身份 pending | 待人工验收 | 需测试手机号选择服务中心或分公司 |
| 老用户密码登录 | 待人工验收 | 不在命令行记录或输出真实密码 |
| 邀请码注册带入 | 待人工验收 | 页面可加载，需真实注册流程验证带入效果 |

## 6. 移动设备验收状态

| 设备/环境 | 状态 | 说明 |
| --- | --- | --- |
| iPhone Safari | 待人工验收 | 需要真实设备操作 |
| 微信浏览器 | 待人工验收 | 需要微信内打开链接并完成输入测试 |
| Android Chrome | 待人工验收 | 需要真实 Android 设备 |

## 7. 已知限制

当前 V3.0 Beta 仍是体验版模块：

- 客户管理：使用体验示例数据
- AI 解读助手：使用体验示例数据
- 解读训练：使用体验示例数据
- 优秀案例沉淀：使用体验示例数据
- 真实 Report OS 深度接入：未开放
- 支付与充值：未开放
- 微信登录：未开放

## 8. 安全检查

- 未输出、未写入、未提交任何真实密钥
- 未拉取 Vercel env 到本地文件
- 未修改 migration
- 未执行数据库结构变更
- 未修改 Auth/BFF/Session 架构
- 未修改积分模型
- 未修改身份生命周期
- 未 Git push
- 未 Production deploy

## 9. Beta 冻结结论

V3.0 Beta Preview 部署已完成，可用于受控测试入口访问。

在邀请真实 Beta 用户前，仍建议完成一次人工闭环验收：

- 新手机号普通指导师注册并自动进入工作台
- 机构身份进入 pending 且不能看到钱包/邀请码
- 已开通老用户密码登录直接进入工作台
- 手机端 Safari、微信浏览器、Android Chrome 各完成一次登录与导航检查
