# AIPIWEN Advisor Workbench V4 Preview E2E Report

执行时间：2026-08-09 15:06 CST（Asia/Shanghai）

## 1. 环境与边界

- 环境：Vercel Preview
- Deployment ID：`dpl_24depE2iBm5bhqcsXAGAFAbhDURR`
- Preview URL：`https://aipiwen-ai-understanding-1ljgnk3g1-guo-yanling-s-projects.vercel.app`
- 登录身份：Preview active advisor
- 测试客户：仅 `C1_PREVIEW_SYNTHETIC_03`
- Production：未访问、未修改
- 真实客户：未操作

## 2. E2E 结果

### 登录与工作台首页

- Preview 指导师 Session：PASS
- 工作台首页加载：PASS
- 「今日辅导线索」真实渲染：PASS
- 线索阶段与中文说明：PASS

### 我的客户

- 客户列表加载：PASS
- 服务阶段列：PASS
- 候选案例标签列：PASS（本次合成报告未命中候选规则，显示 `-`）
- 「客户360」按钮：PASS
- 「开始解读」按钮：PASS（已有能力回归）
- 「存入案例库」按钮：PASS

### 客户 360

- 指纹档案 Tab：PASS
- 成长时间线 Tab：PASS
- 服务历史 Tab：PASS
- 行动计划 Tab：PASS
- 「发起辅导」携带合成客户 ID 跳转：PASS
- 「添加记录」携带合成客户 ID 跳转：PASS
- 保存后的行动计划与时间线读取：PASS

### AI 辅导助手

- 客户上下文加载：PASS
- TRC、ATD、性格类型、学习通道显示：PASS
- 合成话题提交：PASS
- 四段式建议生成：PASS
  - 当前状态理解
  - 建议沟通方向
  - 参考话术
  - 风险提示
- 辅导后记录保存：PASS
- 返回客户 360 后服务历史与下次计划可见：PASS

### 成长记录

- 左栏表单加载：PASS
- 记录类型、领域、方向、关联指标、可见范围选择：PASS
- 合成记录保存：PASS
- 右栏时间线即时刷新：PASS
- 返回客户 360 后成长时间线显示：PASS

### 特殊案例库

- 客户列表弹窗打开：PASS
- 案例类型、标题、留存理由、关联知识点录入：PASS
- 保存为草稿：PASS
- 草稿案例列表渲染：PASS
- 提交总部审核：PASS
- 提交后状态显示「审核中」：PASS

## 3. 合成数据

本次仅在既有合成客户 `C1_PREVIEW_SYNTHETIC_03` 下新增：

- 1 条辅导会话
- 2 条成长时间线记录（辅导记录联动 1 条、独立成长记录 1 条）
- 1 张已提交审核的合成案例卡片

全部内容均以 `E2E合成` 开头，未写入真实客户。

已提交审核的案例不能由普通指导师直接删除，暂保留用于后续 Preview 总部审核验收；未执行越权清理。

## 4. 发现的问题

### P1-01：客户 360 先天数据展示不一致

- 同一合成报告在 AI 辅导助手显示 `TRC 135 / ATD 42`。
- 客户 360「指纹档案」中 TRC 显示 `--`，ATD 显示 `--`。
- 原因：客户 360 仅读取 `engine.trc / engine.totalTrc`，未兼容报告中的 `engineResult['五功能区']['总TRC']` 等真实字段路径；ATD 同样缺少现有报告版本回退。

### P1-02：后台枚举值泄露到用户界面

- 成长时间线显示原始领域值 `learning`。
- 服务历史显示原始辅导类型 `phone_follow_up`。
- 这与「后台设计语言不暴露到前台」规则不符，需要增加前端中文映射。

### P2-01：候选案例命中分支未被本次数据覆盖

- 候选标签列及渲染逻辑存在。
- 本次唯一合成报告不满足极值/少见纹型候选规则，因此仅验证了 false 分支。
- Production 前应补一个满足候选规则的隔离 fixture 验证 true 分支。

## 5. 结论

登录态主业务闭环可运行，六组验收流程均已完成；结论为 **PASS WITH CONDITIONS**。

进入 Production 前应先关闭 P1-01 与 P1-02，并在 Preview 补跑候选案例 true 分支。当前不建议直接 Production 发布。

## 6. P1 Fix Retest Addendum

补测时间：2026-08-09 22:57 CST（Asia/Shanghai）

### Preview Deployment

- Deployment ID：`dpl_6AThhyrvE7eb932h9GCpN1dz4s3o`
- Preview URL：`https://aipiwen-ai-understanding-3sjweyo94-guo-yanling-s-projects.vercel.app`
- Vercel 状态：READY
- Target：Preview（未使用 `--prod`）
- 新 Migration：0
- Production：未部署、未访问

### 部署前门禁

- `static/v3a-client-360.js` Node Check：PASS
- `static/v3a-growth-record.js` Node Check：PASS
- V4 Contract：213 assertions PASS
- Button Inventory：74 buttons PASS
- Function Budget：12/12 PASS
- Vercel Preview Build：PASS

### P1-01 补测

- 合成客户：`C1_PREVIEW_SYNTHETIC_03`
- 客户 360「指纹档案」TRC：`135`，PASS
- 客户 360「指纹档案」ATD：`42`，PASS
- 不再显示 `--`：PASS

### P1-02 补测

- 客户 360「成长时间线」领域：显示「学习」，PASS
- 成长记录页时间线领域：显示「学习」，PASS
- 页面不再显示原始枚举 `learning`：PASS
- 客户 360「服务历史」辅导类型：显示「电话回访」，PASS
- 页面不再显示原始枚举 `phone_follow_up`：PASS

### 数据边界

- 本轮只读补测，未新增、修改或删除客户业务记录。
- 未操作任何真实客户。

### 更新结论

P1-01 与 P1-02 均已关闭。V4 Preview 登录态主链路和本轮两个显示修复均 PASS。剩余非阻塞项仅为候选案例 true 分支缺少专用隔离 fixture 验证；Production 仍需单独授权。
