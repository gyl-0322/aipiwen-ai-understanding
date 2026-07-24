/**
 * Preview-only AIPIWEN V3a phone auth dispatcher.
 * The browser receives an opaque HttpOnly session id; Supabase tokens stay in encrypted server-side KV.
 */

const {
  HttpError,
  getConfig,
  setPrivateHeaders,
  requireSameOrigin,
  requireJsonRequest,
  readRequestBody,
  readSessionId,
  clearSessionCookie,
  authRequest,
  consumeRateLimit,
  readJson,
  createSession,
  loadSession,
  resolveSession,
  getSession,
  requireCsrf,
  destroySession
} = require('../server/v3a-session-store');

const AGREEMENT_VERSION = 'v3a-phase-b-preview-2026-07-09';
const validRoles = new Set(['advisor', 'agent', 'center']);
const validChannelIdentities = new Set(['', 'branch_company', 'service_center', 'collection_center', 'ordinary_advisor']);
const autoAdvisorChannelIdentities = new Set(['', 'ordinary_advisor']);
const validPractitionerTypes = new Set([
  'independent',
  'organization',
  'education_family',
  'psychological_consulting',
  'child_growth_quality',
  'assessment_collection',
  'other'
]);
const channelRoleMap = {
  branch_company: 'agent',
  service_center: 'center',
  collection_center: 'center',
  ordinary_advisor: 'advisor'
};

function normalize(value) {
  return String(value || '').trim();
}

function normalizeChinaPhone(value) {
  let phone = normalize(value).replace(/[\s()-]/g, '');
  if (phone.startsWith('+86')) phone = phone.slice(3);
  else if (phone.startsWith('0086')) phone = phone.slice(4);
  else if (phone.startsWith('86') && phone.length === 13) phone = phone.slice(2);
  if (!/^1[3-9][0-9]{9}$/.test(phone)) {
    throw new HttpError(400, '请输入有效的中国大陆手机号。', 'INVALID_PHONE');
  }
  return `+86${phone}`;
}

function canonicalVerifiedPhone(value) {
  const match = /^(?:\+86|86)(1[3-9][0-9]{9})$/.exec(normalize(value));
  return match ? `+86${match[1]}` : '';
}

function maskPhone(phone) {
  const value = normalize(phone);
  if (!/^\+861[3-9][0-9]{9}$/.test(value)) return '已验证手机号';
  return `+86 ${value.slice(3, 6)}****${value.slice(-4)}`;
}

function passwordIsSet(user) {
  return user?.user_metadata?.v3a_password_set === true;
}

function validatePassword(value, confirmation = value) {
  const password = String(value || '');
  const repeated = String(confirmation || '');
  if (password !== repeated) {
    throw new HttpError(400, '两次输入的密码不一致。', 'PASSWORD_MISMATCH');
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, '密码至少 8 位，且必须包含字母和数字。', 'INVALID_PASSWORD');
  }
  return password;
}

function requestIp(req) {
  const forwarded = normalize(req.headers?.['x-forwarded-for']).split(',')[0].trim();
  const candidate = forwarded || normalize(req.headers?.['x-real-ip']) || normalize(req.socket?.remoteAddress);
  return candidate.slice(0, 128) || 'unknown';
}

function buildRestUrl(config, table, params) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

