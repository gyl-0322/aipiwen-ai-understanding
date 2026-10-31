/* AIPIWEN local extension: persistent report entry + private, rule-based website help.
   No API calls, personal report reads, storage, tracking, or generated customer-service claims. */
(() => {
  if (document.getElementById('aipiwen-help')) return;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/css/consumer-help.css';
  document.head.append(style);
  const supportUrl = 'https://work.weixin.qq.com/kfid/kfc6ce446e6e057c683';
  const topics = [
    { label: '怎么登录', match: /登录|登陆|验证码|账号|账户|手机号/, answer: '从“我的 AIPIWEN”进入，按页面提示完成登录。如果验证码没有收到，请核对手机号、网络和短信拦截情况。不要把验证码或密码发给客服。', href: '/consumer-auth?return_to=%2Fcp', link: '进入我的 AIPIWEN' },
    { label: '在哪里看报告', match: /报告|解读|深聊/, answer: '在“我的报告”中选择要查看的报告。阅读正式报告时，点击“报告深聊”可围绕当前这一版继续提问。还没有可查看的报告时，页面会如实提示。', href: '/cp/reports', link: '打开我的报告' },
    { label: '已有报告怎么上传', match: /上传|文件/, answer: '已有报告可以直接进入上传页，不必先做其他测评。请按上传页的要求选择文件；若上传失败，可先检查网络和页面提示，不要在客服对话里发送完整报告或指纹图片。', href: '/report-upload.html', link: '进入报告上传页' },
    { label: '怎么进入课程', match: /课程|学习|播放|视频/, answer: '在“我的 AIPIWEN”里打开“我的课程”。学习课程不需要先上传指纹或报告。若页面未显示课程，请先确认正在使用购买时对应的账号；自助机器人不能核实实际购买权益。', href: '/cp/courses', link: '打开我的课程' },
    { label: '页面打不开怎么办', match: /打不开|空白|卡住|加载|网络|故障|失败|报错/, answer: '可以先检查网络，再重新打开当前页面；如果有未提交的文字，请先自行保存，避免刷新后丢失。仍无法恢复时，记下页面名称和提示文字，勿提供密码、验证码或个人报告。', href: '/', link: '返回官网首页' },
    { label: '我的资料会被读取吗', match: /隐私|资料|数据|保密|保存|记录/, answer: '这个自助机器人只在当前浏览器处理你的问题，不上传或保存输入，也不读取你的报告或账号资料。报告深聊是另一个入口，具体使用范围以进入后的页面说明为准。', href: '/privacy.html', link: '查看隐私政策' }
  ];
  function answerFor(text) {
    if (/订单|付款|支付|退款|退费|投诉|人工/.test(text)) return {
      answer: '机器人先受理常见问题。订单、退款、投诉或需要人工帮助，请点击“联系企业微信客服”，人工将在 15 个工作日内答复。请勿在这里填写密码、验证码或个人报告。',
      href: supportUrl, link: '联系企业微信客服'
    };
    if (/上传|文件/.test(text)) return topics[2];
    return topics.find(topic => topic.match.test(text)) || {
      answer: '这个问题超出了我的网站使用指引范围，我暂时不能可靠回答。你可以选择下方的常见问题；如果想理解自己的报告，请使用“报告深聊”。请勿在这里填写个人报告、密码或验证码。'
    };
  }
  function reportTarget() {
    const id = location.pathname.match(/^\/cp\/reports\/([0-9a-f-]{36})\/?$/i)?.[1];
    const anchor = document.querySelector('.formal-reader-footer a.primary-link');
    if (!id || !anchor) return null;
    let url;
    try { url = new URL(anchor.getAttribute('href') || '', location.origin); } catch { return null; }
    const params = url.searchParams;
    if (url.origin !== location.origin || url.pathname !== '/cp/ai' || url.hash ||
        [...params.keys()].length !== 2 || params.getAll('report_ref').length !== 1 ||
        params.getAll('version').length !== 1 || params.get('report_ref')?.toLowerCase() !== id.toLowerCase() ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
        !/^[1-9][0-9]{0,8}$/.test(params.get('version') || '')) return null;
    return url.pathname + url.search;
  }
  const root = document.createElement('aside');
  root.id = 'aipiwen-help';
  root.className = 'aipiwen-help';
  root.setAttribute('aria-label', '随时获得帮助');
  root.innerHTML = `
    <section class="aw-help-panel" id="aw-help-panel" aria-labelledby="aw-help-title" hidden>
      <header><h2 id="aw-help-title" tabindex="-1"></h2><button type="button" class="aw-help-close" aria-label="关闭帮助面板"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
      <div class="aw-help-report" hidden>
        <p>先选择你想继续聊的报告。进入深聊时，会使用你明确选择的那一版。</p>
        <a href="/cp/reports" class="aw-help-link">选择我的报告 <span aria-hidden="true">→</span></a>
        <p class="aw-help-note">已有报告文件？<a href="/report-upload.html">直接上传解读</a></p>
      </div>
      <div class="aw-help-support" hidden>
        <p class="aw-help-intro">我是自助客服机器人，先受理常见问题。需要人工时，请点“联系企业微信客服”，人工将在 15 个工作日内答复。</p>
        <a class="aw-help-link aw-help-contact" href="${supportUrl}" rel="noopener noreferrer">联系企业微信客服</a>
        <div class="aw-help-topics" aria-label="常见问题"></div>
        <div class="aw-help-answer" role="status" aria-live="polite" aria-atomic="true"></div>
        <form><label for="aw-help-input">你遇到了什么问题？</label>
          <div class="aw-help-compose"><input id="aw-help-input" type="text" maxlength="200" autocomplete="off" placeholder="例如：在哪里查看报告" required><button type="submit">发送</button></div>
          <p class="aw-help-note">仅提供常见问题指引；请勿填写密码、验证码或个人报告。</p>
        </form>
      </div>
    </section>
    <div class="aw-help-dock">
      <button type="button" class="aw-help-report-trigger" aria-controls="aw-help-panel" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H5l-4 3 2-6a8 8 0 1 1 17-5Z"/><path d="M7 9h8M7 13h5"/></svg><span>报告深聊</span></button>
      <button type="button" class="aw-help-support-trigger" aria-controls="aw-help-panel" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13V10a8 8 0 0 1 16 0v3M4 11H2v7h4v-7ZM20 11h2v7h-4v-7ZM20 18c0 3-3 4-6 4h-2"/></svg><span>客服<small>自助机器人</small></span></button>
    </div>`;
  document.body.append(root);
  document.body.classList.add('aipiwen-help-present');
  const panel = root.querySelector('.aw-help-panel');
  const title = root.querySelector('h2');
  const reportButton = root.querySelector('.aw-help-report-trigger');
  const supportButton = root.querySelector('.aw-help-support-trigger');
  const input = root.querySelector('input');
  let active = null;
  function close() {
    if (!active) return;
    const trigger = active === 'support' ? supportButton : reportButton;
    panel.hidden = true;
    root.classList.remove('is-open');
    active = null;
    reportButton.setAttribute('aria-expanded', 'false');
    supportButton.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }
  function open(kind) {
    if (active === kind) return close();
    active = kind;
    panel.hidden = false;
    root.classList.add('is-open');
    root.querySelector('.aw-help-report').hidden = kind !== 'report';
    root.querySelector('.aw-help-support').hidden = kind !== 'support';
    title.textContent = kind === 'support' ? '自助客服机器人' : '围绕报告继续深聊';
    reportButton.setAttribute('aria-expanded', String(kind === 'report'));
    supportButton.setAttribute('aria-expanded', String(kind === 'support'));
    title.focus({ preventScroll: true });
  }
  function reply(topic) {
    const answer = root.querySelector('.aw-help-answer');
    const text = document.createElement('p');
    text.textContent = topic.answer;
    answer.replaceChildren(text);
    if (topic.href) {
      const link = document.createElement('a');
      link.href = topic.href;
      link.textContent = topic.link;
      if (topic.href === supportUrl) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', topic.link + '（新窗口）');
      }
      answer.append(link);
    }
    answer.scrollIntoView({ block: 'nearest' });
  }
  for (const topic of topics) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = topic.label;
    button.addEventListener('click', () => reply(topic));
    root.querySelector('.aw-help-topics').append(button);
  }
  reportButton.addEventListener('click', () => {
    const composer = location.pathname.replace(/\/$/, '') === '/cp/ai' ? document.getElementById('ai-message') : null;
    if (composer) { if (active) close(); composer.focus(); composer.scrollIntoView({block:'center'}); return; }
    const target = reportTarget();
    if (target) { location.assign(target); return; }
    open('report');
  });
  supportButton.addEventListener('click', () => open('support'));
  root.querySelector('.aw-help-close').addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); close(); } });
  root.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    reply(answerFor(text));
    input.value = '';
    input.focus({preventScroll:true});
  });
})();
