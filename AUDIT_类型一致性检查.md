# 任务5：TRC 类型一致性检查报告
> 生成时间：2026-06-20 | 审计范围：fingerprint-v2-wizard.html 各环节

---

## 一、classify() 实际输出的所有 key

| # | key | mainType（classify输出） | 触发条件 |
|---|-----|------------------------|---------|
| 1 | `rl` | `逆思型 R` | 任意手指有反箕纹 |
| 2 | `super_w_a` | `超级认知A · 螺旋领袖` | 十指全斗 + 拇指螺旋斗 |
| 3 | `super_w_b` | `超级认知B · 双核整合` | 十指全斗 + 任意拇指双斗 |
| 4 | `super_w_c` | `超级认知C · 完美特质` | 十指全斗 + 任意拇指孔雀眼 |
| 5 | `x` | `开放型` | 弧形纹≥6 或 两拇指均开放 |
| 6 | `combo_open` | `${lbl}兼开放型`（动态） | 食指有弧形纹 + 拇指非开放 |
| 7 | `super_l` | `超级模仿型` | 十指全正箕 |
| 8 | `w` | `认知型` | 两拇指均认知（螺旋斗等） |
| 9 | `wc` | `整合型` | 两拇指均双斗 |
| 10 | `perfect_w` | `完美型` | 两拇指均孔雀眼 |
| 11 | `l` | `模仿型` | 两拇指均箕形纹 |
| 12 | `combo_w` | `${a}兼${b}型`（动态） | 两拇指不同，均非模仿/开放 |
| 13 | `combo_w_l` | `${a}兼${b}型`（动态） | 两拇指不同，一个模仿 |

> ⚠️ `combo_open` 和 `combo_w` / `combo_w_l` 的 mainType 是动态字符串，不是固定名称。

---

## 二、全链路类型名称对照表

| key | classify() mainType | generateReport() 覆盖 | PCFG海报 humanName | QR ref= | GT.track type | _personality-types.js | trc-knowledge-base.js |
|-----|--------------------|-----------------------|--------------------|---------|---------------|----------------------|----------------------|
| `rl` | `逆思型 R` ⚠️ | ✅ | `反直觉思考型孩子` | `rl` | `rl` | `逆思型` | `逆思型` |
| `super_w_a` | `超级认知A · 螺旋领袖` ⚠️ | ✅ | `天生领袖型孩子` | `super_w_a` | `super_w_a` | `超级认知型A` ⚠️ | `超级认知型A` ⚠️ |
| `super_w_b` | `超级认知B · 双核整合` ⚠️ | ✅ | `多维整合领袖型孩子` | `super_w_b` | `super_w_b` | `超级认知型B` ⚠️ | `超级认知型B` ⚠️ |
| `super_w_c` | `超级认知C · 完美特质` ⚠️ | ✅ | `完美标准领袖型孩子` | `super_w_c` | `super_w_c` | `超级认知型C` ⚠️ | `超级认知型C` ⚠️ |
| `w` | `认知型` ✅ | ✅（含w_mild） | `独立主见型孩子` | `w` | `w` | `认知型` ✅ | `认知型` ✅ |
| `wc` | `整合型` ✅ | ✅ | `全局整合型孩子` | `wc` | `wc` | `整合型` ✅ | `整合型` ✅ |
| `perfect_w` | `完美型` ✅ | ✅ | `高标准完美型孩子` | `perfect_w` | `perfect_w` | **❌ 不存在** | **❌ 不存在** |
| `super_l` | `超级模仿型` ✅ | ✅ | `无限接纳型孩子` | `super_l` | `super_l` | `超级模仿型` ✅ | `超级模仿型` ✅ |
| `l` | `模仿型` ✅ | ✅（含l_mild） | `超强学习复制型孩子` | `l` | `l` | `模仿型` ✅ | `模仿型` ✅ |
| `x` | `开放型` ✅ | ✅ | `踏实执行型孩子` | `x` | `x` | `开放型` ✅ | `开放型` ✅ |
| `combo_w` | 动态 ⚠️ | ✅ | `双重天赋型孩子` | `combo_w` | `combo_w` | **❌ 不存在** | **❌ 不存在** |
| `combo_w_l` | 动态 ⚠️ | ✅ | `主见学习型孩子` | `combo_w_l` | `combo_w_l` | **❌ 不存在** | **❌ 不存在** |
| `combo_open` | 动态 ⚠️ | ✅ | `开放加持型孩子` | `combo_open` | `combo_open` | **❌ 不存在** | **❌ 不存在** |

---

## 三、发现的具体问题

### 🔴 严重问题