async function selectRows(config, accessToken, table, params) {
  let response;
  try {
    response = await fetch(buildRestUrl(config, table, params), {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
  } catch {
    throw new HttpError(502, '账号状态暂时无法读取。', 'DATA_UPSTREAM_UNAVAILABLE');
  }
  if (!response.ok) throw new HttpError(502, '账号状态暂时无法读取。', 'DATA_UPSTREAM_ERROR');
  const payload = await readJson(response);
  return Array.isArray(payload) ? payload : [];
}

async function readCurrentApplication(config, session) {
  const authPasswordSet = passwordIsSet(session.user);
  const users = await selectRows(config, session.record.accessToken, 'users', {
    select: 'id,role,status,display_name,city,created_at,last_login_at',
    auth_user_id: `eq.${session.user.id}`,
    limit: 1
  });
  const user = users[0];
  if (!user) {
    return {
      phoneMasked: maskPhone(session.user.phone),
      passwordSet: authPasswordSet,
      requiresPasswordSetup: !authPasswordSet,
      user: null,
      profile: null,
      applicationReview: null
    };
  }
  const [profiles, reviews] = await Promise.all([
    selectRows(config, session.record.accessToken, 'advisor_profiles', {
      select: 'role,status,nickname,city,practitioner_type,created_at',
      user_id: `eq.${user.id}`,
      limit: 1
    }),
    selectRows(config, session.record.accessToken, 'application_reviews', {
      select: 'role,status,applied_city,applied_nickname,practitioner_type,invite_code,review_note,created_at,reviewed_at',
      user_id: `eq.${user.id}`,
      order: 'created_at.desc',
      limit: 1
    })
  ]);
  const current = {
    phoneMasked: maskPhone(session.user.phone),
    passwordSet: authPasswordSet,
    requiresPasswordSetup: !authPasswordSet,
    user: {
      role: user.role,
      status: user.status,
      displayName: user.display_name,
      city: user.city,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at
    },
    profile: profiles[0] ? {
      role: profiles[0].role,
      status: profiles[0].status,
      nickname: profiles[0].nickname,
      city: profiles[0].city,
      practitionerType: profiles[0].practitioner_type,
      createdAt: profiles[0].created_at
    } : null,
    applicationReview: reviews[0] ? {
      role: reviews[0].role,
      status: reviews[0].status,
      appliedCity: reviews[0].applied_city,
      appliedNickname: reviews[0].applied_nickname,
      practitionerType: reviews[0].practitioner_type,
      inviteCode: reviews[0].invite_code,
      reviewNote: reviews[0].review_note,
      createdAt: reviews[0].created_at,
      reviewedAt: reviews[0].reviewed_at
    } : null
  };
  if (user.status === 'active' && validRoles.has(user.role)) {
    const [wallets, inviteCodes] = await Promise.all([
      selectRows(config, session.record.accessToken, 'credit_wallets', {
        select: 'balance',
        user_id: `eq.${user.id}`,
        limit: 1
      }),
      selectRows(config, session.record.accessToken, 'invite_codes', {
        select: 'code',
        user_id: `eq.${user.id}`,
        status: 'eq.active',
        limit: 1
      })
    ]);
    const balance = Number(wallets[0]?.balance);
    current.wallet = Number.isSafeInteger(balance) && balance >= 0 ? { balance } : null;
    current.inviteCode = normalize(inviteCodes[0]?.code) || null;
  }
  return current;
}

function nextPath(me) {
  if (me?.passwordReset) return '/advisor-register.html?set_password=1';
  if (!me.user) return me?.requiresPasswordSetup ? '/advisor-register.html?set_password=1' : '/advisor-register.html';
  if (me.user.status === 'pending') return '/advisor-pending.html';
  if (me.user.status === 'active' && me.user.role === 'super_admin') return '/admin-applications.html';
  if (me.user.status === 'active' && validRoles.has(me.user.role)) return '/ai-interpreter-workbench.html';
  if (me?.requiresPasswordSetup) return '/advisor-register.html?set_password=1';
  return null;
}

function validateApplication(body) {
  const payload = {
    displayName: normalize(body.displayName),
    city: normalize(body.city),
    channelIdentity: normalize(body.channelIdentity),
    practitionerType: normalize(body.practitionerType),
    practitionerTypeNote: normalize(body.practitionerTypeNote),
    inviteCode: normalize(body.inviteCode).toUpperCase(),
    acceptedRules: body.acceptedRules === true
  };
  payload.role = channelRoleMap[payload.channelIdentity] || normalize(body.role) || 'advisor';
  if (!payload.acceptedRules) throw new HttpError(400, '请先同意从业者协议和四条规则。', 'INVALID_AGREEMENT');
  if (Array.from(payload.displayName).length < 2 || Array.from(payload.displayName).length > 80) {
    throw new HttpError(400, '请填写有效的昵称或从业名。', 'INVALID_DISPLAY_NAME');
  }
  if (!payload.city || Array.from(payload.city).length > 80) {
    throw new HttpError(400, '请填写有效的城市。', 'INVALID_CITY');
  }
  if (!validChannelIdentities.has(payload.channelIdentity)) {
    throw new HttpError(400, '代理身份无效。', 'INVALID_CHANNEL_IDENTITY');
  }
  if (!validRoles.has(payload.role)) throw new HttpError(400, '申请身份无效。', 'INVALID_ROLE');
  if (!validPractitionerTypes.has(payload.practitionerType)) {
    throw new HttpError(400, '从业类型无效。', 'INVALID_PRACTITIONER_TYPE');
  }
  const noteLength = Array.from(payload.practitionerTypeNote).length;
  if (payload.practitionerType === 'other') {
    if (noteLength < 2 || noteLength > 80 || /[\x00-\x1f<>]/.test(payload.practitionerTypeNote)) {
      throw new HttpError(400, '请填写 2-80 个字符的其他从业类型说明。', 'INVALID_PRACTITIONER_TYPE_NOTE');
    }
  } else if (payload.practitionerTypeNote) {
    throw new HttpError(400, '只有选择其他从业类型时才需要填写补充说明。', 'INVALID_PRACTITIONER_TYPE_NOTE');
  }
  return payload;
}

function shouldAutoActivateAdvisor(payload) {
  return payload.role === 'advisor' && autoAdvisorChannelIdentities.has(payload.channelIdentity);
}

function classifyAutoActivationRpcError(response, errorPayload) {
  const raw = [
    errorPayload?.code,
    errorPayload?.message,
    errorPayload?.details,
    errorPayload?.hint
  ].map(normalize).join(' ');
  if (response?.status === 404 || /schema cache|function .*v3a_auto_activate_advisor|not found/i.test(raw)) {
    return new HttpError(
      400,
      '普通指导师自动开通尚未在 Preview 数据库生效，请先确认 017 migration 已执行。',
      'AUTO_ADVISOR_RPC_NOT_READY'
    );
  }
  if (response?.status === 401 || response?.status === 403 || /42501|permission|not allowed|denied/i.test(raw)) {
    return new HttpError(
      400,
      '普通指导师自动开通权限未生效，请检查 Preview RPC 执行权限。',
      'AUTO_ADVISOR_RPC_PERMISSION'
    );
  }
  if (/ACCOUNT_NOT_ELIGIBLE_FOR_AUTO_ACTIVATION|IDENTITY_MAPPING_CONFLICT/.test(raw)) {
    return new HttpError(
      400,
      '当前手机号已存在非普通指导师账号，不能重复走普通指导师自动开通。',
      'AUTO_ADVISOR_ACCOUNT_NOT_ELIGIBLE'
    );
  }
  if (/AUTH_PHONE_NOT_VERIFIED|AUTH_PHONE_NOT_SUPPORTED|AUTH_PHONE_CLAIM_MISMATCH/.test(raw)) {
    return new HttpError(
      400,
      '手机号验证状态未通过自动开通校验，请重新短信登录后再试。',
      'AUTO_ADVISOR_PHONE_NOT_VERIFIED'
    );
  }
  if (/INCOMPLETE_AUTO_ACTIVATION_STATE|AUTO_ACTIVATION_FAILED/.test(raw)) {
    return new HttpError(
      400,
      '普通指导师自动开通事务未完整完成，请暂停重复提交并检查 Preview 数据库迁移状态。',
      'AUTO_ADVISOR_INCOMPLETE'
    );
  }
  return null;
}

async function authUserRequest(config, accessToken, method, body) {
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      method,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new HttpError(502, '账号密码服务暂时不可用。', 'AUTH_UPSTREAM_UNAVAILABLE');
  }
  return { response, payload: await readJson(response) };
}

async function updatePassword(config, session, password) {
  const { response, payload } = await authUserRequest(config, session.record.accessToken, 'PUT', {
    password,
    data: { v3a_password_set: true }
  });
  if (!response.ok || payload?.id !== session.record.authUserId) {
    throw new HttpError(502, '密码暂时无法保存，请稍后重试。', 'PASSWORD_UPDATE_FAILED');
  }
  session.user = payload;
}

async function markPasswordSet(config, accessToken) {
  await authUserRequest(config, accessToken, 'PUT', {
    data: { v3a_password_set: true }
  }).catch(() => null);
}

async function submitApplication(config, session, payload) {
  const rpcName = shouldAutoActivateAdvisor(payload)
    ? 'v3a_auto_activate_advisor'
    : 'v3a_submit_pending_application';
  const rpcBody = {
    p_display_name: payload.displayName,
    p_city: payload.city,
    ...(rpcName === 'v3a_submit_pending_application' ? { p_requested_role: payload.role } : {}),
    p_practitioner_type: payload.practitionerType,
    p_agreement_version: AGREEMENT_VERSION,
    p_accepted_rules: true,
    p_invite_code: payload.inviteCode || null,
    p_application_identity: payload.channelIdentity || null,
    p_practitioner_type_note: payload.practitionerTypeNote || null
  };
  let response;
  try {
    response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.record.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rpcBody)
    });
  } catch {
    response = null;
  }
  if (response?.ok) {
    const result = await readJson(response);
    if (result?.success === true) return;
    if (
      rpcName === 'v3a_auto_activate_advisor' &&
      result?.activated === true &&
      result?.role === 'advisor' &&
      result?.wallet_balance === 500 &&
      result?.activation_type === 'AUTO_ADVISOR'
    ) return;
  } else if (rpcName === 'v3a_auto_activate_advisor') {
    const errorPayload = response ? await readJson(response) : null;
    const safeError = classifyAutoActivationRpcError(response, errorPayload);
    if (safeError) throw safeError;
  }
  try {
    const current = await readCurrentApplication(config, session);
    if (
      shouldAutoActivateAdvisor(payload) &&
      current.user?.status === 'active' && current.user?.role === 'advisor' &&
      current.profile?.status === 'active' && current.profile?.role === 'advisor' &&
      current.wallet?.balance === 500 && current.inviteCode
    ) return;
    const profile = current.profile;
    const review = current.applicationReview;
    if (
      current.user?.status === 'pending' && profile?.status === 'pending' && review?.status === 'pending' &&
      profile.role === payload.role && review.role === payload.role &&
      profile.nickname === payload.displayName && review.appliedNickname === payload.displayName &&
      profile.city === payload.city && review.appliedCity === payload.city &&
      profile.practitionerType === payload.practitionerType && review.practitionerType === payload.practitionerType &&
      normalize(review.inviteCode) === payload.inviteCode
    ) return;
  } catch {
    // Keep the public result generic when verification also fails.
  }
  throw new HttpError(502, '申请提交结果暂未确认，请稍后重试。', 'APPLICATION_RESULT_UNKNOWN');
}

