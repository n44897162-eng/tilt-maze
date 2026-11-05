/* ===================================================================
   滚球迷宫 · Tilt Maze
   引擎第一部分：常量 / 关卡生成
   -----------------------------------------------------------------
   关卡结构：第 1 章 = 10 关教学；第 2-11 章 = 300 关随机，难度递增
   另有无限模式：按序号无限生成，签名去重，保证有解
   =================================================================== */
'use strict';

/* ---------- 物理与手感常量 ---------- */
var R = 0.30;          // 球半径（格）
var GEM_R = 0.42;      // 宝石判定
var HOLE_R = 0.45;     // 洞口判定
var VMAX_BASE = 9;     // 基础最大速度 格/s（可被"球速"设置缩放）
var ACC_BASE = 11;     // 基础最大加速度 格/s²
var VMAX = VMAX_BASE, ACC_MAX = ACC_BASE;
var REST = 0.20;       // 墙面弹性
var WFRIC = 0.05;      // 墙面摩擦（只在真正撞击时扣一次）
var GRAV = 9.8;
/* 倾斜输入：单位是"重力在屏幕平面的分量"（1.0 = 1g，约等于 90° 竖直）
   物理模型：球的加速度 = g × 倾斜分量，像把真实的迷宫盘端在手里。
   倾斜多少度就受多少力，不做饱和压缩，也不再放大死区后的补偿。 */
var TILT_DZ = 0.004;   // 死区 ≈ 0.23°，几乎等于没有，轻微倾斜就能推动球
var TILT_SAT = 0.50;   // 仅用于界面气泡的显示比例
var TILT_CURVE = 1.0;  // 线性（保留字段以便调参）
var GRAV_GAME = 26;    // 1g 对应的游戏加速度，单位 格/s²

var DAMP = { floor: 0.28, ice: 0.07, sand: 2.6, quick: 0.62 };
var ROLL = { floor: 0.06, ice: 0.015, sand: 0.80, quick: 0.22 };

var T_FLOOR = 0, T_ICE = 1, T_SAND = 2, T_QUICK = 3, T_LAVA = 4;

/* 球速设置（0.65 ~ 1.45）同时缩放速度上限与加速度，
   让"慢速"不只是限制上限，而是整体变柔和；"快速"则更灵敏更冲。 */
function applyTuning() {
  var s = (typeof Save !== 'undefined' && Save.d) ? Save.d.settings : { speed: 1 };
  var sp = s.speed || 1;
  VMAX = VMAX_BASE * sp;
  ACC_MAX = ACC_BASE * (0.55 + 0.45 * sp);
}

/* ---------- 章节：11 章 310 关 ---------- */
var TUT_N = 10;          // 教学关数
var RANDOM_N = 300;      // 随机关数
var TOTAL_LEVELS = TUT_N + RANDOM_N;

var CHAPTERS = [
  { i: 1,  name: '玻璃庭院', plate: '#2C3134', mech: '入门 · 每关只教一件事', n: 10 },
  { i: 2,  name: '石壁回廊', plate: '#2E3330', mech: '基础移动 · 宝石 · 检查点', n: 30 },
  { i: 3,  name: '寒霜长廊', plate: '#2A3238', mech: '冰面 · 预判惯性', n: 30 },
  { i: 4,  name: '流沙遗迹', plate: '#332E28', mech: '沙地 · 流沙 · 碎石', n: 30 },
  { i: 5,  name: '磁极工坊', plate: '#3A3327', mech: '磁铁 · 画弧线', n: 30 },
  { i: 6,  name: '弹跳林',   plate: '#2B3532', mech: '弹跳板 · 加速带', n: 30 },
  { i: 7,  name: '风蚀断层', plate: '#2F3330', mech: '风扇 · 移动平台', n: 30 },
  { i: 8,  name: '熔火地宫', plate: '#322A28', mech: '伸缩墙 · 熔岩 · 压力板', n: 30 },
  { i: 9,  name: '倒悬高塔', plate: '#2C2B33', mech: '重力区 · 重新理解「下」', n: 30 },
  { i: 10, name: '镜影回廊', plate: '#2E3438', mech: '传送门 · 迷雾', n: 30 },
  { i: 11, name: '核心熔炉', plate: '#2B2622', mech: '全机制组合 · 终局', n: 30 }
];

function chapterOf(id) {
  if (id <= TUT_N) return 1;
  return 2 + Math.floor((id - TUT_N - 1) / 30);
}
function levelsInChapter(ch) { return CHAPTERS[ch - 1].n; }
function firstLevelOf(ch) {
  if (ch <= 1) return 1;
  return TUT_N + (ch - 2) * 30 + 1;
}

/* ---------- 工具 ---------- */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  var m = Math.floor(s / 60), r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/* ---------- 关卡名生成 ---------- */
var NAME_A = ['霜蚀', '坍缩', '裂痕', '锈铁', '暗涌', '悬空', '孤光', '碎影', '冷铸', '残响',
  '回流', '偏移', '窄缝', '浮尘', '斜切', '沉铁', '寒铁', '灰烬', '静默', '逆光',
  '断口', '空腔', '薄壁', '沉默', '褪色', '错位', '折角', '哑光', '潮汐', '余烬'];
var NAME_B = ['回廊', '窄道', '庭院', '阶梯', '漏斗', '岔口', '环廊', '斜坡', '夹缝', '深井',
  '桥台', '棱镜', '旋涡', '断层', '石阵', '拱廊', '暗渠', '竖井', '斜谷', '靶场'];
var NAME_C = ['', '· 上', '· 中', '· 下', '· 一', '· 二', '· 三', '· 甲', '· 乙', '· 丙'];

