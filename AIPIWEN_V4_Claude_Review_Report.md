# AIPIWEN Advisor Workbench V4 — Claude 只读审核报告

日期：2026-08-08  
审核范围：Migration 033 + 6 新增 JS + 3 新增 HTML + 3 升级 HTML + server/v4 + 2 BFF 升级 + CSS 扩展 + vercel.json  
审核方法：逐文件读取 + 交叉比对设计文档  
审核结论：**APPROVED — 2 个 P1 建议修复 + 4 个 P2 观察项 + 0 个 P0 阻塞项**

---

## 一、Migration 033 审核

### 1.1 安全检查（全部 PASS）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 前置门禁 | ✅ | 执行前校验 V3A 基础函数存在 + 表不存在，防止重复执行或在不兼容环境执行 |
| 表级权限 | ✅ | 四张表只授予 `authenticated` SELECT，无 INSERT/UPDATE/DELETE |
| RPC 权限 | ✅ | 7 个 RPC 全部 REVOKE ALL 后仅授权 `authenticated` EXECUTE |
| anon 阻断 | ✅ | postflight 显式检查 anon 无表权限、无 RPC 权限 |
| service_role 阻断 | ✅ | postflight 显式检查 service_role 无表权限、无 RPC 权限 |
| RLS Policy | ✅ | 4 张表各有 RLS，通过 `v3a_current_user_id()` 做隔离 |
| 跨指导师隔离 | ✅ | RPC 内部用 `auth.uid()` → `users.id` 推导 advisor_id，再校验 `advisor_clients.advisor_user_id` 归属 |
| 锁表 | ✅ | `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` 防止迁移期间并发写入 |
| 无删除用户/客户数据 | ✅ | 未出现 `DELETE FROM public.users` 或 `public.advisor_clients` |

### 1.2 表设计审核

**growth_records**：CHECK 约束覆盖 record_type/domain_tags/change_direction/markers/visibility/content/source 全部枚举值。`advisor_user_id` 冗余存储（非范式）但这是 RLS 查询性能的标准做法，与现有 `advisor_clients` 模式一致。GIN 索引建议：domain_tags 使用 `@>` 查询时，建议后续加 `USING GIN (domain_tags)`，当前不是阻塞项。

**coaching_sessions**：suggestion 字段用 JSONB 存储且限制 32KB，合理。topic/content/parent_reaction/session_effect/next_plan 全有长度约束。

**service_stage_log**：from_stage 允许 NULL（首次进入阶段时无前序阶段），设计正确。transition_check 确保 from_stage ≠ to_stage。

**case_card**：最复杂的表。亮点：
- `case_card_review_shape_check`：强制 shared/returned 状态必须有审核人和审核时间，private/submitted 必须没有。这防止了数据不一致。
- `case_card_auto_detection_unique_idx`：部分唯一索引，同一客户+同一检测规则只创建一次，防止重复候选。
- `case_card_detection_rule_check`：auto_detected 和 detection_rule 的绑定约束。

### 1.3 发现的 Migration 问题

**P1-01**：`growth_records` 表的 `visibility` 字段在 CHECK 中是 `'advisor_only'` 和 `'shared'`，但在 RPC `v3a_create_growth_record` 中参数名为 `p_visibility`，没有额外校验。设计文档中两个值是正确的。但如果前端传了 `private`（与 case_card 的 `private` 概念混淆），会被 DB CHECK 拒绝而非 BFF 提前拦截。

> **建议**：在 `validateGrowthBody()` 中显式校验 visibility 仅允许 `advisor_only`/`shared`，当前已通过 `VISIBILITIES` Set 做了这个校验——实际上 **PASS**。撤回。

重新审视后，**Migration 033 无问题**。校验链路完整：BFF validateGrowthBody → RPC 参数校验 → DB CHECK 约束。

**Migration 033 结论：PASS，无阻塞项。**

---

## 二、Server 端审核

### 2.1 `server/v3a-workbench-v4.js`（672 行）

