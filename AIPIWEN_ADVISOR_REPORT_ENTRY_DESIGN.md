# 指导师替客户录入报告 · 产品与数据设计 V0.2

**日期**：2026-07-28
**类型**：产品设计（真实客户录入缺口）
**状态**：DRAFT，待产品与架构确认
**本阶段边界**：只冻结设计，不修改代码、数据库、Auth、Session 或 Production

---

## 1. 要解决的问题

AIPIWEN 当前有两条面向终端用户的报告路径：

- `report-upload.html`：用户上传皮纹总表图片并确认识别结果。
- `fingerprint-v2-wizard.html`：用户手动录入十指纹型。

指导师工作台目前没有“指导师替客户录入已有报告”的入口。真实业务中，指导师可能收到采集中心交付的纸质报告或报告图片，需要在已登录的工作台内：

1. 选择已有客户或新建客户；
2. 上传报告图片；
3. 核对并修正识别数据；
4. 确认入库；
5. 在“我的客户”中找到该客户及报告；
6. 从报告进入后续解读。

本功能不是让指导师伪造客户账号，也不是替客户绕过登录或验证码。

---

## 2. 已核实的现有技术基线

以下内容以当前仓库为准：

- 图片识别入口为 `/api/extract-fp`。
- 报告生成入口为 `/api/generate-report`。
- `/api/report-store` 不是独立函数文件；它通过 `vercel.json` 路由到 `api/generate-report.js` 内部的 `handleReportStore`。
- 当前报告存储在 Redis `report:{id}`，有效期为一年。
- 当前报告对象没有指导师归属字段。
- 当前 `/api/report-store` 不要求 V3A Session，不能直接作为指导师真实客户入库接口。
- 当前 `report-upload.html` 只接受 `image/*`，首期不能宣称支持 PDF。
- 当前 Supabase 没有真实客户表。
- 当前“我的客户”和“AI 解读助手”使用学习示例，不是真实客户数据。

因此，首期不能只在前端增加一个按钮，也不能让浏览器给现有公开接口附加 `advisor_id` 后直接入库。

---

## 3. 产品规则调整

### 3.1 真实客户来源

真实客户来源从原来的两类扩展为三类，并必须记录来源：

| 来源代码 | 用户路径 | 归属建立方式 |
|---|---|---|
| `invite_link` | 用户通过指导师邀请链接完成报告 | 系统依据已验证邀请关系建立 |
| `advisor_qr` | 用户扫描指导师二维码完成报告 | 系统依据二维码归属建立 |
| `advisor_import` | 指导师在工作台替客户录入报告 | 系统依据当前登录指导师建立 |

`advisor_import` 是本次新增且被明确允许的真实客户来源。它不创建客户登录身份，也不自动制造邀请关系。

### 3.2 示例数据与真实数据

“我的客户”页面必须分区展示：

- **真实客户**：来自上述三种真实来源，可进入真实报告和解读流程。
- **学习示例**：保留现有两条示例，必须持续标注“学习示例”，不得混入真实客户数量、搜索结果或业务统计。

### 3.3 数据用途

报告入库首先是为了客户服务和指导师工作流，不等于自动用于模型训练。

- 原始文件、识别数据和生成报告属于业务数据。
- 若未来用于案例库、统计或模型训练，必须另行制定去标识化、授权、保留期限和删除规则。
- 不得因为“数据库越来越丰富”而默认把个人报告作为训练数据。

---

## 4. 入口设计

提供两个一致的入口：

1. 左侧导航：在“我的客户”和“AI 解读助手”之间增加“录入报告”。
2. “我的客户”页：真实客户区标题右侧增加“录入报告”主按钮。

两个入口均进入：

`/ai-interpreter-report-entry.html`

入口只对已登录、状态为 `active` 的普通指导师开放。机构、服务中心、分公司是否可以代录，首期不开放，待单独确认。

---

## 5. 完整用户流程

### Step 0：选择客户

进入录入页面后先选择：

- **已有客户**：从当前指导师名下的真实客户中选择。
- **新客户**：填写最少必要信息后创建。

首期新客户字段：

- 客户称呼或姓名：必填，最多 40 字。
- 出生日期或年龄：二选一；报告同时保存“生成时年龄”。
- 备注：选填，最多 200 字。

首期不强制收集手机号、身份证、地址等非必要信息。

