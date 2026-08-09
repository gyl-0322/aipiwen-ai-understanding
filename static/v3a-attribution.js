(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'customers') return;

  let csrfToken = '';
  let busy = false;
  let allClients = [];
  let importBusy = false;
  let importData = null;
  let importIdempotencyKey = '';
  const importFingerKeys = ['R1', 'R2', 'R3', 'R4', 'R5', 'L1', 'L2', 'L3', 'L4', 'L5'];
  const importSymbols = [
    'Ws', 'Wt', 'We', 'Wsp', 'Wsr', 'Wl', 'Wc', 'Wd', 'Wsc',
    'Wpe', 'Rpe', 'Rwl', 'Wi', 'Lu', 'Ls', 'Lf', 'Rl', 'X', 'Xn'
  ];
  const sourceLabels = {
    advisor_qr: '客户扫码',
    advisor_import: '代客户上传',
    unguided: '平台转入',
    invite_link: '历史链接'
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

  function setImportStatus(message, isError = false) {
    const node = $('#v3a-report-import-status');
    node.textContent = message || '';
    node.classList.toggle('dryrun-error', isError);
  }

  function setImportBusy(next) {
    importBusy = next;
    $('#v3a-report-import-file').disabled = next;
    $('#v3a-report-import-extract').disabled = next;
    $('#v3a-report-import-submit').disabled = next;
  }

  function makeIdempotencyKey() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function populateImportClients() {
    const select = $('#v3a-report-import-client');
    const newOption = document.createElement('option');
    newOption.value = 'new';
    newOption.textContent = '创建新客户';
    const options = allClients.map((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = `已有客户：${client.displayName}`;
      return option;
    });
    select.replaceChildren(newOption, ...options);
  }

  function resetReportImport() {
    importData = null;
    importIdempotencyKey = '';
    $('#v3a-report-import-file').value = '';
    $('#v3a-report-import-confirm').reset();
    $('#v3a-report-import-confirm').hidden = true;
    $('#v3a-report-import-fingers').replaceChildren();
    $('#v3a-report-import-extracted-name').textContent = '-';
    $('#v3a-report-import-extracted-age').textContent = '-';
    $('#v3a-report-import-extracted-atd').textContent = '-';
    $('#v3a-report-import-name-wrap').hidden = false;
    setImportStatus('请选择清晰的 JPG 或 PNG 总表图片，文件不超过 2.5MB。');
    setImportBusy(false);
  }

  function openReportImport() {
    if (busy || !csrfToken) return;
    $('#v3a-attribution-panel').hidden = true;
    populateImportClients();
    resetReportImport();
    const panel = $('#v3a-report-import-panel');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeReportImport() {
    resetReportImport();
    $('#v3a-report-import-panel').hidden = true;
  }

  function renderImportFingers(fingers) {
    const rows = importFingerKeys.map((key) => {
      const row = document.createElement('div');
      row.className = 'finger-confirm-row';
      const label = document.createElement('strong');
      label.textContent = key;
      const symbol = document.createElement('select');
      symbol.className = 'select';
      symbol.dataset.fingerSymbol = key;
      symbol.setAttribute('aria-label', `${key} 纹型`);
      symbol.replaceChildren(...importSymbols.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === fingers[key]?.sym;
        return option;
      }));
      const trc = document.createElement('input');
      trc.className = 'field';
      trc.type = 'number';
      trc.min = '0';
      trc.max = '40';
      trc.step = '1';
      trc.value = String(fingers[key]?.trc ?? '');
      trc.dataset.fingerTrc = key;
      trc.setAttribute('aria-label', `${key} TRC`);
      row.append(label, symbol, trc);
      return row;
    });
    $('#v3a-report-import-fingers').replaceChildren(...rows);
  }

  async function extractAdvisorReport() {
    if (importBusy || !csrfToken) return;
    const file = $('#v3a-report-import-file').files?.[0];
    if (!file) {
      setImportStatus('请先选择报告图片。', true);
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2.5 * 1024 * 1024) {
      setImportStatus('仅支持不超过 2.5MB 的 JPG 或 PNG 图片。', true);
      return;
    }
    setImportBusy(true);
    setImportStatus('正在识别报告，请稍候。');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/v3a-report-import?action=extract', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
        body: form
      });
      const payload = await readPayload(response, '报告图片暂时无法识别。');
      importData = payload.data;
      importIdempotencyKey = makeIdempotencyKey();
      $('#v3a-report-import-name').value = importData.name || '';
      $('#v3a-report-import-type').value = Number(importData.age) > 18 ? '成人发展报告' : '儿童天赋报告';
      $('#v3a-report-import-extracted-name').textContent = importData.name || '-';
      $('#v3a-report-import-extracted-age').textContent = Number.isInteger(importData.age) ? `${importData.age} 岁` : '-';
      $('#v3a-report-import-extracted-atd').textContent = importData.atd == null ? '-' : String(importData.atd);
      renderImportFingers(importData.fingers || {});
      $('#v3a-report-import-confirm').hidden = false;
      setImportStatus('识别完成。请逐项核对客户信息、纹型和 TRC 后确认入库。');
    } catch (error) {
      setImportStatus(error.message, true);
    } finally {
      setImportBusy(false);
    }
  }

  function collectImportFingers() {
    return Object.fromEntries(importFingerKeys.map((key) => [key, {
      sym: document.querySelector(`[data-finger-symbol="${key}"]`)?.value || '',
      trc: Number(document.querySelector(`[data-finger-trc="${key}"]`)?.value)
    }]));
  }

  async function confirmAdvisorReport(event) {
    event.preventDefault();
    if (importBusy || !csrfToken || !importData || !importIdempotencyKey) return;
    const clientChoice = $('#v3a-report-import-client').value;
    const clientName = $('#v3a-report-import-name').value.trim();
    const issue = $('#v3a-report-import-issue').value.trim();
    if (clientChoice === 'new' && !clientName) {
      setImportStatus('请填写客户称呼。', true);
      return;
    }
    if (!issue) {
      setImportStatus('请填写本次最想了解的问题。', true);
      return;
    }
    if (!$('#v3a-report-import-data-confirmed').checked) {
      setImportStatus('请先逐项核对并确认识别数据。', true);
      return;
    }
    const body = {
      idempotencyKey: importIdempotencyKey,
      reportType: $('#v3a-report-import-type').value,
      selectedIssues: [issue],
      customIssue: null,
      dataConfirmed: true,
      extractedData: {
        fingers: collectImportFingers(),
        atd: importData.atd,
        age: importData.age,
        name: importData.name
      }
    };
    if (clientChoice === 'new') {
      body.existingClientId = null;
      body.newClient = { displayName: clientName, birthDate: null, note: null };
    } else {
      body.existingClientId = clientChoice;
      body.newClient = null;
    }
    setImportBusy(true);
    setImportStatus('正在生成并保存报告，请勿关闭页面。');
    try {
      const response = await fetch('/api/v3a-report-import?action=confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(body)
      });
      await readPayload(response, '报告暂时无法入库。');
      $('#v3a-report-import-confirm').hidden = true;
      $('#v3a-report-import-file').value = '';
      importData = null;
      importIdempotencyKey = '';
      setImportStatus('报告已保存到“我的客户”。请在真实客户列表中点击“开始解读”。');
      await loadCustomers();
    } catch (error) {
      setImportStatus(error.message, true);
      await loadCustomers().catch(() => {});
    } finally {
      setImportBusy(false);
    }
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
      allClients = Array.isArray(payload.clients) ? payload.clients : [];
      applyCustomerView();
    } catch (error) {
      showError(error.message);
      $('#v3a-real-customers-count').textContent = '读取失败';
    } finally {
      setBusy(false);
    }
  }

  function reportTime(client) {
    const reports = Array.isArray(client.reports) ? client.reports : [];
    const value = reports[0]?.createdAt || '';
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function applyCustomerView() {
    const search = String($('#v3a-customer-search')?.value || '').trim().toLocaleLowerCase('zh-CN');
    const status = $('#v3a-customer-status-filter')?.value || 'all';
    const sort = $('#v3a-customer-sort')?.value || 'latest';
    const clients = allClients.filter((client) => {
      const reports = Array.isArray(client.reports) ? client.reports : [];
      const matchesSearch = !search || String(client.displayName || '').toLocaleLowerCase('zh-CN').includes(search);
      const matchesStatus = status === 'all'
        || (status === 'none' ? reports.length === 0 : reports.some((report) => report.status === status));
      return matchesSearch && matchesStatus;
    });
    clients.sort((left, right) => {
      if (sort === 'name') return String(left.displayName || '').localeCompare(String(right.displayName || ''), 'zh-CN');
      if (sort === 'created') return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
      return reportTime(right) - reportTime(left);
    });
    renderCustomers(clients);
  }

  function renderCustomers(clients) {
    const list = $('#v3a-real-customers-list');
    const rows = clients.map((client) => {
      const reports = Array.isArray(client.reports) ? client.reports : [];
      const latest = reports[0] || null;
      const readyReport = reports.find((report) => report.status === 'ready') || null;
      const row = document.createElement('div');
      row.className = 'table-row';
      row.dataset.clientId = client.id;
      const stage = document.createElement('span');
      stage.dataset.v4Stage = 'initial';
      stage.className = 'stage-tag initial';
      stage.textContent = '初始解读期';
      const candidate = document.createElement('span');
      candidate.dataset.v4Candidate = 'false';
      candidate.textContent = '-';
      const actions = document.createElement('span');
      actions.className = 'v4-row-actions';
      const archive = document.createElement('button');
      archive.type = 'button';
      archive.className = 'btn ghost';
      archive.textContent = '客户360';
      archive.addEventListener('click', () => {
        window.location.assign(`client-360.html?person_id=${encodeURIComponent(client.id)}`);
      });
      actions.append(archive);
      if (readyReport) {
        const interpret = document.createElement('button');
        interpret.type = 'button';
        interpret.className = 'btn ghost customer-start-button';
        interpret.textContent = '开始解读';
        interpret.addEventListener('click', () => {
          const target = `ai-interpreter-session.html?clientId=${encodeURIComponent(client.id)}&reportId=${encodeURIComponent(readyReport.id)}`;
          window.location.assign(target);
        });
        actions.append(interpret);
      }
      const caseButton = document.createElement('button');
      caseButton.type = 'button';
      caseButton.className = 'btn ghost';
      caseButton.textContent = '存入案例库';
      caseButton.addEventListener('click', () => window.openCaseModal?.(client.id, client.displayName));
      actions.append(caseButton);
      row.append(
        cell(client.displayName, true),
        cell(sourceLabels[client.source] || client.source),
        cell('由我服务'),
        cell(reports.length),
        cell(formatTime(latest?.createdAt)),
        cell(statusLabels[latest?.status] || (latest ? latest.status : '暂无报告')),
        cell(formatTime(client.createdAt)),
        stage,
        candidate,
        actions
      );
      return row;
    });
    list.replaceChildren(...rows);
    $('#v3a-real-customers-count').textContent = `${clients.length} 位`;
    $('#v3a-real-customers-table').hidden = clients.length === 0;
    $('#v3a-real-customers-empty').hidden = clients.length !== 0;
    document.dispatchEvent(new CustomEvent('v3a:customers-rendered', {
      detail: { clients: clients.map((client) => ({ id: client.id })) }
    }));
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
      return await readPayload(response, '客户上传入口暂时无法创建。');
    } catch (error) {
      showError(error.message);
      return null;
    } finally {
      setBusy(false);
    }
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

  $('#v3a-customer-upload')?.addEventListener('click', openReportImport);
  $('#v3a-attribution-qr')?.addEventListener('click', showQr);
  $('#v3a-report-import-close')?.addEventListener('click', closeReportImport);
  $('#v3a-report-import-extract')?.addEventListener('click', extractAdvisorReport);
  $('#v3a-report-import-client')?.addEventListener('change', (event) => {
    $('#v3a-report-import-name-wrap').hidden = event.currentTarget.value !== 'new';
  });
  $('#v3a-report-import-confirm')?.addEventListener('submit', confirmAdvisorReport);
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
  $('#v3a-customer-search')?.addEventListener('input', applyCustomerView);
  $('#v3a-customer-status-filter')?.addEventListener('change', applyCustomerView);
  $('#v3a-customer-sort')?.addEventListener('change', applyCustomerView);
  if (new URLSearchParams(window.location.search).get('intent') === 'interpret') {
    $('#v3a-customer-guidance-title').textContent = '选择客户开始解读';
    $('#v3a-customer-guidance-text').textContent = '请在真实客户列表中点击“开始解读”。只有已生成报告的客户可以进入。';
  }
  loadCustomers();
})();
