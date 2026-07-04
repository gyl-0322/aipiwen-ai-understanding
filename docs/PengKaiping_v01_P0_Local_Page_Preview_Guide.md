# PengKaiping v01 P0 Local Page Preview Guide

## 1. 本地预览前提

项目路径：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
```

本机已检测到：

* `vercel`
* `node`
* `npx`

`report-upload.html` 会调用：

```text
/api/report-upload-p0
```

因此不建议用 `file://` 或普通 `python3 -m http.server` 做完整预览。它们只能打开静态页面，不能正确模拟 Vercel API route。

推荐本地预览方式：

```bash
vercel dev --listen 3000
```

然后打开：

```text
http://localhost:3000/report-upload.html
```

注意：

* 这是本地预览，不是 deploy。
* 不要运行 `vercel deploy`。
* 不要修改线上配置。
* `PENGKAIPING_V01_P0_ENABLED` 默认不设置，即 false。

## 2. Flag 关闭状态如何预览

关闭状态是默认状态。推荐命令：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
unset PENGKAIPING_V01_P0_ENABLED
vercel dev --listen 3000
```

打开：

```text
http://localhost:3000/report-upload.html
```

Emma 可在页面中输入一个普通孩子场景，例如：

```text
孩子最近写作业拖拉、容易生气，家长想结合报告理解孩子行为。
```

预期：

* 页面正常返回 P0 快速读懂。
* 不出现任何彭凯平 v01 扩展。
* 不出现 `pengkaipingV01` 相关可见内容。
* 现有页面行为保持原样。

关闭状态测试命令：

```bash
node scripts/test-report-upload-p0.js
```

已知最近结果：

* total: 16
* passed: 16
* failed: 0

## 3. Flag 开启状态如何预览

开启本地灰度：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
PENGKAIPING_V01_P0_ENABLED=true vercel dev --listen 3000
```

打开：

```text
http://localhost:3000/report-upload.html
```

重要限制：

当前 `report-upload.html` 没有传 `pengkaipingExpressionId`，也没有渲染响应中的 `pengkaipingV01` 审阅元数据。因此页面只能验证：

* flag 开启后基础页面仍正常。
* 基础 `userVisibleOutput` 不被破坏。
* 页面没有线上行为变化。

要查看具体彭凯平表达灰度效果，请用 API dry-run 或 export 对比，不要擅自修改页面。

### API dry-run 查看 R06

另开一个终端，保持 `vercel dev` 运行，然后执行：

```bash
curl -s http://localhost:3000/api/report-upload-p0 \
  -H 'Content-Type: application/json' \
  -d '{
    "reportText":"孩子在手工和表达任务中愿意尝试，但遇到难题会退缩，家长希望更好地鼓励孩子。",
    "reportType":"child",
    "userIdentity":"parent",
    "userIntent":"understand_child_behavior",
    "reportSubject":"child",
    "subjectAge":10,
    "subjectRelation":"parent_child",
    "consentConfirmed":true,
    "pengkaipingExpressionId":"R06"
  }' | python3 -m json.tool
```

重点看：

* `pengkaipingV01.expressionId` 应为 `R06`
* `pengkaipingV01.autoInsertAllowed` 应为 `true`
* `pengkaipingV01.needsHumanReview` 应为 `false`
* `pengkaipingV01.fieldDraft.userVisibleOutput` 应为低风险表达草稿

### API dry-run 查看 R31

```bash
curl -s http://localhost:3000/api/report-upload-p0 \
  -H 'Content-Type: application/json' \
  -d '{
    "reportText":"家里老人带娃方式和父母不一致，孩子作息和电子产品规则不稳定。",
    "reportType":"child",
    "userIdentity":"parent",
    "userIntent":"understand_child_behavior",
    "reportSubject":"child",
    "subjectAge":7,
    "subjectRelation":"parent_child",
    "consentConfirmed":true,
    "pengkaipingExpressionId":"R31"
  }' | python3 -m json.tool
```

重点看：

* `pengkaipingV01.expressionId` 应为 `R31`
* `pengkaipingV01.needsHumanReview` 应为 `true`
* `pengkaipingV01.autoInsertAllowed` 应为 `false`
* `pengkaipingV01.fallbackUsed` 应为 `true`
* R31 不应自动进入 `userVisibleOutput`

