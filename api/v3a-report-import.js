/**
 * V3A advisor report import BFF.
 *
 * POST ?action=extract  multipart/form-data file=<JPEG|PNG>
 * POST ?action=confirm  application/json
 * GET  ?id=<report uuid>
 *
 * Advisor ownership is derived from the encrypted HttpOnly Session. The BFF
 * calls authenticated database RPCs with the session access token; the browser
 * never receives that token and never submits an advisor id.
 */

const crypto = require('crypto');
const TRCEngine = require('../lib/trc-engine');
const { callClaude, MODEL_FREE } = require('./_lib');
const interpretation = require('../server/v3a-interpretation');
const {
  HttpError,
  getConfig,
  setPrivateHeaders,
  requireSameOrigin,
  loadSession,
  resolveSession,
  requireCsrf,
  consumeRateLimit,
  readJson
} = require('../server/v3a-session-store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGER_KEYS = ['R1', 'R2', 'R3', 'R4', 'R5', 'L1', 'L2', 'L3', 'L4', 'L5'];
const VALID_SYMBOLS = new Set([
  'Ws', 'Wt', 'We', 'Wsp', 'Wsr', 'Wl', 'Wc', 'Wd', 'Wsc',
  'Wpe', 'Rpe', 'Rwl', 'Wi', 'Lu', 'Ls', 'Lf', 'Rl', 'X', 'Xn'
]);
const REPORT_TYPES = new Set(['儿童天赋报告', '成人发展报告', '学习通道报告']);
// Base64 forwarding to the existing 4MB JSON endpoint requires headroom.
const MAX_FILE_BYTES = Math.floor(2.5 * 1024 * 1024);
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MAX_JSON_BYTES = 20 * 1024;
const MAX_INTERPRETATION_JSON_BYTES = 72 * 1024;
const MAX_GENERATED_REPORT_BYTES = 1500 * 1024;
const DETAILED_INTERPRETATION_VERSION = 3;
const COACHING_TYPES = new Set(['phone_follow_up', 'deep_coaching', 'initial_interpretation', 'emergency', 'daily_follow_up']);
const COACHING_SESSION_TYPES = new Set(['pre_call', 'post_call', 'free']);
const UNSAFE_COACHING_OUTPUT = /(?:患有|确诊|必然|注定|保证|一定会|命中注定|未来(?:一定|必然|将会)|智商(?:很高|很低|高|低)|优于(?:别人|他人|同龄人)|劣于(?:别人|他人|同龄人)|天生就是)/i;

const RPC_ERROR_STATUS = new Map([
  ['REPORT_IMPORT_FORBIDDEN', 403],
  ['INVALID_IDEMPOTENCY_KEY', 400],
  ['IDEMPOTENCY_KEY_CONFLICT', 409],
  ['IDEMPOTENCY_PAYLOAD_MISMATCH', 409],
  ['AMBIGUOUS_CLIENT', 400],
  ['INVALID_STRUCTURED_INPUT', 400],
  ['INVALID_REPORT_AGE', 400],
  ['CLIENT_NOT_FOUND', 404],
  ['INVALID_CLIENT_NAME', 400],
  ['INVALID_BIRTH_DATE', 400],
  ['INVALID_CLIENT_NOTE', 400],
  ['REPORT_NOT_FOUND', 404],
  ['INVALID_REPORT_TRANSITION', 409],
  ['INVALID_GENERATED_REPORT', 502],
  ['INVALID_ERROR_CODE', 500],
  ['INTERPRETATION_FORBIDDEN', 403],
  ['INTERPRETATION_REPORT_NOT_READY', 409],
  ['INVALID_INTERPRETATION_DATA', 400]
]);

function normalize(value) {
  return String(value ?? '').trim();
}

function isUuid(value) {
  return UUID_PATTERN.test(normalize(value));
}

function restUrl(config, table, params) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function sessionHeaders(config, session) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.record.accessToken}`,
    Accept: 'application/json'
  };
}

async function selectRows(config, session, table, params, message) {
  let response;
  try {
    response = await fetch(restUrl(config, table, params), {
      method: 'GET',
      headers: sessionHeaders(config, session)
    });
  } catch {
    throw new HttpError(502, message, 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(502, message, 'DATA_UPSTREAM_ERROR');
  const payload = await readJson(response);
  return Array.isArray(payload) ? payload : [];
}

async function requireActiveAdvisor(config, req, csrfRequired) {
  const loaded = await loadSession(req, config);
  if (csrfRequired) requireCsrf(req, loaded);
  const session = await resolveSession(config, loaded);
  const users = await selectRows(config, session, 'users', {
    select: 'id,role,status',
    auth_user_id: `eq.${session.user.id}`,
    limit: 1
  }, '账号信息暂时无法读取。');
  const user = users[0];
  if (!user || user.role !== 'advisor' || user.status !== 'active') {
    throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
  }
  return { session, advisorUserId: user.id };
}

async function readRawBody(req, limit) {
  const declared = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, '请求内容过大。', 'REQUEST_TOO_LARGE');
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > limit) throw new HttpError(413, '请求内容过大。', 'REQUEST_TOO_LARGE');
    return req.body;
  }
  if (typeof req.body === 'string') {
    const body = Buffer.from(req.body);
    if (body.length > limit) throw new HttpError(413, '请求内容过大。', 'REQUEST_TOO_LARGE');
    return body;
  }
  if (req.body && typeof req.body === 'object') {
    const body = Buffer.from(JSON.stringify(req.body));
    if (body.length > limit) throw new HttpError(413, '请求内容过大。', 'REQUEST_TOO_LARGE');
    return body;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, '请求内容过大。', 'REQUEST_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(new HttpError(400, '请求内容无法读取。', 'INVALID_REQUEST_BODY')));
  });
}

async function readJsonBody(req, limit = MAX_JSON_BYTES) {
  const contentType = normalize(req.headers?.['content-type']).toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, '请求格式无效。', 'JSON_REQUIRED');
  }
  const raw = await readRawBody(req, limit);
  try {
    const body = JSON.parse(raw.toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid');
    return body;
  } catch {
    throw new HttpError(400, '请求内容无效。', 'INVALID_REQUEST_BODY');
  }
}

function parseMultipartFile(raw, contentType) {
  const match = String(contentType).match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] || match?.[2] || '';
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw new HttpError(400, '文件格式无效。', 'INVALID_MULTIPART');
  }
  const marker = Buffer.from(`--${boundary}`);
  let cursor = 0;
  while (cursor < raw.length) {
    const markerStart = raw.indexOf(marker, cursor);
    if (markerStart < 0) break;
    const headersStart = markerStart + marker.length + 2;
    const headersEnd = raw.indexOf(Buffer.from('\r\n\r\n'), headersStart);
    if (headersEnd < 0) break;
    const nextMarker = raw.indexOf(marker, headersEnd + 4);
    if (nextMarker < 0) break;
    const headers = raw.slice(headersStart, headersEnd).toString('utf8');
    if (/content-disposition:\s*form-data;[^\r\n]*name="file"/i.test(headers)) {
      let file = raw.slice(headersEnd + 4, nextMarker);
      if (file.length >= 2 && file[file.length - 2] === 13 && file[file.length - 1] === 10) {
        file = file.slice(0, -2);
      }
      if (file.length === 0) throw new HttpError(400, '请选择要上传的图片。', 'MISSING_FILE');
      if (file.length > MAX_FILE_BYTES) throw new HttpError(413, '图片文件不能超过 2.5MB。', 'FILE_TOO_LARGE');
      const jpeg = file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
      const png = file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47;
      if (!jpeg && !png) {
        throw new HttpError(400, '仅支持 JPG、JPEG、PNG 格式的图片。', 'INVALID_IMAGE_FORMAT');
      }
      return { file, mimeType: jpeg ? 'image/jpeg' : 'image/png' };
    }
    cursor = nextMarker + marker.length;
  }
  throw new HttpError(400, '请选择要上传的图片。', 'MISSING_FILE');
}

function validateFingers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, '十指数据格式无效。', 'INVALID_FINGERS');
  }
  const result = {};
  let totalTrc = 0;
  for (const key of FINGER_KEYS) {
    const entry = value[key];
    const sym = normalize(entry?.sym);
    const trc = Number(entry?.trc);
    if (!VALID_SYMBOLS.has(sym) || !Number.isInteger(trc) || trc < 0 || trc > 40) {
      throw new HttpError(400, `请核对 ${key} 的纹型和 TRC。`, 'INVALID_FINGERS');
    }
    result[key] = { sym, trc };
    totalTrc += trc;
  }
  if (Object.keys(value).length !== FINGER_KEYS.length || totalTrc <= 0) {
    throw new HttpError(400, '十指数据不完整。', 'INVALID_FINGERS');
  }
  return result;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
}

function ageFromBirthDate(value) {
  if (!value) return null;
  const birth = new Date(`${value}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return Math.max(0, age);
}