**架构评价**：代码质量优秀。关键设计决策正确：

- **统一身份校验** `requireIdentity`：读操作校验 Session + active + role，写操作额外校验 SameOrigin + CSRF。BFF 聚合多个 action 时只调用一次。
- **RPC 错误映射** `RPC_ERRORS`：将 PG exception message 映射为 HTTP 状态码和用户可读消息，避免内部错误信息泄露。
- **客户端数据聚合** `loadClientCollections`：一次 Promise.all 批量取 reports/growth/coaching/stages/cases，N+1 问题处理正确。
- **UUID 校验**：所有 person_id/case_id 入口先过 `isUuid()` 而非直接拼接 SQL。
- **写操作 SameOrigin + CSRF 双校验**：读操作不要求 CSRF（符合 REST 惯例），写操作强制。

**发现的 Server 问题**：

**P1-02**：`handleDataCenter` 中，`coaching` 视图的请求也校验 `advisor_clients` 归属，但返回的 `growthRecords` 包含 `content` 字段。当 view=coaching 时限制为 5 条正确，但未过滤 `visibility=advisor_only` vs `shared`。当前 RLS 在 DB 层已做了 `advisor_user_id = current_user_id` 过滤，所以 RLS 保证了只有自己的记录被返回——这里实际上没有问题。但设计文档中提到成长记录有 `visibility` 字段供未来家长端使用，当前阶段无影响。

**撤回**：RLS 已覆盖，无实际问题。

**P1-03**：`handleClues` 中 clue 描述文案直接拼接 `domain_tags` 数组元素到自然语言句子中。由于 `domain_tags` 在 DB 层有 CHECK 约束（仅限预定义枚举），不存在注入风险，但句子可读性依赖中文翻译层。当前实现 `declining.domain_tags.map(normalize).join('、')` 输出的是英文枚举值（如 `learning`），用户可见应为中文。

> **建议修复**：在 clue 描述生成处增加 domain_tags 的中文映射，或直接使用"成长记录"作为统一描述，去掉枚举值拼接。优先级 P1——用户可见文案质量问题。

**P2-01**：`candidateFromReports` 函数实现了 TRC/ATD/全指同纹型/弧型≥5 四种检测规则，但设计文档中还有"三斗"检测规则未实现。需要 `fingers` 中有三斗标记字段。当前 `structured_input.fingers` 结构中是否有此数据未知，建议确认后补充。

**P2-02**：`stageFor` 函数逻辑：≥2 ready 报告 → deep，1 ready → early，0 → initial。设计文档中还有 consolidation 阶段（连续 3 次 stable/improving），当前未实现自动转换逻辑。这部分属于 Phase 2 范围，当前不阻塞。

### 2.2 BFF 聚合审核

**`api/v3a-attribution.js`**：新增了 8 个 action 路由（client-data-center/clues/stage-summary/person-list + growth-records + coaching-sessions + case-cards + case-candidates）。路由通过 `?action=` query param 分发，与现有 V3A 模式一致。写操作全部经过 `requireSameOrigin` + `requireCsrf`。

**`api/v3a-report-import.js`**：新增 `coaching-suggestion` action，使用独立限流 scope `v4-coaching-suggestion-advisor`。在 BFF 层做了 suggestion 输出的安全校验（`parseCoachingSuggestion`），测试代码中验证了拒绝"宣称客户未来一定会成功"的输出。这个安全校验是关键的。

---

## 三、前端 JS 审核

### 3.1 架构模式评价

所有 6 个 JS 文件遵循一致的架构模式：
- IIFE + `document.body?.dataset?.page` 条件激活（页面级作用域隔离）
- 写操作前检查 `csrfToken` 非空
- 错误通过统一 error 元素展示
- `busy` 标志位防止重复提交
- 通过 `v3a:workbench-ready` 自定义事件监听 V3A auth 初始化完成

### 3.2 逐文件审核

