# AIPIWEN Advisor Workbench V4.0 — Codex 执行指令

> 基于《AIPIWEN_Advisor_Workbench_V4_Architecture_and_Interface_Design_V1.md》
> 执行范围：Phase 1（Sprint 5）前端 + 后端完整交付
> 所有页面基于现有 `static/ai-interpreter.css` 和 V3A HTML 结构模式

---

## 一、执行前提

### 1.1 现有代码基线（只读参考，不动）

| 文件 | 用途 |
|------|------|
| `static/ai-interpreter.css` | 2498 行，所有新页面复用其 class，仅追加不删除 |
| `ai-interpreter-workbench.html` | 工作台首页，需升级 |
| `ai-interpreter-customers.html` | 客户列表，需升级 |
| `ai-interpreter-session.html` | AI 解读助手，**不动** |
| `ai-interpreter-training.html` | 解读训练，**不动** |
| `ai-interpreter-review.html` | 总部复核/规范，**不动** |
| `ai-interpreter-cases.html` | 特殊案例库，需升级 |
| `static/v3a-auth.js` | 认证逻辑，**不动** |
| `static/ai-interpreter.js` | 解读助手逻辑，**不动** |

### 1.2 设计文档

完整规格见：`AIPIWEN_Advisor_Workbench_V4_Architecture_and_Interface_Design_V1.md`
Codex 遇到规格疑问时，以该文档为准。

---

## 二、CSS 扩展（优先级最高，先做）

### 文件：`static/ai-interpreter.css`

**操作**：在文件末尾追加以下内容（不修改任何已有代码）：

```css
/* ============================================================
   V4.0 新增样式 — 指导师工作台升级
   ============================================================ */

/* 服务阶段标签 */
.stage-tag {
  display: inline-flex; align-items: center; min-height: 26px;
  padding: 3px 10px; border-radius: 999px; font-size: 11px;
  font-weight: 800; white-space: nowrap;
}
.stage-tag.initial       { border:1px solid rgba(82,213,232,.36); color:#c8f8ff; background:rgba(82,213,232,.09); }
.stage-tag.early         { border:1px solid rgba(106,168,255,.36); color:#c0d8ff; background:rgba(106,168,255,.09); }
.stage-tag.deep          { border:1px solid rgba(169,140,255,.36); color:#d8ccff; background:rgba(169,140,255,.09); }
.stage-tag.consolidation { border:1px solid rgba(101,212,154,.36); color:#b6ffd3; background:rgba(101,212,154,.09); }

/* 候选案例标签 */
.case-candidate-tag {
  display: inline-flex; align-items: center; min-height: 22px;
  padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800;
  border: 1px solid rgba(242,163,74,.4); color: #ffe0ae; background: rgba(242,163,74,.08);
}

/* 辅导四段式面板 */
.coaching-output { display: grid; gap: 14px; }
.coaching-section { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.035); }
.coaching-section h3 { margin-bottom: 10px; display: flex; align-items: center; gap: 8px; font-size: 14px; }
.coaching-section h3 span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; font-size: 13px; font-weight: 900; }
.coaching-understanding { border-color: rgba(82,213,232,.28); background: rgba(82,213,232,.05); }
.coaching-understanding h3 span { background: rgba(82,213,232,.16); color: var(--cyan); }
.coaching-direction h3 span { background: rgba(106,168,255,.16); color: var(--blue); }
.coaching-script { border-color: rgba(101,212,154,.22); }
.coaching-script h3 span { background: rgba(101,212,154,.16); color: var(--green); }
.coaching-risk { border-color: rgba(242,163,74,.24); }
.coaching-risk h3 span { background: rgba(242,163,74,.16); color: var(--amber); }

/* 时间线 */
.timeline-list { display: grid; gap: 12px; }
.timeline-item { display: grid; grid-template-columns: 120px 1fr; gap: 14px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.028); }
.timeline-meta { display: grid; gap: 4px; align-content: start; }
.timeline-meta time { color: var(--cyan); font-size: 13px; font-weight: 800; }
.timeline-meta .source { color: var(--faint); font-size: 11px; }
.timeline-body { display: grid; gap: 8px; }
.timeline-body p { color: var(--muted); line-height: 1.75; }
.timeline-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* 方向指示器 */
.direction-tag {
  display: inline-flex; align-items: center; min-height: 22px;
  padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; white-space: nowrap;
}
.direction-tag.improving { border:1px solid rgba(101,212,154,.36); color:#b6ffd3; }
.direction-tag.declining { border:1px solid rgba(255,111,115,.36); color:#ffc6c8; }
.direction-tag.stable { border:1px solid rgba(149,173,211,.36); color:var(--muted); }
.direction-tag.new_emergence { border:1px solid rgba(242,163,74,.36); color:#ffe0ae; }

/* 辅导输入区 */
.coaching-input-area { display: grid; gap: 12px; }
.coaching-input-area textarea { min-height: 110px; }

/* 360 档案 Tab 栏 */
.archive-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.archive-tab { min-height: 36px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.035); color: var(--muted); cursor: pointer; font-size: 14px; }
.archive-tab:hover { border-color: var(--line-strong); }
.archive-tab.active { border-color: var(--line-strong); background: rgba(82,213,232,.1); color: var(--text); }
.archive-tab em { margin-left: 6px; color: var(--cyan); font-style: normal; font-weight: 800; }

/* 成长记录表单 */
.growth-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.growth-form-grid .full-width { grid-column: 1 / -1; }

/* 仪表盘线索卡片 */
.clue-card { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.028); display: grid; gap: 10px; cursor: pointer; }
.clue-card:hover { border-color: var(--line-strong); background: rgba(82,213,232,.05); }
.clue-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.clue-card-header strong { color: var(--text); font-size: 14px; }
.clue-card p { color: var(--muted); font-size: 13px; line-height: 1.7; }
.clue-card .clue-action { color: var(--cyan); font-size: 12px; font-weight: 800; justify-self: end; }

/* 案例存入弹窗 */
.case-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 999; display: grid; place-items: center; }
.case-modal { width: 560px; max-height: 85vh; overflow-y: auto; padding: 24px; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--bg); display: grid; gap: 16px; }
.case-modal h2 { font-size: 16px; }
.case-modal .form-row { display: grid; gap: 6px; }
.case-modal .form-row label { font-size: 12px; color: var(--muted); font-weight: 800; text-transform: uppercase; }
.case-modal textarea { min-height: 100px; }
.case-modal .btn-row { display: flex; gap: 8px; justify-content: flex-end; }

/* 案例列表卡片 */
.case-list { display: grid; gap: 10px; }
.case-card-item { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.028); display: grid; gap: 8px; }
.case-card-item:hover { border-color: var(--line-strong); }
.case-card-item .case-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.case-card-item .case-title { color: var(--text); font-size: 14px; font-weight: 800; }
.case-card-item .case-summary { color: var(--muted); font-size: 13px; line-height: 1.7; }
.case-visibility-tag { display: inline-flex; align-items: center; min-height: 20px; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; }
.case-visibility-tag.private { border:1px solid rgba(149,173,211,.3); color:var(--muted); }
.case-visibility-tag.submitted { border:1px solid rgba(242,163,74,.3); color:#ffe0ae; }
.case-visibility-tag.shared { border:1px solid rgba(101,212,154,.3); color:#b6ffd3; }

/* 提示条 */
.insight-bar { padding: 10px 14px; border-radius: 8px; font-size: 12px; display: grid; gap: 4px; }
.insight-bar.warn { border: 1px solid rgba(242,163,74,.3); background: rgba(242,163,74,.06); color: #ffe0ae; }
.insight-bar.info { border: 1px solid rgba(82,213,232,.3); background: rgba(82,213,232,.06); color: #c8f8ff; }
.insight-bar.good { border: 1px solid rgba(101,212,154,.3); background: rgba(101,212,154,.06); color: #b6ffd3; }
```

