/* ===================================================================
   安卓原生桥：传感器 / 返回键 / 生命周期
   —— 只在 APK 内生效，浏览器版自动跳过
   =================================================================== */
(function () {
  if (!window.NativeTilt) return;

  var hasSensor = false;
  try { hasSensor = !!window.NativeTilt.hasSensor(); } catch (e) { hasSensor = false; }

  /* JS 每帧主动拉取最新姿态，避免原生 → JS 的高频回调开销。
     返回 [gx, gy, gz]：重力在设备坐标系里的归一化分量，1.0 = 1g。
     这就是 Teeter 用的全部输入，没有角度换算、没有陀螺仪积分。 */
  function setup() {
    if (hasSensor) {
      Input.nativeGet = function () {
        var s;
        try { s = window.NativeTilt.tilt(); } catch (e) { return null; }
        if (!s) return null;
        var p = s.split(',');
        if (p.length < 3) return null;
        var a = parseFloat(p[0]), b = parseFloat(p[1]), c = parseFloat(p[2]);
        if (isNaN(a) || isNaN(b) || isNaN(c)) return null;
        return [a, b, c];
      };
      Input.hasGyro = true;
      Input.hasReading = false;
      Input.applyMode(true);
    }
  }
  /* 等 boot() 跑完（存档已加载）再接管输入模式 */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();

  /* 返回键：局内返回 = 暂停 / 继续；菜单里逐级退回；标题页才真正退出 */
  window.onAndroidBack = function () {
    var st = Game.state;
    if (st === 'playing' || st === 'dying' || st === 'ready') { UI.pause(); return true; }
    if (st === 'paused') { UI.resume(); return true; }
    if (!document.getElementById('panel-result').classList.contains('hide')) {
      UI.reallyStart(UI.endlessN || UI.curId, UI.endlessN || 0);
      return true;
    }
    if (!document.getElementById('panel-pause').classList.contains('hide')) { UI.resume(); return true; }
    if (!document.getElementById('screen-title').classList.contains('hide')) return false;
    UI.show('title');
    return true;
  };

  /* 切后台：暂停并静音 */
  window.__nativePause = function () {
    if (Game.state === 'playing') UI.pause();
  };
  window.__nativeResume = function () {
    if (Snd.ctx && Snd.ctx.state === 'suspended') Snd.ctx.resume();
  };

  /* 震动优先走原生（WebView 的 navigator.vibrate 不一定可用） */
  if (window.NativeApp && window.NativeApp.vibrate) {
    window.nativeVibrate = function (ms) {
      try { window.NativeApp.vibrate(ms); } catch (e) { }
    };
  }
})();
