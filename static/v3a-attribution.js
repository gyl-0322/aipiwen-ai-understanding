(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'customers') return;

  let csrfToken = '';
  let busy = false;
  const sourceLabels = {
    advisor_qr: '归属二维码',
    advisor_import: '指导师录入',
    unguided: '总部分配',
    invite_link: '历史邀请链接'
  };
  const statusLabels = {
    ready: '已生成',
    generating: '生成中',
    failed: '生成失败',
    reviewed: '已复核',
    draft: '草稿'
  };

  function $(selector) { return document.querySelector(selector); }
  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
  }
  function formatServiceCode(value) {
    const code = String(value || '').replace(/[^0-9A-F]/gi, '').toUpperCase();
    return code.length === 10 ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}` : '';
  }
  function cell(text, strong) {
    const node = document.createElement(strong ? 'strong' : 'span');
    node.textContent = String(text ?? '-');
    return node;
  }
  function setBusy(next) {
    busy = next;
    $('#v3a-attribution-qr').disabled = next || !csrfToken;
    $('#v3a-customer-upload').disabled = next || !csrfToken;
  }
  function showError(message) {
    const node = $('#v3a-real-customers-error');
    node.textContent = message || '';
    node.hidden = !message;
  }

  async function readPayload(response, fallback) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || fallback);
    }
    if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
    return payload;
  }

  async function loadCustomers() {
    showError('');
    setBusy(true);
    try {
      const response = await fetch('/api/v3a-customers', { credentials: 'same-origin' });
      const payload = await readPayload(response, '客户列表暂时无法读取。');
      renderCustomers(Array.isArray(payload.clients) ? payload.clients : []);
    } catch (error) {
      showError(error.message);
      $('#v3a-real-customers-count').textContent = '读取失败';
    } finally {
      setBusy(false);
    }
  }

  function renderCustomers(clients) {
    const list = $('#v3a-real-customers-list');
    const rows = clients.map((client) => {
      const reports = Array.isArray(client.reports) ? client.reports : [];
      const latest = reports[0] || null;
      const row = document.createElement('div');
      row.className = 'table-row';
      row.append(
        cell(client.displayName, true),
        cell(sourceLabels[client.source] || client.source),
        cell('当前指导师'),
        cell(reports.length),
        cell(formatTime(latest?.createdAt)),
        cell(statusLabels[latest?.status] || (latest ? latest.status : '暂无报告')),
        cell(formatTime(client.createdAt)),
        cell('查看')
      );
      return row;
    });
    list.replaceChildren(...rows);
    $('#v3a-real-customers-count').textContent = `${clients.length} 位`;
    $('#v3a-real-customers-table').hidden = clients.length === 0;
    $('#v3a-real-customers-empty').hidden = clients.length !== 0;
  }

  async function createToken() {
    if (busy || !csrfToken) return null;
    setBusy(true);
    showError('');
    try {
      const response = await fetch('/api/v3a-attribution?action=create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: '{}'
      });
      return await readPayload(response, '客户归属链接暂时无法创建。');
    } catch (error) {
      showError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function uploadForCustomer() {
    const payload = await createToken();
    if (payload?.uploadPath) window.location.assign(payload.uploadPath);
  }

  async function showQr() {
    const payload = await createToken();
    if (!payload?.uploadPath) return;
    const url = new URL(payload.uploadPath, window.location.origin).toString();
    const target = $('#v3a-attribution-qr-image');
    target.replaceChildren();
    if (window.QRCode) {
      new window.QRCode(target, {
        text: url,
        width: 180,
        height: 180,
        colorDark: '#0e1118',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
    $('#v3a-attribution-url').textContent = url;
    const serviceCode = formatServiceCode(payload.serviceCode);
    $('#v3a-attribution-service-code').textContent = serviceCode || '-';
    $('#v3a-attribution-code-copy').disabled = !serviceCode;
    $('#v3a-attribution-code-copy').dataset.serviceCode = serviceCode;
    $('#v3a-attribution-panel').hidden = false;
  }

  $('#v3a-customer-upload')?.addEventListener('click', uploadForCustomer);
  $('#v3a-attribution-qr')?.addEventListener('click', showQr);
  $('#v3a-attribution-close')?.addEventListener('click', () => {
    $('#v3a-attribution-panel').hidden = true;
  });
  $('#v3a-attribution-code-copy')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const serviceCode = button.dataset.serviceCode || '';
    if (!serviceCode) return;
    try {
      await navigator.clipboard.writeText(serviceCode);
      button.textContent = '已复制';
    } catch {
      showError('服务码复制失败，请手工记录。');
    }
  });
  loadCustomers();
})();