---

## 三、侧边栏统一升级（影响所有页面）

### 每个 HTML 文件的 `<nav class="nav-links">` 替换为：

```html
<nav class="nav-links">
  <a class="nav-link" data-page="workbench" href="ai-interpreter-workbench.html">⌂ 工作台首页</a>
  <a class="nav-link" data-page="customers" href="ai-interpreter-customers.html">◎ 我的客户</a>
  <a class="nav-link" data-page="client-360" href="client-360.html">● 客户 360 档案</a>
  <a class="nav-link" data-page="session" href="ai-interpreter-session.html">◈ AI解读助手</a>
  <a class="nav-link" data-page="coaching" href="ai-coaching-assistant.html">◉ AI辅导助手</a>
  <a class="nav-link" data-page="growth-record" href="growth-record.html">✎ 成长记录</a>
  <a class="nav-link" data-page="training" href="ai-interpreter-training.html">▣ 解读训练</a>
  <a class="nav-link" data-page="review" href="ai-interpreter-review.html">◇ 总部复核 / 规范</a>
  <a class="nav-link" data-page="cases" href="ai-interpreter-cases.html">✦ 特殊案例库</a>
</nav>
```

---

## 四、逐页面修改清单

### 4.1 工作台首页升级：`ai-interpreter-workbench.html`

**操作**：
1. 侧边栏替换为第三部分的 9 项导航
2. 在「今日概览」三个卡片后面、「最近解读记录」模块前面，插入「今日辅导线索」模块
3. 保留现有「个人成长快照」「今日概览」「最近解读记录」「总部公告」

**插入的 HTML 结构**：

