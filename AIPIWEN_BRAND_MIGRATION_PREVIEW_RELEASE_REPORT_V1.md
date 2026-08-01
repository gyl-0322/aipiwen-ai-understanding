# AIPIWEN Brand Migration Preview Release Report V1

- 执行日期：2026-08-01（America/Los_Angeles）
- 阶段结论：**Preview PASS**
- Production 发布：**NOT RUN**
- Production、正式域名、Production alias、数据库及其他业务系统：**未修改**

## 1. Production 基线

| 项目 | 已确认值 |
|---|---|
| Vercel Project | `aipiwen-ai-understanding` |
| Production Deployment | `dpl_ACg8QW2B7yLTbwgzD9WAkT4MKqf8` |
| Production Release Commit | `f84e2b8f9917c03a13445f70aa450ee240900450` |
| Production URL（deployment） | `https://aipiwen-ai-understanding-gtt35vipd-guo-yanling-s-projects.vercel.app` |
| 正式域名只读复核 | `aipiwen.cn` 仍解析到上述 Production deployment，状态 Ready |

基线验证：新工作树创建时 `HEAD` 与 merge-base 均为完整 commit `f84e2b8f9917c03a13445f70aa450ee240900450`。没有复用旧品牌迁移工作树，也没有复用当前脏目录。

## 2. 新 release 分支

| 项目 | 值 |
|---|---|
| Clean worktree | `/Users/gyl0322gmail.com/Documents/AIPIWEMN自媒体/.work/aipiwen-brand-migration-clean-release-v1` |
| Branch | `release/brand-migration-preview-v1-20260801` |
| Preview 源码 commit | `ad96ddc82cf963ee81dbe77974b264bf32ed0263` |
| 基线 commit | `f84e2b8f9917c03a13445f70aa450ee240900450` |
| Remote 状态 | 本地分支，未 push；远端同名分支不存在 |

本地迁移提交：

1. `086b533` — 四个页面品牌语言迁移及运行时入口收敛。
2. `ad96ddc` — 停止向模型拼接确定性旧知识块，统一为“已有材料辅助观察”证据边界。

## 3. 修改文件列表

| 文件 | 处理内容 |
|---|---|
| `homepage.html` | 主表达改为行为观察、成长探索、家庭沟通与资料辅助；保留 Production 新增入口和进度结构。 |
| `fingerprint-v2-wizard.html` | 标题、步骤、结果、运行时提示及工具卡统一为孩子行为观察体验；去除确定性结论承诺。 |
| `report-upload.html` | 上传页统一为“已有资料辅助解读”；保留指导师服务码等 Production 功能。 |
| `personality.html` | 补齐旧迁移遗漏页面；标题、错误态、CTA、类型文案和因果性描述全部收敛为成长观察。 |
| `api/guest-chat.js` | 增加品牌归一化与最高优先级证据边界；模型只接收安全观察规则，不再拼接确定性旧知识块；接口键、模板选择键、会话和计费逻辑未改。 |
| `api/extract-fp.js` | OCR system prompt 从旧产品定位改为中性的皮纹报告数据提取助手；提取结构和字段未改。 |

未修改 `vercel.json`、路由配置、函数预算、数据库迁移、鉴权、积分、支付和正式域名配置。

## 4. 品牌扫描结果

### 4.1 四个公开页面

扫描词：`天赋检测`、`天赋速测`、`天赋图谱`、`测评作为主表达`、`专业解读`。

| 页面 | 结果 |
|---|---|
| `homepage.html` | 旧主表达 0；保留 2 行“传统测评”对比说明，共 3 次“测评”字面命中，正文明确说明其不是产品承诺。 |
| `fingerprint-v2-wizard.html` | 0 个旧主表达命中。 |
| `report-upload.html` | 0 个旧主表达命中。 |
| `personality.html` | 0 个旧主表达命中，遗漏页面已覆盖。 |

