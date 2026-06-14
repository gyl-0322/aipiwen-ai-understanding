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

/* ================================================================
   V3-B：咨询洞察系统 — Insight Layer
   增量新增，不替换任何 V3-A / V2 逻辑
================================================================ */

/* ── V3-B 模块1：咨询洞察引擎（三层问题解构）── */
const ConsultingInsightEngine = {

  // 结构层：家庭动态分类
  STRUCTURAL_PATTERNS: {
    control_dynamic: {
      label: '控制与自主冲突',
      keywords: /催促|要求|必须|应该|强迫|不听|叛逆|对抗|反抗|凭什么|你管我/,
      description: '家长控制需求 vs 孩子自主需求之间的张力'
    },
    attachment_anxiety: {
      label: '依附与分离焦虑',
      keywords: /哭|分离|黏|不离开|妈妈走|害怕|担心|不放心|焦虑|不安全/,
      description: '孩子的安全依附需求未被充分满足'
    },
    performance_pressure: {
      label: '成就压力结构',
      keywords: /成绩|学习|考试|名次|分数|比较|同学|别人家|落后|差|优秀/,
      description: '成就期待带来的持续压力积累'
    },
    communication_block: {
      label: '沟通阻断模式',
      keywords: /不说话|沉默|不回应|关门|回避|什么都不说|打游戏|手机|逃避/,
      description: '沟通渠道已经关闭，孩子以回避代替表达'
    },
    sibling_competition: {
      label: '手足竞争结构',
      keywords: /弟弟|妹妹|哥哥|姐姐|二宝|老大|老二|公平|偏心|更爱/,
      description: '资源竞争引发的手足间争夺行为'
    },
    transition_stress: {
      label: '转折期适应压力',
      keywords: /升学|换学校|转班|离婚|搬家|换老师|开学|假期|变化|最近突然/,
      description: '重大生活变化触发的适应性压力反应'
    }
  },

  analyze(input, history, collectedInfo) {
    const text = input || '';
    const surface    = this._extractSurface(text);
    const behaviorHint = this._getBehaviorHint(text);
    const structural = this._getStructuralPattern(text, history);
    const primary_focus = this._decidePrimaryFocus(surface, behaviorHint, structural, text);
    return {
      surface,
      behavior: behaviorHint.description,
      behavior_pattern: behaviorHint.pattern,
      structure: structural.description,
      structural_key: structural.key,
      primary_focus,
      has_history: !!(history && history.length > 0)
    };
  },

  _extractSurface(text) {
    const t = text.trim();
    if (t.length <= 30) return t;
    const breakIdx = t.search(/[，。！？,!?\n]/);
    if (breakIdx > 4 && breakIdx < 40) return t.slice(0, breakIdx);
    return t.slice(0, 35) + '…';
  },

  _getBehaviorHint(text) {
    const patterns = AnalysisEngine.PATTERNS;
    let topPattern = 'emotional_explosion';
    let topScore   = 0;
    Object.keys(patterns).forEach(function(key) {
      const p = patterns[key];
      let score = 0;
      (p.keywords || []).forEach(function(kw) {
        if (kw && kw.test && kw.test(text)) score += (p.weight || 1);
      });
      if (score > topScore) { topScore = score; topPattern = key; }
    });
    const meta = patterns[topPattern];
    return {
      pattern: topPattern,
      label: meta ? meta.label : '行为模式',
      description: meta ? ('表现为「' + meta.label + '」类行为') : '行为模式待确认',
      confidence: topScore > 0 ? 'high' : 'low'
    };
  },

  _getStructuralPattern(text, history) {
    const patterns = this.STRUCTURAL_PATTERNS;
    let topKey   = null;
    let topScore = 0;
    Object.keys(patterns).forEach(function(key) {
      const score = patterns[key].keywords.test(text) ? 1 : 0;
      if (score > topScore) { topScore = score; topKey = key; }
    });
    if (!topKey && history && history.length >= 2) {
      topKey = 'communication_block';
    }
    if (!topKey) return { key: null, label: '结构待分析', description: '需要更多信息来判断家庭互动结构' };
    const p = patterns[topKey];
    return { key: topKey, label: p.label, description: p.description };
  },

  _decidePrimaryFocus(surface, behaviorHint, structural, text) {
    if (structural.key && text.length > 20) {
      return structural.label + '——这是当前需要优先理解的核心结构';
    }
    if (behaviorHint.confidence === 'high') {
      return behaviorHint.label + '——当前行为表现的主要模式';
    }
    return surface + '——这是目前描述的表层现象';
  }
};

/* ── V3-B 模块2：矛盾识别器 ── */
const ContradictionDetector = {

  CONTRADICTION_PAIRS: [
    {
      type: 'frequency',
      signalA: /总是|每次|天天|一直|每天|无时无刻/,
      signalB: /偶尔|有时|一次|最近一次|有一次/,
      interpretation: '描述中同时出现了"总是"和"偶尔"——频率描述有矛盾，这可能影响判断的准确性'
    },
    {
      type: 'severity',
      signalA: /非常严重|很严重|极端|受不了|崩溃了|没办法了/,
      signalB: /还好|不算太|不是很|还行|其实也|问题不大/,
      interpretation: '描述的严重程度前后有矛盾——孩子的情况可能比描述的更复杂'
    },
    {
      type: 'temporal',
      signalA: /从来|从小|一直都|本来就/,
      signalB: /最近|突然|忽然|这段时间|这学期|开学后/,
      interpretation: '既说"一直如此"又说"最近才有"——这个行为的起点值得深入了解'
    },
    {
      type: 'parental_stance',
      signalA: /我没有|我从不|我一直很|我已经很/,
      signalB: /他还是|但他|仍然|就是不|无论如何/,
      interpretation: '家长描述自己已经做了很多，但孩子没有变化——这个"努力-无效"循环本身是重要信息'
    }
  ],

  detect(input, history, collectedInfo) {
    const text   = (input || '') + ' ' + ((collectedInfo && collectedInfo.behavior_raw) || '');
    const points = [];
    this.CONTRADICTION_PAIRS.forEach(function(pair) {
      if (pair.signalA.test(text) && pair.signalB.test(text)) {
        points.push({ type: pair.type, interpretation: pair.interpretation });
      }
    });
    // 历史模式偏移矛盾
    if (history && history.length >= 1 && collectedInfo && collectedInfo.behavior_raw) {
      const lastPrimary = history[history.length - 1].analysis && history[history.length - 1].analysis.primary;
      if (lastPrimary) {
        const currentHint = ConsultingInsightEngine._getBehaviorHint(collectedInfo.behavior_raw);
        if (lastPrimary !== currentHint.pattern && currentHint.confidence === 'high') {
          const lastMeta = AnalysisEngine.PATTERNS[lastPrimary];
          points.push({
            type: 'pattern_shift',
            interpretation: '上次你描述的是「' + (lastMeta ? lastMeta.label : lastPrimary) + '」类问题，这次描述的情况有所不同——孩子的行为模式在变化，还是问题本身是多层的？'
          });
        }
      }
    }
    return {
      contradiction_points: points,
      has_contradictions: points.length > 0,
      interpretation: points.length > 0 ? points[0].interpretation : null
    };
  }
};

/* ── V3-B 模块3：高信息密度问题选择器 ── */
const PriorityQuestionSelector = {

  select(insightResult, collectedInfo, contradictions) {
    const beh = (insightResult && insightResult.surface) || '这种情况';

    // 优先级1：有矛盾 → 直接问矛盾
    if (contradictions && contradictions.has_contradictions && contradictions.interpretation) {
      return {
        selected_question: contradictions.interpretation + '\n\n你怎么看这个矛盾？',
        reason: '用户描述中存在矛盾，询问矛盾能获得最高信息量',
        type: 'contradiction',
        gain: 10
      };
    }

    // 优先级2：结构层未知 → 问家庭动态
    if (!insightResult || !insightResult.structural_key) {
      return {
        selected_question: '「' + beh + '」这种情况发生时，家里通常是什么气氛？家庭成员对这件事的看法一致吗？',
        reason: '结构层信息空白，家庭动态是理解行为的关键',
        type: 'structure',
        gain: 8
      };
    }

    // 优先级3：时间线不清楚 → 问轨迹
    if (!(collectedInfo && collectedInfo.duration)) {
      return {
        selected_question: '「' + beh + '」是什么时候开始明显变化的？在那之前，孩子有没有什么不同？',
        reason: '行为轨迹能区分阶段性问题和结构性问题',
        type: 'structure',
        gain: 8
      };
    }

    // 优先级4：触发器不清楚 → 问具体场景
    if (!(collectedInfo && collectedInfo.trigger)) {
      return {
        selected_question: '「' + beh + '」——最近一次发生时，你和孩子之间说了什么、做了什么？越具体越好。',
        reason: '具体触发场景能揭示行为的真实逻辑',
        type: 'behavior',
        gain: 6
      };
    }

    // 优先级5：孩子视角缺失
    return {
      selected_question: '当这种情况发生时，你觉得孩子自己是什么感受？他有没有解释过自己为什么这样做？',
      reason: '孩子视角是最常被忽略的关键信息维度',
      type: 'behavior',
      gain: 6
    };
  }
};

/* ── V3-B 模块4：咨询路径规划器 ── */
const ConsultingPathPlanner = {

  PHASES: {
    phase1: { label: '问题识别',     desc: '理解表层现象，提炼核心问题' },
    phase2: { label: '行为模式确认', desc: '锁定行为类型，理解触发逻辑' },
    phase3: { label: '关系结构分析', desc: '分析家庭互动模式，定位结构性原因' },
    phase4: { label: '干预建议',     desc: '生成具体可执行的应对方案' }
  },

  plan(userId, insightResult, analysis, trendResult, userTurnsCount) {
    const userTurns = userTurnsCount || 0;

    // 判断当前阶段
    let currentPhase = 'phase1';
    if (analysis && userTurns >= 2) {
      currentPhase = 'phase3';
    } else if (analysis) {
      currentPhase = 'phase2';
    } else if (insightResult && insightResult.structural_key) {
      currentPhase = 'phase2';
    }
    const currentPhaseLabel = this.PHASES[currentPhase].label;

    const nextMap = {
      phase1: '进入「行为模式确认」——锁定这个行为背后的心理模式',
      phase2: '进入「关系结构分析」——理解家庭互动中的结构性原因',
      phase3: '进入「干预建议」——生成具体可执行的应对方式',
      phase4: '进入持续追踪——观察干预后的行为变化'
    };
    const nextDirection = nextMap[currentPhase];

    // 路径摘要
    const summaryLines = [];
    if (insightResult && insightResult.primary_focus) {
      summaryLines.push('**当前理解：**' + insightResult.primary_focus);
    }
    if (analysis) {
      const meta = AnalysisEngine.PATTERNS[analysis.primary];
      if (meta) summaryLines.push('**行为模式：**「' + meta.label + '」');
    }
    if (trendResult && trendResult.trendText && trendResult.totalSessions >= 2) {
      summaryLines.push('**历史趋势：**' + trendResult.trendText);
    }
    if (insightResult && insightResult.structural_key && insightResult.structure) {
      summaryLines.push('**结构因素：**' + insightResult.structure);
    }

    const recommendedActions = (currentPhase === 'phase3' || currentPhase === 'phase4')
      ? ['观察这个行为在不同场合（家/学校）的差异', '注意行为发生前的家庭情绪气氛', '记录最近一周的触发点和频率']
      : ['继续提供孩子行为的具体细节', '回想最近一次发生时的完整过程'];

    return {
      current_phase: currentPhase,
      current_phase_label: currentPhaseLabel,
      next_direction: nextDirection,
      path_summary: summaryLines.join('\n'),
      recommended_actions: recommendedActions
    };
  }
};

