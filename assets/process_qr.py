"""
微信二维码处理脚本
功能：白底→透明，颜色调成品牌色 #C2692A

使用方法：
1. 把你的微信个人二维码图片保存为 wechat-qr-original.png（放在同一文件夹）
2. 在终端运行：  python3 process_qr.py
3. 生成 wechat-qr.png（透明底+品牌色），供网页直接引用

依赖：pip3 install Pillow
"""
from PIL import Image
import os

SRC  = os.path.join(os.path.dirname(__file__), 'wechat-qr-original.png')
DST  = os.path.join(os.path.dirname(__file__), 'wechat-qr.png')

# 品牌色 #C2692A
BRAND_R, BRAND_G, BRAND_B = 0xC2, 0x69, 0x2A

img = Image.open(SRC).convert('RGBA')
pixels = img.load()
w, h = img.size

for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        brightness = 0.299*r + 0.587*g + 0.114*b
        # 亮度高（接近白色）→ 透明
        if brightness > 200:
            pixels[x, y] = (255, 255, 255, 0)
        else:
            # 其余像素（二维码点位）→ 品牌色不透明，保证扫码识别稳定
            pixels[x, y] = (BRAND_R, BRAND_G, BRAND_B, 255)

img.save(DST)
print(f'✅ 已生成 {DST}')