function validateConfirmBody(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'advisor_id') ||
      Object.prototype.hasOwnProperty.call(body, 'advisorId')) {
    throw new HttpError(400, '请求内容无效。', 'ADVISOR_ID_NOT_ALLOWED');
  }
  const idempotencyKey = normalize(body.idempotencyKey);
  if (!isUuid(idempotencyKey)) {
    throw new HttpError(400, '提交标识无效，请刷新后重试。', 'INVALID_IDEMPOTENCY_KEY');
  }
  const existingClientId = normalize(body.existingClientId);
  const hasExisting = Boolean(existingClientId);
  const hasNew = Boolean(body.newClient && typeof body.newClient === 'object' && !Array.isArray(body.newClient));
  if (hasExisting === hasNew) {
    throw new HttpError(400, '请选择已有客户或新建客户，不能同时操作。', 'AMBIGUOUS_CLIENT');
  }
  if (hasExisting && !isUuid(existingClientId)) {
    throw new HttpError(400, '客户标识无效。', 'INVALID_CLIENT_ID');
  }

  let newClient = null;
  if (hasNew) {
    const displayName = normalize(body.newClient.displayName);
    const birthDate = normalize(body.newClient.birthDate);
    const note = normalize(body.newClient.note);
    if (!displayName || displayName.length > 40) {
      throw new HttpError(400, '请填写有效的客户称呼（1-40 字）。', 'INVALID_CLIENT_NAME');
    }
    if (birthDate && !validIsoDate(birthDate)) {
      throw new HttpError(400, '出生日期无效。', 'INVALID_BIRTH_DATE');
    }
    if (note.length > 200) throw new HttpError(400, '备注不能超过 200 字。', 'INVALID_CLIENT_NOTE');
    newClient = { displayName, birthDate: birthDate || null, note: note || null };
  }

  if (body.dataConfirmed !== true) {
    throw new HttpError(400, '请先核对并确认识别数据。', 'DATA_NOT_CONFIRMED');
  }
  const reportType = normalize(body.reportType);
  if (!REPORT_TYPES.has(reportType)) {
    throw new HttpError(400, '请选择有效的报告类型。', 'INVALID_REPORT_TYPE');
  }
  const selectedIssues = Array.isArray(body.selectedIssues)
    ? [...new Set(body.selectedIssues.map(normalize).filter(Boolean))]
    : [];
  if (selectedIssues.length < 1 || selectedIssues.length > 4 || selectedIssues.some((item) => item.length > 80)) {
    throw new HttpError(400, '请选择 1-4 个有效的关注问题。', 'INVALID_SELECTED_ISSUES');
  }
  const customIssue = normalize(body.customIssue);
  if (customIssue.length > 200) {
    throw new HttpError(400, '补充问题不能超过 200 字。', 'INVALID_CUSTOM_ISSUE');
  }
  const extracted = body.extractedData || {};
  const fingers = validateFingers(extracted.fingers);
  const atd = extracted.atd === null || extracted.atd === '' || extracted.atd === undefined
    ? null
    : Number(extracted.atd);
  if (atd !== null && (!Number.isFinite(atd) || atd < 0 || atd > 90)) {
    throw new HttpError(400, 'ATD 数值无效。', 'INVALID_ATD');
  }
  const extractedAge = extracted.age === null || extracted.age === '' || extracted.age === undefined
    ? null
    : Number(extracted.age);
  if (extractedAge !== null && (!Number.isInteger(extractedAge) || extractedAge < 0 || extractedAge > 120)) {
    throw new HttpError(400, '年龄数值无效。', 'INVALID_REPORT_AGE');
  }
  const extractedName = normalize(extracted.name).slice(0, 40) || null;
  return {
    idempotencyKey,
    existingClientId: existingClientId || null,
    newClient,
    reportType,
    selectedIssues,
    customIssue: customIssue || null,
    extractedData: { fingers, atd, age: extractedAge, name: extractedName }
  };
}

