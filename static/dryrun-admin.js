(function () {
  let importedStates = [];

  function store() {
    return window.AIPIWEN && window.AIPIWEN.DryrunStore;
  }

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

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function setText(root, selector, value) {
    const node = root.querySelector(selector);
    if (node) node.textContent = value;
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueBy(items, getId) {
    const seen = new Set();
    return items.filter((item, index) => {
      const id = getId(item) || `row_${index}_${JSON.stringify(item).slice(0, 64)}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function countBy(items, getKey) {
    return list(items).reduce((counts, item) => {
      const key = getKey(item) || "未填写";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function average(values) {
    const numbers = values.map(Number).filter((value) => Number.isFinite(value));
    if (!numbers.length) return "-";
    return (numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(1);
  }

  function topCountLabel(counts) {
    const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return "-";
    return entries.map(([key, count]) => `${key} ${count}`).join(" / ");
  }

  function normalizeImportedPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.states)) return payload.states;
    if (Array.isArray(payload.dryrunStates)) return payload.dryrunStates;
    if (payload.state) return [payload.state];
    if (payload.dryrunState) return [payload.dryrunState];
    if (payload.version && (payload.user || payload.customers || payload.feedback || payload.scriptRatings)) return [payload];
    return [];
  }

  function loadLocalDryrunSummary() {
    const dryStore = store();
    const state = dryStore ? dryStore.getDryrunState() : {};
    return {
      state,
      summary: dryStore ? dryStore.getDryrunSummary(state) : {}
    };
  }

  function mergeDryrunStates(states) {
    const safeStates = list(states);
    const merged = {
      version: 1,
      createdAt: null,
      updatedAt: now(),
      user: safeStates.find((state) => state && state.user) ? { nickname: `${safeStates.length} 份内测数据`, role: "emma" } : null,
      profile: null,
      wallet: { creditBalance: 0, totalEarned: 0, totalSpent: 0 },
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

    safeStates.forEach((state) => {
      if (!state || typeof state !== "object") return;
      merged.creditLogs.push(...list(state.creditLogs));
      merged.customers.push(...list(state.customers));
      merged.reportSummaries.push(...list(state.reportSummaries));
      merged.interpretationSessions.push(...list(state.interpretationSessions));
      merged.interpretationRecords.push(...list(state.interpretationRecords));
      merged.inviteRelations.push(...list(state.inviteRelations));
      merged.feedback.push(...list(state.feedback));
      merged.scriptRatings.push(...list(state.scriptRatings));
      if (state.wallet) {
        merged.wallet.creditBalance += Number(state.wallet.creditBalance || 0);
        merged.wallet.totalEarned += Number(state.wallet.totalEarned || 0);
        merged.wallet.totalSpent += Number(state.wallet.totalSpent || 0);
      }
    });

    merged.creditLogs = uniqueBy(merged.creditLogs, (item) => item.logId);
    merged.customers = uniqueBy(merged.customers, (item) => item.customerId);
    merged.reportSummaries = uniqueBy(merged.reportSummaries, (item) => item.summaryId);
    merged.interpretationSessions = uniqueBy(merged.interpretationSessions, (item) => item.sessionId);
    merged.interpretationRecords = uniqueBy(merged.interpretationRecords, (item) => item.recordId);
    merged.inviteRelations = uniqueBy(merged.inviteRelations, (item) => item.relationId);
    merged.feedback = uniqueBy(merged.feedback, (item) => item.feedbackId);
    merged.scriptRatings = uniqueBy(merged.scriptRatings, (item) => item.feedbackId);
    return merged;
  }

  function statesToMerged(states) {
    if (Array.isArray(states)) return mergeDryrunStates(states);
    return states || mergeDryrunStates([loadLocalDryrunSummary().state, ...importedStates]);
  }

  function summarizeFeedback(states) {
    const merged = statesToMerged(states);
    const feedback = list(merged.feedback);
    const answers = feedback.map((item) => item.answers || {});
    const paidCounts = countBy(answers, (item) => item.paidWillingness);
    return {
      count: feedback.length,
      willingnessToUseAvg: average(answers.map((item) => item.willingnessToUseScore)),
      scriptUsabilityAvg: average(answers.map((item) => item.scriptUsabilityScore)),
      processComplexityAvg: average(answers.map((item) => item.processComplexityScore)),
      paidWillingness: paidCounts,
      biggestDissatisfaction: answers.map((item) => item.biggestDissatisfaction).filter(Boolean),
      priorityFeature: answers.map((item) => item.priorityFeature).filter(Boolean),
      items: feedback
    };
  }

  function summarizeScriptRatings(states) {
    const merged = statesToMerged(states);
    const ratings = list(merged.scriptRatings);
    return {
      usable: ratings.filter((item) => item.rating === "usable").length,
      needs_edit: ratings.filter((item) => item.rating === "needs_edit").length,
      unusable: ratings.filter((item) => item.rating === "unusable").length,
      total: ratings.length,
      items: ratings
    };
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }

  function exportAdminSummary() {
    const local = loadLocalDryrunSummary();
    const states = [local.state, ...importedStates];
    const mergedState = mergeDryrunStates(states);
    const dryStore = store();
    const payload = {
      exportType: "AIPIWEN_V2_DRYRUN_ADMIN_SUMMARY",
      exportedAt: now(),
      stateCount: states.length,
      summary: dryStore ? dryStore.getDryrunSummary(mergedState) : {},
      feedbackSummary: summarizeFeedback(mergedState),
      scriptRatingSummary: summarizeScriptRatings(mergedState),
      states
    };
    downloadJson(`aipiwen-dryrun-admin-summary-${dateStamp()}.json`, payload);
    return payload;
  }

  function renderList(root, selector, items) {
    const node = root.querySelector(selector);
    if (!node) return;
    if (!items.length) {
      node.innerHTML = `<div class="admin-list-item"><p>暂无数据</p></div>`;
      return;
    }
    node.innerHTML = items.slice(0, 12).map((item, index) => (
      `<div class="admin-list-item"><strong>#${index + 1}</strong><p>${escapeHtml(item)}</p></div>`
    )).join("");
  }

  function renderAdmin() {
    const root = document.querySelector("[data-dryrun-admin]");
    const dryStore = store();
    if (!root || !dryStore) return;

    const local = loadLocalDryrunSummary();
    const states = [local.state, ...importedStates];
    const mergedState = mergeDryrunStates(states);
    const mergedSummary = dryStore.getDryrunSummary(mergedState);
    const feedbackSummary = summarizeFeedback(mergedState);
    const scriptSummary = summarizeScriptRatings(mergedState);

    setText(root, "[data-admin-local-user]", local.summary.userNickname || "-");
    setText(root, "[data-admin-local-role]", local.summary.role || "-");
    setText(root, "[data-admin-local-credit]", String(local.summary.creditBalance || 0));
    setText(root, "[data-admin-local-customers]", String(local.summary.customerCount || 0));
    setText(root, "[data-admin-local-records]", String(local.summary.interpretationRecordCount || 0));
    setText(root, "[data-admin-local-feedback]", String(local.summary.feedbackCount || 0));
    setText(root, "[data-admin-local-ratings]", String(local.summary.scriptRatingCount || 0));

    setText(root, "[data-admin-state-count]", `${states.length} 份数据`);
    setText(root, "[data-admin-completed]", String(mergedSummary.completedInterpretationCount || 0));
    setText(root, "[data-admin-spent]", String(mergedSummary.totalCreditSpent || 0));
    setText(root, "[data-admin-last-active]", formatDateTime(mergedSummary.lastActiveAt));
    setText(root, "[data-admin-total-feedback]", String(feedbackSummary.count || 0));
    setText(root, "[data-admin-source-distribution]", topCountLabel(mergedSummary.sourceDistribution));
    setText(root, "[data-admin-question-distribution]", topCountLabel(mergedSummary.questionDistribution));

    setText(root, "[data-admin-rating-usable]", String(scriptSummary.usable));
    setText(root, "[data-admin-rating-edit]", String(scriptSummary.needs_edit));
    setText(root, "[data-admin-rating-unusable]", String(scriptSummary.unusable));

    setText(root, "[data-admin-feedback-use]", feedbackSummary.willingnessToUseAvg);
    setText(root, "[data-admin-feedback-script]", feedbackSummary.scriptUsabilityAvg);
    setText(root, "[data-admin-feedback-complexity]", feedbackSummary.processComplexityAvg);
    setText(root, "[data-admin-feedback-paid]", topCountLabel(feedbackSummary.paidWillingness));
    renderList(root, "[data-admin-dissatisfaction-list]", feedbackSummary.biggestDissatisfaction);
    renderList(root, "[data-admin-priority-list]", feedbackSummary.priorityFeature);
    setText(
      root,
      "[data-admin-import-status]",
      importedStates.length ? `已临时导入 ${importedStates.length} 份 JSON 数据，本页正在合并展示。` : "当前只显示本机 dry-run 数据。"
    );
  }

  function importDryrunJson(file) {
    if (!file) return Promise.resolve([]);
    return file.text().then((text) => {
      const payload = JSON.parse(text);
      const states = normalizeImportedPayload(payload);
      if (!states.length) throw new Error("未识别到 dry-run state 数据。");
      importedStates = states;
      renderAdmin();
      return states;
    });
  }

  function initAdminPage() {
    const root = document.querySelector("[data-dryrun-admin]");
    if (!root || root.dataset.dryrunInitialized === "true") return;
    root.dataset.dryrunInitialized = "true";
    const importInput = root.querySelector("[data-admin-import]");
    const exportButton = root.querySelector("[data-admin-export]");
    const statusNode = root.querySelector("[data-admin-import-status]");

    importInput && importInput.addEventListener("change", function () {
      const file = importInput.files && importInput.files[0];
      importDryrunJson(file).catch((error) => {
        if (statusNode) statusNode.textContent = `JSON 导入失败：${error.message}`;
      });
    });
    exportButton && exportButton.addEventListener("click", exportAdminSummary);
    renderAdmin();
  }

  window.AIPIWEN = window.AIPIWEN || {};
  window.AIPIWEN.DryrunAdmin = {
    loadLocalDryrunSummary,
    importDryrunJson,
    mergeDryrunStates,
    summarizeFeedback,
    summarizeScriptRatings,
    exportAdminSummary
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminPage, { once: true });
  } else {
    initAdminPage();
  }
})();
