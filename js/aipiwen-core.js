/**
 * AIPIWEN Core System V1
 * 用户系统 + 记忆系统 + 行为分析引擎 + 内容库 + Lead系统
 */

/* ================================================================
   用户系统 (User System)
================================================================ */
const UserSystem = {
  KEY: 'aipiwen_user_v1',

  getOrCreate() {
    try {
      let user = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (!user || !user.user_id) {
        user = {
          user_id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          created_at: new Date().toISOString(),
          role: 'parent',
          session_count: 0
        };
        localStorage.setItem(this.KEY, JSON.stringify(user));
      }
      return user;
    } catch (e) {
      return { user_id: 'u_anon', role: 'parent', session_count: 0, created_at: new Date().toISOString() };
    }
  },

  incrementSession() {
    try {
      const user = this.getOrCreate();
      user.session_count = (user.session_count || 0) + 1;
      user.last_active = new Date().toISOString();
      localStorage.setItem(this.KEY, JSON.stringify(user));
      return user;
    } catch (e) {
      return this.getOrCreate();
    }
  },

  get() { return this.getOrCreate(); }
};

/* ================================================================
   记忆系统 (Memory System)
================================================================ */
const MemorySystem = {
  PREFIX: 'aipiwen_mem_v1_',

  _key(userId) { return this.PREFIX + userId; },

  add(userId, entry) {
    try {
      const all = this.getAll(userId);
      const record = {
        id: 'mem_' + Date.now(),
        timestamp: new Date().toISOString(),
        input: entry.input || '',
        analysis: entry.analysis || {},
        tags: entry.tags || [],
        report_id: entry.report_id || null
      };
      all.push(record);
      // Keep max 20 entries
      const trimmed = all.slice(-20);
      localStorage.setItem(this._key(userId), JSON.stringify(trimmed));
      return record;
    } catch (e) { return null; }
  },

  getAll(userId) {
    try {
      return JSON.parse(localStorage.getItem(this._key(userId)) || '[]');
    } catch (e) { return []; }
  },

  getRecent(userId, n = 5) {
    return this.getAll(userId).slice(-n);
  },

  getContext(userId) {
    const all = this.getAll(userId);
    if (!all.length) return null;

    // Count pattern frequencies across history
    const freq = {};
    all.forEach(m => {
      const p = m.analysis && m.analysis.primary;
      if (p) freq[p] = (freq[p] || 0) + 1;
    });
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]);

    return {
      total: all.length,
      first_seen: all[0].timestamp,
      last_input: all[all.length - 1].input,
      last_tags: all[all.length - 1].tags || [],
      top_pattern: top[0] ? top[0][0] : null,
      top_pattern_count: top[0] ? top[0][1] : 0,
      pattern_freq: freq,
      is_returning: all.length > 1
    };
  },

  // V2：检测最近 N 条是否有重复行为模式
  detectRepeatPattern(userId, windowSize) {
    windowSize = windowSize || 3;
    const all = this.getAll(userId);
    if (all.length < 2) return { detected: false, pattern: null, count: 0 };
    const recent = all.slice(-windowSize).map(m => m.analysis && m.analysis.primary).filter(Boolean);
    if (recent.length < 2) return { detected: false, pattern: null, count: 0 };
    const counts = {};
    recent.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      detected: top[1] >= 2,
      pattern: top[0],
      count: top[1],
      windowSize: recent.length
    };
  },

  // V2：生成行为时间线（用于趋势展示）
  getTimeline(userId) {
    return this.getAll(userId).map(m => ({
      date: m.timestamp ? m.timestamp.slice(0, 10) : '?',
      pattern: m.analysis && m.analysis.primary,
      label: m.tags && m.tags[0] || '',
      input_preview: (m.input || '').slice(0, 30)
    }));
  }
};

/* ================================================================
   行为分析引擎 (Behavior Analysis Engine)
================================================================ */
const AnalysisEngine = {

  // 12种行为模式识别规则
  PATTERNS: {
    emotional_explosion: {
      label: '情绪爆发',
      category: 'emotional',
      legacy: 'emotional',
      keywords: [
        /发脾气|发火|爆发|崩溃|暴躁|歇斯底里|大吼大叫|大叫|摔东西/,
        /情绪.*失控|控制不住.*情绪|控制不了/,
        /一说.*(就|就会)|一催.*(就|就会)/
      ],
      weight: 3
    },
    emotional_sensitive: {
      label: '情绪敏感',
      category: 'emotional',
      legacy: 'emotional',
      keywords: [
        /大哭|哭|流泪|委屈|难过|难受|伤心/,
        /敏感|玻璃心|一点小事|芝麻大的事/,
        /受不了|承受不了/
      ],
      weight: 2
    },
    homework_conflict: {
      label: '学习抵触',
      category: 'control',
      legacy: 'control',
      keywords: [
        /作业|功课|写字|读书|背书|默写|考试|成绩/,
        /不写|不做|不肯|拖延|拖拉|磨蹭|不认真|不好好/
      ],
      weight: 3
    },
    autonomy_resist: {
      label: '自主冲突',
      category: 'control',
      legacy: 'control',
      keywords: [
        /不听话|叛逆|顶嘴|顶撞|对抗|反抗|固执|较劲/,
        /不服|偏要|就是不|凭什么|不理我|无视|反正我|你管我/
      ],
      weight: 3
    },
    phone_addiction: {
      label: '沉迷屏幕',
      category: 'avoidance',
      legacy: 'avoidance',
      keywords: [
        /手机|游戏|视频|电视|电脑|网络|短视频|ipad|平板/i,
        /沉迷|停不下来|停不住|一直玩|放不下|离不开|抢手机/,
        /说不动|没法停/
      ],
      weight: 3
    },
    withdrawal: {
      label: '退缩回避',
      category: 'avoidance',
      legacy: 'avoidance',
      keywords: [
        /沉默|不说话|不回应|关门|躲起来|不理人|冷漠/,
        /什么都不说|问.*也不说|问了不答|没有回应/,
        /自己一个人|把自己关起来/
      ],
      weight: 2
    },
    aggression: {
      label: '攻击行为',
      category: 'emotional',
      legacy: 'emotional',
      keywords: [
        /打人|打[弟妹兄姐同学老师朋友]/,
        /踢人|咬人|抓人|推人|攻击/,
        /动手|下手|伤人|欺负人|霸道|蛮横/
      ],
      weight: 4
    },
    lying: {
      label: '撒谎欺骗',
      category: 'avoidance',
      legacy: 'avoidance',
      keywords: [
        /说谎|撒谎|骗人|欺骗|不诚实|不说实话|假话/,
        /隐瞒|藏着|不承认|明明.*却说/
      ],
      weight: 3
    },
    school_refusal: {
      label: '拒绝上学',
      category: 'avoidance',
      legacy: 'avoidance',
      keywords: [
        /不去上学|不想去学校|拒绝上学|不肯去学校/,
        /装病.*学校|逃学|害怕上学|抗拒上学/
      ],
      weight: 4
    },
    anxiety_worry: {
      label: '焦虑担忧',
      category: 'emotional',
      legacy: 'emotional',
      keywords: [
        /焦虑|担心|害怕|恐惧|紧张|不安|睡不着|失眠/,
        /总是想|反复问|一直担心|怕.*发生|觉得.*不好/
      ],
      weight: 3
    },
    attention_issues: {
      label: '注意力问题',
      category: 'control',
      legacy: 'control',
      keywords: [
        /注意力|开小差|不专注|专注力|坐不住|多动|好动|ADHD/,
        /分心|不集中|走神|无法长时间/
      ],
      weight: 3
    },
    sibling_conflict: {
      label: '手足冲突',
      category: 'emotional',
      legacy: 'emotional',
      keywords: [
        /打弟弟|打妹妹|欺负弟弟|欺负妹妹|跟弟弟|跟妹妹/,
        /二宝|老大.*老二|兄弟姐妹.*吵|手足/
      ],
      weight: 2
    }
  },

  analyze(input, history) {
    history = history || [];
    const scores = {};
    const matchedWords = {};

    for (const [pattern, config] of Object.entries(this.PATTERNS)) {
      let score = 0;
      const words = [];
      for (const regex of config.keywords) {
        const m = input.match(regex);
        if (m) { score += config.weight; words.push(m[0]); }
      }
      if (score > 0) { scores[pattern] = score; matchedWords[pattern] = words; }
    }

    // Rank
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const primary = ranked.length > 0 ? ranked[0][0] : this._fallback(input);
    const secondary = ranked.length > 1 ? ranked[1][0] : null;

    // Legacy category (for backward compat with retention module)
    const legacyType = this.PATTERNS[primary] ? this.PATTERNS[primary].legacy : 'emotional';

    // Key phrase extraction
    const keyPhrase = this._extractKeyPhrase(input);

    // History context
    const historyCtx = this._buildHistoryContext(history, primary);

    // Tags
    const tags = [
      this.PATTERNS[primary] ? this.PATTERNS[primary].label : null,
      this.PATTERNS[primary] ? this.PATTERNS[primary].category : null,
      secondary && this.PATTERNS[secondary] ? this.PATTERNS[secondary].label : null
    ].filter(Boolean);

    return {
      primary,
      secondary,
      legacyType,
      scores,
      matchedWords,
      keyPhrase,
      tags,
      historyCtx,
      raw_input: input
    };
  },

  _fallback(input) {
    if (/学|书|功课|成绩|作业/.test(input)) return 'homework_conflict';
    if (/手机|游戏/.test(input)) return 'phone_addiction';
    if (/哭|难过|委屈/.test(input)) return 'emotional_sensitive';
    if (/打人|攻击/.test(input)) return 'aggression';
    return 'emotional_explosion';
  },

  _extractKeyPhrase(input) {
    const t = input.trim();
    if (t.length <= 28) return t;
    // Look for natural break
    const firstPart = t.slice(0, 35);
    const breakIdx = firstPart.search(/[，。！？,!?]/);
    if (breakIdx > 4) return firstPart.slice(0, breakIdx);
    return t.slice(0, 26) + '…';
  },

  _buildHistoryContext(history, currentPrimary) {
    if (!history || history.length === 0) return null;
    const prevPatterns = history.map(h => h.analysis && h.analysis.primary).filter(Boolean);
    const recurring = prevPatterns.filter(p => p === currentPrimary).length;
    return {
      sessions: history.length,
      is_recurring: recurring > 0,
      recurring_count: recurring,
      last_input: history[history.length - 1].input || null,
      days_since_last: this._daysSince(history[history.length - 1].timestamp)
    };
  },

  _daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  }
};