function internalOrigin(config) {
  const deploymentHost = normalize(process.env.VERCEL_URL).toLowerCase();
  if (deploymentHost && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(deploymentHost) && !deploymentHost.includes('..')) {
    return `https://${deploymentHost}`;
  }
  return new URL(config.allowedOrigin).origin;
}

async function callRpc(config, session, name, body) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        ...sessionHeaders(config, session),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, '报告数据服务暂时不可用。', 'DATA_UPSTREAM_UNAVAILABLE');
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const safeCode = normalize(payload?.message);
    const status = RPC_ERROR_STATUS.get(safeCode) || 502;
    throw new HttpError(status, status === 404 ? '未找到相关客户或报告。' : '报告数据暂时无法处理。',
      RPC_ERROR_STATUS.has(safeCode) ? safeCode : 'DATA_UPSTREAM_ERROR');
  }
  return payload;
}

async function callExtract(config, advisorUserId, file, mimeType) {
  const advisorHash = crypto.createHash('sha256').update(advisorUserId).digest('hex').slice(0, 24);
  let response;
  try {
    response = await fetch(`${internalOrigin(config)}/api/extract-fp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': `v3a-${advisorHash}`
      },
      body: JSON.stringify({ imageBase64: file.toString('base64'), imageMimeType: mimeType })
    });
  } catch {
    throw new HttpError(502, '图片识别暂时不可用，请稍后重试。', 'EXTRACT_FAILED');
  }
  const payload = await readJson(response);
  if (!response.ok || payload?.ok !== true) {
    throw new HttpError(response.status === 429 ? 429 : 502,
      response.status === 429 ? '操作过于频繁，请稍后重试。' : '图片识别暂时不可用，请稍后重试。',
      response.status === 429 ? 'RATE_LIMITED' : 'EXTRACT_FAILED');
  }
  const fingers = validateFingers(payload.fingers);
  const age = payload.age == null ? null : Number(payload.age);
  const atd = payload.atd == null ? null : Number(payload.atd);
  return {
    fingers,
    atd: Number.isFinite(atd) && atd >= 0 && atd <= 90 ? atd : null,
    age: Number.isInteger(age) && age >= 0 && age <= 120 ? age : null,
    name: normalize(payload.name).slice(0, 40) || null
  };
}

function sanitizeGeneratedReport(payload, engineResult, fingers) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.sections) || payload.sections.length === 0) {
    throw new HttpError(502, '报告生成暂时不可用，请稍后重试。', 'REPORT_GENERATION_FAILED');
  }
  const result = {
    sections: payload.sections,
    engineResult,
    fingers,
    requiredModules: Array.isArray(payload.requiredModules) ? payload.requiredModules : [],
    degraded: payload.degraded === true,
    warning: normalize(payload.warning).slice(0, 200) || null
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_GENERATED_REPORT_BYTES) {
    throw new HttpError(502, '报告生成结果过大，请稍后重试。', 'REPORT_RESULT_TOO_LARGE');
  }
  return result;
}

async function generateReport(config, input, clientName, ageAtReport, advisorUserId) {
  const selectedIssues = input.customIssue
    ? [...input.selectedIssues, `补充说明：${input.customIssue}`]
    : input.selectedIssues;
  const advisorHash = crypto.createHash('sha256').update(advisorUserId).digest('hex').slice(0, 24);
  let response;
  try {
    response = await fetch(`${internalOrigin(config)}/api/generate-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': `v3a-${advisorHash}`
      },
      body: JSON.stringify({
        engineResult: input.engineResult,
        fingers: input.extractedData.fingers,
        age: ageAtReport,
        name: clientName,
        selectedIssues
      })
    });
  } catch {
    throw new HttpError(502, '报告生成暂时不可用，请稍后重试。', 'REPORT_GENERATION_FAILED');
  }
  const payload = await readJson(response);
  if (!response.ok) throw new HttpError(502, '报告生成暂时不可用，请稍后重试。', 'REPORT_GENERATION_FAILED');
  return sanitizeGeneratedReport(payload, input.engineResult, input.extractedData.fingers);
}

