const { Readable } = require('stream');
const handler = require('../lib/report-upload-p0-dryrun.js');

process.env.PENGKAIPING_V01_P0_ENABLED = 'false';

function mockJsonReq(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function mockMultipartReq() {
  const req = Readable.from(['--boundary\r\nContent-Disposition: form-data; name="file"; filename="sample.jpg"\r\nContent-Type: image/jpeg\r\n\r\nfake\r\n--boundary--']);
  req.method = 'POST';
  req.headers = { 'content-type': 'multipart/form-data; boundary=boundary' };
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function callApi(req) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

function assertCase(condition, message) {
  if (!condition) throw new Error(message);
}

function basePayload(extra = {}) {
  return {
    reportText: '这是一份普通个人报告，用户想快速读懂自己的优势和需要观察的地方。',
    reportType: 'personal',
    userIdentity: 'self',
    userIntent: 'quick_reading',
    reportSubject: 'self',
    subjectAge: 32,
    subjectRelation: 'self',
    consentConfirmed: true,
    ...extra,
  };
}

function userVisibleText(response) {
  const output = response.userVisibleOutput || {};
  return JSON.stringify({
    title: output.title,
    subtitle: output.subtitle,
    sections: output.sections,
    cta: output.cta,
    safetyNotice: output.safetyNotice,
  });
}

async function testNoImageInput() {
  const res = await callApi(mockJsonReq(basePayload()));
  const response = res.payload;
  assertCase(res.statusCode === 200, 'no image should return 200');
  assertCase(response.ok === true, 'no image response should be ok');
  assertCase(response.imageInput.received === false, 'imageInput.received should be false');
  assertCase(response.imageDryRun.received === false, 'imageDryRun.received should be false');
  assertCase(response.imageDryRun.actualRecognitionCalled === false, 'recognition must not be called');
  assertCase(response.imageDryRun.recognitionStatus === 'no_image_input', 'status should be no_image_input');
}

async function testImageInputReceived() {
  const marker = 'data:image/jpeg;base64,AAAABBBBCCCC';
  const res = await callApi(mockJsonReq(basePayload({
    imageInput: {
      fileName: 'sample.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 123456,
      imageBase64: marker,
    },
  })));
  const response = res.payload;
  const serialized = JSON.stringify(response);
  assertCase(res.statusCode === 200, 'image input should return 200');
  assertCase(response.imageInput.received === true, 'imageInput.received should be true');
  assertCase(response.imageDryRun.received === true, 'imageDryRun.received should be true');
  assertCase(response.imageDryRun.fileName === 'sample.jpg', 'fileName should be preserved');
  assertCase(response.imageDryRun.mimeType === 'image/jpeg', 'mimeType should be preserved');
  assertCase(response.imageDryRun.sizeBytes === 123456, 'sizeBytes should be preserved');
  assertCase(response.imageDryRun.base64Length === 'AAAABBBBCCCC'.length, 'base64Length should exclude data URL prefix');
  assertCase(response.imageDryRun.actualRecognitionCalled === false, 'recognition must not be called');
  assertCase(response.imageDryRun.recognitionStatus === 'not_called_dryrun_only', 'status should be dry-run only');
  assertCase(!serialized.includes(marker), 'full imageBase64 must not be returned');
  assertCase(!serialized.includes('AAAABBBBCCCC'), 'base64 payload must not be returned');
  assertCase(!userVisibleText(response).includes('AAAABBBBCCCC'), 'base64 must not appear in visible output');
}

async function testUnsupportedMimeWarning() {
  const res = await callApi(mockJsonReq(basePayload({
    imageInput: {
      fileName: 'sample.gif',
      mimeType: 'image/gif',
      sizeBytes: 1000,
      imageBase64: 'R0lGODlh',
    },
  })));
  const warnings = res.payload.imageDryRun.warnings || [];
  assertCase(res.statusCode === 200, 'unsupported mime should not crash');
  assertCase(warnings.some(warning => warning.code === 'unsupported_mime_type'), 'unsupported mime should warn');
  assertCase(res.payload.imageDryRun.actualRecognitionCalled === false, 'unsupported mime must not call recognition');
}

async function testLargeImageWarning() {
  const res = await callApi(mockJsonReq(basePayload({
    imageInput: {
      fileName: 'large.png',
      mimeType: 'image/png',
      sizeBytes: 11 * 1024 * 1024,
      imageBase64: 'AAAA',
    },
  })));
  const warnings = res.payload.imageDryRun.warnings || [];
  assertCase(res.statusCode === 200, 'large image should not crash');
  assertCase(warnings.some(warning => warning.code === 'image_size_over_10mb'), 'large image should warn');
  assertCase(res.payload.imageDryRun.actualRecognitionCalled === false, 'large image must not call recognition');
}

async function testMultipartUnsupportedMessage() {
  const res = await callApi(mockMultipartReq());
  assertCase(res.statusCode === 415, 'multipart should return 415');
  assertCase(res.payload.ok === false, 'multipart response should not be ok');
  assertCase(res.payload.error.includes('只支持 JSON dry-run 图片元信息'), 'multipart error should explain JSON-only dry-run');
  assertCase(res.payload.error.includes('/api/extract-fp'), 'multipart error should point to extract-fp for real recognition');
  assertCase(res.payload.imageDryRun.actualRecognitionCalled === false, 'multipart must not call recognition');
  assertCase(res.payload.imageDryRun.recognitionStatus === 'multipart_not_supported', 'multipart status should be explicit');
}

async function run() {
  const tests = [
    ['no_image_input', testNoImageInput],
    ['image_input_received', testImageInputReceived],
    ['unsupported_mime_warning', testUnsupportedMimeWarning],
    ['large_image_warning', testLargeImageWarning],
    ['multipart_unsupported_message', testMultipartUnsupportedMessage],
  ];
  const failed = [];

  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed.push({ name, error: error.message });
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }

  const summary = {
    total: tests.length,
    passed: tests.length - failed.length,
    failed: failed.length,
    failedCases: failed,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

run().catch(error => {
  console.error(`FAIL test_runner: ${error.message}`);
  process.exitCode = 1;
});
