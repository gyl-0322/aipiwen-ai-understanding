# 任务3：API 文件审计报告
> 生成时间：2026-06-20 | 当前状态：12/12 函数（Vercel Hobby 上限）

---

## 一、当前 API 文件全览

| 文件 | 占 Vercel 配额 | 类型 | 主要功能 | 可合并 | 能否动 |
|------|--------------|------|---------|--------|--------|
| `_lib.js` | ❌（下划线） | 工具库 | Redis封装、认证、限流工具函数 | — | ⛔ 不能动（全系统依赖） |
| `_personality-types.js` | ❌（下划线） | 知识库 | TRC 17种类型数据 + AI提示词构建 | — | ⚠️ 谨慎（AI质量依赖） |
| `guest-chat.js` | ✅ 占1个 | 核心产品 | 访客AI对话（4场景：亲子/自我/伴侣/合伙）| ❌ 不建议 | ⚠️ 核心接口，改需测试 |
| `synthesize.js` | ✅ 占1个 | 核心产品 | 跨场景综合分析，调用AI生成洞察 | ❌ 不建议 | ⚠️ 核心接口，改需测试 |
| `auth.js` | ✅ 占1个 | 基础设施 | 微信OAuth登录 + 会话管理（4个action）| ❌ 不能合 | ⛔ 涉及登录安全 |
| `children.js` | ✅ 占1个 | 基础设施 | 孩子档案CRUD（4个action）| ❌ 不能合 | ⚠️ 涉及用户数据 |
| `wechat.js` | ✅ 占1个 | 基础设施 | 企业微信客服自动回复webhook | ❌ 不能合 | ⚠️ 涉及微信安全验证 |
| `digest.js` | ✅ 占1个 | 定时任务 | 每日/每周画像生成、模式提取、周报（3个Cron）| ❌ 不能合 | ⚠️ Cron依赖，maxDuration=60⚠️ |
| `knowledge.js` | ✅ 占1个 | 辅助功能 | RAG知识搜索 + 管理员批量加载 | ✅ **可考虑合并入guest-chat** | ⚠️ 当前独立接口 |
| `admin-convs.js` | ✅ 占1个 | 后台管理 | 对话日志查看（GET，需secret）| ✅ **可考虑合并入growth** | ✅ 低风险 |
| `track.js` | ✅ 占1个 | 数据追踪 | 增长埋点写入（POST，存KV）| ⚠️ 可吸收stats | ⚠️ 前端直接调用 |
| `growth.js` | ✅ 占1个 | 数据追踪 | 增长数据读取（GET，供admin看板）| ✅ **可合并入track** | ✅ 低风险 |
| `stats.js` | ✅ 占1个 | 数据追踪 | 基础事件统计（POST写+GET读）| ✅ **可合并入track** | ⚠️ 有独立Redis schema |
| `myip.js` | ✅ 占1个 | 工具 | 返回出口IP（供微信白名单申请用）| ✅ **可合并入_lib或wechat** | ✅ 极低风险 |

**当前：12/12（已满，任何新增 api/*.js 都会导致部署失败）**

---

## 二、合并可行性分析

### 方案A：合并 track + growth + stats（优先推荐）
```
track.js  ←  吸收 growth.js 的读取功能（增加 GET ?action=report）
track.js  ←  吸收 stats.js 的基础统计功能（增加 ?action=stats_write / stats_read）
```
- 释放配额：-2（从12→10）
- 风险：需要更新前端调用路径 `/api/growth` → `/api/track?action=report`
- stats.js 有独立的 Redis schema（stats:daily:xxx），合并后需保留兼容

### 方案B：myip 合并入 _lib（零风险）
```
_lib.js  ←  新增 getOutboundIP() 函数（内部用）
myip.js  →  删除
```
- 释放配额：-1（从12→11）
- 风险：极低，myip.js 当前没有前端调用，只是手动访问用于查IP

### 方案C：admin-convs 合并入 growth（低风险）
```
growth.js  ←  增加 GET ?action=convs 功能
admin-convs.js  →  删除
```
- 释放配额：-1
- 风险：低，都是管理员接口，均需 secret 认证

### 不建议合并的原因

| 文件 | 不合并原因 |
|------|-----------|
| `guest-chat.js` | 流量最大、功能独立、AI接口复杂，合并会提高风险 |
| `synthesize.js` | AI接口，逻辑独立，不建议与其他合并 |
| `auth.js` | 安全相关，微信OAuth逻辑不能与业务API混合 |
| `children.js` | 数据CRUD，逻辑独立，不建议合并 |
| `wechat.js` | 微信webhook有严格签名验证，独立性要求高 |
| `digest.js` | Cron任务，运行时间长，与其他接口合并会超时 |

---

## 三、Vercel 配额风险

```
当前状态：12/12 ← 已满

如果实施方案A+B+C：10→9/12（释放3个配额）
如果只实施方案B（最低风险）：11/12（释放1个配额）
```

### 已知风险项

1. **`digest.js` 的 maxDuration: 60**
   - Hobby计划 Serverless Function 最长10s，配置60s 会被截断或忽略
   - 每日Cron任务可能因超时失败
   - 建议：升级Pro 或 将digest拆分为多次小任务

2. **新增任何 api/*.js 必须先合并旧文件**
   - 本阶段严禁新增

---

## 四、本阶段建议行动（只审计，以下仅供参考）

| 优先级 | 行动 | 释放配额 | 风险 |
|--------|------|---------|------|
| 🔴 下阶段必做 | 将 myip.js 合并入 wechat.js 或 _lib.js | -1 | 极低 |
| 🟡 下阶段建议 | 将 growth.js 合并入 track.js | -1 | 低 |
| 🟡 下阶段建议 | 将 admin-convs.js 合并入 growth.js | -1 | 低 |
| 🟢 可选 | 将 stats.js 合并入 track.js（需处理schema差异）| -1 | 中 |
| ⛔ 本阶段禁止 | 合并 guest-chat / synthesize / auth / children / wechat / digest | — | 高 |

---

*本报告为纯审计输出，本阶段不执行任何合并操作*
