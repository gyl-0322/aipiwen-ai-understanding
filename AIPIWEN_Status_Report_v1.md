# AIPIWEN · AI皮纹天赋速测 — 项目状态报告 V1

> 发送对象：Codex / ChatGPT 审阅
> 报告日期：2026-06-14
> 报告范围：`fingerprint-v2-wizard.html` — 主核心文件（海报分析重点）
> 整体仓库：`aipiwen-ai-understanding`（GitHub · branch: main）
> 线上地址：aipiwen.cn（Vercel 部署）

---

## 一、项目定位

**AI皮纹天赋速测**是一款面向中国家长的移动端 H5 工具，通过引导用户录入10根手指的指纹纹型（斗/箕/弧），由前端 AI 分类引擎输出孩子的"天赋类型"，并生成可转发朋友圈的分享海报，以海报病毒传播驱动企业微信私域转化。

**核心漏斗：**
```
用户完成测评 → 查看结果报告 → 生成分享海报 → 朋友圈传播 → 扫码加企微客服 → 付费咨询
```

**绝对保护规则（需所有审阅方知悉）：**
- `www.aipiwen.cn` 上已部署的旧版「AI皮纹天赋速测」**绝对不能动**
- 旧版 Vercel 项目 `tianfu-assessment-26jc` / GitHub 仓库 `tianfu-assessment` **绝对不能碰**
- 禁止：部署、覆盖旧版、rm -rf、改服务器配置、改域名绑定

---

## 二、技术架构

### 2.1 整体结构

| 文件 | 行数 | 职责 |
|------|------|------|
| `fingerprint-v2-wizard.html` | 2109 | **主文件**：向导 + 分类 + 结果报告 + 海报生成（单文件 SPA） |
| `index.html` | 5163 | 行为测评入口（老产品线，含分享卡、admin 统计、企微引导） |
| `full-report.html` | 1080 | 完整版报告页 |
| `light-report.html` | 390 | 轻量报告页 |
| `behavior-input.html` | 249 | 行为输入页 |
| `consulting.html` | 526 | AI 咨询系统 |
| `homepage.html` | 336 | 品牌首页 |
| `admin.html` | 445 | 本地运营后台 |
| `api/wechat.js` | — | Vercel 函数：企微客服自动回复 |
| `api/myip.js` | — | Vercel 函数：出口 IP 探测 |
| `js/aipiwen-core.js` | — | 用户记忆系统 + 行为推理引擎 + 内容库 |

### 2.2 核心依赖（fingerprint-v2-wizard.html）

```html
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
```

- **QRCodeJS**：生成 aipiwen.cn 的二维码嵌入海报
- **html2canvas**：将 DOM 海报模板截图为 PNG，供用户长按保存

### 2.3 设计令牌（Design Tokens）

```css
--cream:      #FDFCF8   /* 主背景：暖奶油白 */
--ink:        #1A1714   /* 主文字：近黑 */
--amber:      #C2692A   /* 主题色：琥珀橙 */
--amber-dark: #A0541F
--amber-soft: #F5EDE4
--ok:         #3A7D5E   /* 确认绿 */
```

**色彩原则**：全站统一琥珀色系，不使用紫色或其他外来色。超级认知系列使用 `#D4891A`（深琥珀）以区分普通类型。

### 2.4 部署配置

```json
// vercel.json 路由规则（已配置）
"/"                           → homepage.html
"/fingerprint-v2-wizard.html" → fingerprint-v2-wizard.html
"/admin.html"                 → admin.html
"/api/..."                    → Vercel Functions
"/(.*)"                       → index.html（catch-all）
```

---

## 三、向导流程（7步）

```
S1：孩子惯用手选择（左手/右手/双手）
S2：右手拇指指纹类型（初始化快速通道）
S3：非拇指手指 — 弧形纹录入（简单弧/帐篷弧）
S4：非拇指手指 — 正箕纹录入
S5：反箕纹（RL）录入
S6：大拇指详细分型（X/Xn/Lu + 斗形子类：螺旋/双斗/孔雀眼/等）
S7：其余斗形纹手指（非拇指，可选）
→ showResult()
```

