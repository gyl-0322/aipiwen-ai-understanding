# AIPIWEN Memory Engine Foundation

V3.1 Alpha Sprint 0 的独立契约模块。它只提供数据对象、服务端安全门、审计事件和 V3.0 GET-only 读取端口，不包含数据库迁移、完整 CRUD、UI、AI Pipeline 或部署配置。

## 责任边界

Memory Engine 负责：

- `service_session`、`service_record`、`memory_card`、`follow_up`、`preparation_card`、`ai_confidence`
- 服务过程与 AI 结果的安全存储契约
- Advisor 隔离、Family 预留拒绝、Admin 审计权限
- `draft -> review_pending -> confirmed -> memory` 写回安全门
- Memory 操作审计事件

Memory Engine 不负责：

- 用户身份与认证
- 客户归属
- 报告生成、OCR 或报告正文存储
- V3.0 数据库写入

所有 `advisor_ref`、`client_ref`、`report_ref` 都是 V3.0 管理的 opaque reference。V3.0 仍是身份、归属和报告状态的唯一事实源。

## V3.0 接口边界

`src/v3-reader.js` 定义提议的只读接口：

- `GET /api/v3/memory-source/v1/advisors/:advisor_ref`
- `GET /api/v3/memory-source/v1/clients/:client_ref`
- `GET /api/v3/memory-source/v1/reports/:report_ref`

客户端没有默认线上地址，认证凭证只能由现有服务端运行时注入。Sprint 0 不创建这些 V3.0 路由，也不发起真实网络请求。

## Quality Gate

在本目录执行：

```bash
npm run quality
```
