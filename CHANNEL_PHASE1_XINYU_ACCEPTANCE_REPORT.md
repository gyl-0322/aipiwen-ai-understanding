# CHANNEL_PHASE1_XINYU_ACCEPTANCE_REPORT

生成时间：2026-06-29  
当前分支：`feature/channel-system-xinyu-phase1`  
范围：鑫域文化一级服务商 Phase 1 本地验收包  
状态：本地开发已完成；未 push、未 deploy、未合并、未改线上配置。

---

## 1. 本轮修改文件清单

已修改：

- `api/_lib.js`
  - 扩展 tenant / referral / attribution / seat / mock order / commission_record 底层能力。
  - 兼容旧 `AGENT / SCHOOL`，新增 `channel_partner / institution` 展示语义。
  - 明确 `tid` 是展示租户上下文，`ref` 是商业归因码。
- `api/auth.js`
  - `login_url` 支持把 `tid` 与 `ref` 分别写入 state。
  - 登录回调后按 `ref` 执行首次归因锁定。
- `api/generate-report.js`
  - `report-store` 保存报告时补充 `ownerOpenid` / `ownerTenantId`，用于后续 API 层权限隔离。

新增：

- `api/channel.js`
  - Phase 1 服务商最小 API。
- `channel-admin.html`
  - 鑫域文化一级服务商最小后台。
- `institution-admin.html`
  - 二级服务商最小后台。
- `tests/channel-system-phase1.test.js`
  - 本地自动化验收测试，使用内存模拟 Redis，不访问真实 Redis。

---

## 2. 本地启动与验收说明

### 2.1 当前分支名

```bash
git branch --show-current
```

正常应返回：

```text
feature/channel-system-xinyu-phase1
```

### 2.2 安全自动验收命令

推荐先跑自动化验收，因为它使用内存模拟 Redis，不会碰生产 Redis。

```bash
node --test tests/channel-system-phase1.test.js
```

正常应看到：

```text
tests 5
pass 5
fail 0
```

本轮实测结果：

```text
✔ Phase 1 channel system local loop
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

### 2.3 页面人工查看路径

本项目没有 `package.json`，不是 `npm run dev` 型项目。若要本地以 Vercel 方式跑 API + 静态页，通常使用：

```bash
vercel dev
```

然后访问：

- `http://localhost:3000/channel-admin.html`
- `http://localhost:3000/institution-admin.html`
- `http://localhost:3000/api/channel?action=dashboard`

重要安全提醒：

- 不要直接使用指向生产 Redis 的 `.env.local` 做服务商验收。
- 若 `.env.local` 中是线上 KV / Redis，`vercel dev` 会触碰真实数据。
- 页面人工联调需要本地或沙盒 KV 环境，并设置：
  - `TENANT_ENABLED=true`
  - `SESSION_SECRET=<本地测试值>`
  - `PLATFORM_ADMIN_OPENIDS=admin_openid`
  - `KV_REST_API_URL=<本地或沙盒 Redis REST 地址>`
  - `KV_REST_API_TOKEN=<本地或沙盒 token>`

当前验收包没有修改 `.env` / `.env.local`，也没有创建任何真实账号。

### 2.4 测试账号 / openid / 管理员方式

自动化测试中使用的本地模拟账号：

| 身份 | openid | role | tenantId |
|---|---|---|---|
| 平台管理员 | `admin_openid` | `platform_admin` | `consumer` |
| 鑫域文化管理员 | `xinyu_admin` | `channel_partner` | `xinyu` |
| 二级服务商管理员 1 | `inst_admin` | `institution` | `inst_001` |
| 二级服务商管理员 2 | `inst2_admin` | `institution` | `inst_002` |
| C端用户 1 | `consumer_1` | `consumer` | `inst_001` |
| C端用户 2 | `consumer_2` | `consumer` | `inst_002` |

平台管理员识别方式：

```text
PLATFORM_ADMIN_OPENIDS=admin_openid
```

### 2.5 如果报错，最可能原因

