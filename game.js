// Lacobriga Survival · prototype 0.1 (20/11/2026)
// One file on purpose: plain JavaScript, no build step, runs from GitHub Pages or straight from disk.
(() => {
'use strict';

// ---------- constants ----------
const W = 32, H = 48;                       // map size in tiles (portrait)
const T = { GRASS: 0, SCRUB: 1, FOREST: 2, ROCK: 3, SAND: 4, MARSH: 5, RIVER: 6, SEA: 7 };
const SAVE_KEY = 'lacobriga.save.v1';
const SET_KEY = 'lacobriga.settings.v1';
const RES = ['food', 'water', 'fire', 'logs', 'stone'];
const ICON = { food: '🍲', water: '💧', fire: '🔥', logs: '🪵', stone: '🪨', people: '👥' };

// Season order: 0 spring (Mar-May), 1 summer, 2 autumn, 3 winter. Month index 0 = March.
const RIVER_FLOW = [120, 15, 60, 200];
const FISH_SEASON = [1, 1, 0.8, 0.5];
const GATHER_SEASON = [4, 4, 8, 1];
const FIRE_SEASON = [1, 0.25, 1, 2];
const MONTH_SOW = 8;      // November
const MONTH_HARVEST = 2;  // May
const WATER_CAP = 40;     // jars and skins in the homes; cisterns will raise it (full version)

const DIFF = {
  gentle: { stock: 1.5, drought: 0.10, leave: true, hurt: 0.6 },
  fair:   { stock: 1.0, drought: 0.25, leave: false, hurt: 1 },
  harsh:  { stock: 0.7, drought: 0.40, leave: false, hurt: 1.2 },
};

const DEFS = {
  house:      { w: 2, h: 2, logs: 16, stone: 4,  work: 3, max: 0, ico: '🛖' },
  fisher:     { w: 2, h: 2, logs: 14, stone: 0,  work: 2, max: 2, ico: '🎣', rule: 'water' },
  gatherer:   { w: 2, h: 2, logs: 12, stone: 0,  work: 2, max: 2, ico: '🧺', rule: 'wild' },
  well:       { w: 1, h: 1, logs: 4,  stone: 12, work: 3, max: 1, ico: '🪣' },
  field:      { w: 4, h: 4, logs: 0,  stone: 0,  work: 1, max: 3, ico: '🌾' },
  woodcutter: { w: 2, h: 2, logs: 10, stone: 2,  work: 2, max: 2, ico: '🪓', rule: 'trees' },
  quarry:     { w: 2, h: 2, logs: 10, stone: 0,  work: 2, max: 2, ico: '⛏️', rule: 'rock' },
  granary:    { w: 2, h: 2, logs: 20, stone: 10, work: 4, max: 0, ico: '🏺' },
};

const NAMES_M = ['Ambatus','Camalus','Boutius','Tancinus','Caturo','Reburrus','Apilus','Tongius','Medamus','Pintamus','Doquirus','Celtius','Arcius','Talabus','Cilius','Aplonius','Malgeinus','Clutamus','Sunua','Viriatus','Balaesus','Cadarus','Elaesus','Lovesius'];
const NAMES_F = ['Camira','Boutia','Ambata','Tancina','Reburra','Caturia','Arcia','Celtia','Medama','Pintama','Apana','Toncia','Allucia','Cloutina','Ladronia','Maelia','Talava','Visalia','Amoena','Clouta','Sunta','Aebura','Cusia','Lubaena'];

// ---------- settings & text ----------
let settings = { lang: (navigator.language || 'pt').startsWith('pt') ? 'pt' : 'en', tutorial: true, diff: 'gentle', view: '3d' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {}
function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }
function t(key, p) {
  const L = I18N[settings.lang] || I18N.en;
  let s = L[key] !== undefined ? L[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key);
  if (typeof s === 'string' && p) s = s.replace(/\{(\w+)\}/g, (_, k) => (p[k] !== undefined ? p[k] : ''));
  return s;
}
function applyStaticText() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('btnLang').textContent = t('langBtn');
  $('elderSkip').textContent = t('skip');
}
const $ = id => document.getElementById(id);

// ---------- random ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
const rnd = Math.random;
const pick = (arr, r = rnd) => arr[Math.floor(r() * arr.length)];

// ---------- state ----------
let S = null;          // whole game state (saved as JSON)
let tiles, trees, occ; // typed arrays rebuilt from S

function idx(x, y) { return y * W + x; }
function inMap(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

function generateMap(seed) {
  const r = mulberry32(seed);
  const tl = new Uint8Array(W * H).fill(T.GRASS);
  const tr = new Uint8Array(W * H);
  const ph = r() * 6;
  // sea along the bottom with a wavy shore
  for (let x = 0; x < W; x++) {
    const shore = 41 + Math.round(1.6 * Math.sin(x * 0.33 + ph) + r() * 0.9);
    for (let y = shore; y < H; y++) tl[idx(x, y)] = y <= shore ? T.SAND : T.SEA;
    if (shore - 1 >= 0 && r() < 0.6) tl[idx(x, shore - 1)] = T.SAND;
  }
  // river from the top, down the left side, to the sea
  let rx = 4 + Math.floor(r() * 3);
  for (let y = 0; y < H; y++) {
    if (y % 4 === 0) rx = Math.max(2, Math.min(8, rx + Math.floor(r() * 3) - 1));
    const wide = y > 34 ? 3 : 2;
    for (let k = 0; k < wide; k++) {
      const i = idx(rx + k, y);
      if (tl[i] !== T.SEA) tl[i] = T.RIVER;
    }
    if (y > 30 && y < 41) for (const dx of [-1, wide]) {
      const xx = rx + dx; if (inMap(xx, y) && tl[idx(xx, y)] === T.GRASS && r() < 0.45) tl[idx(xx, y)] = T.MARSH;
    }
  }
  const blob = (cx, cy, rad, type, chance) => {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (!inMap(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) / rad;
      const i = idx(x, y);
      if (d < 1 && tl[i] === T.GRASS && r() < chance * (1.2 - d)) tl[i] = type;
    }
  };
  for (let k = 0; k < 7; k++) blob(10 + r() * 21, 2 + r() * 34, 2.5 + r() * 3, T.SCRUB, 0.9);
  for (let k = 0; k < 7; k++) blob(9 + r() * 22, 1 + r() * 32, 2 + r() * 3.5, T.FOREST, 1.0);
  for (let k = 0; k < 3; k++) blob(12 + r() * 18, 4 + r() * 28, 1.2 + r() * 1.3, T.ROCK, 1.1);
  // keep the town site on the hill fairly open
  for (let y = 18; y < 25; y++) for (let x = 13; x < 20; x++) if (tl[idx(x, y)] !== T.ROCK) tl[idx(x, y)] = T.GRASS;
  for (let i = 0; i < W * H; i++) if (tl[i] === T.FOREST) tr[i] = 1;
  return { tl, tr };
}

function newGame(diff) {
  const seed = Math.floor(Math.random() * 1e9);
  const m = generateMap(seed);
  const D = DIFF[diff];
  S = {
    v: 1, seed, diff, day: 0, month: 0, year: 1, nextId: 1,
    stock: { food: Math.round(70 * D.stock), water: Math.round(60 * D.stock), fire: Math.round(40 * D.stock), logs: Math.round(60 * D.stock), stone: Math.round(20 * D.stock) },
    last: null, buildings: [], people: [], families: [], log: [], chronicle: [],
    drought: false, storm: false, maxPop: 0, thirstYear: -99, tut: settings.tutorial ? 0 : 99,
    tiles: '', trees: '', over: false,
  };
  tiles = m.tl; trees = m.tr; occ = new Int32Array(W * H).fill(-1);
  // two roundhouses already standing on the hill
  addBuilding('house', 14, 19, true);
  addBuilding('house', 17, 20, true);
  // three families: 3 couples + 4 children
  const kids = [2, 1, 1];
  for (let f = 0; f < 3; f++) {
    const fam = { id: S.nextId++, home: -1 };
    S.families.push(fam);
    addPerson('m', 20 + Math.floor(rnd() * 14), fam.id);
    addPerson('f', 19 + Math.floor(rnd() * 12), fam.id);
    for (let k = 0; k < kids[f]; k++) addPerson(rnd() < 0.5 ? 'm' : 'f', 2 + Math.floor(rnd() * 9), fam.id);
  }
  assignHomes();
  S.last = { ...S.stock };
  S.maxPop = S.people.length;
  camera.x = 16; camera.y = 21; camera.zoom = viewW / 12;
  terrainDirty = true;
  saveGame();
}

function addPerson(sex, age, famId) {
  const p = { id: S.nextId++, name: pick(sex === 'm' ? NAMES_M : NAMES_F), sex, age, fam: famId, job: -1, health: 100, x: 16, y: 21 };
  S.people.push(p);
  return p;
}

function addBuilding(type, x, y, done) {
  const d = DEFS[type];
  const b = { id: S.nextId++, type, x, y, done: !!done, progress: done ? d.work : 0, workers: [], mode: 'logs', sown: false };
  S.buildings.push(b);
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    const i = idx(xx, yy);
    if (trees[i]) { trees[i] = 0; S.stock.logs += 3; }
    if (tiles[i] === T.ROCK) { S.stock.stone += 2; }
    if (tiles[i] === T.FOREST || tiles[i] === T.ROCK || tiles[i] === T.SCRUB) tiles[i] = T.GRASS;
    occ[i] = b.id;
  }
  terrainDirty = true;
  return b;
}

function removeBuilding(b) {
  const d = DEFS[b.type];
  for (const pid of b.workers) { const p = personById(pid); if (p) p.job = -1; }
  for (let yy = b.y; yy < b.y + d.h; yy++) for (let xx = b.x; xx < b.x + d.w; xx++) occ[idx(xx, yy)] = -1;
  S.buildings = S.buildings.filter(o => o !== b);
  for (const f of S.families) if (f.home === b.id) f.home = -1;
  assignHomes();
}

const personById = id => S.people.find(p => p.id === id);
const buildingById = id => S.buildings.find(b => b.id === id);
const famOf = p => S.families.find(f => f.id === p.fam);
const isAdult = p => p.age >= 14 && p.age < 56;
const center = b => ({ x: b.x + DEFS[b.type].w / 2, y: b.y + DEFS[b.type].h / 2 });
function homeOf(p) { const f = famOf(p); return f && f.home >= 0 ? buildingById(f.home) : null; }
function seasonOf(m) { return Math.floor(m / 3); }

function assignHomes() {
  const houses = S.buildings.filter(b => b.type === 'house' && b.done);
  const used = new Set(S.families.filter(f => f.home >= 0).map(f => f.home));
  for (const f of S.families) {
    if (f.home >= 0 && !houses.find(h => h.id === f.home)) f.home = -1;
    if (f.home < 0) { const h = houses.find(h => !used.has(h.id)); if (h) { f.home = h.id; used.add(h.id); } }
  }
}

// ---------- placement rules ----------
function countNear(cx, cy, rad, test) {
  let n = 0;
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
    if (inMap(x, y) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= rad && test(idx(x, y))) n++;
  return n;
}
function canPlace(type, x, y) {
  const d = DEFS[type];
  for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
    if (!inMap(xx, yy)) return 'blocked';
    const tt = tiles[idx(xx, yy)];
    if (tt === T.SEA || tt === T.RIVER || tt === T.MARSH || occ[idx(xx, yy)] >= 0) return 'blocked';
  }
  const cx = x + d.w / 2, cy = y + d.h / 2;
  if (d.rule === 'water') {
    let ok = false;
    for (let yy = y - 1; yy <= y + d.h; yy++) for (let xx = x - 1; xx <= x + d.w; xx++)
      if (inMap(xx, yy) && (tiles[idx(xx, yy)] === T.SEA || tiles[idx(xx, yy)] === T.RIVER)) ok = true;
    if (!ok) return 'needWater';
  }
  if (d.rule === 'rock' && countNear(cx, cy, 3.5, i => tiles[i] === T.ROCK) < 2) return 'needRock';
  if (d.rule === 'trees' && countNear(cx, cy, 6, i => trees[i]) < 6) return 'needTrees';
  if (d.rule === 'wild' && countNear(cx, cy, 6, i => tiles[i] === T.FOREST || tiles[i] === T.SCRUB) < 8) return 'needWild';
  if (S.stock.logs < d.logs || S.stock.stone < d.stone) return 'cost';
  return null;
}