```html
<section class="module">
  <div class="card-header">
    <span class="card-title">今日辅导线索</span>
    <span class="card-sub">以下客户可能需要你今天关注</span>
  </div>
  <div class="clue-list" id="clueList" style="display:grid; gap:10px;">
    <!-- JS 动态渲染 -->
    <div class="clue-card" data-person-id="" onclick="window.location.href='ai-coaching-assistant.html?person_id='">
      <div class="clue-card-header">
        <strong>加载中...</strong>
        <span class="stage-tag initial">初始解读期</span>
      </div>
      <p></p>
      <span class="clue-action"></span>
    </div>
  </div>
</section>
```

**对应 JS**：`static/v3a-workbench-clues.js`（见第五部分）

---

### 4.2 客户列表升级：`ai-interpreter-customers.html`

**操作**：
1. 侧边栏替换为第三部分的 9 项导航
2. 表头从 8 列扩展为 10 列（新增「服务阶段」「标签」列）
3. 每行操作区新增「存入案例库」按钮
4. 服务阶段和候选案例标签由 JS 动态渲染

**表格变更**：

```
原 8 列: 客户 | 来源 | 指导师 | 报告数 | 最近报告 | 报告类型 | 状态 | 操作
新 10列: 客户 | 来源 | 指导师 | 报告数 | 最近报告 | 报告类型 | 状态 | 服务阶段 | 标签 | 操作
```

**操作列新增按钮**：`<button class="btn ghost" onclick="openCaseModal(personId, personName)">存入案例库</button>`

**对应 JS**：`static/v3a-customers-stage.js` + `static/v3a-case-cards.js`（弹窗逻辑）

---

### 4.3 客户 360 档案（新建）：`client-360.html`

**完整页面结构**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>客户 360 档案 - AIPIWEN</title>
  <link rel="stylesheet" href="static/ai-interpreter.css">
</head>
<body data-page="client-360">
<div class="app-shell">
  <!-- 侧边栏 — 使用第三部分统一导航，active 项为 client-360 -->
  <aside class="sidebar">...</aside>

  <main class="main">
    <header class="topbar">
      <span class="topbar-title" id="pageTitle">客户 360 · 加载中...</span>
      <div class="topbar-actions">
        <button class="btn primary" id="btnStartCoaching">发起辅导</button>
        <button class="btn ghost" id="btnAddRecord">添加记录</button>
      </div>
    </header>

    <!-- 客户摘要 -->
    <section class="module" id="clientSummary">
      <div class="card-header">
        <span class="card-title" id="clientName">加载中...</span>
        <span class="stage-tag" id="clientStage">--</span>
      </div>
      <div class="data-list" id="summaryData">
        <div class="data-item"><span class="data-label">最近报告</span><span class="data-value" id="sumReport">--</span></div>
        <div class="data-item"><span class="data-label">下次回访</span><span class="data-value" id="sumFollowUp">--</span></div>
        <div class="data-item"><span class="data-label">指导师</span><span class="data-value" id="sumAdvisor">--</span></div>
        <div class="data-item"><span class="data-label">来源</span><span class="data-value" id="sumSource">--</span></div>
      </div>
    </section>

    <!-- Tab 栏 -->
    <nav class="archive-tabs" id="archiveTabs">
      <button class="archive-tab active" data-tab="fingerprint">指纹档案</button>
      <button class="archive-tab" data-tab="timeline">成长时间线 <em id="timelineCount">0</em></button>
      <button class="archive-tab" data-tab="service">服务历史</button>
      <button class="archive-tab" data-tab="action-plan">行动计划</button>
    </nav>

    <!-- Tab 面板容器 -->
    <section class="module" id="tabContent">
      <!-- JS 根据当前 active tab 渲染 -->
    </section>
  </main>
</div>

