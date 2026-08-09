(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'customers') return;
  const summaries = new Map();
  let requestVersion = 0;
  const labels = {
    initial: '初始解读期',
    early: '早期跟进',
    deep: '深度辅导',
    consolidation: '巩固期'
  };

  function apply() {
    const filter = document.querySelector('#v3a-customer-stage-filter')?.value || 'all';
    document.querySelectorAll('#v3a-real-customers-list .table-row[data-client-id]').forEach((row) => {
      const summary = summaries.get(row.dataset.clientId) || { stage: 'initial', candidate: false };
      const stage = row.querySelector('[data-v4-stage]');
      if (stage) {
        stage.className = `stage-tag ${summary.stage}`;
        stage.dataset.v4Stage = summary.stage;
        stage.textContent = labels[summary.stage] || labels.initial;
      }
      const candidate = row.querySelector('[data-v4-candidate]');
      if (candidate) {
        candidate.dataset.v4Candidate = String(summary.candidate === true);
        candidate.className = summary.candidate ? 'case-candidate-tag' : '';
        candidate.textContent = summary.candidate ? '✦ 候选案例' : '-';
      }
      row.hidden = filter !== 'all' && summary.stage !== filter;
    });
  }

  async function refresh(event) {
    const ids = (event.detail?.clients || []).map((client) => String(client.id || '')).filter(Boolean);
    if (!ids.length) {
      apply();
      return;
    }
    const version = ++requestVersion;
    try {
      const url = `/api/v3a-client-data-center/stage-summary?person_ids=${encodeURIComponent(ids.join(','))}`;
      const response = await fetch(url, { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error('服务阶段暂时无法读取。');
      if (version !== requestVersion) return;
      (Array.isArray(payload.summaries) ? payload.summaries : []).forEach((summary) => {
        if (summary?.personId && labels[summary.stage]) summaries.set(summary.personId, summary);
      });
    } catch {
      ids.forEach((id) => {
        if (!summaries.has(id)) summaries.set(id, { stage: 'initial', candidate: false });
      });
    }
    apply();
  }

  document.addEventListener('v3a:customers-rendered', refresh);
  document.querySelector('#v3a-customer-stage-filter')?.addEventListener('change', apply);
})();
