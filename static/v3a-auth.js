(function () {
  'use strict';

  const page = document.body?.dataset?.v3aAuthPage;
  if (!page) return;

  const SESSION_API = '/api/v3a-session';
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
  const roleLabels = {
    advisor: '指导师',
    agent: '分公司',
    center: '服务中心/采集中心',
    pending: '待审核身份'
  };
  const channelRoleMap = {
    branch_company: 'agent',
    service_center: 'center',
    collection_center: 'center',
    ordinary_advisor: 'advisor'
  };
  let csrfToken = '';

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
    if (!/^1[3-9][0-9]{9}$/.test(phone)) throw new Error('请输入有效的中国大陆手机号。');
    return `+86${phone}`;
  }

  async function requestSession(action, options = {}) {
    const query = new URLSearchParams({ action });
    const method = options.method || 'GET';
    const isPost = method === 'POST';
    let response;
    try {
      response = await fetch(`${SESSION_API}?${query.toString()}`, {
        method,
        credentials: 'same-origin',
        headers: isPost ? {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
        } : undefined,
        body: isPost ? JSON.stringify(options.body || {}) : undefined
      });
    } catch {
      throw Object.assign(new Error('账号服务暂时不可用，请稍后重试。'), { status: 502 });
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Keep the public error generic when the service response is malformed.
    }
    if (!response.ok || payload?.ok !== true) {
      throw Object.assign(new Error(payload?.error || '账号服务暂时不可用，请稍后重试。'), {
        status: response.status,
        code: payload?.code || 'REQUEST_FAILED'
      });
    }
    if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
    return payload;
  }

  function routeByStatus(me, messageSelector) {
    if (me?.passwordReset) {
      window.location.href = '/advisor-register.html?set_password=1';
      return;
    }
    if (!me?.user) {
      window.location.href = me?.requiresPasswordSetup
        ? '/advisor-register.html?set_password=1'
        : '/advisor-register.html';
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
    if (me?.requiresPasswordSetup) {
      window.location.href = '/advisor-register.html?set_password=1';
      return;
    }
    if (status === 'rejected') {
      showMessage(messageSelector, '您的指导师准入申请未通过平台审核。');
      return;
    }
    if (status === 'frozen' || status === 'disabled') {
      showMessage(messageSelector, '账号当前不可用，请联系平台超级管理员处理。');
      return;
    }
    showMessage(messageSelector, '账号状态无法识别，请联系平台超级管理员。');
  }

  function passwordLooksValid(value) {
    return String(value || '').length >= 8 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
  }

  function applicationMode(payload) {
    return payload.role === 'advisor' && autoAdvisorChannelIdentities.has(payload.channelIdentity)
      ? 'auto_advisor'
      : 'institution_pending';
  }

  function validateApplication(payload) {
    if (!payload.acceptedRules) throw new Error('请先勾选同意从业者协议和四条规则。');
    if (Array.from(payload.displayName).length < 2) throw new Error('请填写至少 2 个字符的昵称或从业名。');
    if (!payload.city) throw new Error('请填写城市。');
    if (!validChannelIdentities.has(payload.channelIdentity)) throw new Error('代理身份选择无效。');
    if (!validRoles.has(payload.role)) throw new Error('身份选择无效。');
    if (!validPractitionerTypes.has(payload.practitionerType)) throw new Error('从业类型无效。');
    const noteLength = Array.from(payload.practitionerTypeNote || '').length;
    if (payload.practitionerType === 'other') {
      if (noteLength < 2 || noteLength > 80 || /[\x00-\x1f<>]/.test(payload.practitionerTypeNote)) {
        throw new Error('请填写 2-80 个字符的其他从业类型说明。');
      }
    } else if (payload.practitionerTypeNote) {
      throw new Error('只有选择其他从业类型时才需要填写补充说明。');
    }
  }

  function safeApplicationError(error) {
    if (error?.status === 401) return '登录状态已失效，请重新登录。';
    if (error?.status === 400 && normalize(error?.message)) return error.message;
    if (error?.status === 403) return '请求来源校验未通过，请刷新页面后重试。';
    return '申请提交结果暂未确认，请稍后重试；重复提交不会重复创建。';
  }

  async function initLogin() {
    const form = $('#v3a-phone-auth-form') || $('#v3a-login-form');
    const passwordForm = $('#v3a-password-login-form');
    const sendButton = $('#v3a-send-otp') || $('#v3a-send-otp-button');
    const loginButton = form?.querySelector('button[type="submit"]');
    const passwordButton = passwordForm?.querySelector('button[type="submit"]');
    const messageSelector = '#v3a-login-message';
    const passwordMessageSelector = '#v3a-password-login-message';
    if (!form || !sendButton) return;

    function showPhoneLoginStatus(enabled, unavailable = false) {
      const status = $('#v3a-phone-login-status');
      if (status) {
        status.className = enabled ? 'status done' : 'status pending';
        status.textContent = unavailable
          ? '账号服务暂时不可用'
          : enabled ? '短信登录已开放' : '短信登录尚未开放';
      }
      setText('#v3a-phone-login-heading', unavailable
        ? '短信登录暂不可用'
        : enabled ? '短信登录已开放' : '短信登录尚未开放');
      setText('#v3a-phone-login-description', unavailable
        ? '请稍后刷新页面重试。'
        : enabled
          ? '输入中国大陆手机号获取验证码，验证通过后即可继续。'
          : '当前不会发送验证码，请等待平台开放短信登录。');
    }

    let phoneOtpEnabled = false;
    let otpRequestPending = false;
    let otpVerifyPending = false;
    let passwordLoginPending = false;
    let resetPasswordMode = false;
    let otpCooldownSeconds = 0;
    let otpCooldownTimer = null;
    let currentAuthMode = 'password';

    function otpInput() {
      return form.elements.otp || form.elements.token || $('#v3a-otp');
    }

    function setLoginButtonBusy(busy) {
      if (!loginButton) return;
      loginButton.textContent = busy ? '正在登录…' : '登录';
    }

    function setPasswordButtonBusy(busy) {
      if (!passwordButton) return;
      passwordButton.textContent = busy ? '正在登录…' : '登录';
    }

    function setAuthMode(mode) {
      const useSms = mode === 'sms';
      currentAuthMode = useSms ? 'sms' : 'password';
      form.hidden = false;
      if (passwordForm) passwordForm.hidden = false;
      form.classList.toggle('is-front', useSms);
      form.classList.toggle('is-back', !useSms);
      if (passwordForm) {
        passwordForm.classList.toggle('is-front', !useSms);
        passwordForm.classList.toggle('is-back', useSms);
      }
      form.setAttribute('aria-hidden', String(!useSms));
      if (passwordForm) passwordForm.setAttribute('aria-hidden', String(useSms));
      form.querySelectorAll('input, button').forEach((control) => {
        control.tabIndex = useSms ? 0 : -1;
      });
      passwordForm?.querySelectorAll('input, button').forEach((control) => {
        control.tabIndex = useSms ? -1 : 0;
      });
      $('#v3a-password-tab')?.classList.toggle('active', !useSms);
      $('#v3a-sms-tab')?.classList.toggle('active', useSms);
      setText('#v3a-phone-login-description', useSms
        ? '第一次使用或忘记密码，请获取短信验证码。'
        : '已设置密码的账号，可直接用手机号和密码登录。');
      showMessage(messageSelector, '');
      showMessage(passwordMessageSelector, '');
    }

    $('#v3a-password-tab')?.addEventListener('click', () => {
      resetPasswordMode = false;
      setAuthMode('password');
    });
    $('#v3a-sms-tab')?.addEventListener('click', () => {
      resetPasswordMode = false;
      setAuthMode('sms');
    });
    $('#v3a-forgot-password')?.addEventListener('click', () => {
      resetPasswordMode = true;
      setAuthMode('sms');
      showMessage(messageSelector, '请输入短信验证码，验证后即可设置新密码。');
      const phone = passwordForm?.elements?.phone?.value;
      if (phone) form.elements.phone.value = phone;
    });

    function resetOtpSendButton() {
      if (otpCooldownTimer !== null) clearInterval(otpCooldownTimer);
      otpCooldownTimer = null;
      otpCooldownSeconds = 0;
      sendButton.disabled = !phoneOtpEnabled;
      sendButton.textContent = '获取验证码';
    }

    function startOtpCooldown() {
      otpCooldownSeconds = 60;
      sendButton.disabled = true;
      sendButton.textContent = `${otpCooldownSeconds} 秒后重试`;
      otpCooldownTimer = setInterval(() => {
        otpCooldownSeconds -= 1;
        if (otpCooldownSeconds <= 0) {
          resetOtpSendButton();
          return;
        }
        sendButton.textContent = `${otpCooldownSeconds} 秒后重试`;
      }, 1000);
    }

    sendButton.disabled = true;
    try {
      const capabilities = await requestSession('capabilities');
      phoneOtpEnabled = capabilities.phoneOtpEnabled === true;
      sendButton.disabled = !phoneOtpEnabled;
      showPhoneLoginStatus(phoneOtpEnabled);
      setAuthMode(currentAuthMode);
      if (!phoneOtpEnabled) {
        showMessage(messageSelector, '手机号短信登录尚未开放，当前不会发送验证码。');
      }
    } catch (error) {
      showPhoneLoginStatus(false, true);
      showMessage(messageSelector, error.message);
    }

    try {
      const current = await requestSession('me');
      routeByStatus(current.me, messageSelector);
      return;
    } catch (error) {
      if (error.status !== 401) showMessage(messageSelector, error.message);
    }

    sendButton.addEventListener('click', async () => {
      if (otpRequestPending || otpCooldownSeconds > 0) return;
      showMessage(messageSelector, '');
      if (!phoneOtpEnabled) {
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
      otpRequestPending = true;
      sendButton.textContent = '发送中…';
      setBusy(form, true);
      let sent = false;
      try {
        await requestSession('request_otp', { method: 'POST', body: { phone } });
        sent = true;
        const otp = otpInput();
        if (otp) {
          otp.value = '';
          otp.focus?.();
        }
        showMessage(messageSelector, '验证码已发送，10 分钟内有效；60 秒后可重新获取。');
      } catch (error) {
        showMessage(messageSelector, error.message);
      } finally {
        otpRequestPending = false;
        setBusy(form, false);
        if (sent) startOtpCooldown();
        else resetOtpSendButton();
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (otpVerifyPending) return;
      showMessage(messageSelector, '');
      if (!phoneOtpEnabled) {
        showMessage(messageSelector, '手机号短信登录尚未开放，当前不会验证或创建账号。');
        return;
      }
      if (otpRequestPending) {
        showMessage(messageSelector, '验证码正在发送，请稍后再登录。');
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
      otpVerifyPending = true;
      setBusy(form, true);
      setLoginButtonBusy(true);
      showMessage(messageSelector, '正在验证验证码，请稍候。');
      try {
        const result = await requestSession('verify_otp', { method: 'POST', body: { phone, token, resetPassword: resetPasswordMode } });
        routeByStatus(result.me, messageSelector);
      } catch (error) {
        showMessage(messageSelector, error.message);
      } finally {
        otpVerifyPending = false;
        setBusy(form, false);
        setLoginButtonBusy(false);
        sendButton.disabled = otpCooldownSeconds > 0 || !phoneOtpEnabled;
      }
    });

    passwordForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (passwordLoginPending) return;
      showMessage(passwordMessageSelector, '');
      let phone;
      try {
        phone = normalizeChinaPhone(passwordForm.elements.phone?.value);
      } catch (error) {
        showMessage(passwordMessageSelector, error.message);
        return;
      }
      const password = String(passwordForm.elements.password?.value || '');
      if (!password) {
        showMessage(passwordMessageSelector, '请输入登录密码。');
        return;
      }
      passwordLoginPending = true;
      setBusy(passwordForm, true);
      setPasswordButtonBusy(true);
      try {
        const result = await requestSession('password_login', { method: 'POST', body: { phone, password } });
        routeByStatus(result.me, passwordMessageSelector);
      } catch (error) {
        if (error.code === 'PASSWORD_LOGIN_FAILED') {
          if (form.elements.phone) form.elements.phone.value = phone;
          setAuthMode('sms');
          showMessage(messageSelector, '如果是第一次使用或忘记密码，请获取短信验证码。验证后即可继续。');
        } else {
          showMessage(passwordMessageSelector, error.message);
        }
      } finally {
        passwordLoginPending = false;
        setBusy(passwordForm, false);
        setPasswordButtonBusy(false);
      }
    });
  }

  async function initRegister() {
    const form = $('#v3a-register-form');
    const passwordForm = $('#v3a-password-setup-form');
    const messageSelector = '#v3a-register-message';
    const passwordMessageSelector = '#v3a-password-setup-message';
    if (!form) return;
    const practitionerType = form.elements.practitionerType;
    const practitionerTypeNote = form.elements.practitionerTypeNote;
    const practitionerTypeNoteRow = $('#v3a-practitioner-other-note-row');

    function syncPractitionerTypeNote() {
      const needsNote = practitionerType?.value === 'other';
      if (practitionerTypeNoteRow) practitionerTypeNoteRow.hidden = !needsNote;
      if (practitionerTypeNote) {
        practitionerTypeNote.required = needsNote;
        if (!needsNote) practitionerTypeNote.value = '';
      }
    }

    practitionerType?.addEventListener('change', syncPractitionerTypeNote);
    syncPractitionerTypeNote();

    function showPasswordStep() {
      if (passwordForm) passwordForm.hidden = false;
      form.hidden = true;
      setText('#v3a-register-intro', '请先设置登录密码。保存后继续填写从业资料。');
    }

    function showApplicationStep() {
      if (passwordForm) passwordForm.hidden = true;
      form.hidden = false;
      setText('#v3a-register-intro', '当前已验证手机号。普通指导师提交后直接进入工作台，机构身份提交审核。');
    }

    function syncApplicationModeNote() {
      const role = channelRoleMap[normalize(form.elements.channelIdentity?.value)] || 'advisor';
      const mode = role === 'advisor' && autoAdvisorChannelIdentities.has(normalize(form.elements.channelIdentity?.value))
        ? '普通指导师将自动开通工作台、钱包、500 体验积分和邀请码。'
        : '机构身份将进入平台准入审核，审核通过后开通对应权限。';
      setText('#v3a-application-mode-note', mode, mode);
    }

    form.elements.channelIdentity?.addEventListener('change', syncApplicationModeNote);
    syncApplicationModeNote();

    let identityReady = false;
    let currentMe = null;
    try {
      const current = await requestSession('me');
      currentMe = current.me;
      const wantsPasswordSetup = new URLSearchParams(window.location.search).has('set_password');
      setText('#v3a-verified-phone', current.me?.phoneMasked, '已验证手机号');
      if (current.me?.user && !wantsPasswordSetup) {
        routeByStatus(current.me, messageSelector);
        return;
      }
      if (wantsPasswordSetup || current.me?.requiresPasswordSetup) {
        identityReady = true;
        showPasswordStep();
      } else {
        identityReady = true;
        showApplicationStep();
      }
    } catch (error) {
      showMessage(messageSelector, error.status === 401 ? '请先在统一登录页完成手机号验证。' : error.message);
    }

    passwordForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      showMessage(passwordMessageSelector, '');
      const password = passwordForm.elements.password?.value || '';
      const passwordConfirm = passwordForm.elements.passwordConfirm?.value || '';
      if (password !== passwordConfirm) {
        showMessage(passwordMessageSelector, '两次输入的密码不一致。');
        return;
      }
      if (!passwordLooksValid(password)) {
        showMessage(passwordMessageSelector, '密码至少 8 位，且必须包含字母和数字。');
        return;
      }
      setBusy(passwordForm, true);
      try {
        const result = await requestSession('set_password', {
          method: 'POST',
          body: { password, passwordConfirm }
        });
        currentMe = result.me;
        showMessage(passwordMessageSelector, '密码已保存，继续填写从业资料。');
        if (currentMe?.user) routeByStatus(currentMe, passwordMessageSelector);
        else showApplicationStep();
      } catch (error) {
        showMessage(passwordMessageSelector, error.message);
      } finally {
        setBusy(passwordForm, false);
      }
    });

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
        channelIdentity: normalize(formData.get('channelIdentity')),
        practitionerType: normalize(formData.get('practitionerType')),
        practitionerTypeNote: normalize(formData.get('practitionerTypeNote')),
        inviteCode: normalize(formData.get('inviteCode')).toUpperCase(),
        acceptedRules: form.elements.acceptedRules?.checked === true
      };
      payload.role = channelRoleMap[payload.channelIdentity] || 'advisor';
      payload.applicationMode = applicationMode(payload);
      try {
        validateApplication(payload);
      } catch (error) {
        showMessage(messageSelector, error.message);
        return;
      }
      setBusy(form, true);
      try {
        const result = await requestSession('submit_application', { method: 'POST', body: payload });
        if (payload.applicationMode === 'auto_advisor') {
          showMessage(messageSelector, '普通指导师账号已自动开通。');
        } else {
          showMessage(messageSelector, '您的机构准入申请已提交，平台审核通过后将开通相应权限。');
        }
        routeByStatus(result.me, messageSelector);
      } catch (error) {
        showMessage(messageSelector, safeApplicationError(error));
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

  async function logout(messageSelector) {
    try {
      await requestSession('logout', { method: 'POST' });
      csrfToken = '';
      window.location.href = '/login.html';
    } catch (error) {
      showMessage(messageSelector, error.message);
    }
  }

  function initMobileNavigation() {
    const sidebar = $('.sidebar');
    const nav = sidebar?.querySelector('.nav');
    if (!sidebar || !nav || sidebar.querySelector('.mobile-nav-toggle')) return;

    nav.id = nav.id || 'advisor-primary-nav';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mobile-nav-toggle';
    toggle.setAttribute('aria-controls', nav.id);
    toggle.innerHTML = '<span class="mobile-nav-icon" aria-hidden="true"><span></span><span></span><span></span></span><span>菜单</span>';

    function setOpen(open) {
      sidebar.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭工作台导航' : '打开工作台导航');
    }

    setOpen(false);
    sidebar.classList.add('mobile-nav-ready');
    sidebar.insertBefore(toggle, nav);
    toggle.addEventListener('click', () => setOpen(!sidebar.classList.contains('is-open')));
    nav.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !sidebar.classList.contains('is-open')) return;
      setOpen(false);
      toggle.focus();
    });
  }

  async function initWorkbench() {
    const messageSelector = '#v3a-workbench-message';
    $('#v3a-workbench-logout')?.addEventListener('click', () => logout(messageSelector));
    try {
      const current = await requestSession('me');
      const me = current.me;
      if (me?.user?.status !== 'active' || !validRoles.has(me.user.role)) {
        routeByStatus(me, messageSelector);
        return;
      }
      setText('#v3a-workbench-name', me.profile?.nickname || me.user.displayName, '已验证账号');
      setText('#v3a-workbench-city', me.profile?.city || me.user.city, '未设置');
      setText('#v3a-workbench-status', me.user.status, 'active');
      setText('#v3a-workbench-role', roleLabels[me.user.role] || me.user.role, '已激活');
      setText('#v3a-workbench-role-label', roleLabels[me.user.role] || me.user.role, '读取中');
      setText('#v3a-workbench-balance', me.wallet?.balance, '待同步');
      setText('#v3a-workbench-invite-code', me.inviteCode, '待生成');
      setText('#v3a-workbench-balance-copy', me.wallet?.balance, '待同步');
      setText('#v3a-workbench-invite-copy', me.inviteCode, '待生成');
      initMobileNavigation();
      document.body.hidden = false;
    } catch (error) {
      if (error.status === 401) window.location.href = '/login.html';
      else window.location.replace('/login.html?service_unavailable=1');
    }
  }

  async function initPending() {
    const messageSelector = '#v3a-pending-message';
    try {
      const current = await requestSession('me');
      const me = current.me;
      if (!me?.user) {
        window.location.href = '/advisor-register.html';
        return;
      }
      const role = me.profile?.role || me.applicationReview?.role || me.user.role;
      setText('#v3a-current-role', roleLabels[role] || role);
      setText('#v3a-current-status', me.user.status);
      setText('#v3a-submitted-at', formatTime(me.applicationReview?.createdAt || me.user.createdAt));
      setText('#v3a-review-note', me.applicationReview?.reviewNote || '平台准入审核后更新');
      if (me.user.status !== 'pending') routeByStatus(me, messageSelector);
    } catch (error) {
      if (error.status === 401) window.location.href = '/login.html';
      else showMessage(messageSelector, error.message);
    }

    $('#v3a-logout-button')?.addEventListener('click', () => logout(messageSelector));
  }

  if (page === 'login') initLogin();
  if (page === 'register') initRegister();
  if (page === 'pending') initPending();
  if (page === 'workbench') initWorkbench();
})();