<script src="static/v3a-auth.js"></script>
<script src="static/v3a-client-360.js"></script>
</body>
</html>
```

**四个 Tab 的内容由 `v3a-client-360.js` 动态渲染**，数据结构从 `GET /api/v3a-client-data-center?person_id=xxx&view=full` 获取。

**Tab 1 — 指纹档案**：先天配置摘要（TRC/ATD/性格类型/学习通道/左右脑）+ 十指数据表 + AI 理解摘要 + 报告特征摘要
**Tab 2 — 成长时间线**：领域过滤 pill-row + timeline-list（按时间倒序，每条含来源/方向/标签/内容）
**Tab 3 — 服务历史**：当前阶段信息 + 阶段变更记录表 + 辅导会话列表
**Tab 4 — 行动计划**：当前目标 + 下次回访建议（日期/主题/重点）+ "用AI辅导助手准备回访 →" 按钮

**URL 参数**：`?person_id=xxx`（从客户列表点击进入时携带）

---

### 4.4 AI 辅导助手（新建）：`ai-coaching-assistant.html`

**三栏布局**，复用 `.session-grid` 结构。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI辅导助手 - AIPIWEN</title>
  <link rel="stylesheet" href="static/ai-interpreter.css">
</head>
<body data-page="coaching">
<div class="app-shell">
  <aside class="sidebar">...</aside>

  <main class="main">
    <header class="topbar">
      <span class="topbar-title" id="pageTitle">AI辅导助手 · 加载中...</span>
      <div class="topbar-actions">
        <button class="btn ghost" id="btnHistory">历史辅导记录 →</button>
      </div>
    </header>

    <div class="session-grid"><!-- 复用三栏布局 -->
      
      <!-- 左栏：上下文面板 -->
      <aside class="session-sidebar" id="contextPanel">
        <div class="card">
          <div class="card-header"><span class="card-title">客户信息</span></div>
          <div class="data-list" id="clientInfo">
            <!-- JS 填充: 姓名/年龄/阶段/先天配置/上次回访 -->
          </div>
        </div>
        <div class="card" id="coreConcerns">
          <div class="card-header"><span class="card-title">核心关注</span></div>
          <div class="pill-row" id="concernPills"><!-- JS 填充 --></div>
        </div>
        <div class="card" id="recentActivity">
          <div class="card-header"><span class="card-title">最近动态（7天）</span></div>
          <div class="timeline-list" id="miniTimeline"><!-- JS 填充最近5条 --></div>
        </div>
        <div class="card" id="systemInsights">
          <div class="card-header"><span class="card-title">系统提示</span></div>
          <div id="insightContent"><!-- JS 填充 insight-bar --></div>
        </div>
      </aside>

      <!-- 中间栏：输入 + AI 建议 -->
      <section class="session-main" id="coachingMain">
        <div class="card">
          <div class="card-header"><span class="card-title">辅导设置</span></div>
          <div style="display:flex; gap:10px;">
            <div class="field">
              <label>辅导类型</label>
              <select class="select" id="coachingType">
                <option>电话回访</option><option>深度辅导</option><option>首次解读</option><option>紧急沟通</option><option>日常跟进</option>
              </select>
            </div>
            <div class="field">
              <label>会话类型</label>
              <select class="select" id="sessionType">
                <option>回访前准备</option><option>回访后复盘</option><option>自由辅导</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">本次辅导话题</span></div>
          <div class="coaching-input-area">
            <textarea class="textarea" id="topicInput" placeholder="用自然语言描述你要跟家长聊什么...例如：我要跟妈妈聊孩子最近抗拒夏令营的问题。上次她试了'一起看'的方法，第一天有效第二天又回到原点。"></textarea>
            <button class="btn primary" id="btnGenerate">生成辅导建议</button>
          </div>
        </div>

        <div class="coaching-output" id="coachingOutput" style="display:none;">
          <!-- AI 返回后显示：
            1. 当前状态理解 (.coaching-understanding)
            2. 建议沟通方向 (.coaching-direction)
          -->
        </div>
      </section>

      <!-- 右栏：话术 + 风险 + 记录 -->
      <aside class="session-sidebar" id="scriptPanel">
        <div class="coaching-output" id="scriptOutput" style="display:none;">
          <!-- 3. 参考话术 (.coaching-script) -->
          <!-- 4. 风险提示 (.coaching-risk) -->
        </div>
        <div class="card" id="postCoachingRecord">
          <div class="card-header"><span class="card-title">辅导后记录</span></div>
          <div class="field"><label>家长反应</label><textarea class="textarea" id="parentReaction" rows="2"></textarea></div>
          <div class="field"><label>本次效果</label><textarea class="textarea" id="sessionEffect" rows="2"></textarea></div>
          <div class="field"><label>下次计划</label><textarea class="textarea" id="nextPlan" rows="2"></textarea></div>
          <label style="font-size:12px; display:flex; align-items:center; gap:6px; margin-top:6px;">
            <input type="checkbox" id="alsoGrowthRecord" checked> 同时添加成长记录
          </label>
          <button class="btn primary" id="btnSaveRecord" style="margin-top:10px; width:100%;">保存辅导记录</button>
        </div>
      </aside>

    </div><!-- .session-grid -->
  </main>
</div>

<script src="static/v3a-auth.js"></script>
<script src="static/v3a-coaching.js"></script>
</body>
</html>
```

**API 调用流程**：
1. 页面加载 → `GET /api/v3a-client-data-center?person_id=xxx&view=coaching` → 填充左栏
2. 点击「生成辅导建议」→ `POST /api/v3a-coaching-suggestion` body: `{person_id, topic, coaching_type, session_type}` → 返回四段式 JSON → 渲染到中间栏+右栏
3. 点击「保存辅导记录」→ `POST /api/v3a-coaching-sessions` + 可选 `POST /api/v3a-growth-records`

**URL 参数**：`?person_id=xxx`（从客户 360 或辅导线索点击进入时携带）

---

### 4.5 成长记录（新建）：`growth-record.html`