/* ================================================================
   行为推理引擎 V2 — Why Layer（增量新增，不替换任何现有逻辑）
================================================================ */
const BehaviorReasoningEngine = {

  // 12类行为的深层原因数据库
  WHY_LAYER: {
    emotional_explosion: {
      reason_hypothesis: [
        '情绪调节能力的发育滞后于情绪感知能力——孩子感受到了，但还没有足够的工具来处理这种强度',
        '当天的情绪爆发通常不是因为眼前这件事，而是多个压力积累后的"最后一根稻草"',
        '催促、否定、比较等特定语言模式会显著压低孩子的情绪承受阈值',
        '身体状态（疲劳、饥饿、睡眠不足）会大幅削弱情绪调节能力'
      ],
      trigger_chain: ['感受到压力或被否定', '情绪强度超过当前承受上限', '前额叶调节功能临时关闭', '以外化爆发释放内部积压'],
      family_factors: [
        '家庭中"催促-评判-比较"语言的使用密度',
        '孩子是否有安全的空间来表达不舒服的感受',
        '家长在孩子爆发时自身的情绪稳定程度'
      ]
    },
    emotional_sensitive: {
      reason_hypothesis: [
        '神经系统天生对情绪信号更敏锐——同样的刺激，他感受到的强度可能是同龄人的两三倍',
        '敏感孩子的共情能力通常很强，但情绪调节资源消耗也快',
        '长期感到"感受不被理解"，会让已有的情绪更难消化'
      ],
      trigger_chain: ['接收到情绪刺激', '感受强度显著高于普通孩子', '情绪调节系统超载', '以哭泣或情绪化反应释放'],
      family_factors: ['家庭成员对孩子情绪表达的接受程度', '孩子的感受是否经常被认可或被否定', '家庭气氛的整体情绪安全感']
    },
    homework_conflict: {
      reason_hypothesis: [
        '孩子把"作业"和"被控制"画上了等号——抵抗的是被掌控的感觉，不是作业本身',
        '频繁催促制造了"外部控制"模式，孩子无法发展出内在自驱力',
        '可能在某个科目遭遇了真实的学习困难，但还没有被识别和支持到',
        '缺乏对"为什么要做作业"的内在意义感，只有外部压力在推动'
      ],
      trigger_chain: ['被要求做作业', '感受到"必须做"的控制压力', '自主需求被压制，产生抵触', '以拖延或发脾气作为抵抗策略'],
      family_factors: ['关于学习的沟通模式（命令式 vs 对话式）', '孩子在学习中获得的成就感和正向反馈是否充足', '作业是否成为家庭冲突的主要战场']
    },
    autonomy_resist: {
      reason_hypothesis: [
        '孩子正处于发展独立意志的关键发育期，对控制的敏感度自然升高',
        '长期过度管控积累的自主需求缺口，以对抗方式集中释放',
        '孩子发现"对抗"是唯一能让成人看见自己意志的有效方式'
      ],
      trigger_chain: ['接收到指令或否定', '自主需求被压制', '感受到主体性的丧失', '以对抗行为重建主体感'],
      family_factors: ['家庭决策中孩子的参与程度', '家长给予的选择权和自主空间', '"孩子应该听话"的隐性信念是否主导日常互动']
    },
    phone_addiction: {
      reason_hypothesis: [
        '现实生活中获得即时成就感和掌控感的渠道不足，屏幕填补了这个空缺',
        '游戏或视频提供了现实中稀缺的三样东西：即时反馈、明确规则、可控结果',
        '可能在用屏幕回避某种现实中的困难或情绪',
        '线上社交满足了部分同伴关系需求，说明现实社交有未被满足的部分'
      ],
      trigger_chain: ['现实中成就感/掌控感/社交满足不足', '发现屏幕能即时满足这些需求', '大脑形成强烈的"屏幕=奖赏"连接', '任何打断都被感知为剥夺，引发抵抗'],
      family_factors: ['现实活动中孩子成就感的来源是否充足', '亲子共同活动的质量和频率', '家长自身的屏幕使用习惯（模仿效应）']
    },
    withdrawal: {
      reason_hypothesis: [
        '内心承受的压力已超过可以表达的上限，沉默是唯一可用的保护策略',
        '过去表达感受的尝试没有得到安全的回应，所以选择不再尝试',
        '可能在学校或社交环境中遭遇了不知道如何处理的事情',
        '青春期前后孩子会自然增加内在世界的保护意识，这是发育的正常阶段'
      ],
      trigger_chain: ['遭遇无法处理的压力或情绪', '评估表达是不安全的或无效的', '启动自我保护机制', '以沉默和回避管理内部状态'],
      family_factors: ['家庭中情绪表达是否真的安全', '孩子过去开口时是否得到过被真正听见的体验', '家长是否有"追问"习惯，让孩子更倾向于封闭']
    },
    aggression: {
      reason_hypothesis: [
        '攻击是孩子当前情绪调节能力范围内最直接的释放方式，不是选择，是能力边界',
        '可能观察到家庭或环境中的攻击性行为模式，进行了无意识的模仿',
        '被欺负或被不公平对待，没有得到支持，愤怒转化为向外攻击',
        '缺乏用语言表达强烈感受的词汇和技能，身体成了唯一的表达渠道'
      ],
      trigger_chain: ['遭遇强烈负面情绪（愤怒、委屈、嫉妒）', '没有合适的情绪表达工具', '情绪积累到临界点', '以身体攻击作为最直接的释放出口'],
      family_factors: ['家庭中是否存在惩罚性体罚或情绪化处理方式', '孩子在家庭中学到的"愤怒应对"模型', '对孩子强烈情绪表达的接纳程度']
    },
    lying: {
      reason_hypothesis: [
        '说实话的预期后果（批评、惩罚、失望）在孩子评估中代价太大',
        '孩子正在测试"谎言能否奏效"，这是认知发展的一个正常阶段',
        '可能存在对某件事的羞耻感，谎言是保护这种羞耻感不被暴露的屏障',
        '撒谎是孩子在有限能力范围内管理关系期待的一种策略'
      ],
      trigger_chain: ['预期说真话会引发不希望的后果', '评估撒谎的代价小于说真话', '选择谎言作为保护策略', '被发现后诚实的空间进一步缩小，谎言的频率可能升高'],
      family_factors: ['家庭对失败和错误的容忍度', '孩子承认错误后通常得到的反应', '家庭中是否存在"说真话很危险"的隐性规则']
    },
    school_refusal: {
      reason_hypothesis: [
        '在学校持续经历负面体验（学业压力、同伴关系困难、被批评），已超过承受上限',
        '分离焦虑：担心离开家后家里会发生什么',
        '学业上已经严重跟不上，上学等于每天面对失败的感觉',
        '被同伴排斥或霸凌，但还没有开口告诉任何大人'
      ],
      trigger_chain: ['在学校遭遇持续的痛苦体验', '痛苦超过可承受的阈值', '身体产生焦虑躯体化症状（肚子痛、头痛）', '以拒绝上学来回避痛苦来源'],
      family_factors: ['家庭对孩子学业表现的期待压力', '孩子是否有过把学校困难告诉家长并得到帮助的经历', '亲子沟通渠道是否足够畅通和安全']
    },
    anxiety_worry: {
      reason_hypothesis: [
        '大脑的警觉系统对潜在危险过于敏感，对实际上安全的事也发出过度警报',
        '可能在过去经历了某个失控的事件，形成了"坏事随时会发生"的焦虑模式',
        '家庭氛围中的不确定性或持续紧张感被孩子内化',
        '高成就期待带来的持续表现焦虑'
      ],
      trigger_chain: ['感知到（真实或想象的）潜在威胁', '大脑过度激活警觉系统', '身体产生焦虑生理反应', '通过反复问、回避或无法入睡来尝试控制焦虑'],
      family_factors: ['家庭中对不确定性和失败的整体态度', '孩子是否感受到足够的安全感和稳定感', '家长自身的焦虑水平（焦虑有代际传递效应）']
    },
    attention_issues: {
      reason_hypothesis: [
        '大脑执行功能（注意力调节、冲动控制）的发育差异——不是意志力问题，是神经层面的不同',
        '学习内容与孩子的认知风格不匹配，导致无法维持兴趣和专注',
        '睡眠不足、饮食不规律等身体因素在持续影响注意力质量',
        '焦虑或情绪问题正在消耗大量认知资源，所以"没有多余的注意力"用于专注'
      ],
      trigger_chain: ['面对需要持续注意力的任务', '大脑执行功能无法维持足够专注', '注意力被内部或外部刺激劫持', '表现为开小差、坐不住或任务无法完成'],
      family_factors: ['学习环境的感官干扰程度', '任务结构是否适合孩子的注意力模式', '家庭对孩子注意力问题的理解方式（懒 vs 神经差异）']
    },
    sibling_conflict: {
      reason_hypothesis: [
        '父母的注意力和情感资源被孩子感知为"有限且在竞争中"，争夺是本能反应',
        '老大的地位感在二宝出生后受到冲击，这个情感变化可能从未被充分处理',
        '孩子之间的冲突有时是对家庭中其他关系紧张的间接反应',
        '兄弟姐妹间解决冲突所需的谈判和妥协技能，孩子还在学习中'
      ],
      trigger_chain: ['感到父母注意力/资源/公平感受到威胁', '通过冲突向父母"展示"需求或获取关注', '或通过攻击释放积累的嫉妒和委屈', '父母介入强化了"冲突能带来关注"的模式'],
      family_factors: ['父母的时间和关注如何在孩子之间分配', '每个孩子是否有足够的"独有时间"', '家庭的"公平"叙事是否真正符合各自的需求']
    }
  },

  // 生成可读的"为什么会这样"段落
  generateWhyParagraph(primary, keyPhrase) {
    const data = this.WHY_LAYER[primary];
    if (!data) return null;
    const reasons = data.reason_hypothesis.slice(0, 2);
    const chainText = data.trigger_chain.join(' → ');
    return {
      mainReason: reasons[0],
      secondReason: reasons[1] || null,
      chainText,
      familyFactors: data.family_factors.slice(0, 2)
    };
  },

  // 完整原因数据（用于 full-report）
  getFullWhyData(primary) {
    return this.WHY_LAYER[primary] || this.WHY_LAYER.emotional_explosion;
  }
};

