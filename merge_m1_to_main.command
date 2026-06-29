#!/bin/bash
cd "$(dirname "$0")"
echo "=== AIPIWEN M1 → main 合并脚本 ==="
echo ""
echo "当前分支："
git branch --show-current
echo ""
echo "即将合并 feat/m1-tenant → main ..."
echo ""

# 切到 main
git checkout main
if [ $? -ne 0 ]; then
  echo "❌ 切换到 main 失败，请截图给我看。"
  echo "按回车键关闭..."; read; exit 1
fi

# 拉最新
git pull origin main
echo ""

# 合并（no-ff 保留 merge commit）
git merge feat/m1-tenant --no-ff -m "feat(M1): 多租户地基 + feature flag + 年龄计算修复

- _lib.js: 租户工具函数、getTenantContext、requireRole、ensureUserTenant（TENANT_ENABLED=false 透明）
- api/tenant.js: 租户 CRUD + 角色校验
- api/auth.js: 登录时幂等补写 role/tenantId
- api/extract-fp.js: 生日提取提示词加固 + 返回 birthday 字段
- api/children.js: 存 birthday + 动态算龄
- report-upload.html: 确认页加出生日期字段 + 自动重算年龄
- vercel.json: /api/tenant 路由
- api/invite.js: 删除（逻辑已在 auth.js，释放1个函数名额）

回归测试通过（2026-06-27）。TENANT_ENABLED 默认 false，现有用户零迁移。"

if [ $? -ne 0 ]; then
  echo "❌ 合并失败，请截图给我看。"
  echo "按回车键关闭..."; read; exit 1
fi

echo ""
echo "最新3条 commit："
git log --oneline -3
echo ""
echo "推送 main 到 GitHub ..."
git push origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 合并推送成功！Vercel Production 已触发部署。"
  echo "   https://vercel.com/guo-yanling-s-projects/aipiwen-ai-understanding/deployments"
else
  echo ""
  echo "❌ 推送失败，请截图给我看。"
fi

echo ""
echo "按回车键关闭..."
read
