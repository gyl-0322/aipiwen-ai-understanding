(function () {
  function store() {
    return window.AIPIWEN && window.AIPIWEN.DryrunStore;
  }

  function now() {
    return new Date().toISOString();
  }

  function value(form, name) {
    const input = form.querySelector(`[name="${name}"]:checked`) || form.querySelector(`[name="${name}"]`);
    return input ? String(input.value || "").trim() : "";
  }

  function values(form, name) {
    return Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map((input) => input.value);
  }

  function showError(node, message) {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  function initFeedbackPage() {
    const page = document.querySelector("[data-dryrun-feedback]");
    if (!page || page.dataset.dryrunInitialized === "true") return;
    page.dataset.dryrunInitialized = "true";

    const dryStore = store();
    const form = page.querySelector("[data-feedback-form]");
    const errorNode = page.querySelector("[data-feedback-error]");
    if (!dryStore || !form) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      showError(errorNode, "");

      const requiredGroups = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q10"];
      const missing = requiredGroups.find((name) => (
        name === "q2" ? values(form, name).length === 0 : !form.querySelector(`[name="${name}"]:checked`)
      ));
      if (missing) {
        showError(errorNode, "请先完成所有必答选择题。");
        return;
      }

      const biggestDissatisfaction = value(form, "q8");
      const priorityFeature = value(form, "q9");
      if (dryStore.hasSensitiveText(`${biggestDissatisfaction}\n${priorityFeature}`)) {
        showError(errorNode, "自由文本中可能包含真实隐私信息，请使用脱敏表达后再提交。");
        return;
      }

      const state = dryStore.getDryrunState();
      dryStore.saveFeedback({
        createdAt: now(),
        sourcePage: "advisor-dryrun-feedback.html",
        advisorId: state.user ? state.user.userId : null,
        advisorNickname: state.user ? state.user.nickname : "",
        advisorRole: state.user ? state.user.role : "",
        answers: {
          willingnessToUseScore: Number(value(form, "q1")),
          valuableFeatures: values(form, "q2"),
          scriptUsabilityScore: Number(value(form, "q3")),
          processComplexityScore: Number(value(form, "q4")),
          creditModelAcceptance: value(form, "q5"),
          paidWillingness: value(form, "q6"),
          paymentPreference: value(form, "q7"),
          biggestDissatisfaction,
          priorityFeature,
          realAccountBetaWillingness: value(form, "q10")
        }
      });

      window.alert("反馈已保存，仅用于内测分析");
      window.location.href = "ai-interpreter-workbench.html";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFeedbackPage, { once: true });
  } else {
    initFeedbackPage();
  }
})();
