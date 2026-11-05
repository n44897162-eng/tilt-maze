#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_bg.py —— 把竖版风景图裁掉水印、压成低对比暗调、转成内联 base64

用法：python tools/make_bg.py [源图目录]
默认源图目录：web/bg/      输出：web/bg-data.js
依赖：Pillow（pip install Pillow）

处理流程：
  1. 裁掉底部 12%（去掉 AI 生图常见的右下角水印）与左右各 6% 边缘；
  2. 等比缩到 620px 宽（背景会被拉伸铺满，不需要更大）；
  3. 饱和度 0.55、对比 0.82、亮度统一到均值 62，避免有的图压黑后全没、有的发亮；
  4. 转 WebP q58 并 base64 内联，6 张合计约 57 KB。

注意：AI 生成的原始图片体积大且授权说明与代码不同，**没有随仓库分发**。
仓库里的 web/bg-data.js 已经是处理好的成品，正常构建不需要跑这个脚本。
若要换成自己的背景，请把竖版图片放进 web/bg/ 再执行本脚本；
文件按名称排序，顺序对应 engine1.js 中 BG_THEME 的索引，
建议命名为 01-ridge.png、02-canyon.png ... 以保持主题对应。
"""
import base64
import glob
import io
import os
import re
import sys

from PIL import Image, ImageEnhance, ImageStat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'web', 'bg')
OUT = os.path.join(ROOT, 'web', 'bg-data.js')
W = 620
TARGET_MEAN = 62.0


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.png')) +
                   glob.glob(os.path.join(SRC, '*.jpg')) +
                   glob.glob(os.path.join(SRC, '*.webp')))
    if not files:
        raise SystemExit(
            '没有找到源图：%s\n'
            '原始 AI 背景图未随仓库分发；web/bg-data.js 已是成品，正常构建无需此步骤。\n'
            '如需替换背景，请把竖版图片放进 web/bg/ 后重试。' % SRC)

    items, meta = [], []
    for f in files:
        im = Image.open(f).convert('RGB')
        w, h = im.size
        im = im.crop((0, 0, w, int(h * 0.88)))
        w2, h2 = im.size
        pad = int(w2 * 0.06)
        im = im.crop((pad, 0, w2 - pad, h2))
        w3, h3 = im.size
        im = im.resize((W, int(round(h3 * W / w3))), Image.LANCZOS)

        im = ImageEnhance.Color(im).enhance(0.55)
        im = ImageEnhance.Contrast(im).enhance(0.82)
        cur = sum(ImageStat.Stat(im).mean) / 3.0
        if cur > 1:
            im = ImageEnhance.Brightness(im).enhance(
                max(0.5, min(1.9, TARGET_MEAN / cur)))

        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=58, method=6)
        b = buf.getvalue()
        items.append('data:image/webp;base64,' + base64.b64encode(b).decode())

        raw = os.path.splitext(os.path.basename(f))[0]
        name = re.sub(r'^\d+[-_]', '', raw)
        name = re.sub(r'[^A-Za-z0-9_-]', '_', name)[:24] or 'bg'
        meta.append((name, len(b), im.size))
        print('%-16s %4d KB  %s' % (name, len(b) // 1024, im.size))

    js = '/* AI 生成的氛围背景（已去水印、压缩、内联）。由 tools/make_bg.py 生成。 */\n'
    js += 'var BG_DATA = [\n'
    js += ',\n'.join('  "%s"' % s for s in items)
    js += '\n];\n'
    js += 'var BG_NAMES = [%s];\n' % ','.join('"%s"' % m[0] for m in meta)
    with open(OUT, 'w', encoding='utf-8') as fp:
        fp.write(js)
    print('total %.0f KB -> %s' % (os.path.getsize(OUT) / 1024, OUT))


if __name__ == '__main__':
    main()
