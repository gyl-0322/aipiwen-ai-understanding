# AIPIWEN V3.0 Beta Hardening Report

日期：2026-07-24  
分支：`feature/v3a-real-auth-integration`  
结论：**达到 Beta 内测代码门槛，开放真实用户前仍需完成原生设备烟测。**

## 0. Baseline Report

- 开始时分支：`feature/v3a-real-auth-integration`
- 开始时 HEAD：`5b0365591fa2b7bb7a393657290e362699d8002e`（`Show credit ledger in workbench`）
- 最近认证相关提交：`46a9ae5ed022a1c7059f19b2aa761ee3e6210c65`（`fix v3a preview phone auth origin`，2026-07-19）
- 开始时工作区：干净，无未提交危险修改
- 本地 worktree 的 `.git` 指针曾指向已失效的临时挂载路径；已恢复到现存主仓库元数据。该修复不属于 Git 跟踪内容，不改变项目代码或提交历史。
- 分支相对 `origin/main`：开始时 ahead 49

## 1. 修改文件列表

产品页面：

- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-session.html`
- `ai-interpreter-training.html`
- `ai-interpreter-review.html`
- `ai-interpreter-cases.html`

前端资源：

- `static/ai-interpreter.css`
- `static/ai-interpreter.js`
- `static/v3a-auth.js`

测试：

- `scripts/test-ai-interpreter-pages.js`
- `scripts/test-v3a-phone-auth.js`

文档：

- `docs/AIPIWEN_V3_BETA_HARDENING_REPORT.md`

未修改：

- `supabase/migrations/001-018`
- `api/`
- `server/`
- Supabase Auth、BFF Session、AES-GCM、CSRF、RLS、身份模型及审核生命周期

## 2. P0 修复列表

### 2.1 品牌与角色语言

- 六个指导师工作台页面统一为 `AIPIWEN指导师工作台` / `AI成长理解工作台`。
- 清除用户可见的 `V1.1`、`V2+`、`Dry-run`、`Demo`、`Prototype` 等研发历史文案。
- 用户可见的“解读师”按语义改为“指导师”；行为仍使用“解读”。
- 清除用户可见的 Emma 人名角色：
  - `Emma 视角` → `平台审核视角`
  - `Emma精选` → `总部精选`
  - `Emma评注` → `平台评注`
  - 人工积分动作 → `平台人工加分` / `平台人工扣分`

### 2.2 Mock 边界

以下页面顶部均显示统一说明：

> 体验示例  
> 当前展示为功能演示数据，正式业务数据将在后续版本接入。

- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-session.html`
- `ai-interpreter-training.html`
- `ai-interpreter-review.html`
- `ai-interpreter-cases.html`

同时删除客户页隐藏的 `V2 Dry-run` 旧面板，并把页面内的模拟状态改为“体验示例”语义。

### 2.3 积分单一真实来源

- 从 `static/ai-interpreter.js` 删除：
  - `localStorage` 积分余额
  - `getCreditBalance`
  - `setCreditBalance`
  - Mock 积分流水
  - 假扣 50 积分
- 工作台余额继续只读取 Session BFF 返回的 `wallet.balance`。
- 积分明细继续只读取 Session BFF 返回的 `creditLogs`。
- “生成完整 AI 解读方案”尚未接真实扣费，现只提示：

> 积分消耗功能将在后续版本开放。

- 操作不会修改真实余额或流水。
- 修复真实余额为 `0` 时被误显示为空值/“待同步”的问题。

### 2.4 邀请码闭环

- `/login.html?invite=ABC123` 中的邀请码通过安全 URL 状态透传到申请页。
- `advisor-register.html` 自动填入邀请码字段。
- 提交申请时邀请码进入 `submit_application` BFF payload，并继续由既有 RPC 处理。
- 透传值只允许 3-40 位大写字母、数字和连字符。
- 实际数据库可接受的邀请码仍以数据库现有规则为准：`ADV|AGT|CTR` 前缀加 8 位平台字符；未修改数据库规则。
- `ai-interpreter-session.html` 删除 `/r/ZHANGWEI01`，改为读取真实 Session 中的邀请码。

## 3. P1 修复列表

### 3.1 积分类型一致性

有效数据库约束来自 `004_v3a_phase_c1a_core_tables.sql`。本 Sprint 未修改 migration。

| 类型 | 前端 | 数据库 | V3.0 状态 |
| --- | --- | --- | --- |
| `REGISTER_BONUS` | 支持 | 支持 | 支持 |
| `MANUAL_GRANT` | 支持 | 支持 | 支持 |
| `MANUAL_DEDUCT` | 支持 | 支持 | 支持 |

已从前端标签表删除尚未被当前有效数据库约束支持的邀请奖励、充值、服务扣费及旧 Emma 类型。V3.0 当前不新增支付或充值体系。

### 3.2 错误白屏