**快速通道（十指全斗）**：S2 检测到所有8根非拇指均为斗形纹时，跳过 S3-S5-S7，直接进入 S6 录入双拇指子类型后输出结果。

**状态管理**（纯 JS，无框架）：

```javascript
state.data = {
  rlFingers:      Set,  // 反箕纹手指索引
  xFingers:       Set,  // 简单弧手指
  xnFingers:      Set,  // 帐篷弧手指
  luFingers:      Set,  // 正箕纹手指
  wOtherFingers:  Set,  // 非拇指斗形纹手指
  rtThumb:        str,  // 右拇指类型
  ltThumb:        str,  // 左拇指类型
}
state.allTenWhorls = bool  // 十斗快速通道标志
```

---

## 四、分类系统（classify() — 5条规则）

### 规则优先级（从高到低）

**Rule 1：有反箕纹（RL）→ 逆思型**
```javascript
if (d.rlFingers.size > 0)
  return { key: 'rl', mainType: '逆思型 R' }
```

**Rule 2：十指全斗（totalW ≥ 10）→ 超级认知 A/B/C**
- 任意拇指有双斗（Wd/Wc）→ **超级认知B · 双核整合**
- 任意拇指有孔雀眼（We/Wpe）→ **超级认知C · 完美特质**
- 其余（螺旋斗为主）→ **超级认知A · 螺旋领袖**
- 混合双斗+孔雀眼：以左拇指类型决定 B 或 C

**Rule 3：弧形纹检查**
- `totalArc ≥ 6` → **开放型**（直接输出，不看拇指）
- 食指（fi=1 或 fi=6）有弧 → `[拇指标签]兼开放型`（combo_open）

**Rule 4：十指全正箕（totalLu ≥ 10）→ 超级模仿型**

**Rule 5：通用规则 — 只看大拇指**
- 拇指标签映射：`IS_W(t) → 认知/整合/完美`，`Lu → 模仿`，`X/Xn → 开放`
- 双拇指同标签 → 直接输出该类型
- 双拇指不同标签 → `{高优先}兼{低优先}型`，按 `认知>整合>完美>模仿>开放` 排序

### 完整类型键值表

| key | 内部类型名（向导显示） | 海报人话名 |
|-----|----------------------|-----------|
| `rl` | 逆思型 R | 反直觉思考型孩子 |
| `super_w_a` | 超级认知A · 螺旋领袖 | 天生领袖型孩子 |
| `super_w_b` | 超级认知B · 双核整合 | 多维整合领袖型孩子 |
| `super_w_c` | 超级认知C · 完美特质 | 完美标准领袖型孩子 |
| `w` | 认知型 | 独立主见型孩子 |
| `wc` | 整合型 | 全局整合型孩子 |
| `perfect_w` | 完美型 | 高标准完美型孩子 |
| `super_l` | 超级模仿型 | 无限接纳型孩子 |
| `l` | 模仿型 | 超强学习复制型孩子 |
| `x` | 开放型 | 踏实执行型孩子 |
| `combo_w` | 认知兼整合/完美型 | 双重天赋型孩子 |
| `combo_w_l` | 认知兼模仿型 | 主见学习型孩子 |
| `combo_open` | 任意类型兼开放型 | 开放加持型孩子 |

**总计：13 个类型键**

---

## 五、结果报告（generateReport()）

每个类型输出5个内容模块：

```
核心天赋（标签云）
性格优势（2段落，约200字）
学习风格（1段落）
发展方向（职业推荐）
给家长的建议（1段落）
```

**内容风格**：人话，情绪共鸣优先，所有内容都站在"为孩子辩护、帮家长理解"的角度，避免科研术语。

---

## 六、分享海报系统

### 6.1 技术方案

```
PCFG 配置表 → DOM 填充海报模板 → QRCodeJS 生成二维码 →
html2canvas 截图（scale:2，宽375px）→ PNG 预览 → 用户长按保存
```

