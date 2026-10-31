(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'growth-record') return;

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SESSION_STORAGE_KEY = 'aipiwen_growth_result_unknown_v1';
  const PAGE_SIZE = 20;
  const STATES = Object.freeze({
    EMPTY_INPUT: 'EMPTY_INPUT',
    READY_TO_SUBMIT: 'READY_TO_SUBMIT',
    SUBMITTING: 'SUBMITTING',
    RESULT_UNKNOWN: 'RESULT_UNKNOWN',
    SAVED: 'SAVED',
    READ_FAILED: 'READ_FAILED',
    SAVE_FAILED: 'SAVE_FAILED',
    IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
    PENDING_OTHER_CUSTOMER: 'PENDING_OTHER_CUSTOMER',
    CONTEXT_INVALID: 'CONTEXT_INVALID',
    FORBIDDEN: 'FORBIDDEN'
  });
  const STATE_COPY = Object.freeze({
    [STATES.EMPTY_INPUT]: ['请先填写本次成长记录', '选择客户并填写记录内容后即可保存。', 'is-neutral'],
    [STATES.READY_TO_SUBMIT]: ['内容尚未保存', '确认内容和当前客户无误后，再保存这条记录。', 'is-ready'],
    [STATES.SUBMITTING]: ['正在保存，请勿重复操作', '请保持当前页面打开，等待保存结果。', 'is-busy'],
    [STATES.RESULT_UNKNOWN]: ['保存结果待核对，请不要重复提交', '可点击“核对保存结果”确认是否已经保存，不会再次提交。', 'is-unknown'],
    [STATES.SAVED]: ['成长记录已保存', '记录已加入当前客户的历史记录。', 'is-success'],
    [STATES.READ_FAILED]: ['暂时无法读取成长记录，请稍后重试', '你的输入不受影响，可重新读取历史记录。', 'is-error'],
    [STATES.SAVE_FAILED]: ['本次没有保存成功，内容仍为你保留', '请检查当前客户和内容，再点击“保存记录”重试。', 'is-error'],
    [STATES.IDEMPOTENCY_CONFLICT]: ['本次内容与原确认记录不一致，请人工核对', '为避免覆盖已确认记录，当前不会继续提交。', 'is-error'],
    [STATES.PENDING_OTHER_CUSTOMER]: ['另一位客户有一条保存结果待核对', '请先返回原客户完成核对，当前客户暂不能保存新记录。', 'is-unknown'],
    [STATES.CONTEXT_INVALID]: ['当前客户信息不完整，请重新选择客户', '不会自动改用其他客户，请重新确认本次记录对象。', 'is-error'],
    [STATES.FORBIDDEN]: ['你暂时无法查看或修改该客户的成长记录', '请返回客户列表确认服务关系或联系管理员。', 'is-error']
  });

  const urlParams = new URLSearchParams(window.location.search);
  const hasUrlPersonId = urlParams.has('person_id');
  const urlPersonId = String(urlParams.get('person_id') || '').trim();
  const storedCustomerContext = window.V3A_UI?.customerContext.read();
  const people = new Map();
  const seenRecordIds = new Set();
  let csrfToken = '';
  let currentPersonId = '';
  let historyPersonId = '';
  let saveState = STATES.EMPTY_INPUT;
  let offset = 0;
  let loading = false;
  let saveInFlight = null;
  let pendingIntent = null;
  let foreignPendingMetadata = null;
  let lastSavedRecordId = '';

  const $ = (selector) => document.querySelector(selector);

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function isUuid(value) {
    return UUID_PATTERN.test(String(value || '').trim());
  }

  function createUuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function selected(selector, key) {
    return [...document.querySelectorAll(`${selector}.active`)]
      .map((element) => element.dataset[key])
      .filter(Boolean);
  }

  function single(selector, key) {
    return document.querySelector(`${selector}.active`)?.dataset[key] || '';
  }

  function setGrowthOperationState(name, value) {
    document.body.dataset[name] = value;
  }

  function setReadError(message, options = {}) {
    const alert = $('#growthReadError');
    $('#growthReadErrorMessage').textContent = message || '';
    const retry = $('#growthRetryRead');
    retry.hidden = !message || options.retryable !== true;
    retry.disabled = false;
    retry.textContent = '重新读取';
    alert.hidden = !message;
  }

  function setReadLoading(loadingState) {
    setGrowthOperationState('growthReadOperation', loadingState ? 'loading' : 'idle');
    const retry = $('#growthRetryRead');
    if (!retry || retry.hidden) return;
    retry.disabled = loadingState;
    retry.textContent = loadingState ? '正在读取' : '重新读取';
  }

  function setContextHint(message) {
    $('#growthContextHint').textContent = message || '新记录只保存给当前客户；下方可单独筛选历史记录。';
  }

  function currentContent() {
    return $('#recordContent').value.trim();
  }

  function syncSaveButton(button, next) {
    if (!button) return;
    button.textContent = next === STATES.RESULT_UNKNOWN
      ? '核对保存结果'
      : next === STATES.SUBMITTING
        ? '正在保存'
        : next === STATES.PENDING_OTHER_CUSTOMER
          ? '暂不能保存'
          : '保存记录';
    button.disabled = next === STATES.RESULT_UNKNOWN
      ? !isUuid(currentPersonId)
      : next !== STATES.READY_TO_SUBMIT && next !== STATES.SAVE_FAILED;
  }

  function setSaveState(next, detail) {
    saveState = next;
    const [title, defaultDetail, className] = STATE_COPY[next] || STATE_COPY[STATES.EMPTY_INPUT];
    const status = $('#growthSaveStatus');
    status.className = `growth-save-status ${className}`;
    status.dataset.state = next.toLowerCase().replaceAll('_', '-');
    $('#growthSaveStatusTitle').textContent = title;
    $('#growthSaveStatusDetail').textContent = detail || defaultDetail;

    syncSaveButton($('#btnSaveRecord'), next);
    syncSaveButton($('#btnSaveRecordMobile'), next);
    $('#growthMobileSaveLabel').textContent = title;
  }

  function refreshInputState(options = {}) {
    if ([STATES.SUBMITTING, STATES.RESULT_UNKNOWN, STATES.IDEMPOTENCY_CONFLICT, STATES.CONTEXT_INVALID, STATES.FORBIDDEN].includes(saveState)) return;
    if (saveInFlight) {
      syncSaveButton($('#btnSaveRecord'), STATES.SUBMITTING);
      syncSaveButton($('#btnSaveRecordMobile'), STATES.SUBMITTING);
      return;
    }
    if (options.preserveSaved && saveState === STATES.SAVED && !currentContent()) return;
    if (!isUuid(currentPersonId) || !people.has(currentPersonId)) {
      setSaveState(STATES.CONTEXT_INVALID);
      return;
    }
    if (isBlockedByForeignPending()) {
      setSaveState(STATES.PENDING_OTHER_CUSTOMER);
      return;
    }
    if (!currentContent()) {
      setSaveState(STATES.EMPTY_INPUT, csrfToken ? undefined : '页面仍在准备中，请稍候。');
      return;
    }
    setSaveState(STATES.READY_TO_SUBMIT, csrfToken ? undefined : '页面仍在准备中，请稍候。');
    if (!csrfToken) $('#btnSaveRecord').disabled = true;
  }

  async function request(url, options) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', ...options });
    } catch (cause) {
      const error = new Error('网络连接异常，请稍后重试。');
      error.status = 0;
      error.code = 'NETWORK_UNAVAILABLE';
      error.ambiguous = true;
      error.cause = cause;
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      const error = new Error(payload?.error || '操作暂时无法完成。');
      error.status = response.status;
      error.code = String(payload?.code || 'REQUEST_FAILED');
      error.ambiguous = response.status >= 500;
      throw error;
    }
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    return payload;
  }

  function readPendingMetadata() {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null');
      if (!value || value.schemaVersion !== 1 || value.status !== STATES.RESULT_UNKNOWN
          || !isUuid(value.personId) || !isUuid(value.serviceSessionId) || !isUuid(value.idempotencyKey)
          || typeof value.pendingSince !== 'string') return null;
      return {
        personId: value.personId,
        serviceSessionId: value.serviceSessionId,
        idempotencyKey: value.idempotencyKey,
        pendingSince: value.pendingSince,
        status: STATES.RESULT_UNKNOWN,
        schemaVersion: 1
      };
    } catch {
      return null;
    }
  }

  function samePendingIdentity(first, second) {
    return Boolean(first && second)
      && first.personId === second.personId
      && first.serviceSessionId === second.serviceSessionId
      && first.idempotencyKey === second.idempotencyKey;
  }

  function persistUnknown(intent) {
    const existing = readPendingMetadata();
    if (existing && !samePendingIdentity(existing, intent)) return false;
    const pendingMetadata = {
      personId: intent.personId,
      serviceSessionId: intent.serviceSessionId,
      idempotencyKey: intent.idempotencyKey,
      pendingSince: intent.pendingSince || new Date().toISOString(),
      status: STATES.RESULT_UNKNOWN,
      schemaVersion: 1
    };
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(pendingMetadata));
    return true;
  }

  function clearUnknown(intent) {
    const existing = readPendingMetadata();
    if (existing && !samePendingIdentity(existing, intent)) return false;
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return true;
  }

  function isBlockedByForeignPending() {
    return Boolean(foreignPendingMetadata && foreignPendingMetadata.personId !== currentPersonId);
  }

  function showForeignPending(metadata) {
    foreignPendingMetadata = metadata && isUuid(metadata.personId) ? metadata : null;
    const blocked = isBlockedByForeignPending();
    const panel = $('#growthPendingOther');
    const link = $('#growthReturnPendingCustomer');
    const pendingName = blocked ? people.get(foreignPendingMetadata.personId) : '';
    const currentName = blocked ? people.get(currentPersonId) : '';
    const hasSafeNames = Boolean(pendingName && currentName);
    panel.hidden = !blocked;
    link.href = blocked
      ? `/growth-record.html?person_id=${encodeURIComponent(foreignPendingMetadata.personId)}`
      : '/growth-record.html';
    $('#growthPendingCustomerName').textContent = hasSafeNames
      ? `“${pendingName}”有一条保存结果待核对`
      : '另一位客户有一条保存结果待核对';
    $('#growthPendingCustomerDetail').textContent = hasSafeNames
      ? `请先返回“${pendingName}”完成核对，当前客户“${currentName}”暂不能保存新记录。`
      : '请先返回原客户完成核对，当前客户暂不能保存新记录。';
    link.textContent = hasSafeNames ? `返回“${pendingName}”核对` : '返回原客户核对';
  }

  function syncUrl(personId) {
    const params = new URLSearchParams(window.location.search);
    if (personId) params.set('person_id', personId);
    else params.delete('person_id');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  function updateCurrentContext(personId, options = {}) {
    currentPersonId = people.has(personId) ? personId : '';
    const displayName = people.get(currentPersonId) || '尚未选择';
    $('#selectPerson').value = currentPersonId;
    $('#growthWriteTargetName').textContent = displayName;
    if (!historyPersonId || !people.has(historyPersonId)) historyPersonId = currentPersonId;
    $('#filterPerson').value = historyPersonId;
    $('#growthContextName').textContent = displayName;

    const returnLink = $('#growthReturnClient');
    returnLink.hidden = !currentPersonId;
    returnLink.href = currentPersonId
      ? `/client-360.html?person_id=${encodeURIComponent(currentPersonId)}`
      : '/ai-interpreter-customers.html';
    $('#growthChooseClient').hidden = Boolean(currentPersonId);

    if (currentPersonId && options.persist !== false) {
      window.V3A_UI?.customerContext.write({ id: currentPersonId, displayName });
    }
    if (options.syncUrl) syncUrl(currentPersonId);
    if (foreignPendingMetadata) showForeignPending(foreignPendingMetadata);
    setContextHint(currentPersonId
      ? `新记录只保存给“${displayName}”；下方历史筛选不会改变本次保存对象。`
      : '请前往“我的客户”选择本次记录对象，不会自动改用其他客户。');
  }

  function selectHistoryPerson(personId) {
    const next = String(personId || '');
    if (!people.has(next)) {
      $('#filterPerson').value = historyPersonId;
      return;
    }
    historyPersonId = next;
    $('#filterPerson').value = historyPersonId;
    loadRecords(true);
  }

  function populatePeople(list) {
    const targets = [$('#filterPerson')];
    targets.forEach((target) => {
      const first = target.querySelector('option');
      target.replaceChildren(first);
    });
    for (const person of list) {
      if (!isUuid(person?.id) || !String(person?.displayName || '').trim()) continue;
      people.set(person.id, String(person.displayName).trim());
      for (const target of targets) {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = person.displayName;
        target.append(option);
      }
    }

    if (hasUrlPersonId) {
      if (!isUuid(urlPersonId) || !people.has(urlPersonId)) {
        updateCurrentContext('', { persist: false });
        setSaveState(STATES.CONTEXT_INVALID);
        render([], false, '当前客户信息不完整，请重新选择客户。');
        $('#btnLoadMore').hidden = true;
        return false;
      }
      updateCurrentContext(urlPersonId, { persist: true });
      return true;
    }

    const storedId = isUuid(storedCustomerContext?.id) && people.has(storedCustomerContext.id)
      ? storedCustomerContext.id
      : '';
    updateCurrentContext(storedId, { persist: false });
    return true;
  }

  function render(records, append, emptyMessage, personId = historyPersonId || currentPersonId) {
    const target = $('#timelineList');
    if (!append) {
      target.replaceChildren();
      seenRecordIds.clear();
    }
    let added = 0;
    for (const record of records) {
      if (!isUuid(record?.id) || seenRecordIds.has(record.id)) continue;
      if (personId && record.personId !== personId) continue;
      seenRecordIds.add(record.id);
      added += 1;
      const item = node('article', 'timeline-item');
      item.dataset.recordId = record.id;
      const meta = node('div', 'timeline-meta');
      meta.append(
        node('time', '', window.V3A_UI?.formatDate(record.createdAt, { withTime: true }) || '未记录'),
        node('span', 'source', people.get(record.personId) || '当前客户')
      );
      const body = node('div', 'timeline-body');
      const tags = node('div', 'timeline-tags');
      tags.append(node('span', `direction-tag ${record.changeDirection}`, window.V3A_UI?.label(record.changeDirection, '变化记录') || '变化记录'));
      for (const tag of record.domainTags || []) tags.append(node('span', 'pill', window.V3A_UI?.label(tag) || tag));
      body.append(tags, node('p', '', record.content));
      item.append(meta, body);
      target.append(item);
    }
    if (!append && added === 0) target.append(node('div', 'v4-empty-state', emptyMessage || '暂无符合条件的成长记录。'));
    $('#timelineSummary').textContent = seenRecordIds.size ? `已显示 ${seenRecordIds.size} 条` : '按时间倒序';
  }

  async function loadRecords(reset) {
    if (loading) return;
    const personId = historyPersonId || currentPersonId;
    if (!personId) {
      render([], false, '请选择客户后查看成长记录。');
      $('#btnLoadMore').hidden = true;
      return;
    }
    loading = true;
    setReadLoading(true);
    if (reset) offset = 0;
    const target = $('#timelineList');
    target.setAttribute('aria-busy', 'true');
    if (reset) target.replaceChildren(node('div', 'v4-empty-state', '正在读取成长记录…'));
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), person_id: personId });
    const domain = $('#filterDomain').value;
    const direction = $('#filterDirection').value;
    if (domain) params.set('domain_tags', domain);
    if (direction) params.set('change_direction', direction);
    try {
      const payload = await request(`/api/v3a-growth-records?${params}`);
      const records = Array.isArray(payload.records) ? payload.records : [];
      render(records, !reset, undefined, personId);
      offset += records.length;
      $('#btnLoadMore').textContent = '加载更多';
      $('#btnLoadMore').hidden = records.length < PAGE_SIZE;
      setReadError('');
      if (saveState === STATES.READ_FAILED) refreshInputState({ preserveSaved: true });
    } catch (error) {
      const forbidden = error.status === 403;
      if (forbidden) setSaveState(STATES.FORBIDDEN);
      else if (![STATES.RESULT_UNKNOWN, STATES.SAVED].includes(saveState)) setSaveState(STATES.READ_FAILED);
      setReadError(forbidden
        ? '你暂时无法查看或修改该客户的成长记录。'
        : '暂时无法读取成长记录，请稍后重试。', { retryable: !forbidden });
      if (reset) render([], false, '历史记录暂时无法显示。');
      $('#btnLoadMore').textContent = '重新读取';
      $('#btnLoadMore').hidden = false;
    } finally {
      target.setAttribute('aria-busy', 'false');
      loading = false;
      setReadLoading(false);
    }
  }

  function intentSignature(personId, content) {
    return JSON.stringify({
      personId,
      recordType: single('#recordTypePills [data-type]', 'type'),
      domainTags: selected('#domainPills [data-domain]', 'domain'),
      changeDirection: single('#directionPills [data-direction]', 'direction'),
      markers: selected('#markerPills [data-marker]', 'marker'),
      visibility: single('#visibilityPills [data-visibility]', 'visibility'),
      content
    });
  }

  function isConfirmedRecord(record, intent) {
    return isUuid(record?.id)
      && record.personId === intent.personId
      && record.serviceSessionId === intent.serviceSessionId
      && record.idempotencyKey === intent.idempotencyKey;
  }

  async function verifyUnknownResult() {
    const metadata = pendingIntent || readPendingMetadata();
    if (!metadata || metadata.personId !== currentPersonId) {
      setSaveState(STATES.RESULT_UNKNOWN, '当前标签页没有可安全核对的确认信息，请人工核对。');
      return false;
    }
    setGrowthOperationState('growthSaveOperation', 'verifying');
    setSaveState(STATES.RESULT_UNKNOWN, '正在核对是否已经保存，不会再次提交。');
    $('#btnSaveRecord').disabled = true;
    const params = new URLSearchParams({ limit: '1' });
    params.set('person_id', metadata.personId);
    params.set('service_session_id', metadata.serviceSessionId);
    params.set('idempotency_key', metadata.idempotencyKey);
    try {
      const payload = await request(`/api/v3a-growth-records?${params}`);
      const record = (payload.records || []).find((candidate) => isConfirmedRecord(candidate, metadata));
      if (!record) {
        setSaveState(STATES.RESULT_UNKNOWN, '暂未查到可确认的记录，请保持当前页面并人工核对。');
        return false;
      }
      lastSavedRecordId = record.id;
      clearUnknown(metadata);
      pendingIntent = null;
      showForeignPending(null);
      setSaveState(STATES.SAVED);
      await loadRecords(true);
      return true;
    } catch (error) {
      if (error.status === 403) setSaveState(STATES.FORBIDDEN);
      else setSaveState(STATES.RESULT_UNKNOWN, '暂时无法核对保存结果，请不要重复提交。');
      return false;
    } finally {
      setGrowthOperationState('growthSaveOperation', 'idle');
    }
  }

  async function save() {
    if (isBlockedByForeignPending()) {
      setSaveState(STATES.PENDING_OTHER_CUSTOMER);
      $('#growthReturnPendingCustomer').focus();
      return false;
    }
    if (saveState === STATES.RESULT_UNKNOWN) return verifyUnknownResult();
    if (saveInFlight) return saveInFlight;

    const personId = $('#selectPerson').value;
    const content = currentContent();
    if (!isUuid(personId) || personId !== currentPersonId || !people.has(personId)) {
      setSaveState(STATES.CONTEXT_INVALID);
      return false;
    }
    if (!content || !csrfToken) {
      refreshInputState();
      return false;
    }

    const signature = intentSignature(personId, content);
    if (pendingIntent && pendingIntent.signature && pendingIntent.signature !== signature) {
      setSaveState(STATES.IDEMPOTENCY_CONFLICT);
      return false;
    }
    if (!pendingIntent) {
      pendingIntent = {
        personId,
        content,
        signature,
        idempotencyKey: createUuid(),
        serviceSessionId: createUuid(),
        pendingSince: new Date().toISOString()
      };
    }

    setSaveState(STATES.SUBMITTING);
    setGrowthOperationState('growthSaveOperation', 'saving');
    saveInFlight = (async () => {
      try {
        const payload = await request('/api/v3a-growth-records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({
            person_id: personId,
            record_type: single('#recordTypePills [data-type]', 'type'),
            domain_tags: selected('#domainPills [data-domain]', 'domain'),
            change_direction: single('#directionPills [data-direction]', 'direction'),
            related_fingerprint_markers: selected('#markerPills [data-marker]', 'marker'),
            visibility: single('#visibilityPills [data-visibility]', 'visibility'),
            content,
            source: 'advisor_workbench',
            idempotency_key: pendingIntent.idempotencyKey,
            service_session_id: pendingIntent.serviceSessionId
          })
        });
        if (!['created', 'idempotent_reuse'].includes(payload.status) || !isConfirmedRecord(payload.record, pendingIntent)) {
          throw Object.assign(new Error('保存结果待核对。'), { status: 502, code: 'RESULT_UNCONFIRMED', ambiguous: true });
        }
        const completedIntent = pendingIntent;
        lastSavedRecordId = payload.record.id;
        pendingIntent = null;
        clearUnknown(completedIntent);
        showForeignPending(null);
        $('#recordContent').value = '';
        $('#charCount').textContent = '0/2000';
        setSaveState(STATES.SAVED);
        await loadRecords(true);
        if (!seenRecordIds.has(lastSavedRecordId)) render([payload.record], true);
        return true;
      } catch (error) {
        if (error.status === 403) {
          setSaveState(STATES.FORBIDDEN);
        } else if (error.status === 409 || error.code === 'GROWTH_IDEMPOTENCY_CONFLICT') {
          setSaveState(STATES.IDEMPOTENCY_CONFLICT);
        } else if (error.ambiguous || !error.status || error.status >= 500) {
          if (persistUnknown(pendingIntent)) {
            setSaveState(STATES.RESULT_UNKNOWN);
          } else {
            showForeignPending(readPendingMetadata());
            setSaveState(STATES.PENDING_OTHER_CUSTOMER);
          }
        } else {
          setSaveState(STATES.SAVE_FAILED);
        }
        return false;
      } finally {
        saveInFlight = null;
        setGrowthOperationState('growthSaveOperation', 'idle');
        if (saveState === STATES.SAVED && currentContent()) refreshInputState();
      }
    })();
    return saveInFlight;
  }

  function bindPills(container, multiple) {
    $(container)?.addEventListener('click', (event) => {
      const button = event.target.closest('.pill');
      if (!button || [STATES.SUBMITTING, STATES.RESULT_UNKNOWN, STATES.IDEMPOTENCY_CONFLICT].includes(saveState)) return;
      if (!multiple) {
        document.querySelectorAll(`${container} .pill`).forEach((item) => {
          item.classList.remove('active');
          item.setAttribute('aria-pressed', 'false');
        });
      }
      const active = multiple ? !button.classList.contains('active') : true;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      if (saveState === STATES.SAVE_FAILED) pendingIntent = null;
      refreshInputState();
    });
  }

  async function init() {
    setGrowthOperationState('growthInitState', 'loading');
    try {
      const payload = await request('/api/v3a-client-data-center/person-list');
      const contextReady = populatePeople(payload.people || []);
      if (!contextReady) return;

      const restored = readPendingMetadata();
      if (restored && restored.personId === currentPersonId) {
        showForeignPending(null);
        pendingIntent = restored;
        setSaveState(STATES.RESULT_UNKNOWN);
        await verifyUnknownResult();
      } else if (restored) {
        showForeignPending(restored);
        setSaveState(STATES.PENDING_OTHER_CUSTOMER);
        await loadRecords(true);
      } else {
        showForeignPending(null);
        refreshInputState();
        await loadRecords(true);
      }
    } catch (error) {
      if (error.status === 403) {
        setSaveState(STATES.FORBIDDEN);
        setReadError('你暂时无法查看或修改该客户的成长记录。');
        render([], false, '历史记录暂时无法显示。');
      } else if (error.status === 502 || error.status === 503 || error.code === 'DATA_UPSTREAM_ERROR' || error.code === 'DATA_UPSTREAM_UNAVAILABLE' || error.code === 'RPC_UPSTREAM_ERROR') {
        setSaveState(STATES.READ_FAILED);
        setReadError('成长记录后端未就绪，历史列表暂时不能加载。', { retryable: true });
        render([], false, '后端未就绪，这里不是空的成功记录。');
      } else {
        setSaveState(STATES.READ_FAILED);
        setReadError('暂时无法读取成长记录，请稍后重试。', { retryable: true });
        render([], false, '历史记录暂时无法显示。');
      }
      $('#btnLoadMore').textContent = '重新读取';
      $('#btnLoadMore').hidden = false;
    } finally {
      setGrowthOperationState('growthInitState', 'ready');
    }
  }

  bindPills('#recordTypePills', false);
  bindPills('#domainPills', true);
  bindPills('#directionPills', false);
  bindPills('#markerPills', true);
  bindPills('#visibilityPills', false);

  $('#recordContent')?.addEventListener('input', (event) => {
    $('#charCount').textContent = `${event.target.value.length}/2000`;
    if (saveState === STATES.SAVE_FAILED && pendingIntent && event.target.value.trim() !== pendingIntent.content) pendingIntent = null;
    refreshInputState();
  });
  $('#filterPerson')?.addEventListener('change', (event) => selectHistoryPerson(event.target.value));
  ['#filterDomain', '#filterDirection', '#filterRecorder'].forEach((selector) => $(selector)?.addEventListener('change', () => loadRecords(true)));
  $('#btnLoadMore')?.addEventListener('click', () => loadRecords($('#btnLoadMore').textContent === '重新读取'));
  $('#growthRetryRead')?.addEventListener('click', async () => {
    setReadLoading(true);
    try {
      if (people.size === 0) await init();
      else await loadRecords(true);
    } finally {
      setReadLoading(false);
    }
  });
  $('#btnSaveRecord')?.addEventListener('click', save);
  $('#btnSaveRecordMobile')?.addEventListener('click', save);
  setGrowthOperationState('growthSaveOperation', 'idle');
  setGrowthOperationState('growthReadOperation', 'idle');
  setGrowthOperationState('growthInitState', 'waiting');
  if (!document.body.hidden && !document.querySelector('.app-shell')?.hidden) init();
  else document.addEventListener('v3a:workbench-ready', init, { once: true });
})();
