#!/bin/bash
# 线上 www.aipiwen.cn 已在阿里云（nginx），不是 Vercel。
# 本脚本不再推 main，也不对生产执行上传。

echo "已停止。"
echo "www.aipiwen.cn / aipiwen.cn 由阿里云发布，推 GitHub main 不会自动上线。"
echo "仓库里的 .github/workflows/deploy.yml 只在 main 变更 index.html、admin.html、images/ 时，"
echo "把这几个文件拷到 OSS bucket aipewen-ai-understanding，不是现网整站。"
echo "现网响应头是 nginx/1.18.0 (Ubuntu)。发布前请在阿里云侧同步本 PR 列出的静态页和 API，不要用本脚本。"
exit 1
