(function () {
  'use strict';

  if (document.body?.dataset?.page !== 'workbench') return;
  let loaded = false;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function render(clues) {
    const target = document.querySelector('#clueList');
    if (!target) return;
    if (!clues.length) {
      target.replaceChildren(node('div', 'v4-empty-state', '今日暂无需要关注的客户。'));
      return;
    }
    target.replaceChildren(...clues.map((clue) => {
      const card = node('button', 'clue-card');
      card.type = 'button';
      const header = node('div', 'clue-card-header');
      header.append(node('strong', '', clue.person_name || '客户'));
      const stage = node('span', `stage-tag ${clue.stage || 'initial'}`, ({
        initial: '初始解读期', early: '早期跟进', deep: '深度辅导', consolidation: '巩固期'
      })[clue.stage] || '初始解读期');
      header.append(stage);
      card.append(header, node('p', '', clue.description || '有一条新的客户服务线索。'));
      card.append(node('span', 'clue-action', `${clue.suggested_action || '查看'} →`));
      card.addEventListener('click', () => {
        const url = String(clue.action_url || '');
        if (/^\/(?:ai-coaching-assistant|client-360)\.html\?person_id=[0-9a-f-]+$/i.test(url)) {
          window.location.assign(url);
        }
      });
      return card;
    }));
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    const error = document.querySelector('#clueError');
    try {
      const response = await fetch('/api/v3a-client-data-center/clues', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || '辅导线索暂时无法读取。');
      render(Array.isArray(payload.clues) ? payload.clues : []);
    } catch (caught) {
      render([]);
      if (error) {
        error.textContent = caught.message;
        error.hidden = false;
      }
    }
  }

  document.addEventListener('v3a:workbench-ready', load, { once: true });
})();