**双栏布局**，复用 `.cols-aside` 结构。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>成长记录 - AIPIWEN</title>
  <link rel="stylesheet" href="static/ai-interpreter.css">
</head>
<body data-page="growth-record">
<div class="app-shell">
  <aside class="sidebar">...</aside>

  <main class="main">
    <header class="topbar">
      <span class="topbar-title">成长记录</span>
    </header>

    <div class="layout-grid cols-aside">
      
      <!-- 左栏：记录表单 -->
      <section class="card" id="recordForm">
        <div class="card-header"><span class="card-title">新增记录</span></div>
        
        <div class="growth-form-grid">
          <div class="field">
            <label>关联客户</label>
            <select class="select" id="selectPerson"></select>
          </div>
          <div class="field">
            <label>记录类型</label>
            <div class="pill-row" id="recordTypePills">
              <button class="pill active" data-type="advisor_obs">指导师观察</button>
              <button class="pill" data-type="parent_feedback">家长反馈</button>
              <button class="pill" data-type="child_self_report">孩子自述</button>
              <button class="pill" data-type="key_event">关键事件</button>
              <button class="pill" data-type="service_decision">服务决策</button>
            </div>
          </div>
          <div class="field full-width">
            <label>领域标签（可多选）</label>
            <div class="pill-row" id="domainPills">
              <button class="pill" data-domain="learning">学习</button>
              <button class="pill" data-domain="behavior">行为</button>
              <button class="pill" data-domain="emotion">情绪</button>
              <button class="pill" data-domain="social">社交</button>
              <button class="pill" data-domain="parent_child">亲子关系</button>
              <button class="pill" data-domain="family_system">家庭系统</button>
              <button class="pill" data-domain="physical">身体</button>
            </div>
          </div>
          <div class="field">
            <label>变化方向</label>
            <div class="pill-row" id="directionPills">
              <button class="pill" data-direction="improving">进步</button>
              <button class="pill active" data-direction="stable">持平</button>
              <button class="pill" data-direction="declining">退步</button>
              <button class="pill" data-direction="new_emergence">新出现</button>
              <button class="pill" data-direction="resolved">已解决</button>
            </div>
          </div>
          <div class="field">
            <label>关联皮纹指标（可选）</label>
            <div class="pill-row" id="markerPills">
              <button class="pill" data-marker="TRC">TRC</button>
              <button class="pill" data-marker="ATD">ATD</button>
              <button class="pill" data-marker="pattern">纹型</button>
              <button class="pill" data-marker="personality">性格类型</button>
              <button class="pill" data-marker="channel">学习通道</button>
              <button class="pill" data-marker="brain">左右脑</button>
            </div>
          </div>
          <div class="field">
            <label>可见范围</label>
            <div class="pill-row" id="visibilityPills">
              <button class="pill active" data-visibility="advisor_only">仅指导师可见</button>
              <button class="pill" data-visibility="shared">指导师和家长都可见</button>
            </div>
          </div>
          <div class="field full-width">
            <label>记录内容</label>
            <textarea class="textarea" id="recordContent" rows="6" maxlength="2000" placeholder="描述观察到的具体情况..."></textarea>
            <span style="font-size:11px;color:var(--faint);text-align:right;display:block;" id="charCount">0/2000</span>
          </div>
        </div>
        <button class="btn primary" id="btnSaveRecord" style="margin-top:12px;">保存记录</button>
      </section>

      <!-- 右栏：时间线 -->
      <section class="card" id="timelinePanel">
        <div class="card-header">
          <span class="card-title">时间线</span>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <select class="select" id="filterPerson" style="width:auto;"><option>全部客户</option></select>
            <select class="select" id="filterDomain" style="width:auto;"><option>全部领域</option></select>
            <select class="select" id="filterDirection" style="width:auto;"><option>全部方向</option></select>
            <select class="select" id="filterRecorder" style="width:auto;"><option>全部记录者</option></select>
          </div>
        </div>
        <div class="timeline-list" id="timelineList">
          <!-- JS 动态渲染 -->
        </div>
        <button class="btn ghost" id="btnLoadMore" style="width:100%; margin-top:10px;">加载更多...</button>
      </section>

    </div><!-- .cols-aside -->
  </main>
</div>

