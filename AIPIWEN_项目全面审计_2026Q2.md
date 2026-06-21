# AIPIWEN 项目全面审计文档
> 版本：2026-06-20 | 供第三方 AI 同步审核使用

---

## 一、产品定位

**AIPIWEN（AI 皮纹天赋）** 是一个基于皮纹学（指纹科学）的亲子关系理解平台。

**核心主张：**
> 孩子每一个"问题行为"，都是在用他唯一会的方式，传递一个还没被接收到的信号。天赋类型写在指纹里，不是性格缺陷，不会随年龄消失。

**产品逻辑：**
1. 用户通过"指纹速测"输入孩子10个手指的纹型（斗/箕/弓/反箕）
2. 系统算法判定孩子的 TRC 天赋认知类型（17种之一）
3. 给出类型解读卡片 + 科学背书 + 分享海报
4. 引导进入 AI 对话，用五步路径（了解→理解→谅解→和解→和谐）深化亲子理解
5. 企业微信客服承接转化（付费咨询）

**科学依据（三本权威来源）：**
- 《世界指纹史》[德] 罗伯特·海因德尔（Robert Heindl）
- 《指纹的奥秘》刘持平（群众出版社，2000年，411页）
- 《指纹无谎言》刘持平（江苏人民出版社，2003年，301页）

关键数据点：
- 皮纹遗传度 >95%（双胞胎研究）
- 指纹形成于胎儿第 13–19 周，与神经系统同期发育，终生不变
- 中华指纹起源：马家窑文化（约公元前3300年，距今5000年）
- 贾公彦（唐代）是世界第一个论述指纹学的学者，比欧洲大学早500年以上

**目标用户：** 中国8–15岁孩子的父母，主要焦虑点是亲子沟通、学习方式、职业方向。

---

## 二、技术架构

### 部署

| 项目 | 值 |
|------|----|
| 平台 | Vercel（Hobby 计划，12函数上限） |
| 域名 | aipiwen.cn |
| 仓库 | github.com/gyl-0322/aipiwen-ai-understanding |
| 分支 | main（自动部署） |
| AI 模型 | 阿里云 DashScope qwen-turbo（guest-chat）/ 综合分析使用更长上下文 |
| 存储 | Vercel KV（Redis）|
| 微信 | 企业微信客服 API（自动回复）|

### 技术栈

- **前端：** 纯 HTML + CSS + 原生 JS（无框架，所有页面自包含）
- **后端：** Vercel Serverless Functions（Node.js）
- **数据库：** Vercel KV（Redis）— 存储用户画像、对话日志、行为模式
- **AI：** 阿里云 DashScope API（兼容 OpenAI 格式）
- **知识库：** UMD 格式 JS 模块（前后端通用）

---

## 三、文件结构详解

```
aipiwen-ai-understanding/
│
├── ── 前端页面 ──
│   ├── homepage.html          # 首页（四大入口 + 社会证明）
│   ├── fingerprint-v2-wizard.html  # 指纹速测向导（核心获客页）★
│   ├── full-report.html       # 完整 AI 分析报告页
│   ├── light-report.html      # 轻量版报告（快速预览）
│   ├── child-chat.html        # AI 对话页（主要产品体验）
│   ├── synthesis.html         # 跨场景综合分析页
│   ├── behavior-input.html    # 行为录入页
│   ├── personality.html       # 类型详情展示页
│   ├── admin.html             # 后台管理（数据统计）
│   ├── admin-convs.html       # 对话日志查看页
│   └── privacy.html           # 隐私政策
│
├── ── 核心 JS 库 ──
│   ├── js/aipiwen-core.js     # 前端核心引擎（~3700行）★
│   ├── js/growth-tracker.js   # 用户行为追踪
│   ├── js/growth-intelligence.js  # 增长智能分析
│   └── js/track.js            # 埋点客户端
│
├── ── 统一知识库 ──
│   └── lib/trc-knowledge-base.js  # UMD 格式，前后端通用 ★
│
├── ── Serverless API ──
│   ├── api/_lib.js            # 工具库（Redis 封装 + 认证）[下划线=不部署为函数]
│   ├── api/_personality-types.js  # TRC 17类型知识库（服务端用）[下划线=不部署为函数]
│   ├── api/auth.js            # 微信登录 + 用户账号
│   ├── api/children.js        # 孩子档案 + 行为记录 CRUD
│   ├── api/guest-chat.js      # 访客 AI 对话（无需登录）★
│   ├── api/synthesize.js      # 跨场景综合分析
│   ├── api/wechat.js          # 企业微信客服自动回复
│   ├── api/knowledge.js       # 专家知识库 RAG 接口
│   ├── api/digest.js          # 定时摘要任务（Cron）
│   ├── api/stats.js           # 埋点统计接口
│   ├── api/track.js           # 增长数据追踪
│   ├── api/growth.js          # 增长数据 API
│   ├── api/admin-convs.js     # 对话日志管理
│   └── api/myip.js            # 出口 IP 查询（企业微信白名单用）
│
└── ── 素材 ──
    ├── patterns/              # 17种指纹纹型参考图片（Wt.jpg, Lu.jpg 等）
    └── images/                # 微信二维码等
```