- `initWorkbench()` 的异常路径会恢复 `document.body.hidden = false`。
- 异常时隐藏工作台业务壳层，显示独立、友好的错误边界。
- 401 仍安全返回登录页；服务暂时不可用时停留在错误边界，可重新加载。

### 3.3 页面体验

- 删除客户页无意义的隐藏旧 DOM。
- AI 解读助手显示真实邀请码。
- 增加标准 `[hidden]` 样式规则，修复注册页“设置密码”和“申请资料”两个步骤同时显示的问题。

### 3.4 外部依赖

- 工作台二维码仍使用 BootCDN 的 `qrcodejs 1.0.0`。
- 该库只负责二维码 UI 生成，不接触 Auth、Session 或数据库写入。
- 本 Sprint 未为此引入本地化重构；风险见“未解决问题”。

## 4. 未解决问题

1. **原生设备烟测未执行**：本次使用 Chromium 响应式视口模拟 375、390、412px；未在真实 iPhone Safari、微信内置浏览器和 Android Chrome 设备上运行。
2. **BootCDN 供应链/可用性风险**：CDN 不可用时二维码会降级为复制链接提示。Beta 开放前可另立小任务评估本地化，当前不阻塞代码级内测。
3. **真实业务模块仍未接入**：客户、训练、复核、案例及 AI 话术仍为明确标识的体验示例；未开发真实客户系统、真实 AI、支付或充值。
4. **未做 Production/部署验收**：遵守 Sprint 禁止项，未操作 Production、未部署、未 push。

## 5. Mock 边界说明

真实数据：

- 登录与 Session
- 当前身份、状态、城市
- `credit_wallets` 对应的余额
- `credit_logs` 对应的积分流水
- 平台生成的邀请码

体验示例数据：

- 客户列表与客户详情
- 今日概览和最近解读记录
- 三栏解读案例、预设 AI 话术
- 训练评分
- 复核队列
- 优秀案例管道

所有体验示例页均有顶部说明，不再使用研发版本号或内部人员名作为产品角色。

## 6. 用户流程测试结果

| 用户 | 流程 | 结果 | 证据范围 |
| --- | --- | --- | --- |
| A 普通指导师 | 手机验证 → 申请 → 自动 Active → 500 积分 → 邀请码 → 工作台 | PASS | BFF 契约测试、自动开通 migration 契约、工作台浏览器渲染 |
| B 机构身份 | 服务中心/分公司 → pending → 平台准入审核 | PASS | 机构 pending 路由、管理员审核 RPC/Session 契约、移动视口 pending 页 |
| C 老用户 | 手机号+密码 → Active → 工作台 | PASS | 密码登录与 Active 路由契约 |
| D 邀请用户 | `?invite=ABC123` → 登录 → 注册自动填入 → 提交 payload | PASS | 新增邀请码透传回归测试、注册页浏览器渲染 |

说明：以上是本地代码、BFF/RPC 契约和模拟 Session 的验收，不是 Production 真实账号操作。

## 7. 移动端验收

检查页面：登录、注册、工作台、机构待审核、AI 解读助手。  
检查项目：身份、积分、邀请码、导航、AI 助手、错误边界。

| 视口 | 结果 |
| --- | --- |
| 390 × 844（iPhone 尺寸） | PASS，无横向溢出 |
| 375 × 812（微信常见尺寸） | PASS，无横向溢出 |
| 412 × 915（Android 常见尺寸） | PASS，无横向溢出 |

浏览器控制台：0 条 error/warn。  
限制：均为 Chromium 视口模拟，不等同于原生 Safari/微信 UA 验收。

## 8. 自动化验收

执行：

```bash
for test_file in scripts/test-*.js; do node "$test_file" || exit 1; done
node -c static/v3a-auth.js
node -c static/ai-interpreter.js
git diff --check
```

结果：

- 全部 `scripts/test-*.js` 通过
- 指导师页面 Hardening 契约通过
- 邀请码登录→注册→提交 payload 契约通过
- 0 积分真实显示回归通过
- HttpOnly Session、AES-GCM、CSRF、OTP 限流、管理员审核契约通过
- Vercel Function Budget：10/12，通过
- JS 语法检查通过
- `git diff --check` 通过

## 9. Beta 内测结论

**代码级结论：PASS。**

已满足本 Sprint 的品牌清洁、Mock 边界、积分单一来源、邀请码透传、积分类型一致性、非白屏错误处理和响应式布局要求；未触碰数据库结构、身份生命周期、机构审核规则或 Session 架构。

**真实用户开放条件：**

1. 在真实 iPhone Safari、微信内置浏览器、Android Chrome 各完成一次登录/注册/工作台烟测。
2. 使用一枚平台真实签发的邀请码验证数据库接受与邀请关系落库。
3. 保持本次禁止项不变，不把体验示例误当作真实业务模块。
