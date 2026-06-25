/**
 * trc-engine.js — TRC 皮纹计算引擎 (JS port of engine.py)
 * 已用 1442 份真实报告验证:主类型/学习通道/行为模式/左右脑 均 100% 一致
 *
 * 输入:
 *   fingers = {
 *     R1:{sym:'Ws',trc:18}, R2:{sym:'Lu',trc:13}, ... L5:{sym:'Lu',trc:14}
 *   }
 *   options = { atd: 38.5, age: 9, sex: '男' }
 *
 * 输出:见 classify() 返回值说明
 *
 * 手指位置: R1~R5 = 右手拇/食/中/无名/小 (左脑·理性)
 *            L1~L5 = 左手拇/食/中/无名/小 (右脑·感性)
 *
 * 用法(浏览器):  <script src="lib/trc-engine.js"></script>  → window.TRCEngine
 * 用法(Node.js): const { classify } = require('./lib/trc-engine')
 */

;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TRCEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ── 纹型符号 → 主类型标签 ──────────────────────────────────────────
  const LBL = {
    'Ws':'认知','Wt':'认知','We':'认知','Wsp':'认知','Wsr':'认知','Wi':'认知', // 认知家族(含内破斗/反侧向螺旋)
    'Wc':'整合', 'Wd':'整合', 'Wsc':'整合',                 // 整合家族
    'Wpe':'完美','Rpe':'完美','Wl':'完美', 'Rwl':'完美',    // 完美家族
    'Lu':'模仿', 'Ls':'模仿', 'Lf':'模仿',                  // 模仿家族
    'Rl':'反箕',                                             // 逆思(反箕)
    'X':'开放',  'Xn':'开放',                               // 开放家族
  };

  const FAM      = { '认知':'斗','整合':'斗','完美':'斗','模仿':'箕','开放':'弧' };
  const FAMRANK  = { '斗':0, '箕':1, '弧':2 };
  const SUBPRI   = { '整合':0, '完美':1, '认知':2 };   // 斗子型打平优先级
  const REVERSE  = new Set(['Rl','Rpe','Rwl','Wsr']);    // 具有逆向思维的纹型(Wsr=反侧向螺旋斗含+R)

  // 主类型中文 → 短键 (供 KEY2IMG / 分享海报使用)
  const TYPE2KEY = {
    '认知型':'w',      '整合型':'wc',     '完美型':'perfect_w',
    '模仿型':'l',      '开放型':'x',      '逆思型':'rl',
    '超级认知型A':'super_w_a', '超级认知型B':'super_w_b', '超级认知型C':'super_w_c',
    '超级模仿型':'super_l',
    // 兼型 — fallback 由 _typeKey() 处理
  };

  // ── 内部工具 ──────────────────────────────────────────────────────
  function _label(sym) {
    return LBL[sym] || '认知';
  }

  /** 主导拇指标签。la/lt = 左拇标签/TRC，ra/rt = 右拇标签/TRC */
  function _dominant(la, lt, ra, rt) {
    if (la === ra) return la;
    if (lt > rt)  return la;
    if (rt > lt)  return ra;
    // 打平：整合 > 完美 > 认知
    return (SUBPRI[la] ?? 9) <= (SUBPRI[ra] ?? 9) ? la : ra;
  }

  function _trc(f, p) { return (f[p] && f[p].trc) || 0; }

  /** 兼型 → 短键 */
  function _typeKey(mainType) {
    if (TYPE2KEY[mainType]) return TYPE2KEY[mainType];
    if (mainType.includes('开放')) return 'combo_open';
    if (mainType.includes('模仿')) return 'combo_w_l';
    return 'combo_w';
  }

  // ── 主类型判定 ─────────────────────────────────────────────────────
  /**
   * classifyMain(fingers) → 主类型字符串 (中文)
   * fingers: { R1:{sym,trc}, R2:..., L5:{sym,trc} }
   */
  function classifyMain(fingers) {
    const labels = {};
    for (const p in fingers) labels[p] = _label(fingers[p].sym);
    const lab = Object.values(labels);

    const la = _label(fingers['L1'].sym), lt = fingers['L1'].trc;
    const ra = _label(fingers['R1'].sym), rt = fingers['R1'].trc;

    // R1 任意反箕 → 逆思型
    if (lab.includes('反箕')) return '逆思型';

    // R2 全斗 → 超级认知 A/B/C
    if (lab.every(x => ['认知','整合','完美'].includes(x))) {
      const d = _dominant(la, lt, ra, rt);
      return { '认知':'超级认知型A', '整合':'超级认知型B', '完美':'超级认知型C' }[d];
    }

    // R3 弧 ≥ 6 → 开放型
    if (lab.filter(x => x === '开放').length >= 6) return '开放型';

    const indexArch = labels['R2'] === '开放' || labels['L2'] === '开放';

    // R4 全正箕 → 超级模仿型
    if (lab.every(x => x === '模仿')) return '超级模仿型';

    // 食指有弧 → 兼开放型
    if (indexArch) {
      const d = _dominant(la, lt, ra, rt);
      return d === '开放' ? '开放型' : d + '兼开放型';
    }

    // R5 两拇相同 → 单一型
    if (la === ra) return la + '型';

    const fl = FAM[la] || '箕', fr = FAM[ra] || '箕';
    if (fl !== fr) {
      // 跨家族 → 兼型（优先级高的家族在前：斗 > 箕 > 弧）
      return FAMRANK[fl] <= FAMRANK[fr]
        ? la + '兼' + ra + '型'
        : ra + '兼' + la + '型';
    }
    // 同家族不同子型 → 主导拇指单一型
    return _dominant(la, lt, ra, rt) + '型';
  }

  // ── 完整输出 ───────────────────────────────────────────────────────
  /**
   * classify(fingers, options?) → 完整画像对象
   *
   * 返回字段:
   *   主性格类型  {String}   中文类型名
   *   key         {String}   短键 (w/wc/rl/l/x/…)，供 KEY2IMG 映射
   *   叠加特质    {M型, 逆向思维R, R手指[]}
   *   学习通道    {主通道, 占比{体觉型%,听觉型%,视觉型%}}
   *   行为模式    {结论, delta%, 精神, 思维}
   *   左右脑      {结论, 左脑, 右脑, 左脑占比%}
   *   五功能区    {精神,思维,体觉,听觉,视觉,总TRC,个人均值}
   *   ATD         {值, 分区}
   *   年龄  性别
   */
  function classify(fingers, { atd = null, age = null, sex = null } = {}) {
    const f = fingers;

    const 精神 = _trc(f,'R1') + _trc(f,'L1');
    const 思维 = _trc(f,'R2') + _trc(f,'L2');
    const 体觉 = _trc(f,'R3') + _trc(f,'L3');
    const 听觉 = _trc(f,'R4') + _trc(f,'L4');
    const 视觉 = _trc(f,'R5') + _trc(f,'L5');
    const 总TRC = 精神 + 思维 + 体觉 + 听觉 + 视觉;

    const main = classifyMain(f);

    // 学习通道（中/无/小；平局：视 > 体 > 听）
    const sub = 体觉 + 听觉 + 视觉;
    const mx  = Math.max(体觉, 听觉, 视觉);
    let mainChan = '体觉型';
    for (const c of ['视觉型','体觉型','听觉型']) {
      if ({ '视觉型':视觉, '体觉型':体觉, '听觉型':听觉 }[c] === mx) { mainChan = c; break; }
    }
    const chanPct = sub ? {
      '体觉型': +(体觉/sub*100).toFixed(1),
      '听觉型': +(听觉/sub*100).toFixed(1),
      '视觉型': +(视觉/sub*100).toFixed(1),
    } : {};

    // 行为模式
    const s2    = 精神 + 思维;
    const delta = s2 ? (精神 - 思维) / s2 * 100 : 0;
    const behavior = delta >= 5 ? '动机型' : (delta <= -1 ? '构思型' : '均衡型');

    // 左右脑（右手=左脑，左手=右脑）
    const 左脑 = ['R1','R2','R3','R4','R5'].reduce((s,p) => s+_trc(f,p), 0);
    const 右脑 = ['L1','L2','L3','L4','L5'].reduce((s,p) => s+_trc(f,p), 0);
    const 左脑pct = (左脑+右脑) ? 左脑/(左脑+右脑)*100 : 50;
    const dev = 左脑pct - 50;
    const brain = dev >= 2.5 ? '左脑型' : (dev <= -2.5 ? '右脑型' : '均衡型');

    // M 型（精神领先其他最高区 ≥13）
    const M型 = (精神 - Math.max(思维, 体觉, 听觉, 视觉)) >= 13;

    // +R（逆向思维）
    const plusR = Object.keys(f).filter(p => REVERSE.has(f[p].sym));

    // ATD 分区
    let atdZone = null;
    if (atd !== null) {
      atdZone = atd <= 36.5 ? '超敏感高能量型'
              : atd <= 42   ? '敏感灵活型'
              : atd <= 50   ? '均衡型'
              :               '情绪极稳定型';
    }

    return {
      主性格类型: main,
      key:        _typeKey(main),
      叠加特质:   { M型, 逆向思维R: plusR.length > 0, R手指: plusR },
      学习通道:   { 主通道: mainChan, 占比: chanPct },
      行为模式:   { 结论: behavior, 'delta%': +delta.toFixed(1), 精神, 思维 },
      左右脑:     { 结论: brain, 左脑, 右脑, 左脑占比: +左脑pct.toFixed(1) },
      五功能区:   { 精神, 思维, 体觉, 听觉, 视觉, 总TRC, 个人均值: +(总TRC/10).toFixed(1) },
      ATD:        { 值: atd, 分区: atdZone },
      年龄: age,  性别: sex,
    };
  }

  // ── 速测专用: 纯纹型判定 ────────────────────────────────────────────
  /**
   * classifyBySymbolsOnly(thumbs, allSymbols) → { mainType, key, tagline }
   *
   * 速测链路专用 — 只读纹型符号，绝不读取任何 TRC / ATD 数值。
   * 适用场景: fingerprint-v2-wizard (用户自勾纹型, 无数值数据)
   *
   * 完整版链路 (有 TRC 数值) 请使用 classify()，见 report-upload.html。
   *
   * thumbs:     { right: 'Ws', left: 'Lu' }   右手拇指符号 / 左手拇指符号
   * allSymbols: { R1:'Ws', R2:'Lu', ..., L5:'Lu' }  十指符号 (无需 trc 字段)
   */
  function classifyBySymbolsOnly(thumbs, allSymbols) {
    const rt   = thumbs.right;
    const lt   = thumbs.left;
    const syms = Object.values(allSymbols);

    const _isW      = s => ['Ws','Wt','We','Wc','Wd','Wpe','Wsp','Wsp-r'].includes(s || '');
    const _isDouble  = s => s === 'Wd' || s === 'Wc';
    const _isPeacock = s => s === 'We' || s === 'Wpe';

    // ── RULE 1: 任意手指有反箕(Rl) → 逆思型 (逆思优先，与完整版一致) ──
    if (syms.some(s => REVERSE.has(s)))
      return { mainType: '逆思型 R', key: 'rl', tagline: '逆向思考 · 创意非凡 · 与众不同' };

    const totalW   = syms.filter(s => _isW(s)).length;
    const totalLu  = syms.filter(s => s === 'Lu').length;
    const totalArc = syms.filter(s => s === 'X' || s === 'Xn').length;

    // ── RULE 2: 十指全斗 → 超级认知 A / B / C ──────────────────────
    if (totalW >= 10) {
      const dblRt = _isDouble(rt), dblLt = _isDouble(lt);
      const peaRt = _isPeacock(rt), peaLt = _isPeacock(lt);
      if ((dblRt && peaLt) || (peaRt && dblLt))
        return dblLt
          ? { mainType: '超级认知B · 双核整合', key: 'super_w_b', tagline: '领袖气质 · 全局整合 · 多维并行 · 跨界高手' }
          : { mainType: '超级认知C · 完美特质', key: 'super_w_c', tagline: '领袖气质 · 极致审美 · 完美追求 · 卓越标准' };
      if (dblRt || dblLt)
        return { mainType: '超级认知B · 双核整合', key: 'super_w_b', tagline: '领袖气质 · 全局整合 · 多维并行 · 跨界高手' };
      if (peaRt || peaLt)
        return { mainType: '超级认知C · 完美特质', key: 'super_w_c', tagline: '领袖气质 · 极致审美 · 完美追求 · 卓越标准' };
      return { mainType: '超级认知A · 螺旋领袖', key: 'super_w_a', tagline: '天生领袖 · 主见极强 · 目标必达 · 王者之气' };
    }

    // ── RULE 3: 弧形纹 ≥ 6 → 开放型 ───────────────────────────────
    if (totalArc >= 6)
      return { mainType: '开放型', key: 'x', tagline: '海绵学习 · 踏实肯干 · 简单极致' };

    // ── RULE 3b: 食指有弧 → [拇指类型]兼开放型 ─────────────────────
    const idxR = allSymbols['R2'] || '', idxL = allSymbols['L2'] || '';
    const hasIndexArc = idxR === 'X' || idxR === 'Xn' || idxL === 'X' || idxL === 'Xn';

    // ── RULE 4: 十指全正箕 → 超级模仿型 ───────────────────────────
    if (totalLu >= 10)
      return { mainType: '超级模仿型', key: 'super_l', tagline: '敞开接纳 · 大公无私 · 奉献型' };

    // 拇指类型标签 (纯符号，不读数值)
    function _thumbLbl(sym) {
      if (_isW(sym)) { return _isDouble(sym) ? '整合' : _isPeacock(sym) ? '完美' : '认知'; }
      if (sym === 'Lu')                return '模仿';
      if (sym === 'X' || sym === 'Xn') return '开放';
      return '认知';  // 未知符号 fallback
    }

    const rtLbl = _thumbLbl(rt), ltLbl = _thumbLbl(lt);

    if (hasIndexArc) {
      const lbl = ltLbl !== '开放' ? ltLbl : rtLbl;
      if (lbl !== '开放')
        return { mainType: `${lbl}兼开放型`, key: 'combo_open', tagline: `${lbl}主导 · 开放加持 · 吸收力强` };
    }

    // ── RULE 5: 两拇指相同 → 单一型 ────────────────────────────────
    const SINGLE = {
      '认知': { mainType: '认知型',   key: 'w',        tagline: '独立思考 · 主见权威 · 探索求知' },
      '整合': { mainType: '整合型',   key: 'wc',       tagline: '双核思维 · 多维整合 · 灵活高手' },
      '完美': { mainType: '完美型',   key: 'perfect_w',tagline: '极致标准 · 审美卓越 · 追求完美' },
      '模仿': { mainType: '模仿型',   key: 'l',        tagline: '善于模仿 · 适应力强 · 服务型' },
      '开放': { mainType: '开放型',   key: 'x',        tagline: '海绵学习 · 踏实肯干 · 简单极致' },
    };
    if (rtLbl === ltLbl) return SINGLE[rtLbl] || SINGLE['认知'];

    // ── RULE 6: 两拇指不同 → 兼型 (13b规格: 双拇指纹型不同→判兼型) ─
    // 顺序: 右拇指类型在前，左拇指类型在后 (如实反映，不按优先级重排)
    const a = rtLbl, b = ltLbl;
    const types = new Set([a, b]);
    const comboKey = types.has('开放') ? 'combo_open'
                   : types.has('模仿') ? 'combo_w_l'
                   : 'combo_w';
    return { mainType: `${a}兼${b}型`, key: comboKey, tagline: `${a}主导 · ${b}加持 · 多元天赋` };
  }

  return { classify, classifyMain, classifyBySymbolsOnly, LBL, TYPE2KEY, _typeKey };
});