---

## 四、TRC 天赋认知类型系统（核心业务逻辑）

### 分类基础
基于10个手指的纹型组合：
- **W（斗形纹/Whorl）**：有两个三叉点，嵴线形成闭合回路
- **L（箕形纹/Loop）**：开口向尺侧，有一个三叉点
- **X（弓形纹/Arch）**：无三叉点，弧形横过
- **RL（反箕纹/Radial Loop）**：开口向桡侧
- 特殊形态：孔雀眼（双箕斗）、双斗等

### 速测页的14个类型Key（fingerprint-v2-wizard.html）

| 速测key | 对应类型名 | 特征纹型 | 核心天赋 |
|---------|-----------|----------|----------|
| rl | 逆思型 | 含反箕纹 | 逆向思维，挑战常规 |
| super_w_a | 超级认知型A | 十指全斗+双拇指螺旋斗 | 天生领袖，自我驱动极强 |
| super_w_b | 超级认知型B | 十指全斗+双拇指双斗 | 领袖力+整合力叠加 |
| super_w_c | 超级认知型C | 十指全斗+双拇指孔雀眼 | 领袖力+完美追求叠加 |
| super_l | 超级模仿型 | 十指全箕 | 共情能力极强，大公无私 |
| wc | 整合型 | 双拇指双斗 | 双核思维，多维整合 |
| perfect_w | 完美型 | 双拇指孔雀眼 | 极致标准，审美敏感 |
| combo_w | 多维认知型 | 双拇指不同斗形纹子类型 | 双重天赋叠加 |
| combo_w_l | 认知+模仿双驱 | 一斗一箕拇指 | 主见+共情并存 |
| combo_open | 主导+开放型 | 主导拇指+弧形食指 | 方向感+执行力 |
| w / w_mild | 认知型 | 斗形纹居多 | 独立构建认知体系，主见强 |
| l / l_mild | 模仿型 | 正箕纹居多 | 善于模仿，适应力强 |
| x | 开放型 | 弧形纹为主 | 踏实肯干，海绵学习 |
| （其他） | 均衡型 | 斗箕混合无明显主导 | 多维适应，情境灵活 |

> **架构缺口：** 速测页的14个key 与知识库（lib/trc-knowledge-base.js / api/_personality-types.js）中的TRC 17种中文类型名 **没有统一映射表**，两套体系相互独立，同一类型在不同页面的描述可能不一致。

### 知识库结构（三层）

```
Layer 1（服务端，AI提示词用）：
  api/_personality-types.js
  → 导出 buildTypeReferenceForPrompt() → 注入 guest-chat.js / synthesize.js 系统提示词

Layer 2（前端，卡片展示用）：
  js/aipiwen-core.js → TRCTypeLibrary（~300行）
  → 导出 renderCard() → full-report.html 展示类型卡片

Layer 3（统一底层，前后端通用）：
  lib/trc-knowledge-base.js（UMD格式，~37KB）
  → 前端：window.TRCKnowledgeBase
  → 后端：require('../lib/trc-knowledge-base')
  → 目标：最终替代 Layer 1 和 Layer 2（尚未完成整合）
```