/* ================================================================
   V3-C：行为干预与长期咨询系统 — Intervention Layer
   增量新增，不替换任何 V3-B / V3-A / V2 逻辑
================================================================ */

/* ── V3-C 模块1：行为干预引擎 ── */
const BehaviorInterventionEngine = {

  // 12种行为模式 → 可执行干预路径
  INTERVENTION_BLUEPRINTS: {
    emotional_explosion: {
      goal: '降低情绪爆发的频率和强度，帮助孩子建立情绪调节能力',
      steps: [
        '**今天开始：**在爆发前，用"我知道你很不高兴"替代"不可以/不准"——先被看见，才能被听见',
        '**本周内：**找到孩子爆发前的3个信号（如咬嘴唇、眼神飘移），提前低声说"你现在感觉到什么？"',
        '**两周内：**建立"平静角"——一个孩子可以合法独处的地方，不是惩罚，是调节的工具'
      ],
      expected_change: '2-3周内爆发频率降低30-50%；孩子开始出现"我需要一点时间"的自我调节语言',
      risk_warning: '实施初期孩子可能爆发更猛烈——这是在测试你是否真的改变了，不要退回旧模式'
    },
    emotional_sensitive: {
      goal: '帮助孩子将玻璃心转化为有边界的情感表达',
      steps: [
        '**今天开始：**停止"你太脆弱了"等评价，改用"你现在感受到什么？"——接纳优先于纠正',
        '**本周内：**每天主动询问孩子今天有什么让他难过的事（哪怕你觉得不重要）',
        '**两周内：**帮孩子建立情绪词汇——让他能说出"我很委屈"而不是只会哭'
      ],
      expected_change: '3-4周后，孩子哭泣时间减少；开始用语言替代眼泪表达需求',
      risk_warning: '改变初期孩子可能哭得更频繁——因为你开始"允许"他有情绪了，这是好转的信号'
    },
    homework_conflict: {
      goal: '将作业冲突从"家长vs孩子"变为"孩子自己的事"',
      steps: [
        '**今天开始：**减少一次催促，改为"作业什么时候开始做，由你决定"',
        '**本周内：**约定固定的"作业时间窗口"（如放学后1小时内），窗口结束后不再提',
        '**两周内：**让孩子承担自然后果——未完成时让老师/结果说话，而不是家长说话'
      ],
      expected_change: '2-4周内亲子间作业冲突减少；孩子开始有主动完成的时刻',
      risk_warning: '短期内成绩可能下滑或老师反馈——坚持边界比短期成绩更重要，这是过渡期'
    },
    autonomy_resist: {
      goal: '将"叛逆对抗"重新定义为"自主需求"，并给它合理出口',
      steps: [
        '**今天开始：**找一件事，让孩子完全做主（哪怕你不同意）',
        '**本周内：**用"和你商量"替代"你必须"——同样的规则，让孩子参与制定',
        '**两周内：**每周给孩子一个"我说了算"的时段（30分钟）'
      ],
      expected_change: '2-3周内对抗强度下降；孩子开始在被给予自主权的事上表现出自律',
      risk_warning: '孩子得到自主权后可能短暂"失控"测试边界——这是正常的，设好底线后放手'
    },
    phone_addiction: {
      goal: '将屏幕从"逃避工具"转变为"可管理的选择"',
      steps: [
        '**今天开始：**不没收手机，而是问孩子"你觉得玩多久合理？"——让他先说出一个时间',
        '**本周内：**全家一起设立"无屏幕时段"（如晚饭期间），而不是只针对孩子',
        '**两周内：**和孩子一起找到3个比手机更有吸引力的现实活动，不说"不如玩手机吗"'
      ],
      expected_change: '4-6周，孩子开始能主动放下手机，出现"今天我只玩了XX分钟"的自我报告',
      risk_warning: '直接缩短时间会加剧冲突——必须先建立信任，再协商规则，顺序不能颠倒'
    },
    withdrawal: {
      goal: '重新打开孩子关闭的沟通通道',
      steps: [
        '**今天开始：**停止追问，改为每天说一件"我今天的事"——让孩子学会家里可以说话',
        '**本周内：**陪孩子做他喜欢的事（哪怕你不感兴趣），不说话也可以',
        '**两周内：**建立"匿名表达渠道"——每周一张小纸条，可以写任何东西，放在固定地方'
      ],
      expected_change: '3-5周后，孩子开始偶尔主动说一件事；沉默期开始缩短',
      risk_warning: '追问只会强化沉默——欲速则不达，陪伴比追问更重要'
    },
    aggression: {
      goal: '将攻击行为转化为可表达的言语需求',
      steps: [
        '**今天开始：**发生后，不立刻惩罚，先平静分开，等3分钟后再谈',
        '**本周内：**每次攻击后询问"你打他之前，你心里感觉到什么？"',
        '**两周内：**和孩子练习"当我想打人时，我可以说……"——设计几个替代句子'
      ],
      expected_change: '4-6周，攻击前的语言报警开始出现；攻击频率下降',
      risk_warning: '若攻击升级或出现自伤行为，需要寻求专业心理帮助——这超出家庭调整范围'
    },
    lying: {
      goal: '让孩子觉得"说真话比撒谎更安全"',
      steps: [
        '**今天开始：**当孩子说了实话，哪怕内容让你不高兴，明确说"谢谢你告诉我"',
        '**本周内：**停止追问细节——孩子撒谎通常因为说实话代价太大',
        '**两周内：**与孩子约定"安全告知"规则：某些事先告诉我，我不会发火'
      ],
      expected_change: '3-5周，孩子开始主动承认小事；在"安全话题"上不再撒谎',
      risk_warning: '惩罚和说教会强化撒谎——唯一打破循环的方式是让说真话变得安全'
    },
    school_refusal: {
      goal: '找到学校恐惧的真实来源，分步重建上学安全感',
      steps: [
        '**今天开始：**不强迫，先问"学校里有没有一件事是让你最不想去的？"',
        '**本周内：**联系老师了解近期班级动态，但不在孩子面前透露',
        '**两周内：**设计"最小上学方案"——比如只去前两节课，其余在家'
      ],
      expected_change: '2-3周，孩子能说出一个具体的学校问题；拒绝强度降低',
      risk_warning: '强行送去可能造成创伤性记忆——若伴随躯体症状（头痛/腹痛），需评估是否有欺凌或情绪障碍'
    },
    anxiety_worry: {
      goal: '帮助孩子区分"真实危险"和"焦虑想象"，建立内心安全感',
      steps: [
        '**今天开始：**当孩子表达担心时，先说"你担心的事情，我听到了"——不解释，不否认',
        '**本周内：**和孩子一起做"最坏情况演习"：如果那件事真的发生了，我们怎么应对？',
        '**两周内：**建立睡前"担心时间"——每晚5分钟专门说出担心，其余时间不强制平静'
      ],
      expected_change: '3-4周，孩子开始能在说出担心后自己说"其实可能不会发生"',
      risk_warning: '频繁的躯体化症状（胃痛、头痛）伴随焦虑，需要儿童心理专业评估'
    },
    attention_issues: {
      goal: '为孩子创造成功体验，建立注意力的信心基础',
      steps: [
        '**今天开始：**找到孩子能专注超过10分钟的事（哪怕是游戏），记录下来',
        '**本周内：**利用这个活动建立"番茄工作法"雏形——先10分钟专注，再5分钟自由',
        '**两周内：**减少环境干扰——关掉背景音，整理桌面，每次只放一件作业'
      ],
      expected_change: '2-3周，专注窗口从5分钟扩展到10-15分钟；孩子开始有"我做完了"的体验',
      risk_warning: '注意力问题可能有神经发育基础——调整2个月无效，建议进行专业评估'
    },
    sibling_conflict: {
      goal: '从"谁对谁错"转向"每个孩子的需求都被看见"',
      steps: [
        '**今天开始：**冲突后，先分开安抚，分别询问每人的感受，不立刻评判谁错',
        '**本周内：**每天给大宝/小宝各10分钟单独时间——让每个人感受到"我也有专属的爱"',
        '**两周内：**设计"手足合作任务"——一起完成需要合作的事，建立正向连接'
      ],
      expected_change: '3-4周，冲突后的恢复时间缩短；两人开始有主动合作的时刻',
      risk_warning: '若某个孩子持续表现出攻击性或受害性，需要单独关注其情绪健康'
    }
  },

  generate(analysis, insight) {
    const primary = (analysis && analysis.primary) || 'emotional_explosion';
    const bp = this.INTERVENTION_BLUEPRINTS[primary] || this.INTERVENTION_BLUEPRINTS.emotional_explosion;
    const kp = (analysis && analysis.keyPhrase) || '';
    return {
      intervention_goal: bp.goal,
      steps: bp.steps,
      expected_change: bp.expected_change,
      risk_warning: bp.risk_warning,
      pattern: primary,
      key_phrase: kp
    };
  }
};