**html2canvas 限制**：不支持 SVG `<filter>` 元素，因此指纹图形全部使用 opacity + gradient 替代滤镜效果。

### 6.2 指纹 SVG（_fpSVG）— 斗纹风格

10条同心椭圆，每圈递进旋转角度，模拟真实斗形指纹的螺旋视觉：

```javascript
rings = [
  { rx:10,  ry:8,   rot:0,  op:1.00, sw:1.6 },  // 最内圈
  ...
  { rx:114, ry:84,  rot:24, op:0.12, sw:0.5 },  // 最外圈
]
```

附加元素：
- 背景辐射渐变光晕（`radialGradient #fpg`）
- 中心聚焦光晕（`radialGradient #fcg`）
- 左右三角形（delta 三角，模拟指纹三叉点）
- 中心实心圆点 + 半透明光圈

**颜色系统**：全部使用 `cfg.color`（琥珀色参数），不硬编码颜色。

### 6.3 PCFG 海报内容配置（13个类型）

每个类型包含：
- `humanName`：海报展示的"人话类型名"（面向家长）
- `hook`：2行情绪钩子标题（痛点/好奇心触发）
- `benefit`：1行收益承诺
- `color`：琥珀色系（普通型 `#C2692A`，超级认知 `#D4891A`）

### 6.4 海报视觉结构（从上到下）

```
[顶部光晕] 
[品牌栏] AI PIWEN · 皮纹天赋  ✦
[分割线]
[副标题] 1分钟 · 发现孩子的天赋密码
[HOOK 标题] 2行情绪钩子（25px 加粗）
[指纹 SVG 图形] 250×200
[类型标签] 人话类型名（边框胶囊）
[收益一行] 10px 说明文字
[Tagline] 内部类型 tagline
[核心天赋] 4个天赋标签
[统计栏] 5大类型 · 权威算法 · 隐私安全
[底部 Footer]
  [二维码] [CTA 文案区]
            测一测，看看孩子为什么总是这样
            1分钟 · 找到行为背后的原因
            aipiwen.cn · 免费测试
```

### 6.5 海报 CTA 设计决策历史

| 版本 | CTA 文案 | 评价 |
|------|---------|------|
| v1 | 立即测试 | 过于通用 |
| v2 | 扫码免费测 | 太直白，无情绪 |
| v3 | 测一下·你是不是一直用错了教育方式 | 高压力，触发防御 |
| **v4（当前）** | **测一测，看看孩子为什么总是这样** | 好奇触发型，低压力，个人关联强 |

**当前副文案**：`1分钟 · 找到行为背后的原因`

**设计原理**：好奇触发 + 个人关联 + 发现型动词（测一测/看看）= 转化率与信任度兼顾。"为什么总是这样"是家长的真实痛点句式，激发好奇而非防御。

### 6.6 Modal 暗色处理

```css
#posterModal .modal-card { background: #1A1714; padding: 20px 20px 24px; }
#posterModal .modal-title { color: rgba(253,252,248,.8); }
#posterModal .modal-close { color: rgba(253,252,248,.35); }
```

（此 override 专门解决早期版本出现的"大白边"问题）

---

## 七、Git 提交历史（近期，最新在前）

| Hash | 描述 |
|------|------|
| `0a649af` | **[当前HEAD]** poster CTA: A方案 — 好奇触发型，低压力高转化 |
| `18b99a4` | revert poster to v3: 恢复人话文案+痛点钩子版本 |
| `e4e73a6` | poster v4: 克制高级感重构（已废弃，用户反馈文案不如v3） |
| `ee45df8` | poster v3: 人话类型名 + 情绪钩子 + 收益一行 + 痛点CTA |
| `01b6464` | poster: 斗纹SVG + 全琥珀色系统 |
| `542a26d` | redesign: poster v2 — 指纹图形 + 类型专属配色 |
| `c2b4e02` | fix: dark poster modal + rename 孔雀完美→完美特质 |
| `b961f52` | refactor: 五条规则完整重写classify() |

---

## 八、已知问题 & 待处理事项