<script src="static/v3a-auth.js"></script>
<script src="static/v3a-growth-record.js"></script>
</body>
</html>
```

**API 调用**：
- 时间线加载：`GET /api/v3a-growth-records?person_id=xxx&domain_tags=...&change_direction=...&limit=20&offset=0`
- 保存记录：`POST /api/v3a-growth-records`

**URL 参数**：`?person_id=xxx`（从客户 360 点击进入时预设客户）

---

### 4.6 特殊案例库（升级）：`ai-interpreter-cases.html`

**操作**：
1. 侧边栏替换为第三部分的 9 项导航
2. 页面布局改为双区域：上半部分「我的案例」、下半部分「总部精选」
3. 新增「存入案例库」弹窗组件（供 `v3a-case-cards.js` 在其他页面调用时复用）
4. 总部角色额外显示「待审核」区域

**核心 HTML 结构**：

```html
<body data-page="cases">
<div class="app-shell">
  <aside class="sidebar">...</aside>
  <main class="main">
    <header class="topbar">
      <span class="topbar-title">✦ 特殊案例库</span>
      <div class="topbar-actions">
        <!-- 总部角色可见 -->
        <span class="status info" id="pendingBadge" style="display:none;">待审核: <strong id="pendingCount">0</strong></span>
      </div>
    </header>

    <!-- 总部：待审核区 -->
    <section class="module" id="pendingSection" style="display:none;">
      <div class="card-header"><span class="card-title">待审核</span></div>
      <div class="case-list" id="pendingCaseList"></div>
    </section>

    <!-- 我的案例 -->
    <section class="module" id="myCasesSection">
      <div class="card-header">
        <span class="card-title">我的案例</span>
        <button class="btn ghost" id="btnNewCase">+ 新建案例</button>
      </div>
      <div class="case-list" id="myCaseList"></div>
      <div class="notice" id="myCasesEmpty" style="display:none;">你还没有存入任何案例。在「我的客户」页面点击「存入案例库」即可开始。</div>
    </section>

    <!-- 总部精选 -->
    <section class="module" id="sharedSection">
      <div class="card-header"><span class="card-title">总部精选 · 团队共享案例</span></div>
      <div class="case-list" id="sharedCaseList"></div>
      <div class="notice" id="sharedEmpty" style="display:none;">暂无共享案例。</div>
    </section>
  </main>
</div>

<!-- 存入案例库弹窗（全局复用） -->
<div class="case-modal-overlay" id="caseModal" style="display:none;">
  <div class="case-modal">
    <h2>存入特殊案例库</h2>
    <div class="form-row"><label>客户</label><span id="caseModalPerson" style="color:var(--text);"></span></div>
    <div class="form-row">
      <label>案例类型（可多选）</label>
      <div class="pill-row" id="caseTypePills">
        <button class="pill" data-type="fingerprint_rare">皮纹特征罕见</button>
        <button class="pill" data-type="coaching_effective">辅导方法有效</button>
        <button class="pill" data-type="turning_point">干预转折明显</button>
        <button class="pill" data-type="stubborn_problem">顽固问题诊断</button>
        <button class="pill" data-type="parent_child_improvement">亲子关系改善</button>
        <button class="pill" data-type="long_term_tracking">长期跟踪</button>
        <button class="pill" data-type="other">其他</button>
      </div>
    </div>
    <div class="form-row"><label>案例标题</label><input class="field" id="caseTitle" placeholder="给这个案例起个名字"></div>
    <div class="form-row">
      <label>为什么这个案例值得留存</label>
      <textarea class="textarea" id="caseContent" rows="4" placeholder="说明特殊之处、学到了什么、其他指导师可以从中参考什么"></textarea>
    </div>
    <div class="form-row">
      <label>关联知识点（可选）</label>
      <div class="pill-row" id="knowledgePills">
        <button class="pill" data-kc="A1">ATD</button>
        <button class="pill" data-kc="A3">性格类型</button>
        <button class="pill" data-kc="A5">TRC</button>
        <button class="pill" data-kc="B1">认知发展</button>
        <button class="pill" data-kc="B2">情绪发展</button>
        <button class="pill" data-kc="B3">家庭系统</button>
        <button class="pill" data-kc="B4">亲子沟通</button>
        <button class="pill" data-kc="B5">学习动力</button>
      </div>
    </div>
    <div class="form-row">
      <label>可见范围</label>
      <div class="pill-row" id="caseVisibilityPills">
        <button class="pill active" data-visibility="private">仅我可见</button>
        <button class="pill" data-visibility="submitted">提交总部审核</button>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn ghost" onclick="closeCaseModal()">取消</button>
      <button class="btn ghost" id="btnSaveDraft">保存为草稿</button>
      <button class="btn primary" id="btnSubmitCase">提交</button>
    </div>
  </div>
</div>