function nameFor(n) {
  var a = NAME_A[(n * 7 + 3) % NAME_A.length];
  var b = NAME_B[(n * 11 + 5) % NAME_B.length];
  var c = NAME_C[Math.floor(n / 20) % NAME_C.length];
  return a + b + c;
}

/* ---------- 关卡尺寸随难度增长 ---------- */
function gridForD(d) {
  if (d < 0.10) return [9, 15];
  if (d < 0.24) return [11, 19];
  if (d < 0.46) return [13, 21];
  if (d < 0.72) return [13, 23];
  return [15, 25];
}

/* ---------- 迷宫生成 ---------- */
function genMaze(cols, rows, rng) {
  var g = new Uint8Array(cols * rows).fill(1);
  g[1 * cols + 1] = 0;
  var st = [[1, 1]];
  while (st.length) {
    var cur = st[st.length - 1], x = cur[0], y = cur[1];
    var dirs = [];
    var cand = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    for (var i = 0; i < 4; i++) {
      var nx = x + cand[i][0], ny = y + cand[i][1];
      if (nx > 0 && nx < cols - 1 && ny > 0 && ny < rows - 1 && g[ny * cols + nx] === 1) dirs.push(cand[i]);
    }
    if (!dirs.length) { st.pop(); continue; }
    var d = dirs[Math.floor(rng() * dirs.length)];
    g[(y + d[1] / 2) * cols + (x + d[0] / 2)] = 0;
    g[(y + d[1]) * cols + (x + d[0])] = 0;
    st.push([x + d[0], y + d[1]]);
  }
  return g;
}

function openAt(g, cols, rows, x, y) {
  return x >= 0 && y >= 0 && x < cols && y < rows && g[y * cols + x] === 0;
}

function degree(g, cols, rows, x, y) {
  var n = 0;
  if (openAt(g, cols, rows, x + 1, y)) n++;
  if (openAt(g, cols, rows, x - 1, y)) n++;
  if (openAt(g, cols, rows, x, y + 1)) n++;
  if (openAt(g, cols, rows, x, y - 1)) n++;
  return n;
}

function bfs(g, cols, rows, sx, sy) {
  var dist = new Int16Array(cols * rows).fill(-1);
  var q = [sy * cols + sx]; dist[sy * cols + sx] = 0;
  var head = 0;
  while (head < q.length) {
    var i = q[head++], x = i % cols, y = (i - x) / cols, d = dist[i];
    var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (var j = 0; j < 4; j++) {
      var nx = nb[j][0], ny = nb[j][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      var k = ny * cols + nx;
      if (g[k] !== 0 || dist[k] >= 0) continue;
      dist[k] = d + 1; q.push(k);
    }
  }
  return dist;
}

function shortestPath(g, cols, rows, sx, sy, tx, ty) {
  var prev = new Int32Array(cols * rows).fill(-2);
  var start = sy * cols + sx, goal = ty * cols + tx;
  if (start === goal) return [[sx, sy]];
  var q = [start]; prev[start] = -1;
  var head = 0;
  while (head < q.length) {
    var i = q[head++], x = i % cols, y = (i - x) / cols;
    if (i === goal) break;
    var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (var j = 0; j < 4; j++) {
      var nx = nb[j][0], ny = nb[j][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      var k = ny * cols + nx;
      if (g[k] !== 0 || prev[k] !== -2) continue;
      prev[k] = i; q.push(k);
    }
  }
  if (prev[goal] === -2) return null;
  var path = [], cur = goal;
  while (cur !== -1) { path.push([cur % cols, Math.floor(cur / cols)]); cur = prev[cur]; }
  path.reverse();
  return path;
}

function pathRuns(path) {
  var runs = [], i = 0;
  while (i < path.length - 1) {
    var dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1];
    var j = i;
    while (j < path.length - 1 &&
      path[j + 1][0] - path[j][0] === dx && path[j + 1][1] - path[j][1] === dy) j++;
    runs.push({ start: i, end: j, len: j - i + 1, dx: dx, dy: dy });
    i = j;
  }
  return runs;
}

/* ===================================================================
   教学关（1-10）：全部手工摆位，每关只教一件事
   =================================================================== */
function blankRoom(cols, rows) {
  var g = new Uint8Array(cols * rows).fill(1);
  for (var y = 1; y < rows - 1; y++) {
    for (var x = 1; x < cols - 1; x++) g[y * cols + x] = 0;
  }
  return g;
}
function wall(g, cols, rows, x0, y0, x1, y1) {
  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      g[y * cols + x] = 1;
    }
  }
}