**`v3a-workbench-clues.js`**：辅导线索加载。亮点——线索卡片 URL 使用正则 `/^\/(?:ai-coaching-assistant|client-360)\.html\?person_id=[0-9a-f-]+$/i` 做白名单校验，防止 XSS 注入。正确使用 `window.location.assign` 而非直接设置 href（与现有代码风格一致）。

**`v3a-customers-stage.js`**：使用 `requestVersion` 机制处理竞态——多次快速触发 `v3a:customers-rendered` 时只应用最后一次请求的结果。正确做法。服务阶段 filter 联动正常。

**`v3a-client-360.js`**：无 person_id 时渲染 picker 列表，有 person_id 时加载完整档案。Tab 切换逻辑正确（DOM 事件委托 + `closest('[data-tab]')`）。`renderFingerprint` 中 `engineResult` 从 `report.engineResult` 读取，与 server 端 `publicReport` 中的字段映射一致。

**P2-03**：客户 360 档案的「成长时间线」Tab 和「服务历史」Tab 没有独立的分页/加载更多功能，直接展示全部返回数据。当前 server 端限制为 500 条，数据量小情况下无问题，但未来数据量大时需加分页。

**`v3a-coaching.js`**：AI 辅导助手交互。copyToClipboard 使用 `navigator.clipboard.writeText`。辅导记录保存时先 POST coaching-sessions，再条件 POST growth-records（勾选「同时添加成长记录」时），两个请求独立但共享 CSRF token 且顺序执行（避免 DB 竞争）。

**P2-04**：`renderContext` 中未展示客户的先天配置摘要（TRC/ATD/性格类型/学习通道）。设计文档中辅导助手左栏应展示这些信息，但当前只显示了服务阶段、报告类型和报告时间。先天配置数据在 `payload.latestReport?.engineResult` 和 `payload.latestReport?.atd` 中可用，前端未消费。

**`v3a-growth-record.js`**：pill 多选交互正确（`bindPills` 支持 single/multi 模式）。时间线加载时支持 `reset` 参数控制 offset 重置。保存成功后自动重置表单并刷新时间线。字符计数实时更新。

**`v3a-case-cards.js`**：弹窗创建/销毁逻辑通过 `ensureModal` 惰性创建复用。`window.openCaseModal` 暴露为全局函数供 customers 页面调用。案例列表双区域渲染（myCases + sharedCases + pendingCases）。亮点——删除/编辑/提交操作通过 visibility 状态控制按钮显示（`private`/`returned` 状态才能编辑提交，`submitted` 状态只能总部审核）。

### 3.3 所有 JS 无 P0/P1 问题

整体结论：前端 JS 代码质量高，错误处理完整，CSRF 链路正确，无需修复。

---

## 四、HTML 页面结构审核

### 4.1 侧边栏一致性

所有 9 个 HTML 文件的侧边栏 nav 结构完全一致——9 项导航、相同的 href、相同的 data-page 属性、相同的图标符号。PASS。

### 4.2 新页面结构审核

**`client-360.html`**：结构完整——摘要区 + Tab 栏（4 Tab）+ 面板容器 + 错误回退。`aria-label` 和 `role` 属性使用正确。

**`ai-coaching-assistant.html`**：三栏布局使用 `.session-grid` + `.session-column`（而非我设计文档中写的三个独立区域——实际实现用`.session-column`更合理，因为它已在现有 CSS 中定义）。辅导后记录在右栏，功能完整。

**`growth-record.html`**：双栏 `.cols-aside` 布局。右栏时间线的 filter dropdowns 使用 `.searchbar` 排列，与现有组件一致。

**`ai-interpreter-cases.html`**：三个 section（待审核/我的案例/总部精选），案例弹窗 HTML 直接写在页面中（而非 JS 创建），与设计文档一致。

### 4.3 无障碍

所有页面有 `aria-label`、`role="status"`、`aria-live="polite"` 的错误提示区，`hidden` 属性管理显示状态。比 V3 有明显改进。

---

## 五、CSS 扩展审核