/* ================================================================
   趋势分析器 V2 — 基于 MemorySystem（增量新增）
================================================================ */
const TrendAnalyzer = {

  analyze(userId) {
    const all = MemorySystem.getAll(userId);
    if (!all.length) return null;

    // 频率统计
    const freq = {};
    all.forEach(m => {
      const p = m.analysis && m.analysis.primary;
      if (p) freq[p] = (freq[p] || 0) + 1;
    });
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const dominant = sorted[0] ? sorted[0][0] : null;
    const dominantCount = sorted[0] ? sorted[0][1] : 0;

    // 检测最近3条是否重复
    const repeat = MemorySystem.detectRepeatPattern(userId, 3);

    // 风险等级
    let riskLevel = 'low';
    if (all.length >= 3 && repeat.detected) riskLevel = 'medium';
    if (all.length >= 5 && repeat.detected && dominantCount >= 3) riskLevel = 'high';

    // 趋势判断
    let trend = 'new';
    let trendText = '';
    const dominantLabel = dominant && AnalysisEngine.PATTERNS[dominant]
      ? AnalysisEngine.PATTERNS[dominant].label : '';

    if (all.length < 2) {
      trend = 'new';
      trendText = '';
    } else if (repeat.detected) {
      trend = 'recurring';
      trendText = `最近的记录里，「${dominantLabel}」反复出现了 ${repeat.count} 次——这不再是偶发事件，而是一个孩子固定的应对模式。`;
    } else if (dominantCount >= 2 && sorted.length >= 1) {
      trend = 'concentrated';
      trendText = `在 ${all.length} 次记录中，「${dominantLabel}」出现最多（${dominantCount}次），这是孩子目前最主要的应对方式。`;
    } else {
      trend = 'varied';
      trendText = `孩子的行为模式比较多样，没有明显单一的重复倾向——每次都在用不同的方式应对当下的处境。`;
    }

    // 模式总结（仅多次用户）
    const patternSummary = this._buildPatternSummary(all, dominant, dominantCount, repeat, dominantLabel);

    return {
      trend,
      trendText,
      dominantPattern: dominant,
      dominantCount,
      repeatPatternDetected: repeat.detected,
      riskLevel,
      patternSummary,
      totalSessions: all.length,
      behaviorTrend: trend
    };
  },

  _buildPatternSummary(all, dominant, dominantCount, repeat, dominantLabel) {
    const n = all.length;
    if (n <= 1) return null;

    if (repeat.detected) {
      return `在最近 ${n} 次的记录里，孩子持续出现「${dominantLabel}」类行为。这不是单次偶发，而是一个固定的应对模式——说明背后可能有某种长期未被解决的深层需求，单次的"处理"很难根本改变这个模式。`;
    }
    if (dominantCount >= 2) {
      return `在 ${n} 次记录中，「${dominantLabel}」出现了 ${dominantCount} 次，是最主要的行为模式。孩子在面对压力时有相对固定的应对倾向，这个模式是理解他的重要线索。`;
    }
    return `在 ${n} 次记录中，孩子展现了多种不同的行为模式——说明他在用不同的方式应对不同的情境，没有明显单一的固定应对倾向。`;
  }
};

