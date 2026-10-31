(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'fiac-review') return;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const FINGERS = [
    ['L1', '左拇指'], ['L2', '左食指'], ['L3', '左中指'], ['L4', '左无名指'], ['L5', '左小指'],
    ['R1', '右拇指'], ['R2', '右食指'], ['R3', '右中指'], ['R4', '右无名指'], ['R5', '右小指']
  ];
  const params = new URLSearchParams(window.location.search);
  const legacyCustomerContext = {
    contextType: params.get('context_type') || '',
    advisorClientId: params.get('advisor_client_id') || ''
  };

  function text(selector, value) {
    const target = document.querySelector(selector);
    if (target) target.textContent = String(value ?? '--');
  }

  function safeReturnUrl() {
    const fallback = `/client-360.html?person_id=${encodeURIComponent(legacyCustomerContext.advisorClientId)}`;
    try {
      const candidate = new URL(params.get('return_url') || fallback, window.location.origin);
      if (candidate.origin !== window.location.origin || candidate.pathname !== '/client-360.html') return fallback;
      if (candidate.searchParams.get('person_id') !== legacyCustomerContext.advisorClientId) return fallback;
      return `${candidate.pathname}${candidate.search}`;
    } catch {
      return fallback;
    }
  }

  function setError(message) {
    const target = document.querySelector('#fiacError');
    target.textContent = message || '';
    target.hidden = !message;
  }

  function selectMeasurement(payload) {
    const reports = Array.isArray(payload.reports) ? payload.reports : [];
    return reports.find((report) => report.status === 'ready' && Object.keys(report.fingers || {}).length > 0)
      || reports.find((report) => report.status === 'ready')
      || null;
  }

  function trcFor(report) {
    const values = Object.values(report?.fingers || {}).map((finger) => Number(finger?.trc)).filter(Number.isFinite);
    if (values.length) return values.reduce((sum, value) => sum + value, 0);
    const engine = report?.engineResult || {};
    return engine['五功能区']?.['总TRC'] ?? engine.trc ?? engine.totalTrc ?? '--';
  }

  function atdFor(report) {
    return report?.atd ?? report?.engineResult?.['ATD']?.['值'] ?? '--';
  }

  function renderFingers(report) {
    const target = document.querySelector('#fiacFingerGrid');
    const data = report?.fingers || {};
    target.replaceChildren(...FINGERS.map(([key, label]) => {
      const finger = data[key] || {};
      const card = document.createElement('article');
      card.className = 'fiac-finger-card';
      const name = document.createElement('span');
      const pattern = document.createElement('strong');
      const trc = document.createElement('small');
      name.textContent = `${label} · ${key}`;
      pattern.textContent = finger.sym || '未记录';
      trc.textContent = Number.isFinite(Number(finger.trc)) ? `TRC ${Number(finger.trc)}` : 'TRC --';
      card.append(name, pattern, trc);
      return card;
    }));
  }

  function render(payload) {
    const report = selectMeasurement(payload);
    text('#fiacPageTitle', `${payload.client.displayName} · 指纹智能分析中心 FIAC`);
    text('#fiacClientName', payload.client.displayName);
    text('#fiacSource', report ? '客户已有报告' : '暂无可复核数据');
    text('#fiacReport', report ? `${report.reportType} · ${window.V3A_UI?.label(report.status, '报告处理中') || '报告处理中'}` : '暂无已就绪报告');
    text('#fiacFingerCount', report ? `${Object.keys(report.fingers || {}).length}/10` : '0/10');
    text('#fiacTrc', report ? trcFor(report) : '--');
    text('#fiacAtd', atdFor(report));
    text('#fiacInterpretation', report?.interpretationStatus ? '已有解读' : '尚无已有解读');
    text('#fiacMeasurementStatus', report ? '可复核' : '暂无数据');
    text('#fiacReviewState', report ? '已有报告已关联；识别档案按同一数据中心客户编号挂接。' : '正在等待已有报告。');
    const dataCenterPersonId = UUID_PATTERN.test(payload.dataCenterPersonId || '') ? payload.dataCenterPersonId : '';
    const recognition = document.querySelector('#fiacRecognition');
    if (recognition) {
      recognition.removeAttribute('href');
      recognition.textContent = '当前站点未开放单独的指纹识别服务';
    }
    window.V3A_UI?.customerContext.write({
      id: payload.client.id,
      displayName: payload.client.displayName,
      reportId: report?.id,
      reportType: report?.reportType
    });
    renderFingers(report);
  }

  async function load() {
    document.querySelector('#fiacReturn').href = safeReturnUrl();
    if (legacyCustomerContext.contextType !== 'legacy_advisor_client' || !UUID_PATTERN.test(legacyCustomerContext.advisorClientId)) {
      setError('请先从「我的客户」打开一位客户，再进入指纹复核。本页不是客户名单。');
      const recognition = document.querySelector('#fiacRecognition');
      if (recognition) {
        recognition.href = 'ai-interpreter-customers.html';
        recognition.textContent = '前往我的客户选择';
      }
      return;
    }
    try {
      const response = await fetch(`/api/v3a-client-data-center?person_id=${encodeURIComponent(legacyCustomerContext.advisorClientId)}&view=full`, { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '十指数据暂时无法读取，请稍后重试。');
      render(payload);
      await loadRecognition(UUID_PATTERN.test(payload.dataCenterPersonId || '') ? payload.dataCenterPersonId : '');
    } catch (error) {
      setError(window.V3A_UI?.friendlyError(error, '指纹测量数据暂时无法读取，请稍后重试。') || '指纹测量数据暂时无法读取，请稍后重试。');
    }
  }

  async function loadRecognition() {
    const status = document.querySelector('#fiacRecognitionStatus');
    if (!status) return;
    status.textContent = '指纹识别服务未接入当前站点。这里只复核已有报告里的十指、TRC 与 ATD。';
  }

  document.addEventListener('v3a:workbench-ready', load, { once: true });
})();
