(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'growth-record') return;
  const preset = new URLSearchParams(window.location.search).get('person_id') || '';
  const people = new Map();
  let csrfToken = '';
  let offset = 0;
  let loading = false;
  const directionLabels = { improving: '进步', stable: '持平', declining: '退步', new_emergence: '新出现', resolved: '已解决' };
  const domainLabels = { learning: '学习', behavior: '行为', emotion: '情绪', social: '社交', parent_child: '亲子关系', family_system: '家庭系统', physical: '身体' };

  function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function setError(message) { const el = document.querySelector('#growthError'); el.textContent = message || ''; el.hidden = !message; }
  function selected(selector, key) { return [...document.querySelectorAll(`${selector}.active`)].map((el) => el.dataset[key]).filter(Boolean); }
  function single(selector, key) { return document.querySelector(`${selector}.active`)?.dataset[key] || ''; }

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '操作暂时无法完成。');
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    return payload;
  }

  function populatePeople(list) {
    const targets = [document.querySelector('#selectPerson'), document.querySelector('#filterPerson')];
    list.forEach((person) => {
      people.set(person.id, person.displayName);
      targets.forEach((target) => {
        const option = document.createElement('option'); option.value = person.id; option.textContent = person.displayName; target.append(option);
      });
    });
    if (people.has(preset)) document.querySelector('#selectPerson').value = preset;
  }

  function render(records, append) {
    const target = document.querySelector('#timelineList');
    if (!append) target.replaceChildren();
    if (!append && !records.length) return target.append(node('div', 'v4-empty-state', '暂无符合条件的成长记录。'));
    records.forEach((record) => {
      const item = node('article', 'timeline-item');
      const meta = node('div', 'timeline-meta');
      meta.append(node('time', '', new Date(record.createdAt).toLocaleDateString('zh-CN')), node('span', 'source', people.get(record.personId) || '客户'));
      const body = node('div', 'timeline-body');
      const tags = node('div', 'timeline-tags');
      tags.append(node('span', `direction-tag ${record.changeDirection}`, directionLabels[record.changeDirection] || '变化记录'));
      (record.domainTags || []).forEach((tag) => tags.append(node('span', 'pill', domainLabels[tag] || tag)));
      body.append(tags, node('p', '', record.content)); item.append(meta, body); target.append(item);
    });
  }

  async function loadRecords(reset) {
    if (loading) return;
    loading = true;
    if (reset) offset = 0;
    const params = new URLSearchParams({ limit: '20', offset: String(offset) });
    const person = document.querySelector('#filterPerson').value;
    const domain = document.querySelector('#filterDomain').value;
    const direction = document.querySelector('#filterDirection').value;
    if (person) params.set('person_id', person);
    if (domain) params.set('domain_tags', domain);
    if (direction) params.set('change_direction', direction);
    try {
      const payload = await request(`/api/v3a-growth-records?${params}`);
      render(payload.records || [], !reset);
      offset += (payload.records || []).length;
      document.querySelector('#btnLoadMore').hidden = (payload.records || []).length < 20;
    } catch (error) { setError(error.message); }
    finally { loading = false; }
  }

  async function save() {
    const personId = document.querySelector('#selectPerson').value;
    const content = document.querySelector('#recordContent').value.trim();
    if (!personId || !content || !csrfToken) return setError('请选择客户并填写记录内容。');
    const button = document.querySelector('#btnSaveRecord'); button.disabled = true;
    try {
      await request('/api/v3a-growth-records', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ person_id: personId, record_type: single('#recordTypePills [data-type]', 'type'), domain_tags: selected('#domainPills [data-domain]', 'domain'), change_direction: single('#directionPills [data-direction]', 'direction'), related_fingerprint_markers: selected('#markerPills [data-marker]', 'marker'), visibility: single('#visibilityPills [data-visibility]', 'visibility'), content, source: 'advisor_workbench' })
      });
      document.querySelector('#recordContent').value = '';
      document.querySelector('#charCount').textContent = '0/2000';
      setError('成长记录已保存。');
      await loadRecords(true);
    } catch (error) { setError(error.message); }
    finally { button.disabled = false; }
  }

  function bindPills(container, multiple) {
    document.querySelector(container)?.addEventListener('click', (event) => {
      const button = event.target.closest('.pill'); if (!button) return;
      if (!multiple) document.querySelectorAll(`${container} .pill`).forEach((item) => item.classList.remove('active'));
      button.classList.toggle('active', multiple ? !button.classList.contains('active') : true);
    });
  }

  async function init() {
    try { const payload = await request('/api/v3a-client-data-center/person-list'); populatePeople(payload.people || []); await loadRecords(true); }
    catch (error) { setError(error.message); }
  }
  bindPills('#recordTypePills', false); bindPills('#domainPills', true); bindPills('#directionPills', false); bindPills('#markerPills', true); bindPills('#visibilityPills', false);
  document.querySelector('#recordContent')?.addEventListener('input', (event) => { document.querySelector('#charCount').textContent = `${event.target.value.length}/2000`; document.querySelector('#btnSaveRecord').disabled = !event.target.value.trim() || !document.querySelector('#selectPerson').value; });
  document.querySelector('#selectPerson')?.addEventListener('change', () => { document.querySelector('#btnSaveRecord').disabled = !document.querySelector('#recordContent').value.trim() || !document.querySelector('#selectPerson').value; });
  ['#filterPerson', '#filterDomain', '#filterDirection', '#filterRecorder'].forEach((selector) => document.querySelector(selector)?.addEventListener('change', () => loadRecords(true)));
  document.querySelector('#btnLoadMore')?.addEventListener('click', () => loadRecords(false));
  document.querySelector('#btnSaveRecord')?.addEventListener('click', save);
  document.addEventListener('v3a:workbench-ready', init, { once: true });
})();
