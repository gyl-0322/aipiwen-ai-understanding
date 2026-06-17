/**
 * AIPIWEN 前端埋点工具
 * 引用方式：<script src="/js/track.js"></script>
 * 使用方式：aipiwen.track('page_view', { page: 'homepage' })
 */
(function() {
  window.aipiwen = window.aipiwen || {};

  window.aipiwen.track = function(event, meta) {
    // 静默发送，不阻塞主流程
    fetch('/api/stats', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event, meta }),
      keepalive: true,
    }).catch(function() {});
  };

  // 自动记录页面名（从 data-page 属性读取）
  document.addEventListener('DOMContentLoaded', function() {
    const page = document.body.dataset.page;
    if (page) window.aipiwen.track('page_view:' + page);
  });
})();
