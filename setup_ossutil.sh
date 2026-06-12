#!/bin/bash
# setup_ossutil.sh — 安装并配置 ossutil，用于部署 AIPIWEN 到阿里云 OSS
# 运行方式：bash ~/AI-CEO-System/aipiwen-ai-understanding/setup_ossutil.sh

set -e

INSTALL_DIR="$HOME/.ossutil"
mkdir -p "$INSTALL_DIR"

echo ""
echo "=== AIPIWEN ossutil 安装配置 ==="
echo ""

# ─── 检测 Mac 架构 ────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  URL="https://gosspublic.alicdn.com/ossutil/1.7.19/ossutil-v1.7.19-mac-arm64.zip"
  ZIP="ossutil-mac-arm64.zip"
  BIN="ossutil-v1.7.19-mac-arm64/ossutil"
  echo "检测到 Apple Silicon (M1/M2/M3) Mac"
else
  URL="https://gosspublic.alicdn.com/ossutil/1.7.19/ossutil-v1.7.19-mac-amd64.zip"
  ZIP="ossutil-mac-amd64.zip"
  BIN="ossutil-v1.7.19-mac-amd64/ossutil"
  echo "检测到 Intel Mac"
fi

# ─── 下载 ossutil ─────────────────────────────────────
echo ""
echo "正在下载 ossutil..."
cd "$INSTALL_DIR"
curl -L "$URL" -o "$ZIP" --progress-bar
unzip -o "$ZIP" > /dev/null 2>&1
chmod +x "$BIN"

# 建立软链接
sudo ln -sf "$INSTALL_DIR/$BIN" /usr/local/bin/ossutil 2>/dev/null || \
  cp "$INSTALL_DIR/$BIN" "$HOME/.local/bin/ossutil" 2>/dev/null || \
  echo "export PATH=\"$INSTALL_DIR/$(dirname $BIN):\$PATH\"" >> "$HOME/.zshrc"

echo "ossutil 下载完成 ✓"

# ─── 输入 AccessKey ───────────────────────────────────
echo ""
echo "接下来配置 AccessKey。"
echo "获取方式：阿里云控制台 → 右上角头像 → AccessKey 管理 → 创建 AccessKey"
echo "⚠️  请不要把 AccessKey 发到任何聊天窗口，只在这里的终端输入。"
echo ""

read -p "请输入 AccessKey ID: " AK_ID
read -s -p "请输入 AccessKey Secret（输入时不显示）: " AK_SECRET
echo ""

# ─── 写入配置 ─────────────────────────────────────────
CONFIG_FILE="$HOME/.ossutilconfig"
cat > "$CONFIG_FILE" << EOF
[Credentials]
language=CH
endpoint=oss-cn-hangzhou.aliyuncs.com
accessKeyID=$AK_ID
accessKeySecret=$AK_SECRET
EOF

chmod 600 "$CONFIG_FILE"
echo "配置已写入 $CONFIG_FILE ✓"

# ─── 测试连接 ─────────────────────────────────────────
echo ""
echo "测试连接中..."
if ossutil ls oss://aipewen-ai-understanding/ --config-file "$CONFIG_FILE" > /dev/null 2>&1; then
  echo "✅ 连接成功！可以访问 oss://aipewen-ai-understanding/"
else
  echo "⚠️  连接测试失败，请检查 AccessKey 是否正确，或 bucket 权限是否开放。"
  echo "   你可以稍后运行 deploy.sh 再次测试。"
fi

echo ""
echo "=== 安装完成 ==="
echo "现在可以运行部署脚本："
echo "  bash ~/AI-CEO-System/aipiwen-ai-understanding/deploy.sh"
echo ""
