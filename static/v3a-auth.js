(function () {
  'use strict';

  const page = document.body?.dataset?.v3aAuthPage;
  if (!page) return;

  const AGREEMENT_VERSION = 'v3a-phase-b-preview-2026-07-09';
  const PREVIEW_PROJECT_REF = 'lmjriqncuopgxwyudfee';
  const PRODUCTION_PROJECT_REF = 'tysbwijizgebnrazxpvo';
  const PHONE_OTP_ENABLED = window.AIPIWEN_V3A_PHONE_OTP_ENABLED === true;
  const validRoles = new Set(['advisor', 'agent', 'center']);
  const validPractitionerTypes = new Set(['independent', 'organization', 'agent', 'center', 'other']);
  const roleLabels = {
    advisor: '指导师',
    agent: '代理',
    center: '采集中心',
    pending: '待审核身份'
  };

  let cachedClient = null;

  function $(selector) {
    return document.querySelector(selector);
  }

  function normalize(value) {
    return String(value || '').trim();
  }

  function showMessage(selector, message) {
    const node = $(selector);
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  function setText(selector, value, fallback = '未记录') {
    const node = $(selector);
    if (node) node.textContent = normalize(value) || fallback;
  }

  function setBusy(form, busy) {
    form?.querySelectorAll('button, input, select').forEach((node) => {
      node.disabled = busy;
    });
  }

  function normalizeChinaPhone(value) {
    let phone = normalize(value).replace(/[\s()-]/g, '');
    if (phone.startsWith('+86')) phone = phone.slice(3);
    else if (phone.startsWith('0086')) phone = phone.slice(4);
    else if (phone.startsWith('86') && phone.length === 13) phone = phone.slice(2);
    if (!/^1[3-9][0-9]{9}$/.test(phone)) {
      throw new Error('请输入有效的中国大陆手机号。');
    }
    return `+86${phone}`;
  }

  function maskPhone(phone) {
    const normalizedPhone = normalize(phone);
    if (!/^\+861[3-9][0-9]{9}$/.test(normalizedPhone)) return '已验证手机号';
    return `+86 ${normalizedPhone.slice(3, 6)}****${normalizedPhone.slice(-4)}`;
  }

  async function loadGeneratedConfig() {
    if (window.AIPIWEN_V3A_SUPABASE) return;
    await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = '/static/v3a-env.js';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  }

  async function getClient() {
    if (cachedClient) return cachedClient;
    await loadGeneratedConfig();
    const config = window.AIPIWEN_V3A_SUPABASE || {};
    const supabaseUrl = normalize(config.supabaseUrl);
    const supabaseAnonKey = normalize(config.supabaseAnonKey);
    const projectRef = normalize(config.projectRef);
    let parsed;
    try {
      parsed = new URL(supabaseUrl);
    } catch {
      parsed = null;
    }
    if (
      !supabaseUrl || !supabaseAnonKey || !window.supabase?.createClient ||
      projectRef === PRODUCTION_PROJECT_REF || projectRef !== PREVIEW_PROJECT_REF ||
      parsed?.protocol !== 'https:' || parsed?.hostname !== `${PREVIEW_PROJECT_REF}.supabase.co` ||
      parsed?.pathname !== '/'
    ) {
      throw new Error('手机号登录组件尚未完成 Preview 配置。');
    }
    cachedClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    });
    return cachedClient;
  }

  async function getVerifiedPhoneUser(client, expectedPhone) {
    let result;
    try {
      result = await client.auth.getUser();
    } catch {
      throw new Error('登录状态无效，请重新登录。');
    }
    const user = result?.data?.user;
    if (result?.error || !user) throw new Error('登录状态无效，请重新登录。');
    if (!user.phone || !user.phone_confirmed_at) {
      throw new Error('手机号尚未完成验证，请重新登录。');
    }
    if (expectedPhone && user.phone !== expectedPhone) {
      throw new Error('手机号验证状态不一致，请重新登录。');
    }
    return user;
  }

  async function selectCurrentApplication(client) {
    const authUser = await getVerifiedPhoneUser(client);
    const { data: user, error: userError } = await client
      .from('users')
      .select('id,role,status,display_name,city,created_at,last_login_at')
      .eq('auth_user_id', authUser.id)
      .maybeSingle();
    if (userError) throw new Error('账号状态暂时无法读取，请稍后重试。');
    if (!user) return { user: null, profile: null, applicationReview: null };

    const [{ data: profile, error: profileError }, { data: applicationReview, error: reviewError }] = await Promise.all([
      client
        .from('advisor_profiles')
        .select('id,role,status,nickname,city,practitioner_type,created_at')
        .eq('user_id', user.id)
        .maybeSingle(),
      client
        .from('application_reviews')
        .select('id,role,status,applied_city,applied_nickname,practitioner_type,invite_code,review_note,created_at,reviewed_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);
    if (profileError || reviewError) throw new Error('申请状态暂时无法读取，请稍后重试。');
    return { user, profile, applicationReview };
  }

  function routeByStatus(me, messageSelector) {
    if (!me?.user) {
      window.location.href = '/advisor-register.html';
      return;
    }
    const { role, status } = me.user;
    if (status === 'pending') {
      window.location.href = '/advisor-pending.html';
      return;
    }
    if (status === 'active' && role === 'super_admin') {
      window.location.href = '/admin-applications.html';
      return;
    }
    if (status === 'active' && validRoles.has(role)) {
      window.location.href = '/ai-interpreter-workbench.html';
      return;
    }
    if (status === 'rejected') {
      showMessage(messageSelector, '申请未通过。如需复核，请联系 AIPIWEN 总部。');
      return;
    }
    if (status === 'frozen' || status === 'disabled') {
      showMessage(messageSelector, '账号当前不可用，请联系 AIPIWEN 总部处理。');
      return;
    }
    showMessage(messageSelector, '账号状态无法识别，请联系 AIPIWEN 总部。');
  }

  function validateApplication(payload) {
    if (!payload.acceptedRules) throw new Error('请先勾选同意从业者协议和四条规则。');
    if (Array.from(payload.displayName).length < 2) throw new Error('请填写至少 2 个字符的昵称或从业名。');
    if (!payload.city) throw new Error('请填写城市。');
    if (!validRoles.has(payload.role)) throw new Error('身份选择无效。');
    if (!validPractitionerTypes.has(payload.practitionerType)) throw new Error('从业类型无效。');
  }

  function registrationError(error) {
    const marker = normalize(error?.message);
    const code = normalize(error?.code);
    if (marker === 'UNAUTHENTICATED' || code === '42501') return '登录状态已失效，请重新登录。';
    if ([
      'AUTH_USER_NOT_FOUND', 'AUTH_USER_UNAVAILABLE', 'AUTH_PHONE_NOT_VERIFIED',
      'AUTH_PHONE_NOT_SUPPORTED', 'AUTH_PHONE_CLAIM_MISMATCH',
      'AUTH_IDENTITY_NOT_VERIFIED', 'IDENTITY_MAPPING_CONFLICT'
    ].includes(marker)) return '当前登录身份无法提交申请，请重新登录或联系 AIPIWEN 总部。';
    if ([
      'INVALID_DISPLAY_NAME', 'INVALID_CITY', 'INVALID_REQUESTED_ROLE',
      'INVALID_PRACTITIONER_TYPE', 'INVALID_AGREEMENT', 'INVALID_INVITE_CODE',
      'REGISTRATION_CONFLICT'
    ].includes(marker) || code === '22023') return '申请资料未通过校验，请检查后重试。';
    if (marker === 'PARTIAL_REGISTRATION_STATE' || marker === 'REGISTRATION_IDENTITY_CONFLICT' || code === '23505') {
      return '申请状态异常，请联系 AIPIWEN 总部处理。';
    }
    return '申请提交结果暂未确认，请稍后重试；重复提交不会重复创建。';
  }

  async function insertPendingApplication(client, payload) {
    validateApplication(payload);
    await getVerifiedPhoneUser(client);
    let result;
    try {
      result = await client.rpc('v3a_submit_pending_application', {
        p_display_name: payload.displayName,
        p_city: payload.city,
        p_requested_role: payload.role,
        p_practitioner_type: payload.practitionerType,
        p_agreement_version: AGREEMENT_VERSION,
        p_accepted_rules: true,
        p_invite_code: payload.inviteCode || null
      });
    } catch {
      result = { data: null, error: null };
    }

    if (result?.error || result?.data?.success !== true) {
      try {
        const current = await selectCurrentApplication(client);
        if (current.user && current.profile && current.applicationReview) return current;
      } catch {
        // Public error remains generic when the verification read also fails.
      }
      throw new Error(registrationError(result?.error));
    }
    return selectCurrentApplication(client);
  }

  function otpError(error, stage) {
    const code = normalize(error?.code);
    const status = Number(error?.status || 0);
    if (status === 429 || code.includes('rate_limit')) return '操作过于频繁，请稍后重试。';
    if (stage === 'verify' && (code === 'otp_expired' || code === 'token_expired')) {
      return '验证码已失效，请重新获取。';
    }
    return stage === 'send'
      ? '验证码暂时无法发送，请稍后重试。'
      : '验证码不正确或已失效，请重新输入。';
  }

  async function initLogin() {
    const form = $('#v3a-phone-auth-form') || $('#v3a-login-form');
    const sendButton = $('#v3a-send-otp') || $('#v3a-send-otp-button');
    const messageSelector = '#v3a-login-message';
    if (!form || !sendButton) return;

    if (!PHONE_OTP_ENABLED) {
      sendButton.disabled = true;
      showMessage(messageSelector, '手机号短信登录正在完成云端验收，当前不会发送验证码。');
    }

    sendButton.addEventListener('click', async () => {
      showMessage(messageSelector, '');
      if (!PHONE_OTP_ENABLED) {
        showMessage(messageSelector, '手机号短信登录尚未开放，当前不会发送验证码。');
        return;
      }
      let phone;
      try {
        phone = normalizeChinaPhone(form.elements.phone?.value || new FormData(form).get('phone'));
      } catch (error) {
        showMessage(messageSelector, error.message);
        return;
      }
      setBusy(form, true);
      try {
        const client = await getClient();
        const { error } = await client.auth.signInWithOtp({
          phone,
          options: { shouldCreateUser: true }
        });
        if (error) throw new Error(otpError(error, 'send'));
        showMessage(messageSelector, '验证码已发送，请查看短信。');
      } catch (error) {
        showMessage(messageSelector, error.message?.startsWith('验证码') ? error.message : otpError(null, 'send'));
      } finally {
        setBusy(form, false);
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(messageSelector, '');
      if (!PHONE_OTP_ENABLED) {
        showMessage(messageSelector, '手机号短信登录尚未开放，当前不会验证或创建账号。');
        return;
      }
      const formData = new FormData(form);
      let phone;
      try {
        phone = normalizeChinaPhone(formData.get('phone'));
      } catch (error) {
        showMessage(messageSelector, error.message);
        return;
      }
      const token = normalize(formData.get('otp') || formData.get('token'));
      if (!/^[0-9]{6}$/.test(token)) {
        showMessage(messageSelector, '请输入 6 位短信验证码。');
        return;
      }
      setBusy(form, true);
      try {
        const client = await getClient();
        const { data, error } = await client.auth.verifyOtp({ phone, token, type: 'sms' });
        if (error || !data?.session) throw new Error(otpError(error, 'verify'));
        await getVerifiedPhoneUser(client, phone);
        const me = await selectCurrentApplication(client);
        routeByStatus(me, messageSelector);
      } catch (error) {
        const safeMessage = error.message && (
          error.message.includes('手机号') || error.message.includes('验证码') || error.message.includes('登录状态')
        ) ? error.message : otpError(null, 'verify');
        showMessage(messageSelector, safeMessage);
      } finally {
        setBusy(form, false);
      }
    });
  }

  async function initRegister() {
    const form = $('#v3a-register-form');
    const messageSelector = '#v3a-register-message';
    if (!form) return;
    let identityReady = false;
    try {
      const client = await getClient();
      const user = await getVerifiedPhoneUser(client);
      setText('#v3a-verified-phone', maskPhone(user.phone));
      const current = await selectCurrentApplication(client);
      if (current.user) {
        routeByStatus(current, messageSelector);
        return;
      }
      identityReady = true;
    } catch (error) {
      showMessage(messageSelector, error.message);
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(messageSelector, '');
      if (!identityReady) {
        showMessage(messageSelector, '请先在统一登录页完成手机号验证。');
        return;
      }
      const formData = new FormData(form);
      const payload = {
        displayName: normalize(formData.get('displayName')),
        city: normalize(formData.get('city')),
        role: normalize(formData.get('role')),
        practitionerType: normalize(formData.get('practitionerType')),
        inviteCode: normalize(formData.get('inviteCode')).toUpperCase(),
        acceptedRules: form.elements.acceptedRules?.checked === true
      };
      setBusy(form, true);
      try {
        const client = await getClient();
        const me = await insertPendingApplication(client, payload);
        routeByStatus(me, messageSelector);
      } catch (error) {
        showMessage(messageSelector, error.message?.startsWith('申请') || error.message?.startsWith('请')
          ? error.message
          : registrationError(null));
      } finally {
        setBusy(form, false);
      }
    });
  }

  function formatTime(value) {
    if (!value) return '未记录';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }

  async function initPending() {
    const messageSelector = '#v3a-pending-message';
    try {
      const client = await getClient();
      const me = await selectCurrentApplication(client);
      if (!me.user) {
        window.location.href = '/advisor-register.html';
        return;
      }
      const role = me.profile?.role || me.applicationReview?.role || me.user.role;
      setText('#v3a-current-role', roleLabels[role] || role);
      setText('#v3a-current-status', me.user.status);
      setText('#v3a-submitted-at', formatTime(me.applicationReview?.created_at || me.user.created_at));
      setText('#v3a-review-note', me.applicationReview?.review_note || '总部审核后更新');
      if (me.user.status !== 'pending') routeByStatus(me, messageSelector);
    } catch (error) {
      showMessage(messageSelector, error.message);
    }

    $('#v3a-logout-button')?.addEventListener('click', async () => {
      try {
        const client = await getClient();
        await client.auth.signOut();
      } finally {
        window.location.href = '/login.html';
      }
    });
  }

  if (page === 'login') initLogin();
  if (page === 'register') initRegister();
  if (page === 'pending') initPending();
})();
