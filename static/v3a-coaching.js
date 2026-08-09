(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'coaching') return;
  let personId = new URLSearchParams(window.location.search).get('person_id') || '';
  let csrfToken = '';
  let suggestion = null;
  let busy = false;
  const stageLabels = { initial: '初始解读期', early: '早期跟进', deep: '深度辅导', consolidation: '巩固期' };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setError(message) {
    const target = document.querySelector('#coachingError');
    if (!target) return;
    target.textContent = message || '';
    target.hidden = !message;
  }

  function section(className, number, title, content) {
    const card = node('section', `coaching-section ${className}`);
    const heading = node('h3');
    heading.append(node('span', '', number), document.createTextNode(title));
    card.append(heading, node('p', '', content));
    return card;
  }

  function renderContext(payload) {
    document.querySelector('#pageTitle').textContent = `${payload.client.displayName} · AI辅导助手`;
    const info = document.querySelector('#clientInfo');
    info.replaceChildren();
    const engine = payload.latestReport?.engineResult || {};
    const functions = engine['五功能区'] || {};
    const atd = engine['ATD'] || {};
    const channel = engine['学习通道'] || {};
    [
      ['服务阶段', stageLabels[payload.client.stage] || '初始解读期'],
      ['最新报告', payload.latestReport?.reportType || '暂无'],
      ['TRC', functions['总TRC'] ?? engine.trc ?? engine.totalTrc ?? '--'],
      ['ATD', payload.latestReport?.atd ?? atd['值'] ?? '--'],
      ['性格类型', engine['主性格类型'] || '--'],
      ['学习通道', channel['主通道'] || '--'],
      ['报告时间', payload.latestReport?.createdAt ? new Date(payload.latestReport.createdAt).toLocaleDateString('zh-CN') : '--']
    ].forEach(([label, value]) => {
      const item = node('div', 'data-item');
      item.append(node('span', '', label), node('strong', '', value));
      info.append(item);
    });
    const pills = document.querySelector('#concernPills');
    pills.replaceChildren(...(payload.coreConcerns?.length ? payload.coreConcerns.map((item) => node('span', 'pill active', item)) : [node('span', 'pill', '暂无关注问题') ]));
    const timeline = document.querySelector('#miniTimeline');
    timeline.replaceChildren(...(payload.growthRecords?.length ? payload.growthRecords.map((record) => {
      const item = node('div', 'timeline-item');
      item.append(node('div', 'timeline-meta', new Date(record.createdAt).toLocaleDateString('zh-CN')), node('div', 'timeline-body', record.content));
      return item;
    }) : [node('div', 'v4-empty-state', '暂无成长记录。')]));
    const insight = document.querySelector('#insightContent');
    insight.replaceChildren(node('div', 'insight-bar info', payload.insight || '请结合客户实际情况进行判断。'));
    document.querySelector('#btnGenerate').disabled = false;
    document.querySelector('#btnHistory').disabled = false;
  }

  function renderSuggestion(payload) {
    suggestion = {
      understanding: payload.understanding,
      direction: payload.direction,
      script: payload.script,
      risks: payload.risks,
      knowledge_refs: payload.knowledge_refs,
      generated_at: payload.generated_at
    };
    const middle = document.querySelector('#coachingOutput');
    middle.hidden = false;
    middle.replaceChildren(section('coaching-understanding', '1', '当前状态理解', payload.understanding), section('coaching-direction', '2', '建议沟通方向', payload.direction));
    const right = document.querySelector('#scriptOutput');
    right.hidden = false;
    const script = section('coaching-script', '3', '参考话术', payload.script);
    const copy = node('button', 'btn ghost', '复制话术');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(payload.script); copy.textContent = '已复制'; } catch { setError('复制失败，请手动选择话术。'); }
    });
    script.append(copy);
    const risks = node('section', 'coaching-section coaching-risk');
    const heading = node('h3');
    heading.append(node('span', '', '4'), document.createTextNode('风险提示'));
    const list = node('ul', 'v4-risk-list');
    (payload.risks || []).forEach((risk) => list.append(node('li', `insight-bar ${risk.level === 'tip' ? 'info' : 'warn'}`, risk.text)));
    risks.append(heading, list);
    right.replaceChildren(script, risks);
    document.querySelector('#btnSaveRecord').disabled = false;
  }

  async function jsonRequest(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '操作暂时无法完成。');
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    return payload;
  }

  async function load() {
    if (!/^[0-9a-f-]{36}$/i.test(personId)) {
      document.querySelector('#pickerView').hidden = false;
      document.querySelector('#sessionView').hidden = true;
      try {
        const payload = await jsonRequest('/api/v3a-client-data-center/person-list');
        const target = document.querySelector('#pickerList');
        target.replaceChildren();
        (payload.people || []).forEach((person) => {
          const button = node('button', 'picker-card');
          button.type = 'button';
          const stage = node('span', `stage-tag ${person.stage || 'initial'}`, stageLabels[person.stage] || '初始解读期');
          const labelWrap = node('div', 'picker-card-name');
          labelWrap.append(node('strong', '', person.displayName || '客户'), stage);
          button.append(labelWrap, node('div', 'picker-card-meta', `服务阶段：${stageLabels[person.stage] || '初始解读期'}`), node('div', 'picker-card-action', '开始辅导 →'));
          button.addEventListener('click', () => window.location.assign(`/ai-coaching-assistant.html?person_id=${encodeURIComponent(person.id)}`));
          target.append(button);
        });
        if (!target.childElementCount) target.append(node('div', 'v4-empty-state', '暂无可辅导的客户。'));
      } catch (error) { setError(error.message); }
      return;
    }
    document.querySelector('#pickerView').hidden = true;
    document.querySelector('#sessionView').hidden = false;
    try {
      const payload = await jsonRequest(`/api/v3a-client-data-center?person_id=${encodeURIComponent(personId)}&view=coaching`);
      renderContext(payload);
    } catch (error) { setError(error.message); }
  }

  async function generate() {
    const topic = document.querySelector('#topicInput').value.trim();
    if (busy || topic.length < 2 || !csrfToken) return setError('请填写本次辅导话题。');
    busy = true;
    setError('');
    const button = document.querySelector('#btnGenerate');
    button.disabled = true;
    button.textContent = '正在生成…';
    try {
      const payload = await jsonRequest('/api/v3a-coaching-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ person_id: personId, topic, coaching_type: document.querySelector('#coachingType').value, session_type: document.querySelector('#sessionType').value })
      });
      renderSuggestion(payload);
    } catch (error) { setError(error.message); }
    finally { busy = false; button.disabled = false; button.textContent = '生成辅导建议'; }
  }

  async function save() {
    if (busy || !suggestion || !csrfToken) return;
    busy = true;
    const button = document.querySelector('#btnSaveRecord');
    button.disabled = true;
    try {
      const topic = document.querySelector('#topicInput').value.trim();
      const base = {
        person_id: personId,
        coaching_type: document.querySelector('#coachingType').value,
        session_type: document.querySelector('#sessionType').value,
        topic,
        suggestion,
        parent_reaction: document.querySelector('#parentReaction').value.trim(),
        session_effect: document.querySelector('#sessionEffect').value.trim(),
        next_plan: document.querySelector('#nextPlan').value.trim()
      };
      await jsonRequest('/api/v3a-coaching-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify(base) });
      if (document.querySelector('#alsoGrowthRecord').checked) {
        const content = base.session_effect || base.next_plan || `完成辅导：${topic}`;
        await jsonRequest('/api/v3a-growth-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ person_id: personId, record_type: 'advisor_obs', domain_tags: [], change_direction: 'stable', related_fingerprint_markers: [], visibility: 'advisor_only', content, source: 'coaching_session' })
        });
      }
      setError('辅导记录已保存。');
    } catch (error) { setError(error.message); }
    finally { busy = false; button.disabled = false; }
  }

  document.querySelector('#btnGenerate')?.addEventListener('click', generate);
  document.querySelector('#btnSaveRecord')?.addEventListener('click', save);
  document.querySelector('#btnHistory')?.addEventListener('click', () => window.location.assign(`/client-360.html?person_id=${encodeURIComponent(personId)}`));
  document.querySelector('#topicInput')?.addEventListener('input', (event) => { document.querySelector('#btnGenerate').disabled = !csrfToken || event.target.value.trim().length < 2; });
  document.addEventListener('v3a:workbench-ready', load, { once: true });
})();