---

## 五、核心页面详解

### 1. fingerprint-v2-wizard.html（指纹速测向导）★★★
**定位：** 主要获客漏斗入口，核心流量页面

**流程（7步向导）：**
- S1：记录全部10指中斗形纹（W）的数量
- S2：记录反箕纹（RL）数量
- S3：记录弓形纹（X）数量
- S4：记录帐篷弧（Xn，弓形纹的一种变体，中间有竖直向上的嵴线）数量
- S5：记录箕形纹（L/U）数量
- S6：识别右手拇指纹型（重要分叉点：螺旋斗/双斗/孔雀眼）
- S7：识别左手拇指纹型
- 结果页：类型卡片 + 分享海报 + 企业微信引导

**关键代码：**
- `classify()`：算法核心，根据计数组合判定类型key
- `generateReport(key)`：根据类型key生成HTML报告卡片（14个key分支）
- `generatePoster()`：生成分享海报（SVG指纹图 + 类型信息 + QR码）
- QR码指向：`aipiwen.cn/fingerprint-v2-wizard.html?from=poster&ref={type_key}`

**已实现：**
- 每种类型的报告卡片：核心天赋 / 性格优势 / 学习风格 / 发展方向 / 给家长的建议 / 🔬指纹溯源
- 分享海报：类型专属文案 + 指纹图形 + 科学引用条 + QR码
- 全局埋点（GT.track）

**已知问题 / 待改进：**
- 速测的14个类型key 与知识库的17种命名不完全对应（映射关系未标准化）
- 海报刚重新设计（2026-06-20），尚未在用户中验证
- classify() 函数较长（350+行），建议拆分

---

### 2. js/aipiwen-core.js（前端核心引擎）★★★
**规模：** ~3700行，是前端最大的单文件

**包含的模块：**

| 模块 | 功能 |
|------|------|
| UserSystem | 本地用户状态管理 |
| MemorySystem | 行为记忆存储 |
| AnalysisEngine | 行为分析引擎 |
| BehaviorReasoningEngine | 深度推理（6层链路）|
| TrendAnalyzer | 行为趋势分析 |
| ContentLibrary | 内容库（应对策略等）|
| LeadSystem | 线索转化系统 |
| ConsultingSessionStore | 咨询会话存储 |
| AIPIWENConsultingAgent | 主 AI Agent 调度 |
| TRCTypeLibrary | 17种类型卡片数据 + renderCard() |
| ProductLayer | 产品层（转化触发）|
| FamilyProgressDashboard | 家庭成长看板 |

**TRCTypeLibrary 位置：** 第3347行附近

**问题：**
- 文件过大（3700行），难以维护
- TRCTypeLibrary 与 lib/trc-knowledge-base.js 数据重复，尚未统一
- 部分模块（BehaviorHabitLoop、WeeklyFamilyReport等）可能未被实际调用

---

### 3. api/guest-chat.js（访客AI对话接口）★★★
**接口：** `POST /api/guest-chat`
**无需登录**，任何人可调用

**四大场景：**
- `child`（亲子）：帮父母理解孩子行为信号
- `self`（自我）：帮个人理解自己的行为模式
- `partner`（伴侣）：帮理解亲密关系中对方的行为
- `business`（合伙）：帮理解商业合作关系

**提示词架构：**
- 五步路径：了解→理解→谅解→和解→和谐相处（贯穿全部场景）
- TRC_SECTION：注入17种类型参考框架
- 行为解读链路：行为表象→情绪→需求→原生家庭→真实意图
- 历史记忆注入（previousContext）
- 全局高频模式注入（仅亲子场景）
- 严格禁止开场白（收到/好的/当然等）
- 限流：每IP每分钟10次

**AI 调用：**
```javascript
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
model: qwen-turbo, max_tokens: 400
```

---

### 4. api/synthesize.js（跨场景综合分析）
**接口：** `POST /api/synthesize`
读取用户在多个场景下的行为记忆，生成系统级综合洞察（家庭动力、关系模式等）
限流：每IP每分钟3次（成本高于 guest-chat）

---

