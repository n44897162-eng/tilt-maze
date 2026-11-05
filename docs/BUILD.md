# 构建指南

整个项目没有 Gradle、没有 npm、没有第三方依赖。两条命令就能从源码产出网页版和 APK。

## 环境要求

| 依赖 | 版本 | 用途 |
|---|---|---|
| Python | 3.8+ | 三个构建脚本 |
| JDK | 11+ | `javac`、`d8`、`keytool`、`apksigner` |
| Android SDK | platform `android-34` | `android.jar` |
| Android build-tools | **36.1.0+** | `aapt2`、`d8.jar`、`zipalign`、`apksigner.jar` |
| Pillow | 任意近年版本 | **仅**在重新生成背景图时需要（`pip install Pillow`） |

> ⚠️ **为什么必须 build-tools 36.1.0+**：34.0.0 附带的 R8 8.2.2 在 JDK 22 上执行 `d8` 会抛
> 空指针崩溃。脚本会自动挑选 36.1.0；若本机只有旧版，会打印警告但仍尝试构建。
>
> ⚠️ **Android SDK 位置**：脚本依次检查 `ANDROID_HOME` → `ANDROID_SDK_ROOT` → 常见默认路径。
> 建议显式设置：
> ```bash
> export ANDROID_HOME=/path/to/Android/Sdk      # macOS / Linux
> $env:ANDROID_HOME = "F:\Android\Sdk"          # PowerShell
> ```

## 构建

```bash
# 1) 把 web/ 内联成单文件网页版
python tools/assemble.py
# → dist/index.html   （双击即可玩，也是 APK 的 assets）

# 2) 打安卓包
python tools/build_apk.py
# → dist/tilt-maze.apk
```

脚本都基于**自身所在位置**推算项目根目录，因此可以在任意工作目录下调用。
第二步会检查 `dist/index.html` 是否存在，缺失时提示先跑第一步。

### 可用环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | 自动探测 | Android SDK 根目录 |
| `TILTMAZE_KEYSTORE` | `dist/debug.keystore` | 自定义签名库路径 |
| `TILTMAZE_KS_PASS` | `tiltmaze` | 签名库口令 |

## 打包流程（build_apk.py 做了什么）

1. 把 `dist/index.html` 复制为 `assets/index.html`
2. `aapt2 compile` 编译 `android/res/`
3. `aapt2 link` 链接 manifest + 资源 + assets，生成基础 APK（minSdk 21 / targetSdk 34）
4. `javac --release 11` 编译 `MainActivity.java`
5. `d8` 把 class 转成 `classes.dex`
6. 把 dex 追加进 APK
7. `zipalign` 对齐 → `apksigner` 用本地 keystore 签名并校验

中间产物在 `.apkbuild/`，每次构建自动清空；它和 `dist/` 都在 `.gitignore` 里。

## 关于签名私钥

**仓库里不含任何私钥。** 首次构建时脚本会在 `dist/debug.keystore` 自动生成一个
本地 debug keystore（口令默认 `tiltmaze`）。它不入库，但会**保留在本机**，
这样重复构建出的 APK 签名一致，可以覆盖安装而不会报「签名冲突」。

如果删除了 `dist/`，下一次构建会生成新密钥，旧版需要卸载后重装。

这个 debug 密钥**只适合本地自测**，不要用于正式分发。对外发布请用正式密钥：

```bash
export TILTMAZE_KEYSTORE=/secure/path/release.jks
export TILTMAZE_KS_PASS='your-strong-password'
python tools/build_apk.py
```

（注意脚本里 alias 固定为 `tiltmaze`，自定义 keystore 需要同名 alias，或自行调整脚本。）

## 为什么不用 Gradle

这个应用只有一个 Activity、一个 WebView、零第三方依赖。引入 Gradle 会带来数百 MB 的
依赖与构建缓存，还会把「APK 里到底装了什么」藏进插件内部。手工调用 SDK 命令行几秒钟完成，
并且每一步都可见、可复现。代价是没有 Gradle 生态的自动依赖管理——本项目本来也不需要。

## 调试

### 网页版

`dist/index.html` 是单文件，直接用 Chrome DevTools 打开即可。全局对象 `Game`、`Input`、
`Render`、`UI`、`Save` 都挂在 `window` 上，可在 Console 里直接检查：

```js
Input.mode                 // 'gyro' | 'drag'
Input.ax, Input.ay         // 当前加速度
Save.d.settings            // 当前设置
generateLevel(42)          // 查看任意关卡数据
```

### 安卓 WebView

把 `android/AndroidManifest.xml` 的 `android:debuggable` 临时改成 `true` 并重新打包，
`MainActivity` 会自动启用 `WebView.setWebContentsDebuggingEnabled(true)`（正式包自动关闭）。然后：

```bash
adb shell cat /proc/net/unix | grep webview_devtools_remote
adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
# 浏览器打开 http://127.0.0.1:9223/json 获取调试目标
```

无头模拟器的 `screencap` 抓不到 WebView 合成层，需要用 CDP 的 `Page.captureScreenshot` 才能拿到真实画面。

### 模拟体感输入

```bash
adb emu sensor set acceleration 4.9:0:8.49    # 约 30° 倾斜
adb emu sensor set acceleration 0:0:9.8       # 平放
```

## 兼容性备注

- 目标包含较老的安卓机，其 WebView 可能是 **Chromium 83**：不支持 `inset` 简写，也不支持 flex `gap`。
  CSS 一律用 `top/right/bottom/left` 四向定位和相邻兄弟 `margin`，否则 `#ui` 会塌成 0 高度、整屏黑。
- `getWindow().getInsetsController()` 必须在 `setContentView()` **之后**调用，否则 DecorView 尚未创建会 NPE。
- `addJavascriptInterface` 注入的方法**必须通过注入对象调用**（`window.NativeTilt.tilt()`），
  把方法引用抠出来单独调用会抛 "Java bridge method can't be invoked on a non-injected object"。

## 常见错误

| 现象 | 原因 / 处理 |
|---|---|
| `缺少 dist/index.html` | 先跑 `python tools/assemble.py` |
| `FAILED: java -cp ...D8` | build-tools 太旧，装 36.1.0+ |
| 覆盖安装报签名不一致 | `dist/debug.keystore` 被删过，卸载旧版重装 |
| 安装后整屏黑 | WebView 版本过老的 CSS 兼容问题，见上节 |
| 陀螺仪完全没反应 | 先到设置页看水平仪气泡；气泡不动是权限/机型读不到传感器，不是物理层问题 |
