# AIPIWEN 报告上传链路总说明：图片识别 vs P0 dry-run

处理日期：2026-07-03

本文件用于 Emma 本地测试 report-upload 链路时区分“图片真实识别”和“P0 dry-run 报告输出”。本轮不改代码，不 deploy，不上线，不调用真实 OCR/Vision。

## 1. 当前上传链路总览

当前有两条不同链路，不要混在一起看。

### A. 图片识别链路

链路：

```text
report-upload.html
  -> /api/extract-fp
  -> 真实 OCR/Vision
```

用途：

- 用户在页面上传或拍摄报告图片。
- 前端把图片压缩成 `imageBase64`。
- 点击“识别数据”后，页面把 `imageBase64` 和 `imageMimeType` 发给 `/api/extract-fp`。
- `/api/extract-fp` 负责调用真实视觉识别能力，尝试从图片中提取结构化报告数据。

测试重点：

- 图片是否能被页面读取和压缩。
- `/api/extract-fp` 是否返回 `ok=true`。
- 如果失败，看 `/api/extract-fp` 的错误，而不是看 `/api/report-upload-p0`。

### B. P0 dry-run 报告链路

链路：

```text
JSON 输入
  -> /api/report-upload-p0
  -> lib/report-upload-p0-dryrun.js
  -> userVisibleOutput / imageDryRun
```

用途：

- 生成 Report Upload P0 的本地 dry-run 输出。
- 验证风险分级、输出字段、用户可见文案、安全边界。
- 当前可接收 JSON 里的 `imageInput` 图片元信息，并返回 `imageDryRun`。
- `imageDryRun` 只表示“收到了图片元信息”，不代表图片已被真实识别。

测试重点：

- `userVisibleOutput` 是否像 AIPIWEN 报告语气。
- `imageDryRun.received` 是否正确表示图片元信息接收状态。
- `actualRecognitionCalled` 是否始终为 `false`。
- 是否没有回显完整 `imageBase64`。

## 2. 两个 API 的分工

### `/api/extract-fp`

职责：

- 负责真实图片识别。
- 接收 JSON：`imageBase64`、`imageMimeType`。
- 调用真实 OCR/Vision 能力。
- 返回图片识别后的结构化数据或错误。

不负责：

- 不负责 P0 报告 dry-run 输出。
- 不负责彭凯平 v01 灰度表达。
- 不负责 `userVisibleOutput`。

### `/api/report-upload-p0`

职责：

- 负责 Report Upload P0 dry-run。
- 转到 `lib/report-upload-p0-dryrun.js`。
- 输出风险分级、P0 决策、`userVisibleOutput`、`imageDryRun`。
- 只接收 JSON。
- 可以接收 JSON 图片元信息，用于 dry-run 接收校验。

不负责：

- 不负责真实图片识别。
- 不调用 `/api/extract-fp`。
- 不调用 OCR/Vision。
- 不解析 multipart 文件上传。

当前设计边界：

- `report-upload-p0` 只接收 JSON，不接 `multipart/form-data`。
- multipart 发给 `report-upload-p0` 返回错误是正常设计。
- `imageDryRun` 只说明“收到图片元信息”，不代表识别成功。

## 3. Emma 测试时怎么看结果

如果要测“图片有没有被收到”：

- 看 `/api/report-upload-p0` 返回的 `imageDryRun`。
- 重点字段：
  - `imageDryRun.received`
  - `imageDryRun.fileName`
  - `imageDryRun.mimeType`
  - `imageDryRun.sizeBytes`
  - `imageDryRun.base64Length`
  - `imageDryRun.actualRecognitionCalled`

如果要测“图片有没有被真实识别”：

- 看 `/api/extract-fp` 返回结果。
- 重点看：
  - 是否 `ok=true`
  - 是否有结构化报告字段
  - 如果失败，错误是图片过大、缺少 `imageBase64`、识别失败、解析失败，还是视觉模型调用失败

如果要测“报告输出文案”：

- 看 `/api/report-upload-p0` 返回的 `userVisibleOutput`。
- 重点看：
  - 是否温和
  - 是否不诊断
  - 是否不承诺效果
  - 是否没有“孩子就是 / 家长必须 / 一定 / 必然 / 诊断 / 治疗”等风险表达

如果要测“彭凯平灰度表达”：

- 只在本地开启：

```bash
PENGKAIPING_V01_P0_ENABLED=true
```

