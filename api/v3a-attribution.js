/**
 * Advisor client attribution and the legacy-compatible customer list endpoint.
 * Browser requests never provide an advisor id; ownership comes from the V3A Session.
 */

const {
  HttpError,
  getConfig,
  setPrivateHeaders,
  requireSameOrigin,
  requireJsonRequest,
  readRequestBody,
  loadSession,
  resolveSession,
  requireCsrf,
  readJson
} = require('../server/v3a-session-store');

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

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

async function requireActiveAdvisor(config, req) {
  const loaded = await loadSession(req, config);
  const session = await resolveSession(config, loaded);
  const rows = await selectRows(config, session, 'users', {
    select: 'id,role,status',
    auth_user_id: `eq.${session.user.id}`,
    limit: 1
  }, '账号信息暂时无法读取。');
  const user = rows[0];
  if (!user || user.role !== 'advisor' || user.status !== 'active') {
    throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
  }
  return { session, advisorUserId: user.id };
}

function normalizeToken(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!TOKEN_PATTERN.test(token)) {
    throw new HttpError(400, '客户归属链接无效。', 'INVALID_ATTRIBUTION_TOKEN');
  }
  return token;
}

function publicAdvisor(payload) {
  if (payload?.valid !== true) {
    return { valid: false, code: String(payload?.code || 'INVALID_ATTRIBUTION_TOKEN') };
  }
  return {
    valid: true,
    advisor: { displayName: String(payload.advisorDisplayName || 'AIPIWEN指导师').slice(0, 40) },
    expiresAt: payload.expiresAt || null,
    remainingUses: Number.isInteger(payload.remainingUses) ? payload.remainingUses : null
  };
}

async function callRpc(config, accessToken, functionName, body, publicMessage) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken || config.anonKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, publicMessage, 'RPC_UPSTREAM_UNAVAILABLE');
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const marker = typeof payload?.message === 'string' ? payload.message : '';
    if (marker === 'ATTRIBUTION_FORBIDDEN') {
      throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
    }
    if (marker === 'INVALID_MAX_USES') {
      throw new HttpError(400, '归属链接配置无效。', 'INVALID_MAX_USES');
    }
    throw new HttpError(502, publicMessage, 'RPC_UPSTREAM_ERROR');
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function listCustomers(config, req) {
  if (req.query?.advisor_id || req.query?.advisorId || req.query?.advisor_user_id) {
    throw new HttpError(400, '请求中不得指定指导师。', 'ADVISOR_ID_NOT_ALLOWED');
  }
  const { session, advisorUserId } = await requireActiveAdvisor(config, req);
  const clients = await selectRows(config, session, 'advisor_clients', {
    select: 'id,display_name,birth_date,source,note,created_at,assigned_at',
    advisor_user_id: `eq.${advisorUserId}`,
    archived_at: 'is.null',
    order: 'created_at.desc',
    limit: 200
  }, '客户列表暂时无法读取。');

  const reportsByClient = new Map();
  if (clients.length > 0) {
    const clientIds = clients.map((client) => client.id).join(',');
    const reports = await selectRows(config, session, 'advisor_reports', {
      select: 'id,advisor_client_id,status,created_at,updated_at',
      advisor_client_id: `in.(${clientIds})`,
      order: 'created_at.desc',
      limit: 500
    }, '客户报告暂时无法读取。');
    for (const report of reports) {
      if (!reportsByClient.has(report.advisor_client_id)) reportsByClient.set(report.advisor_client_id, []);
      reportsByClient.get(report.advisor_client_id).push({
        id: report.id,
        status: report.status,
        createdAt: report.created_at,
        updatedAt: report.updated_at
      });
    }
  }

  const result = clients.map((client) => ({
    id: client.id,
    displayName: client.display_name,
    birthDate: client.birth_date,
    source: client.source,
    note: client.note,
    createdAt: client.created_at,
    assignedAt: client.assigned_at,
    reports: reportsByClient.get(client.id) || []
  }));
  return { session, clients: result };
}

async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader('Allow', 'GET, POST');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const config = getConfig();
    const action = String(req.query?.action || (req.method === 'GET' ? 'customers' : ''));

    if (req.method === 'GET' && action === 'validate') {
      const token = normalizeToken(req.query?.token);
      const result = await callRpc(
        config,
        null,
        'v3a_validate_attribution_token',
        { p_token: token },
        '客户归属链接暂时无法验证。'
      );
      return res.status(200).json({ ok: true, ...publicAdvisor(result) });
    }

    if (req.method === 'GET' && action === 'customers') {
      const result = await listCustomers(config, req);
      return res.status(200).json({
        ok: true,
        clients: result.clients,
        total: result.clients.length,
        csrfToken: result.session.csrfToken
      });
    }

    if (req.method === 'POST' && action === 'create') {
      requireSameOrigin(req, config);
      requireJsonRequest(req);
      const body = readRequestBody(req);
      if (Object.keys(body || {}).length !== 0) {
        throw new HttpError(400, '请求字段不符合归属链接要求。', 'INVALID_REQUEST_BODY');
      }
      const loaded = await loadSession(req, config);
      const session = await resolveSession(config, loaded);
      requireCsrf(req, loaded);
      const rows = await selectRows(config, session, 'users', {
        select: 'id,role,status',
        auth_user_id: `eq.${session.user.id}`,
        limit: 1
      }, '账号信息暂时无法读取。');
      const user = rows[0];
      if (!user || user.role !== 'advisor' || user.status !== 'active') {
        throw new HttpError(403, '当前账号无此权限。', 'FORBIDDEN');
      }
      const result = await callRpc(
        config,
        session.record.accessToken,
        'v3a_create_attribution_token',
        { p_max_uses: 1 },
        '客户归属链接暂时无法创建。'
      );
      const token = normalizeToken(result?.token);
      return res.status(201).json({
        ok: true,
        token,
        uploadPath: `/report-upload.html?token=${encodeURIComponent(token)}`,
        expiresAt: result?.expiresAt || null,
        maxUses: 1
      });
    }

    throw new HttpError(400, '不支持的 action。', 'INVALID_ACTION');
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    return res.status(statusCode).json({ ok: false, error: message, code });
  }
}

module.exports = handler;
module.exports._test = { normalizeToken, publicAdvisor, restUrl, listCustomers };