async function handleExtract(config, req, res, advisorUserId) {
  const contentType = normalize(req.headers?.['content-type']);
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, '请上传图片文件。', 'MULTIPART_REQUIRED');
  }
  const raw = await readRawBody(req, MAX_MULTIPART_BYTES);
  const { file, mimeType } = parseMultipartFile(raw, contentType);
  const data = await callExtract(config, advisorUserId, file, mimeType);
  return res.status(200).json({ ok: true, data });
}

async function handleConfirm(config, session, res, body, advisorUserId) {
  const input = validateConfirmBody(body);
  let ageAtReport = input.extractedData.age;
  if (input.newClient?.birthDate) ageAtReport = ageFromBirthDate(input.newClient.birthDate);
  if (input.existingClientId) {
    const clients = await selectRows(config, session, 'advisor_clients', {
      select: 'id,birth_date',
      id: `eq.${input.existingClientId}`,
      archived_at: 'is.null',
      limit: 1
    }, '客户信息暂时无法读取。');
    if (!clients[0]) throw new HttpError(404, '未找到相关客户。', 'CLIENT_NOT_FOUND');
    if (clients[0].birth_date) ageAtReport = ageFromBirthDate(clients[0].birth_date);
  }
  input.engineResult = TRCEngine.classify(input.extractedData.fingers, {
    atd: input.extractedData.atd,
    age: ageAtReport
  });
  const structuredInput = {
    fingers: input.extractedData.fingers,
    atd: input.extractedData.atd,
    extractedName: input.extractedData.name,
    extractedAge: input.extractedData.age,
    reportType: input.reportType,
    selectedIssues: input.selectedIssues,
    customIssue: input.customIssue,
    engineResult: input.engineResult
  };
  const created = await callRpc(config, session, 'v3a_create_advisor_report_import', {
    p_idempotency_key: input.idempotencyKey,
    p_existing_client_id: input.existingClientId,
    p_display_name: input.newClient?.displayName || null,
    p_birth_date: input.newClient?.birthDate || null,
    p_note: input.newClient?.note || null,
    p_structured_input: structuredInput,
    p_age_at_report: ageAtReport
  });
  if (!created?.reportId || !created?.clientId || !isUuid(created.reportId) || !isUuid(created.clientId)) {
    throw new HttpError(502, '报告数据暂时无法处理。', 'DATA_UPSTREAM_ERROR');
  }
  if (created.idempotent === true && created.retry !== true && ['ready', 'generating'].includes(created.status)) {
    return res.status(200).json({
      ok: true,
      client: { id: created.clientId, name: created.clientName },
      report: { id: created.reportId, idempotencyKey: input.idempotencyKey, status: created.status },
      idempotent: true
    });
  }

  try {
    const generatedReport = await generateReport(config, input, created.clientName, ageAtReport, advisorUserId);
    const completed = await callRpc(config, session, 'v3a_complete_advisor_report_import', {
      p_report_id: created.reportId,
      p_succeeded: true,
      p_generated_report: generatedReport,
      p_error_code: null
    });
    return res.status(200).json({
      ok: true,
      client: { id: created.clientId, name: created.clientName },
      report: { id: created.reportId, idempotencyKey: input.idempotencyKey, status: completed.status },
      idempotent: created.idempotent === true
    });
  } catch (error) {
    const failed = await callRpc(config, session, 'v3a_complete_advisor_report_import', {
      p_report_id: created.reportId,
      p_succeeded: false,
      p_generated_report: null,
      p_error_code: 'REPORT_GENERATION_FAILED'
    }).catch(() => null);
    return res.status(502).json({
      ok: false,
      error: '客户和报告记录已保存，但报告生成暂时失败，请稍后重试。',
      code: 'REPORT_GENERATION_FAILED',
      report: { id: created.reportId, status: failed?.status || 'generating' }
    });
  }
}

