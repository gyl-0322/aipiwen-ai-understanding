(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'workbench') return;

  const GROWTH_SNAPSHOT_API = '/api/v3a-attribution?action=growth-snapshot';
  const statusIcons = {
    completed: '✓',
    in_progress: '○',
    locked: '○'
  };
  const statusLabels = {
    completed: '已完成',
    in_progress: '进行中',
    locked: '尚未开始'
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function normalize(value) {
    return String(value ?? '').trim();
  }

  function formatTime(value) {
    if (!value) return '未记录';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
  }

  function showError(message) {
    const node = $('#v3a-growth-snapshot-message');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  async function requestGrowthSnapshot() {
    let response;
    try {
      response = await fetch(GROWTH_SNAPSHOT_API, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
    } catch {
      throw new Error('成长快照暂时无法读取，请稍后重试。');
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Keep malformed upstream responses out of the page.
    }
    if (!response.ok || payload?.ok !== true || payload?.version !== 'v0.1') {
      throw new Error(payload?.error || '成长快照暂时无法读取，请稍后重试。');
    }
    return payload;
  }

  function renderGrowthSnapshot(snapshot) {
    const milestonesNode = $('#v3a-growth-milestones');
    const logsNode = $('#v3a-growth-recent-logs');
    if (!milestonesNode || !logsNode) return;

    const balance = Number(snapshot.balance);
    const safeBalance = Number.isFinite(balance) ? balance : 0;
    $('#v3a-growth-balance').textContent = String(safeBalance);
    $('#v3a-workbench-balance').textContent = String(safeBalance);

    milestonesNode.replaceChildren();
    for (const milestone of snapshot.milestones || []) {
      const status = Object.prototype.hasOwnProperty.call(statusIcons, milestone.status)
        ? milestone.status
        : 'locked';
      const item = document.createElement('li');
      item.className = `growth-milestone ${status}`;
      item.setAttribute('aria-label', `${milestone.label || '成长里程碑'}，${statusLabels[status]}`);

      const icon = document.createElement('span');
      icon.className = 'growth-milestone-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = statusIcons[status];

      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = milestone.label || '成长里程碑';
      const description = document.createElement('small');
      description.textContent = milestone.description || statusLabels[status];
      copy.append(title, description);

      const reward = document.createElement('span');
      reward.className = 'growth-milestone-reward';
      reward.textContent = Number.isFinite(Number(milestone.reward)) ? `+${Number(milestone.reward)}` : '—';
      item.append(icon, copy, reward);
      milestonesNode.append(item);
    }

    logsNode.replaceChildren();
    const logs = Array.isArray(snapshot.recentLogs) ? snapshot.recentLogs.slice(0, 10) : [];
    if (logs.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'growth-log-empty';
      empty.textContent = '成长贡献产生后，将在这里留下记录。';
      logsNode.append(empty);
      return;
    }
    for (const log of logs) {
      const item = document.createElement('li');
      item.className = 'growth-log';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = log.title || '成长积分记录';
      const meta = document.createElement('small');
      const note = normalize(log.note);
      meta.textContent = note ? `${formatTime(log.createdAt)} · ${note}` : formatTime(log.createdAt);
      copy.append(title, meta);
      const amountValue = Number(log.amount);
      const amount = document.createElement('em');
      amount.textContent = Number.isFinite(amountValue)
        ? `${amountValue > 0 ? '+' : ''}${amountValue}`
        : '—';
      item.append(copy, amount);
      logsNode.append(item);
    }
  }

  async function loadGrowthSnapshot() {
    try {
      renderGrowthSnapshot(await requestGrowthSnapshot());
      showError('');
    } catch (error) {
      showError(error.message);
    }
  }

  document.addEventListener('v3a:workbench-ready', () => {
    void loadGrowthSnapshot();
  }, { once: true });
}());