var TUTORIALS = [
  {
    n: '第一次滚动', d: '倾斜手机，重力方向就是球的方向',
    cols: 7, rows: 13, spawn: [3.5, 10.5], hole: [3.5, 2.5],
    build: function () { }
  },
  {
    n: '左右转弯', d: '前进不够，还得会拐弯',
    cols: 9, rows: 15, spawn: [2.5, 13.5], hole: [6.5, 1.5],
    build: function (g, c, r) {
      wall(g, c, r, 3, 4, 5, 4);
      wall(g, c, r, 1, 8, 4, 8);
      wall(g, c, r, 3, 12, 7, 12);
    }
  },
  {
    n: '窄道', d: '一格宽的口子，慢慢来',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [4.5, 1.5],
    build: function (g, c, r) {
      wall(g, c, r, 1, 7, 3, 7);
      wall(g, c, r, 5, 7, 7, 7);
    }
  },
  {
    n: '第一颗宝石', d: '绕路去捡，星星才拿满',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [4.5, 1.5],
    gems: [[1.5, 1.5]],
    build: function (g, c, r) {
      wall(g, c, r, 1, 5, 2, 5);
    }
  },
  {
    n: '冰面', d: '冰上刹不住，提前松手',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [4.5, 1.5],
    ice: [[1, 9, 7, 10]],
    build: function () { }
  },
  {
    n: '沙地', d: '沙里走不动，得多用点劲',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [4.5, 1.5],
    sand: [[1, 9, 7, 10]],
    build: function () { }
  },
  {
    n: '检查点', d: '掉下去从蓝圈重来，不用回起点',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [4.5, 1.5],
    checks: [[4.5, 8.5]],
    build: function (g, c, r) {
      wall(g, c, r, 1, 5, 2, 5);
      wall(g, c, r, 6, 5, 7, 5);
    }
  },
  {
    n: '弹跳板', d: '撞上去会被弹开，用来过弯',
    cols: 9, rows: 15, spawn: [4.5, 13.5], hole: [1.5, 1.5],
    bumpers: [[3.5, 7.5]],
    build: function (g, c, r) {
      wall(g, c, r, 5, 1, 7, 3);
    }
  },
  {
    n: '磁铁', d: '金色磁铁会把你拉过去',
    cols: 9, rows: 15, spawn: [2.5, 13.5], hole: [6.5, 1.5],
    magnets: [[4.5, 7.5]],
    build: function (g, c, r) {
      wall(g, c, r, 1, 4, 6, 4);
      wall(g, c, r, 2, 10, 7, 10);
    }
  },
  {
    n: '小小考验', d: '把学过的连起来用',
    cols: 11, rows: 19, spawn: [5.5, 17.5], hole: [3.5, 1.5],
    maze: 90210,
    ice: [[1, 11, 9, 12]],
    gems: [[8.5, 9.5]]
  }
];

function tutorialLevel(id) {
  var T = TUTORIALS[id - 1];
  var cols = T.cols, rows = T.rows;
  var rng = mulberry32(T.maze || 12345);
  var g;
  if (T.maze) {
    g = genMaze(cols, rows, rng);
    /* 教学关留一点呼吸空间 */
    for (var y = 1; y < rows - 1; y++) {
      for (var x = 1; x < cols - 1; x++) {
        if (g[y * cols + x] === 1 && rng() < 0.10) g[y * cols + x] = 0;
      }
    }
  } else {
    g = blankRoom(cols, rows);
  }
  if (T.build) T.build(g, cols, rows);

  var L = {
    id: id, name: T.n, desc: T.d, ch: 1, k: id,
    cols: cols, rows: rows,
    spawn: { x: T.spawn[0], y: T.spawn[1] },
    hole: { x: T.hole[0], y: T.hole[1] },
    grid: g, tiles: new Uint8Array(cols * rows),
    gems: [], checkpoints: [], magnets: [], bumpers: [], boosters: [],
    fans: [], movers: [], shutters: {}, plates: [], doors: {}, portals: [],
    gravs: [], rub: {}, fog: false, tutorial: true
  };

  if (T.ice) for (var a = 0; a < T.ice.length; a++) {
    var r1 = T.ice[a];
    for (var yy = r1[1]; yy <= r1[3]; yy++) for (var xx = r1[0]; xx <= r1[2]; xx++) {
      L.tiles[yy * cols + xx] = T_ICE;
    }
  }
  if (T.sand) for (var b = 0; b < T.sand.length; b++) {
    var r2 = T.sand[b];
    for (var y2 = r2[1]; y2 <= r2[3]; y2++) for (var x2 = r2[0]; x2 <= r2[2]; x2++) {
      L.tiles[y2 * cols + x2] = T_SAND;
    }
  }
  if (T.gems) for (var gm = 0; gm < T.gems.length; gm++) {
    L.gems.push({ x: T.gems[gm][0], y: T.gems[gm][1], got: false, pop: 0 });
  }
  if (T.checks) for (var ck = 0; ck < T.checks.length; ck++) {
    L.checkpoints.push({ x: T.checks[ck][0], y: T.checks[ck][1], on: false });
  }
  if (T.bumpers) for (var bp = 0; bp < T.bumpers.length; bp++) {
    L.bumpers.push({ x: T.bumpers[bp][0], y: T.bumpers[bp][1], r: 0.38, hit: 0 });
  }
  if (T.magnets) for (var mg = 0; mg < T.magnets.length; mg++) {
    L.magnets.push({
      x: T.magnets[mg][0], y: T.magnets[mg][1],
      strength: 5, pol: 1, radius: 3
    });
  }
  L.dval = Math.round((0.1 + (id - 1) * 0.06) * 10) / 10;
  return L;
}

/* ===================================================================
   随机关生成（11-310）与无限模式
   =================================================================== */

/* 机制解锁阈值：难度 d 从 0 到 1 平滑铺开，避免"几十关长得一样" */
var GATE = {
  gem: 0.02,
  check: 0.16,
  ice: 0.20,
  sand: 0.30,
  quick: 0.38,
  rub: 0.44,
  magnet: 0.50,
  bumper: 0.56,
  boost: 0.62,
  fan: 0.68,
  mover: 0.74,
  shutter: 0.78,
  lava: 0.82,
  plate: 0.86,
  grav: 0.90,
  portal: 0.93,
  fog: 0.965
};

/* 签名去重表：固定关卡与无限模式共用，保证任何两关不会一模一样 */
var SIG_SEEN = {};

