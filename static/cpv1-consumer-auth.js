(function consumerAuthModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.addEventListener('DOMContentLoaded', () => api.mount(root));
})(typeof window === 'undefined' ? null : window, function consumerAuthFactory() {
  'use strict';

  class ConsumerAuthError extends Error {}
  function visibleError(error, fallback) {
    return error instanceof ConsumerAuthError ? error.message : fallback;
  }

  const allowedTargets = [
    /^\/cp$/,
    /^\/cp\/fingerprint$/,
    /^\/cp\/reports$/,
    /^\/cp\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    /^\/cp\/growth$/,
    /^\/cp\/ai$/,
    /^\/cp\/family$/,
    /^\/cp\/courses$/,
    /^\/cp\/advisor$/,
    /^\/cp\/uploads$/
  ];

  function safeReturnTo(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 256 || /[\u0000-\u001f\u007f\\]/.test(raw)) return '/cp';
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return '/cp';
    }
    if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('%') || decoded.includes('?') || decoded.includes('#') || decoded.includes(':')) return '/cp';
    if (decoded === '/cp/') decoded = '/cp';
    return allowedTargets.some((pattern) => pattern.test(decoded)) ? decoded : '/cp';
  }

  function returnTarget(search) {
    const value = new URLSearchParams(String(search || '')).get('return_to');
    return safeReturnTo(value || '/cp');
  }

  function errorMessage(payload, fallback) {
    const code = String(payload?.code || payload?.error?.code || '');
    if (code === 'CP_AUTH_CONSUMER_IDENTITY_ABSENT' || code === 'CP_AUTH_PERSON_UNRESOLVED') {
      return '暂时没有找到这个手机号对应的个人资料。请联系为你提供服务的团队确认后再试。';
    }
    if (code === 'CP_AUTH_CONSUMER_IDENTITY_DISABLED' || code === 'CP_AUTH_ROLE_DENIED') {
      return '当前账号暂时无法进入“我的 AIPIWEN”，请联系为你提供服务的团队确认。';
    }
    if (code === 'CP_AUTH_CONSUMER_IDENTITY_AMBIGUOUS') {
      return '你的个人资料还需要核对，暂时无法进入。请联系为你提供服务的团队。';
    }
    if (code === 'RATE_LIMITED') return '操作较频繁，请稍后再试。';
    if (code === 'OTP_VERIFY_FAILED' || code === 'INVALID_OTP') return '验证码不正确或已失效，请重新获取。';
    if (code === 'PASSWORD_LOGIN_FAILED') return '手机号或密码不正确，请检查后再试。';
    return fallback;
  }

  function mount(win) {
    const doc = win.document;
    const target = returnTarget(win.location.search);
    const status = doc.getElementById('consumer-auth-status');
    const message = doc.getElementById('consumer-auth-message');
    const smsForm = doc.getElementById('consumer-sms-form');
    const passwordForm = doc.getElementById('consumer-password-form');
    const smsTab = doc.getElementById('consumer-sms-tab');
    const passwordTab = doc.getElementById('consumer-password-tab');
    const sendOtp = doc.getElementById('consumer-send-otp');
    const controls = [...doc.querySelectorAll('button, input')];

    function setStatus(text, tone) {
      status.textContent = text;
      status.dataset.tone = tone;
    }

    function setMessage(text, tone = '') {
      message.textContent = text;
      message.dataset.tone = tone;
    }

    function setBusy(busy) {
      controls.forEach((control) => { control.disabled = busy; });
    }

    async function request(action, body) {
      const response = await win.fetch(`/api/v3a-session?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      return { response, payload };
    }

    async function exchange(csrfToken) {
      if (!csrfToken) throw new ConsumerAuthError('登录状态暂时无法确认，请刷新后重新登录。');
      try {
        await win.fetch('/api/v3a-session?action=cp_exchange', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: '{}'
        });
      } catch {
        // Family grant can complete later; a verified session is enough to open 我的 AIPIWEN.
      }
      win.location.assign(target);
    }

    async function continueWith(result) {
      if (!result.response.ok) throw new ConsumerAuthError(errorMessage(result.payload, '登录没有完成，请检查后再试。'));
      setStatus('手机号已验证', 'ok');
      setMessage('验证成功，正在打开“我的 AIPIWEN”…', 'ok');
      await exchange(result.payload?.csrfToken);
    }

    async function detectSession() {
      try {
        const response = await win.fetch('/api/v3a-session?action=consumer_session', {
          credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' }
        });
        if (response.status === 401) {
          setStatus('请验证手机号', 'ready');
          return;
        }
        let payload = null;
        try { payload = await response.json(); } catch { payload = null; }
        if (!response.ok || !payload?.csrfToken) {
          setStatus('登录状态暂时无法确认', 'error');
          setMessage('请稍后刷新页面重试。', 'error');
          return;
        }
        setStatus('你已登录', 'ok');
        setMessage('正在打开“我的 AIPIWEN”…', 'ok');
        setBusy(true);
        await exchange(payload.csrfToken);
      } catch (error) {
        setBusy(false);
        setStatus('暂时无法进入', 'error');
        setMessage(visibleError(error, '暂时无法进入“我的 AIPIWEN”，请检查网络后重试。'), 'error');
      }
    }

    function selectMode(mode) {
      const sms = mode === 'sms';
      smsForm.hidden = !sms;
      passwordForm.hidden = sms;
      smsTab.setAttribute('aria-selected', String(sms));
      passwordTab.setAttribute('aria-selected', String(!sms));
      setMessage('');
      (sms ? doc.getElementById('consumer-sms-phone') : doc.getElementById('consumer-password-phone')).focus();
    }

    smsTab.addEventListener('click', () => selectMode('sms'));
    passwordTab.addEventListener('click', () => selectMode('password'));

    sendOtp.addEventListener('click', async () => {
      const phone = doc.getElementById('consumer-sms-phone').value;
      if (!/^\s*(?:\+?86)?1[3-9][0-9]{9}\s*$/.test(phone)) {
        setMessage('请输入有效的中国大陆手机号。', 'error');
        return;
      }
      setBusy(true);
      setMessage('正在发送验证码…');
      try {
        const result = await request('consumer_request_otp', { phone });
        if (!result.response.ok) throw new ConsumerAuthError(errorMessage(result.payload, '验证码暂时无法发送，请稍后再试。'));
        setMessage('验证码已发送，请在有效期内完成验证。', 'ok');
      } catch (error) {
        setMessage(visibleError(error, '验证码暂时无法发送，请检查网络后重试。'), 'error');
      } finally {
        setBusy(false);
      }
    });

    smsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!smsForm.reportValidity()) return;
      setBusy(true);
      setMessage('正在验证手机号…');
      try {
        await continueWith(await request('consumer_verify_otp', {
          phone: doc.getElementById('consumer-sms-phone').value,
          token: doc.getElementById('consumer-otp').value
        }));
      } catch (error) {
        setStatus('验证未完成', 'error');
        setMessage(visibleError(error, '登录暂时未能完成，请检查网络后重试。'), 'error');
        setBusy(false);
      }
    });

    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!passwordForm.reportValidity()) return;
      setBusy(true);
      setMessage('正在验证手机号和密码…');
      try {
        await continueWith(await request('consumer_password_login', {
          phone: doc.getElementById('consumer-password-phone').value,
          password: doc.getElementById('consumer-password').value
        }));
      } catch (error) {
        setStatus('登录未完成', 'error');
        setMessage(visibleError(error, '登录暂时未能完成，请检查网络后重试。'), 'error');
        setBusy(false);
      }
    });

    void detectSession();
  }

  return { safeReturnTo, returnTarget, mount };
});