/* ================================================================
   内容库 (Content Library)
================================================================ */
const ContentLibrary = {

  // 轻报告内容 (light-report.html 使用)
  lightReport(analysis) {
    const { primary, keyPhrase, historyCtx, raw_input } = analysis;
    const db = this.DB[primary] || this.DB.emotional_explosion;
    const patternMeta = AnalysisEngine.PATTERNS[primary];

    // 标题嵌入用户原话
    const heading = db.heading_tpl
      .replace(/\$\{keyPhrase\}/g, keyPhrase)
      .replace(/\$\{input\}/g, raw_input.slice(0, 40));

    // 洞察嵌入用户原话
    const insight = db.insight_tpl
      .replace(/\$\{keyPhrase\}/g, keyPhrase)
      .replace(/\$\{input\}/g, raw_input.slice(0, 40));

    // 历史感知提示
    let historyNote = null;
    if (historyCtx && historyCtx.is_recurring && historyCtx.recurring_count >= 1) {
      historyNote = `这已经不是第一次出现类似情况了——这个模式值得深入理解。`;
    } else if (historyCtx && historyCtx.sessions > 0) {
      historyNote = `结合你之前描述的情况来看，今天这个行为有它自己的背景。`;
    }

    // V2：行为原因段落（Why Layer）
    const whyParagraph = (typeof BehaviorReasoningEngine !== 'undefined')
      ? BehaviorReasoningEngine.generateWhyParagraph(primary, keyPhrase)
      : null;

    return {
      heading,
      body: db.body,
      insight,
      historyNote,
      label: patternMeta ? patternMeta.label : '行为分析',
      category: patternMeta ? patternMeta.category : 'emotional',
      whyParagraph  // V2 新增
    };
  },

  // 完整报告内容 (full-report.html 使用)
  fullReport(analysis) {
    const { primary, keyPhrase, historyCtx, raw_input } = analysis;
    const db = this.DB[primary] || this.DB.emotional_explosion;
    const patternMeta = AnalysisEngine.PATTERNS[primary];

    const structBody = db.struct_body
      .replace(/\$\{keyPhrase\}/g, keyPhrase)
      .replace(/\$\{input\}/g, raw_input.slice(0, 50));

    // 历史感知开场白
    let historyIntro = null;
    if (historyCtx) {
      const n = historyCtx.sessions;
      if (n >= 2 && historyCtx.is_recurring) {
        historyIntro = `你已经第 ${n + 1} 次来描述孩子的行为了。「${keyPhrase}」这类情况反复出现，说明背后有更深的结构性原因——单次处理很难彻底解决，需要理解整个模式。`;
      } else if (n >= 1) {
        historyIntro = `这是你第 ${n + 1} 次记录孩子的行为。每一次描述都在帮助我们更完整地看见这个孩子。`;
      }
    }

    // V2：完整 Why Layer 数据
    const whyData = (typeof BehaviorReasoningEngine !== 'undefined')
      ? BehaviorReasoningEngine.getFullWhyData(primary)
      : null;

    return {
      structHeading: db.struct_heading,
      structBody,
      misconceptions: db.misconceptions,
      advice: db.advice.map(a => ({
        ...a,
        text: a.text.replace(/\$\{keyPhrase\}/g, keyPhrase)
      })),
      historyIntro,
      label: patternMeta ? patternMeta.label : '行为分析',
      shareSummary: db.share_summary.replace(/\$\{keyPhrase\}/g, keyPhrase),
      whyData  // V2 新增
    };
  },

  DB: {

    emotional_explosion: {
      heading_tpl: '「${keyPhrase}」背后，是孩子的感受系统在超载',
      body: '孩子激烈的情绪反应，不是"无理取闹"，而是一个过载信号。情绪调节能力是大脑前额叶负责的——而前额叶在25岁才发育完全。孩子现在的爆发，是他用目前有限的神经资源在应对一个超过承载上限的时刻。',
      insight_tpl: '你看到的是「${keyPhrase}」，但孩子在说：我现在的感受超过我能承受的了，我需要你帮我，而不是要求我立刻停下来。',
      struct_heading: '情绪爆发是一个"超载"现象，不是态度问题',
      struct_body: '你描述的「${keyPhrase}」，呈现的是「情绪触发 → 感受积累 → 超过承载 → 外化表现」这个完整过程。某个具体的触发点（催促、比较、被否定）引发了强烈感受，而孩子还没有足够的工具来调节，所以"爆炸"了。这不是道德问题，是神经发育阶段的正常挑战。',
      misconceptions: [
        { wrong: '他是故意激怒我的', right: '孩子情绪爆发时，前额叶几乎关闭——他没有能力"故意"，他只是被情绪淹没了' },
        { wrong: '太脆弱了，要锻炼抗压', right: '情绪敏感是特质不是弱点；强制压制不会让他更坚强，反而会让情绪调节更难' },
        { wrong: '道歉认错了就没事了', right: '如果触发原因没被理解，下次同样的触发点还会引发同样的反应' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '情绪爆发期间不讲道理——这时大脑无法接收。先说："我看到你很难受了。"确认感受，不评判行为。',
          example: '"你现在一定很不好受。我在这里。"'
        },
        {
          tag: '怎么做',
          text: '等情绪平复后（15–30分钟）再处理事情。在孩子平静后找安静时刻坐下来聊，不在爆发当场谈原则。',
          example: '孩子平静后："刚才发生了什么？你能告诉我吗？"'
        },
        {
          tag: '调整环境',
          text: '减少"催促-评判-比较"的语言密度。每减少一个触发点，就减少一次爆发的可能。',
          example: '把"你怎么还没做"换成"今天作业什么时候想开始？"'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我现在的感受超过了我能承受的，我需要被看见。'
    },

    emotional_sensitive: {
      heading_tpl: '「${keyPhrase}」——这不是脆弱，是感受更深',
      body: '有些孩子的神经系统天生对情绪信号更敏感——他们感受到的比别人更强烈、也更快。这不是弱点，而是一种特质。情绪敏感的孩子往往共情能力强、洞察力深，只是在学习如何驾驭自己强烈的感受系统。',
      insight_tpl: '「${keyPhrase}」不是矫情，是他的感受系统在接收一个对他来说很真实的信号——你看到的强度和他感受到的强度不在同一个量级。',
      struct_heading: '敏感的孩子感受更深，需要更多被"看见"',
      struct_body: '你描述的「${keyPhrase}」，背后是这样的机制：同样的刺激，敏感的孩子感受到的情绪强度可能是普通孩子的两三倍。他们的情绪调节系统还在发育，对这种强度的感受还没有足够的缓冲能力。他不是不知道可以不哭——他是控制不住。',
      misconceptions: [
        { wrong: '太矫情了，要锻炼一下', right: '强迫敏感的孩子"坚强"，往往让他们学会压抑而不是调节，长期反而更难' },
        { wrong: '哭太多了，要管一管', right: '哭是情绪释放的方式；允许他哭完，比强迫他停止更有助于情绪调节' },
        { wrong: '就这点事值得这么难过吗', right: '以你的标准衡量他的感受，会让他更难开口表达——他需要被理解，不是被评判' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '先验证感受，再讨论事情。"你现在很难受"比"不要哭了"更有效——验证感受会加速情绪平复。',
          example: '"我知道这件事对你来说很难受。告诉我发生了什么。"'
        },
        {
          tag: '怎么做',
          text: '帮他建立"情绪词汇表"。很多孩子不是不想表达，是不知道怎么说自己的感受。一起练习命名情绪。',
          example: '平静时一起看情绪卡，或问"你现在肚子里是什么感觉？"'
        },
        {
          tag: '调整环境',
          text: '减少感官或情绪的突然变化。敏感的孩子需要更多过渡时间，而不是突然的要求。',
          example: '提前10分钟说"再玩10分钟我们要收拾了"，而不是突然叫停。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我的感受是真实的，我需要你相信我，不是要我立刻停下来。'
    },

    homework_conflict: {
      heading_tpl: '「${keyPhrase}」——作业冲突往往不是关于作业的',
      body: '孩子对作业的抵触，表面是拖延或发脾气，背后往往是控制感的丧失。频繁催促本身就是压力来源——孩子越被催，情绪系统越紧张，越难进入专注状态。当孩子把"写作业"和"被强迫"画上等号，他抵抗的就不是作业本身，而是"被控制"的感觉。',
      insight_tpl: '「${keyPhrase}」的背后，孩子在说：我也想把作业做完，但我需要感觉这是我自己的决定，不是被逼的。',
      struct_heading: '作业冲突的本质是自主权争夺，不是懒惰',
      struct_body: '你描述的「${keyPhrase}」，背后是这样的动态：催促 → 孩子感受到控制 → 产生抵抗 → 家长加大压力 → 更强的抵抗。这个循环每次都在强化孩子把"作业"和"冲突"绑定的神经连接。要打破这个循环，需要先打破"催促-抵抗"的节奏。',
      misconceptions: [
        { wrong: '他就是懒，不想努力', right: '抵触往往发生在孩子感到被掌控、没有选择权的时候；给选择权，动力会自然出现' },
        { wrong: '不催就不做，必须盯着', right: '越盯越形成依赖——孩子学不到自我管理，只学到"有人催才做"' },
        { wrong: '作业是他的事，他应该主动', right: '自主学习能力是逐步培养的；需要帮他建立结构，而不是只要求结果' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '把命令变成选择题。"今天要完成作业"是不变的，但"几点开始"和"什么顺序"可以由他决定。',
          example: '"作业今晚要做完，你想8点还是8点半开始？先做语文还是数学？"'
        },
        {
          tag: '怎么做',
          text: '建立固定的"作业时段"而不是"催写作业"。孩子知道固定时间，就不会觉得被随时打断和控制。',
          example: '饭后30分钟固定是安静学习时间，不催、不问、不打扰。'
        },
        {
          tag: '调整环境',
          text: '减少催促，增加事前约定。让孩子自然承担没完成的后果，比催一百次更有效。',
          example: '约定好：作业是他的责任，你不再催，但他需要在睡前自己完成。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我需要感觉这是我自己的决定，不是被逼的。'
    },

    autonomy_resist: {
      heading_tpl: '「${keyPhrase}」——他不是在对抗你，他在争取被当作"一个人"',
      body: '孩子的不听话背后，是自主需求发出的强烈信号。他正处于发展独立意志的关键期，频繁被否定、被替代决策，会积累挫败感，最终以对抗形式爆发。这不是叛逆，这是他在说：我也是一个有想法的人。',
      insight_tpl: '「${keyPhrase}」不是态度问题，是需求信号。他对抗的是"被要求"的感觉，不是你这个人。',
      struct_heading: '自主冲突的本质："我需要有权利决定我自己的事"',
      struct_body: '你描述的「${keyPhrase}」，背后是自主需求长期被压制后的爆发。孩子的心理发展有一个核心任务：建立"我是一个有能力、有意志的人"的自我认知。当这个需求被反复压制，他会用最原始的方式——对抗——来重新找回主体感。',
      misconceptions: [
        { wrong: '太叛逆了，要更严管', right: '更严管通常带来更强的抵抗；给予更多自主权，反而会减少对抗' },
        { wrong: '他在故意气我', right: '孩子的对抗是对"被控制感"的反应，不是对你个人的攻击' },
        { wrong: '他不成熟，还没资格做决定', right: '允许他做小决定，是帮他练习做大决定的能力；不给机会，能力就无法发展' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '减少命令句，增加选择题和征询意见。"你怎么看？""你想怎么做？"给他表达意见的空间。',
          example: '"今天的计划你觉得合理吗？有什么想改的？"'
        },
        {
          tag: '怎么做',
          text: '在安全范围内让他自己做决定，并承担结果。哪怕做了"错"的选择，这个过程对成长的价值远超你帮他做"对"的选择。',
          example: '他坚持不穿外套出门，就让他去——冷了他会知道，比你说一百遍更有效。'
        },
        {
          tag: '调整环境',
          text: '数一数一天里给了孩子多少个指令。尝试每天减少30%，把那些指令换成问题或邀请。',
          example: '少说"去做"，多说"你准备怎么做"。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我需要被当作一个有想法的人来对待。'
    },

    phone_addiction: {
      heading_tpl: '「${keyPhrase}」——屏幕是孩子找到的"可控的世界"',
      body: '孩子沉迷手机或游戏，背后往往是现实中某种需求没有被满足。游戏世界给了孩子三样现实里稀缺的东西：即时的成就感、明确的规则、可以掌控的结果。当现实中这些体验太少，数字世界就变成了最安全的避风港。',
      insight_tpl: '「${keyPhrase}」的背后，孩子不是在逃避你，他是在寻找一个他能掌控、能得到反馈、能感受到成就的地方。',
      struct_heading: '沉迷屏幕是"现实满足不足"的信号',
      struct_body: '你描述的「${keyPhrase}」，背后是这个机制：现实中缺乏足够的成就感/掌控感/社交满足 → 游戏/视频完美填补这些需求 → 大脑形成强烈的"奖赏-期待"连接 → 任何打断都引发强烈抵抗。简单的限制不能解决根本问题，需要在现实中提供替代性的满足。',
      misconceptions: [
        { wrong: '他就是懒，整天知道玩手机', right: '他在游戏里得到了成就感——说明他有成就需求，只是出口错了' },
        { wrong: '强行没收手机就好了', right: '没收手机解决不了他对成就感和掌控感的需求，压力会找其他出口' },
        { wrong: '玩游戏是因为没管好', right: '屏幕设计的精密程度远超大人的意志力，这不是管教失败，是需要策略' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '不要把屏幕时间变成战场。先理解他在游戏里得到了什么，再找现实中能提供相似体验的方式。',
          example: '"你最喜欢游戏里的哪部分？成就感？剧情？跟朋友一起玩？"'
        },
        {
          tag: '怎么做',
          text: '协商一个双方都能接受的屏幕时间规则，让他参与制定。他帮助制定的规则，他更愿意遵守。',
          example: '"我们来制定一个屏幕时间计划，你说你的想法，我说我的，我们一起定。"'
        },
        {
          tag: '调整环境',
          text: '在现实中增加能给他带来成就感的活动：运动、搭建类、烹饪、手工——任何有"完成感"的事。提供替代，比限制更有效。',
          example: '找到他在游戏外的一个兴趣，每周固定一次，认真参与。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我在这里找到了一个我能掌控、能被认可的世界。'
    },

    withdrawal: {
      heading_tpl: '「${keyPhrase}」——沉默是孩子在保护自己',
      body: '当孩子选择沉默、回避或把自己关起来，这不是冷漠，而是一种自我保护机制。他在用能力范围内唯一可行的方式调节超过承载极限的压力。在这种状态下，追问往往只会让他更封闭。',
      insight_tpl: '「${keyPhrase}」不是冷漠，而是在说：我现在没有能力处理更多了，我需要先喘口气。',
      struct_heading: '回避是孩子保护自己的方式，说明现实压力已超载',
      struct_body: '你描述的「${keyPhrase}」，背后是孩子的自我保护系统在启动。人在感到威胁或超载时，有两种原始反应：攻击（fight）或回避（flight）。你的孩子选择了回避，说明他在管理一种他还不知道怎么面对的压力或情绪。追问在他关闭状态下只会让他更封闭；等待比追问更有效。',
      misconceptions: [
        { wrong: '他是在生我的气，故意不理我', right: '沉默更多是在管理自己的内部状态，不是针对你的惩罚' },
        { wrong: '追问一定能让他开口', right: '追问在他关闭状态下只会让他更封闭；等待比追问更有效' },
        { wrong: '不说话就是没事', right: '越沉默的孩子往往在内心撑得越久；安静不等于没有困难' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '不追问，降低压力。"我就在这里，你准备好了随时可以来找我。"这句话本身就是支持。',
          example: '"我不知道发生了什么，但我在。你想说的时候我一直在。"'
        },
        {
          tag: '怎么做',
          text: '建立"并肩时光"：不谈正事，只是在一起做些轻松的事。孩子通常在没有压力的活动中更容易开口。',
          example: '一起散步、做饭、看他喜欢的节目——不提学习、不谈冲突，就只是在一起。'
        },
        {
          tag: '调整环境',
          text: '审视孩子生活里的压力来源：学业期待、家庭气氛、同伴关系。减少一个压力源，比问一百次"你怎么了"更有效。',
          example: '问老师：孩子在学校状态怎么样？有没有不开心的迹象？'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我现在承受不了更多了，我需要先保护自己。'
    },

    aggression: {
      heading_tpl: '「${keyPhrase}」——攻击行为是孩子还没找到出口的求救信号',
      body: '孩子的攻击行为，不论是打人、踢人还是破坏物品，背后都有一个没有被处理的强烈情绪。攻击不是孩子的"本性"，而是他目前能找到的最快速的情绪释放方式。他需要的是学会新的出口，而不只是被禁止使用旧的出口。',
      insight_tpl: '「${keyPhrase}」背后，孩子不是坏，他是在用身体语言说一件他还不知道怎么用语言表达的事。',
      struct_heading: '攻击行为是"强烈情绪 + 技能缺口"的叠加，不是品性问题',
      struct_body: '你描述的「${keyPhrase}」，背后是两个层次：第一，有强烈情绪需要释放（愤怒、挫败、委屈、嫉妒）；第二，缺少合适的情绪释放技能。攻击是他在这两个条件下的"自然"选择，而不是道德选择。惩罚可以短期压制行为，但不能教会他新的处理方式。',
      misconceptions: [
        { wrong: '他天生就有攻击性，管不了', right: '攻击行为是可以改变的——需要情绪技能教育，不是单纯惩罚' },
        { wrong: '打回去他就知道疼了', right: '用攻击回应攻击，会教会孩子"强者可以用武力解决问题"' },
        { wrong: '不打他他就变本加厉', right: '惩罚可以短期压制，但不能教会他新的情绪处理方式；两者都需要' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '等他平静后，讨论"感受"而不是"行为"。"你当时是什么感觉？"比"你怎么能打人"更能找到根源。',
          example: '"你刚才打了人，我需要先处理这件事。但我也想知道，你当时是什么感觉？"'
        },
        {
          tag: '怎么做',
          text: '教他在情绪爆发前的安全出口：用力踩地板、抱枕头打、大声跑圈。先有出口，才能减少攻击。',
          example: '和孩子一起设计"发火规则"：可以踢枕头、可以出去走走、不可以打人。'
        },
        {
          tag: '调整环境',
          text: '找出触发攻击的规律性情境（和谁在一起？什么时间？什么事情之前？），针对性减少触发源。',
          example: '记录一周攻击发生的时间和情境，你会发现规律。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我有一种强烈的感受找不到出口，我需要学会怎么表达它。'
    },

    lying: {
      heading_tpl: '「${keyPhrase}」——孩子撒谎，通常是因为说真话有代价',
      body: '孩子说谎，最常见的原因不是"坏"，而是"说实话的后果太可怕了"。当孩子预期说真话会被批评、惩罚、或引发强烈的情绪，他就会选择撒谎来避免这些后果。撒谎背后的问题，往往不是诚信，而是安全感。',
      insight_tpl: '「${keyPhrase}」背后孩子在做一个计算："说实话的代价"和"撒谎的代价"哪个更小——改变这个等式，比只加大撒谎代价更有效。',
      struct_heading: '撒谎是孩子在保护自己，说明说真话不够安全',
      struct_body: '你描述的「${keyPhrase}」，背后是一个风险评估：孩子在撒谎之前做了一个无意识的计算："说实话的代价" vs "撒谎的代价"。当说实话的代价更大，他就撒谎。要改变撒谎行为，需要改变这个等式，而不是只加大撒谎的代价。',
      misconceptions: [
        { wrong: '他从小就爱撒谎，这是品性问题', right: '撒谎是策略，不是品格；改变环境，策略就会改变' },
        { wrong: '抓住一次就要严肃处理', right: '过度严厉的处罚会让孩子更会撒谎，不是更诚实' },
        { wrong: '他撒谎说明不信任我', right: '他撒谎说明他在意你的反应——只是用了错误的方式来管理这种在意' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '建立"说实话有保障"的承诺。"不管发生了什么，你告诉我实情，我不会马上生气。"先保证安全，才能打开真话。',
          example: '"如果你告诉我实话，我保证先听完再说话，不立刻批评你。"'
        },
        {
          tag: '怎么做',
          text: '当孩子说了实话（即使承认了错误），先感谢他的诚实，再处理事情。"谢谢你告诉我"比立刻批评更能鼓励下次的诚实。',
          example: '"谢谢你告诉我这件事。我知道这不容易说。我们来想想怎么处理。"'
        },
        {
          tag: '调整环境',
          text: '减少让孩子觉得"说实话很危险"的情境：减少过度惩罚、减少情绪失控的反应、减少对失败的零容忍。',
          example: '当孩子做错事时，先说"没关系，我们来想想怎么解决"，而不是先批评。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我需要感觉说真话是安全的，然后我才能说真话。'
    },

    school_refusal: {
      heading_tpl: '「${keyPhrase}」——拒绝上学是孩子在告诉你学校有什么让他无法承受',
      body: '孩子拒绝上学，背后通常有一个真实的痛苦：可能是学业压力过大、同伴关系困难、对某个老师的恐惧、或者分离焦虑。"装病"或"不想去"的背后，是一个孩子在说：那个地方现在对我来说太难了。',
      insight_tpl: '「${keyPhrase}」背后，孩子不是在偷懒，而是在表达：学校里有什么东西正在让我很痛苦，我需要帮助。',
      struct_heading: '拒绝上学是信号，背后一定有具体的痛苦来源',
      struct_body: '你描述的「${keyPhrase}」，需要先找到具体的痛苦来源。拒绝上学通常有几种根源：学业层面（听不懂/跟不上/考试压力），社交层面（被孤立/被欺负/找不到朋友），关系层面（害怕某个老师/被批评），或者分离层面（担心家里发生什么）。每种来源的处理方式都不同。',
      misconceptions: [
        { wrong: '去了就好，硬逼他去', right: '强迫可以短期奏效，但不解决根源；如果根源是霸凌，强迫甚至会让情况更糟' },
        { wrong: '他是在找借口逃避', right: '真正的学校拒绝往往伴随生理症状（肚子痛、头痛）——这是真实的焦虑反应' },
        { wrong: '今天不去，以后更难去', right: '这是真的，但解决方式是找到痛苦来源并处理，不是只强迫出发' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '不问"为什么不想去"，问"学校里有什么不好的事吗？"开放性问题比追问更容易得到真实答案。',
          example: '"我注意到你最近不太想去学校。学校里发生了什么让你不舒服的事吗？"'
        },
        {
          tag: '怎么做',
          text: '主动联系班主任，了解孩子在学校的状态。孩子在家里说的和在学校的表现可能有很大出入。',
          example: '给老师发短信："孩子最近不太愿意来学校，能帮我观察一下他在班里的状态吗？"'
        },
        {
          tag: '调整环境',
          text: '在孩子去学校前，建立"今天结束后我们做一件好玩的事"的期待。让回家有期待，可以帮他撑过艰难的一天。',
          example: '"今天放学我们去吃你最喜欢的那家面，你在学校撑住，我在家等你。"'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：学校里有什么东西正在让我很痛苦，我需要你帮我。'
    },

    anxiety_worry: {
      heading_tpl: '「${keyPhrase}」——孩子的焦虑是真实的，不是无理取闹',
      body: '孩子的焦虑和担心，感受上和成人的焦虑一样真实，但他们缺少成人用来管理焦虑的认知工具。反复问同样的问题、对未知的事过度担心、睡前无法平静——这些都是焦虑的正常表现，而不是"不懂事"。',
      insight_tpl: '「${keyPhrase}」不是孩子在无理取闹，是他的焦虑系统在过度工作——他需要帮助学习如何与这种感受共处，而不是被要求"别想了"。',
      struct_heading: '焦虑是孩子的神经系统在过度保护他',
      struct_body: '你描述的「${keyPhrase}」，背后是焦虑的工作机制：大脑在预测未来的危险，并提前发出警报。孩子的焦虑系统还不够精准——他会对实际上安全的事情发出过度的警报。他不是不知道可以不担心，他是控制不了担心。',
      misconceptions: [
        { wrong: '别想那么多，没什么好担心的', right: '这个回应没有帮助——他不是不知道可以不担心，他是控制不了担心' },
        { wrong: '不理他，焦虑会自己过去', right: '忽视焦虑不会让它消失；被看见和被帮助才能让它减轻' },
        { wrong: '他的担心都是小事，不值得理会', right: '以你的标准评判他的恐惧，会让他更难开口——他需要被理解，不是被评判' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '先验证，再引导。"我知道你很担心这件事"比"你不用担心"更有帮助，因为它承认了他的感受是真实的。',
          example: '"我听到你了，这件事让你很担心。告诉我你担心什么会发生？"'
        },
        {
          tag: '怎么做',
          text: '一起做"担心的最坏情况"练习：说出最坏的情况，再讨论如果真的发生了我们会怎么做。让他看到自己有应对能力。',
          example: '"如果真的发生了你担心的事，我们会怎么办？一起想一个计划。"'
        },
        {
          tag: '调整环境',
          text: '建立睡前的"放松例行程序"：固定时间、固定活动（阅读/轻音乐/深呼吸）。可预测的环境会减少焦虑。',
          example: '每晚睡前固定：洗澡 → 读10分钟书 → 一句"今天你做得很好" → 关灯。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：我的担心是真实的，我需要你帮助我，而不是让我停止担心。'
    },

    attention_issues: {
      heading_tpl: '「${keyPhrase}」——注意力不集中，往往不是态度问题',
      body: '孩子注意力涣散或坐不住，最常见的原因是神经系统的发育差异，而不是懒或不努力。注意力的调节涉及大脑多个区域的协同工作，有些孩子这个系统发育相对慢一些，对这些孩子来说，专注需要消耗远比同龄人更多的能量。',
      insight_tpl: '「${keyPhrase}」背后，孩子不是不想专注，而是专注对他来说需要消耗远比普通孩子更多的能量——批评只会加重这个负担。',
      struct_heading: '注意力困难是神经系统差异，不是意志力问题',
      struct_body: '你描述的「${keyPhrase}」，背后是这样的机制：大脑的执行功能（专注、冲动控制、工作记忆）在这个孩子身上运作方式有所不同。这不是他能简单"努力"就能改变的——就像要求近视的孩子"努力看清楚"，要求本身就不合理。他玩游戏时能专注，是因为游戏专门设计来激活大脑奖赏系统，这是特殊情况，不能用来证明他"故意"。',
      misconceptions: [
        { wrong: '他玩游戏能专注，说明他能控制', right: '游戏设计针对大脑奖赏系统，是特殊情况；对其他事情分心不代表他"故意"' },
        { wrong: '批评他分心，他就会努力专注', right: '批评增加了焦虑，焦虑会进一步削弱注意力；适得其反' },
        { wrong: '他就是不努力', right: '对注意力有困难的孩子，"努力专注"消耗的能量可能是其他孩子的三倍' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '不批评"又分心了"，而是帮助他重新回来。"我注意到你走神了，深呼吸一下，从哪里继续？"',
          example: '"没关系，走神是会发生的。做三次深呼吸，我们再继续。"'
        },
        {
          tag: '怎么做',
          text: '使用"番茄工作法"变体：专注15分钟，休息5分钟，比要求长时间专注更有效。短任务+明确结束点，比开放性任务更容易完成。',
          example: '"我们定一个闹钟，15分钟后就停，先做这一段。"'
        },
        {
          tag: '调整环境',
          text: '减少学习环境中的干扰：手机放另一个房间、关掉通知、准备固定安静的学习空间。物理环境的改变比意志力要求更有效。',
          example: '学习时：手机放抽屉，关房门，准备一杯水和需要的文具，不要再起身取东西。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在说：专注对我来说比你想象的要消耗更多能量，我需要你帮助我找到方法。'
    },

    sibling_conflict: {
      heading_tpl: '「${keyPhrase}」——手足冲突背后，是对关注和公平的争夺',
      body: '兄弟姐妹之间的冲突，几乎是每个有两个以上孩子的家庭的常态。冲突背后通常有两个核心需求：一是对父母关注的竞争，二是对公平的强烈需求。孩子的"比较"意识在6-12岁达到高峰，这是发育阶段的特征。',
      insight_tpl: '「${keyPhrase}」的背后，孩子在问：你爱我和爱他一样多吗？我在你心里是不是同等重要的？',
      struct_heading: '手足冲突是资源（关注、公平、空间）竞争的外化',
      struct_body: '你描述的「${keyPhrase}」，是手足关系中正常张力的外化。每个孩子都需要感受到自己被父母独特地珍视，而不只是"孩子之一"。当这个需求没有被明确满足，他就通过冲突来争夺。手足关系中的很多冲突来自边界不清和对父母注意力的竞争。',
      misconceptions: [
        { wrong: '他们就是感情不好，改变不了', right: '手足关系是可以培养的；大多数成年后感情好的兄弟姐妹，小时候都打过架' },
        { wrong: '要一碗水端平，所有事情都要公平', right: '孩子需要的不是"一样"，而是"根据各自需求的恰当对待"；公平不等于相同' },
        { wrong: '老大就应该让着老小', right: '这对老大是不公平；老大有他的需求，不能因为年龄大就被要求无限退让' }
      ],
      advice: [
        {
          tag: '怎么说',
          text: '不在两个孩子面前"判决谁对谁错"——这只会激化竞争。分开谈，各自看见他的感受。',
          example: '单独和每个孩子谈："刚才发生的事，你是什么感受？你希望发生什么？"'
        },
        {
          tag: '怎么做',
          text: '给每个孩子创造"独有时间"：每周哪怕30分钟，只属于你们两个人。这会大幅减少对父母注意力的竞争性需求。',
          example: '周六上午陪老大做他喜欢的事，周日上午陪老二——不比较，各自独立。'
        },
        {
          tag: '调整环境',
          text: '给每个孩子建立一些明确属于他的"领地"：他的东西、他的空间、他的特权。很多冲突来自边界不清。',
          example: '给每个孩子各自的架子/抽屉，里面的东西不能未经允许拿，这是原则。'
        }
      ],
      share_summary: '你看到的是「${keyPhrase}」，但孩子在问：你爱我和爱他一样多吗？我在你心里是同等重要的吗？'
    }

  }
};

/* ================================================================
   Lead 系统 (预留企业微信接口 — 暂不接入)
================================================================ */
const LeadSystem = {
  KEY: 'aipiwen_leads_v02',

  create(userId, reportId, analysis, input) {
    try {
      const all = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      // V2：趋势数据（如可用）
      const trendResult = (typeof TrendAnalyzer !== 'undefined') ? TrendAnalyzer.analyze(userId) : null;
      const lead = {
        reportId,
        createdAt: new Date().toISOString(),
        sourceUrl: window.location.href,
        userInputBehavior: input || '',
        behaviorType: analysis.legacyType || 'emotional',    // 向后兼容 retention module
        behaviorPattern: analysis.primary || '',              // 新12类系统
        behaviorTags: analysis.tags || [],
        user_id: userId,
        fromLightReport: true,
        leadScore: '低意向',
        leadReason: '轻报告生成',
        interest_level: 'unknown',
        // V2 新增字段
        behaviorTrend: trendResult ? trendResult.trend : 'new',
        riskLevel: trendResult ? trendResult.riskLevel : 'low',
        repeatPatternDetected: trendResult ? trendResult.repeatPatternDetected : false,
        // 预留企业微信字段（暂不接入）
        future_wecom_status: 'pending',
        wecom_contact_at: null,
        wecom_response_at: null
      };
      const idx = all.findIndex(r => r.reportId === reportId);
      if (idx >= 0) { all[idx] = lead; } else { all.push(lead); }
      localStorage.setItem(this.KEY, JSON.stringify(all));
      return lead;
    } catch (e) { return null; }
  },

  update(reportId, fields) {
    try {
      const all = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      const idx = all.findIndex(r => r.reportId === reportId);
      if (idx >= 0) {
        Object.assign(all[idx], fields);
        localStorage.setItem(this.KEY, JSON.stringify(all));
      }
    } catch (e) {}
  }
};

/* ================================================================
   工具函数
================================================================ */
function generateReportId() {
  const now = new Date();
  const d = now.toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return 'AIPIWEN-' + d + '-' + rand;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/* ================================================================
   V3-A：AI 咨询智能体 Agent Layer
   增量新增——不替换、不修改任何 V2 逻辑
================================================================ */

/* ── 咨询会话存储 ── */
const ConsultingSessionStore = {
  KEY_PREFIX: 'aipiwen_consult_v1_',

  newSession(userId) {
    return {
      session_id: 'cs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      user_id: userId,
      stage: 'intake',   // intake → exploration → analysis → recommendation → complete
      turns: [],         // [{role:'user'|'agent', text:'', ts:''}]
      collected_info: {
        behavior_raw: '',   // 原始行为描述（拼接多轮）
        frequency: null,    // 频率
        trigger: null,      // 触发因素
        context: null,      // 发生场景
        duration: null,     // 持续时长
        child_age: null     // 孩子年龄
      },
      missing_info: [],
      analysis_result: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  },

  get(userId) {
    try {
      const raw = localStorage.getItem(this.KEY_PREFIX + userId);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  },

  save(session) {
    try {
      session.updated_at = new Date().toISOString();
      localStorage.setItem(this.KEY_PREFIX + session.user_id, JSON.stringify(session));
    } catch(e) {}
    return session;
  },

  addTurn(session, role, text) {
    session.turns.push({ role, text, ts: new Date().toISOString() });
    return session;
  },

  reset(userId) {
    try { localStorage.removeItem(this.KEY_PREFIX + userId); } catch(e) {}
  }
};

/* ── 信息充分性评估器 ── */
const InformationSufficiencyEvaluator = {

  // 模糊描述检测
  isVague(text) {
    if (!text || text.length < 8) return true;
    const vagueOnly = ['很叛逆', '不听话', '有问题', '不好', '出问题', '不正常', '不对劲', '变了', '不乖', '很烦', '让我担心'];
    const matches = vagueOnly.filter(p => text.includes(p));
    if (matches.length > 0 && text.length < 25) return true;
    return false;
  },

  // 从文本中提取信息字段
  extractFields(text) {
    const fields = {};
    if (/总是|每天|经常|有时|偶尔|一直|天天|时不时|一次|几次|这几天|这周|上周/.test(text)) {
      fields.frequency = true;
    }
    if (/一[说催问提叫喊]就|当[我他她]|因为|被催|在[家学校]|放学|写作业|吃饭|睡觉|玩手机/.test(text)) {
      fields.trigger = true;
    }
    if (/在家|在学校|放学后|晚上|早上|吃饭|睡觉前|开学|考试|最近|这段时间/.test(text)) {
      fields.context = true;
    }
    const durMatch = text.match(/([一两三四五六七八九十\d]+)[天周个月年]/);
    if (durMatch) fields.duration = durMatch[0];
    const ageMatch = text.match(/(\d+)岁/);
    if (ageMatch) fields.child_age = ageMatch[1];
    return fields;
  },

  // 评估信息充分性
  evaluate(collectedInfo, userTurnCount) {
    const { behavior_raw, frequency, trigger, context } = collectedInfo;

    if (!behavior_raw || behavior_raw.length < 8) {
      return { sufficient: false, confidence: 0, nextQuestion: 'initial' };
    }
    if (this.isVague(behavior_raw)) {
      return { sufficient: false, confidence: 0.2, nextQuestion: 'specifics' };
    }

    let score = 0.4;
    if (frequency) score += 0.2;
    if (trigger) score += 0.2;
    if (context) score += 0.2;

    // 已经有过追问轮次 → 可以进入分析
    if (userTurnCount >= 2) {
      return { sufficient: true, confidence: Math.max(score, 0.6), nextQuestion: null };
    }
    if (score >= 0.8) {
      return { sufficient: true, confidence: score, nextQuestion: null };
    }

    let nextQuestion = 'frequency';
    if (frequency && !trigger) nextQuestion = 'trigger';
    else if (trigger && !context) nextQuestion = 'context';

    return { sufficient: false, confidence: score, nextQuestion };
  }
};

/* ── Agent 回复生成器 ── */
const AgentResponseGenerator = {

  greeting(historyCtx) {
    if (historyCtx && historyCtx.sessions > 0) {
      return `你好，我们又见面了。上次你记录过孩子的一些情况，今天又遇到什么困惑了吗？直接跟我说就好。`;
    }
    return `你好，我是 AIPIWEN 育儿顾问。你可以把让你困惑的孩子行为告诉我——我会帮你理解背后的原因，不只是"说说而已"，而是给你真正可以用的应对方式。`;
  },

  followUp(questionType, collectedInfo) {
    const beh = (collectedInfo.behavior_raw || '').slice(0, 22);
    const map = {
      specifics: [
        `我想更具体地了解一下——「${beh}」，能描述一个最近发生的具体场景吗？比如当时在哪里，孩子做了什么，你们之间发生了什么？`,
        `「${beh}」——我需要再了解几个细节才能判断背后的原因。能说说最近一次发生时，具体是什么情形？`
      ],
      frequency: [
        `这种情况多久会发生一次？是每天都有，还是偶尔？最近有变得更频繁吗？`,
        `「${beh}」这种情况，大概一周会出现几次？还是每天都会有？`
      ],
      trigger: [
        `通常在什么情况下会这样？有没有一些特定的事情会触发这个行为？`,
        `这种情况有没有规律——是总在某个时间点、或者某件事之后发生？`
      ],
      context: [
        `这种情况大概是什么时候开始的？最近家里或学校有没有什么变化？`,
        `这个行为出现多久了？最近有什么让你感觉特别明显的事情吗？`
      ],
      initial: [
        `能告诉我，孩子最近让你困惑的是什么行为吗？尽量具体一点，越详细越容易分析。`
      ]
    };
    const options = map[questionType] || map.specifics;
    return options[Math.floor(Math.random() * options.length)];
  },

  transitionToAnalysis(collectedInfo) {
    const beh = (collectedInfo.behavior_raw || '').slice(0, 25);
    return `好，我已经对情况有了基本了解。让我来分析一下「${beh}」背后的原因……`;
  },

  analysisResponse(analysis, whyParagraph, trendResult, collectedInfo) {
    const patternMeta = AnalysisEngine.PATTERNS[analysis.primary];
    const label = patternMeta ? patternMeta.label : '行为模式';
    const kp = analysis.keyPhrase || (collectedInfo.behavior_raw || '').slice(0, 20);
    const c = ContentLibrary.lightReport(analysis);

    let lines = [];

    // 共情
    lines.push(`从你描述的情况来看，「${kp}」这类情况确实容易让家长感到无力，因为越用力越好像没用。`);
    lines.push('');

    // 核心判断
    lines.push(`**我的判断：这属于「${label}」类行为模式。**`);
    lines.push('');

    // 洞察
    lines.push(c.insight);
    lines.push('');

    // Why Layer
    if (whyParagraph && whyParagraph.mainReason) {
      lines.push(`**为什么会这样：**`);
      lines.push(whyParagraph.mainReason);
      if (whyParagraph.secondReason) {
        lines.push('');
        lines.push(`还有一个常被忽略的原因：${whyParagraph.secondReason}`);
      }
      lines.push('');
    }

    // 趋势（回访用户）
    if (trendResult && trendResult.trendText && trendResult.totalSessions >= 2) {
      lines.push(`**从你的历史记录来看：**`);
      lines.push(trendResult.trendText);
      lines.push('');
    }

    lines.push(`接下来我有三条具体建议，你想继续听吗？`);

    return lines.join('\n');
  },

  recommendationResponse(advice, analysis) {
    const kp = analysis.keyPhrase || '';
    let lines = [`针对「${kp}」，这是三条你明天就可以用的具体方式：`, ''];
    advice.forEach((a, i) => {
      lines.push(`**${i + 1}. ${a.tag}**`);
      lines.push(a.text);
      if (a.example) lines.push(`› 参考说法：「${a.example}」`);
      lines.push('');
    });
    lines.push(`还有想深入了解的地方吗？我在这里。`);
    return lines.join('\n');
  }
};

/* ── 核心：AI咨询智能体 V3-A ── */
const AIPIWENConsultingAgent = {

  processInput(userId, userText, existingSession) {
    let session = existingSession
      || ConsultingSessionStore.get(userId)
      || ConsultingSessionStore.newSession(userId);

    const history    = MemorySystem.getRecent(userId, 5);
    ConsultingSessionStore.addTurn(session, 'user', userText);

    let response = '';
    let action   = '';
    let analysisResult = null;

    const userTurns = session.turns.filter(t => t.role === 'user').length;

    if (session.stage === 'intake') {
      // 收集初始描述
      session.collected_info.behavior_raw = userText;
      const extracted = InformationSufficiencyEvaluator.extractFields(userText);
      Object.assign(session.collected_info, extracted);

      const ev = InformationSufficiencyEvaluator.evaluate(session.collected_info, userTurns);

      if (ev.sufficient) {
        session.stage = 'analysis';
        const r = this._runAnalysis(userId, session, history);
        response = r.response; action = 'analyze';
        session.analysis_result = r.analysis; analysisResult = r.analysis;
        session.stage = 'recommendation';
      } else {
        session.stage = 'exploration';
        session.missing_info = [ev.nextQuestion];
        response = AgentResponseGenerator.followUp(ev.nextQuestion, session.collected_info);
        action = 'ask';
      }

    } else if (session.stage === 'exploration') {
      // 补充追问回答 → 合并信息
      const extracted = InformationSufficiencyEvaluator.extractFields(userText);
      if (!session.collected_info.frequency && extracted.frequency) session.collected_info.frequency = true;
      if (!session.collected_info.trigger   && extracted.trigger)   session.collected_info.trigger   = true;
      if (!session.collected_info.context   && extracted.context)   session.collected_info.context   = true;
      if (!session.collected_info.child_age && extracted.child_age) session.collected_info.child_age = extracted.child_age;
      // 补充信息拼接进 behavior_raw
      session.collected_info.behavior_raw += '；' + userText;

      const ev = InformationSufficiencyEvaluator.evaluate(
        session.collected_info,
        session.turns.filter(t => t.role === 'user').length
      );

      if (ev.sufficient || userTurns >= 3) {
        const transition = AgentResponseGenerator.transitionToAnalysis(session.collected_info);
        const r = this._runAnalysis(userId, session, history);
        response = transition + '\n\n' + r.response; action = 'analyze';
        session.analysis_result = r.analysis; analysisResult = r.analysis;
        session.stage = 'recommendation';
      } else {
        session.missing_info = [ev.nextQuestion];
        response = AgentResponseGenerator.followUp(ev.nextQuestion, session.collected_info);
        action = 'ask';
      }

    } else if (session.stage === 'recommendation') {
      // 用户回复"想继续" → 输出建议
      if (session.analysis_result) {
        const c = ContentLibrary.fullReport(session.analysis_result);
        response = AgentResponseGenerator.recommendationResponse(c.advice, session.analysis_result);
        analysisResult = session.analysis_result;
        session.stage = 'complete';
        action = 'recommend';
      } else {
        response = '你还有什么想了解的？我可以继续解答。';
        action = 'chat';
      }

    } else {
      // complete → 自由对话
      response = '你还有其他想聊的吗？随时可以描述新的行为，我来帮你分析。';
      action = 'chat';
    }

    ConsultingSessionStore.addTurn(session, 'agent', response);
    ConsultingSessionStore.save(session);

    return { response, action, session, stage: session.stage, analysisResult };
  },

  // V2 分析管道（必须调用所有 V2 模块）
  _runAnalysis(userId, session, history) {
    const behavior = session.collected_info.behavior_raw;
    const analysis = AnalysisEngine.analyze(behavior, history);
    const whyParagraph = BehaviorReasoningEngine.generateWhyParagraph(analysis.primary, analysis.keyPhrase);
    const trendResult  = TrendAnalyzer.analyze(userId);

    // 写入 V2 记忆系统
    MemorySystem.add(userId, {
      input: behavior,
      analysis: { primary: analysis.primary, secondary: analysis.secondary, legacyType: analysis.legacyType },
      tags: analysis.tags,
      report_id: 'consult_' + session.session_id
    });

    const reportId = generateReportId();
    LeadSystem.create(userId, reportId, analysis, behavior);

    const response = AgentResponseGenerator.analysisResponse(analysis, whyParagraph, trendResult, session.collected_info);
    return { response, analysis, whyParagraph, trendResult, reportId };
  },

  // 开始新会话 → 返回 greeting
  startSession(userId) {
    const historyCtx = MemorySystem.getContext(userId);
    ConsultingSessionStore.reset(userId);
    const session  = ConsultingSessionStore.newSession(userId);
    const greeting = AgentResponseGenerator.greeting(historyCtx);
    ConsultingSessionStore.addTurn(session, 'agent', greeting);
    ConsultingSessionStore.save(session);
    return { greeting, session };
  }
};

/* ================================================================
   挂载到全局
================================================================ */
window.AIPIWEN = {
  UserSystem,
  MemorySystem,
  AnalysisEngine,
  ContentLibrary,
  LeadSystem,
  BehaviorReasoningEngine,
  TrendAnalyzer,
  ConsultingSessionStore,
  InformationSufficiencyEvaluator,
  AgentResponseGenerator,
  AIPIWENConsultingAgent,
  generateReportId,
  truncate
};
