(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'workbench') return;
  let loaded = false;
  let allClues = [];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function shanghaiDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function clueDay(clue) {
    return shanghaiDay(clue.reported_at || clue.report_created_at || clue.created_at || clue.updated_at || '');
  }

  function renameHeading() {
    const title = document.querySelector('#v4-clue-title');
    if (title) title.textContent = '待跟进';
    const note = title?.parentElement?.querySelector('small');
    if (note) note.textContent = '尚未完成首次跟进或需要关注的客户，不限于今天';
  }

  function personIdFrom(clue) {
    const direct = String(clue.person_id || '');
    if (uuidPattern.test(direct)) return direct;
    const url = String(clue.action_url || '');
    if (!/^\/(?:ai-coaching-assistant|client-360)\.html\?person_id=[0-9a-f-]+$/i.test(url)) return '';
    const personId = new URL(url, window.location.origin).searchParams.get('person_id') || '';
    return uuidPattern.test(personId) ? personId : '';
  }

  function goTo(url, clue, personId) {
    if (!uuidPattern.test(String(personId || '')) || !/^\/(?:ai-coaching-assistant|client-360|growth-record)\.html\?person_id=[0-9a-f-]+$/i.test(url)) return;
    window.V3A_UI?.customerContext.write({ id: personId, displayName: clue.person_name || '当前客户' });
    window.location.assign(url);
  }

  function renderState(message) {
    const target = document.querySelector('#clueList');
    if (!target) return;
    target.replaceChildren(node('div', 'v4-empty-state', message));
  }

  function render(clues, notice) {
    const target = document.querySelector('#clueList');
    if (!target) return;
    if (!clues.length) {
      renderState(notice || '当前筛选下没有待跟进客户。');
      return;
    }
    const cards = clues.map((clue) => {
      const personId = personIdFrom(clue);
      const card = node('article', 'clue-card');
      const header = node('div', 'clue-card-header');
      header.append(node('strong', '', clue.person_name || '客户'));
      const stage = node('span', 'stage-tag', ({
        initial: '初始解读期', early: '早期跟进', deep: '深度辅导', consolidation: '巩固期'
      })[clue.stage] || '待跟进');
      header.append(stage);
      card.append(header, node('p', '', clue.description || '有一条待跟进线索。'));
      const day = clueDay(clue);
      if (day) card.append(node('p', 'footer-note', `线索日期 ${day}`));
      if (!personId) {
        card.append(node('p', 'footer-note', '该线索暂时无法打开，请稍后重试。'));
        return card;
      }
      const actions = node('div', 'clue-actions');
      const view = node('button', 'btn ghost', '查看客户全景');
      view.type = 'button';
      view.addEventListener('click', () => goTo(`/client-360.html?person_id=${personId}`, clue, personId));
      const coaching = node('button', 'btn ghost', '打开 AI 辅导助手');
      coaching.type = 'button';
      coaching.addEventListener('click', () => goTo(`/ai-coaching-assistant.html?person_id=${personId}`, clue, personId));
      actions.append(view, coaching);
      card.append(actions);
      return card;
    });
    target.replaceChildren(...cards);
    if (notice) target.prepend(node('p', 'footer-note', notice));
  }

  function applyFilter() {
    const mode = document.querySelector('#clueDateFilter')?.value || 'all';
    if (mode !== 'today') {
      render(allClues);
      return;
    }
    const today = shanghaiDay(new Date());
    const dated = allClues.filter((clue) => clueDay(clue));
    if (!dated.length) {
      render([], '这些线索没有带日期，不能按“今天”筛选。请改回“全部待跟进”。');
      return;
    }
    render(allClues.filter((clue) => clueDay(clue) === today), '只显示日期落在上海时区今天的线索。');
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    renameHeading();
    const error = document.querySelector('#clueError');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    renderState('正在读取待跟进线索…');
    try {
      const response = await fetch('/api/v3a-client-data-center/clues', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (response.status === 502 || response.status === 503) {
        throw Object.assign(new Error('backend'), { status: response.status });
      }
      if (!response.ok || payload?.ok !== true) throw new Error('clues');
      allClues = Array.isArray(payload.clues) ? payload.clues : [];
      applyFilter();
    } catch (cause) {
      const backend = cause?.status === 502 || cause?.status === 503;
      const message = backend
        ? '待跟进后端未就绪，列表暂时不能加载。'
        : '待跟进线索暂时无法显示，请稍后重试。';
      renderState(message);
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    }
  }

  document.querySelector('#clueDateFilter')?.addEventListener('change', applyFilter);
  document.addEventListener('v3a:workbench-ready', load, { once: true });
}());