function sigOf(L) {
  var parts = [L.cols + 'x' + L.rows + ':' + L.tiles.join('') + ':' +
    Math.round(L.spawn.x * 4) + ',' + Math.round(L.spawn.y * 4) + ':' +
    Math.round(L.hole.x * 4) + ',' + Math.round(L.hole.y * 4) + ':' +
    Math.round(L.dval * 100)];
  for (var k in L.rub) parts.push('r' + k);
  for (var k2 in L.doors) parts.push('d' + k2);
  for (var k3 in L.shutters) parts.push('s' + k3);
  var arrs = [L.gems, L.magnets, L.bumpers, L.boosters, L.fans, L.movers, L.gravs, L.portals, L.plates];
  for (var i = 0; i < arrs.length; i++) {
    for (var j = 0; j < arrs[i].length; j++) {
      var o = arrs[i][j];
      parts.push(Math.round((o.x !== undefined ? o.x : o.ax) * 4) + '.' + Math.round((o.y !== undefined ? o.y : o.ay) * 4));
    }
  }
  return parts.join('|');
}

/* ---------- 可解性校验 ----------
   不变量：
   1) 起点与洞口在"墙即阻"的图上连通（生成时用 BFS 最远两点天然成立）
   2) 主路径上不含熔岩
   3) 压力板的路径位置必须早于它控制的门（否则可能开着门前没踩板）
   4) 门只允许出现在主路径之外的旁支上，或踏板确实在必经位置
*/
function validateLevel(L, path) {
  if (!path || path.length < 2) return false;
  var cols = L.cols, rows = L.rows;
  var holeI = Math.floor(L.hole.y) * cols + Math.floor(L.hole.x);
  var spawnI = Math.floor(L.spawn.y) * cols + Math.floor(L.spawn.x);
  if (L.tiles[holeI] === T_LAVA) return false;
  if (L.tiles[spawnI] === T_LAVA) return false;

  var pathIdx = {};
  for (var i = 0; i < path.length; i++) {
    var pi = path[i][1] * cols + path[i][0];
    pathIdx[pi] = i;
    if (L.tiles[pi] === T_LAVA) return false;   /* 主路径不许有熔岩 */
  }
  /* 门：踏板必须落在主路径更早的位置 */
  for (var k in L.doors) {
    var doorI = parseInt(k, 10);
    var best = -1;
    for (var p = 0; p < path.length; p++) {
      var ci = path[p][1] * cols + path[p][0];
      var dx = Math.abs(ci % cols - doorI % cols), dy = Math.abs(Math.floor(ci / cols) - Math.floor(doorI / cols));
      if (dx + dy <= 2) { best = p; break; }
    }
    if (best < 0) return false;              /* 门离主路太远，玩家可能永远踩不到板 */
    var ok = false;
    for (var p2 = 0; p2 < L.plates.length; p2++) {
      if (L.plates[p2].door !== doorI) continue;
      var px = Math.floor(L.plates[p2].x), py = Math.floor(L.plates[p2].y);
      var pIdx = pathIdx[py * cols + px];
      if (pIdx !== undefined && pIdx <= best) ok = true;
    }
    if (!ok) return false;
  }
  return true;
}