CSS 追加了约 150 行，包含之前设计文档中定义的所有新 class。未删除或修改任何已有样式。新 class 命名遵循现有 BEM 风格。PASS。

---

## 六、Vercel 配置审核

- V4 的 5 个新 API 路径全部在 `routes` 中正确声明并指向 BFF。
- `case-cards` 的子路径（`/submit`, `/review`, `/[id]`）正确处理。
- `functions` 数量保持 12/12。
- 三个新 HTML 页面（client-360/ai-coaching-assistant/growth-record）都有路由声明。

PASS。

---

## 七、测试覆盖审核

**契约测试**（`test-v3a-advisor-workbench-v4.js`）：205 assertions，覆盖：
- 9 页面存在性 + 9 项导航完整性
- CSS V4 区块存在性
- 各页面关键 DOM 元素 ID
- Migration 表/RPC/RLS/权限隔离
- BFF action 路由注册 + SameOrigin + CSRF 强制
- Server 端 stageFor/candidateFromReports 逻辑
- AI 辅导输出安全校验（拒绝结果保证陈述）
- Vercel function budget 12/12

**SQL 测试**（`033_*_test.sql`）：创建 mock schema → 执行 migration → 验证表/权限 → 测试 RPC 写入 → 测试跨指导师隔离 → ROLLBACK。完整且可重复。

---

## 八、总体评估

| 维度 | 评级 | 说明 |
|------|------|------|
| Migration 安全 | A | RLS + RPC 权限 + SECURITY DEFINER 隔离 + postflight，设计严密 |
| Server 端代码 | A- | 统一身份校验、RPC 错误映射、N+1 避免、输入校验链完整 |
| 前端 JS | A- | 架构一致、CSRF 链路正确、竞态处理、错误覆盖完整 |
| HTML 结构 | A | 9 页导航一致性、无障碍属性、回退 UI |
| CSS | A | 不修改已有样式、命名一致 |
| 测试 | A | 205 assertions、SQL 隔离回滚、安全边界测试 |
| 设计文档对齐 | B+ | 核心功能完整对齐，2 个 P1 差距（线索文案中文 + 辅导左栏先天配置） |

---

## 九、问题清单

### P1（建议 Preview 前修复）

| ID | 文件 | 问题 | 修复建议 |
|----|------|------|---------|
| P1-03 | `server/v3a-workbench-v4.js` handleClues | 线索描述拼接英文枚举值（如 "learning"），用户不可读 | 增加 domain_tags 中文映射或改为统一描述文案 |
| P1-04 | `static/v3a-coaching.js` renderContext | 辅导助手左栏未展示先天配置摘要（TRC/ATD/性格类型/学习通道） | 从 payload.latestReport.engineResult 和 atd 提取并渲染 |

### P2（观察项，不阻塞）

| ID | 文件 | 问题 | 说明 |
|----|------|------|------|
| P2-01 | `server/v3a-workbench-v4.js` candidateFromReports | 未实现"三斗"检测规则 | 需确认 fingers 数据结构是否包含此信息 |
| P2-02 | `server/v3a-workbench-v4.js` stageFor | 未实现 consolidation 自动判断 | Phase 2 范围 |
| P2-03 | `static/v3a-client-360.js` | 成长时间线/服务历史无分页 | 当前数据量小无影响 |
| P2-04 | `static/v3a-coaching.js` | 复制话术失败时错误提示仅显示在 error bar | 可考虑 toast 或其他即时反馈 |

---

## 十、最终判定

**APPROVED — 无 P0 阻塞项。**

2 个 P1 问题（线索中文文案 + 辅导助手左栏配置展示）建议在 Preview 部署前修复，但均不影响数据安全和业务逻辑正确性。

Migration 033 的权限设计（REVOKE ALL → 仅授权 SELECT/EXECUTE → RLS → SECURITY DEFINER RPC 内部校验归属）经过了逐行审核，确认无权限提升或数据泄露路径。

下一步：修复 2 个 P1 → 授权 Preview Migration 033 → Postflight 验证 → Preview Deploy → E2E 冒烟。
