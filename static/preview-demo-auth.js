(function () {
  'use strict';

  const SESSION_KEY = 'aipiwen.previewDemoSession.v1';
  const REPORT_STATE_KEY = 'aipiwen.previewReportIntakeState.v1';
  const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
  const CODE_TTL_MS = 10 * 60 * 1000;
  const DEMO_NAME = 'AIPIWEN 演示指导师';
  const PRODUCTION_HOSTS = new Set(['aipiwen.cn', 'www.aipiwen.cn']);

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(REPORT_STATE_KEY);
  }

  function readSession() {
    let session;

    try {
      session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch (_error) {
      clearSession();
      return null;
    }

    const now = Date.now();
    const valid = session
      && session.version === 1
      && session.mode === 'preview-demo'
      && session.displayName === DEMO_NAME
      && Number.isFinite(session.issuedAt)
      && Number.isFinite(session.expiresAt)
      && session.issuedAt <= now
      && session.expiresAt > now
      && session.expiresAt - session.issuedAt === SESSION_TTL_MS;

    if (!valid) {
      clearSession();
      return null;
    }

    return session;
  }

  function createSession() {
    const issuedAt = Date.now();
    const session = {
      version: 1,
      mode: 'preview-demo',
      displayName: DEMO_NAME,
      issuedAt,
      expiresAt: issuedAt + SESSION_TTL_MS
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function leaveDemo() {
    clearSession();
    window.location.assign('/login.html?logged_out=1');
  }

  function bindLogoutButtons(root) {
    root.querySelectorAll('[data-preview-demo-logout]').forEach((button) => {
      if (button.dataset.previewDemoBound === 'true') return;
      button.dataset.previewDemoBound = 'true';
      button.addEventListener('click', leaveDemo);
    });
  }

  function buildDemoBanner(session) {
    const banner = document.createElement('section');
    banner.className = 'notice preview-demo-banner';
    banner.setAttribute('data-preview-demo-banner', '');

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    const description = document.createElement('p');
    title.textContent = 'Preview 演示模式';
    description.textContent = '当前为模拟账号和模拟业务数据，不发送短信，不连接 Supabase 或生产数据库。';
    copy.append(title, description);

    const actions = document.createElement('div');
    actions.className = 'top-actions';
    const identity = document.createElement('span');
    identity.className = 'status info';
    identity.textContent = session.displayName;
    const logout = document.createElement('button');
    logout.className = 'btn ghost';
    logout.type = 'button';
    logout.textContent = '退出演示';
    logout.setAttribute('data-preview-demo-logout', '');
    actions.append(identity, logout);

    banner.append(copy, actions);
    return banner;
  }

  function enterProtectedPage() {
    if (PRODUCTION_HOSTS.has(window.location.hostname)) {
      clearSession();
      window.location.replace('/homepage.html');
      return;
    }

    const session = readSession();
    if (!session) {
      window.location.replace('/login.html?expired=1');
      return;
    }

    document.querySelectorAll('[data-preview-demo-user]').forEach((node) => {
      node.textContent = session.displayName;
    });

    const main = document.querySelector('.main');
    if (main && !main.querySelector('[data-preview-demo-banner]')) {
      main.prepend(buildDemoBanner(session));
    }

    bindLogoutButtons(document);
    document.body.hidden = false;

    window.addEventListener('pageshow', () => {
      if (!readSession()) window.location.replace('/login.html?expired=1');
    });
  }

  function randomSixDigitCode() {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('当前浏览器无法生成模拟验证码，请换用最新版浏览器。');
    }

    const values = new Uint32Array(1);
    const range = 1000000;
    const limit = Math.floor(0x100000000 / range) * range;
    do {
      window.crypto.getRandomValues(values);
    } while (values[0] >= limit);

    return String(values[0] % range).padStart(6, '0');
  }

  function showLoginMessage(message, tone) {
    const node = document.getElementById('preview-demo-form-message');
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone || 'info';
  }

  function enterLoginPage() {
    const form = document.getElementById('preview-demo-login-form');
    const codeButton = document.getElementById('preview-demo-code-button');
    const codeInput = document.getElementById('preview-demo-code-input');
    const codeOutput = document.getElementById('preview-demo-code-output');
    const existingSession = document.getElementById('existing-demo-session');
    let generatedCode = '';
    let generatedCodeExpiresAt = 0;

    if (!form || !codeButton || !codeInput || !codeOutput) return;

    if (PRODUCTION_HOSTS.has(window.location.hostname)) {
      clearSession();
      form.hidden = true;
      showLoginMessage('演示登录已在正式站禁用。', 'error');
      return;
    }

    if (readSession() && existingSession) existingSession.hidden = false;
    bindLogoutButtons(document);

    const params = new URLSearchParams(window.location.search);
    if (params.get('logged_out') === '1') {
      showLoginMessage('已安全退出演示工作台。', 'success');
    } else if (params.get('expired') === '1') {
      showLoginMessage('演示登录状态不存在或已失效，请重新登录。', 'info');
    }

    codeButton.addEventListener('click', () => {
      try {
        generatedCode = randomSixDigitCode();
        generatedCodeExpiresAt = Date.now() + CODE_TTL_MS;
        codeOutput.hidden = false;
        codeOutput.textContent = `本次模拟验证码：${generatedCode}（未发送短信，10 分钟内有效）`;
        codeInput.value = '';
        codeInput.focus();
        showLoginMessage('请把上方显示的 6 位数字输入验证码框。', 'info');
      } catch (error) {
        showLoginMessage(error.message, 'error');
      }
    });

    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const submittedCode = codeInput.value.trim();

      if (!generatedCode) {
        showLoginMessage('请先点击“获取模拟码”。', 'error');
        codeButton.focus();
        return;
      }

      if (Date.now() >= generatedCodeExpiresAt) {
        generatedCode = '';
        generatedCodeExpiresAt = 0;
        codeOutput.hidden = true;
        showLoginMessage('模拟验证码已失效，请重新获取。', 'error');
        codeButton.focus();
        return;
      }

      if (!/^\d{6}$/.test(submittedCode) || submittedCode !== generatedCode) {
        showLoginMessage('验证码不正确，请按上方显示的数字重新输入。', 'error');
        codeInput.select();
        return;
      }

      createSession();
      generatedCode = '';
      generatedCodeExpiresAt = 0;
      showLoginMessage('模拟登录成功，正在进入工作台……', 'success');
      window.location.assign('/ai-interpreter-workbench.html');
    });
  }

  if (document.body.hasAttribute('data-preview-demo-auth')) {
    enterProtectedPage();
  } else if (document.body.dataset.previewDemoPage === 'login') {
    enterLoginPage();
  }
})();
