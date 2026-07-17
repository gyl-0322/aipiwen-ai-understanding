(function () {
  'use strict';

  const page = document.body?.dataset?.v3aAuthPage;
  if (!page) return;

  const SESSION_API = '/api/v3a-session';
  const validRoles = new Set(['advisor', 'agent', 'center']);
  const validPractitionerTypes = new Set(['independent', 'organization', 'agent', 'center', 'other']);
  const roleLabels = {
    advisor: '指导师',
    agent: '代理',
    center: '采集中心',
    pending: '待审核身份'
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

  function safeApplicationError(error) {
    if (error?.status === 401) return '登录状态已失效，请重新登录。';
    if (error?.status === 400 && normalize(error?.message)) return error.message;
    if (error?.status === 403) return '请求来源校验未通过，请刷新页面后重试。';
    return '申请提交结果暂未确认，请稍后重试；重复提交不会重复创建。';
  }

  async function initLogin() {
    const form = $('#v3a-phone-auth-form') || $('#v3a-login-form');
    const sendButton = $('#v3a-send-otp') || $('#v3a-send-otp-button');
    const messageSelector = '#v3a-login-message';
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
          : '当前不会发送验证码，请等待总部开放短信登录。');
    }

    let phoneOtpEnabled = false;
    let otpRequestPending = false;
    let otpCooldownSeconds = 0;
    let otpCooldownTimer = null;

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
        showMessage(messageSelector, '验证码已发送，请查看短信；60 秒后可重新获取。');
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
      showMessage(messageSelector, '');
      if (!phoneOtpEnabled) {
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
        const result = await requestSession('verify_otp', { method: 'POST', body: { phone, token } });
        routeByStatus(result.me, messageSelector);
      } catch (error) {
        showMessage(messageSelector, error.message);
      } finally {
        setBusy(form, false);
        sendButton.disabled = otpCooldownSeconds > 0 || !phoneOtpEnabled;
      }
    });
  }

  async function initRegister() {
    const form = $('#v3a-register-form');
    const messageSelector = '#v3a-register-message';
    if (!form) return;
    let identityReady = false;
    try {
      const current = await requestSession('me');
      setText('#v3a-verified-phone', current.me?.phoneMasked, '已验证手机号');
      if (current.me?.user) {
        routeByStatus(current.me, messageSelector);
        return;
      }
      identityReady = true;
    } catch (error) {
      showMessage(messageSelector, error.status === 401 ? '请先在统一登录页完成手机号验证。' : error.message);
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
      try {
        validateApplication(payload);
      } catch (error) {
        showMessage(messageSelector, error.message);
        return;
      }
      setBusy(form, true);
      try {
        const result = await requestSession('submit_application', { method: 'POST', body: payload });
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
      setText('#v3a-workbench-balance', me.wallet?.balance, '待同步');
      setText('#v3a-workbench-invite-code', me.inviteCode, '待生成');
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
      setText('#v3a-review-note', me.applicationReview?.reviewNote || '总部审核后更新');
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