function interpretationHttpError(error) {
  const code = normalize(error?.code || error?.message);
  const mapping = {
    ADVISOR_ID_NOT_ALLOWED: [400, '请求中不得指定指导师。'],
    INVALID_REPORT_ID: [400, '报告标识无效。'],
    INVALID_CLIENT_ID: [400, '客户标识无效。'],
    INVALID_CLIENT_CONCERNS: [400, '客户关注问题格式无效。'],
    INVALID_CUSTOM_NOTES: [400, '补充说明不能超过 500 字。'],
    INVALID_INTERPRETATION_ID: [400, '解读方案标识无效。'],
    AI_OUTPUT_INVALID: [502, 'AI 解读方案格式异常，请稍后重试。'],
    UNSAFE_AI_OUTPUT: [502, 'AI 解读方案未通过安全检查，请稍后重试。']
  };
  const mapped = mapping[code];
  return mapped ? new HttpError(mapped[0], mapped[1], code) : error;
}

function publicReportData(report) {
  const structured = report?.structured_input && typeof report.structured_input === 'object'
    ? report.structured_input
    : {};
  return {
    reportType: normalize(structured.reportType).slice(0, 60) || '报告',
    ageAtReport: Number.isInteger(report?.age_at_report) ? report.age_at_report : null,
    fingers: structured.fingers && typeof structured.fingers === 'object' ? structured.fingers : null,
    atd: Number.isFinite(Number(structured.atd)) ? Number(structured.atd) : null,
    engineResult: structured.engineResult && typeof structured.engineResult === 'object'
      ? structured.engineResult
      : {},
    selectedIssues: Array.isArray(structured.selectedIssues)
      ? structured.selectedIssues.map(normalize).filter(Boolean).slice(0, 6)
      : [],
    customIssue: normalize(structured.customIssue).slice(0, 200) || null
  };
}

function validateCoachingSuggestionBody(value) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (body.advisor_id || body.advisorId || body.advisor_user_id) {
    throw new HttpError(400, '请求中不得指定指导师。', 'ADVISOR_ID_NOT_ALLOWED');
  }
  const personId = normalize(body.person_id || body.personId);
  const topic = normalize(body.topic);
  const coachingType = normalize(body.coaching_type || body.coachingType);
  const sessionType = normalize(body.session_type || body.sessionType);
  if (!isUuid(personId) || topic.length < 2 || topic.length > 1000 || !COACHING_TYPES.has(coachingType) || !COACHING_SESSION_TYPES.has(sessionType)) {
    throw new HttpError(400, '辅导话题或类型无效。', 'INVALID_COACHING_REQUEST');
  }
  return { personId, topic, coachingType, sessionType };
}

function parseCoachingSuggestion(value) {
  let payload;
  try {
    payload = JSON.parse(normalize(value));
  } catch {
    throw new HttpError(502, 'AI 辅导建议格式异常，请稍后重试。', 'AI_COACHING_OUTPUT_INVALID');
  }
  const understanding = normalize(payload?.understanding);
  const direction = normalize(payload?.direction);
  const script = normalize(payload?.script);
  const risks = Array.isArray(payload?.risks) ? payload.risks.map((risk) => ({
    level: ['warning', 'tip'].includes(normalize(risk?.level)) ? normalize(risk.level) : 'warning',
    text: normalize(risk?.text)
  })).filter((risk) => risk.text).slice(0, 8) : [];
  const knowledgeRefs = Array.isArray(payload?.knowledge_refs)
    ? payload.knowledge_refs.map(normalize).filter((item) => /^[A-Z][A-Z0-9_-]{0,31}(?::v[0-9.]+)?$/.test(item)).slice(0, 12)
    : [];
  const allText = [understanding, direction, script, ...risks.map((risk) => risk.text)].join('\n');
  if (
    understanding.length < 20 || understanding.length > 2400 ||
    direction.length < 20 || direction.length > 2400 ||
    script.length < 20 || script.length > 4000 ||
    risks.length < 1 || risks.some((risk) => risk.text.length > 400) ||
    UNSAFE_COACHING_OUTPUT.test(allText)
  ) {
    throw new HttpError(502, 'AI 辅导建议未通过完整性与安全校验，请稍后重试。', 'AI_COACHING_OUTPUT_INVALID');
  }
  return { understanding, direction, script, risks, knowledgeRefs };
}

