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
  consumeRateLimit,
  readJson
} = require('../server/v3a-session-store');
const { nearestInviteeReadyReportCount } = require('../server/v3a-growth-snapshot-store');
const workbenchV4 = require('../server/v3a-workbench-v4');

const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const SERVICE_CODE_PATTERN = /^[0-9A-F]{10}$/;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INVITE_PROGRESS_LIMIT = 50;
const ADVISOR_CLIENT_LIMIT = 500;
const ADVISOR_REPORT_LIMIT = 1000;
const V4_ACTIONS = new Set([
  'client-data-center',
  'client-data-center-clues',
  'client-data-center-stage-summary',
  'client-data-center-person-list',
  'growth-records',
  'coaching-sessions',
  'case-cards',
  'case-candidates'
]);
const CREDIT_LOG_TITLES = {
  REGISTER_BONUS: '注册认证奖励',
  INVITE_REWARD: '邀请影响奖励',
  FIRST_SERVICE_REWARD: '稳定服务奖励',
  CERTIFICATION_REWARD: '认证成长奖励',
  MANUAL_GRANT: '成长积分调整',
  MANUAL_DEDUCT: '成长积分调整'
};

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

async function selectCount(config, session, table, params, message) {
  let response;
  try {
    response = await fetch(restUrl(config, table, { ...params, select: 'id', limit: 1 }), {
      method: 'GET',
      headers: { ...sessionHeaders(config, session), Prefer: 'count=exact' }
    });
  } catch {
    throw new HttpError(502, message, 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(502, message, 'DATA_UPSTREAM_ERROR');
  const contentRange = String(response.headers?.get?.('content-range') || '');
  const total = contentRange.split('/').pop();
  if (!/^\d+$/.test(total)) throw new HttpError(502, message, 'DATA_UPSTREAM_ERROR');
  return Number(total);
}

async function selectExists(config, session, table, params, message) {
  const rows = await selectRows(config, session, table, { ...params, select: 'id', limit: 1 }, message);
  return rows.length > 0;
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
    throw new HttpError(400, '客户上传链接无效。', 'INVALID_ATTRIBUTION_TOKEN');
  }
  return token;
}

function normalizeServiceCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[ -]/g, '');
  if (!SERVICE_CODE_PATTERN.test(code)) {
    throw new HttpError(400, '指导师服务码无效。', 'INVALID_ATTRIBUTION_SERVICE_CODE');
  }
  return code;
}

function requestIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const candidate = forwarded || String(req.headers?.['x-real-ip'] || '').trim() || String(req.socket?.remoteAddress || '').trim();
  return candidate.slice(0, 128) || 'unknown';
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