### 5. full-report.html（完整分析报告页）
**数据来源：URL参数 + localStorage**
- `?id=` 参数：reportId，用于从 localStorage 的 leads 记录中找到对应的 behaviorType
- behavior 内容从 localStorage 读取（BEH_KEY）
- 类型卡片渲染由 aipiwen-core.js TRCTypeLibrary.renderCard() 提供
- **不调用实时 AI**：报告内容基于本地缓存数据，不是每次重新生成

---

### 5. api/wechat.js（企业微信客服自动回复）
流程：
1. 客户发消息 → 企业微信推事件至 webhook
2. 调用 kf/sync_msg 取出消息内容
3. 解析用户发来的报告链接（含 ?r= 参数）
4. 构造完整回复 → kf/send_msg 发送

---

### 6. api/digest.js（定时任务）
**三个 Cron：**
- 每天 2:00 UTC：`portrait_all` — 更新全用户行为画像
- 每周日 3:00 UTC：`patterns` — 提取跨用户模式
- 每周日 4:00 UTC：`weekly` — 生成周报

---

## 六、数据流架构

```
用户 → fingerprint-v2-wizard.html
         ↓ (classify结果)
     生成类型报告卡片 (generateReport)
         ↓
     生成分享海报 (generatePoster)
         ↓ (扫QR)
     新用户 → fingerprint-v2-wizard.html?from=poster
         ↓
     child-chat.html / full-report.html
         ↓ POST /api/guest-chat
     AI 回复（qwen-turbo）
         ↓
     Redis 存储对话日志（convlog:msgs:{sessionId}）
         ↓ Cron 每日
     /api/digest → 生成用户画像 → Redis
         ↓ POST /api/synthesize
     跨场景综合分析
         ↓
     企业微信客服引导（扫码 → 人工跟进）
```

---

## 七、数据存储（Redis key 规范）

| Key 前缀 | 内容 | TTL |
|----------|------|-----|
| `convlog:msgs:{sessionId}` | 对话消息列表 | 60天 |
| `convlog:index` | 会话索引（最新500条）| 永久 |
| `ratelimit:{ip}:{minute}` | IP限流计数 | 2分钟 |
| `ratelimit:synth:{ip}:{minute}` | 综合分析限流 | 2分钟 |
| `portrait:{userId}` | 用户行为画像 | 永久 |
| `patterns:global` | 全局高频模式 | 7天 |

---

## 八、环境变量（Vercel 后台配置）

| 变量名 | 用途 |
|--------|------|
| `DASHSCOPE_API_KEY` | 阿里云 AI 调用密钥 |
| `KV_REST_API_URL` | Vercel KV（Redis）地址 |
| `KV_REST_API_TOKEN` | Vercel KV Token |
| `SESSION_SECRET` | 会话签名密钥 |
| `WECHAT_CORP_ID` | 企业微信企业ID |
| `WECHAT_AGENT_SECRET` | 微信客服机器人 Secret |
| `WECHAT_TOKEN` | 微信消息验证 Token |
| `WECHAT_OPEN_KFID` | 微信客服账号ID |
| `CRON_SECRET` | 定时任务鉴权 |
| `ADMIN_SECRET` | 后台管理鉴权 |

---

## 九、Obsidian 知识库（本地，不部署）

位置：`/AI-CEO-System/知识库/`

```
知识库/
├── 00-知识库导航.md           # 全库入口索引
├── TRC类型/
│   ├── 00-类型总览.md
│   ├── 01-认知型.md
│   ├── 02-逆思型.md
│   └── ... 共17个类型文件
└── 指纹学/
    ├── 01-指纹科学三大基石.md
    ├── 02-指纹历史-中国是发源地.md
    ├── 03-两大基本形态-斗与箕.md
    ├── 05-指纹学与TRC天赋认知-科学连接.md
    ├── 06-指纹无谎言-核心知识.md   # 《指纹无谎言》刘持平 全书整理
    └── 07-指纹的奥秘-核心知识.md   # 《指纹的奥秘》刘持平 全书整理
```