### 8.1 确认完成
- ✅ 大白边（white border）修复
- ✅ 孔雀完美 → 完美特质（术语隔离，对外不露"孔雀"）
- ✅ 全琥珀色系，移除紫色
- ✅ 斗纹 SVG 指纹图形
- ✅ 13个类型的 PCFG 完整配置（人话名 + 钩子 + 收益）
- ✅ CTA A方案上线
- ✅ html2canvas 兼容处理（无 filter 元素）
- ✅ classify() 五条规则完整实现（含兼型、快速通道）

### 8.2 待审阅问题（供 Codex / ChatGPT 评估）

**[P1] 分类逻辑边界案例**
- Rule 2 触发条件是 `totalW >= 10`，但 `totalW` 包含 wOtherFingers（步骤7录入的非拇指斗形纹）。当用户在S2选了"十指全斗快速通道"后，state.allTenWhorls=true，wOtherFingers 自动设为全部8指。此路径是否有缺漏？特别是：快速通道后 ltThumb/rtThumb 可能仍为 null（需 S6 录入）。

**[P2] html2canvas 字体渲染**
- 海报截图在部分 Android 机型上，中文字体可能回退为系统默认，导致字距/字重与设计稿不符。目前无解决方案，接受此限制。

**[P3] 海报没有"保存到相册"按钮**
- 当前 UI：用户需长按图片保存。部分微信版本不支持长按内嵌 canvas/img。是否需要 `<a download>` 按钮作为备用？

**[P4] QR 码目标 URL 硬编码**
- `text:'https://aipiwen.cn'` —— 是否应改为带 UTM 参数的追踪链接？例如 `https://aipiwen.cn?src=poster&type={key}`，以便统计各类型海报带来的流量。

**[P5] PCFG 类型覆盖 — combo_w 兜底过宽**
- 当前 `combo_w` 的 hook 是"两种天赋同时存在"，比较通用。实际上 combo_w 可能覆盖"认知兼整合"、"认知兼完美"、"整合兼完美"三种细分，hook 有优化空间。

**[P6] 超级认知 A/B/C 的大拇指逻辑**
- Rule 2 分支：`isDouble(rt) || isDouble(lt)` → B；`isPeacock(rt) || isPeacock(lt)` → C。但当两拇指都是双斗时，也走B分支。如果都是孔雀眼，走C。如果一个双斗一个孔雀眼，走混合分支由左拇指决定。这套逻辑是否正确？

### 8.3 未实现功能

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | 海报保存按钮 | 替代长按方案 |
| P2 | QR UTM 追踪 | 统计海报来源 |
| P3 | 海报预览动画 | 当前生成时只显示"正在生成…" |
| P4 | 类型分布统计后台 | 哪种类型最多，用于内容优化 |

---

## 九、架构风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| 单文件 2109 行 | 中 | 可维护，但 poster/classify/wizard 三个模块混在一起，未来可考虑拆分 |
| html2canvas 依赖外部 CDN | 低 | 如 CDN 不稳定，海报生成失败，需做 fallback 提示 |
| QRCodeJS 版本锁定 v1.0.0 | 低 | 版本已稳定，风险小 |
| 无测试覆盖 | 中 | classify() 5条规则纯手工验证，无自动化单测 |
| 企微 API 依赖 Vercel 函数 | 中 | 冷启动延迟约 0.5-2s，客户消息响应可能偶发延迟 |

---

## 十、审阅重点建议

如果你是 Codex 或 ChatGPT，建议优先关注：

1. **classify() 函数正确性验证** — 特别是 Rule 2 十斗快速通道 + Rule 3 食指弧修饰的边界案例
2. **PCFG 文案评估** — 13个类型的 hook 文案是否在情绪共鸣 + 转化驱动上达到最优
3. **html2canvas 兼容性** — 是否有更稳健的 DOM→PNG 方案
4. **海报 Footer 区布局** — CTA 文案变长后（14字），12px 字体在 375px 宽度内是否仍然舒适

---

*本报告由 Claude (Cowork) 基于代码扫描生成，代表截止 2026-06-14 的实际代码状态。*