// ---------- simulation ----------
function workEff(p, b) {
  const h = homeOf(p); let dist = 8;
  if (h) { const a = center(h), c = center(b); dist = Math.hypot(a.x - c.x, a.y - c.y); }
  return Math.max(0.5, 1 - 0.03 * dist) * (p.health < 50 ? 0.5 : 1);
}

function dayTick() {
  // construction: free adults build, up to 4 per site
  const free = S.people.filter(p => isAdult(p) && p.job < 0);
  const sites = S.buildings.filter(b => !b.done);
  let i = 0;
  for (const b of sites) {
    const n = Math.min(4, free.length - i);
    if (n <= 0) break;
    b.progress += n / 30;
    for (let k = 0; k < n; k++) free[i + k].site = b.id;
    i += n;
    if (b.progress >= DEFS[b.type].work) {
      b.done = true; b.progress = DEFS[b.type].work;
      toast(t('built', { b: t('b_' + b.type) }));
      if (b.type === 'house') assignHomes();
    }
  }
  for (let k = i; k < free.length; k++) free[k].site = -1;

  S.day++;
  if (S.day >= 30) { S.day = 0; monthTick(); }
}

function monthTick() {
  const st = S.stock, se = seasonOf(S.month), D = DIFF[S.diff];
  const before = { ...st };
  const foodTypes = new Set();
  const hasGranary = S.buildings.some(b => b.type === 'granary' && b.done);

  // events
  S.storm = se === 3 && rnd() < 0.3;
  if (S.storm) toast(t('storm'));

  // production
  for (const b of S.buildings) {
    if (!b.done) continue;
    const ws = b.workers.map(personById).filter(Boolean);
    const eff = ws.reduce((a, p) => a + workEff(p, b), 0);
    switch (b.type) {
      case 'fisher': { const v = 6 * eff * FISH_SEASON[se] * (S.storm ? 0 : 1); if (v > 0) { st.food += v; foodTypes.add('fish'); } break; }
      case 'gatherer': { const v = GATHER_SEASON[se] * eff; if (v > 0) { st.food += v; foodTypes.add('wild'); } break; }
      case 'well': st.water += (S.drought && se === 1 ? 12 : 25) * Math.min(1, eff); break;
      case 'quarry': st.stone += 4 * eff; break;
      case 'woodcutter': {
        if (b.mode === 'fire') { const use = Math.min(st.logs, 2 * eff); st.logs -= use; st.fire += use * 4; }
        else {
          const c = center(b); let want = Math.round(8 * eff), got = 0;
          for (let y = Math.floor(c.y - 6); y <= c.y + 6 && got < want; y++) for (let x = Math.floor(c.x - 6); x <= c.x + 6 && got < want; x++) {
            if (!inMap(x, y)) continue; const k = idx(x, y);
            if (trees[k] && occ[k] < 0) { trees[k] = 0; tiles[k] = T.SCRUB; got += 5; terrainDirty = true; }
          }
          st.logs += Math.min(got, 8 * eff);
        }
        break;
      }
      case 'field':
        if (S.month === MONTH_SOW) b.sown = ws.length > 0;
        if (S.month === MONTH_HARVEST && b.sown) {
          const v = Math.round(40 * Math.max(1, eff) * (S.drought ? 0.5 : 1));
          st.food += v; foodTypes.add('grain'); b.sown = false; toast(t('harvest', { n: v })); terrainDirty = true;
        }
        break;
    }
  }
  if (S.month === MONTH_SOW) {
    const fields = S.buildings.filter(b => b.type === 'field' && b.done);
    if (fields.length) { if (fields.some(f => f.sown)) logMsg(t('sown')); else logMsg(t('notSown')); terrainDirty = true; }
  }
  // trees spread slowly into open land next to other trees
  for (let k = 0; k < 60; k++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H), i = idx(x, y);
    if (trees[i] || occ[i] >= 0 || (tiles[i] !== T.GRASS && tiles[i] !== T.SCRUB)) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inMap(x + dx, y + dy) && trees[idx(x + dx, y + dy)]);
    if (near && rnd() < 0.3) { trees[i] = 1; tiles[i] = T.FOREST; terrainDirty = true; }
  }
  // the river (only reachable if any home is within 12 tiles of it, which is always true on this map)
  st.water += (se === 1 && S.drought) ? 0 : RIVER_FLOW[se];

  // consumption
  const pop = S.people.length;
  const houses = S.families.filter(f => f.home >= 0).length;
  const short = {};
  const take = (res, need) => { if (need <= 0) return 0; const got = Math.min(st[res], need); st[res] -= got; return (need - got) / need; };
  short.food = take('food', pop);
  short.water = take('water', pop);
  short.fire = take('fire', houses * FIRE_SEASON[se]);
  S.lastShort = short;

  // storage caps and spoilage
  const foodCap = 100 + 400 * S.buildings.filter(b => b.type === 'granary' && b.done).length;
  st.food = Math.min(foodCap, st.food * (hasGranary ? 0.995 : 0.98));
  st.water = Math.min(WATER_CAP, st.water);
  for (const k of ['logs', 'stone', 'fire']) st[k] = Math.min(400, st[k]);

  // health
  for (const p of S.people) {
    let dh = 0, cause = null;
    if (short.food > 0) { dh -= 25 * short.food; cause = 'hunger'; }
    if (short.water > 0) { dh -= 35 * short.water; cause = 'thirst'; }
    if (short.fire > 0 && homeOf(p)) { dh -= 15 * short.fire; cause = cause || 'cold'; }
    if (!homeOf(p)) { dh -= [5, 0, 5, 20][se]; if (se !== 1) cause = cause || 'exposure'; }
    if (dh < 0) dh *= D.hurt;
    if (dh === 0) dh = 10 + (foodTypes.size >= 2 ? 5 : 0);
    p.health = Math.max(0, Math.min(100, p.health + dh));
    if (p.health <= 0) p.dieCause = cause || 'hunger';
  }
  // deaths (or leaving, on Gentle)
  for (const p of S.people.filter(p => p.health <= 0)) {
    if (D.leave) { p.health = 1; continue; }
    killPerson(p, p.dieCause);
  }
  if (D.leave) {
    const weak = S.people.filter(p => p.health <= 1);
    for (const p of weak) { if (rnd() < 0.5) { logMsg(t('left', { name: p.name }), true); removePerson(p); } }
  }

  // births
  const plenty = st.food >= pop * 2 && st.water >= pop * 1.5;
  for (const f of S.families) {
    if (f.home < 0 || !plenty) continue;
    const mem = S.people.filter(p => p.fam === f.id);
    const mom = mem.find(p => p.sex === 'f' && p.age >= 16 && p.age <= 42);
    const dad = mem.find(p => p.sex === 'm' && p.age >= 16);
    if (mom && dad && mem.length < 5 && rnd() < 0.08) {
      const baby = addPerson(rnd() < 0.5 ? 'm' : 'f', 0, f.id);
      const h = homeOf(baby); if (h) { const c = center(h); baby.x = c.x; baby.y = c.y; }
      logMsg(t('born', { name: baby.name }));
    }
  }

  // next month
  S.month++;
  if (S.month >= 12) { S.month = 0; newYear(); }
  if (S.month === 0) {
    // spring: forecast this year's summer
    S.drought = rnd() < D.drought;
    if (S.drought) { logMsg(t('droughtForecast')); toast(t('droughtForecast')); }
  }
  if (S.month === 3 && S.drought) toast(t('drought'));
  if (S.month === 0 && S.year > 1 && S.year - S.thirstYear > 2 && st.food >= S.people.length * 2 && rnd() < 0.5) newcomers();

  S.last = before;
  S.maxPop = Math.max(S.maxPop, S.people.length);
  warnedThisMonth = {};
  if (S.people.length === 0) return gameOver();
  terrainDirty = true; // season colours
  saveGame();
}