当同一指导师名下存在相同姓名且出生信息相近的客户时，系统先提示选择已有客户，避免重复建档；指导师仍可确认这是不同客户。

### Step 1：上传报告图片

首期支持：

- JPG
- JPEG
- PNG
- 手机拍照

首期不支持：

- PDF
- Word
- 压缩包
- 多页批量上传

页面应明确提示：“请上传包含十指纹型、TRC、ATD 等数据的清晰总表图片。”

### Step 2：识别与人工确认

调用现有识别能力，展示：

- 十指纹型；
- 每指 TRC；
- ATD；
- 从图片中识别到的姓名和年龄；
- 无法识别或低可信字段。

识别结果只是草稿。指导师必须逐项核对，并主动点击“我已核对，确认数据准确”，才能继续。

如果图片中的姓名与 Step 0 客户不一致，系统只提示冲突，不自动覆盖客户资料。

### Step 3：选择报告方向和关注问题

指导师选择：

- 报告类型；
- 客户关注问题；
- 自定义补充问题。

页面复用现有问题标签和生成规则，不新增第二套报告算法。

### Step 4：确认入库

提交前展示最终摘要：

- 客户；
- 数据来源；
- 十指数据完整性；
- 报告类型；
- 关注问题；
- 数据授权确认。

按钮文案为“确认入库并生成报告”。提交后：

1. 服务端确认当前 Session、账号状态和指导师身份；
2. 服务端建立或读取当前指导师名下客户；
3. 保存报告草稿并生成幂等键；
4. 调用现有报告生成能力；
5. 成功后把报告状态更新为 `ready`；
6. 客户出现在“我的客户”的真实客户区；
7. 提供“查看报告”和“进入解读”。

生成失败时保留可重试的失败记录，不重复创建客户或报告。

---

## 6. 数据模型

### 6.1 数据源选择

Supabase 是客户归属和报告索引的唯一事实来源。Redis 只保留现有公开报告兼容能力、短期任务状态或缓存，不作为指导师客户关系的唯一数据库。

原始图片如需保留，应存入私有对象存储；不得使用公开 URL。原始图片保留期限需要产品另行确认。

### 6.2 `advisor_clients`

建议新增独立客户表，不复用 `users`。`users` 表代表已认证账号，指导师代录客户不等于创建登录用户。

最小字段：

```text
id                    uuid primary key
advisor_user_id       uuid not null references users(id)
auth_user_id          uuid null
source                text not null
display_name          text not null
birth_date            date null
created_at            timestamptz not null
updated_at            timestamptz not null
archived_at           timestamptz null
```

约束：

- `source` 仅允许 `invite_link`、`advisor_qr`、`advisor_import`。
- `auth_user_id` 预留给未来客户本人注册后的安全绑定，不在本次自动填写。
- 浏览器不得直接插入或修改归属字段。

### 6.3 `advisor_reports`

建议新增报告业务表：

```text
id                    uuid primary key
advisor_client_id     uuid not null references advisor_clients(id)
status                text not null
source                text not null
source_file_path      text null
structured_input      jsonb not null
generated_report      jsonb null
age_at_report         integer null
idempotency_key       uuid not null
error_code            text null
created_at            timestamptz not null
updated_at            timestamptz not null
```

状态：

`draft → reviewed → generating → ready`

失败状态：

`failed`

约束：

- `idempotency_key` 必须唯一，防止重复点击产生重复报告。
- `ready` 前不得出现在真实客户的可用报告列表。
- `error_code` 只保存安全错误码，不保存密钥、验证码、Cookie、Session 或完整上游响应。

### 6.4 RLS 与归属

所有客户和报告读取必须基于当前已认证身份：

- 当前指导师只能读取自己名下的客户和报告。
- 不接受浏览器提供的 `advisor_id` 作为授权依据。
- 写入由 BFF 从 HttpOnly Session 推导 `users.id`。
- 新增、修改、重试等写操作必须通过 CSRF 校验。
- `pending`、`rejected`、`frozen`、`disabled` 账号不得调用。

---

## 7. API 契约

不要新增 `GET /api/customers?advisor_id=xxx`。这个形式允许调用方尝试查询他人数据。

建议使用统一的 V3A BFF：

### `GET /api/v3a-customers`

- 服务端从 Session 获取当前指导师。
- 返回当前指导师名下真实客户。
- 不接收 `advisor_id`。

### `POST /api/v3a-report-import?action=extract`

