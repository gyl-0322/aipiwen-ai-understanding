#!/bin/bash
cd "$(dirname "$0")"
echo "=== 推送 feat/m2-membership 到 GitHub ==="
echo ""
git branch --show-current
echo ""
echo "最新3条 commit："
git log --oneline -3
echo ""
echo "推送中..."
git push origin feat/m2-membership
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 推送成功！"
  echo "   分支已推送：feat/m2-membership"
  echo "   Vercel Preview 会自动部署，可在此查看："
  echo "   https://vercel.com/guo-yanling-s-projects/aipiwen-ai-understanding/deployments"
else
  echo ""
  echo "❌ 推送失败，请截图给我看。"
fi
echo ""
echo "按回车键关闭..."
read