function newYear() {
  S.year++;
  for (const p of S.people.slice()) {
    p.age++;
    if (p.age >= 56 && p.job >= 0) unassign(p);
    if (p.age >= 70 || (p.age >= 56 && rnd() < 0.08)) killPerson(p, 'age');
  }
  logMsg(t('newYear', { y: S.year }));
}

function newcomers() {
  const fam = { id: S.nextId++, home: -1 };
  S.families.push(fam);
  const n = 2 + Math.floor(rnd() * 3);
  addPerson('m', 18 + Math.floor(rnd() * 15), fam.id);
  addPerson('f', 18 + Math.floor(rnd() * 12), fam.id);
  for (let k = 2; k < n; k++) addPerson(rnd() < 0.5 ? 'm' : 'f', 1 + Math.floor(rnd() * 10), fam.id);
  for (const p of S.people.filter(p => p.fam === fam.id)) { p.x = 16; p.y = 1; }
  assignHomes();
  logMsg(t('arrived', { n }));
  toast(t('arrived', { n }));
}

function unassign(p) {
  const b = buildingById(p.job);
  if (b) b.workers = b.workers.filter(id => id !== p.id);
  p.job = -1;
}
function removePerson(p) {
  unassign(p);
  S.people = S.people.filter(o => o !== p);
  const left = S.people.filter(o => o.fam === p.fam);
  if (left.length === 0) S.families = S.families.filter(f => f.id !== p.fam);
  else if (!left.some(isAdult) && !left.some(o => o.age >= 56)) {
    // orphans join the smallest housed family
    const other = S.families.filter(f => f.id !== p.fam && f.home >= 0).sort((a, b) => famSize(a) - famSize(b))[0];
    if (other) { for (const o of left) o.fam = other.id; S.families = S.families.filter(f => f.id !== p.fam); }
  }
  assignHomes();
}
const famSize = f => S.people.filter(p => p.fam === f.id).length;
function killPerson(p, cause) {
  if (cause === 'thirst') S.thirstYear = S.year;
  logMsg(t('died', { name: p.name, cause: t(cause) }), true);
  removePerson(p);
}

function logMsg(text, important) {
  const line = `${t('seasons')[seasonOf(S.month)]} ${t('year')}${S.year} · ${text}`;
  S.log.unshift(line); S.log.length = Math.min(S.log.length, 40);
  if (important) { S.chronicle.unshift(line); S.chronicle.length = Math.min(S.chronicle.length, 60); toast(text); }
}

function gameOver() {
  S.over = true; paused = true; saveGame();
  $('overBody').innerHTML = `<h1 style="font-size:26px">${t('overTitle')}</h1>
    <p>${t('overYears', { y: S.year })}<br>${t('overMost', { n: S.maxPop })}</p>
    <h3 style="text-align:left">${t('overLast')}</h3>
    <div class="log" style="text-align:left">${S.chronicle.slice(0, 10).map(l => `<div>${esc(l)}</div>`).join('')}</div>
    <button class="big" id="overNew">${t('again')}</button><button class="big alt" id="overTitle">${t('toTitle')}</button>`;
  $('over').hidden = false;
  $('overNew').onclick = () => { $('over').hidden = true; startNew(); };
  $('overTitle').onclick = () => { $('over').hidden = true; showTitle(); };
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- save / load ----------
function saveGame() {
  if (!S) return;
  S.tiles = Array.from(tiles).join('');
  S.trees = Array.from(trees).join('');
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
}
function loadGame() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s || s.v !== 1 || s.over) return false;
    S = s;
    tiles = Uint8Array.from(S.tiles, c => +c);
    trees = Uint8Array.from(S.trees, c => +c);
    occ = new Int32Array(W * H).fill(-1);
    for (const b of S.buildings) { const d = DEFS[b.type]; for (let y = b.y; y < b.y + d.h; y++) for (let x = b.x; x < b.x + d.w; x++) occ[idx(x, y)] = b.id; }
    camera.x = 16; camera.y = 21; camera.zoom = viewW / 12;
    terrainDirty = true;
    return true;
  } catch (e) { return false; }
}
function hasSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return !!(s && s.v === 1 && !s.over); } catch (e) { return false; } }