- 要求有效 V3A Session。
- 要求 active advisor。
- 校验 CSRF、文件类型、文件大小和请求频率。
- 调用现有 `/api/extract-fp` 的内部能力。
- 返回待确认结构化数据，不建立最终客户关系。

### `POST /api/v3a-report-import?action=confirm`

- 要求有效 V3A Session 和 CSRF。
- 接收 `existingClientId` 或 `newClient`，二者只能选一个。
- 服务端校验 existing client 必须属于当前指导师。
- 创建幂等报告任务并触发报告生成。
- 不接受客户端提交 `advisor_id`。

### `GET /api/v3a-report-import?id=...`

- 只返回当前指导师拥有的报告状态和安全结果。
- 不依赖“知道 report id”作为访问权限。

实现时应复用现有识别和报告生成逻辑，但不要让指导师页面直接调用当前公开的 `/api/report-store` 完成归属写入。

---

## 8. “我的客户”页面

页面结构调整为：

1. **真实客户**
   - 真实数量；
   - 搜索与筛选只作用于真实客户；
   - 每行显示客户、来源、最近报告状态、更新时间；
   - 点击进入客户详情或报告。
2. **学习示例**
   - 保留现有两条示例；
   - 独立标题和视觉标识；
   - 不计入真实数量；
   - 不与真实报告接口混用。

空状态：

> 还没有真实客户。您可以邀请客户完成报告，也可以替客户录入已有报告。

---

## 9. 失败、重试与重复提交

- 图片识别失败：停留在上传步骤，可更换图片，不创建客户。
- 部分字段缺失：进入确认页，由指导师补全。
- 报告生成失败：保留 `failed` 记录，允许重试，不重复建客户。
- 网络超时：前端使用同一幂等键查询状态，不重新创建任务。
- 重复报告：同一客户、同一文件摘要、短时间内重复提交时提示确认。
- 客户误建：提供归档，不做物理删除；合并客户属于后续独立功能。

---

## 10. 分阶段实施

### Phase A：设计与契约冻结

- 冻结角色范围、文件类型、数据字段、保留期限和客户来源。
- 完成 migration、RLS、BFF 与测试设计。
- 只读审查现有报告生成逻辑。

### Phase B：Preview 数据闭环

- 新增客户和报告表及 RLS。
- 新增安全 BFF。
- 新增录入页面。
- 在 Preview 完成图片上传、确认、入库、客户列表和失败重试。

不得把只有前端外壳、没有真实归属的入口部署到 Production。

### Phase C：Preview 真实用户验收

- 新客户录入；
- 已有客户追加报告；
- 重复提交；
- 越权访问；
- 失败重试；
- 示例与真实数据分区；
- 日志脱敏。

### Phase D：Production Release

只有 migration、RLS、Build、Test、Security、真机与功能验收全部通过后，才单独授权 Production migration 和 deploy。

---

## 11. 验收标准

必须全部满足：

- active advisor 能从两个入口进入录入流程。
- pending 或无权限用户不能进入或调用接口。
- 首期上传区域只宣称支持 JPG、JPEG、PNG。
- OCR 数据必须经人工确认。
- 浏览器请求中没有可控制归属的 `advisor_id`。
- 新客户只创建一次。
- 同一次提交只生成一份报告。
- 报告生成成功后才出现在真实客户可用列表。
- 指导师 A 无法读取、修改或猜测指导师 B 的客户和报告。
- 学习示例不计入真实客户数据。
- 日志不含原图、姓名、手机号、验证码、Cookie、Session、Token 或 Secret。
- 数据库 migration、RLS 与回滚方案经过独立 Review。

---

## 12. 待产品确认

建议首期采用以下默认决定：

1. **文件格式**：仅 JPG、JPEG、PNG；PDF 后续单独设计。
2. **角色范围**：仅 active 普通指导师；机构角色暂不开放。
3. **手工录入**：首期不搬入完整十指手工向导，只允许对识别结果逐项修正。
4. **客户资料**：只收称呼/姓名与出生信息，不强制手机号。
5. **原图保留**：建议确认入库后保留 30 天，之后自动删除；结构化报告继续保留。
6. **训练用途**：首期不自动进入训练集或公开案例库。

以上六项确认后，文档可冻结为 V1.0，再进入 migration、RLS 和 API 技术设计。未经单独授权，不执行数据库或 Production 变更。
