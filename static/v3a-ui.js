(function () {
  'use strict';

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CUSTOMER_CONTEXT_KEY = 'aipiwen_advisor_customer_context_v1';
  const UI_LABEL_MAP = Object.freeze({
    advisor: '指导师',
    agent: '分公司',
    center: '服务中心',
    super_admin: '总部管理员',
    pending: '审核中',
    active: '已激活',
    rejected: '未通过',
    disabled: '已停用',
    frozen: '已冻结',
    ready: '报告已就绪',
    generating: '生成中',
    failed: '生成失败',
    reviewed: '已复核',
    draft: '草稿',
    completed: '已完成',
    archived: '已归档',
    unassigned: '待分配指导师',
    initial: '初始解读期',
    early: '早期跟进',
    deep: '深度辅导',
    consolidation: '巩固期',
    advisor_qr: '客户扫码上传',
    advisor_import: '指导师代上传',
    unguided: '总部转入',
    invite_link: '历史邀请链接',
    legacy_backfill: '历史报告补录',
    manual_entry: '人工录入',
    report_upload: '报告上传',
    preview_fixture: '预览演练数据',
    improving: '正在改善',
    stable: '保持稳定',
    declining: '需要关注',
    new_emergence: '新出现',
    resolved: '已解决',
    learning: '学习',
    behavior: '行为',
    emotion: '情绪',
    social: '社交',
    parent_child: '亲子关系',
    family_system: '家庭环境',
    physical: '身体状态',
    phone_follow_up: '电话回访',
    deep_coaching: '深度辅导',
    initial_interpretation: '首次解读',
    emergency: '紧急沟通',
    daily_follow_up: '日常跟进',
    pre_call: '沟通前准备',
    post_call: '沟通后复盘',
    free: '自由辅导',
    advisor_obs: '指导师观察',
    parent_feedback: '家长反馈',
    child_self_report: '孩子自述',
    key_event: '关键事件',
    service_decision: '服务决策',
    advisor_only: '仅指导师可见',
    parent_visible: '家长可见',
    shared: '指导师和家长可见',
    FIRST_INTERPRETATION: '首次解读',
    ACTIVE_SERVICE: '持续服务中',
    GROWTH_OBSERVATION: '成长观察',
    LONG_TERM: '长期陪伴',
    DORMANT: '暂停服务',
    RE_ENGAGEMENT: '重新跟进',
    REGISTER_BONUS: '注册体验积分',
    MANUAL_GRANT: '平台人工加分',
    MANUAL_DEDUCT: '平台人工扣分',
    totalTrc: 'TRC 总值',
    trc: 'TRC 总值',
    atd: 'ATD 值',
    personality: '性格类型',
    channel: '学习通道',
    brain: '思维倾向',
    '主性格类型': '性格类型',
    '性格类型': '性格类型',
    '学习通道': '学习通道',
    '先天学习风格': '学习方式',
    '主学习通道': '主要学习通道',
    '左右脑': '思维倾向',
    '左右脑倾向': '思维倾向',
    '脑功能优势': '思维优势',
    '五功能区': '五项能力概览',
    ATD: 'ATD 值',
    TRC: 'TRC 总值'
  });

  function label(value, fallback) {
    const key = String(value ?? '').trim();
    return UI_LABEL_MAP[key] || fallback || key || '未记录';
  }

  function formatDate(value, options = {}) {
    if (!value) return options.fallback || '未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return options.fallback || '未记录';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      ...(options.withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {})
    }).format(date);
  }

  function friendlyError(error, fallback = '操作暂时无法完成，请稍后重试。') {
    const status = Number(error?.status || 0);
    const message = String(error?.message || error || '').trim();
    if (status === 401 || /\bunauthorized\b/i.test(message)) return '登录状态已失效，请重新登录。';
    if (status === 403 || /\bforbidden\b/i.test(message)) return '当前账号无权查看该客户。';
    if (status === 404 || /\bnot[ -]?found\b/i.test(message)) return '未找到相关客户或记录。';
    if (/network|failed to fetch|load failed/i.test(message)) return '网络连接异常，请稍后重试。';
    if (/\b(?:HTTP|RPC|PostgREST|schema|payload|runtime)\b/i.test(message)) return fallback;
    if (/[\u3400-\u9fff]/.test(message) && message.length <= 120) return message;
    return fallback;
  }

  function readCustomerContext() {
    try {
      const context = JSON.parse(window.localStorage.getItem(CUSTOMER_CONTEXT_KEY) || 'null');
      return context && UUID_PATTERN.test(context.id) ? context : null;
    } catch {
      return null;
    }
  }

  function writeCustomerContext(next) {
    if (!next || !UUID_PATTERN.test(String(next.id || ''))) return null;
    const previous = readCustomerContext();
    const sameCustomer = previous?.id === String(next.id);
    const report = Object.prototype.hasOwnProperty.call(next, 'reportId')
      ? next.reportId : sameCustomer ? previous.reportId : '';
    const reportId = UUID_PATTERN.test(String(report || '')) ? String(report) : '';
    const reportType = Object.prototype.hasOwnProperty.call(next, 'reportType')
      ? next.reportType : sameCustomer && reportId && reportId === previous.reportId ? previous.reportType : '';
    const context = {
      id: String(next.id),
      displayName: String(next.displayName || '当前客户').slice(0, 80),
      reportId,
      reportType: String(reportType || '').slice(0, 80),
      updatedAt: new Date().toISOString()
    };
    try { window.localStorage.setItem(CUSTOMER_CONTEXT_KEY, JSON.stringify(context)); } catch {}
    document.dispatchEvent(new CustomEvent('v3a:customer-context', { detail: context }));
    return context;
  }

  function clearCustomerContext() {
    try { window.localStorage.removeItem(CUSTOMER_CONTEXT_KEY); } catch {}
  }

  function navLink(item, currentGroup) {
    const link = document.createElement('a');
    link.className = `nav-link${item.group === currentGroup ? ' active' : ''}`;
    link.dataset.page = item.group;
    link.href = item.href;
    link.textContent = item.label;
    if (item.group === currentGroup) link.setAttribute('aria-current', 'page');
    return link;
  }

  function currentNavGroup(page) {
    if (['client-360', 'fiac-review', 'session'].includes(page)) return 'customers';
    if (['coaching', 'growth-record'].includes(page)) return 'follow-up';
    if (['training', 'cases'].includes(page)) return 'learning';
    return page || 'workbench';
  }

  function applyNavigation(role) {
    const nav = document.querySelector('.sidebar .nav');
    if (!nav) return;
    const page = document.body?.dataset?.page || '';
    if (role !== 'super_admin') {
      nav.querySelectorAll('[data-page="review"]').forEach((link) => link.remove());
    }
    const fingerprint = nav.querySelector('[data-page="fingerprint"]');
    if (fingerprint) {
      const customer = readCustomerContext();
      if (customer?.id) {
        const params = new URLSearchParams({
          context_type: 'legacy_advisor_client',
          advisor_client_id: customer.id,
          return_url: `/client-360.html?person_id=${encodeURIComponent(customer.id)}`
        });
        fingerprint.href = `fiac-review.html?${params.toString()}`;
      } else {
        fingerprint.href = 'fiac-review.html';
        fingerprint.title = '指纹复核。请先从我的客户进入具体客户。';
      }
      fingerprint.removeAttribute('target');
    }
    const activePage = currentNavGroup(page);
    nav.querySelectorAll('.nav-link').forEach((link) => {
      const active = link.dataset.page === activePage;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  window.V3A_UI = Object.freeze({
    UI_LABEL_MAP,
    label,
    formatDate,
    friendlyError,
    applyNavigation,
    customerContext: Object.freeze({
      read: readCustomerContext,
      write: writeCustomerContext,
      clear: clearCustomerContext
    })
  });
}());