**P1：`完美型` 在知识库中不存在**
- classify() 可以产生 key=`perfect_w`，mainType=`完美型`
- generateReport('perfect_w') 有完整报告卡片
- PCFG 海报有 humanName='高标准完美型孩子'
- 但 `_personality-types.js` 和 `trc-knowledge-base.js` 均无 `完美型` 条目
- **后果：** AI 对话无法引用完美型的标准知识，只能靠 prompt 中通用知识推断

**P2：combo 三类型（combo_w / combo_w_l / combo_open）在知识库中不存在**
- 同上，AI 遇到组合型用户时无法引用专项知识

**P3：超级认知型 A/B/C 命名在前端与知识库不一致**
- classify() 输出：`超级认知A`、`超级认知B`、`超级认知C`（无"型"字）
- 知识库存储：`超级认知型A`、`超级认知型B`、`超级认知型C`（有"型"字）
- **后果：** 若代码用 mainType 去查知识库，会查不到

### 🟡 中等问题

**P4：`rl` 的 mainType 含多余后缀 " R"**
- classify() 返回 `mainType: '逆思型 R'`
- 知识库存储 `逆思型`（无 R）
- PCFG humanName 用的是完全不同的 `反直觉思考型孩子`
- **后果：** 前端展示标题是"逆思型 R"，AI 知识库对应条目叫"逆思型"，不一致

**P5：combo_open 的 mainType 是动态字符串**
- 实际输出如 `认知兼开放型`、`整合兼开放型` 等
- PCFG 中固定显示 `开放加持型孩子`
- 海报和报告名称可能不一致

### 🟢 轻微问题

**P6：generateReport() 有 `w_mild` 和 `l_mild` 分支，但 classify() 永远不会输出这两个 key**
- `if (key === 'w' || key === 'w_mild')` — `w_mild` 是死代码
- `if (key === 'l' || key === 'l_mild')` — `l_mild` 是死代码

---

## 四、知识库覆盖缺口

### 知识库中有、但 classify() 永远产生不了的类型（8个）
这些类型在 AI 提示词中存在，但用户无法通过速测进入它们：

| 类型名 | 存在于 |
|--------|--------|
| `双视型` | _personality-types.js + trc-knowledge-base.js |
| `弘拓模仿型` | _personality-types.js + trc-knowledge-base.js |
| `弘拓整合开拓型` | _personality-types.js + trc-knowledge-base.js |
| `智业集道结型` | _personality-types.js + trc-knowledge-base.js |
| `超级整合开拓型` | _personality-types.js + trc-knowledge-base.js |
| `智业集·开拓型` | _personality-types.js + trc-knowledge-base.js |
| `花茂美·逻辑型` | _personality-types.js + trc-knowledge-base.js |
| `花茂美·开拓型` | _personality-types.js + trc-knowledge-base.js |

### classify() 能产生、但知识库没有的类型（4个）

| key | mainType |
|-----|---------|
| `perfect_w` | 完美型 |
| `combo_w` | 多维认知型 |
| `combo_w_l` | 认知+模仿双驱 |
| `combo_open` | 主导+开放型 |

---

## 五、名称体系汇总（当前实际存在 5 套命名）

| 命名体系 | 示例（逆思型） | 使用位置 |
|---------|-------------|---------|
| classify() mainType | `逆思型 R` | 报告页卡片标题 |
| PCFG humanName | `反直觉思考型孩子` | 分享海报类型名 |
| 知识库中文名 | `逆思型` | AI 提示词 + trc-knowledge-base |
| GT.track key | `rl` | 埋点/数据统计 |
| QR ref 参数 | `rl` | 海报扫码进入链接 |

---

## 六、建议修复优先级（供 trc-type-map.js 参考）

| 优先级 | 问题 | 修复动作 |
|--------|------|---------|
| 🔴 P1 | 完美型不在知识库 | 在 _personality-types.js + trc-knowledge-base.js 补充 `完美型` 条目 |
| 🔴 P2 | combo 三类型不在知识库 | 补充 `多维认知型`/`主见学习型`/`开放加持型` 条目（或统一命名后补充） |
| 🔴 P3 | 超级认知型A/B/C 命名不一致 | classify() mainType 改为 `超级认知型A`（加"型"字）或知识库改为无"型" |
| 🟡 P4 | 逆思型 R 多余后缀 | classify() mainType 改为 `逆思型`，去掉 " R" |
| 🟡 P5 | combo_open 动态名称 | 固定为一个标准名，映射表中记录 |
| 🟢 P6 | w_mild / l_mild 死代码 | 保留（无害），注释说明为兼容预留 |

---

*本报告为纯审计输出，不涉及代码修改*