浏览器对最终 Preview 的可见文本复核：六个 URL（四个 `.html` 路径加 `/report-upload`、`/personality`）均无 `天赋检测`、`天赋速测`、`天赋图谱`、`专业解读`，且均非 404。

### 4.2 运行时提示词与兼容残留

- `api/guest-chat.js`：最终 system prompt 先执行品牌归一化，再追加品牌与证据边界；旧词仅存在于 7 条替换映射中，不会作为模型主表达传入。
- `api/extract-fp.js`：旧定位命中 0。
- `api/auth.js`：保留 2 处旧入口消息识别，用于兼容历史“联系顾问”文本；不作为页面或模型输出。
- `lib/report-upload-p0-dryrun.js`：保留 1 处内容分类关键词，用于识别已有报告文本。
- `static/v3a-admin.js`：保留 1 处后台从业者类型名称，不属于本次公开页面和模型主表达。

以上兼容残留未修改，避免破坏历史入口、分类和后台数据含义。

## 5. Preview 地址

| 项目 | 值 |
|---|---|
| Preview Deployment | `dpl_2UVVv6CCKAcyjeX9847r1xXhk7x1` |
| Preview URL | https://aipiwen-ai-understanding-j8rvf2fre-guo-yanling-s-projects.vercel.app |
| Vercel target | `preview` |
| 状态 | Ready |
| Production promotion | NOT RUN |

构建命令为 `vercel build --target=preview`；部署命令为不带 `--prod` 的 `vercel deploy --prebuilt`。未执行 Production alias、正式域名或 promotion 操作。

## 6. SHA-256 对比

### 6.1 Production 基线与 Preview 源码

| 文件 | Production 基线 SHA-256 | Preview 源码 SHA-256 |
|---|---|---|
| `homepage.html` | `8f847fba17a61b9933283ff2e777fbb38010151e9b67361f598b9f63b2a29900` | `e6342977ace7e6afb6ec8db13270a59f5b819ac1c9c6762f7a393595f1cc56bf` |
| `fingerprint-v2-wizard.html` | `34139a54c12e57d5707bb1db365d247b3b6d0c8eff2515f91f411c797ec89560` | `3d257a93396243e3e1c3b5b66e851ee1364ca2530853b29195bbbc13459b7d96` |
| `report-upload.html` | `5b3da434495b6c8a4af4353fcaba019d02315c5c5cc59b62a3ad8a382a10e5db` | `f5095e0d56b41a79f8dfb172b7da3cb102291e985131a76e693fc487fd081590` |
| `personality.html` | `6cc793abf22541e8a544f1cf266f88424234e1ac65d6a4bca984476ac7975fc3` | `79bff9bf1fd18ab9d39d3b1f57a0280fe3d3e2139416894f6376b7ca3b070592` |
| `api/guest-chat.js` | `c7e5490e6b9e2442f25db41407249ef992eadb0b755f10db1658c5d0c6c07506` | `30d5ddf000f7b1220cc85d46a3142e6da764c5db7a2ee92e0d9bfdf2f6a208c0` |
| `api/extract-fp.js` | `c190e4805779b8f950a2d9cb1566f53d08aad1cdbad1df25d36fd7404f184c28` | `ba10a0412c580a96c3bbe985f58aa32fe2b5a8cd4824318d28205d9c9faf4050` |

### 6.2 构建与部署一致性

四个 HTML 的本地文件 SHA 与 `.vercel/output/static/` 构建产物 SHA 完全一致。

Vercel Preview 在原始 HTML 末尾自动注入一行 `vercel.live` Preview Feedback 脚本，因此 HTTP 原始响应 SHA 与源码不同。去除该 deployment 专属注入行后，四个 HTTP 响应 SHA 均与本地/构建 SHA 一致：

