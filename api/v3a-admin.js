/**
 * AIPIWEN V3a Preview-only headquarters application review API.
 *
 * This local integration is intentionally pinned to the Preview Supabase
 * project. It cannot query Production, create Auth users, or adjust credits.
 */

const crypto = require('crypto');
const {
  HttpError,
  getConfig: getSessionConfig,
  setPrivateHeaders,
  requireSameOrigin,
  requireJsonRequest,
  readRequestBody,
  clearSessionCookie,
  loadSession,
  resolveSession,
  requireCsrf
} = require('../server/v3a-session-store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getConfig() {
  const sessionConfig = getSessionConfig();
  const serviceRoleKey = String(
    process.env.V3A_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
  const reviewWritesEnabled = process.env.V3A_ADMIN_REVIEW_WRITES_ENABLED === 'true';
  if (!serviceRoleKey) {
    throw new HttpError(503, '总部审核服务尚未完成 Preview 配置。', 'ADMIN_SERVICE_NOT_CONFIGURED');
  }
  return { ...sessionConfig, serviceRoleKey, reviewWritesEnabled };
}

function requireReviewWritesEnabled(config) {
  if (config.reviewWritesEnabled !== true) {
    throw new HttpError(503, '总部审核写操作尚未开放。', 'REVIEW_WRITES_DISABLED');
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildRestUrl(config, table, params) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function selectRows(config, table, params) {
  let response;
  try {
    response = await fetch(buildRestUrl(config, table, params), {
      method: 'GET',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        Accept: 'application/json'
      }
    });
  } catch {
    throw new HttpError(502, '申请数据服务暂时不可用。', 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(502, '申请数据服务暂时不可用。', 'DATA_UPSTREAM_ERROR');
  const payload = await readJson(response);
  return Array.isArray(payload) ? payload : [];
}

async function requireActiveSuperAdmin(config, session) {
  const authUser = session.user;
  const rows = await selectRows(config, 'users', {
    select: 'id,role,status,display_name',
    auth_user_id: `eq.${authUser.id}`,
    limit: 1
  });
  const admin = rows[0];
  if (!admin || admin.role !== 'super_admin' || admin.status !== 'active') {
    throw new HttpError(403, '无权访问总部审核页面。', 'FORBIDDEN');
  }
  return admin;
}

function maskPhone(value) {
  const phone = String(value || '').trim();
  if (!/^\+861[3-9][0-9]{9}$/.test(phone)) return '未记录';
  return `+86 ${phone.slice(3, 6)}****${phone.slice(-4)}`;
}

function mapBy(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function applicationSummary(review, user, profile) {
  return {
    applicationId: review.id,
    name: review.applied_name || review.applied_nickname || user?.display_name || null,
    nickname: review.applied_nickname || user?.display_name || null,
    phoneMasked: maskPhone(user?.phone),
    city: review.applied_city || user?.city || null,
    role: review.role,
    practitionerType: review.practitioner_type,
    inviteCode: review.invite_code || null,
    agreementConfirmed: Boolean(profile?.agreement_version && profile?.agreed_rules_at),
    agreementVersion: profile?.agreement_version || null,
    appliedAt: review.created_at,
    status: review.status
  };
}

async function listApplications(config) {
  const reviews = await selectRows(config, 'application_reviews', {
    select: 'id,user_id,role,status,applied_city,applied_name,applied_nickname,practitioner_type,invite_code,created_at',
    status: 'eq.pending',
    order: 'created_at.asc'
  });
  if (reviews.length === 0) return [];
  const userIds = [...new Set(reviews.map((review) => review.user_id).filter(Boolean))];
  const idFilter = `in.(${userIds.join(',')})`;
  const [users, profiles] = await Promise.all([
    selectRows(config, 'users', {
      select: 'id,phone,display_name,city,status',
      id: idFilter
    }),
    selectRows(config, 'advisor_profiles', {
      select: 'user_id,agreement_version,agreed_rules_at',
      user_id: idFilter
    })
  ]);
  const usersById = mapBy(users, 'id');
  const profilesByUserId = mapBy(profiles, 'user_id');
  return reviews
    .filter((review) => review.status === 'pending')
    .map((review) => applicationSummary(review, usersById.get(review.user_id), profilesByUserId.get(review.user_id)));
}

async function getApplication(config, applicationId) {
  const reviews = await selectRows(config, 'application_reviews', {
    select: 'id,user_id,role,status,applied_city,applied_name,applied_nickname,practitioner_type,organization_name,invite_code,application_note,created_at',
    id: `eq.${applicationId}`,
    status: 'eq.pending',
    limit: 1
  });
  const review = reviews[0];
  if (!review || review.status !== 'pending') {
    throw new HttpError(404, '未找到该 pending 申请。', 'APPLICATION_NOT_FOUND');
  }
  const [users, profiles] = await Promise.all([
    selectRows(config, 'users', {
      select: 'id,phone,display_name,city,status',
      id: `eq.${review.user_id}`,
      limit: 1
    }),
    selectRows(config, 'advisor_profiles', {
      select: 'user_id,role,status,nickname,city,organization_name,practitioner_type,agreement_version,agreed_rules_at',
      user_id: `eq.${review.user_id}`,
      limit: 1
    })
  ]);
  const user = users[0] || null;
  const profile = profiles[0] || null;
  return {
    summary: applicationSummary(review, user, profile),
    applicationNote: review.application_note || null,
    organizationName: review.organization_name || profile?.organization_name || null,
    currentStatus: {
      user: user?.status || null,
      profile: profile?.status || null,
      application: review.status
    }
  };
}

const RPC_ERROR_MAP = {
  FORBIDDEN: [403, '无权执行审核操作。', 'FORBIDDEN'],
  APPLICATION_NOT_FOUND: [404, '未找到该申请。', 'APPLICATION_NOT_FOUND'],
  APPLICATION_ALREADY_REJECTED: [400, '该申请已经被驳回。', 'APPLICATION_ALREADY_REJECTED'],
  APPLICATION_NOT_PENDING: [400, '该申请已不处于 pending 状态。', 'APPLICATION_NOT_PENDING'],
  APPLICATION_RELATED_DATA_NOT_PENDING: [400, '申请关联状态不一致。', 'APPLICATION_NOT_PENDING'],
  APPLICATION_PROFILE_NOT_PENDING: [400, '申请资料已不处于 pending 状态。', 'APPLICATION_NOT_PENDING'],
  REJECTION_REASON_TOO_SHORT: [400, '驳回原因至少需要 10 个字符。', 'REASON_REQUIRED']
};

async function callRpc(config, functionName, body) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, '审核事务服务暂时不可用。', 'RPC_UPSTREAM_UNAVAILABLE');
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const marker = typeof payload?.message === 'string' ? payload.message : '';
    if (marker === 'INVITE_CODE_CONFLICT') {
      throw new HttpError(409, '邀请码发生碰撞，请重试。', 'INVITE_CODE_CONFLICT');
    }
    const mapped = RPC_ERROR_MAP[marker];
    if (mapped) throw new HttpError(mapped[0], mapped[1], mapped[2]);
    throw new HttpError(500, '审核事务执行失败，所有修改均已回滚。', 'TRANSACTION_FAILED');
  }
  return Array.isArray(payload) ? payload[0] : payload;
}

async function getApplicationRole(config, applicationId) {
  const rows = await selectRows(config, 'application_reviews', {
    select: 'id,role,status',
    id: `eq.${applicationId}`,
    status: 'eq.pending',
    limit: 1
  });
  if (!rows[0] || rows[0].status !== 'pending') {
    throw new HttpError(404, '未找到该 pending 申请。', 'APPLICATION_NOT_FOUND');
  }
  if (!['advisor', 'agent', 'center'].includes(rows[0].role)) {
    throw new HttpError(400, '申请角色无效。', 'INVALID_APPLICATION_ROLE');
  }
  return rows[0].role;
}

function generateInviteCode(role) {
  const prefixes = { advisor: 'ADV', agent: 'AGT', center: 'CTR' };
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const prefix = prefixes[role];
  if (!prefix) throw new HttpError(400, '申请角色无效。', 'INVALID_APPLICATION_ROLE');
  let suffix = '';
  for (let index = 0; index < 8; index += 1) suffix += alphabet[crypto.randomInt(alphabet.length)];
  return `${prefix}-${suffix}`;
}

async function inviteCodeExists(config, code) {
  const rows = await selectRows(config, 'invite_codes', { select: 'id', code: `eq.${code}`, limit: 1 });
  return rows.length > 0;
}

function requireUuid(value) {
  if (!UUID_PATTERN.test(String(value || ''))) {
    throw new HttpError(500, '审核事务返回结果无效。', 'TRANSACTION_FAILED');
  }
  return value;
}

function normalizeApprovalResult(result) {
  const data = result?.data;
  const balance = Number(data?.wallet?.balance);
  const amount = Number(data?.credit_log?.amount);
  if (
    result?.success !== true || data?.user_status !== 'active' || balance !== 500 ||
    data?.credit_log?.type !== 'REGISTER_BONUS' || amount !== 500 ||
    !/^(ADV|AGT|CTR)-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(String(data?.invite_code || ''))
  ) {
    throw new HttpError(500, '审核事务返回结果无效。', 'TRANSACTION_FAILED');
  }
  requireUuid(data.application_id);
  requireUuid(data.user_id);
  requireUuid(data.wallet.id);
  requireUuid(data.credit_log.id);
  requireUuid(data.audit_log_id);
  return {
    ok: true,
    alreadyProcessed: result.already_processed === true
  };
}

function normalizeRejectionResult(result) {
  const data = result?.data;
  if (result?.success !== true || data?.user_status !== 'rejected') {
    throw new HttpError(500, '审核事务返回结果无效。', 'TRANSACTION_FAILED');
  }
  requireUuid(data.application_id);
  requireUuid(data.user_id);
  requireUuid(data.review_id);
  if (data.audit_log_id) requireUuid(data.audit_log_id);
  return {
    ok: true,
    alreadyProcessed: result.already_processed === true
  };
}

async function approveApplication(config, admin, applicationId) {
  const role = await getApplicationRole(config, applicationId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inviteCode = generateInviteCode(role);
    if (await inviteCodeExists(config, inviteCode)) continue;
    try {
      const result = await callRpc(config, 'v3a_approve_application', {
        p_application_id: applicationId,
        p_reviewer_user_id: admin.id,
        p_invite_code: inviteCode
      });
      return normalizeApprovalResult(result);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'INVITE_CODE_CONFLICT' || attempt === 2) throw error;
    }
  }
  throw new HttpError(500, '审核事务执行失败。', 'TRANSACTION_FAILED');
}

async function rejectApplication(config, admin, applicationId, reason) {
  const normalizedReason = String(reason || '').trim();
  if (Array.from(normalizedReason).length < 10) {
    throw new HttpError(400, '驳回原因至少需要 10 个字符。', 'REASON_REQUIRED');
  }
  if (Array.from(normalizedReason).length > 500) {
    throw new HttpError(400, '驳回原因不能超过 500 个字符。', 'REASON_TOO_LONG');
  }
  const result = await callRpc(config, 'v3a_reject_application', {
    p_application_id: applicationId,
    p_reviewer_user_id: admin.id,
    p_reason: normalizedReason
  });
  return normalizeRejectionResult(result);
}

module.exports = async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader('Allow', 'GET, POST');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const config = getConfig();
    if (req.method === 'POST') {
      requireSameOrigin(req, config);
      requireJsonRequest(req);
    }
    const loaded = await loadSession(req, config);
    if (req.method === 'POST') requireCsrf(req, loaded);
    const session = await resolveSession(config, loaded);
    const admin = await requireActiveSuperAdmin(config, session);
    const action = req.query?.action;

    if (req.method === 'GET' && action === 'list_applications') {
      const applications = await listApplications(config);
      return res.status(200).json({
        ok: true,
        admin: { displayName: admin.display_name || 'AIPIWEN 总部' },
        applications,
        csrfToken: session.csrfToken
      });
    }
    if (req.method === 'GET' && action === 'get_application') {
      const applicationId = String(req.query?.id || '');
      if (!UUID_PATTERN.test(applicationId)) {
        throw new HttpError(400, 'application_id 格式无效。', 'INVALID_APPLICATION_ID');
      }
      const application = await getApplication(config, applicationId);
      return res.status(200).json({ ok: true, application, csrfToken: session.csrfToken });
    }
    if (req.method === 'POST' && action === 'approve_application') {
      requireReviewWritesEnabled(config);
      const body = readRequestBody(req);
      const applicationId = String(body.applicationId || '');
      if (!UUID_PATTERN.test(applicationId)) {
        throw new HttpError(400, 'applicationId 格式无效。', 'INVALID_APPLICATION_ID');
      }
      return res.status(200).json(await approveApplication(config, admin, applicationId));
    }
    if (req.method === 'POST' && action === 'reject_application') {
      requireReviewWritesEnabled(config);
      const body = readRequestBody(req);
      const applicationId = String(body.applicationId || '');
      if (!UUID_PATTERN.test(applicationId)) {
        throw new HttpError(400, 'applicationId 格式无效。', 'INVALID_APPLICATION_ID');
      }
      return res.status(200).json(await rejectApplication(config, admin, applicationId, body.reason));
    }
    throw new HttpError(400, '不支持的 action。', 'INVALID_ACTION');
  } catch (error) {
    if (error?.code === 'UNAUTHENTICATED') clearSessionCookie(res);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    return res.status(statusCode).json({ ok: false, error: message, code });
  }
};
