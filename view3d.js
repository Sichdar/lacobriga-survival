// Lacobriga Survival · 3D view (added 20/11/2026)
// Draws the same game state as the top view, with three.js. The game rules never depend on this file:
// game.js loads three.js on demand and calls createView3D(THREE, G). If anything here fails, the game keeps the top view.
// World axes: map x -> X, map y -> Z (south is +Z), height -> Y. One tile = one unit.
window.createView3D = function (THREE, G) {
  'use strict';
  const { W, H, T, DEFS } = G;

  // ---------- renderer, scene, camera ----------
  const canvas = document.createElement('canvas');
  canvas.id = 'map3d';
  document.body.insertBefore(canvas, document.getElementById('map'));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const SKY = new THREE.Color('#b7d9db');
  const scene = new THREE.Scene();
  scene.background = SKY.clone();
  scene.fog = new THREE.Fog(SKY.clone(), 40, 120);

  const FOV = 40;
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.3, 500);
  const PITCH = 0.92; // about 53 degrees above the ground
  let yaw = 0, yawTarget = 0;

  const hemi = new THREE.HemisphereLight('#fff7e6', '#6f6248', 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d0', 2.0);
  sun.position.set(W / 2 + 18, 30, H / 2 + 14);
  sun.target.position.set(W / 2, 0, H / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 90 });
  sun.shadow.bias = -0.0015;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---------- materials (shared, cached) ----------
  const matCache = new Map();
  function mat(color, opacity = 1, flat = true) {
    const key = color + '|' + opacity + '|' + flat;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: flat, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
      matCache.set(key, m);
    }
    return m;
  }

  // ---------- terrain ----------
  let mapSeed = null;
  const hC = new Float32Array((W + 1) * (H + 1)); // corner heights
  const isWater = t => t === T.SEA || t === T.RIVER;
  function hill(x, y) { return 0.35 + 1.5 * Math.exp(-((x - 16) ** 2 + ((y - 21) * 0.8) ** 2) / 90); }
  function tileH(x, y) {
    const t = G.tiles[y * W + x];
    if (t === T.SEA) return -0.3;
    if (t === T.RIVER) return -0.2;
    if (t === T.MARSH) return 0.04;
    if (t === T.SAND) return 0.12;
    return hill(x + 0.5, y + 0.5);
  }
  function buildHeights() {
    for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
      let s = 0, n = 0, water = 0;
      for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        s += tileH(x, y); n++; if (isWater(G.tiles[y * W + x])) water++;
      }
      let h = n ? s / n : -0.3;
      if (water && h > 0) h = Math.min(h, 0.02);           // banks come down to the water
      if (cx === 0 || cy === 0 || cx === W || cy === H) h = -0.3; // the map ends at the sea all round
      hC[cy * (W + 1) + cx] = h;
    }
  }
  function groundAt(x, y) {
    x = Math.max(0, Math.min(W - 0.001, x)); y = Math.max(0, Math.min(H - 0.001, y));
    const cx = Math.floor(x), cy = Math.floor(y), fx = x - cx, fy = y - cy, R = W + 1;
    const a = hC[cy * R + cx], b = hC[cy * R + cx + 1], c = hC[(cy + 1) * R + cx], d = hC[(cy + 1) * R + cx + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function footprintTop(x, y, w, h) {
    let m = -1;
    for (let yy = y; yy <= y + h; yy++) for (let xx = x; xx <= x + w; xx++)
      if (xx >= 0 && yy >= 0 && xx <= W && yy <= H) m = Math.max(m, hC[yy * (W + 1) + xx]);
    return Math.max(m, 0);
  }

  const terrainTex = new THREE.CanvasTexture(G.terrainCanvas);
  terrainTex.colorSpace = THREE.SRGBColorSpace;
  terrainTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const terrainGeo = new THREE.PlaneGeometry(W, H, W, H);
  terrainGeo.rotateX(-Math.PI / 2);
  terrainGeo.translate(W / 2, 0, H / 2);
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshLambertMaterial({ map: terrainTex }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: G.PAL.sea }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(W / 2, -0.28, H / 2);
  scene.add(sea);

  function applyHeights() {
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, hC[i]); // PlaneGeometry order matches corner order (row = map y)
    pos.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    terrainGeo.computeBoundingSphere();
    terrainGeo.computeBoundingBox();
  }

  // ---------- trees and boulders (instanced, rebuilt when the terrain changes) ----------
  const trunkGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.4, 5); trunkGeo.translate(0, 0.2, 0);
  const oakGeo = new THREE.IcosahedronGeometry(0.42, 0); oakGeo.scale(1, 0.8, 1); oakGeo.translate(0, 0.62, 0);
  const pineGeo = new THREE.ConeGeometry(0.32, 0.95, 6); pineGeo.translate(0, 0.78, 0);
  const rockGeo = new THREE.DodecahedronGeometry(0.28, 0); rockGeo.scale(1, 0.6, 1);
  let treeMeshes = [];
  function clearTrees() { for (const m of treeMeshes) { scene.remove(m); m.dispose(); } treeMeshes = []; }
  function inst(geo, material, list, castShadow) {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, material, list.length);
    const o = new THREE.Object3D(), col = new THREE.Color();
    list.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z); o.rotation.set(0, it.r || 0, 0); o.scale.setScalar(it.s || 1); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, col.set(it.c));
    });
    m.castShadow = castShadow; m.receiveShadow = false;
    scene.add(m); treeMeshes.push(m);
  }
  function buildTrees() {
    clearTrees();
    const se = G.seasonOf(G.S.month);
    const leaf = se === 1 ? ['#4D6E35', '#5a7438', '#46682f'] : se === 3 ? ['#3a6136', '#45663a', '#365a33'] : ['#3F6B3A', '#4a7a3f', '#386236'];
    const trunks = [], oaks = [], pines = [], rocks = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, h = G.hash(x, y), h2 = G.hash(y, x);
      if (G.trees[i]) {
        const px = x + 0.5 + (h - 0.5) * 0.4, pz = y + 0.5 + (h2 - 0.5) * 0.4, py = groundAt(px, pz), s = 0.8 + h * 0.5;
        trunks.push({ x: px, y: py, z: pz, s });
        if (h2 < 0.3) pines.push({ x: px, y: py, z: pz, s, r: h * 6, c: leaf[2] });
        else oaks.push({ x: px, y: py, z: pz, s, r: h * 6, c: leaf[Math.floor(h2 * 2.99)] });
      } else if (G.tiles[i] === T.ROCK) {
        const n = 1 + Math.floor(h * 2);
        for (let k = 0; k < n; k++) {
          const px = x + 0.25 + G.hash(x + k, y) * 0.5, pz = y + 0.25 + G.hash(x, y + k) * 0.5;
          rocks.push({ x: px, y: groundAt(px, pz) + 0.05, z: pz, s: 0.7 + G.hash(x + k, y + k) * 0.7, r: h * 6, c: k % 2 ? '#a39a8e' : '#8a8276' });
        }
      }
    }
    inst(trunkGeo, mat('#6b4a2b'), trunks, true);
    inst(oakGeo, mat('#ffffff'), oaks, true);
    inst(pineGeo, mat('#ffffff'), pines, true);
    inst(rockGeo, mat('#ffffff'), rocks, true);
  }

  // ---------- building models ----------
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
  function part(group, geo, color, x, y, z, opacity, shadow = true) {
    const m = new THREE.Mesh(geo, mat(color, opacity));
    m.position.set(x, y, z); m.castShadow = shadow && opacity >= 1; m.receiveShadow = true;
    group.add(m); return m;
  }
  function roundhouse(g, r, wallH, roofH, x, z, op) {
    part(g, cyl(r, r * 1.04, wallH, 14), '#9E958A', x, wallH / 2, z, op);
    part(g, new THREE.ConeGeometry(r * 1.22, roofH, 14), '#B98A3E', x, wallH + roofH / 2 - 0.02, z, op);
    part(g, box(r * 0.36, wallH * 0.75, 0.08), '#4a3520', x, wallH * 0.375, z + r * 1.0, op, false);
  }
  function makeModel(type, w, h, op) {
    const g = new THREE.Group();
    const parts = {};
    switch (type) {
      case 'house': roundhouse(g, 0.68, 0.42, 0.78, 0, 0, op); break;
      case 'well': {
        part(g, cyl(0.34, 0.37, 0.3), '#9E958A', 0, 0.15, 0, op);
        parts.water = part(g, cyl(0.25, 0.25, 0.02), '#2F8C9A', 0, 0.3, 0, op, false);
        part(g, box(0.06, 0.62, 0.06), '#6b4a2b', -0.32, 0.31, 0, op);
        part(g, box(0.06, 0.62, 0.06), '#6b4a2b', 0.32, 0.31, 0, op);
        part(g, box(0.72, 0.06, 0.06), '#6b4a2b', 0, 0.6, 0, op);
        break;
      }
      case 'field': {
        part(g, box(w - 0.24, 0.06, h - 0.24), '#9A7448', 0, 0.03, 0, op).castShadow = false;
        parts.crops = [];
        for (let k = 0; k < 7; k++) {
          const z = -(h - 0.24) / 2 + (h - 0.24) * (k + 0.5) / 7;
          part(g, box(w - 0.5, 0.02, 0.05), '#6e5230', 0, 0.065, z, op, false);
          const c = new THREE.Mesh(box(w - 0.5, 0.16, 0.24), mat('#7FA84E', op));
          c.position.set(0, 0.14, z); c.castShadow = op >= 1; g.add(c); parts.crops.push(c);
        }
        break;
      }
      case 'quarry': {
        part(g, box(w - 0.24, 0.06, h - 0.24), '#B9B1A5', 0, 0.03, 0, op).castShadow = false;
        for (let k = 0; k < 4; k++) part(g, box(0.5, 0.22 + (k % 3) * 0.08, 0.4), k % 2 ? '#8a8276' : '#9a9186', (k % 2 ? 0.35 : -0.35), 0.15, (k < 2 ? -0.35 : 0.35), op);
        part(g, box(0.08, 0.9, 0.08), '#6b4a2b', 0.75, 0.45, -0.75, op);
        break;
      }
      case 'granary': {
        for (const [px, pz] of [[-0.55, -0.5], [0.55, -0.5], [-0.55, 0.5], [0.55, 0.5]]) part(g, box(0.1, 0.36, 0.1), '#6b4a2b', px, 0.18, pz, op);
        part(g, box(1.36, 0.56, 1.24), '#C9A36B', 0, 0.36 + 0.28, 0, op);
        const s = new THREE.Shape(); s.moveTo(-0.82, 0); s.lineTo(0.82, 0); s.lineTo(0, 0.6); s.closePath();
        const roof = new THREE.ExtrudeGeometry(s, { depth: 1.44, bevelEnabled: false }); roof.translate(0, 0, -0.72);
        part(g, roof, '#B98A3E', 0, 0.92, 0, op);
        break;
      }
      default: { // huts: gatherer, fisher, woodcutter
        roundhouse(g, 0.46, 0.32, 0.56, -0.24, -0.18, op);
        if (type === 'woodcutter') {
          for (let k = 0; k < 3; k++) { const l = part(g, cyl(0.07, 0.07, 0.62, 7), '#7a5530', 0.42, 0.07 + (k === 2 ? 0.12 : 0), 0.36 + (k === 2 ? 0.07 : k * 0.14), op); l.rotation.z = Math.PI / 2; }
          part(g, cyl(0.12, 0.13, 0.16, 8), '#8a6a40', 0.5, 0.08, -0.45, op);
        }
        if (type === 'gatherer') for (let k = 0; k < 3; k++) part(g, cyl(0.1, 0.07, 0.15, 8), '#8a5a2b', 0.25 + k * 0.24, 0.075, 0.6, op);
        if (type === 'fisher') {
          part(g, box(0.05, 0.42, 0.05), '#6b4a2b', 0.25, 0.21, 0.55, op);
          part(g, box(0.05, 0.42, 0.05), '#6b4a2b', 0.85, 0.21, 0.55, op);
          part(g, box(0.66, 0.04, 0.04), '#6b4a2b', 0.55, 0.4, 0.55, op);
          const boat = part(g, new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#6d4a2a', 0.55, 0.12, -0.45, op);
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
  const models = new Map(); // building id -> { key, g, parts, plate }
  function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.isMeshBasicMaterial) o.material.dispose(); if (o.material && o.material.isLineBasicMaterial) o.material.dispose(); }); }

  function fieldColor(b) {
    const se = G.seasonOf(G.S.month), m = G.S.month, HV = G.MONTH_HARVEST;
    const ripe = b.sown && (m <= HV || se === 3);
    let c = (m === HV - 1 || m === HV) ? '#D9B25F' : '#7FA84E';
    if (!ripe) c = '#93A35A';
    return c;
  }

  function syncBuildings() {
    const S = G.S, seen = new Set();
    for (const b of S.buildings) {
      seen.add(b.id);
      const d = DEFS[b.type], key = b.type + (b.done ? ':done' : ':site');
      let e = models.get(b.id);
      if (!e || e.key !== key) {
        if (e) { bGroup.remove(e.g); disposeGroup(e.g); }
        const m = makeModel(b.type, d.w, d.h, b.done ? 1 : 0.55);
        e = { key, g: new THREE.Group(), parts: m.parts, model: m.g };
        e.g.add(m.g);
        e.site = b.done ? null : plate(d.w - 0.1, d.h - 0.1, '#E8A33D', 0.22);
        if (e.site) { e.site.position.y = 0.03; e.g.add(e.site); }
        e.g.traverse(o => { o.userData.bid = b.id; });
        const cx = b.x + d.w / 2, cz = b.y + d.h / 2;
        e.g.position.set(cx, footprintTop(b.x, b.y, d.w, d.h), cz);
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
    }
    for (const [id, e] of models) if (!seen.has(id)) { bGroup.remove(e.g); disposeGroup(e.g); models.delete(id); }
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
  const bodyGeo = new THREE.CylinderGeometry(0.05, 0.085, 0.27, 6); bodyGeo.translate(0, 0.135, 0);
  const headGeo = new THREE.SphereGeometry(0.065, 8, 6); headGeo.translate(0, 0.33, 0);
  let cap = 0, bodies = null, heads = null;
  function ensurePeople(n) {
    if (n <= cap) return;
    if (bodies) { scene.remove(bodies, heads); bodies.dispose(); heads.dispose(); }
    cap = Math.max(64, cap * 2, n);
    bodies = new THREE.InstancedMesh(bodyGeo, mat('#ffffff'), cap);
    heads = new THREE.InstancedMesh(headGeo, mat('#e3b98f'), cap);
    bodies.castShadow = true; heads.castShadow = true;
    bodies.frustumCulled = false; heads.frustumCulled = false;
    scene.add(bodies, heads);
  }
  const tmpO = new THREE.Object3D(), tmpC = new THREE.Color();
  function syncPeople() {
    const ppl = G.S.people;
    ensurePeople(ppl.length);
    ppl.forEach((p, i) => {
      tmpO.position.set(p.x, groundAt(p.x, p.y), p.y);
      tmpO.scale.setScalar(p.age < 14 ? 0.95 : 1.3);
      tmpO.updateMatrix();
      bodies.setMatrixAt(i, tmpO.matrix); heads.setMatrixAt(i, tmpO.matrix);
      bodies.setColorAt(i, tmpC.set(p.health < 40 ? '#c0392b' : (p.sex === 'm' ? '#6d3f22' : '#a8552a')));
    });
    bodies.count = heads.count = ppl.length;
    bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  }

  // ---------- camera ----------
  let viewW = 1, viewH = 1;
  function distance() { return viewH / (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * G.camera.zoom); }
  function placeCamera() {
    const d = distance(), tx = G.camera.x, tz = G.camera.y, ty = groundAt(tx, tz);
    cam.position.set(tx + d * Math.cos(PITCH) * Math.sin(yaw), ty + d * Math.sin(PITCH), tz + d * Math.cos(PITCH) * Math.cos(yaw));
    cam.lookAt(tx, ty, tz);
    cam.updateMatrixWorld();
    scene.fog.near = d * 1.4; scene.fog.far = d * 3.6 + 30;
  }

  // ---------- weather and season light ----------
  function syncLight() {
    const S = G.S, se = G.seasonOf(S.month);
    const sunI = [1.9, 2.0, 1.7, 1.3][se] * (S.storm ? 0.55 : 1);
    sun.intensity = sunI;
    hemi.intensity = S.storm ? 1.0 : 1.3;
    const sky = S.storm ? '#8d9ea3' : ['#b7d9db', '#cfe0d6', '#c3d3d0', '#aebfc6'][se];
    scene.background.set(sky); scene.fog.color.set(sky);
  }

  // ---------- public ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v3 = new THREE.Vector3();
  let lastT = performance.now();
  const api = {
    canvas,
    get yaw() { return yaw; },
    PITCH,
    setVisible(on) { canvas.style.display = on ? 'block' : 'none'; },
    resize(w, h, dpr) {
      viewW = w; viewH = h;
      renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    },
    rotate(steps) { yawTarget += steps * Math.PI / 4; },
    twist(rad) { yaw += rad; yawTarget = yaw; },
    terrainChanged() {
      if (!G.S) return;
      if (mapSeed !== G.S.seed) {
        mapSeed = G.S.seed; buildHeights(); applyHeights();
        for (const [, e] of models) { bGroup.remove(e.g); disposeGroup(e.g); } models.clear();
      }
      terrainTex.needsUpdate = true;
      buildTrees();
    },
    render() {
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      if (!G.S) return;
      if (mapSeed !== G.S.seed) api.terrainChanged();
      if (Math.abs(yawTarget - yaw) > 1e-4) yaw += (yawTarget - yaw) * Math.min(1, dt * 9); else yaw = yawTarget;
      syncLight(); syncBuildings(); syncSelection(); syncGhost(); syncPeople();
      placeCamera();
      renderer.render(scene, cam);
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