/* ── V3-C 模块2：家庭动态追踪器 ── */
const FamilyDynamicTracker = {

  track(userId, history, currentAnalysis) {
    const allMemories = MemorySystem.getAll(userId);

    if (allMemories.length < 2) {
      return {
        trend: 'new',
        trend_label: '初次评估',
        stability_score: 50,
        escalation_risk: 'low',
        pattern_diversity: 1,
        sessions_tracked: allMemories.length,
        is_stuck: false,
        improvement_signs: false
      };
    }

    const totalSessions = allMemories.length;
    const patterns = allMemories.map(function(m) {
      return m.analysis && m.analysis.primary;
    }).filter(Boolean);

    const uniquePatterns = [];
    patterns.forEach(function(p) {
      if (uniquePatterns.indexOf(p) === -1) uniquePatterns.push(p);
    });
    const patternDiversity = uniquePatterns.length;

    const recent3 = patterns.slice(-3);
    const recent3Unique = [];
    recent3.forEach(function(p) {
      if (recent3Unique.indexOf(p) === -1) recent3Unique.push(p);
    });
    const isStuck = recent3Unique.length === 1 && recent3.length >= 2;

    // 判断家庭动态趋势
    let trend = 'stable';
    let trendLabel = '维持稳定';
    let escalationRisk = 'low';
    let stabilityScore = 60;

    if (totalSessions >= 3 && isStuck) {
      trend = 'stuck';
      trendLabel = '问题固化中';
      escalationRisk = 'medium';
      stabilityScore = 35;
    } else if (totalSessions >= 4 && patternDiversity >= 3) {
      trend = 'escalating';
      trendLabel = '问题复杂化';
      escalationRisk = 'high';
      stabilityScore = 25;
    } else if (totalSessions >= 2 && patternDiversity <= 1) {
      trend = 'improving';
      trendLabel = '聚焦改善中';
      escalationRisk = 'low';
      stabilityScore = 75;
    } else {
      trend = 'evolving';
      trendLabel = '动态变化中';
      escalationRisk = 'medium';
      stabilityScore = 55;
    }

    return {
      trend: trend,
      trend_label: trendLabel,
      stability_score: stabilityScore,
      escalation_risk: escalationRisk,
      pattern_diversity: patternDiversity,
      sessions_tracked: totalSessions,
      is_stuck: isStuck,
      unique_patterns: uniquePatterns,
      improvement_signs: trend === 'improving'
    };
  }
};

/* ── V3-C 模块3：复访机制 ── */
const ConsultationFollowUpSystem = {

  evaluate(userId, dynamicResult) {
    const allMemories = MemorySystem.getAll(userId);
    const sessionCount = allMemories.length;
    const isReturnUser = sessionCount >= 2;

    // 计算上次会话距今天数
    const lastMemory = allMemories.length > 0 ? allMemories[allMemories.length - 1] : null;
    let daysSinceLast = null;
    if (lastMemory && lastMemory.timestamp) {
      daysSinceLast = Math.floor((Date.now() - new Date(lastMemory.timestamp).getTime()) / 86400000);
    }

    let followUpNeeded = false;
    let followUpType   = null;
    let followUpMessage = '';

    if (sessionCount === 2) {
      followUpNeeded = true;
      followUpType   = 'first_return';
      followUpMessage = '你上次和我聊过孩子的情况。上次那个问题现在有没有一点变化？';
    } else if (sessionCount >= 3 && dynamicResult.trend === 'stuck') {
      followUpNeeded = true;
      followUpType   = 'stuck_care';
      followUpMessage = '我注意到你已经来了好几次，情况好像还没有明显改变。我想直接问你：你自己这段时间还好吗？长期应对这类问题，家长自己也会很消耗。';
    } else if (sessionCount >= 3 && dynamicResult.escalation_risk === 'high') {
      followUpNeeded = true;
      followUpType   = 'escalation_check';
      followUpMessage = '从你这几次描述来看，家里的情况在变复杂。我想多了解一下最近的整体状态——不只是孩子，也包括你自己和家庭氛围。';
    } else if (sessionCount >= 3 && daysSinceLast !== null && daysSinceLast >= 7) {
      followUpNeeded = true;
      followUpType   = 'periodic_checkin';
      followUpMessage = '你上次来是一周前了。上次我们聊到的，有没有尝试过？结果怎么样？';
    }

    return {
      is_return_user: isReturnUser,
      session_count: sessionCount,
      follow_up_needed: followUpNeeded,
      follow_up_type: followUpType,
      follow_up_message: followUpMessage,
      days_since_last: daysSinceLast
    };
  }
};

/* ── V3-C 模块4：行为改变计划生成器 ── */
const BehaviorChangePlanGenerator = {

  generate(intervention, analysis, dynamicResult) {
    const steps   = (intervention && intervention.steps) || [];
    const risk    = (dynamicResult && dynamicResult.escalation_risk) || 'low';
    const pattern = (analysis && analysis.primary) || 'emotional_explosion';

    // Day 1-3：立即行动
    const day1to3 = [];
    if (steps[0]) day1to3.push(steps[0]);
    day1to3.push('记录下今天孩子这个行为发生的时间和触发情境（不评价，只记录）');

    // Week 1-2：建立新模式
    const week1to2 = [];
    if (steps[1]) week1to2.push(steps[1]);
    if (steps[2]) week1to2.push(steps[2]);
    week1to2.push('回顾第一周：哪一次你的应对方式不一样了？孩子有什么反应？把这个写下来');

    // 长期策略
    const longTerm = [];
    if (intervention && intervention.expected_change) {
      longTerm.push('**预期变化：**' + intervention.expected_change);
    }
    if (risk === 'high') {
      longTerm.push('**专业建议：**当前家庭关系风险较高，建议同步寻求专业家庭咨询支持');
    } else if (dynamicResult && dynamicResult.trend === 'stuck') {
      longTerm.push('**追踪提醒：**同一问题多次出现，建议从家庭互动结构层面审视，而不只是孩子行为层面');
    } else {
      longTerm.push('持续使用这套方法，大多数家庭在4-6周内看到明显改变');
    }

    return {
      day1to3: day1to3,
      week1to2: week1to2,
      long_term: longTerm,
      pattern: pattern,
      total_duration_estimate: risk === 'high' ? '6-8周' : '3-5周',
      risk_level: risk
    };
  }
};

