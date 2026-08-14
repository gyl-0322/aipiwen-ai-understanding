(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'client-360') return;
  let personId = new URLSearchParams(window.location.search).get('person_id') || '';
  const stageLabels = { initial: '初始解读期', early: '早期跟进', deep: '深度辅导', consolidation: '巩固期' };
  const sourceLabels = { advisor_qr: '客户扫码', advisor_import: '代客户上传', unguided: '总部指派' };
  const directionLabels = { improving: '进步', stable: '持平', declining: '退步', new_emergence: '新出现', resolved: '已解决' };
  const domainLabels = { learning: '学习', behavior: '行为', emotion: '情绪', social: '社交', parent_child: '亲子关系', family_system: '家庭系统', physical: '身体' };
  const coachingTypeLabels = { phone_follow_up: '电话回访', deep_coaching: '深度辅导', initial_interpretation: '首次解读', emergency: '紧急沟通', daily_follow_up: '日常跟进' };
  let data = null;
  let activeTab = 'fingerprint';

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString('zh-CN');
  }

  function empty(text) {
    return node('div', 'v4-empty-state', text);
  }

  function infoRows(items) {
    const list = node('div', 'data-list');
    items.forEach(([label, value]) => {
      const item = node('div', 'data-item');
      item.append(node('span', '', label), node('strong', '', value ?? '--'));
      list.append(item);
    });
    return list;
  }

  function renderFingerprint(target) {
    const report = data.latestReport;
    if (!report) return target.append(empty('该客户暂无可查看的报告。'));
    const engine = report.engineResult || {};
    const functions = engine['五功能区'] || {};
    const atd = engine['ATD'] || {};
    target.append(infoRows([
      ['报告类型', report.reportType],
      ['报告年龄', report.ageAtReport == null ? '--' : `${report.ageAtReport} 岁`],
      ['TRC', functions['总TRC'] ?? engine.trc ?? engine.totalTrc ?? '--'],
      ['ATD', report.atd ?? atd['值'] ?? '--'],
      ['解读方案', report.interpretationStatus ? '已建立' : '尚未建立'],
      ['报告时间', formatDate(report.createdAt)]
    ]));
    if (data.coreConcerns?.length) {
      const concerns = node('div', 'module');
      concerns.append(node('h3', '', '客户关注问题'));
      const pills = node('div', 'pill-row');
      data.coreConcerns.forEach((item) => pills.append(node('span', 'pill active', item)));
      concerns.append(pills);
      target.append(concerns);
    }
  }

  function renderTimeline(target) {
    if (!data.growthRecords?.length) return target.append(empty('暂无成长记录。'));
    const list = node('div', 'timeline-list');
    data.growthRecords.forEach((record) => {
      const item = node('article', 'timeline-item');
      const meta = node('div', 'timeline-meta');
      meta.append(node('time', '', formatDate(record.createdAt)), node('span', 'source', record.source === 'coaching_session' ? '辅导记录' : '指导师记录'));
      const body = node('div', 'timeline-body');
      const tags = node('div', 'timeline-tags');
      tags.append(node('span', `direction-tag ${record.changeDirection}`, directionLabels[record.changeDirection] || '变化记录'));
      (record.domainTags || []).forEach((tag) => tags.append(node('span', 'pill', domainLabels[tag] || tag)));
      body.append(tags, node('p', '', record.content));
      item.append(meta, body);
      list.append(item);
    });
    target.append(list);
  }

  function renderService(target) {
    if (!data.coachingSessions?.length) return target.append(empty('暂无辅导服务记录。'));
    const list = node('div', 'timeline-list');
    data.coachingSessions.forEach((session) => {
      const item = node('article', 'timeline-item');
      const meta = node('div', 'timeline-meta');
      meta.append(node('time', '', formatDate(session.createdAt)), node('span', 'source', coachingTypeLabels[session.coachingType] || session.coachingType || '辅导'));
      const body = node('div', 'timeline-body');
      body.append(node('strong', '', session.topic || '辅导记录'));
      if (session.sessionEffect) body.append(node('p', '', `本次效果：${session.sessionEffect}`));
      if (session.nextPlan) body.append(node('p', '', `下次计划：${session.nextPlan}`));
      item.append(meta, body);
      list.append(item);
    });
    target.append(list);
  }

  function renderActionPlan(target) {
    target.append(infoRows([
      ['当前目标', data.actionPlan?.currentGoal || '尚未记录'],
      ['下次跟进', data.actionPlan?.nextFollowUp || '尚未安排'],
      ['系统提示', data.insight || '暂无提示']
    ]));
  }

  function renderTab() {
    const target = document.querySelector('#tabContent');
    if (!target) return;
    target.replaceChildren();
    if (!data) return target.append(empty('请从“我的客户”选择一位客户。'));
    if (activeTab === 'fingerprint') renderFingerprint(target);
    if (activeTab === 'timeline') renderTimeline(target);
    if (activeTab === 'service') renderService(target);
    if (activeTab === 'action-plan') renderActionPlan(target);
  }

  function render() {
    document.querySelector('#pageTitle').textContent = `${data.client.displayName} · 客户 360`;
    document.querySelector('#clientName').textContent = data.client.displayName;
    const stage = document.querySelector('#clientStage');
    stage.className = `stage-tag ${data.client.stage}`;
    stage.textContent = stageLabels[data.client.stage] || stageLabels.initial;
    document.querySelector('#sumReport').textContent = data.latestReport ? `${data.latestReport.reportType} · ${formatDate(data.latestReport.createdAt)}` : '暂无报告';
    document.querySelector('#sumFollowUp').textContent = data.actionPlan?.nextFollowUp || '尚未安排';
    document.querySelector('#sumSource').textContent = sourceLabels[data.client.source] || '平台记录';
    document.querySelector('#timelineCount').textContent = String(data.growthRecords?.length || 0);
    document.querySelector('#btnStartCoaching').disabled = !data.latestReport;
    document.querySelector('#btnAddRecord').disabled = false;
    renderTab();
  }

  function renderPicker(people) {
    const target = document.querySelector('#tabContent');
    target.replaceChildren(node('h2', '', '请选择客户'));
    const list = node('div', 'case-list');
    (people || []).forEach((person) => {
      const button = node('button', 'clue-card', person.displayName || '客户');
      button.type = 'button';
      button.addEventListener('click', () => window.location.assign(`/client-360.html?person_id=${encodeURIComponent(person.id)}`));
      list.append(button);
    });
    target.append(list.childElementCount ? list : empty('暂无可查看的客户。'));
  }

  async function load() {
    const error = document.querySelector('#client360Error');
    if (!/^[0-9a-f-]{36}$/i.test(personId)) {
      try {
        const response = await fetch('/api/v3a-client-data-center/person-list', { credentials: 'same-origin' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '客户列表暂时无法读取。');
        renderPicker(payload.people || []);
      } catch (caught) {
        if (error) { error.textContent = caught.message; error.hidden = false; }
      }
      return;
    }
    try {
      const response = await fetch(`/api/v3a-client-data-center?person_id=${encodeURIComponent(personId)}&view=full`, { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '客户档案暂时无法读取。');
      data = payload;
      render();
    } catch (caught) {
      if (error) { error.textContent = caught.message; error.hidden = false; }
    }
  }

  document.querySelector('#archiveTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    activeTab = button.dataset.tab;
    document.querySelectorAll('#archiveTabs [data-tab]').forEach((item) => item.classList.toggle('active', item === button));
    renderTab();
  });
  document.querySelector('#btnStartCoaching')?.addEventListener('click', () => window.location.assign(`/ai-coaching-assistant.html?person_id=${encodeURIComponent(personId)}`));
  document.querySelector('#btnAddRecord')?.addEventListener('click', () => window.location.assign(`/growth-record.html?person_id=${encodeURIComponent(personId)}`));
  document.addEventListener('v3a:workbench-ready', load, { once: true });
})();
