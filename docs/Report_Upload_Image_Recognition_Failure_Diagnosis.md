# AIPIWEN 报告上传图片识别失败诊断报告

处理日期：2026-07-03

本轮范围：只做本地只读排查与诊断报告，不修改功能代码，不 deploy，不上线，不修改线上配置。

## 1. 复现路径

页面地址：

- 本地预览入口：`http://localhost:3000/report-upload.html`
- 本次本地复现时，`3000` 和 `3001` 已被占用，`vercel dev --listen 3000` 实际启动在 `http://localhost:3002`

上传入口：

- 页面中的图片上传按钮绑定到 `#file-gallery`
- 拍照入口绑定到 `#file-camera`
- 二者都只读取单张图片：`e.target.files[0]`

用户操作步骤：

1. 打开 `report-upload.html`
2. 选择相册图片或拍照上传
3. 页面用浏览器端 canvas 压缩图片
4. 点击“识别数据”
5. 前端把压缩后的 base64 JSON 发给 `/api/extract-fp`
6. 识别成功后才进入后续报告上传 / P0 dry-run 流程

失败表现：

- 如果 `/api/extract-fp` 返回失败，页面会显示：
  - `识别失败，请重试`
  - `网络错误，请重试`
  - 或后端返回的具体错误，例如图片过大、缺少字段、无法读取数据等
- `/api/report-upload-p0` 不是图片识别入口。把图片 multipart 直接发给 `/api/report-upload-p0` 会失败。

本地命令复现结果：

```bash
curl -s -i http://localhost:3002/api/report-upload-p0 \
  -F 'file=@/tmp/aipiwen-test-upload.jpg;type=image/jpeg' \
  -F 'reportText=hello'
```

返回：

```text
HTTP/1.1 400 Bad Request
{"ok":false,"stage":"read_json","error":"请求格式错误"}
```

说明：`/api/report-upload-p0` 只按 JSON 读取请求体，不能解析 multipart/form-data。

另一个检查：

```bash
curl -s -i http://localhost:3002/api/extract-fp \
  -H 'Content-Type: application/json' \
  --data '{}'
```

返回：

```text
HTTP/1.1 400 Bad Request
{"ok":false,"error":"缺少 imageBase64 字段"}
```

说明：真实图片识别入口是 `/api/extract-fp`，且它期望收到 JSON 字段 `imageBase64`。

## 2. 前端上传链路检查

相关文件：`report-upload.html`

文件输入字段：

- `#file-gallery`
  - 类型：`<input type="file">`
  - accept：`image/*`
  - 用途：从相册选择图片
- `#file-camera`
  - 类型：`<input type="file">`
  - accept：`image/*`
  - capture：`environment`
  - 用途：调用后置摄像头拍照

是否支持多图：

- 不支持。
- 当前只处理 `files[0]`，页面状态中也只有一份 `ST.imageBase64`。

是否限制格式：

- 前端检查 `file.type.startsWith('image/')`。
- 没有进一步限制 jpg/png/heic/webp 等具体格式。
- 但压缩输出会统一转为 JPEG base64。

是否限制大小：

- 前端没有显式文件大小上限。
- 图片会被 canvas 压缩到最长边约 1200px、JPEG quality 0.75。
- 后端 `/api/extract-fp` 对 JSON body 有大小限制，超过限制会返回 413。

submit 时是否进入 FormData：

- 没有。
- 前端没有把图片作为 `multipart/form-data` 文件上传。
- 图片通过 `FileReader + Image + canvas` 转成 base64，然后放入 JSON。

传给 API 的字段名：

- 传给 `/api/extract-fp`：
  - `imageBase64`
  - `imageMimeType`
- 传给 `/api/report-upload-p0`：
  - 不传图片
  - 只传 P0 dry-run 所需的结构化文本、年龄、关注点、规则结果等

判断：

- 前端图片上传链路本身不是 multipart 文件上传，而是“浏览器端压缩 + base64 JSON 识别”。
- 如果用户以为 `/api/report-upload-p0` 会接收图片，这是链路理解不一致。

## 3. API 接收链路检查

### `/api/report-upload-p0.js`

相关文件：

- `api/report-upload-p0.js`
- `lib/report-upload-p0-dryrun.js`

检查结论：

- `api/report-upload-p0.js` 只是转发到 `lib/report-upload-p0-dryrun.js`
- `lib/report-upload-p0-dryrun.js` 明确是 dry-run 模块
- 它只接受 JSON
- 它不处理 multipart uploads
- 它不调用 AI
- 它不做 OCR / Vision
- 它不读写数据库

是否接收图片：

- 否。

是否解析 multipart/form-data：

- 否。

是否依赖 bodyParser：

