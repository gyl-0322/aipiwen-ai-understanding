#!/bin/bash
# AIPIWEN 一键部署脚本
# 用法：bash deploy.sh

set -e
cd "$(dirname "$0")"

echo "🚀 开始部署 AIPIWEN..."

if [[ -n $(git status --porcelain) ]]; then
  echo "📝 发现未提交改动，正在提交..."
  git add -A
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')"
else
  echo "✅ 没有新改动"
fi

echo "⬆️  推送到 GitHub..."
git push origin main

echo ""
echo "✅ 推送完成！Vercel 1-2 分钟内自动部署。"
echo "   部署状态：https://vercel.com/dashboard"
echo "   线上网站：https://www.aipiwen.cn"
