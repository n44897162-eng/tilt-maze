# 滚球迷宫 · Tilt Maze

> 一款**纯单机、零联网**的重力滚球迷宫游戏。倾斜手机，让钢球像在真实迷宫盘上一样被重力拉动。

[![CI](https://github.com/n44897162-eng/tilt-maze/actions/workflows/ci.yml/badge.svg)](https://github.com/n44897162-eng/tilt-maze/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[下载 APK](https://github.com/n44897162-eng/tilt-maze/releases/latest) ·
[在线试玩](https://n44897162-eng.github.io/tilt-maze/) ·
[构建指南](docs/BUILD.md) ·
[体感物理模型](docs/PHYSICS.md)

---

## 这是什么

一个用原生 JavaScript + Canvas 写的重力迷宫游戏，安卓端套了一层极薄的原生 WebView 壳，
专门用来把加速度计数据以最低延迟喂给游戏。没有框架、没有 npm、没有第三方库、
没有网络权限、没有广告、没有数据统计。

设计目标是复刻经典 **HTC Teeter** 的手感：**倾斜多少度，球就受多少力**，
不做「把倾斜归一化成百分比」这类二次加工。

## 主要特性

| | |
|---|---|
| **体感操控** | 原生 `SensorManager` 加速度计桥，最快采样档；纯重力分量驱动，无陀螺仪积分、无运行中零点漂移 |
| **310 关** | 11 章：前 10 关手工教学，后 300 关按难度曲线随机生成；生成后强制校验有解、宝石落点合法 |
| **无限模式** | 持续生成关卡，签名去重表保证不重复，难度 100 层封顶，玩到不想玩为止 |
| **机关** | 冰面、沙地、流沙、熔岩、磁铁、弹跳板、加速带、风扇、移动平台、伸缩墙、压力板、重力区、传送门、迷雾等 |
| **手感可调** | 灵敏度 0.6–3.2、球速 65%–145% 实时生效；水平/纵轴反转；可开关的「跳过本关」 |
| **AI 背景** | 6 张暗调风景，按章节主题 + 关卡种子分配，同章色调统一、逐关有变化 |
| **真·单机** | APK 只申请 `VIBRATE` 一个权限，**完全没有 INTERNET 权限**；存档走 `localStorage` |

## 快速开始

### 方式一：装到安卓手机（推荐）

去 [Releases](https://github.com/n44897162-eng/tilt-maze/releases/latest) 下载 `tilt-maze.apk`，
Android 5.0（API 21）及以上可直接安装。系统提示「未知来源」时允许即可——这是自签名包的正常现象。

> **怎么拿最好的手感**：把手机**平放端在手里**，轻轻倾斜机身。
> 竖着拿手机时，左右倾斜是绕重力轴转动，重力在屏幕平面的投影不变，
> 任何重力控球游戏都不会有反应（详见 [物理模型](docs/PHYSICS.md)）。

### 方式二：浏览器直接玩

打开 [GitHub Pages 在线版](https://n44897162-eng.github.io/tilt-maze/)（仓库维护者首次需在
Settings → Pages → Source 选 **GitHub Actions**，之后 `pages.yml` 会自动部署），或本地构建：

```bash
python tools/assemble.py      # 生成 dist/index.html
```

然后双击 `dist/index.html`。桌面浏览器没有体感时会自动降级为**鼠标拖拽 / 方向键**操控。

### 方式三：自己打 APK

见 [docs/BUILD.md](docs/BUILD.md)，需要 JDK 11+ 和 Android SDK（无需 Gradle）。

## 玩法

- 倾斜手机 → 钢球沿重力分量方向滚动，把球送进绿色洞口
- 沿途收集宝石、避开熔岩与流沙，用时越短星级越高
- **章节解锁**：前面每章各通关 **2/3** 即可解锁下一章（第一章 10 关，所以第二章只需 7 关）
- 设置里打开「显示跳过本关」后，局内出现 ⏭ 按钮；跳过的关记为已通过但不计星，界面留痕
- 右下角 ◎ 可手动重新对零；设置页的**水平仪气泡**实时显示净重力分量，可用来判断传感器是否工作

## 技术架构

```
web/          纯原生 JS 游戏本体（物理、渲染、关卡生成、UI）
  ├─ engine1.js   常量 / 难度曲线 / 关卡生成 / 可解性校验 / 签名去重
  ├─ engine2.js   存档 / 输入层 / 物理步进 / 碰撞 / Canvas 渲染
  ├─ ui.js        页面状态机、设置、章节、HUD
  ├─ body.html + style.css
  ├─ bg-data.js   6 张背景的压缩内联 WebP
  └─ android-bridge.js   安卓原生传感器桥的 JS 侧（网页版自动跳过）

android/      极薄的原生壳（一个 Activity、一个 WebView、零依赖）
  ├─ MainActivity.java   SensorManager → JavascriptInterface；全屏 / 返回键 / 震动
  ├─ AndroidManifest.xml
  └─ res/drawable/ic_launcher.xml

tools/        构建脚本
  ├─ assemble.py    把 web/ 内联成单文件 dist/index.html
  ├─ build_apk.py   aapt2 → javac → d8 → zipalign → apksigner
  └─ make_bg.py     可选：重新处理背景源图
```

几条关键设计：

1. **单文件构建**：所有 JS/CSS/图片内联进一个 HTML，WebView 用 `file://` 直接加载，
   不需要本地服务器，也不发任何网络请求。网页版和 APK 版因此天然同源。
2. **原生传感器桥**：WebView 的 `deviceorientation` 在安卓上采样率和延迟都不可控，
   所以由 Java 侧 `SENSOR_DELAY_FASTEST` 读加速度计，JS 每帧主动拉取三个归一化重力分量。
3. **固定步长物理**：120 Hz 物理步进 + `requestAnimationFrame` 渲染，中间做速度外推插值。
4. **关卡可解性**：BFS 求最短路，校验主路径无熔岩、压力板必须先于其控制的门；
   生成失败则换种子重试。固定教学关不参与全局去重，靠唯一难度值天然区分，保证重玩同一关地图不变。

## 体感物理模型

这是项目最花心思的部分。核心只有一条式子：

```
球的加速度 = 重力在屏幕平面的分量 × GRAV_GAME(26) × (灵敏度 / 1.8)
```

中间**没有** `atan2`、正弦饱和、非线性曲线、角度积分或运行中校准。
与经典 Teeter 一样**只用加速度计**，不用陀螺仪——因为陀螺仪积分会漂移，
两套姿态参考系混用会让球发抖、迟滞。

| 参数 | 值 | 作用 |
|---|---|---|
| `GRAV_GAME` | 26 格/s² | 1g 对应的游戏加速度，想要更猛就调它 |
| `TILT_DZ` | 0.004 (≈0.23°) | 死区，只滤静止噪声 |
| `DAMP` / `ROLL` | 0.28 / 0.06 | 速度阻尼与滚动摩擦 |
| 输入低通 | 18 ms | 只压传感器噪声，不牺牲跟手 |
| `WFRIC` | 0.05 | 墙面切向摩擦，**只在真正撞击时扣一次**（每帧扣会造成「吸附感」） |
| 反向制动 | ×1.6 / 阻尼 ×1.8 | 玩家反向拉球时加成，顺向完全不介入 |

按当前参数计算：10° → 4.5、20° → 8.9、30° → 13.0（格/s²），与重力分量严格成正比；
该线性关系与零跳变已在浏览器逐帧倾斜、模拟器注入加速度计的连续轨迹测试中验证。
15° 倾斜 300 ms 内球速约 2 格/秒，反向换向约 150 ms。

更详细的推导、六个踩过的坑（含 Android 加速度计 x 轴与 `deviceorientation.gamma` 符号相反）
写在 [docs/PHYSICS.md](docs/PHYSICS.md)。

## 构建

```bash
python tools/assemble.py      # → dist/index.html
python tools/build_apk.py     # → dist/tilt-maze.apk
```

环境要求、SDK 版本选择、签名说明见 [docs/BUILD.md](docs/BUILD.md)。
`dist/` 与本地生成的 `debug.keystore` 都不入库；签名私钥**绝不上传**。

## 已知限制

- 游戏锁定竖屏；为兼容旧版 WebView（Chromium 83）刻意避开了 `inset` 简写和 flex `gap`
- 背景为 AI 生成图，原始高分辨率素材未随仓库分发，成品已内联在 `web/bg-data.js`
- 自签名 APK 不能上架应用商店；用于正式分发请换成自己的 keystore
- 桌面浏览器只能拖拽/键盘操控（无重力传感器时使用）

## 素材与授权

- **代码**：[MIT](LICENSE)，可自由使用、修改、商用。
- **背景图**：6 张暗调风景由 AI 图像生成工具产出，经裁切、去水印、降饱和、亮度归一化后压缩内联。
  作者对本项目中可主张权利的部分按 MIT 许可提供；AI 生成内容的版权归属在各地法律下可能不同，
  商用前请自行确认所在司法辖区的规定。
- 无第三方图标、无外部字体、无网络资源；所有资源都在仓库内或随系统提供。

## 贡献

欢迎提 Issue 和 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
调手感时建议先读 [docs/PHYSICS.md](docs/PHYSICS.md)——很多「手感不对」其实是零点或坐标系问题，不是数值问题。