function buildRandom(id, d, seed, isEndless) {
  var rng = mulberry32(seed);
  var dim = gridForD(d), cols = dim[0], rows = dim[1];
  var ch = isEndless ? 11 : chapterOf(id);
  var k = isEndless ? 30 : (id - firstLevelOf(ch) + 1);

  var L = {
    id: id, ch: ch, k: k, cols: cols, rows: rows,
    name: '', desc: '', dval: 0.6 + d * 4.4,
    grid: null, tiles: null, spawn: null, hole: null,
    gems: [], checkpoints: [], magnets: [], bumpers: [], boosters: [],
    fans: [], movers: [], shutters: {}, plates: [], doors: {}, portals: [],
    gravs: [], rub: {}, fog: false, endless: isEndless ? id : 0, par: 0
  };

  var g = genMaze(cols, rows, rng);
  /* 开阔度：越简单越开阔 */
  var openP = lerp(0.30, 0.03, clamp(d * 1.25, 0, 1));
  for (var y = 1; y < rows - 1; y++) {
    for (var x = 1; x < cols - 1; x++) {
      if (g[y * cols + x] === 1 && rng() < openP) g[y * cols + x] = 0;
    }
  }
  /* 编织：越简单环路越多，越难死胡同越多 */
  var braidP = lerp(0.55, 0.10, clamp(d, 0, 1));
  for (var yy = 1; yy < rows - 1; yy++) {
    for (var xx = 1; xx < cols - 1; xx++) {
      if (g[yy * cols + xx] !== 0) continue;
      var wn = [];
      if (xx + 1 < cols - 1 && g[yy * cols + xx + 1] === 1) wn.push([xx + 1, yy]);
      if (xx - 1 > 0 && g[yy * cols + xx - 1] === 1) wn.push([xx - 1, yy]);
      if (yy + 1 < rows - 1 && g[(yy + 1) * cols + xx] === 1) wn.push([xx, yy + 1]);
      if (yy - 1 > 0 && g[(yy - 1) * cols + xx] === 1) wn.push([xx, yy - 1]);
      if (wn.length >= 3 && rng() < braidP) {
        var w = pick(rng, wn);
        g[w[1] * cols + w[0]] = 0;
      }
    }
  }
  /* 最远两点作起终点 */
  var d1 = bfs(g, cols, rows, 1, 1);
  var best = -1, bi = 0;
  for (var i2 = 0; i2 < d1.length; i2++) if (d1[i2] > best) { best = d1[i2]; bi = i2; }
  var sx = bi % cols, sy = Math.floor(bi / cols);
  var d2 = bfs(g, cols, rows, sx, sy);
  var best2 = -1, bj = 0;
  for (var j2 = 0; j2 < d2.length; j2++) if (d2[j2] > best2) { best2 = d2[j2]; bj = j2; }
  var tx = bj % cols, ty = Math.floor(bj / cols);

  L.grid = g;
  L.tiles = new Uint8Array(cols * rows);
  L.spawn = { x: sx + 0.5, y: sy + 0.5 };
  L.hole = { x: tx + 0.5, y: ty + 0.5 };

  var path = shortestPath(g, cols, rows, sx, sy, tx, ty) || [];
  var onPath = {}, pathIndex = {};
  for (var p = 0; p < path.length; p++) {
    var pi = path[p][1] * cols + path[p][0];
    onPath[pi] = 1; pathIndex[pi] = p;
  }
  L.pathLen = Math.max(4, path.length);
  L.par = Math.max(8, Math.ceil(L.pathLen * 0.42) + 2);

  var runs = pathRuns(path);
  function runsLonger(n) {
    return runs.filter(function (r) { return r.len >= n && r.len < path.length - 1; });
  }
  function markRun(r, tile, skipEnds) {
    var a = r.start + (skipEnds ? 1 : 0), b = r.end - (skipEnds ? 1 : 0);
    for (var i = a; i <= b; i++) {
      var cx2 = path[i][0], cy2 = path[i][1], idx = cy2 * cols + cx2;
      if (idx === ty * cols + tx) continue;
      if (!L.tiles[idx] || tile === T_LAVA) L.tiles[idx] = tile;
    }
  }

  var mech = [];

  /* ---- 宝石 ---- */
  if (d >= GATE.gem) {
    var gemCount = d < 0.2 ? (rng() < 0.5 ? 1 : 0) : (d < 0.55 ? (rng() < 0.6 ? 2 : 1) : (rng() < 0.5 ? 2 : 3));
    var distMap = bfs(g, cols, rows, sx, sy);
    var cands = [];
    for (var cy3 = 1; cy3 < rows - 1; cy3++) {
      for (var cx3 = 1; cx3 < cols - 1; cx3++) {
        var ci = cy3 * cols + cx3;
        if (g[ci] !== 0 || onPath[ci]) continue;
        if (cx3 === sx && cy3 === sy) continue;
        var deg = degree(g, cols, rows, cx3, cy3);
        if (deg < 1) continue;
        var sc = (deg === 1 ? 100 : 0) + (distMap[ci] || 0) + (cy3 + cx3) * 0.1;
        cands.push({ x: cx3, y: cy3, sc: sc });
      }
    }
    cands.sort(function (a, b) { return b.sc - a.sc; });
    var used = [];
    for (var q2 = 0; q2 < cands.length && L.gems.length < gemCount; q2++) {
      var c2 = cands[q2], okg = true;
      for (var u = 0; u < used.length; u++) {
        if (Math.abs(used[u].x - c2.x) + Math.abs(used[u].y - c2.y) < 3) { okg = false; break; }
      }
      if (!okg) continue;
      used.push(c2);
      L.gems.push({ x: c2.x + 0.5, y: c2.y + 0.5, got: false, pop: 0 });
    }
    if (L.gems.length) mech.push('宝石');
  }

  /* ---- 检查点 ---- */
  if (d >= GATE.check && path.length > 10) {
    var cps = d > 0.5 ? [0.32, 0.64] : [0.5];
    for (var cp2 = 0; cp2 < cps.length; cp2++) {
      var idx2 = Math.floor(path.length * cps[cp2]);
      var cell = path[clamp(idx2, 1, path.length - 2)];
      var cpi = cell[1] * cols + cell[0];
      if (L.tiles[cpi] === T_LAVA) continue;
      L.checkpoints.push({ x: cell[0] + 0.5, y: cell[1] + 0.5, on: false });
    }
    if (L.checkpoints.length) mech.push('检查点');
  }

  /* ---- 冰面 ---- */
  if (d >= GATE.ice) {
    var longRuns = runsLonger(4);
    var nIce = clamp(Math.round(1 + d * 2.2), 1, 3);
    var iceN = 0;
    for (var ii = 0; ii < nIce && longRuns.length; ii++) {
      var ri = Math.floor(rng() * longRuns.length);
      markRun(longRuns[ri], T_ICE, longRuns[ri].len > 5);
      longRuns.splice(ri, 1); iceN++;
    }
    if (iceN) mech.push('冰面');
  }
  /* ---- 沙地 ---- */
  if (d >= GATE.sand) {
    var sr = runsLonger(3), nSand = clamp(Math.round(1 + d * 1.8), 1, 3), sandN = 0;
    for (var s2 = 0; s2 < nSand && sr.length; s2++) {
      var rr = sr.splice(Math.floor(rng() * sr.length), 1)[0];
      markRun(rr, T_SAND, false); sandN++;
    }
    if (sandN) mech.push('沙地');
  }
  /* ---- 流沙 ---- */
  if (d >= GATE.quick) {
    var qn = 0, target = clamp(Math.round(1 + d * 2), 1, 3);
    for (var t2 = 0; t2 < 260 && qn < target; t2++) {
      var qx = 1 + Math.floor(rng() * (cols - 2)), qy = 1 + Math.floor(rng() * (rows - 2));
      var qi = qy * cols + qx;
      if (g[qi] !== 0 || onPath[qi]) continue;
      if (degree(g, cols, rows, qx, qy) < 2) continue;
      L.tiles[qi] = T_QUICK; qn++;
    }
    if (qn) mech.push('流沙');
  }
  /* ---- 碎石 ---- */
  if (d >= GATE.rub) {
    var rb = 0, rt = clamp(Math.round(1 + d * 2.5), 1, 4);
    for (var r3 = 0; r3 < 500 && rb < rt; r3++) {
      var wx = 1 + Math.floor(rng() * (cols - 2)), wy = 1 + Math.floor(rng() * (rows - 2));
      var wi = wy * cols + wx;
      if (g[wi] !== 1) continue;
      var horiz = openAt(g, cols, rows, wx - 1, wy) && openAt(g, cols, rows, wx + 1, wy);
      var vert = openAt(g, cols, rows, wx, wy - 1) && openAt(g, cols, rows, wx, wy + 1);
      if (!horiz && !vert) continue;
      if (L.rub[wi]) continue;
      L.rub[wi] = 1; rb++;
    }
    if (rb) mech.push('碎石');
  }
  /* ---- 磁铁 ---- */
  if (d >= GATE.magnet) {
    var mgc = 0, mt = clamp(Math.round(1 + d * 1.2), 1, 2);
    for (var m3 = 0; m3 < 320 && mgc < mt; m3++) {
      var mx = 1 + Math.floor(rng() * (cols - 2)), my = 1 + Math.floor(rng() * (rows - 2));
      var mi = my * cols + mx;
      if (g[mi] !== 0 || onPath[mi]) continue;
      if (degree(g, cols, rows, mx, my) < 2) continue;
      L.magnets.push({
        x: mx + 0.5, y: my + 0.5, strength: 5 + Math.floor(rng() * 2),
        pol: rng() < 0.62 ? 1 : -1, radius: 3
      });
      mgc++;
    }
    if (mgc) mech.push('磁铁');
  }
  /* ---- 弹跳板 ---- */
  if (d >= GATE.bumper) {
    var bp2 = 0, bt = clamp(Math.round(1 + d * 1.6), 1, 3);
    for (var b2 = 0; b2 < 320 && bp2 < bt; b2++) {
      var bx = 1 + Math.floor(rng() * (cols - 2)), by = 1 + Math.floor(rng() * (rows - 2));
      var bi2 = by * cols + bx;
      if (g[bi2] !== 0 || onPath[bi2]) continue;
      if (degree(g, cols, rows, bx, by) < 2) continue;
      L.bumpers.push({ x: bx + 0.5, y: by + 0.5, r: 0.38, hit: 0 });
      bp2++;
    }
    if (bp2) mech.push('弹跳板');
  }
  /* ---- 加速带 ---- */
  if (d >= GATE.boost) {
    var br = runsLonger(3), bn = 0, bt2 = clamp(Math.round(1 + d), 1, 2);
    for (var b4 = 0; b4 < bt2 && br.length; b4++) {
      var rrr = br.splice(Math.floor(rng() * br.length), 1)[0];
      var mid = clamp(rrr.start + Math.floor(rrr.len / 2), 0, path.length - 1);
      var c3 = path[mid];
      if (L.tiles[c3[1] * cols + c3[0]] === T_LAVA) continue;
      L.boosters.push({ x: c3[0] + 0.5, y: c3[1] + 0.5, dx: rrr.dx, dy: rrr.dy });
      bn++;
    }
    if (bn) mech.push('加速带');
  }
  /* ---- 风扇 ---- */
  if (d >= GATE.fan) {
    var fn = 0, ft = clamp(Math.round(1 + (d - GATE.fan) * 6), 1, 2);
    for (var f2 = 0; f2 < 260 && fn < ft; f2++) {
      var fx = 2 + Math.floor(rng() * (cols - 4)), fy = 2 + Math.floor(rng() * (rows - 4));
      if (g[fy * cols + fx] !== 0) continue;
      if (degree(g, cols, rows, fx, fy) < 3) continue;
      var dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var d4 = pick(rng, dirs4);
      /* 风扇区域必须整块是地板，避免画到墙上 */
      var areaOk = true;
      for (var ay2 = fy - 1; ay2 <= fy + 1; ay2++) {
        for (var ax2 = fx - 1; ax2 <= fx + 1; ax2++) {
          if (!openAt(g, cols, rows, ax2, ay2)) areaOk = false;
        }
      }
      if (!areaOk) continue;
      L.fans.push({ x: fx - 0.5, y: fy - 0.5, w: 3, h: 3, dx: d4[0], dy: d4[1] });
      fn++;
    }
    if (fn) mech.push('风扇');
  }
  /* ---- 移动平台 ---- */
  if (d >= GATE.mover) {
    var mv = 0, mvt = clamp(Math.round(1 + (d - GATE.mover) * 6), 1, 2);
    for (var v2 = 2; v2 < path.length - 3 && mv < mvt; v2++) {
      var c4 = path[v2], vx2 = c4[0], vy2 = c4[1];
      var hCorr = openAt(g, cols, rows, vx2 - 1, vy2) && openAt(g, cols, rows, vx2 + 1, vy2) &&
        !openAt(g, cols, rows, vx2, vy2 - 1) && !openAt(g, cols, rows, vx2, vy2 + 1);
      var vCorr = openAt(g, cols, rows, vx2, vy2 - 1) && openAt(g, cols, rows, vx2, vy2 + 1) &&
        !openAt(g, cols, rows, vx2 - 1, vy2) && !openAt(g, cols, rows, vx2 + 1, vy2);
      var pdx = 0, pdy = 0;
      if (hCorr) {
        var py = rng() < 0.5 ? -1 : 1;
        if (vy2 + py < 1 || vy2 + py > rows - 2) py = -py;
        if (vy2 + py < 1 || vy2 + py > rows - 2) continue;
        var wi2 = (vy2 + py) * cols + vx2;
        if (g[wi2] !== 1 || L.rub[wi2]) continue;
        g[wi2] = 0; pdy = py;
      } else if (vCorr) {
        var px3 = rng() < 0.5 ? -1 : 1;
        if (vx2 + px3 < 1 || vx2 + px3 > cols - 2) px3 = -px3;
        if (vx2 + px3 < 1 || vx2 + px3 > cols - 2) continue;
        var wi3 = vy2 * cols + (vx2 + px3);
        if (g[wi3] !== 1 || L.rub[wi3]) continue;
        g[wi3] = 0; pdx = px3;
      } else continue;
      L.movers.push({
        x: vx2 + 0.5, y: vy2 + 0.5, dx: pdx, dy: pdy,
        period: 2.6 + rng() * 1.6, phase: rng() * 3
      });
      mv++;
    }
    if (mv) mech.push('移动平台');
  }
  /* ---- 伸缩墙 ---- */
  if (d >= GATE.shutter) {
    var shn = 0, sht = clamp(Math.round(1 + (d - GATE.shutter) * 8), 1, 2);
    for (var w2 = 2; w2 < path.length - 3 && shn < sht; w2++) {
      var c5 = path[w2], sx2 = c5[0], sy2 = c5[1];
      var hc = openAt(g, cols, rows, sx2 - 1, sy2) && openAt(g, cols, rows, sx2 + 1, sy2) &&
        !openAt(g, cols, rows, sx2, sy2 - 1) && !openAt(g, cols, rows, sx2, sy2 + 1);
      var vc = openAt(g, cols, rows, sx2, sy2 - 1) && openAt(g, cols, rows, sx2, sy2 + 1) &&
        !openAt(g, cols, rows, sx2 - 1, sy2) && !openAt(g, cols, rows, sx2 + 1, sy2);
      if (!hc && !vc) continue;
      if (L.shutters[sy2 * cols + sx2]) continue;
      L.shutters[sy2 * cols + sx2] = { period: 2.6, phase: rng() * 2.6, t: 0 };
      shn++;
    }
    if (shn) mech.push('伸缩墙');
  }
  /* ---- 熔岩：只在非主路上 ---- */
  if (d >= GATE.lava) {
    var lv = 0, nLava = clamp(Math.round(2 + (d - GATE.lava) * 40), 2, 7);
    for (var l2 = 0; l2 < 700 && lv < nLava; l2++) {
      var lx = 1 + Math.floor(rng() * (cols - 2)), ly = 1 + Math.floor(rng() * (rows - 2));
      var li = ly * cols + lx;
      if (g[li] !== 0 || onPath[li]) continue;
      if (Math.abs(lx - sx) + Math.abs(ly - sy) < 4) continue;
      if (L.tiles[li] !== 0) continue;
      var onGem = false;
      for (var gg = 0; gg < L.gems.length; gg++) {
        if (Math.floor(L.gems[gg].x) === lx && Math.floor(L.gems[gg].y) === ly) { onGem = true; break; }
      }
      if (onGem) continue;
      L.tiles[li] = T_LAVA; lv++;
    }
    if (lv) mech.push('熔岩');
  }
  /* ---- 压力板 + 门（踏板必须在门之前）---- */
  if (d >= GATE.plate) {
    var dn = 0, dnt = clamp(Math.round(1 + (d - GATE.plate) * 8), 1, 2);
    for (var dn2 = 0; dn2 < 400 && dn < dnt; dn2++) {
      var dx2 = 1 + Math.floor(rng() * (cols - 2)), dy2 = 1 + Math.floor(rng() * (rows - 2));
      var di = dy2 * cols + dx2;
      if (g[di] !== 1 || L.rub[di]) continue;
      var dh = openAt(g, cols, rows, dx2 - 1, dy2) && openAt(g, cols, rows, dx2 + 1, dy2);
      var dv = openAt(g, cols, rows, dx2, dy2 - 1) && openAt(g, cols, rows, dx2, dy2 + 1);
      if (!dh && !dv) continue;
      /* 门在主路径上的最近位置，踏板必须更早 */
      var nearIdx = -1;
      for (var pp = 1; pp < path.length; pp++) {
        var dd2 = Math.abs(path[pp][0] - dx2) + Math.abs(path[pp][1] - dy2);
        if (dd2 <= 2) { nearIdx = pp; break; }
      }
      if (nearIdx < 2) continue;
      var pc = path[Math.max(1, nearIdx - 2)];
      L.doors[di] = { opened: false, x: dx2, y: dy2, t: 0 };
      L.plates.push({ x: pc[0] + 0.5, y: pc[1] + 0.5, on: false, door: di });
      dn++;
    }
    if (dn) mech.push('压力板');
  }
  /* ---- 重力区 ---- */
  if (d >= GATE.grav) {
    var gr = runsLonger(4), placed = 0;
    for (var g2 = 0; g2 < gr.length && placed < 1; g2++) {
      var run = gr[g2];
      if (run.dy === 0 && run.len >= 4) {
        var cx6 = run.dx > 0 ? run.start : run.end - 1;
        var c6 = path[cx6];
        L.gravs.push({ x: c6[0], y: c6[1], w: run.len - 1, h: 1, dx: run.dx, dy: 0, a: 3.5 });
        placed = 1;
      } else if (run.dx === 0 && run.len >= 4) {
        var cy6 = run.dy > 0 ? run.start : run.end - 1;
        var c7 = path[cy6];
        L.gravs.push({ x: c7[0], y: c7[1], w: 1, h: run.len - 1, dx: 0, dy: run.dy, a: 3.5 });
        placed = 1;
      }
    }
    if (placed) mech.push('重力区');
  }
  /* ---- 传送门 ---- */
  if (d >= GATE.portal && path.length > 16) {
    var ia = Math.floor(path.length * 0.3), ib = Math.floor(path.length * 0.75);
    var ca = path[ia], cb = path[ib];
    L.portals.push({
      ax: ca[0] + 0.5, ay: ca[1] + 0.5,
      bx: cb[0] + 0.5, by: cb[1] + 0.5
    });
    mech.push('传送门');
  }
  /* ---- 迷雾 ---- */
  if (d >= GATE.fog && rng() < 0.35) { L.fog = true; mech.push('迷雾'); }

  L.desc = mech.length ? mech.join(' · ') : '基础移动';
  return { L: L, path: path };
}

