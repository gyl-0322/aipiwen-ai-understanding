(function () {
  const STORAGE_KEY = "AIPIWEN_DRYRUN_STATE_V1";
  const ROLES = {
    interpreter: "解读师",
    agent: "代理",
    center: "采集中心",
    emma: "Emma"
  };

  function now() {
    return new Date().toISOString();
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateStamp() {
    const date = new Date();
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  }

  function randomCode(prefix, length) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = prefix;
    for (let index = 0; index < length; index += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  function emptyState() {
    return {
      version: 1,
      createdAt: null,
      updatedAt: null,
      user: null,
      profile: null,
      wallet: null,
      creditLogs: [],
      customers: [],
      reportSummaries: [],
      interpretationSessions: [],
      interpretationRecords: [],
      inviteRelations: [],
      feedback: []
    };
  }

  function normalizeState(state) {
    return {
      ...emptyState(),
      ...(state || {}),
      creditLogs: Array.isArray(state && state.creditLogs) ? state.creditLogs : [],
      customers: Array.isArray(state && state.customers) ? state.customers : [],
      reportSummaries: Array.isArray(state && state.reportSummaries) ? state.reportSummaries : [],
      interpretationSessions: Array.isArray(state && state.interpretationSessions) ? state.interpretationSessions : [],
      interpretationRecords: Array.isArray(state && state.interpretationRecords) ? state.interpretationRecords : [],
      inviteRelations: Array.isArray(state && state.inviteRelations) ? state.inviteRelations : [],
      feedback: Array.isArray(state && state.feedback) ? state.feedback : []
    };
  }

  function getDryrunState() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("AIPIWEN Dry-run state parse failed.", error);
      return emptyState();
    }
  }

  function saveDryrunState(state) {
    const nextState = normalizeState(state);
    const timestamp = now();
    nextState.createdAt = nextState.createdAt || timestamp;
    nextState.updatedAt = timestamp;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return nextState;
  }

  function clearDryrunState() {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function exportDryrunState() {
    const state = getDryrunState();
    const content = JSON.stringify(state, null, 2);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `aipiwen-dryrun-export-${dateStamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }

  function generateInviteCode() {
    return randomCode("DR", 6);
  }

  function generateBindCode() {
    return randomCode("B", 6);
  }

  function createMockUser({ nickname, role }) {
    const timestamp = now();
    const inviteCode = generateInviteCode();
    const user = {
      userId: `u_${Date.now()}`,
      nickname: nickname.trim(),
      role,
      inviteCode,
      invitedBy: null,
      createdAt: timestamp,
      lastActiveAt: timestamp,
      onboarded: true
    };

    const state = saveDryrunState({
      ...emptyState(),
      user,
      createdAt: timestamp
    });

    return state.user;
  }

  function createAdvisorProfile(user) {
    const origin = window.location.origin || "https://aipiwen.cn";
    const bindCode = generateBindCode();
    const profile = {
      profileId: `p_${Date.now()}`,
      userId: user.userId,
      displayName: user.nickname,
      role: user.role,
      region: "",
      inviteLink: `${origin}/r/${user.inviteCode}`,
      qrCodeUrl: "",
      bindCode,
      createdAt: now()
    };
    const state = getDryrunState();
    saveDryrunState({ ...state, profile });
    return profile;
  }

  function hasDryrunUser() {
    return Boolean(getDryrunState().user);
  }

  function roleLabel(role) {
    return ROLES[role] || role || "未选择";
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value;
  }

  function initOnboardingPage() {
    const page = document.querySelector("[data-dryrun-onboarding]");
    if (!page) return;
    if (page.dataset.dryrunInitialized === "true") return;
    page.dataset.dryrunInitialized = "true";

    const existingPanel = page.querySelector("[data-existing-dryrun]");
    const formPanel = page.querySelector("[data-onboarding-form]");
    const enterButton = page.querySelector("[data-enter-dryrun]");
    const resetButton = page.querySelector("[data-reset-dryrun]");
    const continueButton = page.querySelector("[data-continue-dryrun]");
    const agreeInput = page.querySelector("[data-dryrun-agree]");
    const nicknameInput = page.querySelector("[data-dryrun-nickname]");
    const roleInput = page.querySelector("[data-dryrun-role]");
    const errorNode = page.querySelector("[data-dryrun-error]");
    const detectedName = page.querySelector("[data-detected-name]");
    const detectedRole = page.querySelector("[data-detected-role]");

    function showError(message) {
      if (!errorNode) return;
      errorNode.textContent = message;
      errorNode.hidden = !message;
    }

    function updateExistingState() {
      const state = getDryrunState();
      const hasUser = Boolean(state.user);
      if (existingPanel) existingPanel.hidden = !hasUser;
      if (formPanel) formPanel.hidden = hasUser;
      if (hasUser) {
        setText(page, "[data-detected-name]", state.user.nickname || "-");
        setText(page, "[data-detected-role]", roleLabel(state.user.role));
      }
      if (detectedName && hasUser) detectedName.textContent = state.user.nickname || "-";
      if (detectedRole && hasUser) detectedRole.textContent = roleLabel(state.user.role);
    }

    function updateButtonState() {
      if (!enterButton || !agreeInput || !nicknameInput || !roleInput) return;
      enterButton.disabled = !agreeInput.checked || !nicknameInput.value.trim() || !roleInput.value;
    }

    agreeInput && agreeInput.addEventListener("change", updateButtonState);
    nicknameInput && nicknameInput.addEventListener("input", function () {
      const value = nicknameInput.value.trim();
      if (/1[3-9]\d{9}/.test(value)) {
        showError("请勿输入手机号或真实客户隐私信息。");
      } else {
        showError("");
      }
      updateButtonState();
    });
    roleInput && roleInput.addEventListener("change", updateButtonState);

    enterButton && enterButton.addEventListener("click", function () {
      const nickname = nicknameInput.value.trim();
      const role = roleInput.value;

      if (!agreeInput.checked) {
        showError("请先勾选安全须知确认。");
        return;
      }
      if (!nickname || !role) {
        showError("请填写内测昵称并选择身份。");
        return;
      }
      if (/1[3-9]\d{9}/.test(nickname)) {
        showError("请勿输入手机号或真实客户隐私信息。");
        return;
      }

      const user = createMockUser({ nickname, role });
      createAdvisorProfile(user);
      if (window.AIPIWEN && window.AIPIWEN.DryrunCredit) {
        window.AIPIWEN.DryrunCredit.initWallet(user.userId);
      }
      window.location.href = "ai-interpreter-workbench.html";
    });

    resetButton && resetButton.addEventListener("click", function () {
      if (!window.confirm("确认清空本机 V2 Dry-run 数据并重新开始吗？")) return;
      clearDryrunState();
      updateExistingState();
      updateButtonState();
    });

    continueButton && continueButton.addEventListener("click", function () {
      window.location.href = "ai-interpreter-workbench.html";
    });

    updateExistingState();
    updateButtonState();
  }

  function renderWorkbenchPanel() {
    const panel = document.querySelector("[data-dryrun-workbench]");
    if (!panel) return;

    const state = getDryrunState();
    const hasUser = Boolean(state.user);
    const activeView = panel.querySelector("[data-dryrun-active]");
    const emptyView = panel.querySelector("[data-dryrun-empty]");

    if (activeView) activeView.hidden = !hasUser;
    if (emptyView) emptyView.hidden = hasUser;
    if (!hasUser) return;

    const wallet = state.wallet || {};
    const logs = (state.creditLogs || []).slice(-3).reverse();
    setText(panel, "[data-dryrun-name]", state.user.nickname || "-");
    setText(panel, "[data-dryrun-role]", roleLabel(state.user.role));
    setText(panel, "[data-dryrun-balance]", String(wallet.creditBalance || 0));
    setText(panel, "[data-dryrun-invite-code]", state.user.inviteCode || "-");
    setText(panel, "[data-dryrun-invite-link]", state.profile && state.profile.inviteLink ? state.profile.inviteLink : "-");
    setText(panel, "[data-dryrun-bind-code]", state.profile && state.profile.bindCode ? state.profile.bindCode : "-");

    const ledger = panel.querySelector("[data-dryrun-ledger]");
    if (ledger) {
      ledger.innerHTML = "";
      logs.forEach(function (log) {
        const item = document.createElement("li");
        const amount = log.amount > 0 ? `+${log.amount}` : String(log.amount);
        item.innerHTML = `<span>${log.description}</span><strong>${amount}</strong><small>${formatDateTime(log.createdAt)}</small>`;
        ledger.appendChild(item);
      });
    }
  }

  function initWorkbenchPage() {
    const panel = document.querySelector("[data-dryrun-workbench]");
    if (!panel) return;
    if (panel.dataset.dryrunInitialized === "true") return;
    panel.dataset.dryrunInitialized = "true";

    const exportButton = panel.querySelector("[data-export-dryrun]");
    const clearButton = panel.querySelector("[data-clear-dryrun]");

    exportButton && exportButton.addEventListener("click", exportDryrunState);
    clearButton && clearButton.addEventListener("click", function () {
      if (!window.confirm("确认清空本机 V2 Dry-run 数据吗？清空后本浏览器中的内测身份、积分和流水都会删除。")) return;
      clearDryrunState();
      renderWorkbenchPanel();
    });

    renderWorkbenchPanel();
  }

  window.AIPIWEN = window.AIPIWEN || {};
  window.AIPIWEN.DryrunStore = {
    STORAGE_KEY,
    getDryrunState,
    saveDryrunState,
    clearDryrunState,
    exportDryrunState,
    createMockUser,
    createAdvisorProfile,
    generateInviteCode,
    generateBindCode,
    hasDryrunUser,
    roleLabel
  };

  function initDryrunPages() {
    initOnboardingPage();
    initWorkbenchPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDryrunPages, { once: true });
  } else {
    initDryrunPages();
  }
})();
