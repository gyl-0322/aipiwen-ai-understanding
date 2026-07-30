(function () {
  'use strict';

  if (document.body?.dataset?.v3aAdminPage !== 'unassigned') return;

  function $(selector) { return document.querySelector(selector); }
  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
  }
  function cell(value, strong) {
    const node = document.createElement(strong ? 'strong' : 'span');
    node.textContent = String(value ?? '-');
    return node;
  }
  function showGate(title, message, badge) {
    $('#v3a-unassigned-gate-title').textContent = title;
    $('#v3a-unassigned-gate-message').textContent = message;
    $('#v3a-unassigned-gate-badge').textContent = badge;
    $('#v3a-unassigned-gate').hidden = false;
    $('#v3a-unassigned-workspace').hidden = true;
  }
  function showError(message) {
    const node = $('#v3a-unassigned-error');
    node.textContent = message || '';
    node.hidden = !message;
  }
  function render(clients) {
    const rows = clients.map((client) => {
      const reports = Array.isArray(client.reports) ? client.reports : [];
      const latest = reports[0] || null;
      const row = document.createElement('div');
      row.className = 'table-row';
      row.append(
        cell(client.displayName, true),
        cell(reports.length),
        cell(latest?.status || '暂无报告'),
        cell(formatTime(client.createdAt)),
        cell(formatTime(latest?.createdAt))
      );
      return row;
    });
    $('#v3a-unassigned-list').replaceChildren(...rows);
    $('#v3a-unassigned-count').textContent = String(clients.length);
    $('#v3a-unassigned-empty').hidden = clients.length !== 0;
  }
  async function load() {
    $('#v3a-unassigned-refresh').disabled = true;
    showError('');
    try {
      const response = await fetch('/api/v3a-admin/unassigned', { credentials: 'same-origin' });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || payload?.ok !== true) {
        const error = new Error(payload?.error || '无归属客户列表暂时无法读取。');
        error.status = response.status;
        throw error;
      }
      $('#v3a-unassigned-gate').hidden = true;
      $('#v3a-unassigned-workspace').hidden = false;
      render(Array.isArray(payload.clients) ? payload.clients : []);
    } catch (error) {
      if (error.status === 401) showGate('请先登录', '请使用平台超级管理员账号登录。', '未登录');
      else if (error.status === 403) showGate('当前账号无权访问', '仅 active super_admin 可以查看无归属客户。', '无权限');
      else showError(error.message);
    } finally {
      $('#v3a-unassigned-refresh').disabled = false;
    }
  }

  $('#v3a-unassigned-refresh')?.addEventListener('click', load);
  load();
})();
