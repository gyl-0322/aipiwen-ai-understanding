/**
 * AIPIWEN 前端错误追踪器
 * ─────────────────────────────────────────────────
 * 在所有页面 <head> 末尾引入（尽量早加载，捕获更多错误）：
 *   <script src="/js/error-tracker.js"></script>
 *
 * 捕获三类错误，静默上报到 /api/error-log，不影响用户操作：
 *   1. 全局 JS 运行时错误（window.onerror）
 *   2. 未处理的 Promise rejection
 *   3. 调用 /api/* 时收到 4xx / 5xx 的网络响应
 *
 * 设计原则：
 *   - 上报本身绝对不能抛错，所有分支都有 try/catch
 *   - 优先用 navigator.sendBeacon（页面关闭时也能发出）
 *   - 同一错误 5 分钟内在前端也做简单去重（服务端再做一次）
 */
(function () {
  'use strict';

  var ENDPOINT  = '/api/error-log';
  var _dedup    = {};        // { hash: timestamp }，前端内存去重
  var DEDUP_MS  = 5 * 60 * 1000;  // 5 分钟

  /** 简单哈希（msg + page），用于前端去重 */
  function quickHash(msg, page) {
    var s = (msg || '') + (page || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }

  /** 静默上报，两种方式都不影响主流程 */
  function send(data) {
    try {
      var body = JSON.stringify(data);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method:    'POST',
          headers:   { 'Content-Type': 'application/json' },
          body:      body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (_) {}
  }

  /** 主上报函数，带前端去重 */
  function report(msg, stack, context) {
    try {
      if (!msg) return;
      var page = typeof location !== 'undefined' ? location.pathname : '';
      var hash = quickHash(String(msg), page);
      var now  = Date.now();

      // 5 分钟内同样的错误不重复上报
      if (_dedup[hash] && now - _dedup[hash] < DEDUP_MS) return;
      _dedup[hash] = now;

      send({
        msg:     String(msg).slice(0, 500),
        stack:   stack   ? String(stack).slice(0, 800)   : undefined,
        page:    page,
        context: context ? String(context).slice(0, 300) : undefined,
        ua:      typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });
    } catch (_) {}
  }

  // ── 1. 全局 JS 运行时错误 ────────────────────────────────────────────────
  window.addEventListener('error', function (e) {
    try {
      if (!e || !e.message) return;
      // 过滤掉第三方脚本的跨域错误（message 只有 "Script error."，没有堆栈）
      if (e.message === 'Script error.' && !e.filename) return;
      report(
        e.message,
        e.error && e.error.stack,
        e.filename ? (e.filename + ':' + e.lineno) : undefined
      );
    } catch (_) {}
  });

  // ── 2. 未处理的 Promise rejection ────────────────────────────────────────
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var reason = e && e.reason;
      var msg    = reason
        ? (reason.message || String(reason))
        : 'Unhandled Promise rejection';
      report(msg, reason && reason.stack);
    } catch (_) {}
  });

  // ── 3. 拦截 fetch，捕获 /api/* 的 4xx/5xx ────────────────────────────────
  // 只拦截对自己 API 的调用，不影响第三方请求
  var origFetch = window.fetch;
  window.fetch  = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input
          : (input && typeof input.url === 'string' ? input.url : '');
    } catch (_) {}

    var isOwnApi = url && (url.indexOf('/api/') !== -1 || url.indexOf(location.origin + '/api/') !== -1);

    return origFetch.apply(this, arguments).then(function (res) {
      try {
        if (isOwnApi && !res.ok) {
          // 克隆响应体（原始 res 留给调用方消费）
          res.clone().text().then(function (body) {
            report(
              'API ' + res.status + ': ' + url.replace(/\?.*$/, ''),
              undefined,
              body.slice(0, 300)
            );
          }).catch(function () {});
        }
      } catch (_) {}
      return res;
    }).catch(function (err) {
      try {
        if (isOwnApi) {
          report(
            'fetch 失败: ' + url.replace(/\?.*$/, ''),
            err && err.stack,
            err && err.message
          );
        }
      } catch (_) {}
      throw err;   // 重新抛出，不影响调用方的 catch
    });
  };

})();
