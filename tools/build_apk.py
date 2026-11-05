#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_apk.py —— 不用 Gradle，直接 aapt2 + javac + d8 + zipalign + apksigner 打包

用法：python tools/build_apk.py
前置：先跑 python tools/assemble.py 生成 dist/index.html
产物：dist/tilt-maze.apk

为什么不用 Gradle：这个应用只有一个 Activity、一个 WebView、零第三方依赖，
Gradle 会拖进几百 MB 的依赖和构建缓存。手工调用 SDK 命令行只需几秒，
并且让「APK 里到底装了什么」变得完全透明。

环境变量：
  ANDROID_HOME / ANDROID_SDK_ROOT   Android SDK 根目录（不设则自动探测常见位置）
  TILTMAZE_KEYSTORE                 自定义签名库路径（可选）
  TILTMAZE_KS_PASS                  签名库口令（默认 tiltmaze，仅用于本地 debug 签名）

注意：build-tools 34.0.0 附带的 R8 8.2.2 在 JDK 22 上会 NPE 崩溃，
因此脚本优先选择 36.1.0+，找不到时给出明确提示。
"""
import os
import shutil
import subprocess
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
AND = os.path.join(ROOT, 'android')
OUT = os.path.join(ROOT, 'dist')
WORK = os.path.join(ROOT, '.apkbuild')

EXE = '.exe' if os.name == 'nt' else ''
APP_NAME = 'tilt-maze.apk'
VERSION_CODE = '1'
VERSION_NAME = '2.0'
KS_PASS = os.environ.get('TILTMAZE_KS_PASS', 'tiltmaze')


def find_sdk():
    for var in ('ANDROID_HOME', 'ANDROID_SDK_ROOT'):
        p = os.environ.get(var)
        if p and os.path.isdir(p):
            return p
    local = os.environ.get('LOCALAPPDATA', '')
    candidates = [
        os.path.join(local, 'Android', 'Sdk') if local else '',
        os.path.expanduser('~/Android/Sdk'),
        os.path.expanduser('~/Library/Android/sdk'),
        '/opt/android-sdk',
        r'C:\Android\Sdk',
        r'F:\Android\Sdk',
    ]
    for p in candidates:
        if p and os.path.isdir(p):
            return p
    raise SystemExit('找不到 Android SDK，请设置 ANDROID_HOME 环境变量')


def find_build_tools(sdk):
    base = os.path.join(sdk, 'build-tools')
    if not os.path.isdir(base):
        raise SystemExit('SDK 缺少 build-tools：' + base)
    preferred = os.path.join(base, '36.1.0')
    if os.path.isdir(preferred):
        return preferred
    versions = []
    for name in os.listdir(base):
        p = os.path.join(base, name)
        if os.path.isdir(p) and os.path.exists(os.path.join(p, 'aapt2' + EXE)):
            try:
                versions.append((tuple(int(x) for x in name.split('.')[:2]), p))
            except ValueError:
                pass
    if not versions:
        raise SystemExit('build-tools 里没有可用的 aapt2：' + base)
    versions.sort(reverse=True)
    chosen = versions[0][1]
    if versions[0][0] < (36, 0):
        print('[warn] 建议安装 build-tools 36.1.0+；旧版 d8 在较新 JDK 上可能崩溃')
    return chosen


def find_platform(sdk):
    base = os.path.join(sdk, 'platforms')
    preferred = os.path.join(base, 'android-34', 'android.jar')
    if os.path.exists(preferred):
        return preferred
    if os.path.isdir(base):
        jars = []
        for name in os.listdir(base):
            p = os.path.join(base, name, 'android.jar')
            if os.path.exists(p):
                jars.append((name, p))
        if jars:
            jars.sort(reverse=True)
            return jars[0][1]
    raise SystemExit('SDK 缺少 platforms/android-34，请先安装对应平台')


def run(cmd, quiet=False):
    if not quiet:
        print('  $', ' '.join(cmd) if isinstance(cmd, list) else cmd)
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.stdout.decode('utf-8', 'replace')
    if p.returncode != 0:
        print(out)
        raise SystemExit('FAILED: %s' % (cmd if isinstance(cmd, str) else cmd[0]))
    if not quiet and out.strip():
        print(out.strip()[:2000])
    return out


def main():
    sdk = find_sdk()
    build_tools = find_build_tools(sdk)
    android_jar = find_platform(sdk)
    keystore = os.environ.get('TILTMAZE_KEYSTORE') or os.path.join(OUT, 'debug.keystore')
    src_html = os.path.join(OUT, 'index.html')

    if not os.path.exists(src_html):
        raise SystemExit('缺少 dist/index.html，请先运行：python tools/assemble.py')

    print('SDK          :', sdk)
    print('build-tools  :', build_tools)
    print('android.jar  :', android_jar)
    print('signing key  :', keystore)

    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(os.path.join(WORK, 'assets'), exist_ok=True)
    os.makedirs(os.path.join(WORK, 'classes'), exist_ok=True)
    os.makedirs(os.path.join(WORK, 'dex'), exist_ok=True)
    os.makedirs(OUT, exist_ok=True)

    # 1) 拷贝游戏本体到 assets
    shutil.copyfile(src_html, os.path.join(WORK, 'assets', 'index.html'))
    print('[1/7] assets/index.html', os.path.getsize(src_html), 'bytes')

    # 2) 编译资源
    res_zip = os.path.join(WORK, 'res.zip')
    run([os.path.join(build_tools, 'aapt2' + EXE), 'compile', '--dir',
         os.path.join(AND, 'res'), '-o', res_zip], quiet=True)
    print('[2/7] res compiled')

    # 3) 链接成基础 APK（含 assets）
    base_apk = os.path.join(WORK, 'base.apk')
    run([os.path.join(build_tools, 'aapt2' + EXE), 'link',
         '-o', base_apk,
         '-I', android_jar,
         '--manifest', os.path.join(AND, 'AndroidManifest.xml'),
         '-R', res_zip,
         '--auto-add-overlay',
         '-A', os.path.join(WORK, 'assets'),
         '--min-sdk-version', '21',
         '--target-sdk-version', '34',
         '--version-code', VERSION_CODE,
         '--version-name', VERSION_NAME], quiet=True)
    print('[3/7] base apk linked', os.path.getsize(base_apk), 'bytes')

    # 4) javac
    java_files = []
    for dirpath, _, files in os.walk(os.path.join(AND, 'src')):
        for f in files:
            if f.endswith('.java'):
                java_files.append(os.path.join(dirpath, f))
    run(['javac', '--release', '11', '-encoding', 'UTF-8',
         '-cp', android_jar, '-d', os.path.join(WORK, 'classes')] + java_files, quiet=True)
    print('[4/7] java compiled', len(java_files), 'files')

    # 5) d8 -> classes.dex
    class_files = []
    for dirpath, _, files in os.walk(os.path.join(WORK, 'classes')):
        for f in files:
            if f.endswith('.class'):
                class_files.append(os.path.join(dirpath, f))
    d8jar = os.path.join(build_tools, 'lib', 'd8.jar')
    run(['java', '-cp', d8jar, 'com.android.tools.r8.D8',
         '--lib', android_jar, '--min-api', '21',
         '--output', os.path.join(WORK, 'dex')] + class_files, quiet=True)
    print('[5/7] dex built', os.path.getsize(os.path.join(WORK, 'dex', 'classes.dex')), 'bytes')

    # 6) 把 classes.dex 塞进 apk
    unsigned = os.path.join(WORK, 'unsigned.apk')
    shutil.copyfile(base_apk, unsigned)
    with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(WORK, 'dex', 'classes.dex'), 'classes.dex')
    print('[6/7] dex injected')

    # 7) zipalign + 签名
    aligned = os.path.join(WORK, 'aligned.apk')
    run([os.path.join(build_tools, 'zipalign' + EXE), '-f', '-p', '4', unsigned, aligned], quiet=True)

    # 签名私钥是本地生成、绝不入库；固定放在 dist/ 下保证覆盖安装时签名一致
    if not os.path.exists(keystore):
        print('[7/7] generating local debug keystore ...')
        run(['keytool', '-genkeypair', '-v', '-keystore', keystore,
             '-alias', 'tiltmaze', '-keyalg', 'RSA', '-keysize', '2048',
             '-validity', '10000', '-storepass', KS_PASS, '-keypass', KS_PASS,
             '-dname', 'CN=TiltMaze, OU=Game, O=TiltMaze, L=CN, S=CN, C=CN'], quiet=True)

    final = os.path.join(OUT, APP_NAME)
    if os.path.exists(final):
        os.remove(final)
    apksigner = os.path.join(build_tools, 'lib', 'apksigner.jar')
    run(['java', '-jar', apksigner, 'sign',
         '--ks', keystore, '--ks-key-alias', 'tiltmaze',
         '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS,
         '--min-sdk-version', '21',
         '--out', final, aligned], quiet=True)
    run(['java', '-jar', apksigner, 'verify', '--min-sdk-version', '21', final], quiet=True)

    print('[7/7] signed OK -> %s  (%.1f KB)' % (final, os.path.getsize(final) / 1024.0))


if __name__ == '__main__':
    main()
