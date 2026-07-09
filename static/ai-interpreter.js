(function () {
  const steps = [
    {
      title: "建立安全感",
      short: "暖场、自我介绍、确认解读环境舒适",
      time: "3-5 分钟",
      goal: "让客户放松，确认今天的解读目标和节奏，在进入数据前先建立信任。",
      why: [
        "客户第一次进入报告解读时，最需要先确认自己不是被评价、被判断，而是在被理解。",
        "本次解读对象是妈妈，AI 建议先回应她对孩子学习状态的担心，再说明今天会一步步把报告翻译成可操作建议。"
      ],
      say: [
        "王妈妈，今天我们会按照一个标准流程来讲，先让您听懂报告在说什么，再一起看哪些地方能落到家庭教育里。",
        "如果中间有任何地方听起来像是在给孩子下结论，您可以随时打断我，我们会回到规则本身重新解释。"
      ],
      ask: [
        "您今天最希望从这份报告里解决哪一个具体困惑？",
        "小明最近让您最想理解的一个行为是什么？"
      ],
      no: [
        "不要一上来直接讲 TRC、ATD 或能力分布。",
        "不要说“这个报告很准，我直接告诉您孩子是什么类型”。"
      ],
      action: [
        "记录客户最关心的 1-2 个问题，后面第⑥步再集中回应。",
        "确认客户知道本次解读是辅助理解，不是诊断或预测。"
      ],
      risk: [
        "如果客户一开始就问医学、升学、职业结论，先说明边界，再把问题记录到关注问题里。"
      ]
    },
    {
      title: "严正声明和四条规则",
      short: "明确解读边界与客户权利",
      time: "2-3 分钟",
      goal: "在任何数据解读之前，先把报告性质、专业边界和四条规则讲清楚。",
      why: [
        "这是风险控制的前置动作。客户如果没有先听到边界，后续很容易把数值理解为好坏、预测或标签。",
        "四条规则要用新版完整表述，不能用旧版含糊替代。"
      ],
      say: [
        "本解读基于皮纹学及相关理论研究，报告数据反映先天特质倾向，不是诊断，不是预测。",
        "1. 数值没有好坏，高有高的特长，低有低的特长",
        "2. 不做未来预测，只解释天赋底色 + 后天环境 + 教育培养共同作用",
        "3. 不贴标签，不定义“孩子就是一个什么样的人”",
        "4. 不与他人比较，只与自己的平均值比较"
      ],
      ask: [
        "这四条规则您能接受吗？后面如果我们讲到数值，我会一直用这四条规则来解释。",
        "您更希望我讲得简洁一点，还是每个指标都多举生活例子？"
      ],
      no: [
        "不要说“这个结论只是参考一下”就跳过边界说明。",
        "不要把规则改成“报告很准但也要看后天”这类模糊表达。"
      ],
      action: [
        "让客户明确表示理解后再进入第③步。",
        "将客户特别敏感的问题标记为后续风险观察点。"
      ],
      risk: [
        "如果客户要求比较同龄人、预测未来成绩或诊断注意力问题，立即回到四条规则。"
      ]
    },
    {
      title: "讲性格类型，让客户产生共鸣",
      short: "用生活化语言介绍性格类型特征",
      time: "5-8 分钟",
      goal: "先讲客户能听懂、能验证的性格特征，让报告从抽象数据变成真实生活中的观察。",
      why: [
        "在进入底层数据前先建立共鸣，客户会更容易理解后面的 TRC、ATD 和左右脑并不是空泛指标。",
        "本客户关注数学成绩和注意力，先用性格类型讲“信息接收方式”，能降低防御感。"
      ],
      say: [
        "小明不是简单的安静或活泼，他更像是先观察、再判断、然后再行动的孩子。",
        "我们先不急着说好坏，先看这个类型在生活里通常会怎么接收信息、怎么做决定。"
      ],
      ask: [
        "您有没有观察到，小明遇到新任务时会先在旁边看一会儿？",
        "当您催他快一点时，他是更快进入状态，还是反而更卡住？"
      ],
      no: [
        "不要说“孩子就是这种性格，以后很难变”。",
        "不要把性格类型讲成固定标签。"
      ],
      action: [
        "每讲一个特征，都接一个生活场景和一个确认问题。",
        "把客户说“对对对”的反馈记录下来，后续作为行动建议依据。"
      ],
      risk: [
        "避免把性格类型与学业能力、职业方向直接绑定。"
      ]
    },
    {
      title: "TRC / ATD / 左右脑，解释底层数据",
      short: "解释数值含义，强调高低各有所长",
      time: "5-8 分钟",
      goal: "帮助客户理解底层数据是特质参数，不是分数，也不是能力评判。",
      why: [
        "客户已在性格类型步骤中产生共鸣，此时引入底层数据能增强信任感。",
        "TRC 185、ATD 42°、左脑主导都不属于极端值，适合正常解释；但客户关注数学和注意力，必须反复强调数值没有好坏。",
        "从五大功能区和十指特征看，本次可以优先结合学习通道、行为模式和客户关注问题展开。"
      ],
      say: [
        "王妈妈，接下来这些数值不是分数，也不是排名。数值没有好坏，高有高的特长，低有低的特长。",
        "TRC 可以理解为信息处理容量。较高时可能更擅长同时留意多件事，较低时也可能更擅长单点深度专注。",
        "ATD 42° 反映的是接收新信息时的本能节奏，我们不用快慢好坏来判断，而是看孩子适合怎样进入状态。",
        "左脑主导说明小明更习惯用逻辑和结构来理解信息，但这不等于聪明或不聪明，也不决定文理方向。"
      ],
      ask: [
        "您有没有发现，小明做作业时旁边有人说话，他好像也会留意到？",
        "第一次接触新任务时，他通常是先观察，还是马上尝试？",
        "他做选择时会不会比较喜欢问清楚原因和差别？"
      ],
      no: [
        "不要说“TRC 偏低说明能力不足”。",
        "不要说“ATD 角度大就是反应慢”。",
        "不要说“左脑发达，以后肯定是理工科人才”。",
        "不要拿孩子和别人家的孩子比较数值。"
      ],
      action: [
        "解释每个数值后，都给一个家庭里可观察的现象。",
        "如果客户问“是不是不行”，立即回到四条规则第一条。"
      ],
      risk: [
        "客户关注“注意力不集中”可能引出医学诊断期待，不能使用诊断词。",
        "客户关注“数学成绩偏弱”可能引出学业预测，不能做升学或成绩保证。"
      ]
    },
    {
      title: "讲学习通道 / 行为模式",
      short: "解释信息处理和行动方式",
      time: "5-8 分钟",
      goal: "把听觉、视觉、体觉通道和日常学习行为连接起来，让客户知道怎么观察、怎么调整。",
      why: [
        "第④步已经说明数值不是好坏判断，现在可以进入更具体的学习方式。",
        "小明听觉通道 82、体觉通道 70，适合用听讲复述和动手体验结合的方式。"
      ],
      say: [
        "小明的听觉通道比较突出，所以很多时候他说“我听到了”，并不只是客气，而是真的通过声音在接收信息。",
        "体觉通道也有支撑，所以只让他坐着听可能不够，配合写、画、摆、演示，理解会更稳定。"
      ],
      ask: [
        "您讲题时，他是听您讲更容易懂，还是看图更容易懂？",
        "他背课文或记知识点时，朗读出来会不会比默看更有效？"
      ],
      no: [
        "不要说“听觉型就不适合看书”。",
        "不要把学习通道当成唯一学习方式。"
      ],
      action: [
        "建议家长用“先听一遍、再说一遍、最后写下来”的三步法。",
        "把学习策略和客户关注问题建立连接，为第⑥步铺垫。"
      ],
      risk: [
        "不要把学习通道与考试结果直接挂钩。"
      ]
    },
    {
      title: "进入客户关注问题",
      short: "回应家长或客户的核心关切",
      time: "10-15 分钟",
      goal: "逐一回应客户标记的问题，把报告数据翻译成现实里的理解和支持方式。",
      why: [
        "客户真正付费购买的是“我该怎么办”的答案。前五步已经建立框架，现在可以回应具体问题。",
        "“注意力不集中”和“数学成绩偏弱”都属于高敏问题，需要用边界清晰、可观察、可行动的方式回答。"
      ],
      say: [
        "关于注意力，我们不做诊断，也不说孩子有没有某种问题。我们只看他在什么信息环境下更容易进入状态。",
        "关于数学，我们不预测未来成绩，也不把某个分数和学科能力绑定。我们可以从学习通道和行为模式里找更适合他的练习方式。"
      ],
      ask: [
        "他说注意力不集中通常发生在什么场景：听课、写作业，还是做不熟悉的题？",
        "数学让他卡住的地方更多是听不懂题意、计算出错，还是一看到题就抗拒？"
      ],
      no: [
        "不要说“这说明他以后数学会吃力”。",
        "不要说“这是不是注意力缺陷”，也不要顺着客户的诊断问题下结论。"
      ],
      action: [
        "把每个关注问题拆成场景、观察、可尝试方法三部分。",
        "对超出报告范围的问题，记录并建议客户寻求相应专业支持。"
      ],
      risk: [
        "医学、心理、重大教育决策类问题需要提示总部复核。"
      ]
    },
    {
      title: "给行动建议",
      short: "具体、可操作的家庭教育方案",
      time: "5-8 分钟",
      goal: "给出 3-5 条能立刻尝试的行动，区分近期可做和长期坚持。",
      why: [
        "解读不能停留在“孩子是什么样”，必须转化为家长能执行的支持方式。",
        "本客户适合低门槛开始，先给一周内可试的方法，再给长期观察指标。"
      ],
      say: [
        "我们先从一周内能做的小调整开始，不追求一下子改变孩子，而是观察哪一种方法更适合他。",
        "建议不是为了证明报告对，而是为了让您在家里更容易支持小明。"
      ],
      ask: [
        "这三条建议里，哪一条您觉得今晚就能试一下？",
        "如果只改一个家庭沟通方式，您最想先改哪一个？"
      ],
      no: [
        "不要给过多、过满、不可执行的建议。",
        "不要承诺“照做就一定提高成绩”。"
      ],
      action: [
        "每天 10 分钟听觉复述：让孩子用自己的话讲一遍当天一个知识点。",
        "复杂任务先给结构：先分三步，再开始做。",
        "观察一周：记录孩子在哪种环境下更容易进入状态。"
      ],
      risk: [
        "行动建议必须是支持性策略，不是治疗方案或升学方案。"
      ]
    },
    {
      title: "记录客户反馈 / 必要时提交总部复核",
      short: "生成记录摘要，风险内容提交总部",
      time: "3-5 分钟",
      goal: "记录客户收获、疑问和行动意向；涉及高风险内容时，提交总部复核。",
      why: [
        "记录不是行政动作，而是品牌质量控制和案例沉淀的入口。",
        "本次包含注意力和数学成绩两个敏感关注点，建议提交复核确认话术边界。"
      ],
      say: [
        "今天我们先把可操作的部分整理给您。涉及注意力和成绩判断的部分，我会按规范再做一次总部复核，确认表达安全后再回复您。",
        "您可以先记录这一周尝试后的观察，我们下次再看哪些方法更适合小明。"
      ],
      ask: [
        "今天哪一部分最让您觉得“原来是这样”？",
        "还有哪一部分您觉得需要我后续再解释？"
      ],
      no: [
        "不要把内部风险标签展示给客户。",
        "不要在未复核前交付高风险结论。"
      ],
      action: [
        "生成解读记录卡片：已讲步骤、客户反馈、行动建议、风险点。",
        "勾选“提交总部复核”，状态标记为等待中。"
      ],
      risk: [
        "任何诊断、预测、关系去留、升学职业保证相关内容都必须拦截或复核。"
      ]
    }
  ];

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function list(items) {
    return items.map((item) => `<li>${item}</li>`).join("");
  }

  function setList(id, items) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = list(items);
  }

  function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function updateStep(index) {
    const step = steps[index];
    if (!step) return;

    setText("current-step-index", `第 ${index + 1}/8 步`);
    setText("current-step-title", step.title);
    setText("current-step-goal", step.goal);
    setText("current-step-time", step.time);
    setList("current-step-points", [
      step.short,
      "每一步都先守住边界，再进入具体解释",
      index === 1 ? "此步骤必须完整宣读新版四条规则" : "遇到客户担忧时，回到四条规则做安抚"
    ]);

    setList("ai-why", step.why);
    setList("ai-say", step.say);
    setList("ai-ask", step.ask);
    setList("ai-no", step.no);
    setList("ai-action", step.action);
    setList("ai-risk", step.risk);

    const progress = document.getElementById("session-progress");
    if (progress) progress.style.width = `${((index + 1) / steps.length) * 100}%`;

    $$(".step-card").forEach((button, buttonIndex) => {
      button.classList.toggle("active", buttonIndex === index);
      const status = button.querySelector(".status");
      if (!status) return;
      status.className = "status";
      if (buttonIndex < index) {
        status.classList.add("done");
        status.textContent = "已完成";
      } else if (buttonIndex === index) {
        status.classList.add("info");
        status.textContent = "进行中";
      } else {
        status.textContent = "待开始";
      }
    });
  }

  function initNavigation() {
    const page = document.body.dataset.page;
    $$(".nav-link").forEach((link) => {
      link.classList.toggle("active", link.dataset.page === page);
    });
  }

  function initSession() {
    if (!document.body.matches('[data-page="session"]')) return;

    $$(".step-card").forEach((button, index) => {
      button.addEventListener("click", () => updateStep(index));
    });

    const prev = document.getElementById("prev-step");
    const next = document.getElementById("next-step");
    const skip = document.getElementById("skip-step");
    let current = 3;

    function go(index) {
      current = Math.max(0, Math.min(steps.length - 1, index));
      updateStep(current);
    }

    if (prev) prev.addEventListener("click", () => go(current - 1));
    if (next) next.addEventListener("click", () => go(current + 1));
    if (skip) skip.addEventListener("click", () => go(current + 1));

    go(current);
  }

  function initCustomerRows() {
    $$(".js-open-session").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.href = "ai-interpreter-session.html";
      });
    });
  }

  function initReviewDemo() {
    if (!document.body.matches('[data-page="review"]')) return;

    $$(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.reviewTarget;
        $$(".tab-btn").forEach((item) => item.classList.toggle("active", item === button));
        $$(".review-demo-card").forEach((card) => {
          card.classList.toggle("active", card.dataset.reviewCard === target);
        });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initSession();
    initCustomerRows();
    initReviewDemo();
  });
})();
