/**
 * AIPIWEN 全域分享转发语工具 v1.0
 *
 * SHARE.getCaptions(ctx, age, snippet)
 *   → [{label, text}, ...]  四种风格转发语
 *
 * SHARE.renderCaptionPicker(container, ctx, age, snippet, isDark)
 *   → 在 container 内渲染可点击复制的转发语按钮
 *   isDark: true(默认) 深色背景 | false 浅色背景（full-report 分享页用）
 *
 * ctx: 'child' | 'self' | 'partner' | 'business' | 'fingerprint'
 * age: 年龄段字符串，如 "初中13-15岁"，child 模式下影响共情文案
 * snippet: AI 洞察前几十字，用于「」引用
 */
(function (w) {
  'use strict';

  // ── 转发语库 ─────────────────────────────────────────────────
  function getCaptions(ctx, age, snippet) {
    var s = String(snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
    var q = s ? '「' + s + '……」\n' : '';

    // 亲子：按孩子年龄段给共情钩
    var ageHooks = {
      '幼儿':  '小娃的每个行为背后都有心理需求，只是我们没看懂。',
      '小学':  '陪小学生，最难的就是看懂他们的情绪和需求。',
      '初中':  '青春期的孩子，最让父母崩溃的是——突然看不懂了。',
      '高中':  '高中生父母最怕的，是说错一句话关系就裂了。',
      '大学':  '孩子上大学了，但父母的心还在牵挂着他的一切。',
      '职场':  '孩子已经长大，我们还在学怎么做父母。',
    };
    var childHook = '孩子的每个"问题行为"背后都有原因，只是我们没看懂。';
    var age_ = String(age || '');
    for (var k in ageHooks) {
      if (ageHooks.hasOwnProperty(k) && age_.indexOf(k) >= 0) {
        childHook = ageHooks[k]; break;
      }
    }

    var libs = {
      child: [
        { label: '💬 共情款',
          text: q + childHook + '\n推荐 aipiwen.cn，输入孩子行为，AI帮你读懂背后的心理原因。免费。' },
        { label: '🎯 直给款',
          text: '推荐 aipiwen.cn，输入孩子的一个行为，AI 告诉你背后的心理原因和应对方式。免费，2分钟出结果。' },
        { label: '💡 戳心款',
          text: childHook + '\naipiwen.cn 帮我说出来了。' },
        { label: '❓ 提问款',
          text: '你家孩子有没有让你完全看不懂的行为？这个AI工具真的有点准，而且免费 👉 aipiwen.cn' },
      ],
      partner: [
        { label: '💬 共情款',
          text: q + '看到这段话，有点说不出话。\n推荐这个AI，帮你读懂另一半：aipiwen.cn' },
        { label: '🎯 直给款',
          text: '推荐 aipiwen.cn，输入另一半的一个行为，AI 告诉你背后的心理逻辑。免费，2分钟出结果。' },
        { label: '💡 戳心款',
          text: '他不是不爱，是不会说。\n送给也在猜测另一半的你。aipiwen.cn' },
        { label: '❓ 提问款',
          text: '你有没有遇过完全猜不透另一半的时候？这个AI的解读让我沉默了三秒。👉 aipiwen.cn' },
      ],
      self: [
        { label: '💬 共情款',
          text: q + 'AI花了几秒，说出了我压了很久没说出的东西。aipiwen.cn' },
        { label: '🎯 直给款',
          text: '推荐 aipiwen.cn，不是性格测试，是行为解读。输入一个真实场景，AI 告诉你背后的心理模式。免费。' },
        { label: '💡 戳心款',
          text: '原来我的那些反应，都是有原因的。aipiwen.cn 帮我看懂了自己一点。' },
        { label: '❓ 提问款',
          text: '有没有那种时刻——你的某个反应，连自己都觉得奇怪？这个AI给我解释了。aipiwen.cn' },
      ],
      business: [
        { label: '💬 共情款',
          text: q + '合伙人关系最难的——永远不知道对方在想什么。aipiwen.cn' },
        { label: '🎯 直给款',
          text: '推荐 aipiwen.cn，输入合伙人的行为，AI分析背后的心理逻辑。生意上的事，先读懂人。免费。' },
        { label: '💡 戳心款',
          text: '合伙难不在钱，在心。这个AI帮我看懂了一些信号。aipiwen.cn' },
        { label: '❓ 提问款',
          text: '你有没有遇过合伙人让你完全看不懂的举动？aipiwen.cn 给了我一个角度。' },
      ],
      fingerprint: [
        { label: '💬 共情款',
          text: q + '没想到皮纹能看出这么多东西，挺准的。免费测一测 aipiwen.cn' },
        { label: '🎯 直给款',
          text: '推荐天赋底色速测，十指录入2分钟，AI 分析脑区天赋和学习模式。免费 👉 aipiwen.cn' },
        { label: '💡 戳心款',
          text: '十根手指藏着天生的学习和思维模式。aipiwen.cn 帮你看懂自己和孩子。' },
        { label: '❓ 提问款',
          text: '有没有人试过皮纹分析？这个AI测了之后感觉挺有参考价值的，而且免费。aipiwen.cn' },
      ],
    };

    return libs[ctx] || libs.child;
  }

  // ── 渲染转发语选择器 ──────────────────────────────────────────
  function renderCaptionPicker(container, ctx, age, snippet, isDark) {
    var dark = isDark !== false; // 默认深色
    var captions = getCaptions(ctx, age, snippet);

    // 标题
    var titleEl = document.createElement('div');
    titleEl.style.cssText = [
      'font-size:12px;margin-bottom:10px;text-align:center;',
      dark ? 'color:rgba(255,255,255,.4);' : 'color:rgba(42,37,32,.45);',
    ].join('');
    titleEl.textContent = '选一句转发语，点击复制 →';
    container.appendChild(titleEl);

    captions.forEach(function (cap) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'width:100%;padding:12px 16px;text-align:left;margin-bottom:8px;',
        'border-radius:12px;cursor:pointer;transition:background .15s,border-color .15s;display:block;',
        'font-family:-apple-system,PingFang SC,Helvetica,Arial,sans-serif;',
        'font-size:13px;line-height:1.6;',
        dark
          ? 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(234,231,224,.85);'
          : 'background:rgba(42,37,32,.04);border:1px solid rgba(42,37,32,.12);color:rgba(42,37,32,.8);',
      ].join('');

      var labelEl = document.createElement('div');
      labelEl.style.cssText = 'color:#C2692A;font-size:11px;font-weight:700;margin-bottom:5px;';
      labelEl.textContent = cap.label;
      btn.appendChild(labelEl);

      var textEl = document.createElement('div');
      textEl.style.whiteSpace = 'pre-wrap';
      textEl.textContent = cap.text;
      btn.appendChild(textEl);

      btn.addEventListener('click', function () {
        var txt = cap.text;
        var doCopy = function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(txt);
          }
          try {
            var ta = document.createElement('textarea');
            ta.value = txt;
            ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;width:1px;height:1px;';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (e) { /* ignore */ }
          return Promise.resolve();
        };
        doCopy().then(function () {
          var origLabel = labelEl.textContent;
          var origBg    = btn.style.background;
          var origBd    = btn.style.borderColor;
          btn.style.background   = dark ? 'rgba(194,105,42,.2)' : 'rgba(194,105,42,.1)';
          btn.style.borderColor  = 'rgba(194,105,42,.6)';
          labelEl.textContent    = '✓ 已复制！去粘贴发给朋友吧';
          labelEl.style.color    = '#D07A30';
          setTimeout(function () {
            btn.style.background  = origBg;
            btn.style.borderColor = origBd;
            labelEl.textContent   = origLabel;
            labelEl.style.color   = '#C2692A';
          }, 2200);
        }).catch(function () {});
      });

      container.appendChild(btn);
    });
  }

  w.SHARE = { getCaptions: getCaptions, renderCaptionPicker: renderCaptionPicker };
})(window);
