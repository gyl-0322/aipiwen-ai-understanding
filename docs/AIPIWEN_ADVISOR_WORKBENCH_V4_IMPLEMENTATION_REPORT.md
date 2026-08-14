# AIPIWEN 指导师工作台 V4 实施报告

日期：2026-08-08  
状态：IMPLEMENTED / LOCAL QUALITY GATE PASS / NOT DEPLOYED

## 1. 实施范围

本次按照《AIPIWEN Advisor Workbench V4.0 架构与界面设计》和 Codex 执行指令完成代码实施，未执行 Preview/Production Migration，未执行部署。

已完成：

- 9 项侧边栏导航统一升级；
- 工作台“今日辅导线索”；
- 我的客户服务阶段、候选案例标记、客户 360、开始解读、存入案例库入口；
- 客户 360 档案及 4 个档案分类；
- AI 辅导助手四段式建议、复制话术、辅导记录和可选成长记录；
- 成长记录表单、筛选、时间线和分页；
- 特殊案例库的草稿、提交、删除、共享展示及审核接口；
- 16 个 URL 契约通过现有两个 BFF 聚合承载；
- Migration 033、迁移演练和 V4 契约测试。

## 2. 基线适配决策

### 2.1 数据库基线

规格文档假定 `growth_records`、`coaching_sessions`、`service_stage_log`、`case_card` 已存在，但当前仓库迁移基线中不存在这些表。为避免对不存在对象执行 `ALTER TABLE`，新增：

- `supabase/migrations/033_v3a_advisor_workbench_v4_foundation.sql`
- `supabase/tests/033_v3a_advisor_workbench_v4_foundation_test.sql`

Migration 033 只创建 V4 新对象，不修改用户、客户、报告、Auth、Session 或既有报告引擎数据。

### 2.2 Vercel Function Budget

当前预算已经是 12/12。因此没有新增物理 Serverless Function：

- 客户中心、成长、辅导记录、案例接口聚合到 `api/v3a-attribution.js`；
- AI 辅导建议聚合到 `api/v3a-report-import.js`；
- `vercel.json` 只增加 URL 路由，Functions 数量保持 12/12。

### 2.3 AI 解读入口

侧边栏“AI解读助手”继续进入真实客户选择页：

`ai-interpreter-customers.html?intent=interpret#v3a-real-customers`

没有改回无客户/无报告上下文的空白解读页。

## 3. 安全边界

- 所有写操作继续要求 V3A HttpOnly Session、SameOrigin、JSON 和 CSRF；
- 浏览器请求不提交 `advisor_id`，指导师身份由 Session 推导；
- 新表只向 `authenticated` 授予 SELECT，不授予直接 INSERT/UPDATE/DELETE；
- 写入统一通过 `SECURITY DEFINER` RPC，并再次用 `auth.uid()` 校验归属；
- `anon`、`service_role` 不获得新 RPC EXECUTE；
- 指导师只能读取自己的成长/辅导记录和自己的或总部共享的案例；
- 团队共享案例响应不返回其他指导师的客户 ID 或客户姓名；
- AI 辅导 Prompt 不记录、不输出客户姓名、手机号、密钥、Token、Cookie 或 Session；
- 未修改 Auth、Session、SMS、积分、支付、订阅、Report Engine 和 AI 解读 16 板块逻辑。

## 4. 主要文件

新增：

- `client-360.html`
- `ai-coaching-assistant.html`
- `growth-record.html`
- `static/v3a-client-360.js`
- `static/v3a-coaching.js`
- `static/v3a-growth-record.js`
- `static/v3a-case-cards.js`
- `static/v3a-customers-stage.js`
- `static/v3a-workbench-clues.js`
- `server/v3a-workbench-v4.js`
- `supabase/migrations/033_v3a_advisor_workbench_v4_foundation.sql`
- `supabase/tests/033_v3a_advisor_workbench_v4_foundation_test.sql`
- `scripts/test-v3a-advisor-workbench-v4.js`

升级：

- 6 个原工作台 HTML 页面的导航；
- `ai-interpreter-workbench.html`
- `ai-interpreter-customers.html`
- `ai-interpreter-cases.html`
- `static/v3a-attribution.js`
- `static/ai-interpreter.css`
- `api/v3a-attribution.js`
- `api/v3a-report-import.js`
- `vercel.json`
- 4 个受 V4 契约影响的旧测试脚本。

## 5. 验证结果

- Node Check：PASS；
- V4 契约测试：205 assertions PASS；
- 迁移 033：一次性本地 PostgreSQL 完整演练 PASS；
- 全量 Node 测试：27/27 脚本 PASS（不包含需要人工凭据的管理员手机号绑定工具）；
- 工作台按钮清单：74/74 已登记处理器 PASS；
- Vercel Function Budget：12/12 PASS；
- Vercel Build：PASS，target=preview，仅生成本地预构建产物；
- `git diff --check`：PASS；
- Secret/隐私静态检查：未发现新增敏感值或客户信息日志。

## 6. 未执行事项

- 未执行 Migration 033；
- 未连接或写入 Preview/Production 数据库；
- 未执行 Preview/Production Deploy；
- 未使用真实客户数据；
- 未创建定时任务或自动夜间扫描；
- 未新增支付、订阅、积分扣减、组织权限或家庭端同步。

## 7. 进入下一阶段前的门槛

建议顺序：

1. Claude 对本次代码和 Migration 033 做只读审核；
2. 审核通过后单独授权 Preview Migration 033；
3. 完成表、RPC、RLS、跨指导师隔离 Postflight；
4. 再单独授权 Preview Deploy；
5. 使用纯合成客户完成 9 项导航、客户 360、AI 辅导、成长记录和案例库 E2E；
6. 清理合成数据后再讨论 Production。

## 8. Claude Review P1 修复补充

Claude 只读审核结论为 APPROVED，并提出两个 Preview 前 P1。现已关闭：

- 辅导线索领域标签增加中文映射；未知值不直接显示给用户；
- AI 辅导左栏增加 TRC、ATD、性格类型、学习通道摘要，全部从真实 `latestReport.engineResult` 读取，资料缺失时显示 `--`。

修复后：V4 契约测试提升为 213 assertions PASS；全量 27/27 测试和 Vercel Preview Build 再次 PASS。

当前结论：**CLAUDE REVIEW P1 CLOSED；READY FOR INCREMENTAL REVIEW / PREVIEW MIGRATION AUTHORIZATION；不具备直接 Production 上线授权。**