async function passwordLogin(config, phone, password, req) {
  if (!config.phoneOtpEnabled) {
    throw new HttpError(503, '手机号登录尚未开放。', 'PHONE_LOGIN_DISABLED');
  }
  await consumeRateLimit(config, 'password-login-ip', requestIp(req), 20, 600);
  await consumeRateLimit(config, 'password-login-phone', phone, 10, 600);
  const { response, payload } = await authRequest(
    config,
    '/token?grant_type=password',
    { phone, password }
  );
  if (response.status === 429) throw new HttpError(429, '操作过于频繁，请稍后重试。', 'RATE_LIMITED');
  if (!response.ok) throw new HttpError(400, '手机号或密码不正确。', 'PASSWORD_LOGIN_FAILED');
  if (canonicalVerifiedPhone(payload?.user?.phone) !== phone || !payload?.user?.phone_confirmed_at) {
    throw new HttpError(502, '登录身份验证结果无效。', 'INVALID_SESSION');
  }
  await markPasswordSet(config, payload.access_token);
  return payload;
}

async function requestOtp(config, phone, req) {
  if (!config.phoneOtpEnabled) {
    throw new HttpError(503, '手机号短信登录尚未开放。', 'PHONE_OTP_DISABLED');
  }
  await consumeRateLimit(config, 'otp-send-ip', requestIp(req), 10, 600);
  await consumeRateLimit(config, 'otp-send-phone', phone, 5, 600);
  const { response } = await authRequest(config, '/otp', { phone, channel: 'sms', create_user: true });
  if (response.status === 429) throw new HttpError(429, '操作过于频繁，请稍后重试。', 'RATE_LIMITED');
  if (!response.ok) throw new HttpError(502, '验证码暂时无法发送，请稍后重试。', 'OTP_SEND_FAILED');
}