| 页面 | HTTP 原始响应 SHA-256 | 去除 Vercel Preview 注入后 SHA-256 |
|---|---|---|
| `homepage.html` | `1606b525239558471efe8939e56e20b719d2e0c8777b6347fbdc0ebc6fb727ed` | `e6342977ace7e6afb6ec8db13270a59f5b819ac1c9c6762f7a393595f1cc56bf` |
| `fingerprint-v2-wizard.html` | `6a35c905439479b603aa01091dc37dca0623fa8a3b0140d66cdb86ae16e297da` | `3d257a93396243e3e1c3b5b66e851ee1364ca2530853b29195bbbc13459b7d96` |
| `report-upload.html` | `09a74c172cd9313fa97b35d0b02b6b9a1f3dca63fbfdd67828f0fe1fbb27d5fe` | `f5095e0d56b41a79f8dfb172b7da3cb102291e985131a76e693fc487fd081590` |
| `personality.html` | `fc226c675aeabf4dfe85affdc217f82a1b076ea46afad027851aa1ecfab7003e` | `79bff9bf1fd18ab9d39d3b1f57a0280fe3d3e2139416894f6376b7ca3b070592` |

## 7. 验证结果与风险说明

### 验证结果

- JavaScript 语法检查：PASS。
- `git diff --check`：PASS。
- Runtime 品牌归一化样例断言：PASS。
- AI interpreter 页面安全边界测试：PASS。
- Report upload P0 共 12 项风险用例：12/12 PASS。
- Advisor 页面/真实路由/零 mock 边界：PASS。
- Vercel Function budget：12/12 PASS。
- V3A SMS Hook 隔离测试：PASS，零真实发送。
- Preview build：PASS。
- Preview deployment：Ready，target=`preview`。
- 浏览器最终检查：六个 URL 均正常返回，无 404，无旧主表达命中，无 console error/warning。
- 首页 1440×900 目视检查：布局正常；其余页面以 DOM、标题、加载状态、路由和控制台为验收依据。
- `aipiwen.cn` 只读复核：仍指向原 Production deployment `dpl_ACg8QW2B7yLTbwgzD9WAkT4MKqf8`。

### 已知风险

1. 首页仍有“传统测评”对比问答。它不是产品承诺，但发布前需由品牌负责人确认是否保留搜索语义。
2. 三处兼容分类/入口仍含旧字面词；删除或改名可能破坏历史消息识别、内容分类或后台枚举，因此本 Sprint 未改。
3. 未对真实 AI 服务发起端到端请求，避免产生外部用量、会话日志或数据库写入；运行时提示仅通过源码、构造路径和本地断言验证。
4. 未执行真实图片上传、登录、积分、支付或指导师服务码流程，因为这些动作可能写入业务系统。
5. Vercel Preview 自动注入 feedback 脚本，导致 HTTP 原始字节 SHA 与构建产物不同；已通过去除唯一注入行后的 SHA 证明主体内容一致。
6. 本地 release 分支未 push。若后续需要团队评审，应先人工确认远端目标与权限，再执行非 force push。

## 8. Production 发布前待确认事项

- [ ] 品牌负责人确认首页“传统测评”对比说明是否保留。
- [ ] 在 Preview 中人工浏览四个页面的桌面与手机布局，特别确认首页 Cookie 横幅、向导步骤和上传页可读性。
- [ ] 使用明确的非 Production 测试身份，人工完成一次真实业务链路验证；若会写数据库，需另行获得授权并准备回滚/清理方案。
- [ ] 确认三处兼容残留继续保留，不纳入本次公开品牌扫描失败条件。
- [ ] 复核 branch diff 仅含本报告列出的 6 个源码文件及本报告。
- [ ] 明确批准后再单独制定 Production promotion 任务；本任务不得执行 `vercel --prod`、alias 或正式域名操作。

## 9. 未修改确认

- Production：未修改、未发布、未 promotion。
- Production alias / 正式域名：未修改。
- Content OS：未修改。
- Ops Hub：未修改。
- OpenClaw：未修改。
- Emma 系统：未修改。
- Obsidian：未修改。
- 数据库：未修改。
- 支付配置、账号权限、企业微信后台：未修改。

最终状态：**Preview PASS / Production NOT RUN**。
