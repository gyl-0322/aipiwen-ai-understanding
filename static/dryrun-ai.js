(function () {
  const ROUTE = [
    { title: "建立安全感", short: "暖场、自我介绍、确认解读环境舒适", time: "3-5 分钟" },
    { title: "严正声明和四条规则", short: "明确解读边界与客户权利", time: "2-3 分钟" },
    { title: "讲性格类型，让客户产生共鸣", short: "用生活化语言介绍性格类型特征", time: "5-8 分钟" },
    { title: "TRC / ATD / 左右脑，解释底层数据", short: "解释数值含义，强调高低各有所长", time: "5-8 分钟" },
    { title: "讲学习通道 / 行为模式", short: "解释信息处理和行动方式", time: "5-8 分钟" },
    { title: "进入客户关注问题", short: "回应家长或客户的核心关切", time: "10-15 分钟" },
    { title: "给行动建议", short: "具体、可操作的家庭教育方案", time: "5-8 分钟" },
    { title: "记录客户反馈 / 必要时提交总部复核", short: "记录反馈，风险内容提交复核", time: "3-5 分钟" }
  ];
  const FOUR_RULES = [
    "数值没有好坏，高有高的特长，低有低的特长",
    "不做未来预测，只解释天赋底色 + 后天环境 + 教育培养共同作用",
    "不贴标签，不定义“孩子就是一个什么样的人”",
    "不与他人比较，只与自己的平均值比较"
  ];

  function store() {
    return window.AIPIWEN && window.AIPIWEN.DryrunStore;
  }

  function credit() {
    return window.AIPIWEN && window.AIPIWEN.DryrunCredit;
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

  function listHtml(items) {
    return (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function setText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function setList(id, items) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = listHtml(items);
  }

  function ratingLabel(value) {
    return {
      usable: "可直接用",
      needs_edit: "需要改",
      unusable: "不适用"
    }[value] || "";
  }

  function generateInterpretationRoute() {
    return ROUTE.map((step, index) => ({
      ...step,
      stepIndex: index,
      number: "①②③④⑤⑥⑦⑧"[index]
    }));
  }

  function questionText(selectedQuestions) {
    return selectedQuestions && selectedQuestions.length ? selectedQuestions.join("、") : "客户关注问题";
  }

  function generateStepScript({ stepIndex, reportSummary, selectedQuestions }) {
    const summary = reportSummary || {};
    const questions = questionText(selectedQuestions);
    const base = {
      why: ["本内容由 V2 Dry-run 本地规则生成，用于内测验证话术结构，不调用真实模型。"],
      say: ["我们先把报告翻译成可观察、可行动的语言，再结合您关心的问题逐步回应。"],
      ask: ["您希望我先讲报告结构，还是先回应最关心的问题？"],
      no: ["不要把数值当成好坏分数，也不要把单一指标当成结论。"],
      action: ["记录客户回应，把可尝试的方法控制在 1-3 条。"],
      risk: ["如客户提出医疗、重大教育决策或关系决策，需要暂停并提示后续人工确认。"]
    };

    const scripts = [
      {
        why: ["先建立安全感，可以降低客户对数据的紧张感。", `本次关注点包含：${questions}，建议先确认客户最想解决的一件事。`],
        say: ["今天我们会按标准流程来讲，先讲边界，再讲数据，最后落到可尝试的方法。", "如果有任何内容听起来像给人下结论，您可以提醒我，我们会回到规则本身。"],
        ask: ["您今天最想先理解哪一个具体场景？", "最近让您最困惑的行为发生在什么时候？"],
        no: ["不要一上来直接讲 TRC、ATD 或功能区。", "不要说“这个报告很准，我直接告诉您结果”。"],
        action: ["记录客户的首要问题。", "确认客户知道本次是辅助理解，不替代专业判断。"],
        risk: ["客户如果要求直接给结论，先回到解读边界。"]
      },
      {
        why: ["四条规则是后续所有表达的安全底线。", "客户先理解规则，后面听到数值时更不容易焦虑。"],
        say: ["我们先统一四条规则：", ...FOUR_RULES],
        ask: ["这四条规则您能接受吗？", "后面我会一直用这四条规则解释数据，可以吗？"],
        no: ["不要跳过规则直接进入数据。", "不要把规则改成含糊的“仅供参考”。"],
        action: ["让客户明确表示理解后再进入下一步。", "把客户特别在意的问题放到第⑥步回应。"],
        risk: ["若客户要求横向比较或确定性判断，立即回到四条规则。"]
      },
      {
        why: ["先讲生活中能观察到的倾向，更容易让客户产生共鸣。", "共鸣建立后，再解释底层数据会更顺畅。"],
        say: ["我们先不急着看数值，先看生活里更容易观察到的反应方式。", "同一个特质在不同环境里会有不同表现，所以我们只做观察和支持。"],
        ask: ["孩子遇到新任务时通常先观察，还是马上行动？", "被催促时更容易进入状态，还是更容易卡住？"],
        no: ["不要把性格类型讲成固定标签。", "不要把性格特征和学业结果直接绑定。"],
        action: ["每讲一个特征，都接一个生活场景。", "记录客户说“对”的地方，后续转成行动建议。"],
        risk: ["避免把客户的共鸣当作证明，只作为继续沟通的线索。"]
      },
      {
        why: [`本次 TRC 为 ${summary.trc || "-"}，ATD 为 ${summary.atd || "-"}°，适合用“特质参数”而不是“分数”来解释。`, "左右脑和功能区摘要只用于帮助理解信息处理习惯。"],
        say: [`TRC、ATD 和左右脑不是排名。${FOUR_RULES[0]}。`, `${summary.brainDominance || "左右脑特征"}说明的是信息处理习惯，不代表能力高低。`],
        ask: ["做新任务时，他更容易先听说明，还是先看示范？", "遇到复杂题目时，更卡在理解题意，还是卡在开始行动？"],
        no: ["不要说“数值低就是不足”。", "不要拿客户和别人比较。"],
        action: ["每个数值只配一个生活观察例子。", "客户问“是不是不行”时，回到四条规则第一条。"],
        risk: ["与成绩、升学、健康相关的问题，需要转为观察和支持策略。"]
      },
      {
        why: [`学习风格显示为 ${summary.learningStyle || "-"}，适合把学习通道和日常行为结合讲。`, "通道不是唯一方式，只是更容易进入状态的入口。"],
        say: ["学习通道可以理解为更容易接收信息的入口，不是限制。", "我们可以尝试“先听、再说、最后动手整理”的组合方式。"],
        ask: ["讲题时，听您讲更容易懂，还是看到步骤更容易懂？", "复述出来以后，理解会不会更稳定？"],
        no: ["不要说“听觉型就不适合看书”。", "不要把学习通道当成唯一方法。"],
        action: ["用一周观察哪种方式更容易进入状态。", "把客户关注问题拆成场景、观察、尝试方法。"],
        risk: ["不要承诺某种学习方式一定带来分数变化。"]
      },
      {
        why: [`客户真正想解决的是：${questions}。`, "前五步已经建立理解框架，现在可以回应具体场景。"],
        say: [`关于${questions}，我们先看它通常发生在什么场景，再看能尝试什么支持方式。`, "报告给我们的是理解入口，不是直接结论。"],
        ask: ["这个问题最常发生在家里、学校，还是新任务开始时？", "如果只选一个最想先改善的场景，会是哪一个？"],
        no: ["不要顺着客户的焦虑给绝对结论。", "不要把某个手指或功能区和问题做确定因果绑定。"],
        action: ["把每个问题拆成：场景、触发点、可尝试方法。", "先选一条最小行动建议开始。"],
        risk: ["涉及健康、重大教育选择或家庭冲突时，记录并交由人工确认。"]
      },
      {
        why: ["解读必须落到客户能执行的小步骤。", "建议越少越容易开始，先让客户体验到可操作。"],
        say: ["我们先从一周内能做的小调整开始，不追求一次改变所有问题。", "建议是为了帮助您更容易支持孩子，不是为了证明报告对。"],
        ask: ["这几条里，哪一条今天就能试？", "如果只改一个沟通方式，您最想先改哪一个？"],
        no: ["不要给过多、过满、不可执行的建议。", "不要做结果承诺。"],
        action: ["每天 10 分钟复述一个知识点。", "复杂任务先拆三步再开始。", "观察一周后记录最有效的进入状态方式。"],
        risk: ["行动建议必须是支持策略，不是治疗或重大决策方案。"]
      },
      {
        why: ["记录反馈可以帮助后续复盘，也能为 Emma 评估 V2 价值提供依据。", "风险内容需要留痕并人工确认。"],
        say: ["今天我们先把可行动的部分整理出来，后续再根据观察调整。", "如果有超出报告范围的问题，我会单独记录并建议人工确认。"],
        ask: ["今天哪一部分最有帮助？", "还有哪一部分您希望后续再解释？"],
        no: ["不要把内部判断直接展示给客户。", "不要在未确认前交付高风险结论。"],
        action: ["保存本次 mock 解读记录。", "记录客户反馈和下一步行动。"],
        risk: ["任何高敏内容都只做记录和人工确认，不直接给结论。"]
      }
    ];

    return scripts[stepIndex] || base;
  }

  function renderFingerZones(summary) {
    const zones = summary.fiveZones || [];
    return zones.map((zone) => {
      const right = zone.right || [];
      const left = zone.left || [];
      const rightValue = Math.max(10, Math.min(95, Number(right[2] || 20) * 2.8));
      const leftValue = Math.max(10, Math.min(95, Number(left[2] || 20) * 2.8));
      return `<div class="finger-row">
        <h3><span>${zone.zone.replace("功能", "")}</span><span>功能</span></h3>
        <div class="finger-pair">
          <div class="finger-hand" style="--value:${rightValue}%"><span>右手</span><strong><i>${right[0]}</i><i>${right[1]}</i></strong><em>${right[2]} ${right[3]}</em></div>
          <div class="finger-hand" style="--value:${leftValue}%"><span>左手</span><strong><i>${left[0]}</i><i>${left[1]}</i></strong><em>${left[2]} ${left[3]}</em></div>
        </div>
      </div>`;
    }).join("");
  }

  function initDryrunSession() {
    if (!document.body.matches('[data-page="session"]')) return;
    const dryStore = store();
    const dryCredit = credit();
    if (!dryStore || !dryCredit) return;
    const bundle = dryStore.getActiveSessionBundle();
    if (!bundle || !bundle.customer || !bundle.reportSummary) return;

    const { session, customer, reportSummary } = bundle;
    const route = generateInterpretationRoute(reportSummary, session.selectedQuestions);
    let currentStep = session.currentStep || 0;
    let generatedScripts = route.map((step) => generateStepScript({ stepIndex: step.stepIndex, reportSummary, selectedQuestions: session.selectedQuestions }));

    function getSavedScriptRating(sectionType, scriptText, scriptIndex) {
      return dryStore.getScriptRatings().find((item) => (
        item.sessionId === session.sessionId
        && Number(item.stepIndex) === Number(currentStep)
        && item.sectionType === sectionType
        && (Number(item.scriptIndex) === Number(scriptIndex) || item.scriptText === scriptText)
      ));
    }

    function setScriptList(id, items, sectionType) {
      const node = document.getElementById(id);
      if (!node) return;
      node.innerHTML = (items || []).map((item, scriptIndex) => {
        const savedRating = getSavedScriptRating(sectionType, item, scriptIndex);
        const activeRating = savedRating ? savedRating.rating : "";
        const savedNote = savedRating && savedRating.note ? `<small class="script-rating-note">备注：${escapeHtml(savedRating.note)}</small>` : "";
        const status = activeRating ? `<small class="script-rating-current">已标记：${escapeHtml(ratingLabel(activeRating))}</small>` : "";
        return `<li class="script-rating-item">
          <span class="script-rating-text">${escapeHtml(item)}</span>
          <span class="script-rating-actions" aria-label="话术可用度标记">
            <button class="rating-btn ${activeRating === "usable" ? "active" : ""}" type="button" data-script-rating="usable" data-section-type="${sectionType}" data-script-index="${scriptIndex}">👍 可直接用</button>
            <button class="rating-btn ${activeRating === "needs_edit" ? "active" : ""}" type="button" data-script-rating="needs_edit" data-section-type="${sectionType}" data-script-index="${scriptIndex}">✏️ 需要改</button>
            <button class="rating-btn ${activeRating === "unusable" ? "active" : ""}" type="button" data-script-rating="unusable" data-section-type="${sectionType}" data-script-index="${scriptIndex}">👎 不适用</button>
          </span>
          ${status}${savedNote}
        </li>`;
      }).join("");
      node.querySelectorAll("[data-script-rating]").forEach((button) => {
        button.addEventListener("click", function () {
          const section = button.dataset.sectionType;
          const index = Number(button.dataset.scriptIndex);
          const rating = button.dataset.scriptRating;
          const scriptText = (generatedScripts[currentStep][section] || [])[index] || "";
          let note = "";
          if (rating === "needs_edit" || rating === "unusable") {
            note = window.prompt("哪里需要调整？可选填写。", "") || "";
          }
          dryStore.saveScriptRating({
            feedbackId: `sf_${session.sessionId}_${currentStep}_${section}_${index}`,
            sessionId: session.sessionId,
            customerId: session.customerId,
            advisorId: session.advisorId,
            stepIndex: currentStep,
            sectionType: section,
            scriptIndex: index,
            scriptText,
            rating,
            note
          });
          renderStep(currentStep);
        });
      });
    }

    setText(".topbar h1", `AI解读助手 · ${customer.nickname}`);
    setText(".topbar p:not(.eyebrow)", `${reportSummary.reportType} · V2 Dry-run 本地规则生成 · 当前模拟会话。`);
    const sideNote = document.querySelector(".sidebar-note");
    if (sideNote) sideNote.textContent = "V2 Dry-run：本页使用本地规则生成话术，不调用真实 AI，不写入 Report OS。";

    const customerModule = document.querySelector(".session-column .module:nth-child(1) .data-list");
    if (customerModule) {
      customerModule.innerHTML = `
        <div class="data-item"><span>客户昵称</span><strong>${escapeHtml(customer.nickname)}</strong></div>
        <div class="data-item"><span>年龄范围</span><strong>${escapeHtml(customer.childAgeRange)}</strong></div>
        <div class="data-item"><span>解读对象</span><strong>${escapeHtml(customer.relationship)}</strong></div>
        <div class="data-item"><span>来源</span><strong>${escapeHtml(dryStore.sourceLabel(customer.sourceChannel))}</strong></div>
        <div class="data-item"><span>绑定方式</span><strong>${escapeHtml(dryStore.sourceLabel(customer.bindingMethod))}</strong></div>
        <div class="data-item"><span>会话状态</span><strong>${session.status === "generated" ? "已生成解读方案" : "解读中"}</strong></div>`;
    }
    const reportModule = document.querySelector(".session-column .module:nth-child(2) .data-list");
    if (reportModule) {
      reportModule.innerHTML = `
        <div class="data-item"><span>报告类型</span><strong>${escapeHtml(reportSummary.reportType)}</strong></div>
        <div class="data-item"><span>TRC</span><strong>${escapeHtml(reportSummary.trc)}</strong></div>
        <div class="data-item"><span>ATD</span><strong>${escapeHtml(reportSummary.atd)}°</strong></div>
        <div class="data-item"><span>左右脑</span><strong>${escapeHtml(reportSummary.brainDominance)}</strong></div>
        <div class="data-item"><span>学习风格</span><strong>${escapeHtml(reportSummary.learningStyle)}</strong></div>`;
    }
    const finger = document.querySelector(".finger-summary");
    if (finger) finger.innerHTML = renderFingerZones(reportSummary);
    const questionBox = document.querySelector(".pill-row");
    if (questionBox) questionBox.innerHTML = session.selectedQuestions.map((question) => `<span class="pill">${escapeHtml(question)}</span>`).join("");

    const stepList = document.querySelector(".step-list");
    if (stepList) {
      stepList.innerHTML = route.map((step) => `<button class="step-card" type="button" data-step="${step.stepIndex}">
        <span class="step-index">${step.number}</span>
        <span><strong>${step.title}</strong><small>${step.short}</small></span>
        <span class="status">待开始</span>
      </button>`).join("");
    }

    function renderStep(index) {
      currentStep = Math.max(0, Math.min(route.length - 1, index));
      const step = route[currentStep];
      const script = generatedScripts[currentStep];
      setText("#current-step-index", `第 ${currentStep + 1}/8 步`);
      setText("#current-step-title", step.title);
      setText("#current-step-goal", step.short);
      setText("#current-step-time", step.time);
      setList("current-step-points", [
        "当前内容来自 V2 Dry-run 本地规则。",
        "先守住四条规则，再回应客户问题。",
        currentStep === 5 ? `本步重点回应：${questionText(session.selectedQuestions)}` : "遇到高敏问题时记录并人工确认。"
      ]);
      setList("ai-why", script.why);
      setScriptList("ai-say", script.say, "say");
      setScriptList("ai-ask", script.ask, "ask");
      setList("ai-no", script.no);
      setScriptList("ai-action", script.action, "action");
      setList("ai-risk", script.risk);
      const progress = document.getElementById("session-progress");
      if (progress) progress.style.width = `${((currentStep + 1) / route.length) * 100}%`;
      document.querySelectorAll(".step-card").forEach((button, indexInList) => {
        button.classList.toggle("active", indexInList === currentStep);
        const status = button.querySelector(".status");
        if (!status) return;
        status.className = "status";
        if (indexInList < currentStep) {
          status.classList.add("done");
          status.textContent = "已完成";
        } else if (indexInList === currentStep) {
          status.classList.add("info");
          status.textContent = "进行中";
        } else {
          status.textContent = "待开始";
        }
      });
      dryStore.updateInterpretationSession(session.sessionId, { currentStep });
    }

    document.querySelectorAll(".step-card").forEach((button) => {
      button.addEventListener("click", () => renderStep(Number(button.dataset.step)));
    });
    ["prev-step", "next-step", "skip-step"].forEach((id) => {
      const oldButton = document.getElementById(id);
      if (!oldButton) return;
      const button = oldButton.cloneNode(true);
      oldButton.replaceWith(button);
      if (id === "prev-step") button.addEventListener("click", () => renderStep(currentStep - 1));
      if (id === "next-step" || id === "skip-step") button.addEventListener("click", () => renderStep(currentStep + 1));
    });

    const generateOld = document.getElementById("generate-plan");
    if (generateOld) {
      const generateButton = generateOld.cloneNode(true);
      generateOld.replaceWith(generateButton);
      generateButton.addEventListener("click", function () {
        const balance = dryCredit.getCreditBalance();
        if (balance < 50) {
          window.alert(`积分不足：生成完整解读方案需要 50 mock 积分，当前余额 ${balance}。可复制邀请链接或联系 Emma 补充内测积分。`);
          return;
        }
        if (!window.confirm(`确认消耗 50 mock 积分生成完整解读方案？当前余额 ${balance}，消耗后 ${balance - 50}。`)) return;
        dryCredit.spendCredit(50, "AI_INTERPRETATION_FULL", "生成完整 AI 解读方案（本地规则）", session.sessionId);
        generatedScripts = route.map((step) => generateStepScript({ stepIndex: step.stepIndex, reportSummary, selectedQuestions: session.selectedQuestions }));
        const fullRecord = dryStore.saveInterpretationRecord({
          sessionId: session.sessionId,
          advisorId: session.advisorId,
          customerId: session.customerId,
          fullRoute: route,
          aiWhy: generatedScripts.map((item) => item.why),
          aiSay: generatedScripts.map((item) => item.say),
          aiAsk: generatedScripts.map((item) => item.ask),
          aiNo: generatedScripts.map((item) => item.no),
          aiAction: generatedScripts.map((item) => item.action),
          aiRisk: generatedScripts.map((item) => item.risk),
          selectedQuestions: session.selectedQuestions,
          creditsSpent: 50
        });
        dryStore.markSessionGenerated(session.sessionId, 50);
        renderStep(currentStep);
        window.alert(`已生成完整 mock 解读方案并保存记录：${fullRecord.recordId}`);
      });
    }

    const actions = document.querySelector(".topbar .top-actions");
    if (actions && !document.getElementById("save-mock-record")) {
      const save = document.createElement("button");
      save.className = "btn";
      save.id = "save-mock-record";
      save.type = "button";
      save.textContent = "保存本次 mock 解读记录";
      save.addEventListener("click", function () {
        const script = generatedScripts[currentStep];
        dryStore.saveInterpretationRecord({
          sessionId: session.sessionId,
          advisorId: session.advisorId,
          customerId: session.customerId,
          stepIndex: currentStep,
          stepTitle: route[currentStep].title,
          aiWhy: script.why,
          aiSay: script.say,
          aiAsk: script.ask,
          aiNo: script.no,
          aiAction: script.action,
          aiRisk: script.risk,
          selectedQuestions: session.selectedQuestions,
          creditsSpent: 0
        });
        window.alert("已保存当前步骤 mock 解读记录。");
      });
      const back = document.createElement("a");
      back.className = "btn ghost";
      back.href = "ai-interpreter-customers.html";
      back.textContent = "返回客户列表";
      actions.appendChild(save);
      actions.appendChild(back);
    }

    renderStep(currentStep);
  }

  window.AIPIWEN = window.AIPIWEN || {};
  window.AIPIWEN.DryrunAI = {
    FOUR_RULES,
    generateInterpretationRoute,
    generateStepScript
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDryrunSession, { once: true });
  } else {
    initDryrunSession();
  }
})();