<script src="static/v3a-auth.js"></script>
<script src="static/v3a-case-cards.js"></script>
</body>
</html>
```

**总部审核操作**（总部角色在待审核区每条案例上的按钮）：
- `[通过并精选]` → PUT visibility=shared
- `[退回]` → PUT visibility=returned, 附审核意见

---

## 五、新增 JS 文件

### 5.1 `static/v3a-workbench-clues.js`

功能：工作台首页辅导线索加载。

```javascript
// 职责：
// 1. 页面加载时调用 GET /api/v3a-client-data-center/clues
// 2. 返回结构: [{ person_id, person_name, stage, clue_type, description, suggested_action, action_url }]
// 3. 渲染到 #clueList 容器，每条为 .clue-card
// 4. 点击卡片跳转到 AI 辅导助手（带 person_id 参数）
// 5. 无线索时显示 "今日暂无需要关注的客户"
```

### 5.2 `static/v3a-customers-stage.js`

功能：客户列表服务阶段列和候选案例标签渲染。

```javascript
// 职责：
// 1. 加载客户列表时额外请求 GET /api/v3a-client-data-center/stage-summary?person_ids=1,2,3
// 2. 为每行客户渲染 .stage-tag（initial/early/deep/consolidation）
// 3. 为自动检测的候选案例渲染 .case-candidate-tag（"✦ 候选案例"）
// 4. 支持按服务阶段筛选（下拉选择器联动）
```

### 5.3 `static/v3a-client-360.js`

功能：客户 360 档案数据加载 + Tab 切换。

```javascript
// 职责：
// 1. 从 URL 参数读取 person_id
// 2. 页面加载时调用 GET /api/v3a-client-data-center?person_id=xxx&view=full
// 3. 填充客户摘要区 + 4 个 Tab 面板内容
// 4. Tab 切换逻辑（.archive-tab 点击 → 切换 active + 渲染对应面板）
// 5. 「发起辅导」按钮 → 跳转 ai-coaching-assistant.html?person_id=xxx
// 6. 「添加记录」按钮 → 跳转 growth-record.html?person_id=xxx
```

### 5.4 `static/v3a-coaching.js`

功能：AI 辅导助手完整交互。

```javascript
// 职责：
// 1. 从 URL 参数读取 person_id
// 2. 页面加载 → GET /api/v3a-client-data-center?person_id=xxx&view=coaching → 填充左栏
// 3. 「生成辅导建议」按钮 → POST /api/v3a-coaching-suggestion
//    body: { person_id, topic, coaching_type, session_type }
//    response: { understanding, direction, script, risks[] }
// 4. 四段式输出渲染：
//    - understanding → 中间栏 .coaching-understanding
//    - direction → 中间栏 .coaching-direction
//    - script → 右栏 .coaching-script（含复制按钮）
//    - risks → 右栏 .coaching-risk
// 5. 「复制话术」按钮 → navigator.clipboard.writeText()
// 6. 「保存辅导记录」→ POST /api/v3a-coaching-sessions
//    + 如果勾选，同时 POST /api/v3a-growth-records
// 7. 「历史辅导记录」→ 跳转或展开历史列表
```

### 5.5 `static/v3a-growth-record.js`

功能：成长记录表单 + 时间线。

```javascript
// 职责：
// 1. 从 URL 参数读取 person_id（可选），预设客户下拉
// 2. 加载客户下拉列表 → GET /api/v3a-client-data-center/person-list
// 3. 时间线加载 → GET /api/v3a-growth-records?limit=20&offset=0（+ 过滤参数）
// 4. pill 多选交互（record_type/domain_tags/direction/markers/visibility）
// 5. 「保存记录」→ POST /api/v3a-growth-records → 刷新时间线
// 6. 字数统计实时更新
// 7. 「加载更多」分页
// 8. 时间线过滤联动刷新
```

### 5.6 `static/v3a-case-cards.js`

功能：特殊案例库完整交互。

```javascript
// 职责：
// 1. 案例列表加载 → GET /api/v3a-case-cards?visibility=private/shared
// 2. 总部角色额外加载待审核列表
// 3. 「存入案例库」弹窗（openCaseModal / closeCaseModal 全局函数，供其他页面调用）
// 4. 弹窗表单交互：案例类型多选、关联知识点多选、可见范围切换
// 5. 「保存为草稿」→ POST /api/v3a-case-cards (visibility=private)
// 6. 「提交」→ POST /api/v3a-case-cards (visibility=submitted)
// 7. 总部审核操作 → POST /api/v3a-case-cards/:id/review
// 8. 案例删除（仅草稿状态可删）
// 9. 案例详情展开/跳转
```

**全局函数签名**（供 customers 页面调用）：
```javascript
window.openCaseModal = function(personId, personName) { /* ... */ };
window.closeCaseModal = function() { /* ... */ };
```

---

## 六、后端 API（需要新实现）

### 6.1 新增 API 端点清单

| 方法 | 路径 | 用途 | Phase |
|------|------|------|-------|
| GET | `/api/v3a-client-data-center/clues` | 今日辅导线索 | P1 |
| GET | `/api/v3a-client-data-center/stage-summary?person_ids=` | 批量服务阶段 | P1 |
| GET | `/api/v3a-client-data-center/person-list` | 客户下拉列表 | P1 |
| GET | `/api/v3a-client-data-center?person_id=&view=full` | 客户完整视图 | P1 |
| GET | `/api/v3a-client-data-center?person_id=&view=coaching` | AI 辅导视图 | P1 |
| POST | `/api/v3a-coaching-suggestion` | 生成辅导建议 | P1 |
| POST | `/api/v3a-coaching-sessions` | 保存辅导记录 | P1 |
| POST | `/api/v3a-growth-records` | 写入成长记录 | P1 |
| GET | `/api/v3a-growth-records` | 查询成长记录 | P1 |
| GET | `/api/v3a-case-cards` | 案例列表 | P1 |
| POST | `/api/v3a-case-cards` | 创建案例 | P1 |
| PUT | `/api/v3a-case-cards/:id` | 编辑案例 | P1 |
| DELETE | `/api/v3a-case-cards/:id` | 删除案例（草稿） | P1 |
| POST | `/api/v3a-case-cards/:id/submit` | 提交审核 | P1 |
| POST | `/api/v3a-case-cards/:id/review` | 总部审核 | P2 |
| GET | `/api/v3a-case-candidates` | 候选案例检测 | P2 |

### 6.2 `POST /api/v3a-coaching-suggestion` 关键规格

**Request**:
```json
{
  "person_id": "uuid",
  "topic": "我要跟妈妈聊孩子最近抗拒夏令营的问题...",
  "coaching_type": "电话回访",
  "session_type": "回访前准备"
}
```

**Response**（四段式）:
```json
{
  "understanding": "陈沐言7天内4条declining记录...（AI 分析文本）",
  "direction": "这次沟通的核心目标不是给新方法——是帮妈妈理解...",
  "script": "陈妈妈，上次您试了'一起看'——第一天他很配合...",
  "risks": [
    {"level": "warning", "text": "不要直接说'上次您没按建议做'"},
    {"level": "tip", "text": "先肯定她主动试了方法再推进新内容"}
  ],
  "knowledge_refs": ["A1:v1.2", "A3:v1.0", "B4:v0.5"],
  "generated_at": "2026-08-08T10:30:00Z"
}
```

### 6.3 `POST /api/v3a-growth-records` 规格

**Request**:
```json
{
  "person_id": "uuid",
  "record_type": "advisor_obs",
  "domain_tags": ["learning", "emotion"],
  "change_direction": "declining",
  "related_fingerprint_markers": ["ATD", "personality"],
  "visibility": "shared",
  "content": "作业拖到9:30才开始，一催就哭...",
  "source": "advisor_workbench"
}
```

---

## 七、数据库 Migration

在现有基础上执行（所有新增字段带默认值，不影响已有数据）：

```sql
-- Migration V4.0.001: case_card 扩展
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS case_type TEXT[] DEFAULT '{}';
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN DEFAULT false;
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS detection_rule TEXT;
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS hq_review_comment TEXT;
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS hq_reviewed_by UUID;
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS hq_reviewed_at TIMESTAMPTZ;
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS related_knowledge_cards TEXT[] DEFAULT '{}';
ALTER TABLE case_card ADD COLUMN IF NOT EXISTS key_turning_points JSONB DEFAULT '[]';
```

---

## 八、验收标准（Phase 1）

执行完成后，逐项检查：

1. [ ] `ai-interpreter.css` 末尾已追加所有 V4 样式，原有样式未被修改
2. [ ] 所有 9 个 HTML 文件的侧边栏均为 9 项导航，各自 `data-page` 正确对应
3. [ ] 工作台首页出现「今日辅导线索」模块（即使暂无数据也有空状态提示）
4. [ ] 客户列表增加「服务阶段」和「标签」两列，每行有「存入案例库」按钮
5. [ ] `client-360.html` 可通过 `?person_id=xxx` 访问，4 个 Tab 正常切换
6. [ ] `ai-coaching-assistant.html` 三栏布局正确，左栏加载客户上下文，输入区可输入并点击生成
7. [ ] `growth-record.html` 双栏布局正确，左栏表单 pill 多选交互正常，右栏时间线可加载
8. [ ] `ai-interpreter-cases.html` 可看到「我的案例」「总部精选」双区域，弹窗表单完整
9. [ ] 存入案例库弹窗在客户列表页可正常弹出
10. [ ] 所有新增 API 端点返回正确的 JSON 结构（先用 mock/stub 验证前端）
11. [ ] 所有现有页面（解读助手/解读训练/总部复核）功能不受影响
12. [ ] 移动端（< 980px）布局不崩溃——新页面使用现有响应式断点

---

## 九、禁止事项

1. 不要修改 `ai-interpreter-session.html` / `ai-interpreter-training.html` / `ai-interpreter-review.html` 的功能逻辑
2. 不要删除 `ai-interpreter.css` 中的任何已有代码
3. 不要修改 `v3a-auth.js` 的认证逻辑
4. 不要在新页面中引入新的 CSS 框架或第三方样式库
5. 不要修改已有的 API 端点签名
6. 不要改动数据库已有表结构（仅追加新字段和新表）
