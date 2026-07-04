# PengKaiping v01 P0 Local Gray Acceptance Report

## 1. 本轮新增文件清单

* `data/p0-expression-assets/pengkaiping-v01.json`
* `lib/p0-expression-assets.js`
* `lib/p0-risk-guardrails.js`
* `scripts/test-pengkaiping-p0-assets.js`
* `docs/PengKaiping_v01_P0_Local_Gray_Acceptance_Report.md`

## 2. 本轮修改文件清单

* `lib/report-upload-p0-dryrun.js`
* `scripts/test-report-upload-p0.js`
* `scripts/export-report-upload-p0-visible-output.js`

未修改：

* `api/report-upload-p0.js`
* `report-upload.html`
* `vercel.json`
* 线上配置

## 3. Feature Flag 设计

Feature flag:

```bash
PENGKAIPING_V01_P0_ENABLED=false
```

设计结论：

* 默认 false。
* flag 关闭时，不读取彭凯平资产，不返回 `pengkaipingV01` 扩展字段。
* `NODE_ENV=production` 时，即使 `PENGKAIPING_V01_P0_ENABLED=true` 也不启用。
* 开启后只用于本地 dry-run / sample / test。
* 不默认进入线上正式 `userVisibleOutput`。

## 4. 关闭 Flag 时测试结果

命令：

```bash
node scripts/test-report-upload-p0.js
```

结果：

* total: 16
* passed: 16
* failed: 0

额外断言：

* `response.pengkaipingV01` 不存在。
* 现有 `userVisibleOutput` 三段结构仍通过。
* 现有风险边界测试仍通过。

## 5. 开启 Flag 时测试结果

命令：

```bash
PENGKAIPING_V01_P0_ENABLED=true node scripts/test-pengkaiping-p0-assets.js
```

结果：

* total: 7
* passed: 7
* failed: 0

覆盖：

* flag off no-op
* 10 条资产 schema
* 9 条自动灰度表达
* R31 人工复核
* 风险词 fallback
* 缺失资产安全降级
* JSON 字段缺失明确报错

## 6. 9 条自动灰度表达处理结果

以下 9 条表达在 flag 开启、本地 dry-run 下可返回 `pengkaipingV01` 灰度预览元数据：

* R06 鼓励与优势发展
* R04 学习动力与意义感
* R05 自主学习与自驱力
* R07 亲子聊天与倾听
* R10 共情式沟通
* R15 正向纠正与边界
* R16 家庭积极氛围
* R19 规则意识与边界
* R20 阅读习惯与学习方式

测试结论：

* `autoInsertAllowed=true`
* `needsHumanReview=false`
* `riskGuardrailPassed=true`
* `fieldDraft.userVisibleOutput` 未命中禁止词

## 7. R31 老人带娃冲突沟通处理结果

R31 处理规则：

* `needsHumanReview=true`
* `autoInsertAllowed=false`
* `fallbackUsed=true`
* `riskReason` 包含 R31 人工复核说明
* 不允许自动写入 `userVisibleOutput`

验证结论：

* R31 在 flag 开启时可返回审阅元数据。
* R31 未进入自动 `userVisibleOutput`。
* R31 必须由人工结合家庭具体情况解读。

## 8. 风险词 Fallback 测试结果

测试方式：

* 专项测试构造含 `孩子就是` 的临时表达。
* 不污染正式资产。

结果：

* `fallbackUsed=true`
* `needsHumanReview=true`
* `autoInsertAllowed=false`
* `riskReason` 记录命中词
* fallback draft 不包含风险词

## 9. Export Visible Output 禁止词检查

本轮没有运行会写入文件的 export 脚本，以避免修改现有预览包。

已用不写文件的本地 dry-run 检查以下两个 export 预览样例：

* `pengkaiping_v01_r06_encouragement_preview`
* `pengkaiping_v01_r31_human_review_preview`

检查字段：

* `title`
* `subtitle`
* `sections`
* `cta`
* `safetyNotice`

结果：

* R06 forbiddenHits: []
* R31 forbiddenHits: []
* R31 `autoInsertAllowed=false`
* R31 `needsHumanReview=true`

## 10. 是否修改 api/report-upload-p0.js

否。

`api/report-upload-p0.js` 仍保持原逻辑：

```js
module.exports = require('../lib/report-upload-p0-dryrun.js');
```

## 11. 是否 Deploy

否。

本轮未执行：

* deploy
* push
* 线上 API 调用
* 线上配置修改

## 12. 是否存在任何线上行为变化

否。

原因：

* feature flag 默认 false。
* `NODE_ENV=production` 即使 flag=true 也不启用。
* 未修改线上配置。
* 未 deploy。
* `api/report-upload-p0.js` 未修改。

## 13. 回滚方式

### 方式 A：关闭环境变量

```bash
PENGKAIPING_V01_P0_ENABLED=false
```

或不设置该环境变量。

### 方式 B：删除或忽略资产文件

可删除或忽略：

```text
data/p0-expression-assets/pengkaiping-v01.json
```

flag 关闭时不会读取该文件。flag 开启但资产缺失时，专项逻辑会安全降级。

### 方式 C：revert 本轮新增/修改文件

新增文件：

* `data/p0-expression-assets/pengkaiping-v01.json`
* `lib/p0-expression-assets.js`
* `lib/p0-risk-guardrails.js`
* `scripts/test-pengkaiping-p0-assets.js`
* `docs/PengKaiping_v01_P0_Local_Gray_Acceptance_Report.md`

修改文件：

* `lib/report-upload-p0-dryrun.js`
* `scripts/test-report-upload-p0.js`
* `scripts/export-report-upload-p0-visible-output.js`

## 14. Emma 下一步人工验收清单

建议 Emma 人工检查：

* 开启 flag 后的 visible output 是否仍像 AIPIWEN 报告语气。
* R31 是否没有进入 `userVisibleOutput`。
* R31 的 fallback 文案是否足够温和。
* 10 条表达是否适合报告语气。
* 9 条自动灰度表达是否适合进入下一步页面预览。
* 是否需要把 `pengkaipingV01` 元数据展示在本地审阅包，而不是用户前台。

建议命令：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
PENGKAIPING_V01_P0_ENABLED=true node scripts/test-pengkaiping-p0-assets.js
```

如需生成本地预览包，再单独运行：

```bash
PENGKAIPING_V01_P0_ENABLED=true node scripts/export-report-upload-p0-visible-output.js
```

注意：该 export 命令会写入预览 Markdown 文件，应在 Emma 同意后再运行。

## 15. 下一步建议

建议可以进入页面预览，但仍然只限本地。

下一步建议：

1. Emma 先人工确认本验收报告。
2. 再决定是否运行开启 flag 的 export visible output。
3. 再决定是否做本地页面预览。

不建议：

* 不建议直接上线。
* 不建议 deploy。
* 不建议默认开启 feature flag。
* 不建议继续扩展 Batch 03。
* 不建议接入其他专家内容。