/* ---------- 固定关卡（11-310） ---------- */
function generateLevel(id) {
  id = clamp(Math.round(id), 1, TOTAL_LEVELS);
  if (id <= TUT_N) {
    var T = tutorialLevel(id);
    var tp = shortestPath(T.grid, T.cols, T.rows,
      Math.floor(T.spawn.x), Math.floor(T.spawn.y),
      Math.floor(T.hole.x), Math.floor(T.hole.y)) || [[1, 1], [2, 1]];
    T.par = Math.max(8, Math.ceil(Math.max(4, tp.length) * 0.42) + 3);
    T.pathLen = tp.length;
    T.dval = Math.round((0.1 + (id - 1) * 0.06) * 10) / 10;
    fixGems(T);
    return T;
  }
  var n = id - TUT_N;                 // 1..300
  var d = Math.pow((n - 1) / (RANDOM_N - 1), 0.85);
  var baseName = nameFor(n);

  var L = null, path = null;
  for (var attempt = 0; attempt < 6; attempt++) {
    var seed = ((id * 2654435761) % 4294967296 + attempt * 40503) % 4294967296;
    var res = buildRandom(id, d, seed, false);
    if (!validateLevel(res.L, res.path)) continue;
    L = res.L; path = res.path;
    break;
  }
  if (!L) {
    /* 极端兜底：退化为更开阔的一关，保证一定能玩 */
    var res2 = buildRandom(id, Math.max(0, d - 0.25), (id * 7919) % 4294967296, false);
    L = res2.L; path = res2.path;
  }
  L.name = baseName;
  L.dval = Math.round((0.6 + d * 4.4) * 10) / 10;
  fixGems(L);
  return L;
}

