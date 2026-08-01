# AIPIWEN V3.0 Sprint 03D-2 Production Domain Route Correction Report

## 1. 结论

状态：**PASS**

Production 主域名入口已恢复为人格理解系统首页；指导师入口仍进入统一登录页。未修改业务页面、Supabase、Auth、Session、SMS、数据库、身份模型或积分逻辑。

## 2. 问题与原因

问题：

- `https://www.aipiwen.cn/` 曾错误显示指导师登录页。

直接原因：

- `vercel.json` 中根路由 `/` 的目标被配置为 `/login.html`。
- Production 部署后，该路由随项目 Production aliases 生效。

修复：

- 仅将根路由 `/` 的目标从 `/login.html` 恢复为 `/homepage.html`。
- `/advisor`、`/advisor.html`、`/login.html` 的现有登录路由保持不变。

## 3. 修改范围

修改文件：

- `vercel.json`

修改数量：

- 1 行路由配置。

未修改：

- `homepage.html`
- `advisor.html`
- `login.html`
- Supabase
- Auth
- Session
- SMS
- 数据库与 migration
- 身份及积分规则

## 4. Production Deployment

- Commit：`0b594e2fafd4a85ce7c435949aaf0a618801017d`
- Deployment ID：`dpl_3BR2zWdbYa8RDNFPaYn7Xu57W4v6`
- Deployment URL：`https://aipiwen-ai-understanding-tuphdnaaa-guo-yanling-s-projects.vercel.app`
- Production Domain：`https://www.aipiwen.cn`
- 部署时间：2026-07-26 19:52:29 PDT
- Vercel 状态：READY

## 5. Route Acceptance

| 路径 | 预期 | 实际 | 状态 |
| --- | --- | --- | --- |
| `/` | 人格理解系统首页 | 标题为 `AIPIWEN · 读懂身边的人`，包含 `天赋底色速测` | PASS |
| `/advisor` | 指导师登录页 | 与 `login.html` 内容哈希一致 | PASS |
| `/advisor.html` | 指导师登录页 | 与 `login.html` 内容哈希一致 | PASS |
| `/login.html` | 指导师登录页 | 标题为 `登录指导师工作台 · AIPIWEN` | PASS |
| `/homepage.html` | 人格理解系统首页 | 与根路径内容哈希一致 | PASS |

所有上述路径均返回 HTTP 200。

## 6. 首页入口与业务完整性

- 首页右上角保留唯一“指导师工作台”入口。
- 现有入口地址保持为 `/advisor.html`，该兼容路由进入统一 `login.html`。
- `/advisor` 同样进入统一 `login.html`。
- 按 Sprint 禁止修改业务页面的要求，未将首页链接源码改写为 `/advisor`。
- Production 根路径、`/homepage.html` 与本次部署的 `homepage.html` SHA-256 完全一致。
- 首页现有业务入口列表与部署源文件一致：
  - `/advisor.html`
  - `/practitioner-demo`
  - `/practitioner.html`
  - `/privacy`
- 上述三个非指导师业务入口均返回 HTTP 200。

## 7. Verification

- `vercel.json` JSON 解析：PASS
- `node scripts/test-advisor-page-contract.js`：PASS
- `node scripts/test-vercel-function-budget.js`：PASS（10/12）
- `git diff --check`：PASS
- `vercel build --prod`：PASS
- Production deploy：PASS
- Production domain aliases：PASS
- Live route smoke test：PASS

## 8. Review Note

本 Sprint 已在路由配置范围内完成。首页按钮源码仍使用历史兼容路径 `/advisor.html`；若 Review 强制要求源码必须精确改为 `/advisor`，将涉及 `homepage.html` 业务页面修改，需另行明确授权。