| 现象 | 最可能原因 | 处理 |
|---|---|---|
| `SESSION_SECRET 未配置` | 本地运行 API 时没有设置 `SESSION_SECRET` | 设置本地测试值，不要使用生产密钥 |
| 页面显示未登录 / 401 | 没有本地 session cookie | 需要通过本地登录流程或沙盒数据写入 session |
| 页面显示 `TENANT_ENABLED=false` | 多租户开关未启用 | 本地设置 `TENANT_ENABLED=true` |
| API 访问真实 Redis | 本地 `.env.local` 指向生产 KV | 停止联调，改用沙盒 KV |
| `vercel dev` 不可用 | 本机没有 Vercel CLI | 可先只跑 `node --test` 自动验收 |
| 403 | 角色或 tenant 不匹配 | 对照上方 openid / role / tenantId |

---

## 3. 新增 Redis key / 数据结构

### Tenant

- `tenant:{tenantId}`
- `tenants:all`

示例：

```json
{
  "id": "xinyu",
  "tenantType": "channel_partner",
  "level": 1,
  "brandName": "鑫域文化",
  "referralCode": "xinyu_c",
  "status": "active"
}
```

### Referral

- `referral:{code}`
- `referrals:tenant:{tenantId}`

示例：

```json
{
  "code": "xinyu_c",
  "tenantId": "xinyu",
  "beneficiaryTenantId": "xinyu",
  "referralType": "c_user",
  "link": "/?tid=xinyu&ref=xinyu_c",
  "status": "active"
}
```

### Attribution

- `attribution:user:{openid}`
- `attribution:index:{tenantId}`
- `attribution:audit:{openid}`

示例：

```json
{
  "attributionId": "attr_new_user_a",
  "openid": "new_user_a",
  "ref": "xinyu_c",
  "sourceTenantId": "xinyu",
  "beneficiaryTenantId": "xinyu",
  "locked": true,
  "firstTouchAt": "ISO_TIME",
  "lockedAt": "ISO_TIME",
  "lastTouch": {
    "ref": "xinyu_c",
    "tenantId": "xinyu",
    "at": "ISO_TIME"
  }
}
```

### Seat

- `seat:{seatId}`
- `seats:{ownerTenantId}`

字段：

- `seatId`
- `ownerTenantId`
- `assignedOpenid`
- `seatType`
- `status`
- `quotaLimit`
- `expiresAt`
- `createdAt`

### Mock Order

- `mock_order:{orderId}`
- `mock_orders:{tenantId}`

字段：

- `orderId`
- `payerOpenid`
- `payerTenantId`
- `productType`
- `amountFen`
- `attributionId`
- `status`
- `createdAt`

### Commission Record

- `commission_record:{commissionId}`
- `commission_records:{beneficiaryTenantId}`

字段：

- `commissionId`
- `orderId`
- `beneficiaryTenantId`
- `commissionType`
- `baseAmountFen`
- `rate`
- `commissionAmountFen`
- `status`
- `createdAt`

---

## 4. 新增 API 清单

新增文件：`api/channel.js`

GET：

- `/api/channel?action=dashboard`
- `/api/channel?action=referral_info&ref=xinyu_c`
- `/api/channel?action=attribution&openid=xxx`
- `/api/channel?action=customer_report&id=xxx`
- `/api/channel?action=customer_conversation&sid=xxx`
- `/api/channel?action=customer_profile&openid=xxx`

POST：

- `/api/channel?action=init_xinyu`
- `/api/channel?action=create_institution`
- `/api/channel?action=create_referral`
- `/api/channel?action=apply_attribution`
- `/api/channel?action=correct_attribution`
- `/api/channel?action=create_seat`
- `/api/channel?action=create_mock_order`

修改原有 API：

- `/api/auth?action=login_url`
  - 支持 `tid` 与 `ref` 分离。
- `/api/auth?action=callback`
  - 登录后按 `ref` 锁定归因。
- `/api/report-store`
  - 保存报告时增加 owner 字段，不改变现有 C 端读取流程。

---

## 5. 新增页面清单

- `channel-admin.html`
  - 一级服务商后台。
  - 展示品牌信息、referral link、归因用户数量、二级服务商列表、mock 订单、mock 佣金、seat 列表。
  - 支持手动创建二级服务商。