/* ── 核心：AI咨询智能体（升级至 V3-C 干预模式）── */
const AIPIWENConsultingAgent = {

  processInput(userId, userText, existingSession) {
    let session = existingSession
      || ConsultingSessionStore.get(userId)
      || ConsultingSessionStore.newSession(userId);

    const history = MemorySystem.getRecent(userId, 5);
    ConsultingSessionStore.addTurn(session, 'user', userText);

    // ══ V3-B 洞察管道（每轮都运行）══
    const insight        = ConsultingInsightEngine.analyze(userText, history, session.collected_info);
    const contradictions = ContradictionDetector.detect(userText, history, session.collected_info);
    session.last_insight        = insight;
    session.last_contradictions = contradictions.has_contradictions ? contradictions : (session.last_contradictions || null);

    // ══ V3-C 家庭动态实时追踪（每轮刷新）══
    const dynamicResult  = FamilyDynamicTracker.track(userId, history, null);
    session.family_dynamic = dynamicResult;

    let response = '';
    let action   = '';
    let analysisResult = null;

    const userTurns = session.turns.filter(function(t) { return t.role === 'user'; }).length;

    if (session.stage === 'intake') {
      // 收集初始描述
      session.collected_info.behavior_raw = userText;
      const extracted = InformationSufficiencyEvaluator.extractFields(userText);
      Object.assign(session.collected_info, extracted);

      const ev = InformationSufficiencyEvaluator.evaluate(session.collected_info, userTurns);

      if (ev.sufficient) {
        session.stage = 'analysis';
        const r = this._runAnalysis(userId, session, history, insight);
        response = r.response; action = 'analyze';
        session.analysis_result = r.analysis; analysisResult = r.analysis;
        session.stage = 'recommendation';
      } else {
        session.stage = 'exploration';
        // V3-B：PriorityQuestionSelector 替代通用 followUp
        const pq = PriorityQuestionSelector.select(insight, session.collected_info, contradictions);
        session.missing_info = [pq.type];
        response = pq.selected_question;
        action = 'ask';
      }

    } else if (session.stage === 'exploration') {
      // 补充追问回答 → 合并信息
      const extracted = InformationSufficiencyEvaluator.extractFields(userText);
      if (!session.collected_info.frequency && extracted.frequency) session.collected_info.frequency = true;
      if (!session.collected_info.trigger   && extracted.trigger)   session.collected_info.trigger   = true;
      if (!session.collected_info.context   && extracted.context)   session.collected_info.context   = true;
      if (!session.collected_info.child_age && extracted.child_age) session.collected_info.child_age = extracted.child_age;
      session.collected_info.behavior_raw += '；' + userText;

      // V3-B：用合并后的完整信息重新运行洞察
      const updatedInsight = ConsultingInsightEngine.analyze(
        session.collected_info.behavior_raw, history, session.collected_info
      );
      session.last_insight = updatedInsight;

      const ev = InformationSufficiencyEvaluator.evaluate(
        session.collected_info,
        session.turns.filter(function(t) { return t.role === 'user'; }).length
      );

      if (ev.sufficient || userTurns >= 3) {
        const transition = AgentResponseGenerator.transitionToAnalysis(session.collected_info);
        const r = this._runAnalysis(userId, session, history, updatedInsight);
        response = transition + '\n\n' + r.response; action = 'analyze';
        session.analysis_result = r.analysis; analysisResult = r.analysis;
        session.stage = 'recommendation';
      } else {
        // V3-B：再次选取高信息密度问题
        const updatedContradictions = ContradictionDetector.detect(
          session.collected_info.behavior_raw, history, session.collected_info
        );
        const pq = PriorityQuestionSelector.select(updatedInsight, session.collected_info, updatedContradictions);
        session.missing_info = [pq.type];
        response = pq.selected_question;
        action = 'ask';
      }

    } else if (session.stage === 'recommendation') {
      // V4：输出完整 Day1→Day7→30天 行为改变计划
      if (session.analysis_result) {
        const intervention  = BehaviorInterventionEngine.generate(session.analysis_result, session.last_insight);
        const plan3c        = BehaviorChangePlanGenerator.generate(intervention, session.analysis_result, dynamicResult);
        const familyStruct  = session.family_structure || FamilyStructureAnalyzer.analyze(
          session.collected_info.behavior_raw, history, session.analysis_result
        );
        const v4plan        = BehaviorChangePlanner.plan(familyStruct, session.analysis_result, intervention, plan3c);
        response = this._buildV4FullPlan(session.analysis_result, intervention, plan3c, v4plan, familyStruct, dynamicResult);
        analysisResult = session.analysis_result;
        session.last_intervention = intervention;
        session.last_plan         = plan3c;
        session.v4_plan           = v4plan;
        session.stage = 'complete';
        action = 'recommend';
      } else {
        response = '你还有什么想了解的？我可以继续解答。';
        action = 'chat';
      }

    } else {
      // complete → 闭环自由对话（记录反馈，持续优化）
      const fbEval = FeedbackLoopSystem.evaluate(userId);
      if (fbEval.message) {
        response = fbEval.message + '\n\n你有没有尝试过上面的方法？有什么新的情况，随时告诉我。';
      } else {
        response = '你有没有尝试过上面的方法？如果遇到新的情况，随时告诉我，我们可以继续调整。';
      }
      action = 'chat';
    }

    ConsultingSessionStore.addTurn(session, 'agent', response);
    ConsultingSessionStore.save(session);

    // ══ Product Layer：每次响应后更新习惯循环 + 面板 ══
    const productUpdate = ProductLayer.onResponseComplete(userId, session.session_id, session.stage);

    // 【机制2：结果绑定行为】— 非 chat 阶段在响应末尾追加下次触发提示
    if (action !== 'chat' && productUpdate.habit && productUpdate.habit.trigger_reason) {
      const h = productUpdate.habit;
      session.next_checkin = h;
      // 在完整计划后加上下次约定（不干扰 chat 轮次）
      if (action === 'recommend') {
        response = response + '\n\n**【下次回来的时间】**' + h.next_check_label + '后回来告诉我：' + h.expected_observation;
      }
    }

    return { response, action, session, stage: session.stage, analysisResult, productUpdate };
  },

  // V3-D + V4 统一管道（保留 V2 + V3-B + V3-C，叠加关系理解 + 行为成长）
  _runAnalysis(userId, session, history, insight) {
    const behavior     = session.collected_info.behavior_raw;
    const analysis     = AnalysisEngine.analyze(behavior, history);
    const whyParagraph = BehaviorReasoningEngine.generateWhyParagraph(analysis.primary, analysis.keyPhrase);
    const trendResult  = TrendAnalyzer.analyze(userId);

    // V3-B：路径规划
    const path = ConsultingPathPlanner.plan(
      userId, insight, analysis, trendResult,
      session.turns.filter(function(t) { return t.role === 'user'; }).length
    );

    // V3-C 干预管道
    const dynamicResult  = FamilyDynamicTracker.track(userId, history, analysis);
    const intervention   = BehaviorInterventionEngine.generate(analysis, insight);

    // ══ V3-D：关系结构分析 ══
    const allUserText  = session.turns.filter(function(t) { return t.role === 'user'; }).map(function(t) { return t.content; }).join(' ');
    const familyStruct = FamilyStructureAnalyzer.analyze(allUserText, history, analysis);

    // ══ V4：行为成长系统 ══
    const plan3c   = BehaviorChangePlanGenerator.generate(intervention, analysis, dynamicResult);
    const growth   = BehaviorGrowthEngine.generate(familyStruct, analysis, intervention);
    const v4plan   = BehaviorChangePlanner.plan(familyStruct, analysis, intervention, plan3c);
    const feedback = FeedbackLoopSystem.evaluate(userId);

    // 写入会话状态
    session.family_dynamic      = dynamicResult;
    session.last_intervention   = intervention;
    session.family_structure    = familyStruct;
    session.growth_engine       = growth;
    session.v4_plan             = v4plan;

    // 写入 V2 记忆系统（闭环）
    MemorySystem.add(userId, {
      input:      behavior,
      analysis:   { primary: analysis.primary, secondary: analysis.secondary, legacyType: analysis.legacyType },
      tags:       analysis.tags,
      report_id:  'consult_' + session.session_id,
      rel_type:   familyStruct.relationship_type
    });

    const reportId = generateReportId();
    LeadSystem.create(userId, reportId, analysis, behavior);

    // ══ 统一响应：关系理解优先，行为建议其次，闭环收尾 ══
    const response = this._buildUnifiedResponse(
      analysis, whyParagraph, trendResult, insight, path,
      dynamicResult, intervention, familyStruct, growth, v4plan, feedback, session.collected_info
    );
    return { response, analysis, whyParagraph, trendResult, reportId, path, dynamicResult, intervention, familyStruct, growth, v4plan };
  },

  // V3-B 保留：三层洞察分析回复（供外部调用）
  _buildAnalysisWithInsight(analysis, whyParagraph, trendResult, insight, path, collectedInfo) {
    const patternMeta = AnalysisEngine.PATTERNS[analysis.primary];
    const label = patternMeta ? patternMeta.label : '行为模式';
    const kp    = analysis.keyPhrase || (collectedInfo.behavior_raw || '').slice(0, 20);
    const c     = ContentLibrary.lightReport(analysis);
    const lines = [];
    lines.push('从你描述的情况来看，「' + kp + '」这类情况确实容易让家长感到无力——越用力，好像越没用。');
    lines.push('');
    if (insight && insight.surface) {
      lines.push('**我对这个问题的理解是这样的：**');
      lines.push('- **表层现象：**' + insight.surface);
      lines.push('- **行为层：**' + insight.behavior);
      if (insight.structural_key && insight.structure) {
        lines.push('- **深层结构：**' + insight.structure);
      }
      lines.push('');
    }
    lines.push('**AI 判断：这属于「' + label + '」类行为模式。**');
    lines.push(c.insight);
    lines.push('');
    if (whyParagraph && whyParagraph.mainReason) {
      lines.push('**为什么会这样：**');
      lines.push(whyParagraph.mainReason);
      if (whyParagraph.secondReason) { lines.push(''); lines.push('另一个常被忽略的原因：' + whyParagraph.secondReason); }
      lines.push('');
    }
    if (trendResult && trendResult.trendText && trendResult.totalSessions >= 2) {
      lines.push('**从你的历史记录看：**'); lines.push(trendResult.trendText); lines.push('');
    }
    if (path) { lines.push('**当前咨询阶段：**' + path.current_phase_label); lines.push('下一步：' + path.next_direction); lines.push(''); }
    lines.push('你准备好听具体的应对建议了吗？');
    return lines.join('\n');
  },

  // V3-C NEW：分析 + 干预目标一体化回复（不只是解释，第一步就给出干预方向）
  _buildV3CAnalysisResponse(analysis, whyParagraph, trendResult, insight, path, dynamicResult, intervention, collectedInfo) {
    const patternMeta = AnalysisEngine.PATTERNS[analysis.primary];
    const label = patternMeta ? patternMeta.label : '行为模式';
    const kp    = analysis.keyPhrase || (collectedInfo.behavior_raw || '').slice(0, 20);
    const c     = ContentLibrary.lightReport(analysis);
    const lines = [];

    // 1. 共情开场
    lines.push('从你描述的「' + kp + '」来看，这不是孩子"故意找茬"，背后有一个你可以理解的原因。');
    lines.push('');

    // 2. V3-B 三层洞察
    if (insight && insight.surface) {
      lines.push('**这个问题的三个层次：**');
      lines.push('- **你看到的：**' + insight.surface);
      lines.push('- **行为模式：**' + insight.behavior);
      if (insight.structural_key && insight.structure) {
        lines.push('- **家庭结构：**' + insight.structure);
      }
      lines.push('');
    }

    // 3. V2 核心判断 + WHY
    lines.push('**AI 判断：这属于「' + label + '」模式。**');
    lines.push(c.insight);
    lines.push('');
    if (whyParagraph && whyParagraph.mainReason) {
      lines.push('**为什么：**' + whyParagraph.mainReason);
      if (whyParagraph.secondReason) {
        lines.push('另一个原因：' + whyParagraph.secondReason);
      }
      lines.push('');
    }

    // 4. V3-C 干预目标（第一步行动指引）
    if (intervention && intervention.intervention_goal) {
      lines.push('**干预目标：**' + intervention.intervention_goal);
      lines.push('');
      lines.push('**第一步（今天可以做的）：**');
      lines.push(intervention.steps[0] || '');
      lines.push('');
    }

    // 5. V3-C 家庭动态状态
    if (dynamicResult && dynamicResult.sessions_tracked >= 2) {
      lines.push('**家庭动态：**');
      if (dynamicResult.trend === 'stuck') {
        lines.push('这是你第' + dynamicResult.sessions_tracked + '次和我讨论类似问题——说明需要从更深的家庭互动结构来理解这件事，而不只是处理行为表面。');
      } else if (dynamicResult.trend === 'escalating') {
        lines.push('从你的记录来看，家里同时有多个方向的问题在出现——这需要整体来看，而不是逐一击破。');
      } else if (dynamicResult.trend === 'improving') {
        lines.push('从你的记录来看，你一直在关注同一类问题——聚焦是好事，说明你在真正尝试理解孩子。');
      }
      lines.push('');
    }

    // 6. V2 趋势（回访专属）
    if (trendResult && trendResult.trendText && trendResult.totalSessions >= 2) {
      lines.push(trendResult.trendText);
      lines.push('');
    }

    lines.push('你想先听完整的**行为改变计划**吗？我会给你一个 Day 1→Week 2 的分步路径。');
    return lines.join('\n');
  },

  // ══ V3-D + V4 统一响应构建器（规则1：理解优先 规则2：可执行 规则3：闭环 规则4：引用历史）══
  _buildUnifiedResponse(analysis, whyParagraph, trendResult, insight, path, dynamicResult, intervention, familyStruct, growth, v4plan, feedback, collectedInfo) {
    const patternMeta = AnalysisEngine.PATTERNS[analysis.primary];
    const label = patternMeta ? patternMeta.label : '行为模式';
    const kp    = analysis.keyPhrase || (collectedInfo.behavior_raw || '').slice(0, 20);
    const c     = ContentLibrary.lightReport(analysis);
    const lines = [];

    // ── 1. 共情 ──
    lines.push('从你描述的「' + kp + '」来看，这不是偶然，背后有一个可以理解的家庭动态在运转。');
    lines.push('');

    // ── 2. V3-D：关系结构（理解优先原则）──
    if (familyStruct && familyStruct.relationship_label) {
      lines.push('**【家庭关系结构】** → ' + familyStruct.relationship_label);
      lines.push(familyStruct.structure_model);
      lines.push('');
      lines.push('**行为循环模型：**');
      if (familyStruct.behavior_loops && familyStruct.behavior_loops.length > 0) {
        familyStruct.behavior_loops.forEach(function(loop) { lines.push('› ' + loop); });
      }
      lines.push('');
      lines.push('**情绪动态：**' + (familyStruct.emotional_dynamics ? familyStruct.emotional_dynamics[0] : ''));
      lines.push('');
    }

    // ── 3. V3-B 三层洞察 ──
    if (insight && insight.surface) {
      lines.push('**【三层分析】**');
      lines.push('- **表层：**' + insight.surface);
      lines.push('- **行为层：**' + insight.behavior);
      if (insight.structural_key) lines.push('- **结构层：**' + (insight.structure || ''));
      lines.push('');
    }

    // ── 4. V2 模式判断 + WHY ──
    lines.push('**AI判断：「' + label + '」模式** — ' + c.insight);
    if (whyParagraph && whyParagraph.mainReason) {
      lines.push('**为什么：**' + whyParagraph.mainReason);
      if (whyParagraph.secondReason) lines.push('另一个原因：' + whyParagraph.secondReason);
    }
    lines.push('');

    // ── 5. V4 今日可执行行动（行为必须可执行原则）──
    lines.push('**【今天可以做的】**');
    if (growth && growth.today_action && growth.today_action.length > 0) {
      growth.today_action.forEach(function(a) { lines.push('› ' + a); });
    }
    lines.push('');
    if (growth && growth.comm_strategy) {
      lines.push('**沟通调整：**' + growth.comm_strategy);
      lines.push('');
    }

    // ── 6. V3-C 干预目标 ──
    if (intervention && intervention.intervention_goal) {
      lines.push('**干预目标：**' + intervention.intervention_goal);
      if (intervention.risk_warning) lines.push('⚠ ' + intervention.risk_warning);
      lines.push('');
    }

    // ── 7. V2 趋势（历史引用原则，回访专属）──
    if (trendResult && trendResult.trendText && trendResult.totalSessions >= 2) {
      lines.push('**从你的历史记录：**' + trendResult.trendText);
      lines.push('');
    }

    // ── 8. FeedbackLoop（闭环原则）──
    if (feedback && feedback.message) {
      lines.push('**上次反馈：**' + feedback.message);
      lines.push('');
    }

    // ── 9. 下一步路径（闭环收尾）──
    lines.push('想要完整的 **Day 1→Day 7→30天** 家庭改善计划吗？告诉我，我马上给你。');
    return lines.join('\n');
  },

  // V3-C NEW：行为改变计划完整输出
  _buildV3CChangePlan(analysis, intervention, plan, dynamicResult) {
    const kp    = (analysis && analysis.keyPhrase) || '';
    const lines = [];

    lines.push('**针对「' + kp + '」的行为改变计划：**');
    lines.push('');

    // 干预目标
    if (intervention && intervention.intervention_goal) {
      lines.push('**目标：**' + intervention.intervention_goal);
      lines.push('');
    }

    // Day 1-3
    lines.push('**Day 1–3（立即行动）：**');
    (plan.day1to3 || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // Week 1-2
    lines.push('**Week 1–2（建立新模式）：**');
    (plan.week1to2 || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // 长期策略
    lines.push('**长期策略（' + (plan.total_duration_estimate || '4-6周') + '）：**');
    (plan.long_term || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // 风险提醒
    if (intervention && intervention.risk_warning) {
      lines.push('**⚠ 注意：**' + intervention.risk_warning);
      lines.push('');
    }

    // 家庭动态状态
    if (dynamicResult && dynamicResult.escalation_risk === 'high') {
      lines.push('**家庭关系提醒：**当前家庭中同时存在多个压力点，建议除了处理孩子行为，也关注整体家庭氛围。');
      lines.push('');
    }

    lines.push('尝试第一步后，随时回来告诉我结果——我会根据你的反馈调整下一步。');
    return lines.join('\n');
  },

  // V3-B 保留（供外部调用）
  _buildRecommendationWithPath(c, analysis, path) {
    const kp    = analysis.keyPhrase || '';
    const lines = ['针对「' + kp + '」，这是三条可以从今天开始用的方式：', ''];
    c.advice.forEach(function(a, i) {
      lines.push('**' + (i + 1) + '. ' + a.tag + '**');
      lines.push(a.text);
      if (a.example) lines.push('› 参考说法：「' + a.example + '」');
      lines.push('');
    });
    if (path && path.recommended_actions && path.recommended_actions.length > 0) {
      lines.push('**接下来建议你做：**');
      path.recommended_actions.forEach(function(act) { lines.push('› ' + act); });
      lines.push('');
    }
    lines.push('如果有任何一条想深入聊，或者尝试后有新的情况，随时告诉我。');
    return lines.join('\n');
  },

  // V4 完整计划输出：Day1-3 + Day4-7 + 30天路径 + 关系结构提示
  _buildV4FullPlan(analysis, intervention, plan3c, v4plan, familyStruct, dynamicResult) {
    const kp   = (analysis && analysis.keyPhrase) || '';
    const rt   = familyStruct ? familyStruct.relationship_label : '';
    const lines = [];

    lines.push('**针对「' + kp + '」的完整行为改变路径：**');
    if (rt) lines.push('（基于你家的关系模型：**' + rt + '**）');
    lines.push('');

    // 干预目标
    if (intervention && intervention.intervention_goal) {
      lines.push('**目标：**' + intervention.intervention_goal);
      lines.push('');
    }

    // Day 1-3（V3-C + V4 合并）
    lines.push('**Day 1–3（立即行动）：**');
    (v4plan.day3_plan || plan3c.day1to3 || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // Day 4-7（V4 新增）
    lines.push('**Day 4–7（建立新模式）：**');
    (v4plan.day7_plan || plan3c.week1to2 || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // 30天路径（V4 新增）
    lines.push('**30天家庭改善路径：**');
    (v4plan.day30_plan || plan3c.long_term || []).forEach(function(item) { lines.push('› ' + item); });
    lines.push('');

    // 风险提醒
    if (intervention && intervention.risk_warning) {
      lines.push('**⚠ 注意：**' + intervention.risk_warning);
      lines.push('');
    }

    // 家庭动态
    if (dynamicResult && dynamicResult.escalation_risk === 'high') {
      lines.push('**家庭关系提醒：**当前同时存在多个压力点——建议整体来看，而不是逐一处理行为。');
      lines.push('');
    }

    // 关系结构下一步（闭环）
    if (familyStruct && familyStruct.relationship_type) {
      const nextSteps = {
        control_dynamic:       '核心转变：从"管理孩子行为"→"和孩子一起设计规则"，这是最根本的结构改变。',
        anxious_attachment:    '核心转变：从"保护孩子"→"相信孩子"，每次忍住不帮，就是在给孩子建立能力感。',
        conflict_loop:         '核心转变：从"谁赢得争论"→"双方都被看见"，冲突不需要分胜负。',
        emotional_suppression: '核心转变：从"问题行为管理"→"情绪表达合法化"，让情绪有出口，行为问题自然减少。'
      };
      const ns = nextSteps[familyStruct.relationship_type];
      if (ns) { lines.push('**长期方向：**' + ns); lines.push(''); }
    }

    lines.push('尝试第一步后，回来告诉我结果——我会根据你的反馈调整下一步路径。');
    return lines.join('\n');
  },

  // Product Layer 升级：startSession 集成每日洞察 + 复访检测 + 习惯提醒
  startSession(userId) {
    const historyCtx = MemorySystem.getContext(userId);
    ConsultingSessionStore.reset(userId);
    const session = ConsultingSessionStore.newSession(userId);

    // V3-C：复访检测
    const dynamicResult = FamilyDynamicTracker.track(userId, MemorySystem.getRecent(userId, 5), null);
    const followUp      = ConsultationFollowUpSystem.evaluate(userId, dynamicResult);

    // Product Layer：每日洞察 + 面板 + 习惯提醒
    const productData = ProductLayer.onSessionStart(userId);

    let greeting = AgentResponseGenerator.greeting(historyCtx);

    // 【机制1：轻量入口】— 每日洞察嵌入问候（首次用户无，复访用户必有）
    if (historyCtx.sessionCount >= 1 && productData.daily) {
      const d = productData.daily;
      greeting = '**今日洞察：**' + d.today_insight + '\n\n' + greeting;
    }

    // V3-C：复访回访消息
    if (followUp.follow_up_needed && followUp.follow_up_message) {
      greeting = followUp.follow_up_message + '\n\n' + greeting;
    }

    // 【机制3：周期触发】— 有到期习惯提醒时嵌入
    if (productData.pending && productData.pending.is_due) {
      greeting = '**【该回来了】**' + productData.pending.trigger_reason + '\n\n' + greeting;
    }

    ConsultingSessionStore.addTurn(session, 'agent', greeting);
    ConsultingSessionStore.save(session);
    return { greeting, session, followUp, dynamicResult, productData };
  }
};

/* ================================================================
   V3-D：Relationship OS（关系理解层）
================================================================ */

const RelationshipStructureEngine = {
  TYPES: {
    control_dynamic: {
      label: '控制型家庭',
      description: '父母通过高控制、高期望维持家庭秩序，孩子通过叛逆或顺从来应对',
      triggers: ['不听话', '叛逆', '不让', '必须', '要求', '规定', '管', '控制', '不允许', '自己决定', '命令'],
      behavior_loop: '父母要求 → 孩子抵抗 → 父母加压 → 孩子爆发或退缩 → 表面服从，内部积累',
      emotional_dynamic: '父母：焦虑→控制 / 孩子：压抑→爆发'
    },
    anxious_attachment: {
      label: '焦虑依附型',
      description: '亲子关系中存在情感过度依赖，分离焦虑或过度保护',
      triggers: ['黏', '分离', '焦虑', '担心', '害怕', '保护', '不放心', '离不开', '太依赖', '依赖'],
      behavior_loop: '孩子依赖→父母回应→孩子更依赖 / 父母过保护→孩子退缩→父母更担心',
      emotional_dynamic: '父母：担忧→过度介入 / 孩子：不安→寻求确认'
    },
    conflict_loop: {
      label: '冲突循环型',
      description: '家庭中存在重复性冲突模式，双方互相激化',
      triggers: ['吵架', '冲突', '发脾气', '大哭', '顶嘴', '骂', '打', '又', '每次', '总是', '循环', '反复'],
      behavior_loop: '触发事件 → 情绪升级 → 冲突爆发 → 短暂平静 → 再次触发',
      emotional_dynamic: '双方均处于高唤起状态，理性通道关闭'
    },
    emotional_suppression: {
      label: '情绪压抑型',
      description: '家庭中情绪不被允许表达，孩子通过沉默或身体化症状应对',
      triggers: ['不说话', '沉默', '不表达', '不哭', '压着', '忍着', '内向', '封闭', '不沟通', '什么都不说'],
      behavior_loop: '情绪发生 → 压抑不表达 → 行为问题或躯体化 → 父母困惑 → 追问→更封闭',
      emotional_dynamic: '父母：回避情绪 / 孩子：隐藏真实感受'
    }
  },

  classify(input, history) {
    const text = (input + ' ' + (history || []).map(function(m) { return m.content || ''; }).join(' ')).toLowerCase();
    const scores = {};
    const self = this;
    Object.keys(this.TYPES).forEach(function(key) {
      scores[key] = self.TYPES[key].triggers.filter(function(kw) { return text.indexOf(kw) >= 0; }).length;
    });
    let best = 'conflict_loop', bestScore = -1;
    Object.keys(scores).forEach(function(k) { if (scores[k] > bestScore) { bestScore = scores[k]; best = k; } });
    return {
      type_key:   best,
      type_data:  this.TYPES[best],
      all_scores: scores,
      confidence: bestScore >= 2 ? 'high' : bestScore === 1 ? 'medium' : 'low'
    };
  }
};

const BehaviorPatternGraph = {
  SPECIFIC_LOOPS: {
    emotional_explosion: '孩子感到被忽视→情绪爆发→父母镇压→孩子更不被理解→下次爆发更强',
    homework_conflict:   '父母催促→孩子抵抗→双方升级→冲突爆发→作业依然未完成→第二天循环',
    phone_addiction:     '孩子使用手机→父母制止→孩子隐瞒→父母发现→规则升级→孩子更偷用',
    withdrawal:          '孩子遭遇压力→退缩不说→父母追问→孩子更封闭→误解加深',
    autonomy_resist:     '孩子主张自主→父母否定→孩子反抗→父母加控制→孩子更对抗',
    school_refusal:      '学校压力→回避上学→父母强制→焦虑增加→更不想去',
    aggression:          '孩子挫败→攻击行为→惩罚→孩子羞耻→下次更激烈',
    anxiety_worry:       '压力事件→孩子焦虑→安慰/忽视→焦虑未消解→泛化到新领域',
    sibling_conflict:    '资源竞争/关注不均→兄弟姐妹冲突→父母裁判→一方感到不公→冲突升级',
    lying:               '孩子担心惩罚→说谎→父母发现→严厉惩罚→孩子更擅长说谎',
    attention_issues:    '环境干扰多→注意力分散→批评→孩子自我怀疑→更难集中'
  },

  CONFLICT_CHAINS: {
    control_dynamic:       ['父母提出要求', '孩子不满/抵抗', '父母加大压力', '孩子爆发或顺从性退缩', '表面平静，内部积累'],
    anxious_attachment:    ['孩子遇到压力', '父母过度介入', '孩子失去锻炼机会', '依赖增加', '父母更担心'],
    conflict_loop:         ['日常触发事件', '双方情绪升温', '语言/行为升级', '冲突高峰', '疲惫和解', '触发事件重复'],
    emotional_suppression: ['情绪事件发生', '孩子压抑不表达', '行为问题出现', '父母看到行为', '追问→更封闭']
  },

  build(relationshipResult, primaryBehavior) {
    const rt   = relationshipResult.type_key;
    const loop = this.SPECIFIC_LOOPS[primaryBehavior] || '行为触发 → 亲子反应 → 模式固化 → 问题反复';
    return {
      relationship_type:      rt,
      parent_child_loop:      relationshipResult.type_data.behavior_loop,
      behavior_specific_loop: loop,
      conflict_chain:         this.CONFLICT_CHAINS[rt] || ['行为出现', '双方反应', '模式固化'],
      behavior_loops:         [relationshipResult.type_data.behavior_loop, loop]
    };
  }
};

const FamilyStructureAnalyzer = {
  analyze(input, history, behaviorAnalysis) {
    const relResult    = RelationshipStructureEngine.classify(input, history);
    const primary      = behaviorAnalysis ? behaviorAnalysis.primary : 'emotional_explosion';
    const patternGraph = BehaviorPatternGraph.build(relResult, primary);

    return {
      relationship_type:  relResult.type_key,
      relationship_label: relResult.type_data.label,
      structure_model:    relResult.type_data.description,
      behavior_loops:     patternGraph.behavior_loops,
      conflict_chain:     patternGraph.conflict_chain,
      emotional_dynamics: [relResult.type_data.emotional_dynamic],
      confidence:         relResult.confidence,
      pattern_graph:      patternGraph,
      // 规格输出格式
      relationship_output: {
        relationship_type:  relResult.type_key,
        structure_model:    relResult.type_data.description,
        behavior_loops:     patternGraph.behavior_loops,
        emotional_dynamics: [relResult.type_data.emotional_dynamic]
      }
    };
  }
};

/* ================================================================
   V4：Behavior Growth System（行为成长层）
================================================================ */

const BehaviorGrowthEngine = {
  TODAY_ACTIONS: {
    control_dynamic:       '今天只提一次要求，不重复催促，观察孩子的自主反应',
    anxious_attachment:    '今天给孩子15分钟"不被打扰"的时间，不问、不看、不干预',
    conflict_loop:         '今天当冲突苗头出现时，先说"我们停一下"，给双方3分钟冷却',
    emotional_suppression: '今天主动分享你自己的一个感受，给孩子示范情绪可以被说出来'
  },
  COMM_STRATEGIES: {
    control_dynamic:       '从"你必须"换成"我们来决定"——让孩子参与规则制定，减少权力对抗',
    anxious_attachment:    '用"我相信你能处理"替代"让我来帮你"——传递信心而非保护',
    conflict_loop:         '冲突升温前主动降温：放低声音、蹲下来、用"我"开头而不是"你总是"',
    emotional_suppression: '创造"情绪合法"的时刻：今晚饭桌上问"今天有什么难受的事吗？"'
  },
  CONFLICT_METHODS: {
    control_dynamic:       '当孩子反抗时：停止争执，5分钟后再谈，用"我看到你想要…"开始',
    anxious_attachment:    '当孩子退缩时：坐在旁边不说话，用陪伴代替建议',
    conflict_loop:         '当冲突爆发时：让自己离开现场60秒，回来时换一种语调重新开始',
    emotional_suppression: '当孩子沉默时：不追问，而是做一件孩子喜欢的事，让关系温度先升上来'
  },

  generate(familyStructure, behaviorAnalysis, intervention) {
    const rt = familyStructure ? familyStructure.relationship_type : 'conflict_loop';
    const base_today = intervention && intervention.steps[0] ? [intervention.steps[0]] : [];
    const rt_today   = this.TODAY_ACTIONS[rt] ? [this.TODAY_ACTIONS[rt]] : [];
    const today_action = base_today.concat(rt_today).filter(function(x, i, a) { return a.indexOf(x) === i; }).slice(0, 3);

    return {
      today_action:    today_action,
      comm_strategy:   this.COMM_STRATEGIES[rt]   || '先理解再回应，听完孩子说完再开口',
      conflict_method: this.CONFLICT_METHODS[rt]  || '情绪高峰时暂停，平静后再沟通',
      relationship_type: rt,
      // 规格输出格式（short/long_term 由 BehaviorChangePlanner 填充）
      growth_output: {
        today_action:    today_action,
        short_term_plan: [],
        long_term_plan:  [],
        risk_warning:    intervention ? (intervention.risk_warning || '') : ''
      }
    };
  }
};

const BehaviorChangePlanner = {
  DAY7_PLANS: {
    control_dynamic: [
      '第4天：和孩子一起制定本周一件事的规则，孩子说，你记录',
      '第5天：当孩子做到约定事项时，说"我注意到你…"而不是"终于"',
      '第7天：回顾——有几次你没有重复催促？孩子的反应有什么不同？'
    ],
    anxious_attachment: [
      '第4天：让孩子独立完成一件你之前会帮的事，你在同一房间但不介入',
      '第5天：孩子来求助时，先问"你有没有先试过？"再决定是否帮',
      '第7天：记录孩子这周自己解决了几件事'
    ],
    conflict_loop: [
      '第4天：找一个"非冲突"时间谈上次冲突——不评判，只描述你的感受',
      '第5天：和孩子一起制定"家庭冲突暂停协议"（双方同意的暂停信号）',
      '第7天：回顾——这周冲突频率有没有变化？触发点有什么规律？'
    ],
    emotional_suppression: [
      '第4天：睡前和孩子各说一件今天"有点难受的事"，建立情绪分享习惯',
      '第5天：孩子有情绪时，先点名情绪"你看起来有点委屈"，再等待',
      '第7天：孩子有没有主动说过一次自己的感受？'
    ]
  },
  DAY30_PLANS: {
    control_dynamic:       ['建立月度家庭会议，孩子有投票权', '孩子自主空间扩大——从作业到日常决策', '父母从"管理者"转型为"顾问"角色'],
    anxious_attachment:    ['孩子独立完成3件以前依赖父母的事', '父母减少主动介入频率', '建立孩子"能力记录本"：记录每次独立成功'],
    conflict_loop:         ['家庭冲突频率减少60%', '建立"冲突后修复"习惯：24小时内主动和解', '孩子学会说"我需要时间冷静"'],
    emotional_suppression: ['家庭建立每周1次情绪分享时间', '孩子可以说出3种以上不同的感受词', '父母用"情绪命名"回应孩子成为习惯']
  },

  plan(familyStructure, behaviorAnalysis, intervention, plan3c) {
    const rt   = familyStructure ? familyStructure.relationship_type : 'conflict_loop';
    const base = plan3c ? (plan3c.day1to3 || []) : [];
    const extra_day3 = { control_dynamic: ['第2天：观察孩子有没有主动来找你，不主动上前'], anxious_attachment: ['第2天：记录下你几次想介入但忍住了的时刻'], conflict_loop: ['第2天：冲突前说出感受"我现在也很紧张"，而不是评价'], emotional_suppression: ['第2天：在孩子面前读一篇关于情绪的小故事'] };
    const day3  = base.concat(extra_day3[rt] || []).slice(0, 4);
    const day7  = this.DAY7_PLANS[rt]  || ['第4-7天：持续实践，记录变化，不追求立刻见效'];
    const day30 = this.DAY30_PLANS[rt] || ['30天内建立家庭沟通新模式', '孩子行为问题频率显著降低'];

    return {
      day3_plan:  day3,
      day7_plan:  day7,
      day30_plan: day30,
      total_duration: '30天家庭改善路径',
      risk_level: plan3c ? plan3c.risk_level : 'medium',
      // 规格输出格式
      growth_output: {
        today_action:    day3.slice(0, 1),
        short_term_plan: day3.concat(day7),
        long_term_plan:  day30,
        risk_warning:    intervention ? (intervention.risk_warning || '') : ''
      }
    };
  }
};

const FeedbackLoopSystem = {
  KEY: 'aipiwen_feedback_v1_',

  record(userId, sessionId, feedbackType, content) {
    // feedbackType: 'tried' | 'not_tried' | 'improved' | 'no_change' | 'worse'
    try {
      const key  = this.KEY + userId;
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      data.push({ session_id: sessionId, feedback_type: feedbackType, content: content || '', recorded_at: new Date().toISOString() });
      if (data.length > 20) data.splice(0, data.length - 20);
      localStorage.setItem(key, JSON.stringify(data));
      return { ok: true };
    } catch(e) { return { ok: false }; }
  },

  trackChange(userId) {
    try {
      const key  = this.KEY + userId;
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      if (!data.length) return { has_feedback: false, trend: 'no_data', improvement_rate: 0 };
      const improved = data.filter(function(d) { return d.feedback_type === 'improved'; }).length;
      const tried    = data.filter(function(d) { return d.feedback_type === 'tried' || d.feedback_type === 'improved'; }).length;
      const rate     = Math.round(improved / data.length * 100);
      return {
        has_feedback:     true,
        total_feedback:   data.length,
        tried_count:      tried,
        improved_count:   improved,
        improvement_rate: rate,
        trend:            rate >= 60 ? 'improving' : rate >= 30 ? 'partial' : 'stuck',
        last_feedback:    data[data.length - 1]
      };
    } catch(e) { return { has_feedback: false, trend: 'no_data', improvement_rate: 0 }; }
  },

  evaluate(userId) {
    const change = this.trackChange(userId);
    if (!change.has_feedback) return { message: null, needs_adjustment: false };
    if (change.trend === 'improving') {
      return { message: '从你的反馈来看，这些方法对你家是有效的——继续保持，变化在2-4周后更明显。', needs_adjustment: false, next_step: '深化现有方法' };
    } else if (change.trend === 'partial') {
      return { message: '你已经在尝试了，部分有效——下一步找到哪个具体步骤阻力最大，我们来调整。', needs_adjustment: true, next_step: '调整阻力最大的环节' };
    } else {
      return { message: '如果已经尝试但没有变化，说明需要从关系结构而不是行为表面来理解问题。', needs_adjustment: true, next_step: '回到关系结构分析' };
    }
  }
};

/* ================================================================
   Product Layer — 产品化留存系统
================================================================ */

/* ── 1. Daily Insight System（每日洞察系统）── */
const DailyInsightSystem = {
  KEY: 'aipiwen_daily_v1_',

  INSIGHTS_BY_PATTERN: {
    emotional_explosion: [
      '情绪爆发不是孩子的问题——是他在告诉你，他现在需要被看见，而不是被纠正。',
      '孩子爆发之前，通常有3-5个信号被忽视了。今天试着注意这些信号。',
      '当孩子爆发时，你的声音越低，他的情绪会越快平复。'
    ],
    homework_conflict: [
      '作业冲突的核心不是作业，是谁控制谁的问题。今天试试：让孩子决定什么时候开始写。',
      '孩子拒绝写作业时，通常是因为"被催"比"写作业"更让他难受。',
      '今天不催作业，只问"你需要我帮什么吗"——观察孩子的反应。'
    ],
    phone_addiction: [
      '手机不是问题，是孩子在用手机填补某种需求。今天问问自己：他在填补什么？',
      '没收手机会短期有效，但长期会让孩子更依赖——今天试试谈判而不是没收。',
      '孩子玩手机时，你们的关系质量比屏幕时间更影响他的使用习惯。'
    ],
    withdrawal: [
      '孩子沉默时，不需要你马上解决——只需要你在场。今天陪着他，什么都不说。',
      '青春期的孩子需要你知道他的事，但不需要你参与所有事。这条线今天可以试着找找。',
      '孩子不说话，通常不是因为不信任你——是因为说了也没用。让他知道说了有用。'
    ],
    autonomy_resist: [
      '孩子反抗，是在练习成为他自己——这不是叛逆，是发展。今天给他一件事自己决定。',
      '每次你赢得争论，孩子就输掉一点自我。今天试着输一次。',
      '孩子的自主感越强，他对家庭规则的配合度越高——反直觉但有效。'
    ],
    aggression: [
      '攻击行为背后通常是受伤或羞耻——孩子用力量来保护自己的脆弱。',
      '不要在冲突高峰期讲道理——等他平静后，再一起回顾发生了什么。',
      '今天问孩子："上次发生那件事，你当时心里是什么感受？"只问，不评价。'
    ],
    anxiety_worry: [
      '焦虑的孩子需要确定感。今天给他一个今天的小计划，帮他知道"接下来会发生什么"。',
      '孩子的焦虑通常比他表现出来的更多。他说没事，不代表真的没事。',
      '今天不要急着让孩子"别担心"——先说"我听到了，这件事确实不容易"。'
    ],
    school_refusal: [
      '不愿上学的孩子，通常不是怕学习——是在回避某种让他痛苦的关系或感受。今天问问是什么。',
      '强制上学短期有效，长期会让孩子更抗拒——今天先建立安全感。',
      '学校的意义是什么？今天和孩子聊聊他认为上学最好的一件事是什么。'
    ],
    sibling_conflict: [
      '兄弟姐妹冲突的根源通常是"我没有被公平对待"——今天问每个孩子：你觉得最不公平的是什么？',
      '不要试图裁判谁对谁错——试着让两个孩子一起解决问题。',
      '每天给每个孩子5分钟"只属于他"的时间，冲突会自然减少。'
    ],
    lying: [
      '孩子说谎，通常是因为说实话的代价太高。今天检查一下：他说实话你会怎么反应？',
      '惩罚说谎会让孩子变得更擅长说谎——今天试试奖励诚实。',
      '孩子最愿意对谁说实话？那个人做了什么让他感到安全？'
    ],
    attention_issues: [
      '注意力分散不是懒——是大脑调节系统的问题。今天减少一个干扰源，看看有没有变化。',
      '孩子能专注多久，和他的兴趣程度直接相关。今天找一件他能专注的事，观察他。',
      '批评注意力分散会让孩子更分散——今天试着说"你刚才专注了3分钟，很好"。'
    ],
    emotional_sensitive: [
      '高敏感的孩子不是"太脆弱"——他们感受到了更多，需要更多的调节支持。',
      '今天不要说"不就是这点小事吗"——试试"我知道这对你来说很不容易"。',
      '高敏感孩子需要预告而不是突然的变化——今天提前告诉他接下来会发生什么。'
    ]
  },

  FAMILY_STATUS: {
    new:       '家庭关系处于探索期——你正在开始理解孩子，这本身就是改变的开始。',
    stuck:     '家庭在同一个模式里循环——改变需要从关系结构入手，而不只是行为表面。',
    escalating:'家庭中有多个压力点同时出现——需要整体来看，找到最影响全局的那一个。',
    improving: '你一直在关注孩子——持续的关注是最好的干预，变化正在积累中。',
    evolving:  '家庭模式正在变化中——变化期通常会有些不稳定，这是正常的。'
  },

  generate(userId) {
    try {
      const today = new Date().toDateString();
      const key   = this.KEY + userId;
      const stored = JSON.parse(localStorage.getItem(key) || 'null');

      // 今天已生成过，直接返回
      if (stored && stored.date === today) return stored.data;

      // 基于历史生成今日洞察
      const recent   = MemorySystem.getRecent(userId, 3);
      const dynamic  = FamilyDynamicTracker.track(userId, recent, null);
      const primary  = recent.length > 0 ? (recent[recent.length - 1].analysis || {}).primary : null;
      const pool     = primary && this.INSIGHTS_BY_PATTERN[primary]
        ? this.INSIGHTS_BY_PATTERN[primary]
        : this.INSIGHTS_BY_PATTERN['emotional_explosion'];

      // 每天轮换（基于日期hash选取）
      const dayIndex = new Date().getDate() % pool.length;
      const insight  = pool[dayIndex];
      const status   = this.FAMILY_STATUS[dynamic.trend] || this.FAMILY_STATUS['new'];

      // 今日行动提示（基于pattern）
      const tipMap = {
        emotional_explosion: '今天：在孩子情绪爆发前，先蹲下来说"我在这里"。',
        homework_conflict:   '今天：不催作业，只问"今天学校怎么样？"',
        phone_addiction:     '今天：和孩子约定一个"无手机家庭时间"，你也放下手机。',
        withdrawal:          '今天：不问问题，只陪伴。坐在孩子旁边15分钟。',
        autonomy_resist:     '今天：给孩子一件事自己决定，你不参与。',
        default:             '今天：观察孩子一次，不评价，只记录你看到了什么。'
      };
      const one_action_tip = tipMap[primary] || tipMap['default'];

      const data = { today_insight: insight, family_status: status, one_action_tip: one_action_tip };
      localStorage.setItem(key, JSON.stringify({ date: today, data: data }));
      return data;
    } catch(e) {
      return {
        today_insight:  '每一次你选择理解孩子而不是纠正他，都是在建立长期的信任。',
        family_status:  '家庭关系需要时间——你今天花在理解上的时间，会在未来几个月里显现。',
        one_action_tip: '今天：用好奇而不是担心的眼光观察孩子一次。'
      };
    }
  }
};

/* ── 2. Weekly Family Report（家庭周报系统）── */
const WeeklyFamilyReport = {
  KEY: 'aipiwen_weekly_v1_',

  generate(userId) {
    try {
      const key    = this.KEY + userId;
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      const now    = Date.now();

      // 7天内已生成过
      if (stored && (now - stored.generated_at) < 7 * 24 * 3600 * 1000) return stored.report;

      const recent  = MemorySystem.getRecent(userId, 10);
      const dynamic = FamilyDynamicTracker.track(userId, recent, null);
      const fbChg   = FeedbackLoopSystem.trackChange(userId);

      // 趋势摘要
      const trendMap = {
        new:       '这是你使用AIPIWEN的第一周——系统正在建立对你家庭的理解。',
        stuck:     '这周的模式和上周类似——这说明需要从更深层的家庭结构来入手，而不只是处理行为。',
        escalating:'这周出现了多种不同类型的行为问题——家庭整体压力偏高，建议本周重点关注一件事。',
        improving: '这周的问题集中在同一类型上——说明你在持续关注一个方向，这是改变的前提。',
        evolving:  '这周的行为模式在变化——这可能是一个转折点，持续观察。'
      };
      const trend_summary = trendMap[dynamic.trend] || trendMap['new'];

      // 改善情况
      let improvement = '本周暂无反馈数据——每次咨询后告诉我你尝试了什么，系统会帮你追踪改善。';
      if (fbChg.has_feedback) {
        if (fbChg.improvement_rate >= 60)      improvement = '本周改善率 ' + fbChg.improvement_rate + '%——你在有效地执行调整策略，继续保持。';
        else if (fbChg.improvement_rate >= 30) improvement = '本周改善率 ' + fbChg.improvement_rate + '%——部分方法有效，下周重点找出哪一个阻力最大。';
        else                                   improvement = '本周方法执行后变化不明显——这通常意味着需要从更深的家庭结构来调整策略。';
      }

      // 风险预警
      const risk_warning = dynamic.escalation_risk === 'high'
        ? '本周家庭压力较高——建议这周先减少要求，让家庭温度降下来，再推进行为调整。'
        : dynamic.is_stuck
        ? '本周行为模式反复——说明单纯的行为干预可能不够，可以考虑预约深度咨询。'
        : '';

      // 下周重点
      const focusMap = {
        new:       '下周重点：坚持描述孩子行为，让系统建立更准确的家庭理解。',
        stuck:     '下周重点：从关系结构切入，而不是行为表面——试着找到冲突背后的"循环模型"。',
        escalating:'下周重点：选择压力最大的一件事来处理，暂时放下其他。',
        improving: '下周重点：深化现有方向，在同类型问题上建立新的习惯。',
        evolving:  '下周重点：保持观察，记录变化，为下阶段的调整积累数据。'
      };
      const next_week_focus = focusMap[dynamic.trend] || focusMap['new'];

      const report = { trend_summary, improvement, risk_warning, next_week_focus,
        generated_at: new Date().toISOString(), sessions_this_week: recent.length };
      localStorage.setItem(key, JSON.stringify({ generated_at: now, report: report }));
      return report;
    } catch(e) {
      return {
        trend_summary:   '本周数据收集中——继续使用系统，周报会越来越准确。',
        improvement:     '暂无评估数据。',
        risk_warning:    '',
        next_week_focus: '继续描述孩子的行为，让AI建立更准确的理解。'
      };
    }
  },

  // 强制重新生成（用于手动刷新）
  refresh(userId) {
    try { localStorage.removeItem(this.KEY + userId); } catch(e) {}
    return this.generate(userId);
  }
};

/* ── 3. Behavior Habit Loop（行为习惯循环系统）── */
const BehaviorHabitLoop = {
  KEY: 'aipiwen_habit_v1_',

  SCHEDULES: {
    first_session: { days: 1,  reason: '第一次咨询后，明天再来告诉我孩子今天的反应如何。', observation: '观察孩子今天的情绪和行为，有没有什么新的变化？' },
    after_analyze: { days: 3,  reason: '行为模式需要3天的观察来验证——3天后回来复盘。',   observation: '这3天里，你尝试了什么？孩子有什么反应？' },
    after_plan:    { days: 7,  reason: '7天是行为改变的第一个检验点——7天后我们一起回顾。',observation: '7天后回来告诉我：Day1-3的方法执行得怎么样？孩子有没有变化？' },
    monthly:       { days: 30, reason: '30天是家庭模式改变的基本周期——一个月后做一次全面复盘。', observation: '30天后回来：整体家庭关系有没有在变好的感觉？' }
  },

  schedule(userId, sessionStage, sessionId) {
    try {
      const key     = this.KEY + userId;
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      const now     = new Date();

      let schedType = 'after_analyze';
      if (history.length === 0)              schedType = 'first_session';
      else if (sessionStage === 'complete')  schedType = 'after_plan';
      else if (history.length >= 4)          schedType = 'monthly';

      const sched    = this.SCHEDULES[schedType];
      const nextDate = new Date(now.getTime() + sched.days * 24 * 3600 * 1000);

      const record = {
        session_id:           sessionId,
        scheduled_at:         now.toISOString(),
        next_check_time:      nextDate.toISOString(),
        next_check_label:     sched.days === 1 ? '明天' : sched.days + '天后',
        trigger_reason:       sched.reason,
        expected_observation: sched.observation,
        stage:                sessionStage
      };

      history.push(record);
      if (history.length > 30) history.splice(0, history.length - 30);
      localStorage.setItem(key, JSON.stringify(history));

      return {
        next_check_time:      nextDate.toISOString(),
        next_check_label:     record.next_check_label,
        trigger_reason:       sched.reason,
        expected_observation: sched.observation
      };
    } catch(e) {
      return { next_check_time: '', trigger_reason: '3天后回来复盘。', expected_observation: '观察孩子有没有变化。' };
    }
  },

  // 获取最近一条未完成的提醒
  getPending(userId) {
    try {
      const key     = this.KEY + userId;
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      if (!history.length) return null;
      const last = history[history.length - 1];
      const due  = new Date(last.next_check_time) <= new Date();
      return { ...last, is_due: due };
    } catch(e) { return null; }
  }
};

/* ── 4. Family Progress Dashboard（家庭成长面板）── */
const FamilyProgressDashboard = {
  KEY: 'aipiwen_dash_v1_',

  compute(userId) {
    try {
      const recent    = MemorySystem.getRecent(userId, 20);
      const dynamic   = FamilyDynamicTracker.track(userId, recent, null);
      const fbChange  = FeedbackLoopSystem.trackChange(userId);
      const sessions  = recent.length;

      // ── 情绪分数（0-100）──
      // 基础分 50，每次咨询 +5（说明在用），改善反馈 +10，stuck -10，escalating -5
      let emotional_score = 50 + Math.min(sessions * 5, 20);
      if (fbChange.improvement_rate >= 60) emotional_score += 15;
      else if (fbChange.improvement_rate >= 30) emotional_score += 5;
      if (dynamic.trend === 'stuck')      emotional_score -= 10;
      if (dynamic.trend === 'escalating') emotional_score -= 5;
      if (dynamic.trend === 'improving' || dynamic.trend === 'evolving') emotional_score += 5;
      emotional_score = Math.max(10, Math.min(95, emotional_score));

      // ── 冲突频率 ──
      const conflict_map = {
        new: '尚无足够数据', stuck: '频率较高（重复模式）',
        escalating: '频率上升（多方向压力）', improving: '频率稳定',
        evolving: '频率变化中（转折期）'
      };
      const conflict_frequency = conflict_map[dynamic.trend] || '数据收集中';

      // ── 稳定度 ──
      const stab = dynamic.stability_score || 50;
      const stability_index = stab >= 70 ? '稳定' : stab >= 40 ? '波动中' : '不稳定';

      // ── 改善曲线（最近5次会话的score变化）──
      const curve_points = [];
      for (let i = 0; i < Math.min(sessions, 5); i++) {
        const base = 40 + i * 8;
        const bump = fbChange.has_feedback ? fbChange.improvement_rate * 0.3 : 0;
        curve_points.push(Math.min(95, Math.round(base + bump)));
      }
      if (!curve_points.length) curve_points.push(50);

      const dashboard = {
        emotional_score:    emotional_score,
        conflict_frequency: conflict_frequency,
        stability_index:    stability_index,
        improvement_curve:  curve_points,
        sessions_total:     sessions,
        dynamic_trend:      dynamic.trend,
        escalation_risk:    dynamic.escalation_risk,
        last_updated:       new Date().toISOString()
      };

      // 缓存到 localStorage（供 consulting.html 读取）
      try { localStorage.setItem(this.KEY + userId, JSON.stringify(dashboard)); } catch(e) {}
      return dashboard;
    } catch(e) {
      return {
        emotional_score: 50, conflict_frequency: '数据收集中',
        stability_index: '稳定', improvement_curve: [50],
        sessions_total: 0, dynamic_trend: 'new', escalation_risk: 'low',
        last_updated: new Date().toISOString()
      };
    }
  },

  // 供 HTML 页面直接读取缓存
  getCached(userId) {
    try { return JSON.parse(localStorage.getItem(this.KEY + userId) || 'null'); } catch(e) { return null; }
  }
};

/* ── Product Layer 统一入口（聚合四大系统） ── */
const ProductLayer = {
  // 每次 startSession 时调用 — 返回轻量入口数据
  onSessionStart(userId) {
    const daily     = DailyInsightSystem.generate(userId);
    const pending   = BehaviorHabitLoop.getPending(userId);
    const dashboard = FamilyProgressDashboard.compute(userId);
    return { daily, pending, dashboard };
  },

  // 每次 processInput 完成后调用 — 更新习惯循环
  onResponseComplete(userId, sessionId, sessionStage) {
    const habit     = BehaviorHabitLoop.schedule(userId, sessionStage, sessionId);
    const dashboard = FamilyProgressDashboard.compute(userId);
    return { habit, dashboard };
  },

  // 每7天调用一次 — 生成周报
  getWeeklyReport(userId) {
    return WeeklyFamilyReport.generate(userId);
  }
};

/* ================================================================
   挂载到全局
================================================================ */
window.AIPIWEN = {
  // Core (V1 + V2)
  UserSystem,
  MemorySystem,
  AnalysisEngine,
  ContentLibrary,
  LeadSystem,
  BehaviorReasoningEngine,
  TrendAnalyzer,
  // Agent Layer (V3-A)
  ConsultingSessionStore,
  InformationSufficiencyEvaluator,
  AgentResponseGenerator,
  // Insight Layer (V3-B)
  ConsultingInsightEngine,
  ContradictionDetector,
  PriorityQuestionSelector,
  ConsultingPathPlanner,
  // Intervention Layer (V3-C)
  BehaviorInterventionEngine,
  FamilyDynamicTracker,
  ConsultationFollowUpSystem,
  BehaviorChangePlanGenerator,
  // Relationship OS (V3-D)
  RelationshipStructureEngine,
  BehaviorPatternGraph,
  FamilyStructureAnalyzer,
  // Behavior Growth System (V4)
  BehaviorGrowthEngine,
  BehaviorChangePlanner,
  FeedbackLoopSystem,
  // Product Layer（留存系统）
  DailyInsightSystem,
  WeeklyFamilyReport,
  BehaviorHabitLoop,
  FamilyProgressDashboard,
  ProductLayer,
  // Unified Agent
  AIPIWENConsultingAgent,
  generateReportId,
  truncate
};
