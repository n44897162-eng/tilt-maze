/* ===================================================================
   界面流程 / 屏幕切换 / 主循环
   =================================================================== */

var UI = {
  curId: 1, curChapter: 1, endlessN: 0, wipeAt: 0, inited: false,

  el: function (id) { return document.getElementById(id); },
  init: function () {
    if (this.inited) return;
    this.inited = true;
    Save.load();
    applyTuning();
    Input.init();
    Render.init();
    this.bind();
    this.refreshMenu();

    Game.onWin = function (stars, time) { UI.onWin(stars, time); };
    Game.onDie = function () { UI.onDie(); };
    this.loop(performance.now());
  },

  /* ---------- 屏幕 ---------- */
  show: function (name) {
    var scr = document.querySelectorAll('.screen');
    for (var i = 0; i < scr.length; i++) {
      scr[i].classList.toggle('hide', scr[i].id !== 'screen-' + name);
    }
    this.el('panel-pause').classList.add('hide');
    this.el('hint').classList.add('hide');
    this.el('tools').classList.add('hide');
    if (name === 'title') {
      Game.level = null; Game.state = 'idle'; this.refreshMenu();
      this.el('hud').classList.add('dim');
      this.el('panel-result').classList.add('hide');
      var it = this.el('intro'); if (it) it.classList.add('hide');
      this.endlessN = 0;
      Render.pickTitleBg();      /* 每次回主菜单换一张风景 */
    }
    if (name === 'chapters') this.renderChapters();
    if (name === 'skins') this.renderSkins();
  },
  hideAll: function () {
    var scr = document.querySelectorAll('.screen');
    for (var i = 0; i < scr.length; i++) scr[i].classList.add('hide');
  },

  refreshMenu: function () {
    var n = Save.nextPlayable();
    this.el('contLv').textContent = '第 ' + n + ' 关';
    this.el('totalStars').textContent = Save.total();
    this.el('totalMax').textContent = TOTAL_LEVELS * 3;
    var ch = chapterOf(n), c = CHAPTERS[ch - 1];
    var cs = Save.chapStars(ch), cm = Save.chapMaxStars(ch);
    this.el('brandMeta').textContent = '第 ' + (ch < 10 ? '0' + ch : ch) + ' 章 · ' + c.name + '　★ ' + cs + ' / ' + cm;
    var en = (Save.d.endless || 0) + 1;
    this.el('endlessLv').textContent = '深渊 ' + (en < 10 ? '0' + en : en);
  },

  renderChapters: function () {
    var host = this.el('chapList');
    host.innerHTML = '';
    this.el('chapStars').textContent = Save.total();
    for (var i = 0; i < CHAPTERS.length; i++) {
      var c = CHAPTERS[i];
      var unlocked = Save.unlockedChap(c.i);
      var r = Save.chapRange(c.i);
      var st = Save.chapStars(c.i), cl = Save.chapCleared(c.i);
      var mx = Save.chapMaxStars(c.i);
      var d = document.createElement('div');
      d.className = 'chap' + (unlocked ? '' : ' locked');
      d.setAttribute('data-ch', c.i);
      d.innerHTML = '<div class="no"></div><div class="nm"></div><div class="lv"></div><div class="mech"></div><div class="bar"><i></i></div><div class="foot"><span class="f1"></span><span class="f2"></span></div><div class="lockmsg"></div>';
      var no = c.i < 10 ? '0' + c.i : '' + c.i;
      d.querySelector('.no').textContent = no;
      d.querySelector('.nm').textContent = c.name;
      d.querySelector('.lv').textContent = 'CHAPTER ' + no + ' / LEVEL ' + r[0] + '–' + r[1];
      d.querySelector('.mech').textContent = c.mech;
      d.querySelector('.bar i').style.width = Math.round(st / mx * 100) + '%';
      d.querySelector('.f1').textContent = '★ ' + st + ' / ' + mx;
      d.querySelector('.f2').textContent = unlocked ? (cl >= c.n ? '已完成' : '进行中 ' + cl + '/' + c.n) : '未解锁';
      var lm = d.querySelector('.lockmsg');
      if (unlocked) lm.parentNode.removeChild(lm);
      else lm.textContent = '前 ' + (c.i - 1) + ' 章各通关 2/3 · 还差 ' + Math.max(0, Save.chapNeed(c.i) - Save.clearedTotal()) + ' 关';
      host.appendChild(d);
    }
  },

  openChapter: function (ch) {
    if (!Save.unlockedChap(ch)) {
      this.toast('再通关 ' + Math.max(0, Save.chapNeed(ch) - Save.clearedTotal()) + ' 关即可解锁本章');
      this.show('chapters');
      return;
    }
    this.curChapter = ch;
    var c = CHAPTERS[ch - 1];
    this.el('lvK').textContent = 'CHAPTER ' + (ch < 10 ? '0' + ch : ch);
    this.el('lvTitle').textContent = c.name;
    this.el('lvStars').textContent = Save.chapStars(ch);
    this.renderLevels(ch);
    this.show('levels');
  },

  renderLevels: function (ch) {
    var host = this.el('lvList');
    host.innerHTML = '';
    var r = Save.chapRange(ch);
    for (var i = r[0]; i <= r[1]; i++) {
      var sN = Save.starsOf(i), un = Save.levelUnlocked(i), sk = !!Save.d.skip[i];
      var cur = i === Save.nextPlayable();
      var d = document.createElement('div');
      d.className = 'lvcell' + (un ? '' : ' locked') + (sN > 0 ? ' done' : '') +
        (sk && !sN ? ' skipped' : '') + (cur ? ' cur' : '');
      d.innerHTML = '<div class="n"></div><div class="st"></div><div class="g"></div>';
      d.querySelector('.n').textContent = i;
      var stEl = d.querySelector('.st');
      stEl.textContent = '';
      if (sk && !sN) {
        var sb = document.createElement('span');
        sb.className = 'skp';
        sb.textContent = '已跳过';
        stEl.appendChild(sb);
      } else {
        for (var j2 = 0; j2 < 3; j2++) {
          var sp = document.createElement('span');
          sp.textContent = '★';
          if (j2 < sN) sp.className = 'on';
          stEl.appendChild(sp);
          if (j2 < 2) stEl.appendChild(document.createTextNode(' '));
        }
      }
      if (Save.d.gems[i]) d.querySelector('.g').textContent = '◆';
      else d.querySelector('.g').parentNode.removeChild(d.querySelector('.g'));
      if (un) d.setAttribute('data-lv', i);
      host.appendChild(d);
    }
  },

  renderSkins: function () {
    var host = this.el('skinList');
    host.innerHTML = '';
    for (var i = 0; i < SKINS.length; i++) {
      var un = skinUnlocked(i), on = Save.d.skin === i;
      var d = document.createElement('div');
      d.className = 'lvcell' + (un ? '' : ' locked') + (on ? ' cur' : '');
      d.innerHTML = '<div class="orb"><span></span></div><div class="skn"></div><div class="sks"></div>';
      var orb = d.querySelector('.orb span');
      orb.style.background = 'radial-gradient(circle at 34% 30%,' + SKINS[i].hi + ',' + SKINS[i].mid + ' 55%,' + SKINS[i].dark + ')';
      d.querySelector('.skn').textContent = SKINS[i].n;
      d.querySelector('.sks').textContent = un ? (on ? '使用中' : '已解锁') : (i * 30 + ' ★');
      if (un) d.setAttribute('data-skin', i);
      host.appendChild(d);
    }
  },

  /* ---------- 开始一关 ---------- */
  startLevel: function (id) {
    if (id < 1 || id > TOTAL_LEVELS) return;
    if (!Save.levelUnlocked(id)) { this.toast('先通过前面的关卡'); return; }
    var self = this;
    Input.requestPermission().then(function (ok) {
      Input.applyMode(ok);
      self.reallyStart(id, 0);
    });
  },
  startEndless: function (n) {
    var self = this;
    Input.requestPermission().then(function (ok) {
      Input.applyMode(ok);
      self.reallyStart(0, n);
    });
  },

  reallyStart: function (id, endlessN) {
    this.el('panel-pause').classList.add('hide');
    this.el('panel-result').classList.add('hide');
    this.endlessN = endlessN || 0;
    this.curId = id || 0;
    if (!this.endlessN) this.curChapter = chapterOf(id);
    this.hideAll();
    this.el('hud').classList.remove('dim');
    this.el('tools').classList.remove('hide');
    this.el('hint').classList.add('hide');
    Game.load(id, this.endlessN || 0);
    var L = Game.level;
    var tag = this.endlessN ? ('ENDLESS ' + (this.endlessN < 10 ? '0' + this.endlessN : this.endlessN))
      : ('LEVEL ' + (id < 10 ? '0' + id : id));
    this.el('hudLv').textContent = tag;
    this.el('hudName').textContent = L.name;
    this.el('hudGem').textContent = '◆ 0/' + L.gems.length;
    this.el('hudTime').textContent = '0:00';
    this.el('hudTime').classList.remove('over');
    this.setHudStars(0);
    this.syncSkipBtn();

    var intro = this.el('intro');
    this.el('introK').textContent = tag + '　难度 ' + L.dval.toFixed(1);
    this.el('introN').textContent = L.name;
    this.el('introM').textContent = '标准时间 ' + fmtTime(L.par) + '　◆ ' + L.gems.length;
    intro.classList.remove('hide');
    var self = this;
    clearTimeout(this._introT);
    this._introT = setTimeout(function () {
      intro.classList.add('hide');
      if (Game.state === 'paused') return;
      Game.start();
      self.checkHold();
      if (id === 1) {
        if (Input.mode === 'gyro') {
          setTimeout(function () {
            self.el('hint').classList.remove('hide');
            setTimeout(function () { self.el('hint').classList.add('hide'); }, 3400);
          }, 560);
        } else {
          self.toast('手机放平端在手里，倾斜机身让球滚向绿洞');
        }
      }
    }, 1150);
  },

  /* 竖着拿手机时重力几乎不落在屏幕平面上，球会贴底不动——提示放平 */
  checkHold: function () {
    var self = this;
    clearTimeout(this._holdT);
    this._holdT = setTimeout(function () {
      if (Input.mode !== 'gyro' || !Input.hasReading) return;
      if (Math.abs(Input.baseB) > 0.88 || Math.abs(Input.baseG) > 0.88) {
        self.toast('倾斜手机即可控球 · 放平一些前后方向会更灵敏');
      }
    }, 2600);
  },

  syncSkipBtn: function () {
    var on = !!Save.d.settings.allowSkip;
    this.el('btnSkip').style.display = on ? 'grid' : 'none';
  },

  syncHud: function () {
    if (!Game.level) return;
    if (Game.state === 'idle' || Game.state === 'won') return;
    var L = Game.level;
    var t = this.el('hudTime');
    t.textContent = fmtTime(Game.elapsed);
    t.classList.toggle('over', Game.elapsed > L.par);
    var g = this.el('hudGem');
    if (g.textContent !== '◆ ' + Game.gemsGot + '/' + L.gems.length)
      g.textContent = '◆ ' + Game.gemsGot + '/' + L.gems.length;
    var starNow = Game.elapsed <= L.par ? 2 : 1;
    if (Game.elapsed <= L.par && Game.gemsGot >= L.gems.length) starNow = 3;
    this.setHudStars(starNow);
  },

  setHudStars: function (n) {
    var box = this.el('hudStars');
    if (!box.children.length) {
      box.textContent = '';
      for (var k = 0; k < 3; k++) {
        var sp = document.createElement('span');
        sp.textContent = '☆';
        box.appendChild(sp);
        if (k < 2) box.appendChild(document.createTextNode(' '));
      }
    }
    for (var i = 0; i < 3; i++) {
      var e = box.children[i];
      if (!e) continue;
      e.textContent = i < n ? '★' : '☆';
      e.className = i < n ? 'on' : '';
    }
  },

  onWin: function (stars, time) {
    var L = Game.level;

    if (this.endlessN) {
      /* 无限模式：只记最远记录 */
      if (this.endlessN > (Save.d.endlessBest || 0)) Save.d.endlessBest = this.endlessN;
      if (this.endlessN > (Save.d.endless || 0)) Save.d.endless = this.endlessN;
      Save.flush();
    } else {
      var id = L.id;
      var prev = Save.starsOf(id);
      if (stars > prev) Save.d.stars[id] = stars;
      if (!Save.d.best[id] || time < Save.d.best[id]) Save.d.best[id] = time;
      if (Game.gemsGot >= L.gems.length && L.gems.length) Save.d.gems[id] = 1;
      if (Save.d.skip[id]) delete Save.d.skip[id];
      Save.d.last = id;
      Save.flush();
    }

    this.el('hud').classList.add('dim');
    this.el('tools').classList.add('hide');
    var P = this.el('panel-result');
    this.el('resK').textContent = this.endlessN
      ? ('ENDLESS ' + this.endlessN + ' · CLEAR')
      : ('LEVEL ' + (L.id < 10 ? '0' + L.id : L.id) + ' · CLEAR');
    this.el('resName').textContent = L.name;
    this.el('resTime').textContent = fmtTime(time);
    this.el('resPar').textContent = fmtTime(L.par);
    this.el('resGem').textContent = Game.gemsGot + ' / ' + L.gems.length;
    this.el('resBest').textContent = this.endlessN
      ? ('第 ' + (Save.d.endlessBest || this.endlessN) + ' 层')
      : fmtTime(Save.d.best[L.id]);
    var sEl = this.el('resStars').children;
    for (var i = 0; i < 3; i++) { sEl[i].className = ''; sEl[i].style.animation = 'none'; }
    P.classList.remove('hide');
    for (var j = 0; j < stars; j++) {
      (function (k) {
        setTimeout(function () {
          sEl[k].className = 'on pop';
          Snd.star(k);
        }, 220 + k * 260);
      })(j);
    }
    var showNext = this.endlessN ? true : (L.id < TOTAL_LEVELS);
    this.el('btnNext').style.display = showNext ? 'flex' : 'none';
    this.refreshMenu();
  },
  onDie: function () { },

  /* ---------- 跳过本关 ---------- */
  skipCurrent: function () {
    if (!Save.d.settings.allowSkip) return;
    if (this.endlessN) {
      if (this.endlessN > (Save.d.endless || 0)) Save.d.endless = this.endlessN;
      Save.flush();
      this.toast('已跳过 · 进入第 ' + (this.endlessN + 1) + ' 层');
      this.reallyStart(0, this.endlessN + 1);
      return;
    }
    var id = this.curId;
    if (!id) return;
    Save.markSkip(id);
    this.toast('已跳过第 ' + id + ' 关');
    var n = Math.min(TOTAL_LEVELS, id + 1);
    if (n === id) { this.quitToLevels(); return; }
    this.reallyStart(n, 0);
  },

  /* ---------- 事件 ---------- */
  bind: function () {
    var self = this;

    this.el('btnContinue').addEventListener('click', function () {
      Snd.init(); Snd.resume(); Snd.ui();
      self.startLevel(Save.nextPlayable());
    });
    this.el('btnChapters').addEventListener('click', function () { Snd.ui(); self.show('chapters'); });
    this.el('btnSkin').addEventListener('click', function () { Snd.ui(); self.show('skins'); });
    this.el('btnSettings').addEventListener('click', function () { Snd.ui(); self._fromPause = false; self.show('settings'); });
    this.el('btnHowto').addEventListener('click', function () { Snd.ui(); self.howto(); });
    this.el('btnEndless').addEventListener('click', function () {
      Snd.init(); Snd.resume(); Snd.ui();
      self.startEndless((Save.d.endless || 0) + 1);
    });

    var backs = document.querySelectorAll('[data-back]');
    for (var i = 0; i < backs.length; i++) {
      backs[i].addEventListener('click', function () {
        Snd.ui();
        if (self._fromPause) {
          self._fromPause = false;
          self.hideAll();
          if (Game.state === 'paused') self.el('panel-pause').classList.remove('hide');
          return;
        }
        var to = this.getAttribute('data-back');
        if (to === 'chapters') { self.show('chapters'); }
        else self.show('title');
      });
    }
    this.el('chapList').addEventListener('click', function (e) {
      var n = e.target.closest ? e.target.closest('.chap') : null;
      if (!n) return;
      Snd.ui();
      self.openChapter(parseInt(n.getAttribute('data-ch'), 10));
    });
    this.el('lvList').addEventListener('click', function (e) {
      var n = e.target.closest ? e.target.closest('.lvcell') : null;
      if (!n) return;
      if (!n.getAttribute('data-lv')) { self.toast('先通过前面的关卡'); return; }
      Snd.init(); Snd.resume(); Snd.ui();
      self.startLevel(parseInt(n.getAttribute('data-lv'), 10));
    });
    this.el('skinList').addEventListener('click', function (e) {
      var n = e.target.closest ? e.target.closest('.lvcell') : null;
      if (!n || !n.getAttribute('data-skin')) return;
      Save.d.skin = parseInt(n.getAttribute('data-skin'), 10);
      Save.flush(); Snd.ui(); self.renderSkins();
    });

    /* HUD 工具条 */
    this.el('btnPause').addEventListener('click', function () { Snd.ui(); self.pause(); });
    this.el('btnCal').addEventListener('click', function () { self.calibrate(); });
    this.el('btnReset').addEventListener('click', function () { self.resetLevel(); });
    this.el('btnSkip').addEventListener('click', function () { self.skipCurrent(); });
    this.el('btnResume').addEventListener('click', function () { Snd.ui(); self.resume(); });
    this.el('btnCal2').addEventListener('click', function () { self.calibrate(); });
    this.el('btnReset2').addEventListener('click', function () { self.resume(); self.resetLevel(); });
    this.el('btnSet2').addEventListener('click', function () { Snd.ui(); self._fromPause = true; self.show('settings'); });
    this.el('btnQuit').addEventListener('click', function () { self.quitToLevels(); });

    /* 结算 */
    this.el('btnReplay').addEventListener('click', function () {
      Snd.ui();
      if (self.endlessN) self.reallyStart(0, self.endlessN);
      else self.reallyStart(self.curId, 0);
    });
    this.el('btnNext').addEventListener('click', function () {
      Snd.ui();
      if (self.endlessN) { self.reallyStart(0, self.endlessN + 1); return; }
      var n = Math.min(TOTAL_LEVELS, self.curId + 1);
      if (n === self.curId) { self.show('chapters'); return; }
      if (!Save.levelUnlocked(n)) { self.show('chapters'); return; }
      self.reallyStart(n, 0);
    });
    this.el('btnResBack').addEventListener('click', function () { self.quitToLevels(); });

    /* 设置 */
    this.bindSeg('segCtrl', 'ctrl', function (v) { return v; });
    this.bindSwitch('swInvertX', 'invertX');
    this.bindSwitch('swInvert', 'invertY');
    this.bindSwitch('swSound', 'sound');
    this.bindSwitch('swHaptic', 'haptic');
    this.bindSwitch('swReduce', 'reduce');
    this.bindSwitch('swSkip', 'allowSkip', function () { self.syncSkipBtn(); });

    this.el('rngSens').addEventListener('input', function () {
      Save.d.settings.sens = parseFloat(this.value);
      Save.flush();
      self.syncSettings();
    });
    this.el('rngSpeed').addEventListener('input', function () {
      Save.d.settings.speed = parseInt(this.value, 10) / 100;
      Save.flush();
      applyTuning();
      self.syncSettings();
    });

    this.el('btnRecal').addEventListener('click', function () { self.calibrate(); });
    this.el('btnWipe').addEventListener('click', function () { self.wipe(); });
    this.syncSettings();
  },

  bindSeg: function (id, key, cast) {
    var self = this, box = this.el(id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      Save.d.settings[key] = cast(b.getAttribute('data-v'));
      Save.flush(); Snd.ui();
      self.syncSettings();
      if (key === 'ctrl') {
        Input.applyMode(Input.hasGyro);
        if (Save.d.settings.ctrl === 'gyro' && !Input.hasGyro) self.toast('此设备未提供姿态数据，已用拖拽');
      }
    });
  },
  bindSwitch: function (id, key, after) {
    var self = this, el = this.el(id);
    el.addEventListener('click', function () {
      Save.d.settings[key] = !Save.d.settings[key];
      Save.flush(); Snd.ui(); self.syncSettings();
      if (after) after();
    });
  },
  syncSettings: function () {
    var s = Save.d.settings;
    var rS = this.el('rngSens'), rP = this.el('rngSpeed');
    if (rS) rS.value = String(s.sens);
    if (rP) rP.value = String(Math.round((s.speed || 1) * 100));
    this.el('sensVal').textContent = (s.sens).toFixed(1);
    this.el('speedVal').textContent = Math.round((s.speed || 1) * 100) + '%';
    var segC = this.el('segCtrl').children;
    for (var j = 0; j < segC.length; j++) segC[j].classList.toggle('on', segC[j].getAttribute('data-v') === s.ctrl);
    this.el('swInvertX').classList.toggle('on', !!s.invertX);
    this.el('swInvert').classList.toggle('on', s.invertY);
    this.el('swSound').classList.toggle('on', s.sound);
    this.el('swHaptic').classList.toggle('on', s.haptic);
    this.el('swReduce').classList.toggle('on', s.reduce);
    this.el('swSkip').classList.toggle('on', !!s.allowSkip);
    this.syncSkipBtn();
  },

  calibrate: function () {
    if (Input.mode === 'gyro') {
      if (Input.calibrate()) this.toast('已重新校准零点');
      else this.toast('尚未收到姿态数据');
    } else {
      this.toast('当前为' + (Input.mode === 'drag' ? '拖拽' : '键盘') + '操作，无需校准');
    }
  },
  pause: function () {
    var st = Game.state;
    if (st !== 'playing' && st !== 'ready' && st !== 'dying') return;
    if (st === 'ready') {
      clearTimeout(this._introT);
      this.el('intro').classList.add('hide');
      Game.start();
    }
    Game.pause();
    this.el('panel-pause').classList.remove('hide');
    this.el('hint').classList.add('hide');
    this.el('hud').classList.add('dim');
  },
  resume: function () {
    this.el('panel-pause').classList.add('hide');
    this.el('hud').classList.remove('dim');
    this.el('tools').classList.remove('hide');
    Game.resume();
  },
  resetLevel: function () {
    this.toast('本关已重置');
    if (this.endlessN) this.reallyStart(0, this.endlessN);
    else this.reallyStart(this.curId, 0);
  },
  quitToLevels: function () {
    this.el('panel-pause').classList.add('hide');
    this.el('panel-result').classList.add('hide');
    this.el('hud').classList.add('dim');
    this.el('tools').classList.add('hide');
    Game.state = 'idle'; Game.level = null;
    if (this.endlessN) { this.endlessN = 0; this.show('title'); return; }
    this.openChapter(this.curChapter);
  },

  wipe: function () {
    var now = Date.now();
    if (now - this.wipeAt > 3200) {
      this.wipeAt = now;
      this.toast('再点一次清空全部进度');
      return;
    }
    Save.d = Save.def();
    Save.flush();
    applyTuning();
    this.syncSettings();
    this.refreshMenu();
    this.toast('进度已清空');
  },

  toast: function (msg) {
    var t = this.el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    var self = this;
    this._tt = setTimeout(function () { t.classList.remove('show'); }, 1900);
  },

  howto: function () {
    var d = document.createElement('div');
    d.className = 'panel';
    d.innerHTML =
      '<div class="card">' +
      '<div class="k">HOW TO PLAY</div><h3>操作方式</h3>' +
      '<div class="desc" style="line-height:2">' +
      '<b style="color:#EDF1F3">体感</b>　手机平放端在手里，倾斜多少度就给多少力（30° ≈ 半个重力加速度）<br>' +
      '<b style="color:#EDF1F3">拖拽</b>　按住屏幕拖动，偏移量映射为倾角<br>' +
      '<b style="color:#EDF1F3">键盘</b>　方向键 / WASD（桌面）<br>' +
      '<b style="color:#EDF1F3">校准</b>　底部 ◎ 把当前持机姿态设为零点<br>' +
      '</div>' +
      '<div class="sep"></div>' +
      '<div class="desc">把球滚进<b style="color:#7BE08B">绿色洞口</b>即通关。' +
      '用时 ≤ 标准时间得 ★★，同时收齐<b style="color:#E8B44A">金色宝石</b>得 ★★★。<br>' +
      '撞墙不会失败，死亡只损失时间。<br>' +
      '倾斜手机，球就像在真实迷宫盘上一样被重力拉动。前 10 关教学，之后 300 关随机生成。<br>' +
      '球被重力直接拉动，斜坡越陡越快；松手回正后会靠摩擦慢慢停下。</div>' +
      '<div style="margin-top:14px"><button class="btn small wide" id="howClose">知道了</button></div>' +
      '</div>';
    document.getElementById('ui').appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d || (e.target.id === 'howClose')) d.remove();
    });
  },

  /* 设置页的传感器指示：气泡跟着倾斜走，用户能直接看到有没有在工作 */
  updateSensor: function () {
    var scr = this.el('screen-settings');
    if (!scr || scr.classList.contains('hide')) return;
    var dot = this.el('sensDot'), st = this.el('sensState');
    if (!dot || !st) return;

    if (Input.mode !== 'gyro') {
      st.textContent = '当前为' + (Input.mode === 'drag' ? '拖拽' : '键盘') + '操作';
      dot.className = 'dead';
      dot.style.transform = 'translate(0,0)';
      return;
    }
    if (!Input.hasReading) {
      st.textContent = '未收到姿态数据 · 请确认设备有重力感应';
      dot.className = 'dead';
      dot.style.transform = 'translate(0,0)';
      return;
    }
    var tx = Input.tiltX || 0, ty = Input.tiltY || 0;
    st.textContent = '工作中 · 左右 ' + (tx * 100).toFixed(0) + '　前后 ' + (ty * 100).toFixed(0) +
      '　（' + (Input.mode === 'gyro' ? '体感' : '拖拽') + '）';
    dot.className = '';
    var lim = 58;
    var dx = Math.max(-1, Math.min(1, tx)) * lim;
    var dy = Math.max(-1, Math.min(1, ty)) * lim;
    dot.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
  },

  /* ---------- 主循环 ---------- */
  loop: function (ts) {
    var now = ts || 0;
    if (!this._last) this._last = now;
    var dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    Input.update(dt);
    if (Game.state === 'playing' || Game.state === 'dying') {
      this._acc = (this._acc || 0) + dt;
      var st = 1 / 120, guard = 0;
      while (this._acc >= st && guard < 16) { Game.step(st); this._acc -= st; guard++; }
      if (this._acc > st * 4) this._acc = 0;
    } else { this._acc = 0; }
    Render.draw(dt);
    this._hudAcc = (this._hudAcc || 0) + dt;
    if (this._hudAcc > 0.055) {
      this._hudAcc = 0;
      this.syncHud();
      this.updateSensor();
    }
    var self = this;
    requestAnimationFrame(function (t) { self.loop(t); });
  }
};

function boot() {
  UI.init();
  UI.show('title');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else { boot(); }

/* 切后台自动暂停 */
document.addEventListener('visibilitychange', function () {
  if (document.hidden && UI.inited && Game.state === 'playing') UI.pause();
});