- `institution-admin.html`
  - 二级服务商后台。
  - 展示品牌信息、referral link、归因用户数量、mock 订单、mock 佣金、seat 列表。

---

## 6. 四条演示链路说明

### 链路 1：鑫域文化一级服务商

目标：

1. 初始化鑫域文化 tenant。
2. 查看鑫域文化品牌信息。
3. 打开鑫域文化服务商后台。
4. 看到 referral link / QR 信息。
5. 看到归因用户数量、mock 订单、mock 佣金、seat 列表。

自动化验收覆盖：

- `initXinyuTenant('admin_openid')`
- 生成 tenant：`xinyu`
- 生成 referral：`xinyu_c`
- referral link：`/?tid=xinyu&ref=xinyu_c`
- dashboard 返回：tenant / referrals / attributionUserCount / subTenants / orders / commissions / seats。

页面验收路径：

- `http://localhost:3000/channel-admin.html`

正常应看到：

- 页面标题：`服务商后台`
- 品牌信息：`鑫域文化`
- Tenant ID：`xinyu`
- Referral Link 中包含：`ref=xinyu_c`
- 下方有二级服务商列表、Mock订单、Mock佣金、Seat列表。

### 链路 2：鑫域文化直推 C端用户

目标：

1. 用户通过鑫域文化 ref 进入。
2. 登录后生成 attribution。
3. `locked = true`。
4. 用户产生 mock order。
5. 生成鑫域文化 20% commission_record。

自动化验收结果：

- `buyer_xinyu` 通过 `xinyu_c` 归因。
- mock order：`amountFen=10000`。
- commission：
  - `beneficiaryTenantId=xinyu`
  - `rate=0.2`
  - `commissionAmountFen=2000`

### 链路 3：鑫域文化创建二级服务商

目标：

1. 鑫域文化创建二级服务商。
2. 二级服务商有自己的品牌信息。
3. 二级服务商有自己的 referral link / QR。
4. 二级服务商不能再创建下级服务商。

自动化验收覆盖：

- 创建 `inst_001`，referral code：`inst_001_c`。
- 创建 `inst_002`，referral code：`inst_002_c`。
- 一级服务商 dashboard 可看到 2 个二级服务商。
- 二级服务商调用 `create_institution` 返回 403。

页面验收路径：

- 一级服务商：`http://localhost:3000/channel-admin.html`
- 二级服务商：`http://localhost:3000/institution-admin.html`

### 链路 4：二级服务商直推 C端用户

目标：

1. 用户通过二级服务商 ref 进入。
2. 登录后归因给二级服务商。
3. 用户产生 mock order。
4. 生成二级服务商 20% commission_record。
5. 不给鑫域文化生成 C端上返佣金。

自动化验收结果：

- `buyer_inst` 通过 `inst_001_c` 归因。
- mock order：`amountFen=10000`。
- commission：
  - `beneficiaryTenantId=inst_001`
  - `rate=0.2`
  - `commissionAmountFen=2000`
- 鑫域文化佣金列表中不存在该 C 端订单的上返记录。

---

## 7. 权限隔离测试结果

测试命令：

```bash
node --test tests/channel-system-phase1.test.js
```

结果：

```text
tests 5
pass 5
fail 0
```

逐项结果：

| 项目 | 预期 | 本轮结果 |
|---|---:|---:|
| 未登录访问服务商后台 API | 401 | 通过 |
| C端用户访问平台初始化 API | 403 | 通过 |
| 一级服务商访问二级服务商客户报告正文 | 403 | 通过 |
| 一级服务商访问二级服务商客户会话 | 403 | 通过 |
| 一级服务商访问二级服务商客户档案 | 403 | 通过 |
| 二级服务商访问其他服务商数据 | 403 | 通过 |
| 个人用户访问他人报告 | 403 | 通过 |
| 二级服务商创建下级服务商 | 403 | 通过 |
| 已 locked attribution 用户再次扫码 | 不覆盖归因，只更新 lastTouch | 通过 |
| 平台管理员手动修正归因 | 成功，并写 audit | 通过 |

说明：

