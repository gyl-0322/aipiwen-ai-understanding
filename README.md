# AIPIWEN AI行为理解入口

## 项目说明

本目录是 AIPIWEN AI行为理解入口的**部署准备目录**。
`index.html` 是从 `../aipiwen_beta_v4.html` 复制的副本，用于未来部署到 `beta.aipiwen.cn`。

**本目录不代表已上线，不代表已部署。**

---

## 版本来源

- 当前 `index.html` 来源：`../aipiwen_beta_v4.html`
- 复制日期：2026-06-07
- 当前状态：本地静态 HTML，尚未部署

---

## 产品路径（三级转化）

```
第 1 层：AI行为理解入口（本文件）
  ↓
第 2 层：指纹初步自测 → 链接至 www.aipiwen.cn（旧版，需保护）
  ↓
第 3 层：正式测评预约 → 企业微信承接
```

---

## 绝对保护原则

**以下内容绝对不能修改、删除、覆盖：**

1. `www.aipiwen.cn` 当前是旧版「AI皮纹天赋速测」，必须完整保护
2. 禁止直接覆盖 `www.aipiwen.cn`
3. 禁止删除或修改旧版指纹测评网页
4. 原始文件 `../aipiwen_beta.html`、`../aipiwen_beta_v2.html`、`../aipiwen_beta_v3.html`、`../aipiwen_beta_v4.html` 必须全部保留，不能移动、不能删除、不能修改

---

## 更新流程

如需更新页面内容，请严格按以下顺序操作：

```
1. 修改原始文件：../aipiwen_beta_v4.html
2. 测试原始文件在本地正常打开
3. 复制到本目录：cp ../aipiwen_beta_v4.html ./index.html
4. 再部署本目录的 index.html
```

**不要直接修改本目录的 index.html 作为开发文件。**

---

## 部署目标

- 目标域名：`beta.aipiwen.cn`
- 部署平台：待确认（Cloudflare Pages / Vercel 均可）
- 部署方式：单文件静态 HTML，直接上传 `index.html`，无需构建工具
- 当前状态：**未部署，等待确认**

---

## 国内访问说明

⚠️ **当前测试链接（`aipiwen-ai-understanding.vercel.app`）仅供开发测试使用。**

- `vercel.app` 域名在国内网络下访问不稳定，部分地区无法打开
- **在国内访问方案确认前，不建议将 vercel.app 链接大规模发给真实用户**
- 正式面向国内用户前，需部署至国内可稳定访问的环境

**后续可选方案（待确认）：**
- 腾讯云静态网站托管（COS）
- 阿里云 OSS + CDN
- 国内已备案域名绑定
- Cloudflare Pages（部分地区可用，但不稳定）

在国内部署方案确认并测试通过之前，请勿将测试链接作为正式推广渠道。

---

## 文件说明

| 文件 | 说明 |
|---|---|
| `index.html` | 部署用副本，来源于 `../aipiwen_beta_v4.html` |
| `images/wechat_qr.png` | 企业微信二维码图片 |
| `README.md` | 本说明文件 |
