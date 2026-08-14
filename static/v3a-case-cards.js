(function () {
  'use strict';

  const onCasesPage = document.body?.dataset?.page === 'cases';
  const onCustomersPage = document.body?.dataset?.page === 'customers';
  if (!onCasesPage && !onCustomersPage) return;
  let csrfToken = '';
  let currentPerson = null;
  let busy = false;

  function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function setError(message) { const el = document.querySelector('#caseError') || document.querySelector('#v3a-attribution-error'); if (!el) return; el.textContent = message || ''; el.hidden = !message; }
  function selected(selector, key) { return [...document.querySelectorAll(`${selector}.active`)].map((el) => el.dataset[key]).filter(Boolean); }

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '案例操作暂时无法完成。');
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    return payload;
  }

  function ensureModal() {
    if (document.querySelector('#caseModal')) return;
    const overlay = node('div', 'case-modal-overlay'); overlay.id = 'caseModal'; overlay.hidden = true;
    const modal = node('section', 'case-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<h2>存入特殊案例库</h2><div class="form-row"><label>客户</label><strong id="caseModalPerson"></strong></div><div class="form-row"><label>案例类型（可多选）</label><div class="pill-row" id="caseTypePills"><button class="pill" type="button" data-type="fingerprint_rare">皮纹特征少见</button><button class="pill" type="button" data-type="coaching_effective">辅导方法有效</button><button class="pill" type="button" data-type="turning_point">服务转折明显</button><button class="pill" type="button" data-type="stubborn_problem">持续问题</button><button class="pill" type="button" data-type="parent_child_improvement">亲子关系改善</button><button class="pill" type="button" data-type="long_term_tracking">长期跟踪</button><button class="pill" type="button" data-type="other">其他</button></div></div><div class="form-row"><label for="caseTitle">案例标题</label><input class="input" id="caseTitle" maxlength="120"></div><div class="form-row"><label for="caseContent">为什么值得留存</label><textarea class="textarea" id="caseContent" maxlength="5000" rows="5"></textarea></div><div class="form-row"><label>关联知识点（可选）</label><div class="pill-row" id="knowledgePills"><button class="pill" type="button" data-kc="A1">ATD</button><button class="pill" type="button" data-kc="A3">性格类型</button><button class="pill" type="button" data-kc="A5">TRC</button><button class="pill" type="button" data-kc="B3">家庭系统</button><button class="pill" type="button" data-kc="B4">亲子沟通</button></div></div><div class="btn-row"><button class="btn ghost" id="btnCloseCase" type="button">取消</button><button class="btn ghost" id="btnSaveDraft" type="button">保存为草稿</button><button class="btn primary" id="btnSubmitCase" type="button">提交总部审核</button></div>';
    overlay.append(modal); document.body.append(overlay); bindModal();
  }

  function resetModal() {
    document.querySelectorAll('#caseModal .pill.active').forEach((item) => item.classList.remove('active'));
    const title = document.querySelector('#caseTitle'); const content = document.querySelector('#caseContent');
    if (title) title.value = ''; if (content) content.value = '';
  }

  window.openCaseModal = function (personId, personName) {
    ensureModal();
    if (!/^[0-9a-f-]{36}$/i.test(String(personId || ''))) return setError('客户标识无效。');
    currentPerson = { id: String(personId), name: String(personName || '客户') };
    resetModal();
    document.querySelector('#caseModalPerson').textContent = currentPerson.name;
    document.querySelector('#caseModal').hidden = false;
  };
  window.closeCaseModal = function () { const modal = document.querySelector('#caseModal'); if (modal) modal.hidden = true; currentPerson = null; };

  async function createCase(visibility) {
    if (busy || !currentPerson || !csrfToken) return;
    const title = document.querySelector('#caseTitle').value.trim();
    const content = document.querySelector('#caseContent').value.trim();
    const caseTypes = selected('#caseTypePills [data-type]', 'type');
    if (!title || !content || !caseTypes.length) return setError('请填写标题、留存理由，并至少选择一个案例类型。');
    busy = true;
    try {
      await request('/api/v3a-case-cards', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ person_id: currentPerson.id, title, content, case_type: caseTypes, visibility, related_knowledge_cards: selected('#knowledgePills [data-kc]', 'kc') }) });
      window.closeCaseModal(); setError(visibility === 'submitted' ? '案例已提交总部审核。' : '案例草稿已保存。'); if (onCasesPage) await loadCases();
    } catch (error) { setError(error.message); }
    finally { busy = false; }
  }

  function bindModal() {
    document.querySelector('#caseTypePills')?.addEventListener('click', (event) => event.target.closest('[data-type]')?.classList.toggle('active'));
    document.querySelector('#knowledgePills')?.addEventListener('click', (event) => event.target.closest('[data-kc]')?.classList.toggle('active'));
    document.querySelector('#btnCloseCase')?.addEventListener('click', window.closeCaseModal);
    document.querySelector('#btnSaveDraft')?.addEventListener('click', () => createCase('private'));
    document.querySelector('#btnSubmitCase')?.addEventListener('click', () => createCase('submitted'));
  }

  function visibilityLabel(value) { return ({ private: '仅我可见', submitted: '审核中', shared: '团队共享', returned: '已退回' })[value] || value; }
  function renderCase(item, role) {
    const card = node('article', 'case-card-item');
    const meta = node('div', 'case-meta');
    meta.append(node('span', `case-visibility-tag ${item.visibility}`, visibilityLabel(item.visibility)), node('span', '', item.personName || '客户'), node('span', '', new Date(item.createdAt).toLocaleDateString('zh-CN')));
    card.append(meta, node('h3', 'case-title', item.title), node('p', 'case-summary', item.content));
    const actions = node('div', 'v4-row-actions');
    if (item.visibility === 'private' || item.visibility === 'returned') {
      const submit = node('button', 'btn ghost', '提交审核'); submit.type = 'button'; submit.addEventListener('click', () => caseAction(item.id, 'submit'));
      const remove = node('button', 'btn ghost', '删除'); remove.type = 'button'; remove.addEventListener('click', () => caseAction(item.id, 'delete'));
      actions.append(submit, remove);
    }
    if (role === 'super_admin' && item.visibility === 'submitted') {
      const approve = node('button', 'btn primary', '通过并共享'); approve.type = 'button'; approve.addEventListener('click', () => reviewCase(item.id, 'approve'));
      const reject = node('button', 'btn ghost', '退回'); reject.type = 'button'; reject.addEventListener('click', () => reviewCase(item.id, 'return'));
      actions.append(approve, reject);
    }
    if (actions.childElementCount) card.append(actions);
    return card;
  }

  async function caseAction(id, action) {
    if (busy || !csrfToken) return;
    busy = true;
    try {
      await request(action === 'delete' ? `/api/v3a-case-cards/${encodeURIComponent(id)}` : `/api/v3a-case-cards/${encodeURIComponent(id)}/submit`, { method: action === 'delete' ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, ...(action === 'submit' ? { body: '{}' } : {}) });
      await loadCases();
    } catch (error) { setError(error.message); }
    finally { busy = false; }
  }

  async function reviewCase(id, decision) {
    const comment = window.prompt(decision === 'approve' ? '审核意见（可留空）' : '请填写退回原因') || '';
    if (decision === 'return' && !comment.trim()) return;
    try { await request(`/api/v3a-case-cards/${encodeURIComponent(id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ decision, comment }) }); await loadCases(); }
    catch (error) { setError(error.message); }
  }

  function renderList(targetId, emptyId, items, role) {
    const target = document.querySelector(targetId); const empty = document.querySelector(emptyId);
    if (!target) return;
    target.replaceChildren(...items.map((item) => renderCase(item, role)));
    if (empty) empty.hidden = items.length > 0;
  }

  async function loadCases() {
    try {
      const payload = await request('/api/v3a-case-cards');
      renderList('#myCaseList', '#myCasesEmpty', payload.myCases || [], payload.role);
      renderList('#sharedCaseList', '#sharedEmpty', payload.sharedCases || [], payload.role);
      const pending = payload.pendingCases || [];
      renderList('#pendingCaseList', '#pendingEmpty', pending, payload.role);
      document.querySelector('#pendingSection').hidden = payload.role !== 'super_admin';
      document.querySelector('#pendingBadge').hidden = payload.role !== 'super_admin';
      document.querySelector('#pendingCount').textContent = String(pending.length);
    } catch (error) { setError(error.message); }
  }

  async function init() {
    ensureModal();
    try { const payload = await request('/api/v3a-case-cards'); if (onCasesPage) { renderList('#myCaseList', '#myCasesEmpty', payload.myCases || [], payload.role); renderList('#sharedCaseList', '#sharedEmpty', payload.sharedCases || [], payload.role); const pending = payload.pendingCases || []; renderList('#pendingCaseList', '#pendingEmpty', pending, payload.role); document.querySelector('#pendingSection').hidden = payload.role !== 'super_admin'; document.querySelector('#pendingBadge').hidden = payload.role !== 'super_admin'; document.querySelector('#pendingCount').textContent = String(pending.length); } }
    catch (error) { setError(error.message); }
  }

  if (document.querySelector('#caseModal')) bindModal();
  document.querySelector('#btnNewCase')?.addEventListener('click', () => {
    window.location.assign('ai-interpreter-customers.html#v3a-real-customers');
  });
  document.addEventListener('v3a:workbench-ready', init, { once: true });
})();