- 不是 Express bodyParser 链路。
- 当前模块自行读取 raw request body，再执行 `JSON.parse`。

是否能拿到文件 buffer：

- 否。
- multipart 请求会被当作普通文本尝试 JSON parse，最终返回 `请求格式错误`。

原因：

- `/api/report-upload-p0` 的设计目标是 P0 dry-run 报告输出，不是图片识别。
- 当前函数没有 formidable / busboy / multer 等 multipart parser，也没有文件 buffer/path 处理逻辑。

### `/api/extract-fp.js`

相关文件：

- `api/extract-fp.js`
- `api/_lib.js`

检查结论：

- 这是当前真实图片识别入口。
- 它接收 JSON：`{ imageBase64, imageMimeType }`
- 它不接收 multipart file。
- 它调用视觉模型识别掌纹/指纹报告表格内容。

是否能拿到文件 buffer：

- 不拿 buffer。
- 它拿到的是 base64 字符串。

图片过大处理：

- 请求体超过限制会返回 413。
- 错误文案提示图片过大，建议压缩后再试。

字段名不匹配处理：

- 缺少 `imageBase64` 时返回 400：`缺少 imageBase64 字段`

## 4. 图片识别逻辑检查

当前是否有真实 OCR / Vision 识别逻辑：

- 有，但只在 `/api/extract-fp.js`。
- 没有在 `/api/report-upload-p0.js`。

当前真实识别方式：

- 前端上传图片后转成 base64。
- `/api/extract-fp.js` 把 base64 图片和识别 prompt 发给视觉模型。
- `api/_lib.js` 中当前深度模型配置为 `qwen-vl-max`。
- 该链路依赖 DashScope 视觉模型能力。

是否只是 dry-run 模拟：

- `/api/report-upload-p0` 是 dry-run 模拟，不具备图片识别能力。
- `/api/extract-fp` 是真实识别入口。

如果用户反馈发生在“识别数据”按钮：

- 应重点看 `/api/extract-fp` 返回的错误。
- 常见原因包括：
  - 图片没有成功转成 `imageBase64`
  - 请求体过大
  - 图片不是总表页或内容不清晰
  - 视觉模型返回空内容
  - 视觉模型输出无法解析为 JSON
  - 本地缺少视觉模型 API 环境变量
  - 外部视觉模型调用失败

如果用户反馈发生在“生成 P0 报告 / report-upload-p0”阶段：

- 根因是 `/api/report-upload-p0` 本来不接收图片、不做识别。
- 这不是 OCR bug，而是能力边界未接入。

## 5. 环境依赖检查

`package.json`：

- 项目根目录未发现 `package.json`。
- 当前项目不是通过本地 npm 依赖来完成 OCR。

是否有 OCR / image parser 依赖：

- 未发现 `sharp`
- 未发现 `multer`
- 未发现 `formidable`
- 未发现 `busboy`
- 未发现 `tesseract`

当前依赖方式：

- 浏览器端 canvas 做图片压缩。
- 后端 `/api/extract-fp` 调外部视觉模型。

是否需要环境变量或 API key：

- 是。
- 真实识别依赖 DashScope / 视觉模型调用所需的环境变量。
- 本报告不打印、不检查、不暴露任何密钥值。

是否有文件大小限制：

- `/api/extract-fp` 对请求体大小有限制，超过会返回 413。
- `/api/report-upload-p0` JSON body 限制约 512KB，不适合承载图片 base64。

是否因为 Vercel dev / Node 环境不支持当前解析方式：

- 对 `/api/report-upload-p0`：是，它没有 multipart 解析逻辑，因此 multipart 文件上传必然失败。
- 对 `/api/extract-fp`：不是 multipart 解析问题，它按 JSON base64 设计；需要检查 base64 体积、视觉模型可用性和返回格式。

## 6. 根因判断

根因分类：

- B. API 没有正确解析文件
- C. dry-run 本来没有真实图片识别能力
- D. OCR / Vision 依赖可能缺失或调用失败
- E. 图片格式 / 大小 / 字段名不匹配可能导致 `/api/extract-fp` 失败

更精确判断：

1. `/api/report-upload-p0` 图片识别失败不是 bug，而是能力边界：它是 JSON-only dry-run，不接图片、不识图。
2. 页面真实图片识别链路是 `/api/extract-fp`，不是 `/api/report-upload-p0`。
3. 前端会把图片转成 base64 JSON，不会把文件以 multipart 形式传给 report-upload-p0。
4. 如果页面点击“识别数据”失败，下一步应抓 `/api/extract-fp` 的具体返回错误和后端日志。
5. 如果后续 P0 报告链路期望复用图片信息，当前 P0 payload 里没有图片接收或图片元信息字段。