function publicServiceCode(payload) {
  const result = publicAdvisor(payload);
  if (result.valid !== true) return result;
  return { ...result, attributionToken: normalizeToken(payload?.attributionToken) };
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

function milestoneStatus(achieved, hasProgress) {
  if (achieved) return 'completed';
  return hasProgress ? 'in_progress' : 'locked';
}

function publicCreditLog(row) {
  const amount = Number(row?.amount);
  const note = String(row?.note || '').trim().replace(UUID_PATTERN, '[已隐藏]');
  return {
    title: CREDIT_LOG_TITLES[row?.type] || '成长积分记录',
    amount: Number.isFinite(amount) ? amount : 0,
    createdAt: row?.created_at || row?.createdAt || null,
    note: note || null
  };
}

function buildGrowthSnapshot(input = {}) {
  const balanceValue = Number(input.balance);
  const balance = Number.isFinite(balanceValue) ? balanceValue : 0;
  const activeClientCount = Math.max(0, Number(input.activeClientCount) || 0);
  const readyReportCount = Math.max(0, Number(input.readyReportCount) || 0);
  const channelReadyReportCount = Math.max(
    0,
    Number(input.channelReadyReportCount ?? input.readyReportCount) || 0
  );
  const distinctSourceCount = Math.max(0, Number(input.distinctSourceCount) || 0);
  const nearestInviteeReadyReports = Math.max(0, Number(input.nearestInviteeReadyReports) || 0);
  const registrationAchieved = input.hasRegistration === true;
  const firstClientAchieved = activeClientCount >= 1;
  const stableServiceAchieved = readyReportCount >= 3;
  const channelAchieved = input.hasFirstServiceReward === true;
  const inviteAchieved = input.hasInviteReward === true;

  let channelDescription = '已完成';
  if (!channelAchieved && channelReadyReportCount >= 3 && distinctSourceCount >= 2) {
    channelDescription = '服务条件已达到，等待成长记录入账';
  } else if (!channelAchieved) {
    channelDescription = `已服务 ${Math.min(channelReadyReportCount, 3)}/3 份报告，覆盖 ${Math.min(distinctSourceCount, 2)}/2 个渠道`;
  }

  let inviteDescription = '已完成';
  if (!inviteAchieved && nearestInviteeReadyReports >= 3) {
    inviteDescription = '报告进度已达到，等待其他条件确认';
  } else if (!inviteAchieved && nearestInviteeReadyReports > 0) {
    inviteDescription = `你邀请的学员最接近解锁的一位还需完成 ${3 - nearestInviteeReadyReports} 份报告`;
  } else if (!inviteAchieved) {
    inviteDescription = '邀请的学员完成服务后，将记录你的邀请影响';
  }

  return {
    version: 'v0.1',
    balance,
    milestones: [
      {
        key: 'registration',
        label: '注册认证',
        achieved: registrationAchieved,
        status: milestoneStatus(registrationAchieved, true),
        reward: 500,
        description: registrationAchieved ? '已完成' : '成长记录正在同步'
      },
      {
        key: 'first_client',
        label: '首次客户',
        achieved: firstClientAchieved,
        status: milestoneStatus(firstClientAchieved, false),
        reward: null,
        description: firstClientAchieved ? '已完成' : '完成首次客户服务后记录'
      },
      {
        key: 'stable_service',
        label: '稳定服务',
        achieved: stableServiceAchieved,
        status: milestoneStatus(stableServiceAchieved, readyReportCount > 0),
        reward: null,
        description: stableServiceAchieved ? '已完成' : `已完成 ${Math.min(readyReportCount, 3)}/3 份报告`,
        progress: { reports: readyReportCount, target: 3 }
      },
      {
        key: 'channel_verification',
        label: '渠道验证',
        achieved: channelAchieved,
        status: milestoneStatus(channelAchieved, channelReadyReportCount > 0 || distinctSourceCount > 0),
        reward: 200,
        description: channelDescription,
        progress: {
          reports: channelReadyReportCount,
          reportsTarget: 3,
          sources: distinctSourceCount,
          sourcesTarget: 2
        }
      },
      {
        key: 'invite_impact',
        label: '邀请影响',
        achieved: inviteAchieved,
        status: milestoneStatus(inviteAchieved, nearestInviteeReadyReports > 0),
        reward: 200,
        description: inviteDescription,
        progress: { nearestInviteeReadyReports, target: 3 }
      }
    ],
    recentLogs: (Array.isArray(input.recentLogs) ? input.recentLogs : [])
      .slice(0, 10)
      .map(publicCreditLog)
  };
}

async function loadNearestInviteeReadyReportCount(config, session, advisorUserId) {
  const relations = await selectRows(config, session, 'invite_relations', {
    select: 'invitee_user_id',
    inviter_user_id: `eq.${advisorUserId}`,
    status: 'neq.invalid',
    order: 'created_at.desc',
    limit: INVITE_PROGRESS_LIMIT
  }, '邀请成长记录暂时无法读取。');
  if (relations.length === 0) return 0;

  const inviteeIds = [...new Set(relations.map((row) => row.invitee_user_id).filter(Boolean))];
  if (inviteeIds.length === 0) return 0;
  return nearestInviteeReadyReportCount(config, inviteeIds);
}

async function getGrowthSnapshot(config, req) {
  if (
    req.query?.user_id || req.query?.userId || req.query?.advisor_id ||
    req.query?.advisorId || req.query?.advisor_user_id ||
    (req.body && Object.keys(req.body).length > 0)
  ) {
    throw new HttpError(400, '请求中不得指定指导师或提交数据。', 'GROWTH_SNAPSHOT_INPUT_NOT_ALLOWED');
  }
  const { session, advisorUserId } = await requireActiveAdvisor(config, req);
  const creditMessage = '成长积分记录暂时无法读取。';
  const clientMessage = '成长服务记录暂时无法读取。';
  const [wallets, recentLogs, hasRegistration, hasFirstServiceReward, hasInviteReward, activeClientCount, clients] =
    await Promise.all([
      selectRows(config, session, 'credit_wallets', {
        select: 'balance',
        user_id: `eq.${advisorUserId}`,
        limit: 1
      }, creditMessage),
      selectRows(config, session, 'credit_logs', {
        select: 'type,amount,created_at,note',
        user_id: `eq.${advisorUserId}`,
        order: 'created_at.desc',
        limit: 10
      }, creditMessage),
      selectExists(config, session, 'credit_logs', {
        user_id: `eq.${advisorUserId}`,
        type: 'eq.REGISTER_BONUS'
      }, creditMessage),
      selectExists(config, session, 'credit_logs', {
        user_id: `eq.${advisorUserId}`,
        type: 'eq.FIRST_SERVICE_REWARD'
      }, creditMessage),
      selectExists(config, session, 'credit_logs', {
        user_id: `eq.${advisorUserId}`,
        type: 'eq.INVITE_REWARD'
      }, creditMessage),
      selectCount(config, session, 'advisor_clients', {
        advisor_user_id: `eq.${advisorUserId}`,
        archived_at: 'is.null'
      }, clientMessage),
      selectRows(config, session, 'advisor_clients', {
        select: 'id',
        advisor_user_id: `eq.${advisorUserId}`,
        archived_at: 'is.null',
        order: 'created_at.desc',
        limit: ADVISOR_CLIENT_LIMIT
      }, clientMessage)
    ]);

  let readyReportCount = 0;
  let channelReadyReportCount = 0;
  let distinctSourceCount = 0;
  if (clients.length > 0) {
    const clientIds = clients.map((row) => row.id).join(',');
    const approvedSources = 'in.(advisor_qr,advisor_import,unguided)';
    const [readyCount, channelCount, sources] = await Promise.all([
      selectCount(config, session, 'advisor_reports', {
        advisor_client_id: `in.(${clientIds})`,
        status: 'eq.ready'
      }, clientMessage),
      selectCount(config, session, 'advisor_reports', {
        advisor_client_id: `in.(${clientIds})`,
        status: 'eq.ready',
        source: approvedSources
      }, clientMessage),
      selectRows(config, session, 'advisor_reports', {
        select: 'source',
        advisor_client_id: `in.(${clientIds})`,
        status: 'eq.ready',
        source: approvedSources,
        order: 'created_at.desc',
        limit: ADVISOR_REPORT_LIMIT
      }, clientMessage)
    ]);
    readyReportCount = readyCount;
    channelReadyReportCount = channelCount;
    distinctSourceCount = new Set(sources.map((row) => row.source).filter(Boolean)).size;
  }

  const nearestInviteeReadyReports = hasInviteReward
    ? 3
    : await loadNearestInviteeReadyReportCount(config, session, advisorUserId);
  return buildGrowthSnapshot({
    balance: wallets[0]?.balance,
    recentLogs,
    hasRegistration,
    activeClientCount,
    readyReportCount,
    channelReadyReportCount,
    distinctSourceCount,
    hasFirstServiceReward,
    hasInviteReward,
    nearestInviteeReadyReports
  });
}

async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const config = getConfig();
    const action = String(req.query?.action || (req.method === 'GET' ? 'customers' : ''));

    if (V4_ACTIONS.has(action)) {
      return await workbenchV4.handleAction(config, req, res, action);
    }

    if (req.method === 'GET' && action === 'validate') {
      const hasToken = String(req.query?.token || '').trim() !== '';
      const hasServiceCode = String(req.query?.code || '').trim() !== '';
      if (hasToken === hasServiceCode) {
        throw new HttpError(400, '请提供一种客户上传凭证。', 'INVALID_ATTRIBUTION_CREDENTIAL');
      }
      if (hasServiceCode) {
        await consumeRateLimit(config, 'attribution-service-code-validate-ip', requestIp(req), 20, 600);
        const serviceCode = normalizeServiceCode(req.query.code);
        const result = await callRpc(
          config,
          null,
          'v3a_validate_attribution_service_code',
          { p_service_code: serviceCode },
          '指导师服务码暂时无法验证。'
        );
        return res.status(200).json({ ok: true, ...publicServiceCode(result) });
      }
      const token = normalizeToken(req.query.token);
      const result = await callRpc(
        config,
        null,
        'v3a_validate_attribution_token',
        { p_token: token },
        '客户上传链接暂时无法验证。'
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

    if (req.method === 'GET' && action === 'growth-snapshot') {
      const snapshot = await getGrowthSnapshot(config, req);
      return res.status(200).json({ ok: true, ...snapshot });
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
        '客户上传入口暂时无法创建。'
      );
      const token = normalizeToken(result?.token);
      const serviceCode = normalizeServiceCode(result?.serviceCode);
      return res.status(201).json({
        ok: true,
        token,
        serviceCode,
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
module.exports._test = {
  normalizeToken,
  normalizeServiceCode,
  requestIp,
  publicAdvisor,
  publicServiceCode,
  restUrl,
  listCustomers,
  buildGrowthSnapshot,
  getGrowthSnapshot
};