开启状态测试命令：

```bash
PENGKAIPING_V01_P0_ENABLED=true node scripts/test-pengkaiping-p0-assets.js
```

已知最近结果：

* total: 7
* passed: 7
* failed: 0

## 4. 如何导出 visible output 对比

当前 export 脚本会写入预览 Markdown 文件。请只在 Emma 同意生成预览包时运行。

关闭 flag 导出：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
unset PENGKAIPING_V01_P0_ENABLED
node scripts/export-report-upload-p0-visible-output.js
```

开启 flag 导出：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
PENGKAIPING_V01_P0_ENABLED=true node scripts/export-report-upload-p0-visible-output.js
```

输出文件位置：

```text
docs/aipiwen_report_system/12_test_cases_测试样本/AIPIWEN_ReportUpload_P0.10_用户可见输出预览包.md
```

开启 flag 时，export 脚本会额外加入两个本地灰度样例：

* `pengkaiping_v01_r06_encouragement_preview`
* `pengkaiping_v01_r31_human_review_preview`

检查重点：

* R06 是否仍然是温和、低风险表达。
* R31 是否没有自动进入 `userVisibleOutput`。
* 页面可见输出是否没有风险词。
* `pengkaipingV01` 元数据是否只用于审阅，不进入普通用户前台。

## 5. Emma 人工验收清单

### 报告语气

* 是否像 AIPIWEN 的报告语气，而不是课程笔记。
* 是否温和、具体、可理解。
* 是否符合“理解孩子、支持成长、亲子沟通”的定位。

### 安全边界

检查是否没有以下风险表达：

* 孩子就是
* 家长必须
* 一定
* 必然
* 诊断
* 治疗
* 创伤修复
* 心理问题
* 病理
* 抑郁
* 焦虑症
* 人格障碍
* 创伤
* 疗愈

### 家长可读性

* 家长是否能一眼看懂。
* 是否不过度承诺。
* 是否不制造焦虑。
* 是否有实际家长行动建议。
* 是否适合放入 1980 元完整版报告或人工解读。

### R31 检查

* R31 是否没有进入自动 `userVisibleOutput`。
* R31 是否标记 `needsHumanReview=true`。
* R31 是否标记 `autoInsertAllowed=false`。
* R31 fallback 是否可接受、温和、不指责家庭成员。

## 6. 不通过时如何回滚

### 关闭 flag

```bash
unset PENGKAIPING_V01_P0_ENABLED
```

或明确设为：

```bash
PENGKAIPING_V01_P0_ENABLED=false
```

### 停止本地预览

在运行 `vercel dev` 的终端按：

```text
Ctrl+C
```

### 忽略灰度资产

flag 关闭时不会读取：

```text
data/p0-expression-assets/pengkaiping-v01.json
```

### 代码级回滚

如需完全回滚本地灰度实现，revert 本轮新增和修改文件：

新增：

* `data/p0-expression-assets/pengkaiping-v01.json`
* `lib/p0-expression-assets.js`
* `lib/p0-risk-guardrails.js`
* `scripts/test-pengkaiping-p0-assets.js`
* `docs/PengKaiping_v01_P0_Local_Gray_Acceptance_Report.md`
* `docs/PengKaiping_v01_P0_Local_Page_Preview_Guide.md`

修改：

* `lib/report-upload-p0-dryrun.js`
* `scripts/test-report-upload-p0.js`
* `scripts/export-report-upload-p0-visible-output.js`

## 7. 下一步建议

建议下一步可以做本地页面预览，但仍然只限本地。

推荐顺序：

1. Emma 先阅读本指南。
2. 运行 flag 关闭页面预览，确认基础链路正常。
3. 运行 flag 开启页面预览，确认基础页面没有被破坏。
4. 用 curl 查看 R06 / R31 的 dry-run 灰度元数据。
5. Emma 决定是否运行 export visible output 生成对比文件。
6. 如果通过，再讨论是否需要修改 `report-upload.html` 做本地审阅面板。

不建议：

* 不建议直接上线。
* 不建议 deploy。
* 不建议默认开启 `PENGKAIPING_V01_P0_ENABLED`。
* 不建议继续 Batch 03。
* 不建议接入其他专家。
* 不建议在未审阅前修改 `report-upload.html`。

