/**
 * AIPIWEN Growth Intelligence Engine V2
 * 规则引擎：洞察 + 瓶颈诊断 + 行动生成器
 *
 * 无外部依赖，无 AI API 调用。
 * 输入: { funnel:{}, typePerf:{}, attribution:{} }
 * 输出: { insights:[], bottleneck:{}, drops:{}, actions:{P0,P1,P2} }
 */
(function (window) {
  'use strict';

  // ── 漏斗步骤顺序 ─────────────────────────────────────────────────────────
  var FUNNEL_SEQ = [
    { step: 'page_open',       label: '页面打开' },
    { step: 'step1_complete',  label: 'Step1 完成' },
    { step: 'step2_complete',  label: 'Step2 完成' },
    { step: 'result_view',     label: '查看结果' },
    { step: 'poster_open',     label: '打开海报' },
    { step: 'poster_share',    label: '分享海报' },
    { step: 'wecom_click',     label: '点击咨询' },
    { step: 'lead_captured',   label: '留资完成' },
  ];

  // ── 漏斗行动规则库 ────────────────────────────────────────────────────────
  // 每条规则：trigger(ctx) 返回 true 时，对应 P0/P1/P2 建议被激活
  var FUNNEL_RULES = [
    {
      id: 'drop_entry',
      trigger: function(ctx) { return ctx.drops['page_open→step1_complete'] > 60; },
      P0: [
        '首屏文案直接呈现家长最痛的问题（如"孩子为什么一催就炸"），降低认知门槛',
        '检查移动端按钮点击区域是否足够大（建议高度≥44px）',
      ],
      P1: [
        '测试不同首屏hook：痛点型（"为什么总是…"）vs 好奇型（"1分钟看懂你的孩子"）',
      ],
      P2: ['重新设计首页信息层级，将最高转化元素前置到首屏'],
    },
    {
      id: 'drop_step2',
      trigger: function(ctx) { return ctx.drops['step1_complete→step2_complete'] > 50; },
      P0: [
        '在 Step2 加入进度指示器（如"第3步 / 共7步"），减少用户中途放弃',
        '检查 Step2 在手机端是否有图片加载慢或布局错乱问题',
      ],
      P1: [
        '测试精简题目版本：删减2道最低频题，对比完成率变化',
        '测试在进度过半时加入鼓励文案："快完成了，结果很准"',
      ],
      P2: ['优化题目视觉设计，让指纹选择更符合直觉'],
    },
    {
      id: 'drop_poster_open',
      trigger: function(ctx) { return ctx.drops['result_view→poster_open'] > 50; },
      P0: [
        '把"生成海报"按钮移到结果页首屏，不滚动即可看到',
        '按钮文案改为"生成孩子专属天赋卡片"（增加仪式感）',
      ],
      P1: [
        '测试在结果页中段插入海报预览图，让用户更早感知分享价值',
        '测试加入社会证明："已有 XXX 位家长生成了天赋海报"',
      ],
      P2: ['重新设计结果页视觉层级，让分享成为阅读报告后的自然下一步'],
    },
    {
      id: 'drop_poster_share',
      trigger: function(ctx) { return ctx.drops['poster_open→poster_share'] > 60; },
      P0: [
        '把"保存海报"按钮移到海报图片正下方（缩短操作路径）',
        '加入操作引导文字："长按图片保存，发给朋友看看"',
      ],
      P1: [
        '测试极简版海报（只保留类型名 + 1句话 + 二维码）vs 当前详细版的分享率',
        '对比下载按钮 vs 长按保存两种方式的完成率',
      ],
      P2: ['系统性研究高病毒力类型的海报设计规律，迁移到低传播类型'],
    },
    {
      id: 'drop_wecom',
      trigger: function(ctx) { return ctx.drops['poster_share→wecom_click'] > 70; },
      P0: [
        'personality.html 回流页：顾问 CTA 按钮改为深色背景（增加视觉权重）',
        '在回流页"行为建议"后直接插入顾问 CTA，不要放在页面底部',
      ],
      P1: [
        '测试 CTA 文案："预约顾问" vs "找顾问聊聊" vs "免费解读天赋"',
        '测试在回流页加入顾问真实形象图和一句推荐语',
      ],
      P2: ['建立顾问咨询价值展示体系（案例截图、家长评价、资质介绍）'],
    },
    {
      id: 'drop_lead',
      trigger: function(ctx) { return ctx.drops['wecom_click→lead_captured'] > 70; },
      P0: [
        '设置企业微信自动欢迎语，用户添加后3秒内自动发送',
        '欢迎语直接问："孩子几岁？最近主要担心什么？" 引导进入对话',
      ],
      P1: [
        '测试加好友后自动发送孩子天赋类型详细解读，提升留存和转化',
        '测试不同欢迎语风格：专业顾问型 vs 温暖共情型',
      ],
      P2: ['建立顾问跟进 SOP，量化每步转化率，持续优化话术'],
    },
  ];

  // ── 类型分析 ──────────────────────────────────────────────────────────────
  function analyzeTypes(typePerf) {
    var insights = [], P0 = [], P1 = [], P2 = [];
    var types = Object.entries(typePerf).map(function(entry) {
      var key = entry[0], v = entry[1];
      return {
        key: key,
        views:    v.views  || 0,
        shares:   v.shares || 0,
        wecom:    v.wecom  || 0,
        virality: (v.views || 0) > 0 ? (v.shares / v.views) : 0,
      };
    }).filter(function(t) { return t.views > 0; })
      .sort(function(a, b) { return b.virality - a.virality; });

    if (types.length === 0) return { insights: insights, P0: P0, P1: P1, P2: P2 };

    var top = types[0];
    var bottom = types[types.length - 1];

    if (top.virality >= 0.3) {
      insights.push('✦ 「' + top.key + '」类型病毒力最强（分享率 ' + Math.round(top.virality * 100) + '%），适合作为主推流量入口');
      P0.push('优先在社群 / 朋友圈推广「' + top.key + '」类型的内容和海报');
    }

    if (types.length >= 2 && bottom.virality > 0 && top.virality > bottom.virality * 2) {
      var ratio = Math.round(top.virality / bottom.virality);
      insights.push('⚠️ 类型间传播差距显著：「' + top.key + '」分享率是「' + bottom.key + '」的 ' + ratio + ' 倍');
      P1.push('对比「' + top.key + '」和「' + bottom.key + '」海报设计，把高传播元素迁移到低传播类型');
    }

    var deadTypes = types.filter(function(t) { return t.views >= 5 && t.shares === 0; });
    if (deadTypes.length > 0) {
      insights.push('⚠️ ' + deadTypes.map(function(t) { return t.key; }).join('、') + ' 类型有查看但零分享，海报或 QR 码可能异常');
      P0.push('立即检查 ' + deadTypes[0].key + ' 类型的海报生成，确认二维码是否正常显示');
    }

    return { insights: insights, P0: P0, P1: P1, P2: P2 };
  }

  // ── 归因分析 ──────────────────────────────────────────────────────────────
  function analyzeAttribution(attribution) {
    var insights = [], P0 = [], P1 = [], P2 = [];
    var total = Object.values(attribution).reduce(function(s, v) { return s + (v || 0); }, 0);
    if (total === 0) return { insights: insights, P0: P0, P1: P1, P2: P2 };

    var posterPct   = Math.round(((attribution['poster']  || 0) / total) * 100);
    var directPct   = Math.round(((attribution['direct']  || 0) / total) * 100);

    if (posterPct >= 20) {
      insights.push('✦ 海报扫码回流占总流量 ' + posterPct + '%，QR 闭环已开始运转');
    } else if (posterPct > 0) {
      insights.push('🔄 海报扫码回流占比 ' + posterPct + '%，QR 闭环效果有提升空间');
      P1.push('优化 personality.html 回流页内容，提升扫码用户再次分享率');
    }

    if (directPct > 70) {
      insights.push('⚠️ ' + directPct + '% 流量来自直接访问，UTM 追踪覆盖不足');
      P0.push('检查所有分享链接是否携带 utm_source 参数，确认海报 QR URL 格式正确');
    }

    return { insights: insights, P0: P0, P1: P1, P2: P2 };
  }

  // ── 主分析函数 ────────────────────────────────────────────────────────────
  function analyze(data) {
    var funnel      = data.funnel      || {};
    var typePerf    = data.typePerf    || {};
    var attribution = data.attribution || {};

    // 计算各步骤计数
    var counts = {};
    FUNNEL_SEQ.forEach(function(s) { counts[s.step] = funnel[s.step] || 0; });

    // 计算逐步掉落率
    var drops = {};
    for (var i = 0; i < FUNNEL_SEQ.length - 1; i++) {
      var from = FUNNEL_SEQ[i].step;
      var to   = FUNNEL_SEQ[i + 1].step;
      var cf   = counts[from];
      var ct   = counts[to];
      drops[from + '→' + to] = cf > 0 ? Math.round((1 - ct / cf) * 100) : 0;
    }

    // 找主要瓶颈（掉落率最高的步骤）
    var maxDrop = 0, primaryKey = null;
    Object.entries(drops).forEach(function(e) {
      if (e[1] > maxDrop) { maxDrop = e[1]; primaryKey = e[0]; }
    });

    var bottleneck = null;
    if (primaryKey) {
      var parts = primaryKey.split('→');
      bottleneck = {
        transition: primaryKey,
        dropPct:    maxDrop,
        severity:   maxDrop >= 70 ? 'high' : maxDrop >= 40 ? 'medium' : 'low',
        fromLabel:  (FUNNEL_SEQ.find(function(s) { return s.step === parts[0]; }) || {}).label || parts[0],
        toLabel:    (FUNNEL_SEQ.find(function(s) { return s.step === parts[1]; }) || {}).label || parts[1],
      };
    }

    // 洞察列表
    var insights = [];
    var totalOpen  = counts['page_open']      || 0;
    var totalLeads = counts['lead_captured']  || 0;
    if (totalOpen > 0) {
      var cvr = (totalLeads / totalOpen * 100).toFixed(1);
      insights.push('📊 整体漏斗转化率 ' + cvr + '%（' + totalLeads + ' 留资 / ' + totalOpen + ' 次访问）');
    }
    if (bottleneck) {
      var sLabel = { high: '🔴 严重', medium: '🟡 中等', low: '🟢 轻微' }[bottleneck.severity];
      insights.push(sLabel + ' 瓶颈：' + bottleneck.fromLabel + ' → ' + bottleneck.toLabel + ' 掉落 ' + maxDrop + '%');
    }

    // 类型 & 归因洞察
    var typeResult = analyzeTypes(typePerf);
    var attrResult = analyzeAttribution(attribution);
    insights = insights.concat(typeResult.insights, attrResult.insights);

    // 行动建议合并
    var P0 = [].concat(typeResult.P0, attrResult.P0);
    var P1 = [].concat(typeResult.P1, attrResult.P1);
    var P2 = [].concat(typeResult.P2, attrResult.P2);

    // 触发漏斗规则
    var ctx = { drops: drops, counts: counts };
    FUNNEL_RULES.forEach(function(rule) {
      if (rule.trigger(ctx)) {
        P0 = P0.concat(rule.P0);
        P1 = P1.concat(rule.P1);
        P2 = P2.concat(rule.P2);
      }
    });

    // 保底 P2 策略
    if (P2.length === 0) {
      P2.push('持续监测漏斗数据，2-4 周后根据真实趋势制定下阶段策略');
    }
    // 数据量不足提示
    if (totalOpen < 20) {
      insights.push('⏳ 当前样本量较小（' + totalOpen + ' 次访问），建议积累至 50+ 次后洞察更可靠');
    }

    return {
      insights:   insights,
      bottleneck: bottleneck,
      drops:      drops,
      actions:    { P0: P0, P1: P1, P2: P2 },
    };
  }

  window.GI = { analyze: analyze, FUNNEL_SEQ: FUNNEL_SEQ };

})(window);
