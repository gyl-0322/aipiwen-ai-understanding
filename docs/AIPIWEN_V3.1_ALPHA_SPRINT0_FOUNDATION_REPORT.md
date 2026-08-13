# AIPIWEN V3.1 Alpha Sprint 0 Foundation Report

- Sprint：Sprint 0 Foundation
- 状态：`PASS`
- 日期：2026-07-31
- 部署：`NOT RUN`（合同禁止 Production，本 Sprint 不部署）
- 下一阶段：`NOT STARTED`（等待 Claude Review，不进入 Sprint 1）

## 1. 新增模块

新增独立目录 `memory-engine/`。该目录不依赖 V3.0 的 `api/`、`static/`、`server/` 或 `supabase/` 模块，也没有新增第三方依赖。

| 文件 | 职责 |
| --- | --- |
| `memory-engine/src/contracts.js` | 六类核心对象及审计事件的数据契约 |
| `memory-engine/src/security.js` | 服务端权限、隐私门、审计构造器、AI 写回状态机 |
| `memory-engine/src/v3-reader.js` | V3.0 advisor/client/report 的 GET-only API 消费端口 |
| `memory-engine/src/index.js` | Foundation 模块出口 |
| `memory-engine/test/*.test.js` | 数据契约、权限、隐私、写回与 V3.0 接口测试 |
| `memory-engine/scripts/*.js` | Build 与架构边界检查 |

Memory Engine 负责：

- Memory 对象契约；
- service 过程对象；
- AI 结果及其可信度记录契约；
- Memory 操作审计；
- 人工确认后写回永久记忆的安全门。

Memory Engine 不负责：

- 用户身份与认证；
- 客户归属；
- 报告生成、OCR 或报告正文；
- 修改 V3.0 数据库。

## 2. 数据对象

| 对象 | 最小边界 | 说明 |
| --- | --- | --- |
| `service_session` | `advisor_ref`、`client_ref`、时间、状态、可选 `report_refs` | 一次服务过程；不拥有 advisor/client 身份 |
| `service_record` | session/advisor/client 引用、记录类型、来源、结构化内容 | 支持指导师记录、观察、决策和 `ai_result` |
| `memory_card` | customer/advisor/case 类型、subject/owner 引用、来源记录、生命周期、内容 | 统一记忆载体；永久记忆必须经过写回安全门 |
| `follow_up` | session/advisor/client 引用、到期时间、状态、计划 | 跟进计划契约 |
| `preparation_card` | session/advisor/client/report 引用、状态、准备内容 | 解读前准备信息，不保存报告正文 |
| `ai_confidence` | 目标引用、0–1 分数、依据、限制 | 仅记录可信度，不实现 AI Pipeline |
| `audit_event` | 操作、actor、目标、advisor、时间、元数据 | 覆盖创建、修改、确认、写回 |

全部 V3.0 引用都是 opaque reference。对象契约明确不拥有 `user_id`、Auth 身份、姓名、电话、邮箱、地址、身份证、报告正文、OCR 原文或指纹资料。

## 3. V3.0 接口边界

Sprint 0 定义以下提议接口；它们是 Memory Engine 的消费契约，不代表 V3.0 已存在对应路由：

| 读取对象 | GET-only 路径 | 允许投影 |
| --- | --- | --- |
| advisor | `/api/v3/memory-source/v1/advisors/:advisor_ref` | `advisor_ref`、`status`、可选 `updated_at` |
| client | `/api/v3/memory-source/v1/clients/:client_ref` | `client_ref`、`advisor_ref`、`status`、可选 `updated_at` |
| report | `/api/v3/memory-source/v1/reports/:report_ref` | `report_ref`、`client_ref`、`advisor_ref`、`status`、可选类型/时间 |

接口约束：

- 仅允许 `GET`；
- 仅允许 HTTPS；
- 没有默认 Production 地址；
- 凭证必须由既有服务端运行时注入，不新增或改变 Auth/Session；
- 返回字段使用严格白名单，出现身份或其他额外字段时整体拒绝；
- Memory Engine 内没有 Supabase、Postgres、KV 或其他 V3.0 数据库适配器。

真实 V3.0 路由创建、凭证接线和连通性验证均为 `NOT RUN`。这样可以在不修改 V3.0 的前提下先冻结消费边界。

## 4. 权限设计

权限检查设计为服务端执行，不将前端判断视为授权依据。

| 角色 | Alpha 权限 |
| --- | --- |
| Advisor | 仅当资源的 `advisor_ref` / `owner_advisor_ref` 与服务端 principal 一致时，可创建、修改、确认、写回自己的服务记忆 |
| Family | 预留；全部拒绝，不开放 |
| Admin | 仅可读取系统审计；默认不能读取或修改 Advisor 服务记忆 |

AI Writeback 状态机：

```text
draft -> review_pending -> confirmed -> memory
```

- AI 只能把 `draft` 提交到 `review_pending`；
- 只有资源所属的人工 Advisor 可以执行 `review_pending -> confirmed`；
- `confirmed -> memory` 必须由服务端执行，并携带同一所属 Advisor 的确认依据；
- 禁止跳级，AI 不能确认或直接写入永久记忆。

隐私门会拒绝结构化敏感字段，以及常见邮箱、中国大陆手机号、身份证号和凭证模式。该门是 Alpha 契约级防线；完整语义 DLP 尚未实现，不能把自由文本检测能力扩大解释为全面隐私识别。

## 5. 测试结果

执行目录：`memory-engine/`

执行命令：

```bash
npm run quality
```

| Quality Gate | 结果 | 证据 |
| --- | --- | --- |
| Build | `PASS` | Foundation 必需导出完整加载 |
| Node Check | `PASS` | src、scripts、tests 全部 `node --check` |
| Test | `PASS` | 11/11 通过，0 failed |
| 架构边界检查 | `PASS` | 无 V3.0 核心模块/数据库依赖；只读资源限定为 advisor/client/report |

测试覆盖：

- 六类核心数据对象结构；
- 未知字段、无效状态与无效置信度拒绝；
- Advisor 跨归属访问拒绝；
- Family 关闭、Admin 审计限定；
- 敏感字段、报告正文、指纹资料和常见敏感值拒绝；
- AI 无法确认或直接写回永久记忆；
- 创建、修改、确认、写回审计事件；
- V3.0 GET-only 路径、严格投影、无默认端点与服务端凭证注入。

## 6. 未实现范围

以下内容明确未实现：

- 数据库表、迁移、持久化仓储与完整业务 CRUD；
- V3.0 实际 Memory Source API 路由及线上连通；
- AI 模型、Prompt、编排、推理与 AI Pipeline；
- Advisor PC、Mobile Recorder、Family OS、Relationship Intelligence；
- Family 访问；
- UI、部署配置、Preview/Production 部署；
- Auth、Session、Report Engine、Attribution 的任何修改；
- 完整语义 DLP 与自由文本人工复核流程。

## 边界检查与 Stop Conditions

本 Sprint 仅新增 `memory-engine/` 和本报告。工作树中原有的 `vercel.json` 修改及其他未跟踪文件不属于本 Sprint，未被修改或纳入交付。

| Stop Condition | 状态 |
| --- | --- |
| 需要修改 V3.0 核心表 | 未触发 |
| 需要改变 Auth | 未触发 |
| 需要改变 Session | 未触发 |
| 需要提前实现 AI Pipeline | 未触发 |
| 需要扩大 Alpha 范围 | 未触发 |

Sprint 0 Foundation 到此停止，等待 Claude Review。