function compactCoachingContext(client, report, growthRecords) {
  const structured = report?.structured_input && typeof report.structured_input === 'object' ? report.structured_input : {};
  const generated = report?.generated_report && typeof report.generated_report === 'object' ? report.generated_report : {};
  const sections = Array.isArray(generated.sections)
    ? generated.sections.slice(0, 12).map((section) => ({
      title: normalize(section?.title).slice(0, 80),
      content: normalize(section?.content).slice(0, 700)
    }))
    : [];
  const context = {
    age: Number.isInteger(report?.age_at_report) ? report.age_at_report : null,
    reportType: normalize(structured.reportType).slice(0, 60),
    fingers: structured.fingers || null,
    atd: structured.atd ?? null,
    engineResult: structured.engineResult || {},
    selectedIssues: Array.isArray(structured.selectedIssues) ? structured.selectedIssues.slice(0, 8) : [],
    reportSections: sections,
    recentGrowth: growthRecords.slice(0, 8).map((record) => ({
      recordType: record.record_type,
      domainTags: record.domain_tags,
      changeDirection: record.change_direction,
      content: normalize(record.content).slice(0, 500),
      createdAt: record.created_at
    }))
  };
  const fullName = normalize(client?.display_name);
  let json = JSON.stringify(context);
  if (fullName) json = json.split(fullName).join('客户');
  return json.slice(0, 18000);
}

async function handleCoachingSuggestion(config, session, res, body, advisorUserId, dependencies = {}) {
  const input = validateCoachingSuggestionBody(body);
  const clients = await selectRows(config, session, 'advisor_clients', {
    select: 'id,display_name,birth_date',
    id: `eq.${input.personId}`,
    advisor_user_id: `eq.${advisorUserId}`,
    archived_at: 'is.null',
    limit: 1
  }, '客户信息暂时无法读取。');
  const client = clients[0];
  if (!client) throw new HttpError(404, '未找到该客户。', 'CLIENT_NOT_FOUND');
  const [reports, growthRecords] = await Promise.all([
    selectRows(config, session, 'advisor_reports', {
      select: 'id,status,structured_input,generated_report,age_at_report,created_at',
      advisor_client_id: `eq.${input.personId}`,
      status: 'eq.ready',
      order: 'created_at.desc',
      limit: 1
    }, '客户报告暂时无法读取。'),
    selectRows(config, session, 'growth_records', {
      select: 'record_type,domain_tags,change_direction,content,created_at',
      advisor_client_id: `eq.${input.personId}`,
      order: 'created_at.desc',
      limit: 8
    }, '成长记录暂时无法读取。')
  ]);
  if (!reports[0]) throw new HttpError(409, '客户暂无已生成报告，暂时不能生成辅导建议。', 'COACHING_REPORT_NOT_READY');

  const limit = dependencies.consumeRateLimit || consumeRateLimit;
  const generate = dependencies.callClaude || callClaude;
  await limit(config, 'v4-coaching-suggestion-advisor', advisorUserId, 20, 3600);
  const topic = input.topic.split(normalize(client.display_name)).join('客户');
  const system = [
    '你是AIPIWEN指导师的辅导准备助手。只提供沟通准备建议，不做诊断、治疗、未来预测或结果保证。',
    '所有判断必须以给定报告和成长记录为依据；资料不足时明确写“需要向家长确认”。',
    '输出严格 JSON 对象，字段为 understanding、direction、script、risks、knowledge_refs。',
    'understanding 说明当前状态与资料依据；direction 说明本次沟通目标与顺序；script 给可直接参考但需指导师确认的完整话术；risks 为至少2条 {level:"warning"|"tip",text}。',
    '不得输出客户姓名、手机号、验证码、Token、Cookie、Session 或任何内部ID。'
  ].join('\n');
  const user = [
    `辅导类型：${input.coachingType}`,
    `会话类型：${input.sessionType}`,
    `本次话题：${topic}`,
    `客户资料：${compactCoachingContext(client, reports[0], growthRecords)}`
  ].join('\n');
  let generated;
  try {
    generated = await generate({
      model: MODEL_FREE,
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 1800,
      timeoutMs: 50000,
      retries: 1,
      responseFormat: { type: 'json_object' }
    });
  } catch {
    throw new HttpError(502, 'AI 辅导建议暂时无法生成，请稍后重试。', 'AI_COACHING_UNAVAILABLE');
  }
  const suggestion = parseCoachingSuggestion(generated?.text);
  return res.status(200).json({
    ok: true,
    csrfToken: session.csrfToken,
    understanding: suggestion.understanding,
    direction: suggestion.direction,
    script: suggestion.script,
    risks: suggestion.risks,
    knowledge_refs: suggestion.knowledgeRefs,
    generated_at: new Date().toISOString()
  });
}

async function loadInterpretationContext(config, session, clientId, reportId) {
  if (!interpretation.isUuid(reportId)) throw new HttpError(400, '报告标识无效。', 'INVALID_REPORT_ID');
  if (!interpretation.isUuid(clientId)) throw new HttpError(400, '客户标识无效。', 'INVALID_CLIENT_ID');
  const reports = await selectRows(config, session, 'advisor_reports', {
    select: 'id,advisor_client_id,status,structured_input,generated_report,age_at_report,interpretation_data,created_at,updated_at',
    id: `eq.${reportId}`,
    advisor_client_id: `eq.${clientId}`,
    limit: 1
  }, '解读报告暂时无法读取。');
  const report = reports[0];
  if (!report) throw new HttpError(404, '未找到该客户报告。', 'REPORT_NOT_FOUND');
  if (report.status !== 'ready') {
    throw new HttpError(409, '报告尚未生成完成，暂时不能创建解读方案。', 'INTERPRETATION_REPORT_NOT_READY');
  }
  const clients = await selectRows(config, session, 'advisor_clients', {
    select: 'id,display_name,birth_date,created_at',
    id: `eq.${clientId}`,
    archived_at: 'is.null',
    limit: 1
  }, '客户信息暂时无法读取。');
  const client = clients[0];
  if (!client) throw new HttpError(404, '未找到该客户。', 'CLIENT_NOT_FOUND');
  return { report, client };
}

