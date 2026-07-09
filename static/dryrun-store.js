(function () {
  const STORAGE_KEY = "AIPIWEN_DRYRUN_STATE_V1";
  const ROLES = {
    interpreter: "解读师",
    agent: "代理",
    center: "采集中心",
    emma: "Emma"
  };
  const SOURCE_LABELS = {
    invite_link: "解读师邀请链接",
    center_qr: "采集中心二维码",
    bind_code: "报告绑定码",
    public_pool: "总部公海分配"
  };
  const OBJECT_LABELS = {
    parent_child: "家长看孩子",
    adult_self: "成人自我理解",
    agent_practice: "代理练习案例",
    center_case: "采集中心案例"
  };
  const DEFAULT_REPORT = {
    reportType: "儿童天赋报告",
    trc: 185,
    atd: 42,
    brainDominance: "左脑主导",
    learningStyle: "听觉型（主）/ 体觉型（辅）",
    fiveZones: [
      { zone: "精神功能", right: ["沟通管理", "计划判断", 30, "Wt"], left: ["创造领导", "目标憧憬", 26, "Wc"] },
      { zone: "思维功能", right: ["逻辑推理", "语言功能", 20, "Ws"], left: ["空间心像", "构思拟想", 25, "Wsc"] },
      { zone: "听觉功能", right: ["听觉辨识", "语言理解", 18, "Lu"], left: ["听觉感受", "音乐欣赏", 20, "Lu"] },
      { zone: "视觉功能", right: ["视觉辨识", "观察理解", 14, "Lu"], left: ["视觉感受", "图像欣赏", 13, "Lu"] },
      { zone: "体觉功能", right: ["体觉辨识", "操作理解", 19, "Lu"], left: ["体觉感受", "艺术欣赏", 16, "Wl"] }
    ]
  };
  const SAMPLE_REPORT_TEXT = `报告类型：儿童天赋报告
TRC：185
ATD：42°
左右脑：左脑主导
学习风格：听觉型（主）/ 体觉型（辅）

五大功能区：

精神功能：
右手：沟通管理｜计划判断｜30｜Wt
左手：创造领导｜目标憧憬｜26｜Wc

思维功能：
右手：逻辑推理｜语言功能｜20｜Ws
左手：空间心像｜构思拟想｜25｜Wsc

听觉功能：
右手：听觉辨识｜语言理解｜18｜Lu
左手：听觉感受｜音乐欣赏｜20｜Lu

视觉功能：
右手：视觉辨识｜观察理解｜14｜Lu
左手：视觉感受｜图像欣赏｜13｜Lu

体觉功能：
右手：体觉辨识｜操作理解｜19｜Lu
左手：体觉感受｜艺术欣赏｜16｜Wl`;

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
      activeSessionId: null,
      creditLogs: [],
      customers: [],
      reportSummaries: [],
      interpretationSessions: [],
      interpretationRecords: [],
      inviteRelations: [],
      feedback: [],
      scriptRatings: []
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
      feedback: Array.isArray(state && state.feedback) ? state.feedback : [],
      scriptRatings: Array.isArray(state && state.scriptRatings) ? state.scriptRatings : []
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

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source || "未选择";
  }

  function objectLabel(objectType) {
    return OBJECT_LABELS[objectType] || objectType || "未选择";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function hasSensitiveText(text) {
    const value = String(text || "");
    return /1[3-9]\d{9}/.test(value) || /(?:\d{3,4}[-\s]?)?\d{7,8}/.test(value) || /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/.test(value);
  }

  function parseReportSummary(rawText) {
    const text = String(rawText || "");
    const reportType = (text.match(/报告类型[:：]\s*([^\n]+)/) || [])[1] || DEFAULT_REPORT.reportType;
    const trc = Number((text.match(/TRC[:：]\s*(\d+)/i) || [])[1]) || DEFAULT_REPORT.trc;
    const atd = Number((text.match(/ATD[:：]\s*(\d+)/i) || [])[1]) || DEFAULT_REPORT.atd;
    const brainDominance = (text.match(/左右脑[:：]\s*([^\n]+)/) || [])[1] || DEFAULT_REPORT.brainDominance;
    const learningStyle = (text.match(/学习风格[:：]\s*([^\n]+)/) || [])[1] || DEFAULT_REPORT.learningStyle;

    return {
      reportType: reportType.trim(),
      trc,
      atd,
      brainDominance: brainDominance.trim(),
      learningStyle: learningStyle.trim(),
      fiveZones: DEFAULT_REPORT.fiveZones.map((zone) => ({
        zone: zone.zone,
        right: [...zone.right],
        left: [...zone.left]
      })),
      rawText: text.trim() || SAMPLE_REPORT_TEXT
    };
  }

  function createMockCustomer({ nickname, childAgeRange, objectType, sourceChannel }) {
    const state = getDryrunState();
    if (!state.user) return null;
    const timestamp = now();
    const customer = {
      customerId: `c_${Date.now()}`,
      advisorId: state.user.userId,
      nickname: nickname.trim(),
      childAgeRange,
      childGrade: "",
      relationship: objectLabel(objectType),
      objectType,
      sourceChannel,
      bindingMethod: sourceChannel,
      bindingCode: state.user.inviteCode || (state.profile && state.profile.bindCode) || "",
      bindingAt: timestamp,
      createdAt: timestamp,
      status: "pending_interpretation"
    };
    saveDryrunState({ ...state, customers: [...state.customers, customer] });
    return customer;
  }

  function createReportSummary({ customerId, rawText }) {
    const state = getDryrunState();
    if (!state.user || !customerId) return null;
    const summary = {
      summaryId: `rs_${Date.now()}`,
      customerId,
      advisorId: state.user.userId,
      ...parseReportSummary(rawText),
      isMock: true,
      createdAt: now()
    };
    saveDryrunState({ ...state, reportSummaries: [...state.reportSummaries, summary] });
    return summary;
  }

  function createInterpretationSession({ customerId, summaryId, selectedQuestions }) {
    const state = getDryrunState();
    if (!state.user || !customerId || !summaryId) return null;
    const session = {
      sessionId: `is_${Date.now()}`,
      advisorId: state.user.userId,
      customerId,
      summaryId,
      selectedQuestions: selectedQuestions || [],
      currentStep: 0,
      stepsCompleted: [],
      status: "in_progress",
      startedAt: now(),
      completedAt: null,
      creditsSpent: 0,
      generatedAt: null
    };
    saveDryrunState({
      ...state,
      activeSessionId: session.sessionId,
      interpretationSessions: [...state.interpretationSessions, session]
    });
    return session;
  }

  function setActiveSession(sessionId) {
    const state = getDryrunState();
    saveDryrunState({ ...state, activeSessionId: sessionId });
  }

  function getActiveSessionBundle() {
    const state = getDryrunState();
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("sessionId") || state.activeSessionId;
    const session = state.interpretationSessions.find((item) => item.sessionId === sessionId);
    if (!session) return null;
    return {
      state,
      session,
      customer: state.customers.find((item) => item.customerId === session.customerId) || null,
      reportSummary: state.reportSummaries.find((item) => item.summaryId === session.summaryId) || null,
      records: state.interpretationRecords.filter((item) => item.sessionId === session.sessionId)
    };
  }

  function saveInterpretationRecord(record) {
    const state = getDryrunState();
    const nextRecord = {
      recordId: record.recordId || `ir_${Date.now()}`,
      createdAt: record.createdAt || now(),
      ...record
    };
    saveDryrunState({ ...state, interpretationRecords: [...state.interpretationRecords, nextRecord] });
    return nextRecord;
  }

  function getFeedbackList() {
    return getDryrunState().feedback;
  }

  function saveFeedback(feedback) {
    const state = getDryrunState();
    const existing = state.feedback.find((item) => item.feedbackId && item.feedbackId === feedback.feedbackId);
    const timestamp = now();
    const nextFeedback = {
      feedbackType: "MockFeedback",
      feedbackId: feedback.feedbackId || (existing && existing.feedbackId) || `mf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      advisorId: feedback.advisorId || (state.user && state.user.userId) || null,
      advisorNickname: feedback.advisorNickname || (state.user && state.user.nickname) || "",
      advisorRole: feedback.advisorRole || (state.user && state.user.role) || "",
      createdAt: feedback.createdAt || (existing && existing.createdAt) || timestamp,
      ...feedback,
      updatedAt: timestamp
    };
    const feedbackList = existing
      ? state.feedback.map((item) => (item.feedbackId === nextFeedback.feedbackId ? nextFeedback : item))
      : [...state.feedback, nextFeedback];
    saveDryrunState({ ...state, feedback: feedbackList });
    return nextFeedback;
  }

  function getScriptRatings() {
    return getDryrunState().scriptRatings;
  }

  function sameScriptRating(left, right) {
    if (left.feedbackId && right.feedbackId) return left.feedbackId === right.feedbackId;
    return left.sessionId === right.sessionId
      && left.stepIndex === right.stepIndex
      && left.sectionType === right.sectionType
      && left.scriptText === right.scriptText;
  }

  function upsertScriptRating(list, rating) {
    const existing = list.find((item) => sameScriptRating(item, rating));
    if (!existing) return [...list, rating];
    return list.map((item) => (sameScriptRating(item, rating) ? { ...existing, ...rating, createdAt: existing.createdAt || rating.createdAt } : item));
  }

  function saveScriptRating(rating) {
    const state = getDryrunState();
    const timestamp = now();
    const existing = state.scriptRatings.find((item) => sameScriptRating(item, rating));
    const nextRating = {
      feedbackId: rating.feedbackId || (existing && existing.feedbackId) || `sf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      sessionId: rating.sessionId,
      customerId: rating.customerId,
      advisorId: rating.advisorId || (state.user && state.user.userId) || null,
      stepIndex: Number(rating.stepIndex || 0),
      sectionType: rating.sectionType,
      scriptText: rating.scriptText,
      rating: rating.rating,
      note: rating.note || "",
      createdAt: rating.createdAt || (existing && existing.createdAt) || timestamp,
      ...rating,
      updatedAt: timestamp
    };
    const scriptRatings = upsertScriptRating(state.scriptRatings, nextRating);
    const interpretationSessions = state.interpretationSessions.map((session) => {
      if (session.sessionId !== nextRating.sessionId) return session;
      const sessionFeedback = session.sessionFeedback || {};
      return {
        ...session,
        sessionFeedback: {
          ...sessionFeedback,
          scriptRatings: upsertScriptRating(Array.isArray(sessionFeedback.scriptRatings) ? sessionFeedback.scriptRatings : [], nextRating)
        }
      };
    });
    saveDryrunState({ ...state, scriptRatings, interpretationSessions });
    return nextRating;
  }

  function countBy(items, getKey) {
    return (items || []).reduce((counts, item) => {
      const key = getKey(item) || "未填写";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function latestTime(values) {
    return values.reduce((latest, value) => {
      if (!value) return latest;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return latest;
      return Math.max(latest, time);
    }, 0);
  }

  function getDryrunSummary(inputState) {
    const state = normalizeState(inputState || getDryrunState());
    const completedSessionIds = new Set(
      state.interpretationSessions
        .filter((session) => session.status === "generated" || session.completedAt || session.generatedAt)
        .map((session) => session.sessionId)
    );
    state.interpretationRecords.forEach((record) => {
      if ((record.creditsSpent || 0) >= 50 || Array.isArray(record.fullRoute)) {
        completedSessionIds.add(record.sessionId);
      }
    });
    const totalCreditSpent = state.wallet && Number.isFinite(Number(state.wallet.totalSpent))
      ? Number(state.wallet.totalSpent)
      : state.creditLogs.reduce((sum, log) => (log.amount < 0 ? sum + Math.abs(log.amount) : sum), 0);
    const lastActiveTime = latestTime([
      state.updatedAt,
      state.user && state.user.lastActiveAt,
      ...state.customers.map((item) => item.createdAt),
      ...state.interpretationSessions.map((item) => item.generatedAt || item.completedAt || item.startedAt),
      ...state.interpretationRecords.map((item) => item.createdAt),
      ...state.feedback.map((item) => item.createdAt),
      ...state.scriptRatings.map((item) => item.updatedAt || item.createdAt)
    ]);

    return {
      userNickname: state.user ? state.user.nickname : "-",
      role: state.user ? roleLabel(state.user.role) : "-",
      creditBalance: state.wallet ? state.wallet.creditBalance || 0 : 0,
      customerCount: state.customers.length,
      interpretationRecordCount: state.interpretationRecords.length,
      feedbackCount: state.feedback.length,
      scriptRatingCount: state.scriptRatings.length,
      completedInterpretationCount: completedSessionIds.size,
      totalCreditSpent,
      lastActiveAt: lastActiveTime ? new Date(lastActiveTime).toISOString() : null,
      sourceDistribution: countBy(state.customers, (customer) => sourceLabel(customer.sourceChannel)),
      questionDistribution: countBy(
        state.interpretationSessions.flatMap((session) => session.selectedQuestions || []),
        (question) => question
      ),
      feedback: state.feedback,
      scriptRatings: state.scriptRatings
    };
  }

  function updateInterpretationSession(sessionId, updates) {
    const state = getDryrunState();
    const interpretationSessions = state.interpretationSessions.map((session) => (
      session.sessionId === sessionId ? { ...session, ...updates } : session
    ));
    saveDryrunState({ ...state, interpretationSessions });
  }

  function markSessionGenerated(sessionId, creditsSpent) {
    const state = getDryrunState();
    const session = state.interpretationSessions.find((item) => item.sessionId === sessionId);
    if (!session) return;
    const interpretationSessions = state.interpretationSessions.map((item) => (
      item.sessionId === sessionId
        ? { ...item, status: "generated", creditsSpent: (item.creditsSpent || 0) + creditsSpent, generatedAt: now() }
        : item
    ));
    const customers = state.customers.map((customer) => (
      customer.customerId === session.customerId ? { ...customer, status: "generated" } : customer
    ));
    saveDryrunState({ ...state, interpretationSessions, customers });
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

  function initNewCustomerPage() {
    const page = document.querySelector("[data-dryrun-new-customer]");
    if (!page) return;
    if (page.dataset.dryrunInitialized === "true") return;
    page.dataset.dryrunInitialized = "true";

    const form = page.querySelector("[data-new-customer-form]");
    const sampleButton = page.querySelector("[data-fill-sample-report]");
    const summaryInput = page.querySelector("[data-report-summary]");
    const errorNode = page.querySelector("[data-customer-error]");
    const submitButton = page.querySelector("[data-create-customer]");
    const state = getDryrunState();

    if (!state.user) {
      const gate = page.querySelector("[data-dryrun-gate]");
      if (gate) gate.hidden = false;
      if (form) form.hidden = true;
      return;
    }

    function showError(message) {
      if (!errorNode) return;
      errorNode.textContent = message;
      errorNode.hidden = !message;
    }

    if (sampleButton && summaryInput) {
      sampleButton.addEventListener("click", function () {
        summaryInput.value = SAMPLE_REPORT_TEXT;
        summaryInput.dispatchEvent(new Event("input", { bubbles: true }));
        showError("");
      });
    }

    submitButton && submitButton.addEventListener("click", function () {
      const nickname = page.querySelector("[data-customer-nickname]").value.trim();
      const childAgeRange = page.querySelector("[data-age-range]").value;
      const objectType = page.querySelector("[data-object-type]").value;
      const sourceChannel = page.querySelector("[data-source-channel]").value;
      const rawText = summaryInput.value.trim();
      const selectedQuestions = Array.from(page.querySelectorAll("[data-question-option]:checked")).map((input) => input.value);
      const extraQuestion = page.querySelector("[data-extra-question]").value.trim();
      if (extraQuestion) selectedQuestions.push(extraQuestion);

      if (!nickname || !childAgeRange || !objectType || !sourceChannel || !rawText || selectedQuestions.length === 0) {
        showError("请补全模拟客户信息、脱敏报告摘要，并至少选择一个关注问题。");
        return;
      }
      if (hasSensitiveText(`${nickname}\n${rawText}\n${extraQuestion}`)) {
        showError("检测到可能包含真实隐私信息。V2 Dry-run 不允许输入真实客户姓名、手机号、身份证、学校或家庭隐私。请使用模拟客户或脱敏案例。");
        return;
      }

      const customer = createMockCustomer({ nickname, childAgeRange, objectType, sourceChannel });
      const summary = createReportSummary({ customerId: customer.customerId, rawText });
      const session = createInterpretationSession({
        customerId: customer.customerId,
        summaryId: summary.summaryId,
        selectedQuestions
      });
      window.location.href = `ai-interpreter-session.html?sessionId=${encodeURIComponent(session.sessionId)}`;
    });
  }

  function renderWorkbenchStats() {
    const panel = document.querySelector("[data-dryrun-workbench]");
    if (!panel) return;
    const state = getDryrunState();
    setText(panel, "[data-dryrun-customer-count]", String(state.customers.length));
    setText(panel, "[data-dryrun-record-count]", String(state.interpretationRecords.length));
    setText(panel, "[data-dryrun-feedback-count]", String(state.feedback.length));
    setText(panel, "[data-dryrun-script-rating-count]", String(state.scriptRatings.length));
  }

  function renderDryrunCustomers() {
    const panel = document.querySelector("[data-dryrun-customers-panel]");
    if (!panel) return;
    const list = panel.querySelector("[data-dryrun-customers-list]");
    const countNode = panel.querySelector("[data-dryrun-customers-count]");
    const state = getDryrunState();
    if (countNode) countNode.textContent = String(state.customers.length);
    if (!list) return;
    list.innerHTML = "";
    if (!state.customers.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    state.customers.forEach((customer) => {
      const session = state.interpretationSessions.find((item) => item.customerId === customer.customerId);
      const summary = state.reportSummaries.find((item) => item.customerId === customer.customerId);
      const row = document.createElement("button");
      row.className = "table-row";
      row.type = "button";
      row.innerHTML = `<strong>${escapeHtml(customer.nickname)}</strong><span>${escapeHtml(sourceLabel(customer.sourceChannel))}</span><span>${escapeHtml(state.user ? state.user.nickname : "-")}</span><span>${escapeHtml(sourceLabel(customer.bindingMethod))}</span><span>${escapeHtml(summary ? summary.reportType : "未填写")}</span><span class="status ${session && session.status === "generated" ? "done" : "info"}">${session && session.status === "generated" ? "已生成解读方案" : "解读中"}</span><span>${escapeHtml((session && session.selectedQuestions || []).slice(0, 2).join(" / ") || "-")}</span><span>进入</span>`;
      row.addEventListener("click", function () {
        if (session) {
          setActiveSession(session.sessionId);
          window.location.href = `ai-interpreter-session.html?sessionId=${encodeURIComponent(session.sessionId)}`;
        }
      });
      list.appendChild(row);
    });
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
    setText(panel, "[data-dryrun-feedback-count]", String(state.feedback.length));
    setText(panel, "[data-dryrun-script-rating-count]", String(state.scriptRatings.length));
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
    setText(
      panel,
      "[data-dryrun-feedback-hint]",
      state.interpretationRecords.length >= 1 ? "你已完成模拟解读，建议填写反馈。" : "建议先完成一次模拟解读后再填写反馈。"
    );
    renderWorkbenchStats();
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
    createMockCustomer,
    createReportSummary,
    createInterpretationSession,
    setActiveSession,
    getActiveSessionBundle,
    saveInterpretationRecord,
    getFeedbackList,
    saveFeedback,
    saveScriptRating,
    getScriptRatings,
    getDryrunSummary,
    updateInterpretationSession,
    markSessionGenerated,
    parseReportSummary,
    hasSensitiveText,
    sourceLabel,
    objectLabel,
    SAMPLE_REPORT_TEXT,
    DEFAULT_REPORT,
    generateInviteCode,
    generateBindCode,
    hasDryrunUser,
    roleLabel
  };

  function initDryrunPages() {
    initOnboardingPage();
    initNewCustomerPage();
    initWorkbenchPage();
    renderDryrunCustomers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDryrunPages, { once: true });
  } else {
    initDryrunPages();
  }
})();
