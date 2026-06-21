/**
 * TRC 知识库统一适配器
 * lib/trc-knowledge-adapter.js
 *
 * 作用：提供统一查询接口，屏蔽底层知识库的差异。
 *      所有模块通过此适配器获取类型数据，不直接依赖具体知识库文件。
 *
 * 查询优先级：
 *   1. lib/trc-knowledge-base.js（首选，最完整）
 *   2. lib/trc-type-map.js（降级，基本字段）
 *   3. 原始 fingerprint_key（最后兜底）
 *
 * 使用方式：
 *   // Browser（需先加载 trc-knowledge-base.js 和 trc-type-map.js）
 *   <script src="/lib/trc-knowledge-base.js"></script>
 *   <script src="/lib/trc-type-map.js"></script>
 *   <script src="/lib/trc-knowledge-adapter.js"></script>
 *   const adapter = window.TRCAdapter;
 *   const info = adapter.getByFingerprintKey('rl');
 *
 *   // Node.js
 *   const adapter = require('../lib/trc-knowledge-adapter');
 *   const info = adapter.getByFingerprintKey('perfect_w');
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js：直接 require 依赖
    const typeMap = require('./trc-type-map');
    let knowledgeBase = null;
    try { knowledgeBase = require('./trc-knowledge-base'); } catch(e) { /* optional */ }
    module.exports = factory(typeMap, knowledgeBase);
  } else {
    // Browser：从全局变量读取
    const typeMap = root.TRCTypeMap || null;
    const knowledgeBase = root.TRCKnowledgeBase || null;
    root.TRCAdapter = factory(typeMap, knowledgeBase);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (typeMap, knowledgeBase) {

  /**
   * 通过 fingerprint_key 获取完整类型信息
   * 返回统一格式对象，字段缺失时有降级兜底
   *
   * @param {string} key - classify() 返回的 key（如 'rl', 'super_w_a', 'w'）
   * @returns {object} 标准化类型信息对象
   */
  function getByFingerprintKey(key) {
    // Step 1：从映射表获取基础信息
    const mapEntry = typeMap ? typeMap.getTypeByKey(key) : null;
    if (!mapEntry) {
      return _fallback(key);
    }

    // Step 2：用 standard_name 从知识库查完整数据
    let kbData = null;
    if (knowledgeBase) {
      // trc-knowledge-base.js 暴露 getType(typeName) 方法
      const getType = knowledgeBase.getType || (knowledgeBase.TRCKnowledgeBase && knowledgeBase.TRCKnowledgeBase.getType);
      if (getType) {
        kbData = getType(mapEntry.standard_name);
      }
    }

    // Step 3：合并返回
    return {
      // 核心标识
      fingerprint_key:  key,
      standard_name:    mapEntry.standard_name,

      // 各场景名称
      display_name:     mapEntry.display_name,
      poster_name:      mapEntry.poster_name,
      ai_prompt_name:   mapEntry.ai_prompt_name,
      consultant_name:  mapEntry.consultant_name,

      // 展示数据（优先从知识库，降级到映射表）
      tagline:          (kbData && kbData.tagline) || mapEntry.tagline || '',
      core_talent:      (kbData && kbData.核心天赋) || '',
      typical_behavior: (kbData && kbData.典型行为) || [],
      common_misconception: (kbData && kbData.常见误解) || '',
      development_key:  (kbData && kbData.发展关键) || '',
      fingerprint_origin: (kbData && kbData.指纹溯源) || '',
      summary:          (kbData && kbData.总结) || '',

      // 元信息
      kb_exists:        mapEntry.kb_exists,
      needs_review:     mapEntry.needs_review,
      legacy_aliases:   mapEntry.legacy_aliases || [],

      // 原始知识库完整数据（如需要直接访问）
      _raw_kb:          kbData || null,
    };
  }

  /**
   * 获取展示名称（报告卡片标题）
   * @param {string} key
   * @returns {string}
   */
  function getDisplayName(key) {
    return typeMap ? typeMap.getDisplayName(key) : key;
  }

  /**
   * 获取海报名称（面向家长的通俗表达）
   * @param {string} key
   * @returns {string}
   */
  function getPosterName(key) {
    return typeMap ? typeMap.getPosterName(key) : key;
  }

  /**
   * 获取知识库标准名称
   * @param {string} key
   * @returns {string}
   */
  function getStandardName(key) {
    return typeMap ? typeMap.getStandardName(key) : key;
  }

  /**
   * 获取 AI 提示词中应使用的名称
   * @param {string} key
   * @returns {string}
   */
  function getPromptReference(key) {
    const entry = typeMap ? typeMap.getTypeByKey(key) : null;
    return entry ? entry.ai_prompt_name : key;
  }

  /**
   * 获取顾问口语化名称
   * @param {string} key
   * @returns {string}
   */
  function getConsultantName(key) {
    const entry = typeMap ? typeMap.getTypeByKey(key) : null;
    return entry ? entry.consultant_name : key;
  }

  /**
   * 获取所有 classify() 可产生的类型 key 列表
   * @returns {string[]}
   */
  function getAllKeys() {
    return typeMap ? typeMap.getAllKeys() : [];
  }

  /**
   * 获取知识库中缺失的类型（需要补充）
   * @returns {Array<object>}
   */
  function getMissingKbTypes() {
    return typeMap ? typeMap.getMissingKbTypes() : [];
  }

  /**
   * 通过任意名称（包括历史别名）反查 fingerprint_key
   * @param {string} name
   * @returns {string|null}
   */
  function getKeyByName(name) {
    return typeMap ? typeMap.getKeyByName(name) : null;
  }

  /**
   * 检查适配器状态（调试用）
   * @returns {object}
   */
  function status() {
    return {
      typeMapLoaded:        !!typeMap,
      knowledgeBaseLoaded:  !!knowledgeBase,
      totalKeys:            getAllKeys().length,
      missingKbCount:       getMissingKbTypes().length,
      missingKbTypes:       getMissingKbTypes().map(t => t.standard_name),
    };
  }

  // ── 内部工具 ──────────────────────────────────────────────────────────────

  function _fallback(key) {
    return {
      fingerprint_key:  key,
      standard_name:    key,
      display_name:     key,
      poster_name:      key,
      ai_prompt_name:   key,
      consultant_name:  key,
      tagline:          '',
      core_talent:      '',
      typical_behavior: [],
      common_misconception: '',
      development_key:  '',
      fingerprint_origin: '',
      summary:          '',
      kb_exists:        false,
      needs_review:     true,
      legacy_aliases:   [],
      _raw_kb:          null,
    };
  }

  return {
    getByFingerprintKey,
    getDisplayName,
    getPosterName,
    getStandardName,
    getPromptReference,
    getConsultantName,
    getAllKeys,
    getMissingKbTypes,
    getKeyByName,
    status,
  };

}));