function reusableInterpretation(value) {
  if (!value || typeof value !== 'object' || !interpretation.isUuid(value.id)) return null;
  try {
    if (normalize(value.status) === 'edited') {
      return { ...value, steps: interpretation.validateSteps(value.steps) };
    }
    if (Number(value.version) < DETAILED_INTERPRETATION_VERSION) return null;
    return { ...value, steps: interpretation.validateDetailedSteps(value.steps) };
  } catch {
    return null;
  }
}

function interpretationResponse(context, session) {
  const stored = reusableInterpretation(context.report.interpretation_data);
  return {
    ok: true,
    csrfToken: session.csrfToken,
    client: {
      id: context.client.id,
      displayName: context.client.display_name,
      birthDate: context.client.birth_date
    },
    report: {
      id: context.report.id,
      ...publicReportData(context.report),
      createdAt: context.report.created_at,
      updatedAt: context.report.updated_at
    },
    interpretation: stored ? {
      id: stored.id,
      status: stored.status,
      steps: stored.steps,
      createdAt: stored.createdAt || null,
      updatedAt: stored.updatedAt || null
    } : null
  };
}

async function handleInterpretationGet(config, session, res, req) {
  const clientId = normalize(req.query?.clientId);
  const reportId = normalize(req.query?.reportId);
  const context = await loadInterpretationContext(config, session, clientId, reportId);
  return res.status(200).json(interpretationResponse(context, session));
}

async function handleInterpretationGenerate(config, session, res, body, advisorUserId, dependencies = {}) {
  let input;
  try {
    input = interpretation.validateGenerateBody(body);
  } catch (error) {
    throw interpretationHttpError(error);
  }
  const limit = dependencies.consumeRateLimit || consumeRateLimit;
  const generate = dependencies.callClaude || callClaude;
  const context = await loadInterpretationContext(config, session, input.clientId, input.reportId);
  const existing = reusableInterpretation(context.report.interpretation_data);
  if (existing) {
    return res.status(200).json({
      ...interpretationResponse(context, session),
      complete: true,
      reused: true
    });
  }

  const raw = context.report.interpretation_data;
  let completedSteps = [];
  let interpretationId = crypto.randomUUID();
  let createdAt = new Date().toISOString();
  let resumed = false;
  if (Number(raw?.version) === DETAILED_INTERPRETATION_VERSION
      && normalize(raw?.status) === 'generating'
      && interpretation.isUuid(raw?.id)) {
    try {
      completedSteps = interpretation.validateDetailedPrefix(raw.steps);
      interpretationId = raw.id;
      createdAt = normalize(raw.createdAt) || createdAt;
      resumed = true;
    } catch {}
  }
  if (!resumed) await limit(config, 'interpretation-generate-advisor', advisorUserId, 10, 3600);

  const stepIndexes = [completedSteps.length];

  let generatedSteps;
  try {
    const generationDeadline = Date.now() + 56500;
    generatedSteps = (await Promise.all(stepIndexes.map(async (stepIndex) => {
      const prompt = interpretation.buildPrompt(context.report, context.client, input, [stepIndex]);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await generate({
            model: MODEL_FREE,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            maxTokens: 2400,
            timeoutMs: Math.min(52000, generationDeadline - Date.now()),
            retries: 0,
            responseFormat: { type: 'json_object' }
          });
          if (['length', 'max_tokens'].includes(normalize(result?.finishReason).toLowerCase())) {
            const error = new Error('AI_OUTPUT_INVALID');
            error.code = 'AI_OUTPUT_INVALID';
            throw error;
          }
          return interpretation.parseModelText(result?.text, [stepIndex]);
        } catch (error) {
          const code = normalize(error?.code || error?.message);
          const status = Number(error?.status || 0);
          const retriable = code === 'AI_OUTPUT_INVALID'
            || code === 'UNSAFE_AI_OUTPUT'
            || error?.name === 'AbortError'
            || status === 429
            || status >= 500
            || !status;
          if (!retriable || attempt === 1 || generationDeadline - Date.now() < 8000) throw error;
        }
      }
      throw new Error('AI_OUTPUT_INVALID');
    }))).flat();
  } catch (error) {
    const safe = interpretationHttpError(error);
    if (safe instanceof HttpError) throw safe;
    throw new HttpError(502, 'AI 解读方案暂时无法生成，请稍后重试。', 'INTERPRETATION_GENERATION_FAILED');
  }

  const now = new Date().toISOString();
  const steps = [...completedSteps, ...generatedSteps];
  const complete = steps.length === interpretation.STEP_TITLES.length;
  if (complete) interpretation.validateDetailedSteps(steps);
  else interpretation.validateDetailedPrefix(steps);
  const data = {
    version: DETAILED_INTERPRETATION_VERSION,
    id: interpretationId,
    status: complete ? 'generated' : 'generating',
    steps,
    clientConcerns: resumed && Array.isArray(raw.clientConcerns) ? raw.clientConcerns : input.clientConcerns,
    customNotes: resumed ? raw.customNotes || null : input.customNotes,
    createdAt,
    updatedAt: now
  };
  const saved = await callRpc(config, session, 'v3a_save_advisor_interpretation', {
    p_report_id: input.reportId,
    p_interpretation_data: data
  });
  return res.status(200).json({
    ok: true,
    csrfToken: session.csrfToken,
    interpretationId: saved?.interpretationId || data.id,
    status: data.status,
    complete,
    progress: { completed: steps.length, total: interpretation.STEP_TITLES.length },
    ...(complete ? { steps } : {})
  });
}

