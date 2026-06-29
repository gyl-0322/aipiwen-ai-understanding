#!/bin/bash
cd "$(dirname "$0")"
echo "=== AIPIWEN M1 推送脚本 ==="
echo ""
echo "当前分支："
git branch --show-current
echo ""
echo "本地最新 3 条 commit："
git log --oneline -3
echo ""
echo "准备推送 feat/m1-tenant 到 GitHub..."
git push origin feat/m1-tenant
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 推送成功！请去 Vercel 控制台查看预览链接。"
  echo "   https://vercel.com/gyl-0322/aipiwen-ai-understanding/deployments"
else
  echo ""
  echo "❌ 推送失败，请截图给我看。"
fi
echo ""
echo "按回车键关闭..."
read
