/**
 * AIPIWEN Growth Tracker v1
 * Client-side funnel tracking + type performance + UTM attribution
 * Storage: localStorage key 'aipiwen_growth_v1'
 * Server:  navigator.sendBeacon → /api/track (best-effort)
 */
(function (root) {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────
  var STORE_KEY   = 'aipiwen_growth_v1';
  var TRACK_URL   = '/api/track';

  // 8-step funnel (order matters)
  var FUNNEL_STEPS = [
    'page_open',       // 1 - landed on wizard
    'step1_complete',  // 2 - entered child info
    'step2_complete',  // 3 - selected behaviour
    'result_view',     // 4 - saw result page
    'poster_open',     // 5 - opened share poster
    'poster_share',    // 6 - tapped share / download
    'wecom_click',     // 7 - tapped WeCom / consult button
    'lead_captured'    // 8 - lead saved to storage
  ];

  // ── Local storage helpers ────────────────────────────────────────────────────
  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || _emptyStore();
    } catch (e) { return _emptyStore(); }
  }

  function saveStore(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function _emptyStore() {
    return {
      version:     1,
      sessions:    [],       // [{id, start, end, steps[], type, utm}]
      funnel:      {},       // {step: count}
      typePerf:    {},       // {typeKey: {views, shares, wecom, leads, virality}}
      attribution: {}        // {utm_source: count}
    };
  }

  // ── Session management ───────────────────────────────────────────────────────
  var _session = null;

  function getSession() {
    if (_session) return _session;
    _session = {
      id:    Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      start: Date.now(),
      steps: [],
      type:  null,
      utm:   _readUTM()
    };
    return _session;
  }

  function _readUTM() {
    try {
      var p = new URLSearchParams(location.search);
      return {
        source:   p.get('utm_source')   || null,
        medium:   p.get('utm_medium')   || null,
        campaign: p.get('utm_campaign') || null,
        type:     p.get('type')         || null
      };
    } catch (e) { return {}; }
  }

  // ── Core track function ──────────────────────────────────────────────────────
  function track(event, meta) {
    meta = meta || {};
    var sess  = getSession();
    var store = loadStore();
    var ts    = Date.now();

    // Update type from meta if provided
    if (meta.type) sess.type = meta.type;

    // Funnel counts
    if (!store.funnel[event]) store.funnel[event] = 0;
    store.funnel[event]++;

    // Session steps
    if (sess.steps.indexOf(event) === -1) sess.steps.push(event);

    // Type performance
    var tp = sess.type || meta.type;
    if (tp) {
      if (!store.typePerf[tp]) {
        store.typePerf[tp] = { views: 0, shares: 0, wecom: 0, leads: 0 };
      }
      if (event === 'result_view')    store.typePerf[tp].views++;
      if (event === 'poster_share')   store.typePerf[tp].shares++;
      if (event === 'wecom_click')    store.typePerf[tp].wecom++;
      if (event === 'lead_captured')  store.typePerf[tp].leads++;
    }

    // Attribution
    var src = sess.utm.source || 'direct';
    if (!store.attribution[src]) store.attribution[src] = 0;
    store.attribution[src]++;

    saveStore(store);

    // Fire server beacon (best-effort, non-blocking)
    _beacon({ event: event, meta: meta, session: sess.id, type: tp, ts: ts, utm: sess.utm });
  }

  // ── UTM inbound attribution (for homepage) ──────────────────────────────────
  function captureInboundUTM() {
    var utm = _readUTM();
    if (!utm.source && !utm.type) return; // nothing to capture

    // Store for use by wizard on next navigation
    try {
      localStorage.setItem('aipiwen_inbound_utm', JSON.stringify({
        captured: Date.now(),
        utm: utm
      }));
    } catch (e) {}

    // Track the inbound event
    if (utm.source === 'poster') {
      track('qr_scan_inbound', { from_type: utm.type, utm: utm });
    }
  }

  // ── Beacon ───────────────────────────────────────────────────────────────────
  function _beacon(payload) {
    try {
      if (!navigator.sendBeacon) return;
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(TRACK_URL, blob);
    } catch (e) {}
  }

  // ── Dashboard data ───────────────────────────────────────────────────────────
  function getDashboard() {
    var store  = loadStore();
    var funnel = FUNNEL_STEPS.map(function (step, i) {
      var count = store.funnel[step] || 0;
      var prev  = i > 0 ? (store.funnel[FUNNEL_STEPS[i - 1]] || 0) : count;
      return {
        step:     step,
        label:    _stepLabel(step),
        count:    count,
        dropoff:  prev > 0 ? Math.round((1 - count / prev) * 100) : 0
      };
    });

    // Virality score = shares / views (if views > 0)
    var typeRows = Object.keys(store.typePerf).map(function (key) {
      var t = store.typePerf[key];
      return {
        key:      key,
        views:    t.views,
        shares:   t.shares,
        wecom:    t.wecom,
        leads:    t.leads,
        virality: t.views > 0 ? Math.round(t.shares / t.views * 100) : 0
      };
    }).sort(function (a, b) { return b.virality - a.virality; });

    var attrRows = Object.keys(store.attribution).map(function (src) {
      return { source: src, count: store.attribution[src] };
    }).sort(function (a, b) { return b.count - a.count; });

    return { funnel: funnel, typePerf: typeRows, attribution: attrRows };
  }

  function _stepLabel(step) {
    var labels = {
      'page_open':      '打开页面',
      'step1_complete': '填写信息',
      'step2_complete': '选择行为',
      'result_view':    '查看结果',
      'poster_open':    '打开海报',
      'poster_share':   '分享海报',
      'wecom_click':    '点击咨询',
      'lead_captured':  '线索保存',
      'qr_scan_inbound':'扫码进入'
    };
    return labels[step] || step;
  }

  // ── Reset (for testing) ──────────────────────────────────────────────────────
  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    _session = null;
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  root.GT = {
    track:            track,
    captureInboundUTM: captureInboundUTM,
    getDashboard:     getDashboard,
    FUNNEL_STEPS:     FUNNEL_STEPS,
    reset:            reset
  };

})(window);
