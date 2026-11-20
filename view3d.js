// Lacobriga Survival · 3D view (added 20/11/2026, "diorama" look 20/11/2026)
// Draws the same game state as the top view, with three.js. The game rules never depend on this file:
// game.js loads three.js on demand and calls createView3D(THREE, G). If anything here fails, the game keeps the top view.
// World axes: map x -> X, map y -> Z (south is +Z), height -> Y. One tile = one unit.
// Everything is made in code: no image or model files are downloaded.
window.createView3D = function (THREE, G) {
  'use strict';
  const { W, H, T, DEFS, PAL } = G;
  const WATER_Y = -0.06;

  // ---------- small helpers ----------
  function rng(seed) { // mulberry32: same textures on every device
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = G.hash(xi, yi), b = G.hash(xi + 1, yi), c = G.hash(xi, yi + 1), d = G.hash(xi + 1, yi + 1);
    return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
  }
  const rgbCache = new Map();
  function rgb(hex) {
    let c = rgbCache.get(hex);
    if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, c); }
    return c;
  }
  function mergeGeos(list) { // position + normal only, enough for flat-coloured parts
    const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  }

  // ---------- renderer, scene, camera ----------
  const canvas = document.createElement('canvas');
  canvas.id = 'map3d';
  document.body.insertBefore(canvas, document.getElementById('map'));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#dfe9e6', 40, 120);

  const FOV = 40;
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.3, 500);
  const PITCH = 0.92; // about 53 degrees above the ground
  let yaw = 0, yawTarget = 0;

  // late-afternoon sun from the south-west: long, warm shadows
  const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  const hemi = new THREE.HemisphereLight('#bcd8f0', '#7a6748', 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6bf', 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  scene.add(sun, sun.target);

  // sky: a soft vertical gradient behind everything
  const skyCan = document.createElement('canvas'); skyCan.width = 2; skyCan.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCan); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  let skyKey = '';
  function paintSky(top, horizon) {
    const k = top + horizon; if (k === skyKey) return; skyKey = k;
    const c = skyCan.getContext('2d'), gr = c.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(0.75, horizon); gr.addColorStop(1, horizon);
    c.fillStyle = gr; c.fillRect(0, 0, 2, 256); skyTex.needsUpdate = true;
  }

  // ---------- painted textures (thatch, dry stone, wood) ----------
  function makeTex(w, h, rx, ry, seed, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h, rng(seed));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  const TEX = {
    thatch: makeTex(256, 256, 5, 1, 11, (c, w, h, r) => {
      c.fillStyle = '#94743f'; c.fillRect(0, 0, w, h);
      const cols = ['#b8955a', '#806237', '#c9aa70', '#6f5530', '#a3804a', '#9a8a6a'];
      for (let i = 0; i < 1400; i++) {
        const x = r() * w, y = r() * h, l = 8 + r() * 26;
        c.strokeStyle = cols[Math.floor(r() * cols.length)]; c.globalAlpha = 0.45 + r() * 0.4; c.lineWidth = 1 + r() * 1.6;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y + l); c.stroke();
      }
      c.globalAlpha = 1;
      for (let y = 30; y < h; y += 42) { c.fillStyle = 'rgba(55,35,12,.28)'; c.fillRect(0, y, w, 3); c.fillStyle = 'rgba(255,230,170,.12)'; c.fillRect(0, y - 3, w, 2); }
    }),
    stone: makeTex(256, 128, 5, 1, 23, (c, w, h, r) => {
      c.fillStyle = '#5f574c'; c.fillRect(0, 0, w, h);
      const cols = ['#a59c8e', '#b3a998', '#968d80', '#bfb3a0', '#9a8f7c', '#ab9b82'];
      for (let y = 0; y < h;) {
        const rh = 13 + r() * 9;
        for (let x = -r() * 20; x < w;) {
          const sw = 16 + r() * 26;
          c.fillStyle = cols[Math.floor(r() * cols.length)]; rrect(c, x + 1.5, y + 1.5, sw - 3, rh - 3, 4); c.fill();
          c.fillStyle = 'rgba(255,255,255,.13)'; c.fillRect(x + 4, y + 2.5, sw - 8, 2);
          c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(x + 3, y + rh - 4.5, sw - 6, 2);
          x += sw;
        }
        y += rh;
      }
    }),
    wood: makeTex(128, 128, 1, 1, 37, (c, w, h, r) => {
      c.fillStyle = '#7a5530'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) { c.strokeStyle = r() < 0.5 ? 'rgba(40,22,8,.35)' : 'rgba(170,120,70,.25)'; c.lineWidth = 1; const x = r() * w; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 3, h * 0.3, x - 3, h * 0.6, x + 1, h); c.stroke(); }
      for (let x = 0; x < w; x += 21) { c.fillStyle = 'rgba(30,15,5,.45)'; c.fillRect(x, 0, 2, h); }
    }),
  };

  // ---------- materials (shared, cached) ----------
  // colour '#rrggbb' = plain colour; '@name' = painted texture
  const matCache = new Map();
  function mat(color, opacity = 1, flat = true) {
    const key = color + '|' + opacity + '|' + flat;
    let m = matCache.get(key);
    if (!m) {
      const tex = color[0] === '@' ? TEX[color.slice(1)] : null;
      m = new THREE.MeshLambertMaterial({ color: tex ? '#ffffff' : color, map: tex, flatShading: tex ? false : flat, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
      matCache.set(key, m);
    }
    return m;
  }
  // gentle wind: tree tops and grass sway a little
  const windU = { value: 0 };
  function swayMat(amount, from, extra) {
    const m = new THREE.MeshLambertMaterial(Object.assign({ color: '#ffffff', flatShading: true }, extra));
    m.onBeforeCompile = sh => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swPh = instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7;
        #else
          float swPh = 0.0;
        #endif
        float swK = max(0.0, position.y - ${from.toFixed(3)});
        transformed.x += sin(uWind * 1.3 + swPh) * ${amount.toFixed(3)} * swK;
        transformed.z += cos(uWind * 1.05 + swPh * 1.3) * ${(amount * 0.6).toFixed(3)} * swK;`);
    };
    m.customProgramCacheKey = () => 'sway' + amount + '|' + from;
    return m;
  }

  // ---------- terrain shape ----------
  // Heights live on a grid twice as fine as the tiles. Water is a soft mask, so shores and river banks curve
  // instead of following the square tiles.
  let mapSeed = null;
  const RES = 2, VW = W * RES + 1, VH = H * RES + 1;
  const hC = new Float32Array(VW * VH); // vertex heights
  const isWater = t => t === T.SEA || t === T.RIVER;
  function hill(x, y) { return 0.35 + 1.5 * Math.exp(-((x - 16) ** 2 + ((y - 21) * 0.8) ** 2) / 90); }
  const tLand = new Float32Array(W * H), tWet = new Float32Array(W * H), tBed = new Float32Array(W * H), tRiver = new Float32Array(W * H);
  function sampleTiles(arr, x, y) { // bilinear between tile centres
    const u = Math.max(0, Math.min(W - 1.001, x - 0.5)), v = Math.max(0, Math.min(H - 1.001, y - 0.5));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = arr[j * W + i], b = arr[j * W + i + 1], c = arr[(j + 1) * W + i], d = arr[(j + 1) * W + i + 1];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
  function buildHeights() {
    const raw = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = G.tiles[i];
      raw[i] = isWater(t) ? 1 : 0;
      tRiver[i] = t === T.RIVER ? 1 : 0;
      tBed[i] = t === T.SEA ? -0.34 : -0.24;
      tLand[i] = t === T.MARSH ? 0.03 : t === T.SAND ? 0.1 : isWater(t) ? 0.02 : hill(x + 0.5, y + 0.5);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // light blur of the water mask
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.max(0, Math.min(W - 1, x + dx)), yy = Math.max(0, Math.min(H - 1, y + dy)), k = (dx ? 1 : 2) * (dy ? 1 : 2);
        s += raw[yy * W + xx] * k; n += k;
      }
      tWet[y * W + x] = s / n;
    }
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const x = i / RES, y = j / RES;
      const wv = sampleTiles(tWet, x, y), w = wv * wv * (3 - 2 * wv);
      const land = sampleTiles(tLand, x, y) + (vnoise(x * 0.9 + 7.3, y * 0.9 + 3.1) - 0.5) * 0.16 * (1 - w);
      let h = land + (sampleTiles(tBed, x, y) - land) * Math.min(1, w * 1.35);
      if (i === 0 || j === 0 || i === VW - 1 || j === VH - 1) h = -0.32; // the map ends at the sea all round
      hC[j * VW + i] = h;
    }
  }
  function groundAt(x, y) {
    x = Math.max(0, Math.min(W - 0.001, x)) * RES; y = Math.max(0, Math.min(H - 0.001, y)) * RES;
    const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy;
    const a = hC[cy * VW + cx], b = hC[cy * VW + cx + 1], c = hC[(cy + 1) * VW + cx], d = hC[(cy + 1) * VW + cx + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function footprintRange(x, y, w, h) {
    let hi = -1, lo = 9;
    for (let yy = y * RES; yy <= (y + h) * RES; yy++) for (let xx = x * RES; xx <= (x + w) * RES; xx++)
      if (xx >= 0 && yy >= 0 && xx < VW && yy < VH) { const v = hC[yy * VW + xx]; hi = Math.max(hi, v); lo = Math.min(lo, v); }
    return [Math.max(hi, 0), lo];
  }
  const footprintTop = (x, y, w, h) => footprintRange(x, y, w, h)[0];

  // ---------- ground texture: soft blends between tiles, painted detail ----------
  const GPX = 32, SUB = 4;
  const gCan = document.createElement('canvas'); gCan.width = W * GPX; gCan.height = H * GPX;
  const gctx = gCan.getContext('2d');
  const small = document.createElement('canvas'); small.width = W * SUB; small.height = H * SUB;
  const sctx = small.getContext('2d');
  const grain = (() => { // tileable speckle used as an overlay
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), img = x.createImageData(128, 128), r = rng(5);
    for (let i = 0; i < 128 * 128; i++) { const v = 128 + (r() - 0.5) * 70 + (r() < 0.04 ? -50 : 0); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    x.putImageData(img, 0, 0); return c;
  })();
  const grainPat = gctx.createPattern(grain, 'repeat');
  function groundColor(t, se, dry) {
    switch (t) {
      case T.GRASS: return ['#86a65a', '#c4b57c', '#a4a86b', '#7b9c55'][se];
      case T.SCRUB: return ['#9a9f5e', '#b9a76c', '#a0985f', '#8c955a'][se];
      case T.FOREST: return ['#6f8a48', '#8a874c', '#76804a', '#647f45'][se];
      case T.ROCK: return '#a0968a';
      case T.SAND: return PAL.sand;
      case T.MARSH: return PAL.marsh;
      case T.RIVER: return dry ? PAL.riverDry : '#bfae80';
      default: return '#cdbd8c'; // sea bed: sand, so the shallows look turquoise
    }
  }
  function paintGround() {
    const se = G.seasonOf(G.S.month), dry = !!(G.S.drought && se === 1);
    // 1) colour per small cell, with tile borders wobbled by noise
    const img = sctx.createImageData(W * SUB, H * SUB), d = img.data;
    for (let sy = 0; sy < H * SUB; sy++) for (let sx = 0; sx < W * SUB; sx++) {
      const jx = (vnoise(sx * 0.33, sy * 0.33) - 0.5) * 0.8, jy = (vnoise(sx * 0.33 + 19.7, sy * 0.33 + 5.3) - 0.5) * 0.8;
      const tx = Math.max(0, Math.min(W - 1, Math.floor((sx + 0.5) / SUB + jx))), ty = Math.max(0, Math.min(H - 1, Math.floor((sy + 0.5) / SUB + jy)));
      const c = rgb(groundColor(G.tiles[ty * W + tx], se, dry));
      const k = 0.9 + vnoise(sx * 0.08 + 3, sy * 0.08 + 11) * 0.2; // big soft patches
      const i = (sy * W * SUB + sx) * 4;
      d[i] = Math.min(255, c[0] * k); d[i + 1] = Math.min(255, c[1] * k); d[i + 2] = Math.min(255, c[2] * k); d[i + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    gctx.globalCompositeOperation = 'source-over';
    gctx.imageSmoothingEnabled = true; gctx.imageSmoothingQuality = 'high';
    gctx.drawImage(small, 0, 0, gCan.width, gCan.height);
    // 2) fine grain at two scales
    gctx.globalCompositeOperation = 'overlay'; gctx.globalAlpha = 0.55;
    gctx.fillStyle = grainPat; gctx.fillRect(0, 0, gCan.width, gCan.height);
    gctx.save(); gctx.scale(3, 3); gctx.globalAlpha = 0.35; gctx.fillRect(0, 0, gCan.width / 3, gCan.height / 3); gctx.restore();
    gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1;
    // 3) small painted details
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = G.tiles[y * W + x], px = x * GPX, py = y * GPX, r = rng(x * 131 + y * 977 + 1);
      if (t === T.GRASS && se === 0) { // spring flowers
        for (let k = 0; k < 4; k++) { gctx.fillStyle = r() < 0.5 ? 'rgba(255,250,235,.8)' : 'rgba(240,205,80,.8)'; gctx.beginPath(); gctx.arc(px + r() * GPX, py + r() * GPX, 1.1, 0, 7); gctx.fill(); }
      } else if (t === T.GRASS || t === T.SCRUB) {
        for (let k = 0; k < 3; k++) { gctx.fillStyle = 'rgba(70,60,30,.18)'; gctx.beginPath(); gctx.ellipse(px + r() * GPX, py + r() * GPX, 3 + r() * 3, 2 + r() * 2, r() * 3, 0, 7); gctx.fill(); }
      } else if (t === T.FOREST) {
        for (let k = 0; k < 6; k++) { gctx.fillStyle = r() < 0.5 ? 'rgba(60,45,20,.22)' : 'rgba(120,100,50,.2)'; gctx.beginPath(); gctx.arc(px + r() * GPX, py + r() * GPX, 1.5 + r() * 2.5, 0, 7); gctx.fill(); }
      } else if (t === T.ROCK || (t === T.RIVER && dry)) {
        for (let k = 0; k < 7; k++) {
          const ex = px + r() * GPX, ey = py + r() * GPX, rw = 1.5 + r() * 3.5;
          gctx.fillStyle = 'rgba(60,55,48,.35)'; gctx.beginPath(); gctx.ellipse(ex + 1, ey + 1, rw, rw * 0.7, 0, 0, 7); gctx.fill();
          gctx.fillStyle = r() < 0.5 ? '#b9b0a2' : '#9c9284'; gctx.beginPath(); gctx.ellipse(ex, ey, rw, rw * 0.7, 0, 0, 7); gctx.fill();
        }
      } else if (t === T.SAND) {
        gctx.strokeStyle = 'rgba(160,130,80,.22)'; gctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) { const yy = py + 6 + k * 9 + r() * 3; gctx.beginPath(); gctx.moveTo(px, yy); gctx.quadraticCurveTo(px + GPX / 2, yy - 3, px + GPX, yy); gctx.stroke(); }
      } else if (t === T.MARSH) {
        gctx.fillStyle = 'rgba(60,110,110,.35)'; gctx.beginPath(); gctx.ellipse(px + 8 + r() * 16, py + 8 + r() * 16, 6, 4, r() * 3, 0, 7); gctx.fill();
        gctx.strokeStyle = 'rgba(45,70,35,.6)'; gctx.lineWidth = 1.2;
        for (let k = 0; k < 6; k++) { const ax = px + r() * GPX, ay = py + 8 + r() * 22; gctx.beginPath(); gctx.moveTo(ax, ay); gctx.lineTo(ax + (r() - 0.5) * 3, ay - 6 - r() * 6); gctx.stroke(); }
      }
    }
    groundTex.needsUpdate = true;
  }
  const groundTex = new THREE.CanvasTexture(gCan);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const terrainGeo = new THREE.PlaneGeometry(W, H, W * RES, H * RES);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate(W / 2, 0, H / 2);
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ map: groundTex }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  function applyHeights() {
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, hC[i]); // PlaneGeometry order matches corner order (row = map y)
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingSphere();
    terrainGeo.computeBoundingBox();
  }

  // ---------- water: one surface for sea and river, with ripples, sun glints and shore foam ----------
  const hData = new Uint8Array(VW * VH * 4);
  const heightTex = new THREE.DataTexture(hData, VW, VH, THREE.RGBAFormat);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter;
  function fillHeightTex() {
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const k = j * VW + i;
      hData[k * 4] = Math.max(0, Math.min(255, Math.round((hC[k] + 0.5) / 2.5 * 255)));
      hData[k * 4 + 1] = Math.round(sampleTiles(tRiver, i / RES, j / RES) * 255); hData[k * 4 + 2] = 0; hData[k * 4 + 3] = 255;
    }
    heightTex.needsUpdate = true;
  }
  const waterU = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
    uTime: { value: 0 }, uDry: { value: 0 }, uHeight: { value: heightTex }, uMap: { value: new THREE.Vector2(VW, VH) },
    uDeep: { value: new THREE.Color('#1b6b7c') }, uShallow: { value: new THREE.Color('#5cc9c2') }, uFoam: { value: new THREE.Color('#f3f7ef') },
    uSky: { value: new THREE.Color('#cfe3ef') }, uSunDir: { value: SUN_DIR.clone() }, uSunCol: { value: new THREE.Color('#fff1d6') },
  });
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterU, transparent: true, depthWrite: false, fog: true,
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uDry;
      uniform sampler2D uHeight;
      uniform vec2 uMap;
      uniform vec3 uDeep, uShallow, uFoam, uSky, uSunDir, uSunCol;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      vec2 wave(vec2 p, vec2 d, float f, float s, float a) { float k = dot(p, d) * f + uTime * s; return d * (a * f * cos(k)); }
      void main() {
        vec4 hs = texture2D(uHeight, (vWorld.xz * ${RES.toFixed(1)} + 0.5) / uMap);
        float depth = ${WATER_Y.toFixed(3)} - (hs.r * 2.5 - 0.5);
        if (depth < -0.01) discard;
        float dryCut = uDry * smoothstep(0.04, 0.3, hs.g);
        if (dryCut > 0.98) discard;
        vec2 p = vWorld.xz;
        vec2 g = wave(p, vec2(0.8, 0.6), 1.7, 1.1, 0.020) + wave(p, vec2(-0.5, 0.86), 2.9, 1.7, 0.012)
               + wave(p, vec2(0.96, -0.28), 5.3, 2.6, 0.006) + wave(p, vec2(-0.2, -0.98), 9.1, 3.4, 0.003);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float dF = smoothstep(0.0, 0.22, depth);
        vec3 col = mix(uShallow, uDeep, dF);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col = mix(col, uSky, fres * 0.55);
        float spec = pow(max(dot(reflect(-uSunDir, n), v), 0.0), 90.0);
        col += uSunCol * spec * 1.6;
        float edge = 1.0 - smoothstep(0.0, 0.028, depth);
        float bands = smoothstep(0.55, 1.0, sin(depth * 90.0 - uTime * 1.6 + sin(p.x * 2.1 + p.y * 1.3) * 1.5) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 0.09, depth));
        float foam = clamp(edge * 0.85 + bands * 0.45, 0.0, 1.0);
        col = mix(col, uFoam, foam);
        float alpha = mix(0.5, 1.0, dF);
        alpha = max(alpha, foam) * (1.0 - dryCut);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W + 200, H + 200), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(W / 2, WATER_Y, H / 2);
  water.renderOrder = 1;
  scene.add(water);

  // ---------- trees, bushes, grass, boulders (instanced) ----------
  const oakTrunkGeo = new THREE.CylinderGeometry(0.045, 0.075, 0.5, 6); oakTrunkGeo.translate(0, 0.25, 0);
  const pineTrunkGeo = new THREE.CylinderGeometry(0.035, 0.06, 1.0, 6); pineTrunkGeo.translate(0, 0.5, 0); pineTrunkGeo.rotateZ(0.1);
  const oakGeo = mergeGeos([ // holm / cork oak: a round, lumpy crown
    new THREE.IcosahedronGeometry(0.34, 1).translate(0, 0.68, 0),
    new THREE.IcosahedronGeometry(0.25, 0).translate(0.21, 0.78, 0.07),
    new THREE.IcosahedronGeometry(0.23, 0).translate(-0.18, 0.74, -0.12),
    new THREE.IcosahedronGeometry(0.2, 0).translate(0.02, 0.9, 0.16),
  ]);
  const pineGeo = mergeGeos([ // stone pine of the Algarve: a flat umbrella on a tall trunk
    new THREE.IcosahedronGeometry(0.44, 1).scale(1, 0.36, 1).translate(0.1, 1.04, 0),
    new THREE.IcosahedronGeometry(0.28, 1).scale(1, 0.4, 1).translate(0.12, 1.16, 0.05),
  ]);
  const bushGeo = new THREE.IcosahedronGeometry(0.17, 0).scale(1, 0.72, 1).translate(0, 0.08, 0);
  const rockGeo = new THREE.DodecahedronGeometry(0.28, 0); rockGeo.scale(1, 0.6, 1);
  const tuftGeo = (() => { // three thin blades
    const pos = [], nor = [];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + 0.3, ca = Math.cos(a), sa = Math.sin(a), ox = Math.cos(a + 1) * 0.03, oz = Math.sin(a + 1) * 0.03;
      const lean = 0.05 * (k - 1);
      pos.push(ox - ca * 0.025, 0, oz - sa * 0.025, ox + ca * 0.025, 0, oz + sa * 0.025, ox + lean, 0.16 + k * 0.03, oz + lean * 0.5);
      for (let j = 0; j < 3; j++) nor.push(0, 1, 0);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return gg;
  })();
  const leafMat = swayMat(0.05, 0.4);
  const tuftMat = swayMat(0.25, 0.02, { side: THREE.DoubleSide });

  let treeMeshes = [], tuftMeshes = [];
  function inst(geo, material, list, castShadow, store) {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, material, list.length);
    const o = new THREE.Object3D(), col = new THREE.Color();
    list.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z); o.rotation.set(0, it.r || 0, 0); o.scale.setScalar(it.s || 1); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) { col.set(it.c); if (it.k) col.multiplyScalar(it.k); m.setColorAt(i, col); }
    });
    m.castShadow = castShadow; m.receiveShadow = !castShadow || geo === rockGeo;
    scene.add(m); store.push(m);
  }
  function clear(list) { for (const m of list) { scene.remove(m); m.dispose(); } list.length = 0; }
  function buildTrees() {
    clear(treeMeshes);
    const se = G.seasonOf(G.S.month);
    const oakC = ['#4f7036', '#5b7139', '#4d6733', '#466a34'][se], pineC = ['#3f6833', '#476a36', '#3d6232', '#3a6331'][se];
    const ot = [], pt = [], oaks = [], pines = [], rocks = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, h = G.hash(x, y), h2 = G.hash(y, x);
      if (G.trees[i]) {
        const px = x + 0.5 + (h - 0.5) * 0.4, pz = y + 0.5 + (h2 - 0.5) * 0.4, py = groundAt(px, pz) - 0.02, s = 0.8 + h * 0.45, k = 0.85 + G.hash(x + 3, y + 7) * 0.3;
        if (h2 < 0.3) { pt.push({ x: px, y: py, z: pz, s, r: h * 6 }); pines.push({ x: px, y: py, z: pz, s, r: h * 6, c: pineC, k }); }
        else { ot.push({ x: px, y: py, z: pz, s, r: h * 6 }); oaks.push({ x: px, y: py, z: pz, s, r: h * 6, c: oakC, k }); }
      } else if (G.tiles[i] === T.ROCK) {
        const n = 1 + Math.floor(h * 2);
        for (let k = 0; k < n; k++) {
          const px = x + 0.25 + G.hash(x + k, y) * 0.5, pz = y + 0.25 + G.hash(x, y + k) * 0.5;
          rocks.push({ x: px, y: groundAt(px, pz) + 0.05, z: pz, s: 0.7 + G.hash(x + k, y + k) * 0.7, r: h * 6, c: k % 2 ? '#a39a8e' : '#8a8276' });
        }
      }
    }
    inst(oakTrunkGeo, mat('#5e4128'), ot, true, treeMeshes);
    inst(pineTrunkGeo, mat('#6b4a33'), pt, true, treeMeshes);
    inst(oakGeo, leafMat, oaks, true, treeMeshes);
    inst(pineGeo, leafMat, pines, true, treeMeshes);
    inst(rockGeo, mat('#ffffff'), rocks, true, treeMeshes);
  }
  let tuftSig = '';
  function buildTufts() {
    clear(tuftMeshes);
    if (quality < 1) return;
    const occ = new Uint8Array(W * H);
    for (const b of G.S.buildings) { const d = DEFS[b.type]; for (let y = b.y; y < b.y + d.h; y++) for (let x = b.x; x < b.x + d.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1; }
    const se = G.seasonOf(G.S.month);
    const grassC = ['#7aa548', '#b8a65a', '#98a053', '#6e9a4a'][se], bushC = ['#5c7638', '#6d7239', '#62703a', '#567237'][se];
    const tufts = [], bushes = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = G.tiles[i];
      if (occ[i] || G.trees[i] || !(t === T.GRASS || t === T.SCRUB || t === T.MARSH)) continue;
      const r = rng(x * 7919 + y * 104729 + 3);
      const nT = t === T.MARSH ? 4 : t === T.GRASS ? 3 : 1;
      for (let k = 0; k < nT; k++) { const px = x + r(), pz = y + r(); tufts.push({ x: px, y: groundAt(px, pz), z: pz, s: 0.7 + r() * 0.7, r: r() * 6, c: t === T.MARSH ? '#5b7e45' : grassC, k: 0.85 + r() * 0.3 }); }
      if (t === T.SCRUB) for (let k = 0; k < 2; k++) { const px = x + 0.15 + r() * 0.7, pz = y + 0.15 + r() * 0.7; bushes.push({ x: px, y: groundAt(px, pz), z: pz, s: 0.7 + r() * 0.8, r: r() * 6, c: bushC, k: 0.85 + r() * 0.3 }); }
    }
    inst(tuftGeo, tuftMat, tufts, false, tuftMeshes);
    inst(bushGeo, leafMat, bushes, true, tuftMeshes);
  }

  // ---------- building models ----------
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
  function part(group, geo, color, x, y, z, opacity, shadow = true) {
    const m = new THREE.Mesh(geo, mat(color, opacity));
    m.position.set(x, y, z); m.castShadow = shadow && opacity >= 1; m.receiveShadow = true;
    group.add(m); return m;
  }
  // Iron Age house of the south-west: round dry-stone wall, conical thatch roof, low door
  function roundhouse(g, r, wallH, roofH, x, z, op, turn) {
    part(g, cyl(r * 1.08, r * 1.12, 0.05, 18), '#8b8173', x, 0.025, z, op);
    part(g, cyl(r, r * 1.03, wallH, 18), '@stone', x, wallH / 2, z, op);
    const roof = part(g, new THREE.ConeGeometry(r * 1.3, roofH, 18), '@thatch', x, wallH + roofH / 2 - 0.03, z, op);
    roof.rotation.y = turn;
    const eave = part(g, new THREE.TorusGeometry(r * 1.27, 0.035, 5, 20), '#8d6a33', x, wallH - 0.02, z, op, false);
    eave.rotation.x = Math.PI / 2;
    part(g, new THREE.ConeGeometry(r * 0.16, roofH * 0.2, 8), '#6d5228', x, wallH + roofH - roofH * 0.08, z, op);
    part(g, box(r * 0.36, wallH * 0.72, 0.08), '#3b2a18', x, wallH * 0.36, z + r * 1.0, op, false);
    part(g, box(r * 0.5, 0.05, 0.1), '@wood', x, wallH * 0.74, z + r * 1.0, op);
  }
  function makeModel(type, w, h, op, turn = 0) {
    const g = new THREE.Group();
    const parts = {};
    switch (type) {
      case 'house': roundhouse(g, 0.68, 0.42, 0.78, 0, 0, op, turn); parts.smokeY = 0.42 + 0.78; break;
      case 'well': {
        part(g, cyl(0.34, 0.37, 0.3, 16), '@stone', 0, 0.15, 0, op);
        parts.water = part(g, cyl(0.25, 0.25, 0.02), '#2F8C9A', 0, 0.3, 0, op, false);
        part(g, box(0.06, 0.62, 0.06), '@wood', -0.32, 0.31, 0, op);
        part(g, box(0.06, 0.62, 0.06), '@wood', 0.32, 0.31, 0, op);
        part(g, cyl(0.035, 0.035, 0.74, 8), '@wood', 0, 0.6, 0, op).rotation.z = Math.PI / 2;
        part(g, cyl(0.06, 0.05, 0.08, 8), '#6d4a2a', 0.08, 0.45, 0, op);
        break;
      }
      case 'field': {
        part(g, box(w - 0.24, 0.06, h - 0.24), '#8a6740', 0, 0.03, 0, op).castShadow = false;
        part(g, box(w - 0.12, 0.08, 0.06), '#7d6a52', 0, 0.04, -(h - 0.12) / 2, op);
        part(g, box(w - 0.12, 0.08, 0.06), '#7d6a52', 0, 0.04, (h - 0.12) / 2, op);
        parts.crops = [];
        for (let k = 0; k < 7; k++) {
          const z = -(h - 0.24) / 2 + (h - 0.24) * (k + 0.5) / 7;
          part(g, box(w - 0.5, 0.02, 0.05), '#5f4527', 0, 0.065, z, op, false);
          const c = new THREE.Mesh(box(w - 0.5, 0.16, 0.22), mat('#7FA84E', op));
          c.position.set(0, 0.14, z); c.castShadow = op >= 1; c.receiveShadow = true; g.add(c); parts.crops.push(c);
        }
        break;
      }
      case 'quarry': {
        part(g, box(w - 0.24, 0.06, h - 0.24), '#B9B1A5', 0, 0.03, 0, op).castShadow = false;
        for (let k = 0; k < 4; k++) part(g, box(0.5, 0.22 + (k % 3) * 0.08, 0.4), k % 2 ? '#8a8276' : '#9a9186', (k % 2 ? 0.35 : -0.35), 0.15, (k < 2 ? -0.35 : 0.35), op);
        part(g, box(0.08, 0.9, 0.08), '@wood', 0.75, 0.45, -0.75, op);
        part(g, box(0.6, 0.05, 0.05), '@wood', 0.5, 0.88, -0.75, op);
        break;
      }
      case 'granary': {
        for (const [px, pz] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) {
          part(g, box(0.1, 0.36, 0.1), '@wood', px, 0.18, pz, op);
          part(g, cyl(0.1, 0.1, 0.04, 10), '#9a9186', px, 0.36, pz, op); // stone caps keep the mice out
        }
        part(g, box(1.36, 0.56, 1.24), '@wood', 0, 0.38 + 0.28, 0, op);
        const s = new THREE.Shape(); s.moveTo(-0.84, 0); s.lineTo(0.84, 0); s.lineTo(0, 0.62); s.closePath();
        const roof = new THREE.ExtrudeGeometry(s, { depth: 1.46, bevelEnabled: false }); roof.translate(0, 0, -0.73);
        const rm = part(g, roof, '@thatch', 0, 0.94, 0, op);
        rm.material = mat('#b98a3e', op); // extruded faces have no useful texture layout
        break;
      }
      default: { // huts: gatherer, fisher, woodcutter
        roundhouse(g, 0.46, 0.32, 0.56, -0.24, -0.18, op, turn);
        if (type === 'woodcutter') {
          for (let k = 0; k < 3; k++) { const l = part(g, cyl(0.07, 0.07, 0.62, 7), '#7a5530', 0.42, 0.07 + (k === 2 ? 0.12 : 0), 0.36 + (k === 2 ? 0.07 : k * 0.14), op); l.rotation.z = Math.PI / 2; }
          part(g, cyl(0.12, 0.13, 0.16, 8), '#8a6a40', 0.5, 0.08, -0.45, op);
        }
        if (type === 'gatherer') for (let k = 0; k < 3; k++) part(g, cyl(0.1, 0.07, 0.15, 8), '#8a5a2b', 0.25 + k * 0.24, 0.075, 0.6, op);
        if (type === 'fisher') {
          part(g, box(0.05, 0.42, 0.05), '@wood', 0.25, 0.21, 0.55, op);
          part(g, box(0.05, 0.42, 0.05), '@wood', 0.85, 0.21, 0.55, op);
          part(g, box(0.66, 0.04, 0.04), '@wood', 0.55, 0.4, 0.55, op);
          part(g, box(0.5, 0.2, 0.01), '#a89a7a', 0.55, 0.28, 0.55, op, false); // drying net
          const boat = part(g, new THREE.SphereGeometry(0.3, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#6d4a2a', 0.55, 0.12, -0.45, op);
          boat.scale.set(1.3, 0.45, 0.5); boat.rotation.y = 0.3;
        }
      }
    }
    return { g, parts };
  }

  // footprint plates (selection, ghost, building site)
  function plate(w, h, color, opacity) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; g.add(fill);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w - 0.04, h - 0.04)), new THREE.LineBasicMaterial({ color }));
    edge.rotation.x = -Math.PI / 2; g.add(edge);
    g.userData.setColor = (c, o) => { fill.material.color.set(c); fill.material.opacity = o; edge.material.color.set(c); };
    return g;
  }

  const bGroup = new THREE.Group(); scene.add(bGroup);
  const models = new Map(); // building id -> { key, g, parts, model }
  function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.isMeshBasicMaterial) o.material.dispose(); if (o.material && o.material.isLineBasicMaterial) o.material.dispose(); }); }

  function fieldColor(b) {
    const se = G.seasonOf(G.S.month), m = G.S.month, HV = G.MONTH_HARVEST;
    const ripe = b.sown && (m <= HV || se === 3);
    let c = (m === HV - 1 || m === HV) ? '#D9B25F' : '#7FA84E';
    if (!ripe) c = '#93A35A';
    return c;
  }

  const smokeFrom = []; // chimney points of lived-in houses
  function syncBuildings() {
    const S = G.S, seen = new Set();
    let sig = '';
    smokeFrom.length = 0;
    const homes = new Set((S.families || []).map(f => f.home));
    for (const b of S.buildings) {
      seen.add(b.id); sig += b.id + ',';
      const d = DEFS[b.type], key = b.type + (b.done ? ':done' : ':site');
      let e = models.get(b.id);
      if (!e || e.key !== key) {
        if (e) { bGroup.remove(e.g); disposeGroup(e.g); }
        const turn = G.hash(b.id, 17) * 6.28;
        const m = makeModel(b.type, d.w, d.h, b.done ? 1 : 0.55, turn);
        e = { key, g: new THREE.Group(), parts: m.parts, model: m.g };
        e.g.add(m.g);
        const [top, low] = footprintRange(b.x, b.y, d.w, d.h);
        if (top - low > 0.05) { // packed-earth terrace where the ground slopes away (round under a house)
          const bh = top - low + 0.1;
          const base = new THREE.Mesh(b.type === 'house' ? cyl(Math.min(d.w, d.h) / 2 - 0.08, Math.min(d.w, d.h) / 2, bh, 20) : box(d.w - 0.08, bh, d.h - 0.08), mat('#a08a66'));
          base.position.y = -bh / 2 + 0.005; base.receiveShadow = true; e.g.add(base);
        }
        e.site = b.done ? null : plate(d.w - 0.1, d.h - 0.1, '#E8A33D', 0.22);
        if (e.site) { e.site.position.y = 0.03; e.g.add(e.site); }
        e.g.traverse(o => { o.userData.bid = b.id; });
        e.g.position.set(b.x + d.w / 2, top, b.y + d.h / 2);
        bGroup.add(e.g); models.set(b.id, e);
      }
      // live details
      if (!b.done) e.model.scale.y = 0.2 + 0.8 * Math.min(1, b.progress / d.work);
      else e.model.scale.y = 1;
      if (e.parts.water) e.parts.water.material = mat(S.drought && G.seasonOf(S.month) === 1 ? '#5d7f86' : '#2F8C9A', b.done ? 1 : 0.55);
      if (e.parts.crops) {
        const show = !!b.sown, c = fieldColor(b);
        for (const cr of e.parts.crops) { cr.visible = show; cr.material = mat(c, b.done ? 1 : 0.55); }
      }
      if (b.done && e.parts.smokeY && homes.has(b.id)) smokeFrom.push([e.g.position.x, e.g.position.y + e.parts.smokeY, e.g.position.z, b.id]);
    }
    for (const [id, e] of models) if (!seen.has(id)) { bGroup.remove(e.g); disposeGroup(e.g); models.delete(id); }
    if (sig !== tuftSig) { tuftSig = sig; buildTufts(); }
  }

  // ---------- hearth smoke ----------
  const PUFFS = 8, MAX_SMOKE = 40;
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(MAX_SMOKE * PUFFS * 3), sSize = new Float32Array(MAX_SMOKE * PUFFS), sAlpha = new Float32Array(MAX_SMOKE * PUFFS);
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1));
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color('#e9e4dc') } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; vA = aAlpha; }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.15, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false; smoke.renderOrder = 2;
  scene.add(smoke);
  function syncSmoke(time, storm) {
    const n = Math.min(MAX_SMOKE, smokeFrom.length);
    let j = 0;
    for (let e = 0; e < n; e++) {
      const [x, y, z, id] = smokeFrom[e], off = G.hash(id, 5);
      for (let k = 0; k < PUFFS; k++, j++) {
        const ph = (time * 0.22 + k / PUFFS + off) % 1;
        sPos[j * 3] = x + ph * (storm ? 1.2 : 0.55) + Math.sin(time * 1.3 + k) * 0.04 * ph;
        sPos[j * 3 + 1] = y + ph * 1.5;
        sPos[j * 3 + 2] = z + ph * 0.2;
        sSize[j] = 0.1 + ph * 0.45;
        sAlpha[j] = Math.sin(ph * Math.PI) * 0.42 * (1 - ph * 0.4);
      }
    }
    smokeGeo.setDrawRange(0, j);
    smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.aSize.needsUpdate = true; smokeGeo.attributes.aAlpha.needsUpdate = true;
  }

  // selection ring and placement ghost
  let selPlate = null, selFor = null;
  let ghost = null, ghostType = null, ghostPlate = null;
  function syncSelection() {
    const b = G.selected;
    if (selPlate && (!b || selFor !== b.id)) { scene.remove(selPlate); disposeGroup(selPlate); selPlate = null; selFor = null; }
    if (b && G.S.buildings.includes(b)) {
      const d = DEFS[b.type];
      if (!selPlate) { selPlate = plate(d.w, d.h, '#ffffff', 0.18); selFor = b.id; scene.add(selPlate); }
      selPlate.position.set(b.x + d.w / 2, footprintTop(b.x, b.y, d.w, d.h) + 0.04, b.y + d.h / 2);
    }
  }
  function syncGhost() {
    const p = G.placing;
    if (!p) { if (ghost) { scene.remove(ghost); disposeGroup(ghost); ghost = null; ghostType = null; } return; }
    const d = DEFS[p.type];
    if (ghostType !== p.type) {
      if (ghost) { scene.remove(ghost); disposeGroup(ghost); }
      ghost = new THREE.Group();
      ghost.add(makeModel(p.type, d.w, d.h, 0.6).g);
      ghostPlate = plate(d.w, d.h, '#4f8a3a', 0.3); ghostPlate.position.y = 0.04; ghost.add(ghostPlate);
      ghostType = p.type; scene.add(ghost);
    }
    const bad = !!G.canPlace(p.type, p.x, p.y);
    ghostPlate.userData.setColor(bad ? '#D4483B' : '#4f8a3a', bad ? 0.38 : 0.3);
    ghost.position.set(p.x + d.w / 2, footprintTop(p.x, p.y, d.w, d.h), p.y + d.h / 2);
  }

  // ---------- people (instanced) ----------
  const bodyGeo = new THREE.CylinderGeometry(0.05, 0.085, 0.27, 7); bodyGeo.translate(0, 0.135, 0);
  const headGeo = new THREE.SphereGeometry(0.065, 10, 8); headGeo.translate(0, 0.33, 0);
  let cap = 0, bodies = null, heads = null, prevX = null, prevY = null;
  function ensurePeople(n) {
    if (n <= cap) return;
    if (bodies) { scene.remove(bodies, heads); bodies.dispose(); heads.dispose(); }
    cap = Math.max(64, cap * 2, n);
    bodies = new THREE.InstancedMesh(bodyGeo, mat('#ffffff'), cap);
    heads = new THREE.InstancedMesh(headGeo, mat('#e3b98f'), cap);
    bodies.castShadow = true; heads.castShadow = true;
    bodies.frustumCulled = false; heads.frustumCulled = false;
    prevX = new Float32Array(cap); prevY = new Float32Array(cap);
    scene.add(bodies, heads);
  }
  const tmpO = new THREE.Object3D(), tmpC = new THREE.Color();
  function syncPeople(time) {
    const ppl = G.S.people;
    ensurePeople(ppl.length);
    ppl.forEach((p, i) => {
      const moving = Math.abs(p.x - prevX[i]) + Math.abs(p.y - prevY[i]) > 1e-4;
      prevX[i] = p.x; prevY[i] = p.y;
      const bob = moving ? Math.abs(Math.sin(time * 11 + i * 1.7)) * 0.025 : 0;
      tmpO.position.set(p.x, groundAt(p.x, p.y) + bob, p.y);
      tmpO.scale.setScalar(p.age < 14 ? 0.95 : 1.3);
      tmpO.updateMatrix();
      bodies.setMatrixAt(i, tmpO.matrix); heads.setMatrixAt(i, tmpO.matrix);
      bodies.setColorAt(i, tmpC.set(p.health < 40 ? '#c0392b' : (p.sex === 'm' ? '#6d3f22' : '#a8552a')));
    });
    bodies.count = heads.count = ppl.length;
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  }

  // ---------- camera (and the sun's shadow box follows it) ----------
  let viewW = 1, viewH = 1, pixelRatio = 1, shadowExt = 0;
  function distance() { return viewH / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * G.camera.zoom); }
  function placeCamera() {
    const d = distance(), tx = G.camera.x, tz = G.camera.y, ty = groundAt(tx, tz);
    cam.position.set(tx + d * Math.cos(PITCH) * Math.sin(yaw), ty + d * Math.sin(PITCH), tz + d * Math.cos(PITCH) * Math.cos(yaw));
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld();
    scene.fog.near = d * 1.5; scene.fog.far = d * 3.8 + 30;
    // shadows only where the camera looks: much sharper than one box over the whole map
    const ext = Math.max(7, Math.min(40, Math.ceil(d * 0.85)));
    if (ext !== shadowExt) {
      shadowExt = ext;
      Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
      sun.shadow.camera.updateProjectionMatrix();
    }
    const snap = (2 * ext) / sun.shadow.mapSize.x;
    const sx = Math.round(tx / snap) * snap, sz = Math.round(tz / snap) * snap;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + SUN_DIR.x * 50, SUN_DIR.y * 50, sz + SUN_DIR.z * 50);
  }

  // ---------- weather and season light ----------
  const SEASON = [ // spring, summer, autumn, winter
    { top: '#8ec3e6', hor: '#d9ebee', sun: '#ffeccb', si: 2.5, hemi: '#bcd8f0' },
    { top: '#7ab9e4', hor: '#ebeedb', sun: '#fff0d4', si: 3.0, hemi: '#c4dcef' },
    { top: '#9dbcd4', hor: '#efe0c6', sun: '#ffd49a', si: 2.5, hemi: '#c9d3dc' },
    { top: '#a5bbcb', hor: '#dbe2e4', sun: '#f3ecdf', si: 2.1, hemi: '#c3d0da' },
  ];
  const fogCol = new THREE.Color();
  function syncLight(dt) {
    const S = G.S, se = G.seasonOf(S.month), L = SEASON[se];
    const storm = !!S.storm;
    sun.color.set(storm ? '#d7dde0' : L.sun);
    sun.intensity = L.si * (storm ? 0.42 : 1);
    hemi.color.set(storm ? '#9fb0b8' : L.hemi);
    hemi.intensity = storm ? 1.25 : 1.15;
    const top = storm ? '#6e7f88' : L.top, hor = storm ? '#a6b0b3' : L.hor;
    paintSky(top, hor);
    fogCol.set(hor); scene.fog.color.copy(fogCol);
    waterU.uSky.value.set(hor);
    waterU.uDeep.value.set(storm ? '#24505c' : se === 3 ? '#1d5f6e' : '#1b6b7c');
    waterU.uSunCol.value.copy(sun.color).multiplyScalar(storm ? 0.2 : 1);
    const dryTarget = S.drought && se === 1 ? 1 : 0;
    waterU.uDry.value += (dryTarget - waterU.uDry.value) * Math.min(1, dt * 1.5);
  }

  // ---------- finishing pass: miniature focus (tilt-shift), warm grade, soft vignette ----------
  // Needs float colour buffers (all current iPhones and most Android phones). Without them it is skipped.
  let quality = 2; // 2 = full, 1 = no finishing pass, 0 = also smaller shadows, no grass
  const post = (() => {
    try {
      const ext = renderer.extensions;
      if (!renderer.capabilities.isWebGL2 || !(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) return null;
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      const m = new THREE.ShaderMaterial({
        uniforms: { tScene: { value: rt.texture }, uRes: { value: new THREE.Vector2(1, 1) } },
        depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D tScene; uniform vec2 uRes; varying vec2 vUv;
          void main() {
            vec3 c = texture2D(tScene, vUv).rgb;
            float blur = smoothstep(0.2, 0.52, abs(vUv.y - 0.5)) * 7.0 * (uRes.y / 1600.0 + 0.5);
            if (blur > 0.3) {
              vec3 acc = c;
              for (int i = 0; i < 12; i++) {
                float fi = float(i), a = fi * 2.39996, r = blur * sqrt((fi + 0.5) / 12.0);
                acc += texture2D(tScene, vUv + vec2(cos(a), sin(a)) * r / uRes).rgb;
              }
              c = acc / 13.0;
            }
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            c = mix(vec3(l), c, 1.04) * vec3(1.03, 1.0, 0.95);
            vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.5;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); quad.frustumCulled = false;
      const s = new THREE.Scene(); s.add(quad);
      return { rt, m, scene: s, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
    } catch (e) { return null; }
  })();
  if (!post) quality = 1;
  function setQuality(q) {
    quality = Math.max(0, Math.min(post ? 2 : 1, q));
    const size = quality >= 1 ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    tuftSig = ''; // rebuild grass for the new level
  }
  // speed guard: if the phone struggles, step down once per ~2 seconds of slow frames, never back up
  let fFrames = 0, fTime = 0, warm = 90;
  function watchSpeed(dt) {
    if (document.hidden) return;
    if (warm > 0) { warm--; return; }
    fFrames++; fTime += dt;
    if (fFrames >= 120) {
      if (fTime / fFrames > 0.036 && quality > 0) { setQuality(quality - 1); warm = 60; }
      fFrames = 0; fTime = 0;
    }
  }

  // ---------- public ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v3 = new THREE.Vector3(), dbs = new THREE.Vector2();
  let lastT = performance.now(), time = 0;
  const api = {
    canvas,
    get yaw() { return yaw; },
    get quality() { return quality; },
    setQuality,
    PITCH,
    setVisible(on) { canvas.style.display = on ? 'block' : 'none'; },
    resize(w, h, dpr) {
      viewW = w; viewH = h; pixelRatio = dpr;
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
      renderer.getDrawingBufferSize(dbs);
      if (post) { post.rt.setSize(dbs.x, dbs.y); post.m.uniforms.uRes.value.copy(dbs); }
      smokeMat.uniforms.uScale.value = dbs.y / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2));
    },
    rotate(steps) { yawTarget += steps * Math.PI / 4; },
    twist(rad) { yaw += rad; yawTarget = yaw; },
    terrainChanged() {
      if (!G.S) return;
      if (mapSeed !== G.S.seed) {
        mapSeed = G.S.seed; buildHeights(); applyHeights(); fillHeightTex();
        for (const [, e] of models) { bGroup.remove(e.g); disposeGroup(e.g); } models.clear();
      }
      paintGround();
      buildTrees();
      tuftSig = '';
    },
    render() {
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!G.S) return;
      if (mapSeed !== G.S.seed) api.terrainChanged();
      time += dt;
      windU.value = time; waterU.uTime.value = time;
      if (Math.abs(yawTarget - yaw) > 1e-4) yaw += (yawTarget - yaw) * Math.min(1, dt * 9); else yaw = yawTarget;
      syncLight(dt); syncBuildings(); syncSelection(); syncGhost(); syncPeople(time); syncSmoke(time, G.S.storm);
      placeCamera();
      if (post && quality >= 2) {
        renderer.setRenderTarget(post.rt); renderer.render(scene, cam);
        renderer.setRenderTarget(null); renderer.render(post.scene, post.cam);
      } else renderer.render(scene, cam);
      watchSpeed(dt);
    },
    // screen point -> { x, y } in tile units, plus bid when a building was hit
    pick(sx, sy) {
      ndc.set(sx / viewW * 2 - 1, -(sy / viewH) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hb = ray.intersectObjects(bGroup.children, true)[0];
      if (hb && hb.object.userData.bid !== undefined) return { x: hb.point.x, y: hb.point.z, bid: hb.object.userData.bid };
      const ht = ray.intersectObject(terrain, false)[0];
      if (ht) return { x: ht.point.x, y: ht.point.z };
      return null;
    },
    // tile point (+ height above ground) -> screen pixels, or null when behind the camera
    project(x, y, up) {
      v3.set(x, groundAt(x, y) + up, y).project(cam);
      if (v3.z > 1) return null;
      return [(v3.x + 1) / 2 * viewW, (1 - v3.y) / 2 * viewH];
    },
    groundAt,
  };
  return api;
};