/* ---------- 无限模式：按序号无限生成 ---------- */
function generateEndless(n) {
  n = Math.max(1, Math.round(n));
  /* 前 100 层缓慢升到满难度，之后靠随机布局维持挑战 */
  var d = Math.min(1, Math.pow((n - 1) / 100, 0.72));
  var L = null, path = null;
  for (var attempt = 0; attempt < 10; attempt++) {
    var seed = (90001 + n * 7919 + attempt * 104729) % 4294967296;
    var res = buildRandom(0, d, seed, true);
    if (!validateLevel(res.L, res.path)) continue;
    var sig = sigOf(res.L);
    if (SIG_SEEN[sig]) continue;
    SIG_SEEN[sig] = 1;
    L = res.L; path = res.path;
    break;
  }
  if (!L) {
    var res2 = buildRandom(0, Math.max(0, d - 0.3), (90001 + n * 104729) % 4294967296, true);
    L = res2.L; path = res2.path;
  }
  L.ch = 11;
  L.endless = n;
  L.name = '深渊 ' + (n < 10 ? '0' + n : n);
  L.dval = Math.round((0.8 + d * 5.2) * 10) / 10;
  fixGems(L);
  return L;
}

/* 宝石落点兜底：教学关是手写坐标，可能不小心写进墙里；
   随机关也可能因后续机关改动而失效。统一在交付关卡前校正一次。 */
