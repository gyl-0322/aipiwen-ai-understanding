(function () {
  'use strict';

  if (document.body?.dataset?.v3aAdminPage !== 'applications') return;

  const roleLabels = { advisor: '指导师', agent: '代理', center: '采集中心' };
  const practitionerLabels = {
    independent: '独立从业者',
    organization: '机构从业者',
    agent: '代理',
    center: '采集中心',
    other: '其他'
  };
  let csrfToken = '';
  let applications = [];
  let selected = null;
  let busy = false;

  function $(selector) {
    return document.querySelector(selector);
  }

  function value(input, fallback = '未填写') {
    const normalized = String(input ?? '').trim();
    return normalized || fallback;
  }

  function formatTime(input) {
    if (!input) return '未记录';
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? String(input) : date.toLocaleString('zh-CN', { hour12: false });
  }

  function showError(message) {
    const node = $('#v3a-admin-error');
    node.textContent = message || '';
    node.hidden = !message;
  }

  function showGate(title, message, badge = '访问受限') {
    $('#v3a-admin-gate-title').textContent = title;
    $('#v3a-admin-gate-message').textContent = message;
    $('#v3a-admin-gate-badge').textContent = badge;
    $('#v3a-admin-gate').hidden = false;
    $('#v3a-admin-workspace').hidden = true;
  }

  async function requestAdmin(action, options = {}) {
    const query = new URLSearchParams({ action });
    if (options.id) query.set('id', options.id);
    const method = options.method || 'GET';
    const isPost = method === 'POST';
    let response;
    try {
      response = await fetch(`/api/v3a-admin?${query.toString()}`, {
        method,
        credentials: 'same-origin',
        headers: isPost ? {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
        } : undefined,
        body: isPost ? JSON.stringify(options.body || {}) : undefined
      });
    } catch {
      throw Object.assign(new Error('总部审核服务暂时不可用。'), { status: 502 });
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The public message below remains generic.
    }
    if (!response.ok || payload?.ok !== true) {
      throw Object.assign(new Error(payload?.error || '总部审核服务暂时不可用。'), { status: response.status });
    }
    if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
    return payload;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    document.querySelectorAll('[data-admin-action]').forEach((button) => {
      button.disabled = nextBusy;
    });
  }

  function createCell(text) {
    const cell = document.createElement('span');
    cell.textContent = value(text);
    return cell;
  }

  function createRow(application) {
    const row = document.createElement('div');
    row.className = `table-row${selected?.summary?.applicationId === application.applicationId ? ' selected' : ''}`;
    row.append(
      createCell(application.nickname || application.name),
      createCell(application.phoneMasked),
      createCell(application.city),
      createCell(roleLabels[application.role] || application.role),
      createCell(formatTime(application.appliedAt)),
      createCell(application.status)
    );
    const button = document.createElement('button');
    button.className = 'btn ghost admin-view-button';
    button.type = 'button';
    button.textContent = '查看';
    button.dataset.adminAction = 'view';
    button.disabled = busy;
    button.addEventListener('click', () => loadDetail(application.applicationId));
    row.appendChild(button);
    return row;
  }

  function renderList() {
    const list = $('#v3a-admin-list');
    list.replaceChildren(...applications.map(createRow));
    $('#v3a-admin-count').textContent = String(applications.length);
    $('#v3a-admin-empty').hidden = applications.length !== 0;
  }

  function renderDetail(application) {
    selected = application;
    const summary = application.summary || {};
    const fields = [
      ['申请人', summary.nickname || summary.name],
      ['手机号', summary.phoneMasked],
      ['城市', summary.city],
      ['申请身份', roleLabels[summary.role] || summary.role],
      ['从业类型', practitionerLabels[summary.practitionerType] || summary.practitionerType],
      ['机构', application.organizationName],
      ['邀请码', summary.inviteCode],
      ['协议确认', summary.agreementConfirmed ? '已确认' : '未确认'],
      ['申请时间', formatTime(summary.appliedAt)],
      ['申请说明', application.applicationNote]
    ];
    const list = $('#v3a-admin-detail-list');
    list.replaceChildren(...fields.map(([label, text]) => {
      const item = document.createElement('div');
      item.className = 'admin-detail-item';
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value(text);
      item.append(term, description);
      return item;
    }));
    list.hidden = false;
    $('#v3a-admin-detail-empty').hidden = true;
    $('#v3a-admin-actions').hidden = false;
    $('#v3a-admin-approve').disabled = application.currentStatus?.application !== 'pending';
    $('#v3a-admin-reject').disabled = application.currentStatus?.application !== 'pending';
    renderList();
  }

  async function loadDetail(applicationId) {
    if (busy) return;
    setBusy(true);
    showError('');
    try {
      const payload = await requestAdmin('get_application', { id: applicationId });
      renderDetail(payload.application);
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadApplications() {
    setBusy(true);
    showError('');
    try {
      const payload = await requestAdmin('list_applications');
      applications = Array.isArray(payload.applications)
        ? payload.applications.filter((item) => item?.status === 'pending')
        : [];
      $('#v3a-admin-name').textContent = value(payload.admin?.displayName, 'AIPIWEN 总部');
      $('#v3a-admin-refreshed-at').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      renderList();
      return payload;
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    const applicationId = selected?.summary?.applicationId;
    if (!applicationId || busy || !window.confirm('确认通过该申请？账号将被激活，并按当前规则创建钱包、体验额度和邀请码。')) return;
    setBusy(true);
    showError('');
    try {
      await requestAdmin('approve_application', { method: 'POST', body: { applicationId } });
      selected = null;
      $('#v3a-admin-actions').hidden = true;
      $('#v3a-admin-detail-list').hidden = true;
      $('#v3a-admin-detail-empty').hidden = false;
      await loadApplications();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const applicationId = selected?.summary?.applicationId;
    const reason = $('#v3a-admin-reject-reason').value.trim();
    if (!applicationId || busy) return;
    if (Array.from(reason).length < 10) {
      showError('驳回原因至少需要 10 个字符。');
      return;
    }
    if (!window.confirm('确认驳回该申请？')) return;
    setBusy(true);
    showError('');
    try {
      await requestAdmin('reject_application', { method: 'POST', body: { applicationId, reason } });
      selected = null;
      $('#v3a-admin-actions').hidden = true;
      $('#v3a-admin-detail-list').hidden = true;
      $('#v3a-admin-detail-empty').hidden = false;
      await loadApplications();
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    try {
      const payload = await loadApplications();
      $('#v3a-admin-identity').textContent = value(payload.admin?.displayName, 'AIPIWEN 总部');
      $('#v3a-admin-identity').hidden = false;
      $('#v3a-admin-refresh').hidden = false;
      $('#v3a-admin-logout').hidden = false;
      $('#v3a-admin-gate').hidden = true;
      $('#v3a-admin-workspace').hidden = false;
    } catch (error) {
      if (error.status === 401) showGate('请先登录总部账号', error.message, '需要登录');
      else if (error.status === 403) showGate('无权访问此页面', '当前账号不是 active super_admin。', '权限不足');
      else showGate('总部审核服务尚未就绪', error.message, 'Preview 未配置');
    }
  }

  $('#v3a-admin-refresh')?.addEventListener('click', async () => {
    try {
      await loadApplications();
    } catch (error) {
      showError(error.message);
    }
  });
  $('#v3a-admin-approve')?.addEventListener('click', approve);
  $('#v3a-admin-reject')?.addEventListener('click', reject);
  $('#v3a-admin-logout')?.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/v3a-session?action=logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
        },
        body: '{}'
      });
      if (!response.ok) throw new Error('退出失败，请稍后重试。');
      csrfToken = '';
      window.location.href = '/login.html';
    } catch (error) {
      showError(error.message || '退出失败，请稍后重试。');
    }
  });
  init();
})();