// ---------- rendering ----------
const cv = $('map'), ctx = cv.getContext('2d');
let viewW = innerWidth, viewH = innerHeight, dpr = 1;
const camera = { x: 16, y: 21, zoom: 32 };
const TS = 32; // pixels per tile in the terrain cache
const terrainCanvas = document.createElement('canvas');
terrainCanvas.width = W * TS; terrainCanvas.height = H * TS;
const tctx = terrainCanvas.getContext('2d');
let terrainDirty = true;
let V3 = null, use3D = false, loading3D = false; // 3D view (view3d.js), loaded on demand

const PAL = {
  grass:  ['#8DB255', '#C9BC74', '#A9AE62', '#7FA84E'],
  scrub:  ['#9FA65A', '#BCA968', '#A39A5A', '#8F9A58'],
  forest: ['#5E8A45', '#8E9050', '#6F8448', '#557F42'],
  rock: '#A39A8E', sand: '#E3CF9A', marsh: '#6F8F6A',
  river: ['#4FB3BF', '#7FBDB0', '#5FB0B5', '#3FA6B8'], riverDry: '#A9B98F',
  sea: '#2F8C9A',
};

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  viewW = innerWidth; viewH = innerHeight;
  cv.width = Math.round(viewW * dpr); cv.height = Math.round(viewH * dpr);
  if (V3) V3.resize(viewW, viewH, dpr);
  clampCamera();
}

// ---------- 3D view switch ----------
// What the 3D view may read. It never changes the game state.
const G = {
  W, H, T, DEFS, PAL, MONTH_HARVEST, camera, terrainCanvas, seasonOf, hash,
  get S() { return S; }, get tiles() { return tiles; }, get trees() { return trees; },
  get placing() { return placing; }, get selected() { return selected; },
  canPlace: (type, x, y) => canPlace(type, x, y),
};
function setView(v) {
  settings.view = v; saveSettings();
  if (v === '3d' && !V3) { load3D(); return; }
  use3D = v === '3d' && !!V3;
  terrainDirty = true;
  clampCamera(); followGhost();
  updateViewUI();
}
function load3D() {
  if (loading3D) return;
  loading3D = true;
  if (S) toast(t('loading3d'));
  import('./vendor/three.module.min.js')
    .then(THREE => {
      V3 = window.createView3D(THREE, G);
      V3.resize(viewW, viewH, dpr);
      loading3D = false;
      if (settings.view === '3d') setView('3d');
    })
    .catch(err => {
      console.warn('3D view unavailable:', err);
      loading3D = false; V3 = null; use3D = false;
      settings.view = 'top'; saveSettings(); updateViewUI();
      if (S) toast(t('no3d'));
    });
}
function updateViewUI() {
  $('btnView').textContent = use3D ? '2D' : '3D';
  $('btnView').setAttribute('aria-label', t('view') + ': ' + (use3D ? t('viewTop') : t('view3d')));
  $('btnRotL').hidden = $('btnRotR').hidden = !use3D;
}
function panBy(dx, dy) { // drag by screen pixels
  if (use3D) {
    const c = Math.cos(V3.yaw), s = Math.sin(V3.yaw), z = camera.zoom, zv = camera.zoom * Math.sin(V3.PITCH);
    camera.x -= (c * dx) / z + (s * dy) / zv;
    camera.y -= (-s * dx) / z + (c * dy) / zv;
  } else { camera.x -= dx / camera.zoom; camera.y -= dy / camera.zoom; }
}

function hash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function drawTerrain() {
  const se = seasonOf(S.month);
  const dryRiver = se === 1 && S.drought;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const tt = tiles[idx(x, y)], px = x * TS, py = y * TS, h = hash(x, y);
    let c;
    switch (tt) {
      case T.GRASS: c = PAL.grass[se]; break;
      case T.SCRUB: c = PAL.scrub[se]; break;
      case T.FOREST: c = PAL.forest[se]; break;
      case T.ROCK: c = PAL.rock; break;
      case T.SAND: c = PAL.sand; break;
      case T.MARSH: c = PAL.marsh; break;
      case T.RIVER: c = dryRiver ? PAL.riverDry : PAL.river[se]; break;
      default: c = PAL.sea;
    }
    tctx.fillStyle = c; tctx.fillRect(px, py, TS, TS);
    // hill shading: lighter toward the hilltop
    if (tt !== T.SEA && tt !== T.RIVER) {
      const d = Math.hypot(x - 16, (y - 21) * 0.8) / 16;
      tctx.fillStyle = `rgba(255,248,230,${Math.max(0, 0.18 - d * 0.18).toFixed(3)})`; tctx.fillRect(px, py, TS, TS);
      tctx.fillStyle = `rgba(0,0,0,${(h * 0.05).toFixed(3)})`; tctx.fillRect(px, py, TS, TS);
    }
    if (tt === T.SCRUB) { tctx.fillStyle = 'rgba(70,80,30,.35)'; for (let k = 0; k < 3; k++) { tctx.beginPath(); tctx.arc(px + hash(x + k, y) * TS, py + hash(x, y + k) * TS, 3, 0, 7); tctx.fill(); } }
    if (tt === T.ROCK) { tctx.fillStyle = '#8a8276'; tctx.beginPath(); tctx.ellipse(px + 10 + h * 10, py + 12 + h * 6, 8, 6, h, 0, 7); tctx.fill(); tctx.fillStyle = '#bcb4a8'; tctx.beginPath(); tctx.ellipse(px + 8 + h * 10, py + 10 + h * 6, 4, 3, 0, 0, 7); tctx.fill(); }
    if (tt === T.SEA || tt === T.RIVER) { tctx.strokeStyle = 'rgba(255,255,255,.18)'; tctx.lineWidth = 1.5; tctx.beginPath(); tctx.moveTo(px + 4 + h * 8, py + 10 + h * 12); tctx.lineTo(px + 14 + h * 8, py + 10 + h * 12); tctx.stroke(); }
    if (tt === T.MARSH) { tctx.strokeStyle = 'rgba(40,70,40,.5)'; tctx.lineWidth = 1.5; for (let k = 0; k < 3; k++) { const ax = px + 6 + k * 9; tctx.beginPath(); tctx.moveTo(ax, py + 24); tctx.lineTo(ax + 2, py + 10); tctx.stroke(); } }
  }
  // trees on top (the 3D view draws its own trees)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (use3D || !trees[idx(x, y)]) continue;
    const h = hash(x, y), px = x * TS + 16 + (h - 0.5) * 8, py = y * TS + 16 + (hash(y, x) - 0.5) * 8, r = 11 + h * 4;
    tctx.fillStyle = 'rgba(0,0,0,.18)'; tctx.beginPath(); tctx.arc(px + 3, py + 4, r, 0, 7); tctx.fill();
    tctx.fillStyle = se === 1 ? '#4D6E35' : '#3F6B3A'; tctx.beginPath(); tctx.arc(px, py, r, 0, 7); tctx.fill();
    tctx.fillStyle = 'rgba(160,200,110,.35)'; tctx.beginPath(); tctx.arc(px - 3, py - 4, r * 0.55, 0, 7); tctx.fill();
  }
  terrainDirty = false;
  if (use3D) V3.terrainChanged();
}

function toScreen(x, y) { return [(x - camera.x) * camera.zoom + viewW / 2, (y - camera.y) * camera.zoom + viewH / 2]; }
function toTile(sx, sy) { return [(sx - viewW / 2) / camera.zoom + camera.x, (sy - viewH / 2) / camera.zoom + camera.y]; }
function clampCamera() {
  camera.zoom = Math.max(viewW / 32, Math.min(viewW / 3, camera.zoom));
  if (use3D) { camera.x = Math.max(1, Math.min(W - 1, camera.x)); camera.y = Math.max(1, Math.min(H - 1, camera.y)); return; }
  const hw = viewW / 2 / camera.zoom, hh = viewH / 2 / camera.zoom;
  camera.x = hw * 2 >= W ? W / 2 : Math.max(hw, Math.min(W - hw, camera.x));
  camera.y = hh * 2 >= H ? H / 2 : Math.max(hh - 3, Math.min(H - hh + 3, camera.y));
}