## 7. 最小修复方案

### 方案 1：最小本地 dry-run 修复

目标：

- 先确认页面能接收图片，并在 dry-run 中显示“已收到图片 + 文件名 + 大小 + 类型”。
- 不做真实 OCR。
- 不假装已经识别图片。
- 不改变线上正式行为。

建议实现：

1. 在前端 `handleFile(file)` 后保留图片元信息：
   - `file.name`
   - `file.type`
   - `file.size`
   - 压缩后 base64 长度
   - `imageMimeType`
2. 新增或复用一个本地 dry-run 接口，只接收 JSON，不接真实 multipart：
   - 推荐新增：`/api/report-upload-image-dryrun`
   - 请求字段：`{ fileName, fileType, fileSize, imageMimeType, imageBase64Length }`
   - 响应字段：`{ ok: true, received: true, fileName, fileType, fileSize, imageMimeType, imageBase64Length }`
3. 页面在本地调试模式下显示：
   - 已收到图片
   - 文件名
   - 文件类型
   - 原始大小
   - 压缩后大小或 base64 长度
4. 不调用 OCR / Vision。
5. 不修改 `/api/report-upload-p0` 的正式输出逻辑。

验收方式：

- 上传一张 jpg/png 图片。
- 页面显示“已收到图片”。
- dry-run 返回文件名、类型、大小。
- 不出现“已识别掌纹/指纹数据”等误导性文案。
- `/api/report-upload-p0` 仍保持 JSON-only dry-run。

### 方案 2：真实识别接入方案

目标：

- 后续再增强真实 OCR / Vision 识别。
- 本轮不直接做。

建议实现：

1. 保持 `/api/extract-fp` 作为唯一真实图片识别入口。
2. 增加更清晰的错误分类：
   - image_missing
   - image_too_large
   - unsupported_image_type
   - vision_env_missing
   - vision_empty_response
   - vision_parse_failed
   - vision_provider_error
3. 前端根据错误分类显示更具体的用户提示。
4. 增加图片压缩前后的大小显示。
5. 增加本地诊断日志 ID，方便前后端对齐。
6. 如果后续需要 multipart 上传，再单独引入 busboy/formidable，并明确只用于图片上传接口，不混入 P0 dry-run 报告接口。
7. 接入真实 OCR / Vision 前必须确认：
   - 环境变量配置完整
   - 模型支持当前图片格式
   - 请求体大小满足 Vercel 限制
   - 识别失败时有 fallback，不阻断用户手动输入

## 8. 建议下一步 Codex 指令

建议下一步先做“图片接收 dry-run 修复”，不要直接接真实 OCR。

可执行指令：

```text
请在 /Users/gyl0322gmail.com/AI-CEO-System/aipiwen-ai-understanding 中做最小图片接收 dry-run 修复。

边界：
1. 不 deploy。
2. 不上线。
3. 不修改线上配置。
4. 不接真实 OCR / Vision。
5. 不修改 Report OS 正式输出逻辑。
6. 不修改 PENGKAIPING_V01_P0_ENABLED 默认值。
7. 不假装已经识别图片。

目标：
1. report-upload.html 上传图片后，保留并展示图片接收元信息。
2. 新增本地 dry-run 接口 /api/report-upload-image-dryrun，接收 JSON 图片元信息。
3. 返回“已收到图片”的结构化结果：文件名、类型、大小、压缩后 base64 长度。
4. 增加最小测试，验证非图片、缺字段、正常图片元信息三种情况。
5. 不改 /api/report-upload-p0.js 的正式 dry-run 输出逻辑。
```

## 9. 本轮结论

是否前端上传成功：

- 前端具备上传并压缩单张图片的能力。
- 它不是 multipart 上传，而是 base64 JSON 上传。
- 图片只发给 `/api/extract-fp`，不发给 `/api/report-upload-p0`。

是否 API 收到文件：

- `/api/report-upload-p0` 收不到文件，也不支持 multipart。
- `/api/extract-fp` 可以接收 base64 JSON 图片字段，但本轮没有调用真实视觉识别。

是否有真实 OCR / Vision：

- 有，位置是 `/api/extract-fp`。
- `/api/report-upload-p0` 没有真实 OCR / Vision。

最小修复建议：

- 先做本地“图片接收 dry-run 修复”，让页面清楚显示图片已被接收、压缩和传递的元信息。
- 等 Emma 确认链路后，再进入真实 OCR / Vision 错误分类和识别稳定性修复。

是否建议下一步先做“图片接收 dry-run 修复”：

- 建议。
- 这是最小、安全、可验证的下一步，不会误伤 P0 报告输出链路，也不会把 dry-run 包装成真实识别。