async function handleInterpretationSave(config, session, res, body) {
  let input;
  try {
    input = interpretation.validateSaveBody(body);
  } catch (error) {
    throw interpretationHttpError(error);
  }
  const context = await loadInterpretationContext(config, session, input.clientId, input.reportId);
  const existing = context.report.interpretation_data;
  if (!existing || existing.id !== input.interpretationId) {
    throw new HttpError(409, '解读方案状态已变化，请刷新后重试。', 'INTERPRETATION_CONFLICT');
  }
  const data = {
    ...existing,
    version: Math.max(1, Number(existing.version) || 1),
    id: input.interpretationId,
    status: 'edited',
    steps: input.editedSteps,
    updatedAt: new Date().toISOString()
  };
  await callRpc(config, session, 'v3a_save_advisor_interpretation', {
    p_report_id: input.reportId,
    p_interpretation_data: data
  });
  return res.status(200).json({
    ok: true,
    csrfToken: session.csrfToken,
    interpretationId: input.interpretationId,
    status: 'edited',
    steps: input.editedSteps
  });
}

async function handleInterpretation(config, session, res, req, advisorUserId) {
  if (req.method === 'GET') return await handleInterpretationGet(config, session, res, req);
  const body = await readJsonBody(req, MAX_INTERPRETATION_JSON_BYTES);
  const operation = normalize(req.query?.operation);
  if (operation === 'generate') {
    return await handleInterpretationGenerate(config, session, res, body, advisorUserId);
  }
  if (operation === 'save') return await handleInterpretationSave(config, session, res, body);
  throw new HttpError(400, '不支持的 AI 解读操作。', 'INVALID_ACTION');
}

async function handleStatus(config, session, res, reportId) {
  if (!isUuid(reportId)) throw new HttpError(400, '报告标识无效。', 'INVALID_REPORT_ID');
  const reports = await selectRows(config, session, 'advisor_reports', {
    select: 'id,advisor_client_id,status,source,age_at_report,generated_report,error_code,created_at,updated_at',
    id: `eq.${reportId}`,
    limit: 1
  }, '报告状态暂时无法读取。');
  const report = reports[0];
  if (!report) throw new HttpError(404, '未找到该报告。', 'REPORT_NOT_FOUND');
  const clients = await selectRows(config, session, 'advisor_clients', {
    select: 'id',
    id: `eq.${report.advisor_client_id}`,
    archived_at: 'is.null',
    limit: 1
  }, '报告归属暂时无法校验。');
  if (!clients[0]) throw new HttpError(404, '未找到该报告。', 'REPORT_NOT_FOUND');
  return res.status(200).json({
    ok: true,
    report: {
      id: report.id,
      status: report.status,
      source: report.source,
      ageAtReport: report.age_at_report,
      createdAt: report.created_at,
      updatedAt: report.updated_at,
      generatedReport: report.status === 'ready' ? report.generated_report : null,
      errorCode: report.status === 'failed' ? report.error_code : null
    }
  });
}

async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader('Allow', 'GET, POST');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const config = getConfig();
    if (req.method === 'POST') requireSameOrigin(req, config);
    const { session, advisorUserId } = await requireActiveAdvisor(config, req, req.method === 'POST');
    const action = normalize(req.query?.action);
    if (action === 'coaching-suggestion') {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      return await handleCoachingSuggestion(config, session, res, await readJsonBody(req), advisorUserId);
    }
    if (action === 'interpretation') {
      return await handleInterpretation(config, session, res, req, advisorUserId);
    }
    if (req.method === 'GET') return await handleStatus(config, session, res, normalize(req.query?.id));

    if (action === 'extract') return await handleExtract(config, req, res, advisorUserId);
    if (action === 'confirm') return await handleConfirm(config, session, res, await readJsonBody(req), advisorUserId);
    throw new HttpError(400, '不支持的操作。', 'INVALID_ACTION');
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    return res.status(statusCode).json({ ok: false, error: message, code });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
module.exports._test = {
  ageFromBirthDate,
  callExtract,
  handleConfirm,
  handleCoachingSuggestion,
  handleInterpretation,
  handleInterpretationGenerate,
  handleInterpretationGet,
  handleInterpretationSave,
  handleStatus,
  internalOrigin,
  isUuid,
  parseMultipartFile,
  sanitizeGeneratedReport,
  parseCoachingSuggestion,
  validateCoachingSuggestionBody,
  validateConfirmBody,
  validateFingers
};
