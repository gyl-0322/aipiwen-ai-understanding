/**
 * TRC 类型统一映射表
 * lib/trc-type-map.js
 *
 * 作用：建立 fingerprint-v2-wizard.html 的 classify() key
 *      与系统各层名称之间的唯一映射关系。
 *
 * 所有模块应通过此映射表理解类型，而不是各自维护一套命名。
 *
 * 字段说明：
 *   fingerprint_key   : classify() 返回的 key，系统内部唯一标识符
 *   standard_name     : 知识库标准名称（_personality-types.js / trc-knowledge-base.js）
 *   display_name      : 前端报告卡片展示名（classify mainType，已标准化）
 *   poster_name       : 海报 humanName（面向家长的通俗表达）
 *   ai_prompt_name    : AI 对话提示词中引用的名称（=standard_name）
 *   consultant_name   : 顾问解释时使用的口语名称
 *   tagline           : 4个标签的天赋关键词
 *   legacy_aliases    : 历史别名（兼容旧代码，不建议新代码使用）
 *   kb_exists         : 该类型是否已在 trc-knowledge-base.js 中有完整条目
 *   needs_review      : 是否需要进一步审核或补充
 *
 * 使用方式：
 *   // Browser
 *   <script src="/lib/trc-type-map.js"></script>
 *   const map = window.TRCTypeMap;
 *
 *   // Node.js
 *   const { TRC_TYPE_MAP, getTypeByKey } = require('../lib/trc-type-map');
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TRCTypeMap = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * 核心映射表
   * 按 fingerprint_key 索引，共 13 个 classify() 可产生的类型
   */
  const TRC_TYPE_MAP = {

    // ── 逆思型 ──────────────────────────────────────────────────────────────
    rl: {
      fingerprint_key:  'rl',
      standard_name:    '逆思型',
      display_name:     '逆思型',          // 修正：原 classify() 输出含多余 " R"
      poster_name:      '反直觉思考型孩子',
      ai_prompt_name:   '逆思型',
      consultant_name:  '逆向思维型',
      tagline:          '逆向思考 · 创意非凡 · 与众不同 · 挑战常规',
      legacy_aliases:   ['逆思型 R'],       // 旧 classify() mainType，已修正
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 超级认知型 A ────────────────────────────────────────────────────────
    super_w_a: {
      fingerprint_key:  'super_w_a',
      standard_name:    '超级认知型A',
      display_name:     '超级认知型A',      // 修正：原输出 "超级认知A · 螺旋领袖"（无"型"字）
      poster_name:      '天生领袖型孩子',
      ai_prompt_name:   '超级认知型A',
      consultant_name:  '超级领袖型',
      tagline:          '天生领袖 · 主见极强 · 目标必达 · 王者之气',
      legacy_aliases:   ['超级认知A · 螺旋领袖', '超级认知A'],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 超级认知型 B ────────────────────────────────────────────────────────
    super_w_b: {
      fingerprint_key:  'super_w_b',
      standard_name:    '超级认知型B',
      display_name:     '超级认知型B',      // 修正：原输出 "超级认知B · 双核整合"
      poster_name:      '多维整合领袖型孩子',
      ai_prompt_name:   '超级认知型B',
      consultant_name:  '多维整合型',
      tagline:          '领袖气质 · 全局整合 · 多维并行 · 跨界高手',
      legacy_aliases:   ['超级认知B · 双核整合', '超级认知B'],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 超级认知型 C ────────────────────────────────────────────────────────
    super_w_c: {
      fingerprint_key:  'super_w_c',
      standard_name:    '超级认知型C',
      display_name:     '超级认知型C',      // 修正：原输出 "超级认知C · 完美特质"
      poster_name:      '完美标准领袖型孩子',
      ai_prompt_name:   '超级认知型C',
      consultant_name:  '完美领袖型',
      tagline:          '领袖气质 · 极致审美 · 完美追求 · 卓越标准',
      legacy_aliases:   ['超级认知C · 完美特质', '超级认知C'],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 认知型 ──────────────────────────────────────────────────────────────
    w: {
      fingerprint_key:  'w',
      standard_name:    '认知型',
      display_name:     '认知型',
      poster_name:      '独立主见型孩子',
      ai_prompt_name:   '认知型',
      consultant_name:  '认知主见型',
      tagline:          '独立思考 · 主见权威 · 探索求知 · 逻辑构建',
      legacy_aliases:   ['w_mild'],         // w_mild 为 generateReport 兼容分支，classify 不输出
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 整合型 ──────────────────────────────────────────────────────────────
    wc: {
      fingerprint_key:  'wc',
      standard_name:    '整合型',
      display_name:     '整合型',
      poster_name:      '全局整合型孩子',
      ai_prompt_name:   '整合型',
      consultant_name:  '全局整合型',
      tagline:          '双核思维 · 多维整合 · 灵活高手 · 系统设计',
      legacy_aliases:   [],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 完美型 ──────────────────────────────────────────────────────────────
    perfect_w: {
      fingerprint_key:  'perfect_w',
      standard_name:    '完美型',
      display_name:     '完美型',
      poster_name:      '高标准完美型孩子',
      ai_prompt_name:   '完美型',
      consultant_name:  '完美主义型',
      tagline:          '极致标准 · 审美卓越 · 追求完美 · 品质至上',
      legacy_aliases:   [],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 超级模仿型 ──────────────────────────────────────────────────────────
    super_l: {
      fingerprint_key:  'super_l',
      standard_name:    '超级模仿型',
      display_name:     '超级模仿型',
      poster_name:      '无限接纳型孩子',
      ai_prompt_name:   '超级模仿型',
      consultant_name:  '超级接纳型',
      tagline:          '敞开接纳 · 大公无私 · 奉献型 · 共情极强',
      legacy_aliases:   [],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 模仿型 ──────────────────────────────────────────────────────────────
    l: {
      fingerprint_key:  'l',
      standard_name:    '模仿型',
      display_name:     '模仿型',
      poster_name:      '超强学习复制型孩子',
      ai_prompt_name:   '模仿型',
      consultant_name:  '学习模仿型',
      tagline:          '善于模仿 · 适应力强 · 服务型 · 精准复现',
      legacy_aliases:   ['l_mild'],         // l_mild 为 generateReport 兼容分支，classify 不输出
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 开放型 ──────────────────────────────────────────────────────────────
    x: {
      fingerprint_key:  'x',
      standard_name:    '开放型',
      display_name:     '开放型',
      poster_name:      '踏实执行型孩子',
      ai_prompt_name:   '开放型',
      consultant_name:  '开放踏实型',
      tagline:          '海绵学习 · 踏实肯干 · 简单极致 · 开放接纳',
      legacy_aliases:   [],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 两拇指不同斗形（组合型）─────────────────────────────────────────────
    // ⚠️ 官方名称待确认：用户说"统一叫什么兼什么"，具体名称尚未给出
    combo_w: {
      fingerprint_key:  'combo_w',
      standard_name:    '完美兼认知型',     // ⚠️ 暂用名——待用户确认官方名称
      display_name:     '完美兼认知型',
      poster_name:      '双斗天赋型孩子',
      ai_prompt_name:   '完美兼认知型',
      consultant_name:  '双斗融合型',
      tagline:          '双重天赋 · 多元认知 · 跨维思考 · 潜能叠加',
      legacy_aliases:   ['多维认知型'],
      kb_exists:        false,              // ⚠️ 知识库缺失——需补充条目
      needs_review:     true,              // ⚠️ 名称待用户最终确认
    },

    // ── 认知兼模仿（一斗一箕拇指）────────────────────────────────────────────
    combo_w_l: {
      fingerprint_key:  'combo_w_l',
      standard_name:    '认知兼模仿',       // 官方名称：一斗一箕拇指组合
      display_name:     '认知兼模仿',
      poster_name:      '主见学习型孩子',
      ai_prompt_name:   '认知兼模仿',
      consultant_name:  '认知兼模仿型',
      tagline:          '主见并存 · 学习力强 · 双向驱动 · 稀有组合',
      legacy_aliases:   ['认知模仿双驱型'],
      kb_exists:        true,
      needs_review:     false,
    },

    // ── 开放兼[主导拇指类型]（食指弧形+主导拇指）────────────────────────────
    // 官方命名规则："开放兼X"，X = 主导拇指决定的天赋类型
    combo_open: {
      fingerprint_key:  'combo_open',
      standard_name:    '开放兼X型',        // 动态：实际展示时 X 由主导拇指类型决定
      display_name:     '开放兼[主导类型]', // classify() 需动态生成，如"开放兼认知型"
      poster_name:      '开放融合型孩子',
      ai_prompt_name:   '开放兼[主导类型]',
      consultant_name:  '开放融合型',
      tagline:          '开放接纳 · 主导加持 · 成长灵活 · 多元适应',
      legacy_aliases:   ['开放加持型'],
      kb_exists:        true,
      needs_review:     false,
    },

  };

  // ── 工具函数 ──────────────────────────────────────────────────────────────

  /**
   * 通过 fingerprint_key 获取完整类型信息
   * @param {string} key - classify() 返回的 key
   * @returns {object|null}
   */
  function getTypeByKey(key) {
    return TRC_TYPE_MAP[key] || null;
  }

  /**
   * 获取展示名称（报告卡片标题）
   * @param {string} key
   * @returns {string}
   */
  function getDisplayName(key) {
    const t = TRC_TYPE_MAP[key];
    return t ? t.display_name : key;
  }

  /**
   * 获取海报名称（面向家长的通俗表达）
   * @param {string} key
   * @returns {string}
   */
  function getPosterName(key) {
    const t = TRC_TYPE_MAP[key];
    return t ? t.poster_name : key;
  }

  /**
   * 获取知识库标准名称（用于查询 _personality-types.js / trc-knowledge-base.js）
   * @param {string} key
   * @returns {string}
   */
  function getStandardName(key) {
    const t = TRC_TYPE_MAP[key];
    return t ? t.standard_name : key;
  }

  /**
   * 通过 legacy_alias 或 standard_name 反查 fingerprint_key
   * @param {string} name - 任意名称（display_name / standard_name / legacy_alias）
   * @returns {string|null}
   */
  function getKeyByName(name) {
    for (const [key, entry] of Object.entries(TRC_TYPE_MAP)) {
      if (
        entry.standard_name === name ||
        entry.display_name === name ||
        entry.poster_name === name ||
        (entry.legacy_aliases || []).includes(name)
      ) return key;
    }
    return null;
  }

  /**
   * 获取需要补充知识库条目的类型列表
   * @returns {Array<object>}
   */
  function getMissingKbTypes() {
    return Object.values(TRC_TYPE_MAP).filter(t => !t.kb_exists);
  }

  /**
   * 获取所有 classify() 可产生的 key 列表
   * @returns {string[]}
   */
  function getAllKeys() {
    return Object.keys(TRC_TYPE_MAP);
  }

  return {
    TRC_TYPE_MAP,
    getTypeByKey,
    getDisplayName,
    getPosterName,
    getStandardName,
    getKeyByName,
    getMissingKbTypes,
    getAllKeys,
  };

}));