**架构关系：**
```
Obsidian（知识原点）
    ↓ 手动同步
lib/trc-knowledge-base.js（代码化底层，UMD）
    ↓                         ↓
api/_personality-types.js    js/aipiwen-core.js → TRCTypeLibrary
（服务端AI提示词）            （前端卡片渲染）
```

---

## 十、已知问题 / 技术债务

### 严重（影响功能）

1. **两套分类体系不统一**
   - `fingerprint-v2-wizard.html` 使用14个key（rl / super_w_a / w / l / x 等）
   - `lib/trc-knowledge-base.js` / `api/_personality-types.js` 使用中文名称（认知型/模仿型等）
   - 两者无统一映射表，相互不引用
   - **风险：** 同一类型在不同页面的描述可能不一致

2. **Vercel Hobby 函数上限**
   - 已达 12 个函数上限（含 growth.js / track.js）
   - 新增任何 api/*.js 都会导致部署失败
   - 解决方案：合并功能相近的 API，或升级 Pro 计划

### 中等（影响维护）

4. **aipiwen-core.js 过大**（~3700行单文件）
   - TRCTypeLibrary 与 lib/trc-knowledge-base.js 数据重复
   - 未被使用的模块占比未知，需 tree-shaking

5. **海报生成不支持真正截图下载**
   - 当前方案：用户截图保存（微信浏览器 html2canvas 不稳定被弃用）
   - 无服务端生成图片能力

6. **指纹速测 classify() 函数未有单元测试**
   - 350+行条件判断，边界情况未覆盖测试
   - 历史上出现过多次分类逻辑 bug

### 轻微

7. **pattern 图片文件名与类型key不对应**（Ws.jpg / Wt.jpg 等命名无文档说明）
8. **child-chat.html.bak 文件残留**（应从仓库删除）
9. **全局埋点 GT.track 依赖 growth-tracker.js 异步加载**（首屏事件可能丢失）

---

## 十一、最近更新记录（最近6个commit）

| Commit | 内容 | 影响范围 |
|--------|------|----------|
| 34cbc63 | 修复 synthesize.js 引用路径 | api/synthesize.js |
| 07e38b4 | 海报重设计——去广告感数字块/加科学引用/QR改为速测页 | fingerprint-v2-wizard.html |
| 856be71 | 修复 Vercel 12函数上限部署报错 | api/ 目录结构 |
| 47bcac6 | 速测17种类型全面加入🔬指纹溯源板块 | fingerprint-v2-wizard.html |
| 6240a11 | 深化5个类型指纹溯源（马家窑5000年·贾公彦·ATD角）| lib/ + aipiwen-core.js |
| 324c244 | 融入《指纹无谎言》《指纹的奥秘》科学内容 | guest-chat.js + 知识库 |

---

## 十二、待解决的核心问题（供审核重点关注）

1. **两套分类体系统一**：如何建立 fingerprint-v2-wizard.html 的14个key 与 TRC 17种中文名称之间的标准映射？

2. **aipiwen-core.js 拆分**：TRCTypeLibrary（前端卡片）应该从 core.js 中抽出，改为引用 lib/trc-knowledge-base.js，如何做到不破坏现有功能？

3. **Vercel 函数上限**：当前 12/12，是合并 API（如将 growth.js + track.js 合并）还是升级计划？

4. **海报生成方案**：当前截图方案体验差（用户手动截图、安卓设备比例不一）。服务端生成图片（Puppeteer / 第三方 API）方案的可行性如何？

5. **AI 模型选择**：guest-chat 当前用 qwen-turbo（快速、便宜），但对复杂行为分析质量有限。是否在部分场景引入更强模型（qwen-plus / GPT-4o）？

---

## 十三、Vercel 配置注意事项

```json
// vercel.json 关键约束
"functions": {
  "api/digest.js": { "maxDuration": 60 }  // ← Hobby 最大支持10s，此配置可能引发警告
}
```

**已知风险：** `maxDuration: 60` 超出 Hobby 计划限制（最大10s）。目前未导致部署失败，但行为不确定（可能被截断为10s）。建议修改为10或升级 Pro。

---

*文档生成时间：2026-06-20 | 项目仓库：github.com/gyl-0322/aipiwen-ai-understanding*