- 权限隔离在 `api/channel.js` 和 `_lib.js` 的 API 层执行。
- 不是只靠前端隐藏按钮。

---

## 8. Mock订单和Mock佣金规则说明

当前规则：

| 场景 | beneficiaryTenantId | rate |
|---|---|---:|
| 鑫域文化直推 C端 | `xinyu` | 20% |
| 二级服务商直推 C端 | `inst_xxx` | 20% |
| 二级服务商 C端订单 | 不上返鑫域文化 | 0 |
| 二级服务商首年服务费 | 二级服务商 parent，即鑫域文化 | 40% |
| 二级服务商续费 | 二级服务商 parent，即鑫域文化 | 30% |

订单状态：

- `mock_pending`
- `mock_paid`
- `mock_cancelled`

佣金状态：

- `pending`
- `confirmed`
- `cancelled`

---

## 9. 仍是 Mock 的功能

以下功能仍是 mock 或 Phase 1 演示能力：

- mock order 不是真实支付订单。
- commission_record 不是自动结算记录。
- 没有自动打款。
- 没有自动开票。
- 没有提现流程。
- 没有完整财务后台。
- 没有自助开通二级服务商。
- 没有复杂 CRM。
- 页面只做最小验收，不是最终运营后台。
- QR 目前以 referral link 为主，正式二维码生成还未接入。

---

## 10. 未来上线前必须确认

上线前至少需要确认：

1. `TENANT_ENABLED=true` 的启用范围。
2. 鑫域文化正式品牌资料：
   - logo
   - brandName
   - themeColor
   - referral code 是否固定为 `xinyu_c`
3. 二级服务商 ID 与 referral code 命名规则。
4. 谁有平台管理员权限。
5. 谁有鑫域文化服务商管理员权限。
6. 二级服务商后台是否允许真实创建 seat。
7. C端订单接真实支付后的订单状态映射。
8. 佣金比例是否最终锁定。
9. 二级服务商 C端订单“不上返鑫域文化”的商业规则是否最终确认。
10. 是否需要在正式后台展示二维码图片，而不是只展示 referral link。
11. 是否需要正式审计日志后台，而不是只写 Redis audit key。
12. 是否需要沙盒 Redis / staging 环境，避免本地验收误触生产数据。

---

## 11. 当前 git status

当前状态：

```text
## feature/channel-system-xinyu-phase1
 M api/_lib.js
 M api/auth.js
 M api/generate-report.js
?? api/channel.js
?? channel-admin.html
?? institution-admin.html
?? tests/
?? CHANNEL_PHASE1_XINYU_ACCEPTANCE_REPORT.md
```

说明：

- 本报告生成后会新增 `CHANNEL_PHASE1_XINYU_ACCEPTANCE_REPORT.md`。
- 当前没有 commit。
- 当前没有 push。
- 当前没有 deploy。

---

## 12. 当前是否有线上风险

当前执行结果：

- 未 push。
- 未 deploy。
- 未合并。
- 未修改 Vercel。
- 未修改 `.env`。
- 未修改 `.env.local`。
- 未触碰生产 Redis。
- 自动化测试使用内存模拟 Redis。

当前线上风险判断：

```text
低风险。当前改动只停留在本地 feature 分支，尚未进入线上链路。
```

需要注意：

如果后续人工页面联调用 `vercel dev`，不要使用指向生产 Redis 的 `.env.local`。否则虽然是本地运行，也会读写真实 Redis。

---

## 13. 是否建议进入 Phase 2

建议：

```text
暂不进入 Phase 2。
```

原因：

1. Phase 1 自动化测试已通过，但还需要你人工查看 `channel-admin.html` / `institution-admin.html` 的页面表达是否符合业务预期。
2. 当前还缺一个明确的本地或 staging KV 环境，不能用生产 Redis 做人工联调。
3. 需要先确认：
   - 鑫域文化品牌入口表现
   - referral link 规则
   - 二级服务商创建方式
   - 佣金不上返规则
   - 后台展示字段是否足够

建议下一步：

```text
人工验收 Phase 1 页面与链路后，再决定是否进入 Phase 2。
```

