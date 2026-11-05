#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assemble.py —— 把 web/ 下的源码合并成单文件 dist/index.html

用法：python tools/assemble.py
产物：dist/index.html（可直接双击用浏览器打开，也是 APK 的 assets 来源）

设计说明：整个游戏是零依赖的原生 JS/CSS，没有 npm、没有打包器。
把所有片段按固定顺序内联进一个 HTML，是为了：
  1. 安卓 WebView 可以直接以 file:// 加载，不需要本地服务器；
  2. 完全离线，不发任何网络请求；
  3. 网页版与 APK 版代码同源，不会两边漂移。
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
WEB = os.path.join(ROOT, 'web')
DIST = os.path.join(ROOT, 'dist')


def read(name):
    path = os.path.join(WEB, name)
    if not os.path.exists(path):
        raise SystemExit('missing source file: ' + path)
    with open(path, encoding='utf-8') as f:
        return f.read()


def main():
    style = read('style.css')
    body = read('body.html')
    bgdata = read('bg-data.js')
    e1 = read('engine1.js')
    e2 = read('engine2.js')
    ui = read('ui.js')
    bridge = read('android-bridge.js')

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0B0E10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
<link rel="icon" href="data:,">
<title>滚球迷宫 · Tilt Maze</title>
<style>
{style}
</style>
</head>
<body>
{body}
<script>
{e1}
{bgdata}
{e2}
{ui}
{bridge}
</script>
</body>
</html>
'''

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'index.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print('built %s (%d bytes)' % (out, len(html.encode('utf-8'))))


if __name__ == '__main__':
    main()
