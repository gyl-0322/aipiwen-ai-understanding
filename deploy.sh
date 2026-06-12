#!/bin/bash
# deploy.sh — 一键部署 AIPIWEN 到阿里云 OSS
# 运行方式：bash ~/AI-CEO-System/aipiwen-ai-understanding/deploy.sh

PROJECT_DIR="$HOME/AI-CEO-System/aipiwen-ai-understanding"
BUCKET="oss://aipewen-ai-understanding"
CONFIG="$HOME/.ossutilconfig"

echo ""
echo "=== AIPIWEN 一键部署 ==="
echo "目标：$BUCKET"
echo ""

# 检查 ossutil
if ! command -v ossutil &> /dev/null; then
  echo "❌ ossutil 未安装，请先运行："
  echo "   bash $PROJECT_DIR/setup_ossutil.sh"
  exit 1
fi

# 检查配置
if [ ! -f "$CONFIG" ]; then
  echo "❌ 未找到配置文件，请先运行："
  echo "   bash $PROJECT_DIR/setup_ossutil.sh"
  exit 1
fi

cd "$PROJECT_DIR"

# ─── 上传核心文件 ─────────────────────────────────────
echo "上传 index.html ..."
ossutil cp index.html "$BUCKET/index.html" \
  --config-file "$CONFIG" \
  --meta "Cache-Control:no-cache" \
  -f && echo "  ✅ index.html"

echo "上传 admin.html ..."
ossutil cp admin.html "$BUCKET/admin.html" \
  --config-file "$CONFIG" \
  --meta "Cache-Control:no-cache" \
  -f && echo "  ✅ admin.html"

# ─── 上传 images 目录 ─────────────────────────────────
if [ -d "images" ]; then
  echo "上传 images/ ..."
  ossutil cp images/ "$BUCKET/images/" \
    --config-file "$CONFIG" \
    -r -f && echo "  ✅ images/"
fi

# ─── CDN 刷新提示 ─────────────────────────────────────
echo ""
echo "=== 部署完成 ✅ ==="
echo ""
echo "⚠️  CDN 缓存刷新（手动操作，否则可能要等5-30分钟）："
echo "   阿里云控制台 → CDN → 刷新预热 → URL刷新"
echo "   输入：https://www.aipewen.cn/"
echo "         https://www.aipewen.cn/admin.html"
echo ""
echo "部署时间：$(date '+%Y-%m-%d %H:%M:%S')"
echo ""
