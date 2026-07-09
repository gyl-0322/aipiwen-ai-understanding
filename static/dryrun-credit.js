(function () {
  const RULES = {
    INITIAL_GRANT: { amount: 500, label: "初始注册体验额度" },
    AI_INTERPRETATION_FULL: { amount: -50, label: "完整 AI 解读方案" },
    CUSTOMER_QUESTION_SCRIPT: { amount: -10, label: "单个客户问题话术" },
    REGENERATE_SCRIPT: { amount: -5, label: "重新生成话术" },
    TRAINING_SCORE: { amount: -10, label: "解读训练 AI 评分" },
    SAFETY_TEST_SCORE: { amount: -5, label: "安全边界测试评分" },
    INVITE_REGISTERED: { amount: 100, label: "邀请新从业者注册" },
    INVITEE_FIRST_INTERPRETATION: { amount: 100, label: "被邀请人完成首次解读" },
    CERTIFICATION_REWARD_DISPLAY: { amount: 300, label: "认证奖励展示，不真实发放" }
  };

  function store() {
    return window.AIPIWEN && window.AIPIWEN.DryrunStore;
  }

  function now() {
    return new Date().toISOString();
  }

  function createCreditLog({ wallet, userId, amount, type, description, refId }) {
    return {
      logId: `cl_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      walletId: wallet.walletId,
      userId,
      amount,
      balanceAfter: wallet.creditBalance,
      type,
      refId: refId || null,
      description,
      createdAt: now()
    };
  }

  function getState() {
    const dryrunStore = store();
    return dryrunStore ? dryrunStore.getDryrunState() : null;
  }

  function saveState(state) {
    const dryrunStore = store();
    return dryrunStore ? dryrunStore.saveDryrunState(state) : state;
  }

  function initWallet(userId) {
    const state = getState();
    if (!state || !userId) return null;
    if (state.wallet && state.wallet.userId === userId) return state.wallet;

    const wallet = {
      walletId: `w_${Date.now()}`,
      userId,
      creditBalance: 500,
      totalEarned: 500,
      totalSpent: 0,
      status: "active",
      createdAt: now()
    };
    const initialLog = createCreditLog({
      wallet,
      userId,
      amount: 500,
      type: "INITIAL_GRANT",
      description: "内测注册获得 500 mock 积分",
      refId: userId
    });

    saveState({
      ...state,
      wallet,
      creditLogs: [initialLog]
    });

    return wallet;
  }

  function getWallet() {
    const state = getState();
    return state ? state.wallet : null;
  }

  function getCreditBalance() {
    const wallet = getWallet();
    return wallet ? wallet.creditBalance : 0;
  }

  function changeCredit(amount, type, description, refId) {
    const state = getState();
    if (!state || !state.user || !state.wallet) return null;

    const wallet = { ...state.wallet };
    const nextBalance = wallet.creditBalance + amount;
    if (amount < 0 && nextBalance < 0) return null;

    wallet.creditBalance = nextBalance;
    if (amount > 0) {
      wallet.totalEarned += amount;
    } else {
      wallet.totalSpent += Math.abs(amount);
    }

    const log = createCreditLog({
      wallet,
      userId: state.user.userId,
      amount,
      type,
      description,
      refId
    });

    saveState({
      ...state,
      wallet,
      creditLogs: [...(state.creditLogs || []), log]
    });

    return { wallet, log };
  }

  function addCredit(amount, type, description, refId) {
    const normalizedAmount = Math.abs(Number(amount || 0));
    if (!normalizedAmount) return null;
    return changeCredit(normalizedAmount, type || "MANUAL_ADD", description || "mock 积分增加", refId);
  }

  function spendCredit(amount, type, description, refId) {
    const normalizedAmount = Math.abs(Number(amount || 0));
    if (!normalizedAmount) return null;
    return changeCredit(-normalizedAmount, type || "MANUAL_SPEND", description || "mock 积分消耗", refId);
  }

  function canSpend(amount) {
    return getCreditBalance() >= Math.abs(Number(amount || 0));
  }

  function getCreditLogs() {
    const state = getState();
    return state && Array.isArray(state.creditLogs) ? state.creditLogs : [];
  }

  window.AIPIWEN = window.AIPIWEN || {};
  window.AIPIWEN.DryrunCredit = {
    RULES,
    initWallet,
    getWallet,
    getCreditBalance,
    addCredit,
    spendCredit,
    canSpend,
    getCreditLogs
  };
})();
