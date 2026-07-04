# Report Upload P0 图片接收 Dry-run 最小修复说明

处理日期：2026-07-03

## 1. 本轮修复了什么

本轮只为 `/api/report-upload-p0` 增加 JSON 图片输入的 dry-run 接收校验。

新增能力：

- 接收 JSON 中的 `imageInput` 图片元信息。
- 允许 `imageInput.imageBase64` 出现在请求中。
- 响应中返回净化后的 `imageInput` 摘要。
- 响应中返回 `imageDryRun`，说明图片已被 dry-run 接收。
- 只记录 `base64Length`，不回显完整 `imageBase64`。
- 对非推荐图片格式返回 warning。
- 对超过 10MB 的图片返回 warning。
- 对 `multipart/form-data` 返回明确错误，说明当前接口只支持 JSON dry-run 图片元信息。

## 2. 本轮没有做什么

本轮没有：

- 调用真实 OCR。
- 调用真实 Vision 模型。
- 调用 `/api/extract-fp`。
- 修改真实图片识别逻辑。
- 修改线上配置。
- deploy 或上线。
- 把 dry-run 接收写成“识别成功”。
- 把图片 base64 写进用户可见输出。
- 改变 Report OS 正式报告主逻辑。

## 3. `/api/report-upload-p0` 和 `/api/extract-fp` 的分工

`/api/report-upload-p0`：

- Report Upload P0 dry-run 输出链路。
- 只接收 JSON。
- 可以接收图片元信息和 base64 长度校验。
- 不做真实 OCR / Vision。
- 不解析 multipart 文件上传。
- 不生成真实完整报告。

`/api/extract-fp`：

- 当前真实图片识别入口。
- 接收 `imageBase64` 和 `imageMimeType`。
- 调用视觉模型识别报告图像。
- 不属于本轮修改范围。

## 4. `imageDryRun` 字段含义

无图片输入时：

```json
{
  "imageDryRun": {
    "received": false,
    "actualRecognitionCalled": false,
    "recognitionStatus": "no_image_input"
  }
}
```

有图片输入时：

```json
{
  "imageDryRun": {
    "received": true,
    "fileName": "sample.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 123456,
    "base64Length": 456789,
    "actualRecognitionCalled": false,
    "recognitionStatus": "not_called_dryrun_only",
    "message": "已收到图片输入。本轮仅做 dry-run 接收校验，未调用真实 OCR/Vision。",
    "warnings": []
  }
}
```

字段说明：

- `received`：是否收到图片输入。
- `fileName`：请求传入的文件名。
- `mimeType`：请求传入的图片类型。
- `sizeBytes`：请求传入的原始文件大小。
- `base64Length`：base64 内容长度，不包含 data URL 前缀。
- `actualRecognitionCalled`：固定为 `false`，表示未调用真实识别。
- `recognitionStatus`：dry-run 状态。
- `warnings`：格式或大小提示，不阻断 dry-run。

## 5. 为什么不打印完整 base64

完整 base64 可能非常长，也可能包含用户上传的原始报告图像信息。

因此本轮只返回：

- 是否收到图片
- 文件名
- 类型
- 大小
- base64 长度

不会返回：

- 完整 `imageBase64`
- base64 payload 片段
- 图片内容识别结果

## 6. 如何测试

在项目目录运行：

```bash
cd /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding

node scripts/test-report-upload-p0.js
node scripts/test-report-upload-p0-image-dryrun.js
PENGKAIPING_V01_P0_ENABLED=true node scripts/test-pengkaiping-p0-assets.js
node scripts/export-report-upload-p0-visible-output.js
```

测试覆盖：

- 无图片输入时原 P0 dry-run 仍通过。
- JSON 带 `imageInput` 时返回 `imageDryRun.received=true`。
- `imageBase64` 不出现在响应和用户可见输出中。
- `actualRecognitionCalled=false`。
- 非推荐图片格式只 warning，不崩溃。
- 大文件只 warning，不崩溃。
- multipart 请求返回明确错误。
- 彭凯平 v01 feature flag 灰度测试不受影响。

## 7. 下一步如果要接真实识别，应该如何设计

建议不要把真实 OCR / Vision 混入 `/api/report-upload-p0`。

更稳的设计：

1. 保持 `/api/extract-fp` 作为真实识别入口。
2. 在 `/api/extract-fp` 增加更清晰的错误码：
   - `image_missing`
   - `image_too_large`
   - `unsupported_image_type`
   - `vision_env_missing`
   - `vision_empty_response`
   - `vision_parse_failed`
   - `vision_provider_error`
3. 前端根据错误码显示更具体的提示。
4. P0 dry-run 只接收识别后的结构化文本或图片接收元信息。
5. 若未来需要 multipart 上传，应新增独立图片上传接口，不把 multipart 解析放进 P0 报告 dry-run 主接口。
6. 上线前必须加 feature flag、日志脱敏、大小限制、格式限制和人工兜底。