- 重点看：
  - 是否出现 `pengkaipingV01`
  - R31 是否没有自动写入 `userVisibleOutput`
  - 风险词 fallback 是否生效

## 4. 本地测试命令

进入项目目录：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding
```

原 P0 dry-run 测试：

```bash
node scripts/test-report-upload-p0.js
```

图片接收 dry-run 测试：

```bash
node scripts/test-report-upload-p0-image-dryrun.js
```

彭凯平 v01 本地灰度测试：

```bash
PENGKAIPING_V01_P0_ENABLED=true node scripts/test-pengkaiping-p0-assets.js
```

导出 P0 用户可见输出预览包：

```bash
node scripts/export-report-upload-p0-visible-output.js
```

本地页面预览：

```bash
vercel dev --listen 3000
```

打开：

```text
http://localhost:3000/report-upload.html
```

如果 3000 被占用，Vercel 可能自动换到 3001、3002 等端口，以终端输出的地址为准。

## 5. 常见误解

### 误解 1：`imageDryRun.received=true` 等于图片识别成功

不等于。

`imageDryRun.received=true` 只表示 `/api/report-upload-p0` 收到了 JSON 图片元信息。它不代表 OCR/Vision 已经识别图片。

### 误解 2：`/api/report-upload-p0` 会调用 `/api/extract-fp`

不会。

`/api/report-upload-p0` 是 P0 dry-run 报告输出链路，不会调用真实识别接口。

### 误解 3：multipart 发给 `report-upload-p0` 报错是 bug

不是 bug。

当前设计是：`report-upload-p0` 只支持 JSON dry-run 图片元信息，不支持 multipart 文件上传。真实图片识别请走 `/api/extract-fp`。

### 误解 4：`report-upload.html` 上传图片后会直接进 `report-upload-p0`

不是。

当前页面图片识别走：

```text
report-upload.html -> /api/extract-fp
```

P0 报告输出走：

```text
report-upload.html -> /api/report-upload-p0
```

### 误解 5：dry-run 会消耗真实识别能力

不会。

P0 dry-run 不调用 OCR/Vision，不调用 `/api/extract-fp`，也不消耗真实识别能力。

## 6. 下一步真实识别接入建议

只做设计建议，本文件不执行代码修改。

建议路径：

1. 先稳定 `/api/extract-fp` 的真实识别输出 schema。
2. 明确成功返回字段、失败错误码、可恢复错误和不可恢复错误。
3. 再把 `/api/extract-fp` 的结构化结果作为 `report-upload-p0` 的 `reportInput`。
4. 不建议让 `/api/report-upload-p0` 直接做 OCR。
5. 不建议把图片识别 API 和报告 dry-run API 混在一起。
6. 增加端到端测试：

```text
图片
  -> /api/extract-fp
  -> reportInput
  -> /api/report-upload-p0
  -> userVisibleOutput
```

真实识别接入前建议补齐：

- `/api/extract-fp` 错误码：
  - `image_missing`
  - `image_too_large`
  - `unsupported_image_type`
  - `vision_env_missing`
  - `vision_empty_response`
  - `vision_parse_failed`
  - `vision_provider_error`
- 前端错误提示分层。
- 图片压缩前后大小显示。
- 日志脱敏。
- base64 不落日志。
- 失败时允许用户手动输入或转人工。

## 7. 当前安全边界

当前状态：

- 没有 deploy。
- 没有上线。
- 没有调用真实 OCR/Vision。
- 没有调用 `/api/extract-fp`。
- 没有 base64 泄露。
- `imageDryRun` 只返回 base64 长度，不返回完整 `imageBase64`。
- 彭凯平 feature flag 默认关闭。
- `NODE_ENV=production` 下不启用彭凯平灰度。
- `report-upload-p0` 仍是 dry-run，不是正式报告生成服务。
- `imageDryRun` 不是识别结果，只是接收校验。

## 8. Emma 建议测试顺序

建议先测 P0 dry-run 链路，因为它不消耗真实识别能力：

1. 运行 `node scripts/test-report-upload-p0.js`
2. 运行 `node scripts/test-report-upload-p0-image-dryrun.js`
3. 查看 `imageDryRun` 是否符合预期
4. 查看 `userVisibleOutput` 是否符合 AIPIWEN 语气
5. 再单独测 `/api/extract-fp` 真实图片识别
6. 最后再测页面端完整流程

不要把 `imageDryRun` 当作图片识别验收结果。图片真实识别必须以 `/api/extract-fp` 的返回为准。
