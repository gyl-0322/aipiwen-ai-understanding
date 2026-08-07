(function () {
  'use strict';

  const API = '/api/v3a-generate-interpretation';
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STEP_FIELDS = ['why', 'say', 'ask', 'no', 'action', 'risk'];
  const STEP_TARGETS = {
    why: 'ai-why',
    say: 'ai-say',
    ask: 'ai-ask',
    no: 'ai-no',
    action: 'ai-action',
    risk: 'ai-risk'
  };
  const LEGACY_STEP_META = [
    ['建立安全感', '暖场、自我介绍、确认解读目标', '3-5 分钟'],
    ['严正声明和四条规则', '明确报告边界与客户权利', '2-3 分钟'],
    ['讲性格类型，让客户产生共鸣', '从生活观察进入报告', '5-8 分钟'],
    ['TRC / ATD / 左右脑，解释底层数据', '解释数据而不评价高低', '5-8 分钟'],
    ['讲学习通道 / 行为模式', '连接信息输入与行动方式', '5-8 分钟'],
    ['进入客户关注问题', '回应客户本次真实关切', '6-10 分钟'],
    ['给行动建议', '把理解转为可执行行动', '5-8 分钟'],
    ['记录客户反馈 / 必要时提交总部复核', '记录反馈并识别风险', '3-5 分钟']
  ];
  const STEP_META = [
    ['建立安全感', '暖场、自我介绍、确认本次解读目标', '3-5 分钟'],
    ['严正声明四原则', '明确报告边界与客户权利', '3-5 分钟'],
    ['性格类型', '讲清核心底色、优势、代价与现实场景', '8-12 分钟'],
    ['TRC', '解释认知容量、个人均值与学习承载方式', '6-10 分钟'],
    ['ATD', '解释反应节奏、敏感度与启动缓冲方式', '5-8 分钟'],
    ['学习通道', '解释信息输入、记忆复习与环境安排', '5-8 分钟'],
    ['行为模式', '解释启动、目标、压力、执行与反馈方式', '5-8 分钟'],
    ['左右脑', '解释信息处理、学习、决策与沟通偏向', '5-8 分钟'],
    ['精神功能', '解读右拇开创力与左拇管理力', '4-6 分钟'],
    ['思维功能', '解读右食逻辑与左食创意空间', '4-6 分钟'],
    ['体觉功能', '解读右中精细动作与左中运动耐力', '4-6 分钟'],
    ['听觉功能', '解读右无名语言记忆与左无名音感语气', '4-6 分钟'],
    ['视觉功能', '解读右小指识人方向与左小指色彩图像', '4-6 分钟'],
    ['客户关注问题', '结合报告资料与真实场景回应本次关切', '8-12 分钟'],
    ['行动建议', '形成具体动作、观察指标和复盘周期', '6-10 分钟'],
    ['记录客户反馈 / 必要时提交总部复核', '记录共识、异议、待核实项与后续安排', '4-6 分钟']
  ];

  let steps = STEP_META.map(([title, goal, time], stepIndex) => ({
    stepIndex,
    title,
    goal,
    time,
    why: [], say: [], ask: [], no: [], action: [], risk: []
  }));
  let currentStep = 0;
  let clientId = '';
  let reportId = '';
  let csrfToken = '';
  let interpretationId = '';
  let reportContext = null;
  let busy = false;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = String(value ?? '-');
  }

  function formatDate(value) {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
  }

  function showStatus(title, message, isError = false) {
    const box = $('#session-status');
    if (!box) return;
    box.classList.toggle('dryrun-error', isError);
    let strong = $('strong', box);
    let paragraph = $('p', box);
    if (!strong) {
      strong = document.createElement('strong');
      box.append(strong);
    }
    if (!paragraph) {
      paragraph = document.createElement('p');
      box.append(paragraph);
    }
    strong.textContent = title;
    paragraph.textContent = message;
  }

  async function readPayload(response, fallback) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || fallback);
    if (typeof payload.csrfToken === 'string') csrfToken = payload.csrfToken;
    return payload;
  }

  function pickResult(result, keys) {
    for (const key of keys) {
      const value = result?.[key];
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
    return '-';
  }

  function renderFeatures(result) {
    const target = $('#report-feature-summary');
    if (!target) return;
    const entries = Object.entries(result || {})
      .filter(([, value]) => ['string', 'number'].includes(typeof value))
      .slice(0, 8);
    if (entries.length === 0) {
      target.replaceChildren();
      const row = document.createElement('div');
      row.className = 'data-item';
      row.append(Object.assign(document.createElement('span'), { textContent: '报告摘要' }),
        Object.assign(document.createElement('strong'), { textContent: '以生成报告内容为准' }));
      target.append(row);
      return;
    }
    target.replaceChildren(...entries.map(([key, value]) => {
      const row = document.createElement('div');
      row.className = 'data-item';
      row.append(Object.assign(document.createElement('span'), { textContent: key }),
        Object.assign(document.createElement('strong'), { textContent: String(value) }));
      return row;
    }));
  }

  function renderConcerns(report) {
    const target = $('#client-concerns');
    if (!target) return;
    const concerns = Array.isArray(report.selectedIssues) ? [...report.selectedIssues] : [];
    if (report.customIssue) concerns.push(report.customIssue);
    target.replaceChildren(...(concerns.length ? concerns : ['暂无补充']).map((item) => {
      const tag = document.createElement('span');
      tag.className = 'pill';
      tag.textContent = item;
      return tag;
    }));
  }

  function renderReportContext(payload) {
    const client = payload.client || {};
    const report = payload.report || {};
    const result = report.engineResult || {};
    const fingers = report.fingers && typeof report.fingers === 'object' ? report.fingers : {};
    const trc = Object.values(fingers).reduce((sum, item) => sum + (Number(item?.trc) || 0), 0);
    setText('#session-client-title', `${client.displayName || '客户'} · AI解读助手`);
    setText('#session-report-meta', `${report.reportType || '报告'} · 真实客户报告`);
    setText('#session-client-name', client.displayName || '-');
    setText('#session-client-age', Number.isInteger(report.ageAtReport) ? `${report.ageAtReport} 岁` : '-');
    setText('#session-report-type', report.reportType || '-');
    setText('#session-report-time', formatDate(report.createdAt));
    setText('#session-report-trc', trc > 0 ? trc : '-');
    setText('#session-report-atd', report.atd == null ? '-' : report.atd);
    setText('#session-report-personality', pickResult(result, ['主性格类型', '性格类型']));
    setText('#session-report-channel', pickResult(result, ['学习通道', '先天学习风格', '主学习通道']));
    setText('#session-report-brain', pickResult(result, ['左右脑', '左右脑倾向', '脑功能优势']));
    renderFeatures(result);
    renderConcerns(report);
  }

  function renderStepList() {
    const target = $('#interpretation-step-list');
    if (!target) return;
    target.replaceChildren(...steps.map((step, index) => {
      const button = document.createElement('button');
      button.className = `step-card${index === currentStep ? ' active' : ''}`;
      button.type = 'button';
      button.dataset.step = String(index);
      const status = interpretationId ? (index < currentStep ? '已查看' : index === currentStep ? '当前' : '待查看') : '等待生成';
      button.innerHTML = `<span class="step-index">${index + 1}</span><span><strong></strong><small></small></span><span class="status"></span>`;
      $('strong', button).textContent = step.title;
      $('small', button).textContent = step.goal;
      $('.status', button).textContent = status;
      button.addEventListener('click', () => go(index));
      return button;
    }));
  }

  function collectCurrentEdits() {
    if (!interpretationId || !steps[currentStep]) return;
    for (const field of STEP_FIELDS) {
      const target = document.getElementById(STEP_TARGETS[field]);
      if (!target) continue;
      const values = $$('li', target).map((item) => item.textContent.trim()).filter(Boolean);
      if (values.length) steps[currentStep][field] = values;
    }
  }

  function renderSpeechList(field, values) {
    const target = document.getElementById(STEP_TARGETS[field]);
    if (!target) return;
    const items = values.length ? values : ['生成方案后显示'];
    target.replaceChildren(...items.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      if (interpretationId) {
        item.contentEditable = 'true';
        item.spellcheck = false;
      }
      return item;
    }));
  }

  function updateStep(index) {
    currentStep = Math.max(0, Math.min(steps.length - 1, index));
    const step = steps[currentStep];
    setText('#current-step-index', `第 ${currentStep + 1}/${steps.length} 个板块`);
    setText('#current-step-title', step.title);
    setText('#current-step-time', step.time);
    setText('#current-step-goal', step.goal);
    const progress = $('#session-progress');
    if (progress) progress.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
    for (const field of STEP_FIELDS) renderSpeechList(field, step[field]);
    renderStepList();
  }

  function go(index) {
    collectCurrentEdits();
    updateStep(index);
  }

  function loadSteps(nextSteps, id, status) {
    const metadata = nextSteps.length === LEGACY_STEP_META.length ? LEGACY_STEP_META : STEP_META;
    steps = nextSteps.map((step, index) => ({
      ...steps[index],
      ...step,
      title: metadata[index][0],
      goal: metadata[index][1],
      time: metadata[index][2]
    }));
    interpretationId = id || '';
    currentStep = 0;
    setText('#interpretation-status', status === 'edited' ? '已编辑' : '已生成');
    setText('#interpretation-edit-state', '可编辑');
    $('#save-interpretation').disabled = !interpretationId;
    updateStep(0);
  }

  async function loadClientReport(nextClientId, nextReportId) {
    const query = new URLSearchParams({ clientId: nextClientId, reportId: nextReportId });
    const response = await fetch(`${API}?${query}`, { credentials: 'same-origin' });
    const payload = await readPayload(response, '客户报告暂时无法读取。');
    reportContext = payload;
    renderReportContext(payload);
    if (payload.interpretation?.id && Array.isArray(payload.interpretation.steps)) {
      loadSteps(payload.interpretation.steps, payload.interpretation.id, payload.interpretation.status);
      showStatus('已加载解读方案', '可继续逐步审核、修改并保存。');
    } else {
      showStatus('正在生成', 'AI 正在根据本报告自动生成完整的结构化解读方案，请稍候。');
      await generateInterpretation();
    }
  }

  function setBusy(next) {
    busy = next;
    $('#save-interpretation').disabled = next || !interpretationId;
  }

  async function generateInterpretation() {
    if (busy || !reportContext || !csrfToken) return;
    setBusy(true);
    showStatus('正在生成', 'AI 正在根据本报告生成完整的结构化解读方案，请稍候。');
    try {
      const concerns = Array.isArray(reportContext.report?.selectedIssues)
        ? [...reportContext.report.selectedIssues]
        : [];
      if (reportContext.report?.customIssue) concerns.push(reportContext.report.customIssue);
      const response = await fetch(`${API}?operation=generate`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          clientId,
          reportId,
          clientConcerns: concerns,
          customNotes: $('#interpretation-custom-notes')?.value || ''
        })
      });
      const payload = await readPayload(response, 'AI 解读方案暂时无法生成。');
      const generated = payload.interpretation || payload;
      loadSteps(generated.steps, generated.id || payload.interpretationId, generated.status || payload.status);
      showStatus(payload.reused ? '已加载已有方案' : 'AI 解读方案已生成', '请逐步审核和修改，完成后点击保存。');
    } catch (error) {
      showStatus('生成失败', error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function saveInterpretation() {
    if (busy || !interpretationId || !csrfToken) return;
    collectCurrentEdits();
    setBusy(true);
    showStatus('正在保存', '正在保存本次指导师编辑结果。');
    try {
      const response = await fetch(`${API}?operation=save`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ clientId, reportId, interpretationId, editedSteps: steps })
      });
      const payload = await readPayload(response, '解读方案暂时无法保存。');
      loadSteps(payload.steps, payload.interpretationId, payload.status);
      showStatus('保存成功', '本次修改已保存到客户报告。');
    } catch (error) {
      showStatus('保存失败', error.message, true);
    } finally {
      setBusy(false);
    }
  }

  function initNavigation() {
    let page = document.body.dataset.page;
    const intent = new URLSearchParams(window.location.search).get('intent');
    if (page === 'customers' && intent === 'interpret') page = 'session';
    $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === page));
  }

  function initReviewDemo() {
    if (!document.body.matches('[data-page="review"]')) return;
    $$('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.reviewTarget;
        $$('.tab-btn').forEach((item) => item.classList.toggle('active', item === button));
        $$('.review-demo-card').forEach((card) => card.classList.toggle('active', card.dataset.reviewCard === target));
      });
    });
  }

  function initSession() {
    if (!document.body.matches('[data-page="session"]')) return;
    $('#save-interpretation').disabled = true;
    renderStepList();
    updateStep(0);
    $('#prev-step')?.addEventListener('click', () => go(currentStep - 1));
    $('#next-step')?.addEventListener('click', () => go(currentStep + 1));
    $('#skip-step')?.addEventListener('click', () => go(currentStep + 1));
    $('#save-interpretation')?.addEventListener('click', saveInterpretation);

    const params = new URLSearchParams(window.location.search);
    clientId = params.get('clientId') || '';
    reportId = params.get('reportId') || '';
    if (!UUID_PATTERN.test(clientId) || !UUID_PATTERN.test(reportId)) {
      showStatus('尚未选择真实客户报告', '请返回“我的客户”，点击一份已生成的报告进入。');
      return;
    }
    loadClientReport(clientId, reportId).catch((error) => {
      showStatus('报告加载失败', error.message, true);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSession();
    initReviewDemo();
  });
})();