// ── Node.js 自检（npm test 或 node lib/trc-engine.js） ─────────────
if (typeof require !== 'undefined' && require.main === module) {
  const { classify, classifyMain } = module.exports;

  function F(pairs) {
    const keys = ['R1','R2','R3','R4','R5','L1','L2','L3','L4','L5'];
    return Object.fromEntries(keys.map((k,i) => [k, { sym: pairs[i][0], trc: pairs[i][1] }]));
  }

  const cases = [
    { label:'例1 整合型(打平整合>认知)',
      f: F([['Ws',20],['Ws',15],['Ws',16],['Ws',18],['Lu',14],
            ['Wc',20],['Lu',13],['Lu',12],['Lu',11],['Lu',15]]),
      expect:'整合型' },
    { label:'例2 逆思型(任意Rl)',
      f: F([['Ws',20],['Ws',15],['Ws',16],['Rl',18],['Lu',14],
            ['Wc',20],['Lu',13],['Lu',12],['Lu',11],['Lu',15]]),
      expect:'逆思型' },
    { label:'例3 超级认知型C(全斗,主导=孔雀眼)',
      f: F([['Wpe',25],['Ws',18],['Ws',16],['Ws',18],['Ws',14],
            ['Ws',20],['Ws',13],['Ws',12],['Ws',11],['Ws',15]]),
      expect:'超级认知型C' },
    { label:'例4 模仿型(两拇Lu,其余混合)',
      f: F([['Lu',16],['Ws',14],['Lu',13],['Lu',12],['Ws',11],
            ['Lu',15],['Ws',13],['Lu',12],['Lu',11],['Lu',10]]),
      expect:'模仿型' },
    { label:'例5 开放型(全弧≥6)',
      f: F([['X',8],['X',7],['X',6],['X',8],['X',7],
            ['X',6],['X',5],['Lu',10],['Lu',9],['Lu',8]]),
      expect:'开放型' },
  ];

  let pass = 0;
  for (const c of cases) {
    const got = classifyMain(c.f);
    const ok = got === c.expect;
    console.log((ok?'✓':'✗'), c.label, `→ ${got}${ok?'':' (expected '+c.expect+')'}`);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${cases.length} passed`);

  console.log('\n── 完整输出示例 (例1) ──');
  const full = classify(cases[0].f, { atd: 38.5, age: 8, sex: '男' });
  console.log(JSON.stringify(full, null, 2));
}