// placement grid for the top view: tile lines around the ghost, fading out in a circle
function drawPlaceGrid() {
  const d = DEFS[placing.type], z = camera.zoom, big = Math.max(d.w, d.h) / 2;
  const cx = placing.x + d.w / 2, cy = placing.y + d.h / 2, r0 = big + 0.8, r1 = big + 4.5;
  const [sx, sy] = toScreen(cx, cy);
  const bad = !!canPlace(placing.type, placing.x, placing.y), col = bad ? '255,207,196' : '255,246,224';
  const grad = ctx.createRadialGradient(sx, sy, r0 * z, sx, sy, r1 * z);
  grad.addColorStop(0, `rgba(${col},.95)`); grad.addColorStop(1, `rgba(${col},0)`);
  const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(W, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(H, Math.ceil(cy + r1));
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) { const [a, b] = toScreen(x, y0), [, c] = toScreen(x, y1); ctx.moveTo(Math.round(a) + 0.5, b); ctx.lineTo(Math.round(a) + 0.5, c); }
  for (let y = y0; y <= y1; y++) { const [a, b] = toScreen(x0, y), [c] = toScreen(x1, y); ctx.moveTo(a, Math.round(b) + 0.5); ctx.lineTo(c, Math.round(b) + 0.5); }
  ctx.strokeStyle = grad; ctx.lineWidth = 1.5; ctx.stroke();
}

function render() {
  if (V3) V3.setVisible(!!S && use3D);
  if (!S) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#2F8C9A'; ctx.fillRect(0, 0, cv.width, cv.height); return; }
  if (terrainDirty) drawTerrain();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (use3D) { // 3D scene on its own canvas below; this canvas only carries the badges
    V3.render();
    ctx.clearRect(0, 0, viewW, viewH);
    drawBadges((x, y) => V3.project(x, y, 1.45));
    return;
  }
  ctx.fillStyle = PAL.sea; ctx.fillRect(0, 0, viewW, viewH);
  const z = camera.zoom;
  const [ox, oy] = toScreen(0, 0);
  ctx.imageSmoothingEnabled = z < TS;
  ctx.drawImage(terrainCanvas, ox, oy, W * z, H * z);

  if (placing) drawPlaceGrid();
  // buildings
  for (const b of S.buildings) drawBuilding(b, b === selected ? 'sel' : null);
  // ghost while placing
  if (placing) {
    const d = DEFS[placing.type];
    const why = canPlace(placing.type, placing.x, placing.y);
    drawBuilding({ type: placing.type, x: placing.x, y: placing.y, done: true, workers: [], sown: false }, why ? 'bad' : 'good');
  }
  // people
  for (const p of S.people) {
    const [sx, sy] = toScreen(p.x, p.y);
    if (sx < -10 || sy < -10 || sx > viewW + 10 || sy > viewH + 10) continue;
    const r = Math.max(2, z * (p.age < 14 ? 0.1 : 0.14));
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(sx + 1, sy + 1.5, r, 0, 7); ctx.fill();
    ctx.fillStyle = p.health < 40 ? '#c0392b' : (p.sex === 'm' ? '#6d3f22' : '#a8552a');
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 1; ctx.stroke();
  }
  drawBadges((x, y, d) => toScreen(x, y - d.h / 2));
}