async function verifyOtp(config, phone, token, req) {
  if (!config.phoneOtpEnabled) {
    throw new HttpError(503, '手机号短信登录尚未开放。', 'PHONE_OTP_DISABLED');
  }
  await consumeRateLimit(config, 'otp-verify-ip', requestIp(req), 20, 600);
  await consumeRateLimit(config, 'otp-verify-phone', phone, 10, 600);
  const { response, payload } = await authRequest(config, '/verify', { phone, token, type: 'sms' });
  if (response.status === 429) throw new HttpError(429, '操作过于频繁，请稍后重试。', 'RATE_LIMITED');
  if (!response.ok) throw new HttpError(400, '验证码不正确或已失效。', 'OTP_VERIFY_FAILED');
  if (canonicalVerifiedPhone(payload?.user?.phone) !== phone || !payload?.user?.phone_confirmed_at) {
    throw new HttpError(502, '登录身份验证结果无效。', 'INVALID_SESSION');
  }
  return payload;
}

async function handler(req, res) {
  setPrivateHeaders(res);
  res.setHeader('Allow', 'GET, POST');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const config = getConfig();
    const action = String(req.query?.action || '');

    if (req.method === 'GET' && action === 'capabilities') {
      return res.status(200).json({ ok: true, phoneOtpEnabled: config.phoneOtpEnabled });
    }
    if (req.method === 'GET' && action === 'me') {
      const session = await getSession(req, res, config);
      const me = await readCurrentApplication(config, session);
      return res.status(200).json({ ok: true, me, next: nextPath(me), csrfToken: session.csrfToken });
    }

    if (req.method === 'POST') {
      requireSameOrigin(req, config);
      requireJsonRequest(req);
    }
    const body = req.method === 'POST' ? readRequestBody(req) : {};

    if (req.method === 'POST' && action === 'request_otp') {
      await requestOtp(config, normalizeChinaPhone(body.phone), req);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && action === 'verify_otp') {
      const phone = normalizeChinaPhone(body.phone);
      const token = normalize(body.token);
      if (!/^[0-9]{6}$/.test(token)) throw new HttpError(400, '请输入 6 位短信验证码。', 'INVALID_OTP');
      const authPayload = await verifyOtp(config, phone, token, req);
      const previousSid = readSessionId(req);
      if (previousSid) await destroySession(config, previousSid);
      const session = await createSession(config, res, authPayload);
      const me = await readCurrentApplication(config, session);
      if (body.resetPassword === true) me.requiresPasswordSetup = true;
      if (body.resetPassword === true) me.passwordReset = true;
      return res.status(200).json({ ok: true, me, next: nextPath(me), csrfToken: session.csrfToken });
    }
    if (req.method === 'POST' && action === 'password_login') {
      const phone = normalizeChinaPhone(body.phone);
      const password = String(body.password || '');
      const authPayload = await passwordLogin(config, phone, password, req);
      const previousSid = readSessionId(req);
      if (previousSid) await destroySession(config, previousSid);
      const session = await createSession(config, res, authPayload);
      const me = await readCurrentApplication(config, session);
      return res.status(200).json({ ok: true, me, next: nextPath(me), csrfToken: session.csrfToken });
    }
    if (req.method === 'POST' && action === 'set_password') {
      const loaded = await loadSession(req, config);
      requireCsrf(req, loaded);
      const session = await resolveSession(config, loaded);
      const password = validatePassword(body.password, body.passwordConfirm);
      await updatePassword(config, session, password);
      const me = await readCurrentApplication(config, session);
      return res.status(200).json({ ok: true, me, next: nextPath(me), csrfToken: session.csrfToken });
    }
    if (req.method === 'POST' && action === 'submit_application') {
      const loaded = await loadSession(req, config);
      requireCsrf(req, loaded);
      const session = await resolveSession(config, loaded);
      if (!passwordIsSet(session.user)) {
        throw new HttpError(400, '请先设置登录密码。', 'PASSWORD_SETUP_REQUIRED');
      }
      const payload = validateApplication(body);
      await submitApplication(config, session, payload);
      const me = await readCurrentApplication(config, session);
      return res.status(200).json({ ok: true, me, next: nextPath(me), csrfToken: session.csrfToken });
    }
    if (req.method === 'POST' && action === 'logout') {
      const sid = readSessionId(req);
      if (!sid) {
        clearSessionCookie(res);
        return res.status(200).json({ ok: true });
      }
      const loaded = await loadSession(req, config);
      requireCsrf(req, loaded);
      await destroySession(config, sid);
      clearSessionCookie(res);
      await authRequest(config, '/logout?scope=local', undefined, loaded.record.accessToken).catch(() => null);
      return res.status(200).json({ ok: true });
    }
    throw new HttpError(400, '不支持的 action。', 'INVALID_ACTION');
  } catch (error) {
    if (error?.code === 'UNAUTHENTICATED') clearSessionCookie(res);
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
    const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    return res.status(statusCode).json({ ok: false, error: message, code });
  }
}

module.exports = handler;
