/* ===================================================================
   引擎第二部分：存档 / 音效 / 输入 / 物理 / 渲染 / 主循环
   =================================================================== */

/* ---------- 存档 ---------- */
var SAVE_KEY = 'tiltmaze.save.v2';
var Save = {
  d: null,
  def: function () {
    return {
      stars: {}, best: {}, gems: {}, skip: {}, skin: 0,
      settings: {
        sens: 1.8, speed: 1, ctrl: 'auto', invertX: false, invertY: false,
        sound: true, haptic: true, reduce: false, allowSkip: false
      },
      endless: 0,          /* 无限模式已达最高关 */
      endlessBest: 0,      /* 无限模式最远记录 */
      last: 1
    };
  },
  load: function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      this.d = raw ? JSON.parse(raw) : this.def();
    } catch (e) { this.d = this.def(); }
    if (!this.d || !this.d.stars || typeof this.d.stars !== 'object') this.d = this.def();
    var base = this.def();
    if (!this.d.settings) this.d.settings = base.settings;
    for (var k in base.settings) {
      if (this.d.settings[k] === undefined) this.d.settings[k] = base.settings[k];
    }
    if (!this.d.skip) this.d.skip = {};
    if (this.d.endless === undefined) this.d.endless = 0;
    if (this.d.endlessBest === undefined) this.d.endlessBest = 0;
    return this.d;
  },
  flush: function () {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.d)); } catch (e) { }
  },
  starsOf: function (id) { return this.d.stars[id] || 0; },
  cleared: function (id) { return !!(this.d.stars[id] || this.d.skip[id]); },
  total: function () {
    var s = 0; for (var k in this.d.stars) s += this.d.stars[k] || 0; return s;
  },
  clearedTotal: function () {
    var n = 0;
    for (var i = 1; i <= TOTAL_LEVELS; i++) if (this.cleared(i)) n++;
    return n;
  },
  chapRange: function (ch) {
    if (ch <= 1) return [1, TUT_N];
    var a = firstLevelOf(ch);
    return [a, a + CHAPTERS[ch - 1].n - 1];
  },
  chapStars: function (ch) {
    var r = this.chapRange(ch), s = 0;
    for (var i = r[0]; i <= r[1]; i++) s += this.d.stars[i] || 0;
    return s;
  },
  chapCleared: function (ch) {
    var r = this.chapRange(ch), n = 0;
    for (var i = r[0]; i <= r[1]; i++) if (this.cleared(i)) n++;
    return n;
  },
  chapMaxStars: function (ch) { return CHAPTERS[ch - 1].n * 3; },
  /* 章节按顺序解锁：上一章通关 15 关即可进下一章（跳过也计入，避免卡死） */
  /* 解锁下一章：前面每章各通关 2/3 即可。按各章真实关数算，
     第一章只有 10 关，所以第二章只需 7 关而不是老的 15 关。 */
  chapNeed: function (ch) {
    var need = 0;
    for (var i = 1; i < ch; i++) {
      var c = CHAPTERS[i - 1];
      need += Math.ceil((c ? c.n : 30) * 2 / 3);
    }
    return need;
  },
  unlockedChap: function (ch) {
    if (ch <= 1) return true;
    return this.clearedTotal() >= this.chapNeed(ch);
  },
  nextPlayable: function () {
    for (var i = 1; i <= TOTAL_LEVELS; i++) if (!this.cleared(i)) return i;
    return TOTAL_LEVELS;
  },
  levelUnlocked: function (id) {
    if (id === 1) return true;
    if (!this.unlockedChap(chapterOf(id))) return false;
    return this.cleared(id - 1) || this.cleared(id);
  },
  /* 跳过本关：记为已通过但不给星 */
  markSkip: function (id) {
    this.d.skip[id] = 1;
    this.flush();
  }
};

/* ---------- 球皮肤（每 30 ★ 解锁一套，10 套基底 + 2 套） ---------- */
var SKINS = [
  { n: '铬钢', hi: '#FFFFFF', mid: '#D3DAE0', dark: '#4D565C' },
  { n: '玻璃', hi: '#FFFFFF', mid: '#BFD8E4', dark: '#3E5560' },
  { n: '木球', hi: '#F7E3C0', mid: '#C08B4E', dark: '#5C3A18' },
  { n: '星空', hi: '#EAF1FF', mid: '#6C7FA8', dark: '#161B2E' },
  { n: '熔岩', hi: '#FFD9A0', mid: '#E2603A', dark: '#3A1208' },
  { n: '青铜', hi: '#FFE9B8', mid: '#B98B4A', dark: '#43301A' },
  { n: '陶瓷', hi: '#FFFFFF', mid: '#EDE6DC', dark: '#6B6257' },
  { n: '翡翠', hi: '#DCFFE8', mid: '#4FBF87', dark: '#123B2A' },
  { n: '紫晶', hi: '#F2E8FF', mid: '#9B7BD4', dark: '#2A1B44' },
  { n: '赤铜', hi: '#FFDCC8', mid: '#C97A5A', dark: '#3B1A10' },
  { n: '霜银', hi: '#FFFFFF', mid: '#DDE9EF', dark: '#54646C' },
  { n: '熔金', hi: '#FFF6D0', mid: '#E8B44A', dark: '#4A3210' }
];
function skinUnlocked(i) { return Save.total() >= i * 30; }