// need icons over buildings; where(x, y, def) gives the screen point above a building's centre
function drawBadges(where) {
  const sh = S.lastShort || {};
  const needIco = (sh.water > 0 ? '💧' : '') + (sh.food > 0 ? '🍞' : '') + (sh.fire > 0 ? '🔥' : '');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(14, Math.min(22, camera.zoom * 0.5))}px system-ui`;
  for (const b of S.buildings) {
    if (!b.done) continue;
    const d = DEFS[b.type]; const pt = where(b.x + d.w / 2, b.y + d.h / 2, d);
    if (!pt) continue;
    const [sx, sy] = pt;
    let ico = '';
    if (b.type === 'house') { if (!S.families.some(f => f.home === b.id)) ico = '∅'; else ico = needIco; }
    else if (d.max > 0 && b.workers.length === 0) ico = '👤?';
    else if (b.type === 'woodcutter' && b.mode === 'logs' && countNear(b.x + 1, b.y + 1, 6.5, i => trees[i]) === 0) ico = '🌲?';
    if (ico) { badge(sx, sy - 4, ico); }
  }
}

function badge(x, y, text) {
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(246,239,225,.95)'; roundRect(x - w / 2, y - 12, w, 22, 11); ctx.fill();
  ctx.strokeStyle = '#E8A33D'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#2b2118'; ctx.fillText(text, x, y);
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawBuilding(b, mode) {
  const d = DEFS[b.type], z = camera.zoom;
  const [sx, sy] = toScreen(b.x, b.y); const w = d.w * z, h = d.h * z;
  if (sx > viewW || sy > viewH || sx + w < 0 || sy + h < 0) return;
  ctx.save();
  if (!b.done) ctx.globalAlpha = 0.55;
  if (mode === 'good' || mode === 'bad') ctx.globalAlpha = 0.8;
  const cx = sx + w / 2, cy = sy + h / 2, m = z * 0.12;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  switch (b.type) {
    case 'house': {
      ctx.beginPath(); ctx.arc(cx + 3, cy + 4, w * 0.42, 0, 7); ctx.fill();
      ctx.fillStyle = '#9E958A'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.43, 0, 7); ctx.fill();
      ctx.fillStyle = '#D9B25F'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.37, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(120,85,30,.45)'; ctx.lineWidth = 1;
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * w * 0.37, cy + Math.sin(a) * w * 0.37); ctx.stroke(); }
      ctx.fillStyle = '#8a6a30'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.06, 0, 7); ctx.fill();
      break;
    }
    case 'well': {
      ctx.beginPath(); ctx.arc(cx + 2, cy + 3, w * 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = '#9E958A'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = (S.drought && seasonOf(S.month) === 1) ? '#5d7f86' : '#2F8C9A'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.24, 0, 7); ctx.fill();
      break;
    }
    case 'field': {
      const se = seasonOf(S.month);
      const ripe = b.sown && (S.month <= MONTH_HARVEST || se === 3);
      ctx.fillStyle = b.sown ? (S.month === MONTH_HARVEST - 1 || S.month === MONTH_HARVEST ? '#D9B25F' : '#7FA84E') : '#9A7448';
      if (!ripe && b.sown) ctx.fillStyle = '#93A35A';
      ctx.fillRect(sx + m, sy + m, w - 2 * m, h - 2 * m);
      ctx.strokeStyle = 'rgba(60,40,20,.35)'; ctx.lineWidth = 1.5;
      for (let k = 1; k < 8; k++) { const yy = sy + m + (h - 2 * m) * k / 8; ctx.beginPath(); ctx.moveTo(sx + m * 1.5, yy); ctx.lineTo(sx + w - m * 1.5, yy); ctx.stroke(); }
      ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 2; ctx.strokeRect(sx + m, sy + m, w - 2 * m, h - 2 * m);
      break;
    }
    case 'quarry': {
      ctx.fillRect(sx + m + 3, sy + m + 4, w - 2 * m, h - 2 * m);
      ctx.fillStyle = '#B9B1A5'; ctx.fillRect(sx + m, sy + m, w - 2 * m, h - 2 * m);
      ctx.fillStyle = '#8a8276';
      for (let k = 0; k < 4; k++) ctx.fillRect(sx + m + (k % 2) * w * 0.4 + w * 0.08, sy + m + Math.floor(k / 2) * h * 0.4 + h * 0.08, w * 0.3, h * 0.25);
      break;
    }
    case 'granary': {
      ctx.fillRect(sx + m + 3, sy + m + 4, w - 2 * m, h - 2 * m);
      ctx.fillStyle = '#C9A36B'; ctx.fillRect(sx + m, sy + m, w - 2 * m, h - 2 * m);
      ctx.fillStyle = '#D9B25F'; ctx.fillRect(sx + m * 1.6, sy + m * 1.6, w - 3.2 * m, h - 3.2 * m);
      ctx.strokeStyle = 'rgba(120,85,30,.5)'; ctx.lineWidth = 1;
      for (let k = 1; k < 6; k++) { const xx = sx + m * 1.6 + (w - 3.2 * m) * k / 6; ctx.beginPath(); ctx.moveTo(xx, sy + m * 1.6); ctx.lineTo(xx, sy + h - m * 1.6); ctx.stroke(); }
      break;
    }
    default: { // huts: gatherer, fisher, woodcutter
      ctx.beginPath(); ctx.arc(cx - w * 0.12 + 3, cy - h * 0.08 + 4, w * 0.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#9E958A'; ctx.beginPath(); ctx.arc(cx - w * 0.12, cy - h * 0.08, w * 0.31, 0, 7); ctx.fill();
      ctx.fillStyle = '#CDA457'; ctx.beginPath(); ctx.arc(cx - w * 0.12, cy - h * 0.08, w * 0.26, 0, 7); ctx.fill();
      if (b.type === 'woodcutter') { ctx.fillStyle = '#7a5530'; for (let k = 0; k < 3; k++) ctx.fillRect(sx + w * 0.55, sy + h * (0.55 + k * 0.1), w * 0.35, h * 0.07); }
      if (b.type === 'gatherer') { ctx.fillStyle = '#8a5a2b'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(sx + w * (0.6 + k * 0.12), sy + h * 0.78, w * 0.06, 0, 7); ctx.fill(); } }
      if (b.type === 'fisher') { ctx.strokeStyle = 'rgba(60,40,20,.6)'; ctx.lineWidth = 1; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(sx + w * 0.55, sy + h * (0.55 + k * 0.1)); ctx.lineTo(sx + w * 0.9, sy + h * (0.55 + k * 0.1)); ctx.stroke(); } ctx.fillStyle = '#6d4a2a'; ctx.beginPath(); ctx.ellipse(sx + w * 0.75, sy + h * 0.3, w * 0.16, h * 0.07, 0.3, 0, 7); ctx.fill(); }
      break;
    }
  }
  ctx.restore();
  if (!b.done) { // progress bar
    const p = b.progress / d.work;
    ctx.fillStyle = 'rgba(43,33,24,.8)'; ctx.fillRect(sx + w * 0.1, sy + h - 8, w * 0.8, 6);
    ctx.fillStyle = '#E8A33D'; ctx.fillRect(sx + w * 0.1 + 1, sy + h - 7, (w * 0.8 - 2) * p, 4);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 1; ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2); ctx.setLineDash([]);
  }
  if (mode) {
    ctx.lineWidth = 3; ctx.strokeStyle = mode === 'sel' ? '#fff' : mode === 'good' ? '#4f8a3a' : '#D4483B';
    ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
    if (mode !== 'sel') { ctx.fillStyle = mode === 'good' ? 'rgba(79,138,58,.18)' : 'rgba(212,72,59,.25)'; ctx.fillRect(sx, sy, w, h); }
  }
}

// people movement (visual only: output is calculated from the numbers)
function movePeople(dtGame) {
  const dayFrac = S.day % 1 + 0; // whole days; use a sub-day phase from accumulator
  const phase = (S.day + acc / dayMs) / 30;
  for (const p of S.people) {
    let tx, ty;
    const home = homeOf(p);
    const hc = home ? center(home) : { x: 16, y: 22 };
    const job = p.job >= 0 ? buildingById(p.job) : null;
    const site = p.site >= 0 ? buildingById(p.site) : null;
    const working = (phase * 6) % 1 < 0.7; // several work trips a month
    if (p.age < 14 || p.age >= 56 || !working) { tx = hc.x + Math.sin(p.id * 7 + phase * 20) * 1.2; ty = hc.y + Math.cos(p.id * 3 + phase * 20) * 1.2; }
    else if (job) { const c = center(job); tx = c.x + Math.sin(p.id) * 0.6; ty = c.y + Math.cos(p.id) * 0.6; }
    else if (site) { const c = center(site); tx = c.x + Math.sin(p.id * 5) * 0.8; ty = c.y + Math.cos(p.id * 5) * 0.8; }
    else { tx = hc.x + Math.sin(p.id * 7) * 1.5; ty = hc.y + Math.cos(p.id * 7) * 1.5; }
    const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
    const step = Math.min(dist, dtGame * 4); // 4 tiles per game day
    if (dist > 0.01) { p.x += dx / dist * step; p.y += dy / dist * step; }
  }
}

// ---------- input ----------
const pointers = new Map();
let gesture = null, placing = null, selected = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  if (pointers.size === 1) gesture = { type: 'tap', moved: 0 };
  else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: camera.zoom, a0: Math.atan2(b.y - a.y, b.x - a.x) }; }
});
cv.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId); if (!p || !S) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (gesture && gesture.type === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    camera.zoom = gesture.z0 * d / gesture.d0;
    if (use3D) { // two-finger twist turns the 3D view
      const a1 = Math.atan2(b.y - a.y, b.x - a.x);
      let da = a1 - gesture.a0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      gesture.a0 = a1; V3.twist(da);
    }
    panBy(dx / 2, dy / 2);
    clampCamera(); followGhost();
  } else if (gesture) {
    gesture.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.moved > 8) gesture.type = 'pan';
    if (gesture.type === 'pan') { panBy(dx, dy); clampCamera(); followGhost(); }
  }
});
const endPointer = e => {
  const p = pointers.get(e.pointerId); pointers.delete(e.pointerId);
  if (gesture && gesture.type === 'tap' && p && pointers.size === 0) onTap(e.clientX, e.clientY);
  if (pointers.size === 0) gesture = null;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); gesture = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); camera.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12; clampCamera(); followGhost(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (!S || !$('title').hidden) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { setSpeed(speed === 0 ? 1 : 0); e.preventDefault(); }
  if (k >= '1' && k <= '3') setSpeed(+k);
  if (k === 'escape') { if (placing) cancelPlace(); else closeSheet(); }
  if (use3D && k === 'q') V3.rotate(-1); if (use3D && k === 'e') V3.rotate(1);
  const pan = 2 * camera.zoom; // in screen pixels, so it follows the 3D view's turn
  if (k === 'arrowleft' || k === 'a') panBy(pan, 0); if (k === 'arrowright' || k === 'd') panBy(-pan, 0);
  if (k === 'arrowup' || k === 'w') panBy(0, pan); if (k === 'arrowdown' || k === 's') panBy(0, -pan);
  clampCamera(); followGhost();
});

function onTap(sx, sy) {
  if (!S) return;
  let tx, ty, hitId = -1;
  if (use3D) {
    const hit = V3.pick(sx, sy);
    if (!hit) { if (!placing) { selected = null; closeSheet(); } return; }
    tx = Math.floor(hit.x); ty = Math.floor(hit.y);
    if (hit.bid !== undefined) hitId = hit.bid;
  } else [tx, ty] = toTile(sx, sy).map(Math.floor);
  if (placing) { camera.x = tx + DEFS[placing.type].w / 2; camera.y = ty + DEFS[placing.type].h / 2; clampCamera(); followGhost(); return; }
  if (!inMap(tx, ty)) return;
  const id = hitId >= 0 ? hitId : occ[idx(tx, ty)];
  if (id >= 0) { selected = buildingById(id); openBuilding(selected); }
  else { selected = null; closeSheet(); }
}

function followGhost() {
  if (!placing) return;
  const d = DEFS[placing.type];
  placing.x = Math.round(camera.x - d.w / 2); placing.y = Math.round(camera.y - d.h / 2);
  updatePlaceUI();
}

// ---------- UI ----------
let speed = 1, paused = false, warnedThisMonth = {};
function setSpeed(s) { speed = s; $('speed').textContent = t('speedLbl')[s]; }
$('speed').onclick = () => setSpeed((speed + 1) % 4);

function updateHUD() {
  if (!S) return;
  const st = S.stock, pop = S.people.length, se = seasonOf(S.month);
  const houses = S.families.filter(f => f.home >= 0).length;
  const need = { food: pop, water: pop, fire: houses * FIRE_SEASON[se] };
  const rows = [['people', pop], ...RES.map(r => [r, st[r]])];
  let html = '';
  for (const [r, v] of rows) {
    let cls = '', trend = '';
    if (S.last && r !== 'people') { const d = v - S.last[r]; trend = d > 0.5 ? '<small class="up">▲</small>' : d < -0.5 ? '<small class="down">▼</small>' : '<small class="flat">▬</small>'; }
    if (need[r] !== undefined && need[r] > 0) { const months = v / need[r]; if (months < 1) cls = 'red'; else if (months < 2) cls = 'amber'; }
    html += `<div class="chip ${cls}" data-r="${r}"><i>${ICON[r]}</i>${Math.floor(v)}${trend}</div>`;
  }
  $('stocks').innerHTML = html;
  $('season').innerHTML = `<b>${t('months')[S.month]}</b><small>${t('seasons')[se]} · ${t('year')}${S.year}</small>`;

  // warnings
  const warns = [];
  for (const r of ['water', 'food', 'fire']) {
    if (!need[r]) continue;
    const months = st[r] / need[r];
    if (months < 2) warns.push({ red: months < 1, text: months < 0.05 ? t('empty', { res: t(r) }) : t('runsOut', { res: t(r), n: Math.max(1, Math.floor(months)) }), key: r });
  }
  if (S.drought && (S.month < 6)) warns.push({ red: false, text: '☀️ ' + t('droughtForecast') });
  const homeless = S.people.filter(p => !homeOf(p)).length;
  if (homeless) warns.push({ red: se === 3, text: '⛺ ' + t('homeless', { n: homeless }) });
  const waitingSites = S.buildings.filter(b => !b.done).length;
  if (waitingSites && !S.people.some(p => isAdult(p) && p.job < 0)) warns.push({ red: false, text: '🔨 ' + t('noBuilders', { n: waitingSites }) });
  const idle = S.people.filter(p => isAdult(p) && p.job < 0 && p.site < 0).length;
  if (idle >= 3) warns.push({ red: false, text: '👤 ' + t('idleWarn', { n: idle }) });
  $('warn').innerHTML = warns.slice(0, 3).map(w => `<div class="${w.red ? 'red' : ''}">${esc(w.text)}</div>`).join('');
  // auto-pause once on a new red warning
  for (const w of warns) if (w.red && w.key && !warnedThisMonth[w.key]) { warnedThisMonth[w.key] = true; if (speed > 0) { setSpeed(0); toast('⏸ ' + w.text); } }
}

$('stocks').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  if (c.dataset.r === 'water' && S.tut === 3) advanceTut();
  openTown();
});

function toast(text) {
  const el = document.createElement('div'); el.textContent = text;
  $('toast').appendChild(el); setTimeout(() => el.remove(), 4000);
  while ($('toast').children.length > 3) $('toast').firstChild.remove();
}

function openSheet(html) { $('sheetBody').innerHTML = html; $('sheet').hidden = false; }
function closeSheet() { $('sheet').hidden = true; selected = null; }
function sheetHead(title) { return `<h3>${title}<button class="x" data-close>✕</button></h3>`; }
$('sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
$('sheet').addEventListener('resume', () => setSpeed(1));

function openBuildMenu() {
  if (placing) return;
  let html = sheetHead('🔨 ' + t('build')) + '<div class="grid">';
  for (const type of Object.keys(DEFS)) {
    const d = DEFS[type];
    const ok = S.stock.logs >= d.logs && S.stock.stone >= d.stone;
    html += `<button class="bcard" data-b="${type}" ${ok ? '' : 'disabled'}><span class="ico">${d.ico}</span><b>${t('b_' + type)}</b>
      <span class="cost">🪵${d.logs} 🪨${d.stone}</span><br><span>${t('d_' + type)}</span></button>`;
  }
  openSheet(html + '</div>');
}
$('sheet').addEventListener('click', e => {
  const c = e.target.closest('[data-b]'); if (!c || c.disabled) return;
  startPlace(c.dataset.b);
});

function startPlace(type) {
  closeSheet();
  placing = { type, x: 0, y: 0 };
  if (camera.zoom < viewW / 14) camera.zoom = viewW / 12;
  clampCamera(); followGhost();
  $('bottom').hidden = true; $('placeBar').hidden = false; $('placeHint').hidden = false; $('elder').hidden = true;
  updatePlaceUI();
}
function updatePlaceUI() {
  if (!placing) return;
  const why = canPlace(placing.type, placing.x, placing.y);
  const d = DEFS[placing.type];
  $('placeName').innerHTML = `<b>${d.ico} ${t('b_' + placing.type)}</b><span>🪵${d.logs} 🪨${d.stone} · ${t('dragHint')}</span>`;
  $('placeHint').textContent = why ? t(why) : t('okPlace');
  $('placeHint').classList.toggle('bad', !!why);
  $('btnOk').disabled = !!why;
}
function cancelPlace() { placing = null; $('bottom').hidden = false; $('placeBar').hidden = true; $('placeHint').hidden = true; if (S) showElder(); }
$('btnCancel').onclick = cancelPlace;
$('btnOk').onclick = () => {
  if (!placing || canPlace(placing.type, placing.x, placing.y)) return;
  const d = DEFS[placing.type];
  S.stock.logs -= d.logs; S.stock.stone -= d.stone;
  const b = addBuilding(placing.type, placing.x, placing.y, false);
  const type = placing.type;
  if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
  cancelPlace();
  if (S.tut === 0 && type === 'house') advanceTut();
  else if (S.tut === 1 && type === 'fisher') advanceTut();
  else if (S.tut === 4 && type === 'well') advanceTut();
  else if (S.tut === 5 && type === 'field') advanceTut();
  saveGame();
};

function openBuilding(b) {
  const d = DEFS[b.type];
  let html = sheetHead(`${d.ico} ${t('b_' + b.type)}`) + `<p>${t('d_' + b.type)}</p>`;
  if (!b.done) {
    const busy = S.people.filter(p => p.site === b.id).length;
    html += `<p><b>${t('building')}</b>: ${Math.floor(b.progress / d.work * 100)}% ${busy ? '· 👷 ' + busy : '· ' + t('waiting')}</p>`;
  } else if (b.type === 'house') {
    const fam = S.families.find(f => f.home === b.id);
    const mem = fam ? S.people.filter(p => p.fam === fam.id) : [];
    html += mem.length ? `<table class="t">${mem.map(p => `<tr><td>${p.sex === 'm' ? '♂' : '♀'} ${esc(p.name)}, ${p.age}</td><td>❤️ ${Math.round(p.health)}</td></tr>`).join('')}</table>` : '<p>∅</p>';
  } else if (d.max > 0) {
    html += `<div>${t('workers')}</div><div class="stepper"><button data-w="-1">−</button><span class="n">${b.workers.length} / ${d.max}</span><button data-w="1">+</button></div>`;
    html += `<div class="log">${b.workers.map(personById).filter(Boolean).map(p => `<div>${esc(p.name)}, ${p.age} · ❤️ ${Math.round(p.health)}</div>`).join('')}</div>`;
    if (b.type === 'woodcutter') html += `<div class="row"><button class="pill ${b.mode === 'logs' ? 'on' : ''}" data-mode="logs">🪵 ${t('modeLogs')}</button><button class="pill ${b.mode === 'fire' ? 'on' : ''}" data-mode="fire">🔥 ${t('modeFire')}</button></div>`;
    if (b.type === 'field') html += `<p>🌾 ${t('fieldState')[b.sown ? 1 : 0]}</p>`;
  }
  html += `<div class="row"><button class="danger" data-demolish>${t('demolish')}</button></div>`;
  openSheet(html);
  selected = b;
}
$('sheet').addEventListener('click', e => {
  if (!selected) return;
  const b = selected, d = DEFS[b.type];
  const w = e.target.closest('[data-w]');
  if (w) {
    if (+w.dataset.w > 0 && b.workers.length < d.max) {
      const free = S.people.filter(p => isAdult(p) && p.job < 0);
      if (!free.length) { toast(t('noIdle')); return; }
      const c = center(b);
      free.sort((p, q) => { const a = homeOf(p), z = homeOf(q); const da = a ? Math.hypot(center(a).x - c.x, center(a).y - c.y) : 99; const dz = z ? Math.hypot(center(z).x - c.x, center(z).y - c.y) : 99; return da - dz; });
      free[0].job = b.id; free[0].site = -1; b.workers.push(free[0].id);
    } else if (+w.dataset.w < 0 && b.workers.length) {
      const p = personById(b.workers[b.workers.length - 1]); if (p) unassign(p); else b.workers.pop();
    }
    if (S.tut === 2 && b.type === 'fisher' && b.workers.length >= 2) advanceTut();
    openBuilding(b); return;
  }
  const md = e.target.closest('[data-mode]');
  if (md) { b.mode = md.dataset.mode; openBuilding(b); return; }
  if (e.target.closest('[data-demolish]')) { if (confirm(t('confirmDemolish'))) { removeBuilding(b); closeSheet(); saveGame(); } }
});

function openTown() {
  const pop = S.people;
  const adults = pop.filter(isAdult).length, kids = pop.filter(p => p.age < 14).length, old = pop.filter(p => p.age >= 56).length;
  const idle = pop.filter(p => isAdult(p) && p.job < 0).length;
  const se = seasonOf(S.month), houses = S.families.filter(f => f.home >= 0).length;
  let html = sheetHead('🏘️ ' + t('town'));
  html += `<table class="t"><tr><td>${t('adults')}</td><td>${adults}</td></tr><tr><td>${t('children')}</td><td>${kids}</td></tr><tr><td>${t('elders')}</td><td>${old}</td></tr><tr><td>${t('idle')}</td><td>${idle}</td></tr>
    <tr><td>${t('need')} ${t('perMonth').toLowerCase()}</td><td>🍞${pop.length} 💧${pop.length} 🔥${Math.round(houses * FIRE_SEASON[se])}</td></tr></table>`;
  const jobs = S.buildings.filter(b => b.done && DEFS[b.type].max > 0);
  if (jobs.length) html += `<h3>${t('jobs')}</h3><table class="t">${jobs.map(b => `<tr><td>${DEFS[b.type].ico} ${t('b_' + b.type)}</td><td>${b.workers.length}/${DEFS[b.type].max}</td></tr>`).join('')}</table>`;
  html += `<h3>${t('chronicle')}</h3><div class="log">${S.log.slice(0, 15).map(l => `<div>${esc(l)}</div>`).join('') || '—'}</div>`;
  openSheet(html);
}

function openMenu() {
  setSpeed(0);
  openSheet(sheetHead('☰ ' + t('menu')) +
    `<button class="big" data-close onclick="this.dispatchEvent(new CustomEvent('resume',{bubbles:true}))">${t('resume')}</button>
     <button class="big alt" id="mSave">${t('save')}</button>
     <button class="big alt" id="mView">${t('view')}: ${settings.view === '3d' ? t('view3d') : t('viewTop')}</button>
     <button class="big alt" id="mLang">${t('language')}: ${settings.lang === 'pt' ? 'Português' : 'English'}</button>
     <button class="big alt" id="mTut">${t('tutorialOff')}</button>
     <button class="big alt" id="mTitle">${t('quitTitle')}</button>`);
  $('mSave').onclick = () => { saveGame(); toast(t('saved')); };
  $('mView').onclick = () => { setView(settings.view === '3d' ? 'top' : '3d'); openMenu(); };
  $('mLang').onclick = () => { settings.lang = settings.lang === 'pt' ? 'en' : 'pt'; saveSettings(); applyStaticText(); setSpeed(0); openMenu(); showElder(); };
  $('mTut').onclick = () => { S.tut = 99; showElder(); closeSheet(); };
  $('mTitle').onclick = () => { saveGame(); closeSheet(); showTitle(); };
}

$('btnView').onclick = () => setView(use3D ? 'top' : '3d');
$('btnRotL').onclick = () => { if (V3) V3.rotate(-1); };
$('btnRotR').onclick = () => { if (V3) V3.rotate(1); };
$('btnBuild').onclick = () => openBuildMenu();
$('btnTown').onclick = () => openTown();
$('btnMenu').onclick = () => openMenu();

// tutorial (the Elder)
function showElder() {
  const lines = t('elder');
  if (!S || S.tut >= lines.length) { $('elder').hidden = true; return; }
  $('elderText').textContent = lines[S.tut];
  $('elder').hidden = false;
}
function advanceTut() { S.tut++; showElder(); if (S.tut === 6) setTimeout(() => { if (S.tut === 6) { S.tut = 7; showElder(); } }, 6000); }
$('elderSkip').onclick = () => { S.tut = 99; showElder(); };

// title screen
function showTitle() {
  S = null; placing = null; cancelPlace(); closeSheet();
  $('title').hidden = false; $('elder').hidden = true; document.body.classList.add('ontitle');
  $('btnContinue').hidden = !hasSave();
  renderDiff();
}
function renderDiff() {
  $('diffRow').innerHTML = ['gentle', 'fair', 'harsh'].map(d => `<button class="pill ${settings.diff === d ? 'on' : ''}" data-d="${d}">${t(d)}</button>`).join('');
}
$('diffRow').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { settings.diff = b.dataset.d; saveSettings(); renderDiff(); } });
$('btnLang').onclick = () => { settings.lang = settings.lang === 'pt' ? 'en' : 'pt'; saveSettings(); applyStaticText(); renderDiff(); };
$('btnContinue').onclick = () => { if (loadGame()) startPlay(); };
$('btnNew').onclick = () => {
  if (hasSave() && !confirm(settings.lang === 'pt' ? 'Começar uma vila nova? A vila gravada perde-se.' : 'Start a new town? The saved town will be lost.')) return;
  startNew();
};
function startNew() { newGame(settings.diff); startPlay(); }
function startPlay() { $('title').hidden = true; document.body.classList.remove('ontitle'); setSpeed(1); paused = false; showElder(); updateHUD(); }

// pause when the app goes to the background
document.addEventListener('visibilitychange', () => { if (document.hidden && S) { saveGame(); setSpeed(0); } });

// ---------- main loop ----------
let acc = 0, lastT = performance.now(), hudT = 0;
const dayMs = 1000;
function frame(now) {
  const dt = Math.min(250, now - lastT); lastT = now;
  if (S && !S.over && speed > 0 && $('title').hidden) {
    acc += dt * speed;
    let guard = 0;
    while (acc >= dayMs && guard++ < 10) { acc -= dayMs; dayTick(); if (S.over) break; }
    if (S && !S.over) movePeople(dt * speed / dayMs);
  }
  hudT += dt;
  if (S && hudT > 250) { hudT = 0; updateHUD(); if (placing) updatePlaceUI(); }
  render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
applyStaticText();
setSpeed(1);
updateViewUI();
if (settings.view === '3d') load3D();
showTitle();
requestAnimationFrame(frame);

// for testing from the browser console
window.__lacobriga = {
  get S() { return S; }, get V3() { return V3; }, camera, setView, monthTick: () => monthTick(), dayTick: () => dayTick(), newGame, setSpeed, canPlace, DEFS,
  build(type, x, y) { const d = DEFS[type]; if (canPlace(type, x, y)) return null; S.stock.logs -= d.logs; S.stock.stone -= d.stone; return addBuilding(type, x, y, true); },
  staff(b, n) { for (const p of S.people) { if (b.workers.length >= Math.min(n, DEFS[b.type].max)) break; if (isAdult(p) && p.job < 0) { p.job = b.id; b.workers.push(p.id); } } },
  find(type) { let best = null, bd = 1e9; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!canPlace(type, x, y)) { const d = Math.hypot(x - 16, y - 21); if (d < bd) { bd = d; best = [x, y]; } } return best; },
};
})();