function fixGems(L) {
  var cols = L.cols, rows = L.rows, g = L.grid, used = {};
  for (var i = 0; i < L.gems.length; i++) {
    var gm = L.gems[i];
    var gx = Math.floor(gm.x), gy = Math.floor(gm.y);
    var idx = gy * cols + gx;
    var inBoard = gx > 0 && gy > 0 && gx < cols - 1 && gy < rows - 1;
    var ok = inBoard && g[idx] === 0 && L.tiles[idx] !== T_LAVA &&
      !(Math.abs(gm.x - L.hole.x) < 0.7 && Math.abs(gm.y - L.hole.y) < 0.7);
    if (ok && !used[idx]) { used[idx] = 1; continue; }

    var best = null, bk = -1, bd = 1e9;
    for (var y = 1; y < rows - 1; y++) {
      for (var x = 1; x < cols - 1; x++) {
        var k = y * cols + x;
        if (g[k] !== 0 || used[k] || L.tiles[k] === T_LAVA) continue;
        var cx = x + 0.5, cy = y + 0.5;
        if (Math.abs(cx - L.hole.x) < 0.7 && Math.abs(cy - L.hole.y) < 0.7) continue;
        var d = (cx - gm.x) * (cx - gm.x) + (cy - gm.y) * (cy - gm.y);
        if (d < bd) { bd = d; best = [cx, cy]; bk = k; }
      }
    }
    if (best) { gm.x = best[0]; gm.y = best[1]; used[bk] = 1; }
  }
}

/* ---------- 背景选择 ----------
   章节主题 + 关卡种子：同章多数关共用一套风景（视觉统一），
   约三分之一关卡换图，并叠加不同的取景偏移，避免"每关都一个样"。 */
var BG_THEME = [0, 0, 5, 1, 2, 3, 4, 2, 4, 1, 5];

function bgForLevel(L) {
  if (typeof BG_DATA === 'undefined' || !BG_DATA.length) return -1;
  var ch = clamp(L.ch || 1, 1, BG_THEME.length);
  var base = BG_THEME[ch - 1];
  var seed = L.endless ? (7000 + L.endless * 131) : (L.id * 977 + 31);
  var r = mulberry32(seed)();
  if (r < 0.64) return base % BG_DATA.length;
  return Math.floor(mulberry32(seed + 17)() * BG_DATA.length) % BG_DATA.length;
}