/* ---------- 音效（WebAudio 合成，无外部资源） ---------- */
var Snd = {
  ctx: null, master: null, rollG: null, rollF: null, rollOn: false, ready: false,
  init: function () {
    if (this.ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      /* 滚动噪声 */
      var len = this.ctx.sampleRate * 1.2;
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var dat = buf.getChannelData(0);
      for (var i = 0; i < len; i++) dat[i] = (Math.random() * 2 - 1) * 0.55;
      var src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 0.9;
      var g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start();
      this.rollG = g; this.rollF = flt;
      this.ready = true;
    } catch (e) { }
  },
  resume: function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  on: function () { return Save.d && Save.d.settings.sound; },
  roll: function (speed, ice) {
    if (!this.ready || !this.on()) { if (this.rollG) this.rollG.gain.value = 0; return; }
    var v = clamp(speed / VMAX, 0, 1);
    var target = ice ? 0 : (0.006 + v * 0.085);
    this.rollG.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
    this.rollF.frequency.setTargetAtTime(300 + v * 900, this.ctx.currentTime, 0.08);
  },
  hit: function (power) {
    if (!this.ready || !this.on()) return;
    var c = this.ctx, t = c.currentTime;
    var dur = 0.05 + power * 0.05;
    var b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    var s = c.createBufferSource(); s.buffer = b;
    var f = c.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = 260 + power * 420; f.Q.value = 1.4;
    var g = c.createGain(); g.gain.value = 0.25 + power * 0.55;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  tone: function (freq, dur, type, vol, delay, slideTo) {
    if (!this.ready || !this.on()) return;
    var c = this.ctx, t = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  gem: function () { this.tone(880, .12, 'sine', .18, 0); this.tone(1320, .14, 'sine', .14, .07); this.tone(1760, .18, 'sine', .1, .14); },
  hole: function () {
    this.tone(200, .18, 'sine', .28, 0, 90);
    this.tone(523, .22, 'triangle', .2, .16);
    this.tone(784, .3, 'triangle', .16, .26);
    this.tone(1047, .42, 'triangle', .12, .36);
  },
  die: function () {
    if (!this.ready || !this.on()) return;
    this.tone(160, .18, 'sawtooth', .16, 0, 60);
    this.tone(96, .24, 'square', .1, .05, 42);
  },
  ui: function () { this.tone(660, .07, 'square', .05, 0); },
  star: function (i) { this.tone(784 + i * 220, .18, 'triangle', .2, 0); }
};
function haptic(ms, amp) {
  if (!Save.d.settings.haptic) return;
  if (window.nativeVibrate) { window.nativeVibrate(ms); return; }
  if (!navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch (e) { }
}

/* ---------- 输入（指导书 2.2.1 / 2.2.5） ---------- */
var Input = {
  mode: 'drag', ax: 0, ay: 0, tiltX: 0, tiltY: 0,
  hasGyro: false, permAsked: false,
  nativeGet: null,
  gx: 0, gy: 0, gz: 1,                 /* 归一化重力：1.0 = 1g */
  rawG: 0, rawB: 0, sG: 0, sB: 0,     /* rawG 左右、rawB 前后；s* 为低通后的值 */
  baseG: 0, baseB: 0, hasReading: false,

  /* 开场握姿学习：球还没开始动的那一秒里，把用户当前握姿平均成"水平面"。
     和 Teeter 一样是绝对重力参考系，只是允许玩家竖着/斜着拿，不必非得放平。
     关键是学完之后就冻结，游戏过程中再也不动零点。 */
  learning: false, learnN: 0, learnG: 0, learnB: 0, pendingCal: false,

  drag: { on: false, ax: 0, ay: 0, cx: 0, cy: 0, x: 0, y: 0 },
  keys: {},

  init: function () {
    var self = this;
    window.addEventListener('deviceorientation', function (e) {
      if (self.nativeGet) return;
      if (e.beta === null || e.beta === undefined) return;
      var b = clamp(e.beta, -90, 90), g = clamp(e.gamma || 0, -90, 90);
      var sb = Math.sin(b * Math.PI / 180), sg = Math.sin(g * Math.PI / 180);
      if (!self.hasReading) { self.sB = sb; self.sG = sg; }
      self.rawB = sb; self.rawG = sg; self.gz = Math.cos(b * Math.PI / 180);
      self.hasReading = true; self.hasGyro = true;
      if (self.pendingCal) { self.pendingCal = false; self.doCalibrate(); }
    }, true);
    window.addEventListener('keydown', function (e) {
      self.keys[e.key.toLowerCase()] = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
    this.bindDrag();
  },

  requestPermission: function () {
    var self = this;
    if (this.nativeGet) return Promise.resolve(true);
    if (this.permAsked) return Promise.resolve(this.hasGyro);
    this.permAsked = true;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      return DeviceOrientationEvent.requestPermission().then(function (r) {
        self.applyMode(r === 'granted');
        return r === 'granted';
      }).catch(function () { self.applyMode(false); return false; });
    }
    return new Promise(function (res) {
      setTimeout(function () { self.applyMode(self.hasGyro); res(self.hasGyro); }, 260);
    });
  },

  /* 开场学习：只在 ready 阶段采样，start 时定稿。
     重要：左右轴绝不学习——那是玩家的主要控制输入，学掉会造成"往这边倾没反应"。
     只补偿明显竖持(|gy|>0.55)时前后方向的静态重力，避免球一开局就贴底。 */
  beginLearn: function () { this.learning = true; this.learnN = 0; this.learnG = 0; this.learnB = 0; },
  endLearn: function () {
    this.learning = false;
    var bb = this.learnN > 8 ? this.learnB / this.learnN : 0;
    this.baseG = 0;
    this.baseB = Math.abs(bb) > 0.55 ? bb : 0;
    this.sG = 0; this.sB = this.baseB;
  },
  calibrate: function () {
    if (!this.hasReading) { this.pendingCal = true; return false; }
    this.doCalibrate();
    return true;
  },
  doCalibrate: function () {
    this.baseG = this.rawG; this.baseB = this.rawB;
    this.sG = this.rawG; this.sB = this.rawB;
  },

  applyMode: function (gyroOK) {
    if (!Save.d) return;
    var s = Save.d.settings.ctrl;
    if (s === 'drag') this.mode = 'drag';
    else if (s === 'gyro') this.mode = gyroOK ? 'gyro' : 'drag';
    else this.mode = gyroOK ? 'gyro' : 'drag';
  },

  bindDrag: function () {
    var self = this, cv = document.getElementById('stage');
    function setFrom(ev) {
      var r = cv.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var y = (ev.touches ? ev.touches[0].clientY : ev.clientY) - r.top;
      var dx = (x - self.drag.cx) / 78, dy = (y - self.drag.cy) / 78;
      var m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      self.drag.ax = dx; self.drag.ay = dy;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (self.mode !== 'drag') return;
      self.drag.on = true; self.drag.cx = e.clientX - cv.getBoundingClientRect().left;
      self.drag.cy = e.clientY - cv.getBoundingClientRect().top;
      self.drag.ax = 0; self.drag.ay = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    });
    cv.addEventListener('pointermove', function (e) { if (self.drag.on) setFrom(e); });
    cv.addEventListener('pointerup', function () { self.drag.on = false; self.drag.ax = 0; self.drag.ay = 0; });
    cv.addEventListener('pointercancel', function () { self.drag.on = false; self.drag.ax = 0; self.drag.ay = 0; });
  },

  update: function (dt) {
    /* 安卓原生桥：只有三个数，重力分量 */
    if (this.nativeGet) {
      var nv = this.nativeGet();
      if (nv) {
        this.gx = nv[0]; this.gy = nv[1]; this.gz = nv[2];
        /* 关键：Android 加速度计的 x 轴符号与 DeviceOrientationEvent.gamma 相反。
           设备右倾（右边低）时加速度计 x 为负、gamma 为正。
           这里统一取反成"右倾为正"，与浏览器路径、和玩家直觉一致。 */
        this.rawG = -nv[0];
        this.rawB = nv[1];
        if (!this.hasReading) { this.sG = nv[0]; this.sB = nv[1]; }
        if (this.pendingCal) { this.pendingCal = false; this.doCalibrate(); }
        this.hasReading = true; this.hasGyro = true;
      }
    }
    if (this.learning && this.hasReading) {
      this.learnN++;
      this.learnG += this.rawG; this.learnB += this.rawB;
    }

    var K = Save.d.settings.sens;
    if (this.mode === 'gyro' && this.hasReading) {
      /* 18ms 低通：只用来压住加速度计噪声，绝不做角度积分或零点漂移 */
      var a = 1 - Math.exp(-dt / 0.018);
      this.sG = lerp(this.sG, this.rawG, a);
      this.sB = lerp(this.sB, this.rawB, a);
      var rg = this.sG - this.baseG, rb = this.sB - this.baseB;
      if (Save.d.settings.invertX) rg = -rg;   /* 少数机型/横握时可手动翻转 */
      if (Save.d.settings.invertY) rb = -rb;

      var mag = Math.hypot(rg, rb);
      if (mag < TILT_DZ) { this.ax = 0; this.ay = 0; this.tiltX = 0; this.tiltY = 0; return; }

      /* Teeter 的核心：重力在迷宫盘平面上的分量，直接就是球的加速度。
         倾斜多少就受多少力，方向就是球滚动的方向。 */
      var acc = mag * GRAV_GAME * (K / 1.8);
      this.ax = rg / mag * acc;
      this.ay = rb / mag * acc;
      this.tiltX = rg; this.tiltY = rb;
      return;
    }
    if (this.mode === 'gyro') { this.ax = 0; this.ay = 0; return; }

    /* 拖拽 / 键盘（桌面或体感不可用时的退路） */
    if (this.drag.on) {
      this.ax = this.drag.ax * ACC_MAX; this.ay = this.drag.ay * ACC_MAX;
      this.tiltX = this.drag.ax; this.tiltY = this.drag.ay;
    } else {
      var kx = 0, ky = 0;
      if (this.keys['arrowleft'] || this.keys['a']) kx -= 1;
      if (this.keys['arrowright'] || this.keys['d']) kx += 1;
      if (this.keys['arrowup'] || this.keys['w']) ky -= 1;
      if (this.keys['arrowdown'] || this.keys['s']) ky += 1;
      if (kx || ky) {
        var m2 = Math.hypot(kx, ky);
        this.ax = kx / m2 * ACC_MAX; this.ay = ky / m2 * ACC_MAX;
        this.tiltX = kx / m2; this.tiltY = ky / m2;
      } else { this.ax = 0; this.ay = 0; this.tiltX *= 0.9; this.tiltY *= 0.9; }
    }
  }
};

/* ---------- 渲染 ---------- */
var Render = {
  cv: null, ctx: null, layer: null, lctx: null,
  W: 0, H: 0, dpr: 1, cell: 30, ox: 0, oy: 0,
  shake: 0, bgSeed: null, dots: null, anim: 0,
  init: function () {
    this.cv = document.getElementById('stage');
    this.ctx = this.cv.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.bgImgs = [];
    this.bgLoaded = false;
    this.loadBackdrops();
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { self.resize(); }, 220); });
  },

  /* AI 背景图预加载：只有 6 张、共几十 KB，一次全解出来 */
  loadBackdrops: function () {
    this.bgImgs = [];
    this.bgLoaded = false;
    if (typeof BG_DATA === 'undefined' || !BG_DATA.length) return;
    var self = this, left = BG_DATA.length;
    function done() {
      left--;
      if (left <= 0) {
        self.bgLoaded = true;
        if (Game.level) self.buildStatic();
        if (!self.titleBg) self.pickTitleBg();
      }
    }
    for (var i = 0; i < BG_DATA.length; i++) {
      var im = new Image();
      im.onload = done;
      im.onerror = done;
      im.src = BG_DATA[i];
      this.bgImgs.push(im);
    }
  },

  /* 把背景图按 cover 铺满 + 压暗，预生成一张离屏图（每关只做一次） */
  makeBg: function (img, variant) {
    var W = this.cv.width, H = this.cv.height;
    if (!W || !H) return null;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    var ir = img.width / img.height, cr = W / H;
    var dw, dh, dx, dy;
    var vx = ((variant * 37) % 100) / 100, vy = ((variant * 61) % 100) / 100;
    if (ir > cr) {
      dh = H; dw = H * ir;
      dx = -(dw - W) * (0.25 + 0.5 * vx); dy = 0;
    } else {
      dw = W; dh = W / ir;
      dx = 0; dy = -(dh - H) * (0.2 + 0.55 * vy);
    }
    g.drawImage(img, dx, dy, dw, dh);
    /* 整体压暗，保证前景迷宫始终是视觉主体 */
    g.fillStyle = 'rgba(7,9,11,0.12)';
    g.fillRect(0, 0, W, H);
    /* 上下再压一层，照顾 HUD 与底部按钮的可读性 */
    var lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(6,8,9,.34)');
    lg.addColorStop(0.38, 'rgba(6,8,9,.02)');
    lg.addColorStop(1, 'rgba(6,8,9,.55)');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    return c;
  },

  /* 标题页背景：每次回主菜单随机换一张 */
  pickTitleBg: function () {
    if (!this.bgImgs || !this.bgImgs.length) return;
    var ready = [];
    for (var i = 0; i < this.bgImgs.length; i++) {
      var im = this.bgImgs[i];
      if (im.complete && im.naturalWidth) ready.push(i);
    }
    if (!ready.length) return;
    var idx = ready[Math.floor(Math.random() * ready.length)];
    this.titleBg = this.makeBg(this.bgImgs[idx], Math.floor(Math.random() * 200));
  },
  resize: function () {
    /* 上限压到 1.5：整屏 canvas 在 2.5 倍下像素量翻 2.8 倍，
       低端机会明显掉帧；1.5 倍在手机上看不出差别但帧率稳得多 */
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.layer.width = this.cv.width; this.layer.height = this.cv.height;
    this.vig = null; this._bgCache = null; this._bgKey = null; this.titleBg = null;
    this.measure();
    if (Game.level) this.buildStatic();
  },

  /* 暗角预渲染：原来是每帧 createRadialGradient + 全屏填充，代价很高 */
  buildVignette: function () {
    var c = document.createElement('canvas');
    c.width = this.cv.width; c.height = this.cv.height;
    var v = c.getContext('2d');
    v.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var W = this.W, H = this.H;
    var vg = v.createRadialGradient(W / 2, H * 0.46, H * 0.30, W / 2, H * 0.5, H * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,.62)');
    v.fillStyle = vg;
    v.fillRect(0, 0, W, H);
    this.vig = c;
  },
  measure: function () {
    var L = Game.level;
    if (!L) return;
    var topPad = 84, botPad = 74;
    var availW = this.W - 46, availH = this.H - topPad - botPad;
    var c = Math.min(availW / L.cols, availH / L.rows, 46);
    this.cell = c;
    this.ox = (this.W - L.cols * c) / 2;
    this.oy = topPad + (availH - L.rows * c) / 2;
  },
  X: function (v) { return this.ox + v * this.cell; },
  Y: function (v) { return this.oy + v * this.cell; },

  buildStatic: function () {
    var L = Game.level, c = this.cell, s = this.lctx, dpr = this.dpr;
    var W = this.W, H = this.H;
    this.lavaList = null; this.quickList = null;
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.clearRect(0, 0, W, H);
    /* 背景：优先用 AI 风景图，缺图时退回渐变 */
    var bgIdx = bgForLevel(L);
    var bgImg = (bgIdx >= 0 && this.bgImgs) ? this.bgImgs[bgIdx] : null;
    var bgKey = (L.id || 0) + ':' + (L.endless || 0) + ':' + bgIdx;
    if (bgImg && bgImg.complete && bgImg.naturalWidth) {
      if (!this._bgCache || this._bgKey !== bgKey) {
        this._bgCache = this.makeBg(bgImg, (L.id || 0) + (L.endless || 0) * 13);
        this._bgKey = bgKey;
      }
      if (this._bgCache) {
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.drawImage(this._bgCache, 0, 0);
        s.setTransform(dpr, 0, 0, dpr, 0, 0);
        var bgG = s.createRadialGradient(W / 2, H * 0.10, 0, W / 2, H * 0.55, H * 0.95);
        bgG.addColorStop(0, 'rgba(10,12,14,.06)');
        bgG.addColorStop(1, 'rgba(5,7,8,.24)');
        s.fillStyle = bgG; s.fillRect(0, 0, W, H);
      }
    } else {
      var bg = s.createRadialGradient(W / 2, H * 0.08, 0, W / 2, H * 0.5, H * 0.85);
      bg.addColorStop(0, '#151A1D'); bg.addColorStop(1, '#07090A');
      s.fillStyle = bg; s.fillRect(0, 0, W, H);
    }

    var bx = this.ox, by = this.oy, bw = L.cols * c, bh = L.rows * c;
    var plate = CHAPTERS[L.ch - 1].plate;

    /* 板子 */
    s.save();
    s.globalAlpha = 0.80;                    /* 底板略透，背后风景可见 */
    s.shadowColor = 'rgba(0,0,0,.8)'; s.shadowBlur = 34; s.shadowOffsetY = 14;
    roundRect(s, bx, by, bw, bh, 9);
    var pg = s.createLinearGradient(bx, by, bx + bw, by + bh);
    pg.addColorStop(0, shade(plate, 1.14));
    pg.addColorStop(0.45, plate);
    pg.addColorStop(1, shade(plate, 0.82));
    s.fillStyle = pg; s.fill();
    s.restore();

    /* 拉丝 */
    s.save();
    roundRect(s, bx, by, bw, bh, 9); s.clip();
    var rr = mulberry32(L.id * 7919 + 13);
    for (var ly = by; ly < by + bh; ly += 2) {
      s.fillStyle = 'rgba(255,255,255,' + (0.008 + rr() * 0.022).toFixed(3) + ')';
      s.fillRect(bx, ly, bw, 0.6);
    }
    for (var ly2 = by; ly2 < by + bh; ly2 += 3) {
      s.fillStyle = 'rgba(0,0,0,' + (0.01 + rr() * 0.02).toFixed(3) + ')';
      s.fillRect(bx, ly2 + 1, bw, 0.5);
    }
    s.restore();

    /* 板内投影 */
    s.save();
    roundRect(s, bx + 1, by + 1, bw - 2, bh - 2, 8);
    s.strokeStyle = 'rgba(0,0,0,.55)'; s.lineWidth = 2; s.stroke();
    s.restore();

    /* 格线 */
    s.save();
    s.strokeStyle = 'rgba(255,255,255,.022)'; s.lineWidth = 1;
    for (var gx = 1; gx < L.cols; gx++) {
      s.beginPath(); s.moveTo(bx + gx * c + .5, by); s.lineTo(bx + gx * c + .5, by + bh); s.stroke();
    }
    for (var gy = 1; gy < L.rows; gy++) {
      s.beginPath(); s.moveTo(bx, by + gy * c + .5); s.lineTo(bx + bw, by + gy * c + .5); s.stroke();
    }
    s.restore();

    /* 地形块 */
    for (var y = 0; y < L.rows; y++) for (var x = 0; x < L.cols; x++) {
      var i = y * L.cols + x, t = L.tiles[i];
      if (!t || L.grid[i] === 1) continue;
      drawTile(s, x, y, t, c, bx, by, L);
    }

    /* 墙体（带投影） */
    s.save();
    s.shadowColor = 'rgba(0,0,0,.62)';
    s.shadowBlur = c * 0.20;
    s.shadowOffsetX = c * 0.07;
    s.shadowOffsetY = c * 0.11;
    s.fillStyle = '#565C60';
    for (var y2 = 0; y2 < L.rows; y2++) for (var x2 = 0; x2 < L.cols; x2++) {
      if (L.grid[y2 * L.cols + x2] === 1) s.fillRect(bx + x2 * c, by + y2 * c, c + 0.6, c + 0.6);
    }
    s.restore();

    /* 墙体三段：顶边高光 / 下沿侧面 / 左暗右亮 */
    var sideT = Math.min(c * 0.24, 6.5);
    for (var y3 = 0; y3 < L.rows; y3++) for (var x3 = 0; x3 < L.cols; x3++) {
      if (L.grid[y3 * L.cols + x3] !== 1) continue;
      var px = bx + x3 * c, py = by + y3 * c;
      var up = (y3 === 0) ? 1 : L.grid[(y3 - 1) * L.cols + x3];
      var dn = (y3 === L.rows - 1) ? 1 : L.grid[(y3 + 1) * L.cols + x3];
      var lf = (x3 === 0) ? 1 : L.grid[y3 * L.cols + x3 - 1];
      var rt = (x3 === L.cols - 1) ? 1 : L.grid[y3 * L.cols + x3 + 1];
      if (!dn) {
        var g2 = s.createLinearGradient(0, py + c - sideT, 0, py + c);
        g2.addColorStop(0, '#2B3134'); g2.addColorStop(1, '#14181A');
        s.fillStyle = g2; s.fillRect(px, py + c - sideT, c + 0.6, sideT);
      }
      if (!up) { s.fillStyle = '#8A9298'; s.fillRect(px, py, c + 0.6, 1.4); }
      if (!lf) { s.fillStyle = 'rgba(0,0,0,.34)'; s.fillRect(px, py, Math.min(c * 0.12, 3), c + .5); s.fillStyle = 'rgba(255,255,255,.07)'; s.fillRect(px, py, 1, c + .5); }
      if (!rt) { s.fillStyle = 'rgba(0,0,0,.22)'; s.fillRect(px + c - Math.min(c * 0.10, 2.6), py, Math.min(c * 0.10, 2.6), c + .5); }
    }

    /* 碎石纹理 */
    for (var key in L.rub) {
      var kx = (key % L.cols) * c + bx, ky = Math.floor(key / L.cols) * c + by;
      s.save(); s.globalAlpha = .5;
      s.strokeStyle = '#2B3134'; s.lineWidth = 1.2;
      for (var cr = 0; cr < 4; cr++) {
        s.beginPath();
        s.moveTo(kx + c * (0.2 + cr * 0.17), ky + c * 0.16);
        s.lineTo(kx + c * (0.28 + cr * 0.17), ky + c * 0.84);
        s.stroke();
      }
      s.restore();
    }
    /* 板边描边 */
    s.save();
    roundRect(s, bx + .5, by + .5, bw - 1, bh - 1, 9);
    s.strokeStyle = 'rgba(138,146,152,.30)'; s.lineWidth = 1; s.stroke();
    s.restore();
  },

  drawBackdrop: function (dt) {
    var ctx = this.ctx, W = this.W, H = this.H;
    this.anim += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (!this.titleBg && this.bgLoaded) this.pickTitleBg();
    if (this.titleBg) {
      /* AI 风景背景（每次回标题页换一张） */
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.titleBg, 0, 0);
      ctx.restore();
    } else {
      var bg = ctx.createRadialGradient(W / 2, H * 0.06, 0, W * 0.5, H * 0.55, H * 0.9);
      bg.addColorStop(0, '#161C1F'); bg.addColorStop(0.55, '#0C1012'); bg.addColorStop(1, '#050708');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    }

    if (!this.dots) {
      this.dots = [];
      var rr = mulberry32(99);
      for (var i = 0; i < 26; i++) {
        this.dots.push({ x: rr(), y: rr(), r: 0.4 + rr() * 1.3, s: 0.006 + rr() * 0.02, a: 0.05 + rr() * 0.18 });
      }
    }
    var t = this.anim;
    /* 缓慢上浮的尘埃，让静态背景有一点呼吸 */
    for (var d = 0; d < this.dots.length; d++) {
      var p = this.dots[d];
      var yy = ((p.y + t * p.s) % 1);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(200,215,222,' + (p.a * (0.4 + 0.6 * Math.sin(t * 1.2 + d))) + ')';
      ctx.arc(p.x * W, yy * H, p.r, 0, 6.2832);
      ctx.fill();
    }
    var vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.25, W / 2, H * 0.5, H * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.50)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  },

  draw: function (dt) {
    if (!Game.level || Game.state === 'idle') { this.drawBackdrop(dt); return; }
    var ctx = this.ctx, L = Game.level, c = this.cell;
    this.anim += dt;
    var t = this.anim;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);

    var px = -Input.tiltX * 0.5, py = -Input.tiltY * 0.5;
    if (Save.d.settings.reduce) { px = 0; py = 0; }
    this.shake *= Math.pow(0.0025, dt);
    var sh = this.shake;
    ctx.save();
    ctx.translate(px + (Math.random() - .5) * sh, py + (Math.random() - .5) * sh);
    ctx.drawImage(this.layer, 0, 0, this.W, this.H);

    var b = Game.ball;
    var lead = (Game.state === 'playing' && UI.inited) ? Math.min(0.009, UI._acc || 0) : 0;
    var bx = this.X(b.x + b.vx * lead), by = this.Y(b.y + b.vy * lead);

    /* ---- 熔岩 ---- */
    if (!this.lavaList) {
      this.lavaList = []; this.quickList = [];
      for (var ly2 = 0; ly2 < L.rows; ly2++) for (var lx2 = 0; lx2 < L.cols; lx2++) {
        var lt = L.tiles[ly2 * L.cols + lx2];
        if (lt === T_LAVA) this.lavaList.push([lx2, ly2]);
        else if (lt === T_QUICK) this.quickList.push([lx2, ly2]);
      }
    }
    for (var li2 = 0; li2 < this.lavaList.length; li2++) {
      this.drawLava(this.lavaList[li2][0], this.lavaList[li2][1], t);
    }
    /* ---- 流沙 ---- */
    for (var qi2 = 0; qi2 < this.quickList.length; qi2++) {
      this.drawQuick(this.quickList[qi2][0], this.quickList[qi2][1], t);
    }
    /* ---- 机关底层：加速带 / 风扇 / 重力区 ---- */
    for (var i = 0; i < L.boosters.length; i++) this.drawBooster(L.boosters[i], t);
    for (var f = 0; f < L.fans.length; f++) this.drawFan(L.fans[f], t);
    for (var gz = 0; gz < L.gravs.length; gz++) this.drawGrav(L.gravs[gz], t);
    /* ---- 门 / 踏板 ---- */
    for (var dk in L.doors) { var dr = L.doors[dk]; this.drawDoor(dr, t); }
    for (var p2 = 0; p2 < L.plates.length; p2++) this.drawPlate(L.plates[p2], t);
    /* ---- 伸缩墙 ---- */
    for (var sk in L.shutters) {
      var s0 = L.shutters[sk], sx = (sk % L.cols), sy = Math.floor(sk / L.cols);
      this.drawShutter(s0, sx, sy, t);
    }
    /* ---- 移动平台 ---- */
    for (var m = 0; m < L.movers.length; m++) this.drawMover(L.movers[m], t);
    /* ---- 磁铁 / 弹跳板 / 传送门 ---- */
    for (var mg = 0; mg < L.magnets.length; mg++) this.drawMagnet(L.magnets[mg], t);
    for (var bp = 0; bp < L.bumpers.length; bp++) this.drawBumper(L.bumpers[bp], t);
    for (var po = 0; po < L.portals.length; po++) this.drawPortals(L.portals[po], t);
    /* ---- 检查点 ---- */
    for (var cp = 0; cp < L.checkpoints.length; cp++) this.drawCheckpoint(L.checkpoints[cp], t);
    /* ---- 洞口 ---- */
    this.drawHole(t);
    /* ---- 宝石 ---- */
    for (var gm = 0; gm < L.gems.length; gm++) if (!L.gems[gm].got) this.drawGem(L.gems[gm], t);
    /* ---- 影子 + 球 ---- */
    this.drawShadow(bx, by, c);
    if (Game.state !== 'dying') this.drawBall(bx, by, c, t);
    /* ---- 粒子 ---- */
    Game.drawParticles(ctx, c);
    /* ---- 迷雾 ---- */
    if (L.fog) {
      var rad = Math.max(c * 4.6, 120);
      var fg = ctx.createRadialGradient(bx, by, rad * 0.42, bx, by, rad);
      fg.addColorStop(0, 'rgba(11,14,16,0)');
      fg.addColorStop(0.55, 'rgba(11,14,16,.55)');
      fg.addColorStop(1, 'rgba(11,14,16,.97)');
      ctx.fillStyle = fg;
      ctx.fillRect(this.ox - 4, this.oy - 4, L.cols * c + 8, L.rows * c + 8);
    }
    ctx.restore();

    /* 暗角（预渲染后贴图，避免每帧建渐变） */
    if (!this.vig) this.buildVignette();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.vig, 0, 0);
    ctx.restore();
  },

  drawLava: function (x, y, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(x), Y = this.Y(y);
    var pul = 0.5 + 0.5 * Math.sin(t * 1.6 + x * 1.3 + y * 0.7);
    ctx.fillStyle = '#1A0C08'; ctx.fillRect(X, Y, c, c);
    var g = ctx.createRadialGradient(X + c * .5, Y + c * .5, c * .06, X + c * .5, Y + c * .5, c * .72);
    g.addColorStop(0, 'rgba(255,122,69,' + (0.5 + pul * 0.35) + ')');
    g.addColorStop(0.45, 'rgba(210,74,50,' + (0.42 + pul * 0.2) + ')');
    g.addColorStop(1, 'rgba(60,14,8,0)');
    ctx.fillStyle = g; ctx.fillRect(X, Y, c, c);
    ctx.save(); ctx.globalAlpha = .5; ctx.strokeStyle = '#FF7A45'; ctx.lineWidth = 1;
    for (var i = 0; i < 2; i++) {
      ctx.beginPath();
      var yy = Y + c * (0.3 + i * 0.36) + Math.sin(t * 2 + x + i) * 2;
      ctx.moveTo(X + c * .16, yy);
      ctx.bezierCurveTo(X + c * .38, yy - 3, X + c * .62, yy + 3, X + c * .85, yy);
      ctx.stroke();
    }
    ctx.restore();
  },
  drawQuick: function (x, y, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(x), Y = this.Y(y);
    ctx.fillStyle = '#1B1F22'; ctx.fillRect(X, Y, c, c);
    var g = ctx.createRadialGradient(X + c / 2, Y + c / 2, 1, X + c / 2, Y + c / 2, c * .62);
    g.addColorStop(0, 'rgba(0,0,0,.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(X, Y, c, c);
    ctx.save(); ctx.strokeStyle = 'rgba(138,146,152,.20)'; ctx.lineWidth = 1;
    for (var i = 0; i < 3; i++) {
      var k = (t * 0.55 + i / 3) % 1;
      ctx.beginPath();
      ctx.ellipse(X + c / 2, Y + c / 2, c * (0.14 + k * 0.36), c * (0.14 + k * 0.36) * .8, 0, 0, 6.2832);
      ctx.globalAlpha = (1 - k) * 0.5; ctx.stroke();
    }
    ctx.restore();
  },
  drawBooster: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x - .5), Y = this.Y(o.y - .5);
    ctx.save();
    ctx.globalAlpha = .85;
    ctx.fillStyle = 'rgba(95,182,204,.10)'; ctx.fillRect(X + 2, Y + 2, c - 4, c - 4);
    ctx.strokeStyle = 'rgba(95,182,204,.5)'; ctx.lineWidth = 1; ctx.strokeRect(X + 2, Y + 2, c - 4, c - 4);
    var cx = X + c / 2, cy = Y + c / 2;
    var ph = (t * 1.7) % 1;
    for (var i = 0; i < 3; i++) {
      var k = (ph + i / 3) % 1;
      var off = (k - 0.5) * c * 0.5;
      ctx.globalAlpha = 0.25 + 0.6 * (1 - Math.abs(k - 0.5) * 2);
      ctx.strokeStyle = '#5FB6CC'; ctx.lineWidth = 2;
      ctx.beginPath();
      var px2 = cx + o.dx * off, py2 = cy + o.dy * off;
      var nx = -o.dy, ny = o.dx;
      ctx.moveTo(px2 - o.dx * c * .1 + nx * c * .12, py2 - o.dy * c * .1 + ny * c * .12);
      ctx.lineTo(px2 + o.dx * c * .1, py2 + o.dy * c * .1);
      ctx.lineTo(px2 - o.dx * c * .1 - nx * c * .12, py2 - o.dy * c * .1 - ny * c * .12);
      ctx.stroke();
    }
    ctx.restore();
  },
  drawFan: function (o, t) {
    var ctx = this.ctx, c = this.cell, L = Game.level;
    ctx.save();
    for (var iy = 0; iy < o.h; iy++) for (var ix = 0; ix < o.w; ix++) {
      var cx0 = Math.floor(o.x) + ix, cy0 = Math.floor(o.y) + iy;
      if (cx0 < 0 || cy0 < 0 || cx0 >= L.cols || cy0 >= L.rows) continue;
      if (L.grid[cy0 * L.cols + cx0] !== 0) continue;
      var X = this.X(cx0), Y = this.Y(cy0);
      ctx.fillStyle = 'rgba(95,182,204,.07)';
      ctx.fillRect(X + 1, Y + 1, c - 2, c - 2);
      var k = ((t * 0.85 + (ix * 0.23 + iy * 0.41)) % 1);
      ctx.globalAlpha = 0.30 + 0.45 * (1 - Math.abs(k - .5) * 1.6);
      ctx.strokeStyle = '#5FB6CC'; ctx.lineWidth = 1.5;
      var px = X + c / 2 + o.dx * (k - .5) * c * .55;
      var py = Y + c / 2 + o.dy * (k - .5) * c * .55;
      var nx = -o.dy, ny = o.dx;
      ctx.beginPath();
      ctx.moveTo(px - o.dx * 3.4 + nx * 3.4, py - o.dy * 3.4 + ny * 3.4);
      ctx.lineTo(px + o.dx * 3.4, py + o.dy * 3.4);
      ctx.lineTo(px - o.dx * 3.4 - nx * 3.4, py - o.dy * 3.4 - ny * 3.4);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },
  drawGrav: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x), Y = this.Y(o.y);
    ctx.save();
    var g = ctx.createLinearGradient(X, Y, X + o.w * c, Y + o.h * c);
    g.addColorStop(0, 'rgba(95,182,204,.10)'); g.addColorStop(1, 'rgba(95,182,204,.02)');
    ctx.fillStyle = g; ctx.fillRect(X, Y, o.w * c, o.h * c);
    ctx.strokeStyle = 'rgba(95,182,204,.30)'; ctx.lineWidth = 1;
    ctx.strokeRect(X + .5, Y + .5, o.w * c - 1, o.h * c - 1);
    for (var i = 0; i < 6; i++) {
      var k = ((t * .8 + i / 6) % 1);
      var cx = X + o.w * c / 2 + o.dx * (k - .5) * o.w * c * .95;
      var cy = Y + o.h * c / 2 + o.dy * (k - .5) * o.h * c * .95;
      ctx.globalAlpha = .38 * (1 - Math.abs(k - .5) * 1.7);
      ctx.strokeStyle = '#5FB6CC'; ctx.lineWidth = 2;
      ctx.beginPath();
      var nx = -o.dy, ny = o.dx;
      ctx.moveTo(cx - o.dx * 5 + nx * 5, cy - o.dy * 5 + ny * 5);
      ctx.lineTo(cx + o.dx * 5, cy + o.dy * 5);
      ctx.lineTo(cx - o.dx * 5 - nx * 5, cy - o.dy * 5 - ny * 5);
      ctx.stroke();
    }
    ctx.restore();
  },
  drawDoor: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x), Y = this.Y(o.y);
    ctx.save();
    if (o.opened) {
      ctx.strokeStyle = 'rgba(95,182,204,.55)'; ctx.lineWidth = 2;
      ctx.strokeRect(X + 3, Y + 3, c - 6, c - 6);
      ctx.setLineDash([3, 4]); ctx.globalAlpha = .5;
      ctx.strokeRect(X + 6, Y + 6, c - 12, c - 12);
      ctx.setLineDash([]);
    } else {
      var g = ctx.createLinearGradient(X, Y, X, Y + c);
      g.addColorStop(0, '#5A6266'); g.addColorStop(1, '#3A4144');
      ctx.fillStyle = g;
      ctx.fillRect(X + 1, Y + 1, c - 2, c - 2);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(X + 1, Y + c * .62, c - 2, c * .38);
      ctx.fillStyle = '#8A9298'; ctx.fillRect(X + 1, Y + c * .60, c - 2, 1.2);
      /* 锁扣指示灯：未激活为暗青 */
      ctx.fillStyle = 'rgba(95,182,204,.42)';
      ctx.beginPath(); ctx.arc(X + c * .5, Y + c * .5, c * .09, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(X + 2.5, Y + 2.5, c - 5, c - 5);
    }
    ctx.restore();
  },
  drawPlate: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x - .5), Y = this.Y(o.y - .5);
    ctx.save();
    ctx.fillStyle = o.on ? 'rgba(95,182,204,.30)' : 'rgba(0,0,0,.28)';
    roundRect(ctx, X + c * .18, Y + c * .18, c * .64, c * .64, 3); ctx.fill();
    ctx.strokeStyle = o.on ? '#5FB6CC' : 'rgba(138,146,152,.55)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, X + c * .18, Y + c * .18, c * .64, c * .64, 3); ctx.stroke();
    if (o.on) {
      ctx.globalAlpha = .4 + .3 * Math.sin(t * 6);
      roundRect(ctx, X + c * .1, Y + c * .1, c * .8, c * .8, 4); ctx.stroke();
    }
    ctx.restore();
  },
  drawShutter: function (o, x, y, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(x), Y = this.Y(y);
    var closed = Game.shutterClosed(o);
    var h = closed ? 1 : 0;
    o._h = o._h === undefined ? h : lerp(o._h, h, 0.25);
    if (o._h < 0.02) return;
    ctx.save();
    var bh = c * o._h;
    ctx.fillStyle = '#4E565A';
    ctx.fillRect(X + 1, Y + c - bh, c - 2, bh);
    ctx.fillStyle = '#8A9298';
    ctx.fillRect(X + 1, Y + c - bh, c - 2, 1.2);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    for (var i = 0; i < 3; i++) ctx.fillRect(X + 3, Y + c - bh + 4 + i * (bh / 3), c - 6, 1);
    ctx.restore();
  },
  drawMover: function (o, t) {
    var ctx = this.ctx, c = this.cell;
    var u = 0.5 - 0.5 * Math.cos((t + o.phase) / o.period * 6.2832);
    var cx = o.x + o.dx * u, cy = o.y + o.dy * u;
    var X = this.X(cx - .5), Y = this.Y(cy - .5);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = c * .3; ctx.shadowOffsetY = c * .1;
    var g = ctx.createLinearGradient(X, Y, X, Y + c);
    g.addColorStop(0, '#6A7276'); g.addColorStop(1, '#3B4246');
    ctx.fillStyle = g;
    roundRect(ctx, X + 1, Y + 1, c - 2, c - 2, 3); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(138,146,152,.7)'; ctx.lineWidth = 1;
    roundRect(ctx, X + 1, Y + 1, c - 2, c - 2, 3); ctx.stroke();
    ctx.fillStyle = 'rgba(95,182,204,.8)';
    ctx.beginPath(); ctx.arc(X + c / 2, Y + c / 2, c * .09, 0, 6.2832); ctx.fill();
    ctx.restore();
  },
  drawMagnet: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x), Y = this.Y(o.y);
    var pulse = .5 + .5 * Math.sin(t * 2.2);
    ctx.save();
    var g = ctx.createRadialGradient(X, Y, c * .1, X, Y, o.radius * c);
    var col = o.pol > 0 ? '210,74,50' : '95,182,204';
    g.addColorStop(0, 'rgba(' + col + ',' + (0.13 + pulse * .07) + ')');
    g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, o.radius * c, 0, 6.2832); ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#2A3033';
    ctx.beginPath(); ctx.arc(X, Y, c * .30, 0, 6.2832); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(138,146,152,.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(X, Y, c * .30, 0, 6.2832); ctx.stroke();
    /* 双极 */
    ctx.fillStyle = '#D24A32'; ctx.fillRect(X - c * .14, Y - c * .06, c * .12, c * .12);
    ctx.fillStyle = '#5FB6CC'; ctx.fillRect(X + c * .02, Y - c * .06, c * .12, c * .12);
    ctx.strokeStyle = 'rgba(237,241,243,.5)';
    ctx.beginPath(); ctx.moveTo(X - c * .08, Y + c * .08); ctx.lineTo(X + c * .08, Y + c * .08); ctx.stroke();
    ctx.restore();
  },
  drawBumper: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x), Y = this.Y(o.y);
    o.hit = Math.max(0, o.hit - 0.06);
    var s = c * (0.36 + o.hit * 0.10);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    var g = ctx.createRadialGradient(X - s * .3, Y - s * .35, s * .1, X, Y, s);
    g.addColorStop(0, '#7E878C'); g.addColorStop(1, '#2E3538');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X, Y, s, 0, 6.2832); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = o.hit > 0.1 ? '#FFE3A3' : 'rgba(138,146,152,.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(X, Y, s, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = 'rgba(138,146,152,.85)';
    ctx.beginPath();
    ctx.moveTo(X, Y - s * .56); ctx.lineTo(X + s * .40, Y + s * .34); ctx.lineTo(X - s * .40, Y + s * .34);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  drawPortals: function (o, t) {
    var self = this, c = this.cell;
    function one(x, y, alt) {
      var X = self.X(x), Y = self.Y(y);
      var ctx = self.ctx;
      ctx.save();
      var g = ctx.createRadialGradient(X, Y, 1, X, Y, c * .62);
      g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(.55, 'rgba(95,182,204,.30)'); g.addColorStop(1, 'rgba(95,182,204,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, c * .62, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = alt ? '#8A9298' : '#C7D2D8'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(X, Y, c * .30, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = 'rgba(95,182,204,.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(X, Y, c * .22, t * 2, t * 2 + 4.2); ctx.stroke();
      ctx.restore();
    }
    one(o.ax, o.ay, false); one(o.bx, o.by, true);
  },
  drawCheckpoint: function (o, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(o.x), Y = this.Y(o.y);
    ctx.save();
    ctx.strokeStyle = o.on ? 'rgba(123,224,139,.85)' : 'rgba(138,146,152,.35)';
    ctx.lineWidth = 1.4;
    if (!o.on) ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(X, Y, c * .34, 0, 6.2832); ctx.stroke();
    if (o.on) {
      ctx.setLineDash([]);
      ctx.globalAlpha = .35 + .25 * Math.sin(t * 3);
      ctx.beginPath(); ctx.arc(X, Y, c * .34, 0, 6.2832); ctx.stroke();
    }
    ctx.restore();
  },
  drawHole: function (t) {
    var ctx = this.ctx, c = this.cell, o = Game.level.hole;
    var X = this.X(o.x), Y = this.Y(o.y);
    var rad = c * 0.5;
    ctx.save();
    var glow = ctx.createRadialGradient(X, Y, rad * .3, X, Y, rad * 2.1);
    glow.addColorStop(0, 'rgba(123,224,139,.34)');
    glow.addColorStop(.5, 'rgba(63,163,77,.14)');
    glow.addColorStop(1, 'rgba(63,163,77,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(X, Y, rad * 2.1, 0, 6.2832); ctx.fill();
    var ring = 0.5 + 0.5 * Math.sin(t * 2.4);
    ctx.strokeStyle = 'rgba(123,224,139,' + (0.30 + ring * 0.42) + ')';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(X, Y, rad * (0.72 + ring * 0.16), 0, 6.2832); ctx.stroke();
    /* 孔 */
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(X, Y, rad * .88, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = 'rgba(63,163,77,.9)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(X, Y, rad * .88, 0, 6.2832); ctx.stroke();
    /* 上升粒子 */
    if (!Save.d.settings.reduce) {
      for (var i = 0; i < 3; i++) {
        var k = ((t * .5 + i / 3) % 1);
        ctx.globalAlpha = (1 - k) * .55;
        ctx.fillStyle = '#7BE08B';
        ctx.beginPath();
        ctx.arc(X + Math.sin((i + t) * 2) * rad * .5, Y - k * rad * 1.5, 1.6, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
  },
  drawGem: function (g, t) {
    var ctx = this.ctx, c = this.cell, X = this.X(g.x), Y = this.Y(g.y);
    var s = c * 0.30, spin = Math.sin(t * 1.6 + g.x * 2) * 0.55 + 0.55;
    ctx.save();
    ctx.translate(X, Y);
    var sh = ctx.createRadialGradient(0, c * .35, 0, 0, c * .35, s * .9);
    sh.addColorStop(0, 'rgba(0,0,0,.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(0, c * .2, s * .8, s * .3, 0, 0, 6.2832); ctx.fill();
    ctx.scale(0.55 + spin * 0.45, 1);
    var gr = ctx.createLinearGradient(-s, -s, s, s);
    gr.addColorStop(0, '#FFE3A3'); gr.addColorStop(.5, '#E8B44A'); gr.addColorStop(1, '#8A6420');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.1); ctx.lineTo(s * .82, -s * .18);
    ctx.lineTo(0, s * 1.1); ctx.lineTo(-s * .82, -s * .18);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,227,163,.85)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.1); ctx.lineTo(s * .30, -s * .2); ctx.lineTo(0, s * .1); ctx.lineTo(-s * .30, -s * .2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  drawShadow: function (bx, by, c) {
    var ctx = this.ctx;
    var ox = Input.tiltX * c * 0.16, oy = Input.tiltY * c * 0.16;
    ctx.save();
    var g = ctx.createRadialGradient(bx + ox, by + oy + c * .06, 0, bx + ox, by + oy + c * .06, c * R * 1.55);
    g.addColorStop(0, 'rgba(0,0,0,.62)'); g.addColorStop(.55, 'rgba(0,0,0,.34)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(bx + ox, by + oy + c * .06, c * R * 1.5, c * R * 1.22, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  },
  drawBall: function (bx, by, c, t) {
    var ctx = this.ctx, r = c * R;
    var sk = SKINS[Save.d.skin] || SKINS[0];
    ctx.save();
    var g = ctx.createRadialGradient(bx - r * .36, by - r * .42, r * .06, bx, by, r * 1.06);
    g.addColorStop(0, sk.hi);
    g.addColorStop(0.22, sk.mid);
    g.addColorStop(0.72, sk.mid);
    g.addColorStop(1, sk.dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, 6.2832); ctx.fill();
    /* 边缘暗环 */
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx, by, r - .5, 0, 6.2832); ctx.stroke();
    /* 反光弧 */
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = Math.max(1, r * .16);
    ctx.beginPath(); ctx.arc(bx, by, r * .74, 0.30, 1.55); ctx.stroke();
    /* 球面纹理：随滚动角平移，肉眼能看出球在"滚"而不是"滑" */
    ctx.save();
    ctx.beginPath(); ctx.arc(bx, by, r - 1, 0, 6.2832); ctx.clip();
    var ball = Game.ball;
    var period = Math.max(4, r * 0.82);
    var ox = ((ball.rotY || 0) * r * 0.30) % period;
    var oy = ((ball.rotX || 0) * r * 0.30) % period;
    ctx.lineWidth = Math.max(1, r * 0.055);
    ctx.strokeStyle = 'rgba(0,0,0,.13)';
    for (var q = -3; q <= 3; q++) {
      ctx.beginPath();
      ctx.moveTo(bx + ox + q * period, by - r); ctx.lineTo(bx + ox + q * period, by + r); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - r, by + oy + q * period); ctx.lineTo(bx + r, by + oy + q * period); ctx.stroke();
    }
    ctx.restore();

    /* 硬高光 */
    var hg = ctx.createRadialGradient(bx - r * .34, by - r * .40, 0, bx - r * .34, by - r * .40, r * .34);
    hg.addColorStop(0, 'rgba(255,255,255,.98)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(bx - r * .34, by - r * .40, r * .34, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shade(hex, k) {
  var n = parseInt(hex.slice(1), 16);
  var r = clamp(((n >> 16) & 255) * k, 0, 255) | 0;
  var g = clamp(((n >> 8) & 255) * k, 0, 255) | 0;
  var b = clamp((n & 255) * k, 0, 255) | 0;
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function drawTile(s, x, y, t, c, bx, by, L) {
  var X = bx + x * c, Y = by + y * c;
  if (t === T_ICE) {
    var g = s.createLinearGradient(X, Y, X + c, Y + c);
    g.addColorStop(0, '#46525A'); g.addColorStop(.5, '#39444C'); g.addColorStop(1, '#2F3940');
    s.fillStyle = g; s.fillRect(X, Y, c, c);
    s.save();
    s.strokeStyle = 'rgba(255,255,255,.14)'; s.lineWidth = 1;
    for (var i = 0; i < 3; i++) {
      s.beginPath();
      s.moveTo(X + c * (.14 + i * .30), Y + c * .04);
      s.lineTo(X + c * (.04 + i * .30), Y + c * .96);
      s.stroke();
    }
    s.strokeStyle = 'rgba(255,255,255,.06)';
    s.beginPath(); s.moveTo(X + c * .05, Y + c * .7); s.lineTo(X + c * .95, Y + c * .25); s.stroke();
    s.restore();
  } else if (t === T_SAND) {
    s.fillStyle = '#37332B'; s.fillRect(X, Y, c, c);
    s.save();
    var rr = mulberry32((x * 71 + y * 131) | 0);
    for (var j = 0; j < 16; j++) {
      s.fillStyle = 'rgba(0,0,0,' + (0.05 + rr() * 0.12).toFixed(2) + ')';
      s.fillRect(X + rr() * c, Y + rr() * c, 1.4, 1.4);
    }
    s.fillStyle = 'rgba(255,255,255,.035)';
    for (var j2 = 0; j2 < 8; j2++) s.fillRect(X + rr() * c, Y + rr() * c, 1.2, 1.2);
    s.restore();
  } else if (t === T_QUICK) {
    s.fillStyle = '#1B1F22'; s.fillRect(X, Y, c, c);
  } else if (t === T_LAVA) {
    s.fillStyle = '#170B07'; s.fillRect(X, Y, c, c);
  }
}

/* ---------- 游戏 ---------- */
var Game = {
  level: null, state: 'idle', elapsed: 0, deathT: 0,
  ball: { x: 0, y: 0, vx: 0, vy: 0 },
  gemsGot: 0, particles: [], portalCD: 0, alive: true,
  onWin: null, onDie: null,

  load: function (id, endlessN) {
    applyTuning();
    this.endlessN = endlessN || 0;
    this.level = this.endlessN ? generateEndless(this.endlessN) : generateLevel(id);
    var L = this.level;
    L.gems.forEach(function (g) { g.got = false; });
    L.checkpoints.forEach(function (c) { c.on = false; });
    for (var k in L.doors) L.doors[k].opened = false;
    L.plates.forEach(function (p) { p.on = false; });
    this.particles = [];
    this.gemsGot = 0;
    this.elapsed = 0;
    this.portalCD = 0;
    this.ball.x = L.spawn.x; this.ball.y = L.spawn.y;
    this.ball.vx = 0; this.ball.vy = 0;
    this.checkpoint = { x: L.spawn.x, y: L.spawn.y };
    this.state = 'ready';
    Input.beginLearn();       /* 开场卡期间平均采样握姿，球此时不动 */
    Render.measure();
    Render.buildStatic();
  },
  start: function () {
    this.state = 'playing';
    this.elapsed = 0;
    Input.endLearn();         /* 定稿零点，游戏过程中绝不再改 */
  },
  pause: function () { if (this.state === 'playing') this.state = 'paused'; },
  resume: function () { if (this.state === 'paused') this.state = 'playing'; },

  tileAt: function (x, y) {
    var L = this.level, cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= L.cols || cy >= L.rows) return T_FLOOR;
    return L.tiles[cy * L.cols + cx];
  },
  shutterClosed: function (o) {
    var p = (this.elapsed + o.phase) % o.period;
    return p < o.period * 0.5;
  },
  solidFull: function (cx, cy) {
    var L = this.level;
    if (cx < 0 || cy < 0 || cx >= L.cols || cy >= L.rows) return true;
    var i = cy * L.cols + cx;
    if (L.grid[i] === 1) {
      if (L.broken && L.broken[i]) return false;
      return true;
    }
    var dr = L.doors[i];
    if (dr && !dr.opened) return true;
    var sh = L.shutters[i];
    if (sh && this.shutterClosed(sh)) {
      if (Math.floor(this.ball.x) === cx && Math.floor(this.ball.y) === cy) return false;
      return true;
    }
    return false;
  },
  gravityAt: function (x, y) {
    var L = this.level;
    for (var i = 0; i < L.gravs.length; i++) {
      var g = L.gravs[i];
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return g;
    }
    return null;
  },

  fixSolid: function (cx, cy) {
    /* 碎石被打碎后从网格移除 */
    var L = this.level, i = cy * L.cols + cx;
    if (L.broken && L.broken[i]) return false;
    return this.solid(cx, cy) || (L.doors[i] && !L.doors[i].opened) || (L.shutters && L.shutters[i] && this.shutterClosed(L.shutters[i]));
  },

  step: function (dt) {
    var L = this.level, b = this.ball;
    this.elapsed += dt;
    this.updateParticles(dt);
    if (this.state === 'dying') {
      this.deathT += dt;
      if (this.deathT > 1.15) this.respawn();
      return;
    }
    if (this.state !== 'playing') return;

    var ax = 0, ay = 0;
    var gz = this.gravityAt(b.x, b.y);
    if (gz) {
      /* 重力区：方向锁定，但保留 45% 的倾斜控制，避免被顶死在岔口 */
      ax = gz.dx * gz.a + Input.ax * 0.45;
      ay = gz.dy * gz.a + Input.ay * 0.45;
      /* 防呆：被重力区顶在墙上时把球送出去，避免永久卡死 */
      this._gzT = (this._gzT || 0) + dt;
      if (this._gzT > 2.2) {
        var spd0 = Math.hypot(b.vx, b.vy);
        if (spd0 < 0.25) { this.ejectZone(gz); this._gzT = 0; return; }
      }
    } else { ax = Input.ax; ay = Input.ay; this._gzT = 0; }

    var tile = this.tileAt(b.x, b.y);
    var damp = tile === T_ICE ? DAMP.ice : tile === T_SAND ? DAMP.sand : tile === T_QUICK ? DAMP.quick : DAMP.floor;
    var roll = tile === T_ICE ? ROLL.ice : tile === T_SAND ? ROLL.sand : ROLL.floor;

    /* 流沙 */
    if (tile === T_QUICK) {
      var ccx = Math.floor(b.x) + .5, ccy = Math.floor(b.y) + .5;
      var dxq = ccx - b.x, dyq = ccy - b.y, dq = Math.hypot(dxq, dyq);
      if (dq > 0.02) { ax += dxq / dq * 3.0; ay += dyq / dq * 3.0; }
    }
    /* 磁铁 */
    for (var i = 0; i < L.magnets.length; i++) {
      var m = L.magnets[i];
      var dxm = m.x - b.x, dym = m.y - b.y, dm = Math.hypot(dxm, dym);
      if (dm < m.radius && dm > 0.18) {
        var f = m.strength * (1 - dm / m.radius) * m.pol;
        ax += dxm / dm * f; ay += dym / dm * f;
      }
    }
    /* 风扇 */
    for (var f2 = 0; f2 < L.fans.length; f2++) {
      var fn = L.fans[f2];
      if (b.x >= fn.x && b.x <= fn.x + fn.w && b.y >= fn.y && b.y <= fn.y + fn.h) {
        ax += fn.dx * 3; ay += fn.dy * 3;
      }
    }
    /* 加速带 */
    for (var b2 = 0; b2 < L.boosters.length; b2++) {
      var bo = L.boosters[b2];
      if (Math.abs(b.x - bo.x) < 0.55 && Math.abs(b.y - bo.y) < 0.55) {
        ax += bo.dx * 6; ay += bo.dy * 6;
      }
    }

    /* 反向制动：球正朝一个方向滚、玩家往反方向拉时，先给一段制动加成。
       顺向时完全不介入，所以不影响"一倾斜就滚"的顺滑，只让换向更干脆。 */
    var vdot = b.vx * ax + b.vy * ay;
    if (vdot < -0.05) {
      ax *= 1.6; ay *= 1.6;
      damp *= 1.8;
    }

    b.vx += ax * dt; b.vy += ay * dt;
    var f3 = Math.exp(-damp * dt);
    b.vx *= f3; b.vy *= f3;
    var sp = Math.hypot(b.vx, b.vy);
    if (sp > 1e-5) {
      var ns = Math.max(0, sp - roll * dt);
      b.vx *= ns / sp; b.vy *= ns / sp;
      sp = ns;
    }
    if (sp > VMAX) { b.vx *= VMAX / sp; b.vy *= VMAX / sp; sp = VMAX; }
    if (sp < 0.015 && Math.hypot(ax, ay) < 0.05) { b.vx = 0; b.vy = 0; sp = 0; }
    /* 低速且玩家已回正时快速收敛，避免球以极低速无限" creeping" 停不干净。
       高速段完全不介入，顺滑的滑行手感保留。 */
    if (sp > 0 && sp < 0.4 && Math.hypot(ax, ay) < 0.4) {
      b.vx *= 0.80; b.vy *= 0.80;
    }

    b.x += b.vx * dt; b.y += b.vy * dt;
    /* 滚动角：滚过的弧长 / 半径，用来转动球面纹理 */
    b.rotX = (b.rotX || 0) + b.vy * dt / R;
    b.rotY = (b.rotY || 0) + b.vx * dt / R;
    this.collide(dt);
    this.collideMovers(dt);
    this.portalCD = Math.max(0, this.portalCD - dt);

    /* 洞口吸附 */
    var dxh = L.hole.x - b.x, dyh = L.hole.y - b.y, dh = Math.hypot(dxh, dyh);
    if (dh < 1.3 && dh > 0.001) {
      var pull = 2.0 * (1 - dh / 1.3);
      b.vx += dxh / dh * pull * dt * 6; b.vy += dyh / dh * pull * dt * 6;
    }
    if (dh < HOLE_R) { this.win(); return; }

    /* 宝石 */
    for (var g3 = 0; g3 < L.gems.length; g3++) {
      var gem = L.gems[g3];
      if (gem.got) continue;
      if (Math.hypot(gem.x - b.x, gem.y - b.y) <= GEM_R) {
        gem.got = true; this.gemsGot++;
        Snd.gem(); haptic(12);
        this.burst(gem.x, gem.y, '#E8B44A', 9, 1.6);
        if (this.onGem) this.onGem(this.gemsGot, L.gems.length);
      }
    }
    /* 检查点 */
    for (var c2 = 0; c2 < L.checkpoints.length; c2++) {
      var cp = L.checkpoints[c2];
      if (!cp.on && Math.hypot(cp.x - b.x, cp.y - b.y) < 0.55) {
        cp.on = true; this.checkpoint = { x: cp.x, y: cp.y };
        this.burst(cp.x, cp.y, '#7BE08B', 7, 1.2);
        Snd.tone(660, .14, 'sine', .14, 0);
      }
    }
    /* 压力板 */
    for (var p3 = 0; p3 < L.plates.length; p3++) {
      var pl = L.plates[p3];
      var inside = Math.hypot(pl.x - b.x, pl.y - b.y) < 0.44;
      if (inside && !pl.on) {
        pl.on = true;
        var dr2 = L.doors[pl.door];
        if (dr2) dr2.opened = true;
        Snd.tone(520, .14, 'square', .1, 0);
        haptic(10);
        this.burst(pl.x, pl.y, '#5FB6CC', 6, 1.2);
      }
    }
    /* 传送门 */
    if (L.portals.length && this.portalCD <= 0) {
      for (var p4 = 0; p4 < L.portals.length; p4++) {
        var po = L.portals[p4];
        if (Math.hypot(po.ax - b.x, po.ay - b.y) < 0.45) {
          this.port(po.bx, po.by); break;
        }
        if (Math.hypot(po.bx - b.x, po.by - b.y) < 0.45) {
          this.port(po.ax, po.ay); break;
        }
      }
    }
    /* 熔岩 */
    if (this.tileAt(b.x, b.y) === T_LAVA) { this.die('lava'); return; }

    Snd.roll(sp, tile === T_ICE);
  },
  ejectZone: function (gz) {
    var b = this.ball, L = this.level;
    for (var step = 1.2; step >= 0.4; step -= 0.4) {
      var nx = b.x + gz.dx * step, ny = b.y + gz.dy * step;
      var cx = Math.floor(nx), cy = Math.floor(ny);
      if (cx < 1 || cy < 1 || cx > L.cols - 2 || cy > L.rows - 2) continue;
      if (this.solidFull(cx, cy)) continue;
      b.x = nx; b.y = ny; b.vx = gz.dx * 1.2; b.vy = gz.dy * 1.2;
      this.burst(nx, ny, '#5FB6CC', 8, 1.4);
      return;
    }
  },
  port: function (x, y) {
    var b = this.ball;
    this.burst(b.x, b.y, '#5FB6CC', 10, 1.8);
    b.x = x; b.y = y;
    this.portalCD = 0.55;
    this.burst(x, y, '#5FB6CC', 10, 1.8);
    Snd.tone(420, .16, 'sine', .16, 0, 900);
    haptic(14);
  },
  collide: function (dt) {
    var L = this.level, b = this.ball, r = R;
    var maxImpact = 0;
    for (var iter = 0; iter < 2; iter++) {
      var x0 = Math.floor(b.x - r) - 1, x1 = Math.floor(b.x + r) + 1;
      var y0 = Math.floor(b.y - r) - 1, y1 = Math.floor(b.y + r) + 1;
      for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
        if (!this.solidFull(cx, cy)) continue;
        var qx = clamp(b.x, cx, cx + 1), qy = clamp(b.y, cy, cy + 1);
        var dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        var nx, ny, pen;
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = r - d;
        } else {
          var l = b.x - cx, rr = cx + 1 - b.x, tp = b.y - cy, bt = cy + 1 - b.y;
          var mm = Math.min(l, rr, tp, bt);
          if (mm === l) { nx = -1; ny = 0; pen = l + r; }
          else if (mm === rr) { nx = 1; ny = 0; pen = rr + r; }
          else if (mm === tp) { nx = 0; ny = -1; pen = tp + r; }
          else { nx = 0; ny = 1; pen = bt + r; }
        }
        b.x += nx * pen; b.y += ny * pen;
        var vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          var impact = -vn;
          if (impact > maxImpact) maxImpact = impact;
          /* 碎石：速度 > 6 格/s 撞碎 */
          if (L.rub[cy * L.cols + cx] === 1 && impact > 6) {
            if (!L.broken) L.broken = {};
            L.broken[cy * L.cols + cx] = 1;
            L.rub[cy * L.cols + cx] = 0;
            this.burst(cx + .5, cy + .5, '#8A9298', 12, 2.4);
            Render.shake = Math.max(Render.shake, 5);
            haptic(26); Snd.hit(0.9);
            Render.buildStatic();
          } else if (impact > 0.45) {
            /* 真正撞上墙：反弹 + 一次性切向摩擦 */
            b.vx -= (1 + REST) * vn * nx;
            b.vy -= (1 + REST) * vn * ny;
            var tx = -ny, ty = nx;
            var vt = b.vx * tx + b.vy * ty;
            var nvt = vt * (1 - WFRIC);
            b.vx += (nvt - vt) * tx; b.vy += (nvt - vt) * ty;
          } else {
            /* 贴墙 / 沿墙滑行：只吃掉法向速度，切向速度原样保留。
               以前这里每帧都乘一次 0.85 摩擦，球一碰墙就被吸住。 */
            b.vx -= vn * nx;
            b.vy -= vn * ny;
          }
        }
      }
    }
    if (maxImpact > 0.6) this.onImpact(maxImpact);
  },
  collideMovers: function (dt) {
    var L = this.level, b = this.ball, r = R;
    for (var i = 0; i < L.movers.length; i++) {
      var m = L.movers[i];
      var u = 0.5 - 0.5 * Math.cos((this.elapsed + m.phase) / m.period * 6.2832);
      m.px = m.x + m.dx * u;
      m.py = m.y + m.dy * u;
      var hw = 0.5, hh = 0.5;
      var qx = clamp(b.x, m.px - hw, m.px + hw), qy = clamp(b.y, m.py - hh, m.py + hh);
      var dx = b.x - qx, dy = b.y - qy, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = r - d;
          b.x += nx * pen; b.y += ny * pen;
          var vn = b.vx * nx + b.vy * ny;
          if (vn < 0) { b.vx -= (1 + 0.4) * vn * nx; b.vy -= (1 + 0.4) * vn * ny; }
        } else {
          var lft = b.x - (m.px - hw), rgt = (m.px + hw) - b.x;
          var top = b.y - (m.py - hh), bot = (m.py + hh) - b.y;
          var mn = Math.min(lft, rgt, top, bot);
          if (mn === lft) { b.x = m.px - hw - r; if (b.vx > 0) b.vx = 0; }
          else if (mn === rgt) { b.x = m.px + hw + r; if (b.vx < 0) b.vx = 0; }
          else if (mn === top) { b.y = m.py - hh - r; if (b.vy > 0) b.vy = 0; }
          else { b.y = m.py + hh + r; if (b.vy < 0) b.vy = 0; }
        }
        /* 深度重叠才判定挤压（防止贴住平台即死） */
        if (pen > 0.26) {
          b._crush = (b._crush || 0) + dt;
          if (b._crush > 0.7) { this.die('crush'); return; }
        } else b._crush = 0;
      } else b._crush = 0;
    }
  },
  onImpact: function (impact) {
    var power = clamp(impact / VMAX, 0, 1);
    var ms = impact < 3 ? 8 : (impact < 6 ? 16 : 28);
    haptic(ms);
    Snd.hit(power);
    Render.shake = Math.max(Render.shake, power * 4.5);
  },
  die: function (why) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.deathT = 0;
    this.ball._crush = 0;
    this.burst(this.ball.x, this.ball.y, '#D24A32', 14, 3.2);
    Snd.die(); haptic(30);
    Render.shake = 7;
    if (this.onDie) this.onDie();
  },
  respawn: function () {
    var b = this.ball;
    b.x = this.checkpoint.x; b.y = this.checkpoint.y;
    b.vx = 0; b.vy = 0; b._crush = 0;
    this.portalCD = 0.4;
    this.state = 'playing';
    this.burst(b.x, b.y, '#8E9AA1', 8, 1.4);
  },
  win: function () {
    if (this.state !== 'playing') return;
    this.state = 'won';
    var L = this.level;
    var allGem = L.gems.length === 0 || this.gemsGot === L.gems.length;
    var stars = 1;
    if (this.elapsed <= L.par) stars = 2;
    if (this.elapsed <= L.par && allGem) stars = 3;
    if (L.gems.length === 0 && this.elapsed <= L.par) stars = 3;
    this.burst(L.hole.x, L.hole.y, '#7BE08B', 16, 2.6);
    Snd.hole(); haptic(20);
    if (this.onWin) this.onWin(stars, this.elapsed);
  },
  burst: function (x, y, color, n, sp) {
    if (Save.d.settings.reduce) n = Math.ceil(n * 0.4);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832, v = (0.4 + Math.random()) * sp;
      this.particles.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.6, max: 1.1, color: color, size: 0.04 + Math.random() * 0.06,
        g: 0.6
      });
    }
  },
  updateParticles: function (dt) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94; p.vy += p.g * dt * 0.2;
    }
  },
  drawParticles: function (ctx, c) {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      ctx.globalAlpha = clamp(p.life / 0.7, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(Render.X(p.x), Render.Y(p.y), p.size * c * 1.6, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
};
