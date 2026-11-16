// The course: a ~2.1 km loop in five sections.
//   1. Open-sea start and a buoy-lined sweeper.
//   2. A tight left hairpin around the lighthouse rock.
//   3. The gorge: a narrow sandstone canyon with S-bends and a waterfall
//      pouring off a rock arch, which you ride straight through.
//   4. The lagoon: wide turquoise water with a trampoline and cash rings.
//   5. The canal town: 12 m canals between pastel houses, 90-degree
//      corners, bridges and string lights, back out to the start.
// The centreline has a half-width per sample; "walled" sections get banks
// (cliffs or quays) built from that width, and the craft is kept inside.
// Also bakes a distance-to-land map that the ocean uses for shore foam,
// turquoise shallows and calmer swell in narrow water.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

// x, z of the centreline control points.
const CONTROL = [
  [-40, 252], [60, 256], [170, 240], [262, 196], [314, 122], [330, 40], [326, -40], // 0-6 start, sweeper
  [322, -110], [312, -165], [285, -188], [258, -170], [250, -122], [244, -86],       // 7-12 hairpin
  [205, -58], [160, -45],                                                           // 13-14 into the gorge
  [110, -62], [60, -36], [10, -58], [-40, -32], [-90, -52], [-135, -40],             // 15-20 gorge S-bends
  [-190, -60], [-245, -46], [-285, 0], [-292, 62],                                  // 21-24 lagoon
  [-282, 104], [-262, 128], [-225, 135], [-195, 139], [-178, 157], [-175, 190],      // 25-30 town
  [-160, 210], [-125, 216], [-98, 236],                                             // 31-33 town exit
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const OPEN_HALF = 11;
export const KIND = { open: 0, gorge: 1, town: 2 };
// Walled sections, by control point index.
const SECTIONS = [
  { a: 14, b: 20, kind: KIND.gorge, half: 7 },
  { a: 25, b: 32, kind: KIND.town, half: 6 },
];
const LAGOON = { a: 21, b: 24, half: 14 };
const SAMPLES = 2400;
const MOUTH = 40; // samples over which a walled section narrows to its width

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

export function buildCourse(scene) {
  seed = 12345;
  const curve = new THREE.CatmullRomCurve3(CONTROL, true, 'centripetal');
  const length = curve.getLength();
  const pts = [], tans = [], rights = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    pts.push(p); tans.push(t); rights.push(new THREE.Vector3(-t.z, 0, t.x));
  }
  const wrap = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const cyc = (a, b) => { let d = Math.abs(a - b) % SAMPLES; return Math.min(d, SAMPLES - d); };
  const step = length / SAMPLES;

  // Signed curvature (positive = turning right, toward +right).
  const curv = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const a = tans[wrap(i - 6)], b = tans[wrap(i + 6)];
    const cross = a.x * b.z - a.z * b.x; // y of a x b
    curv[i] = Math.asin(Math.max(-1, Math.min(1, cross))) / (12 * step);
  }

  // Nearest sample to each control point, to place the sections.
  const cpIdx = CONTROL.map((c) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < SAMPLES; i++) { const d = (pts[i].x - c.x) ** 2 + (pts[i].z - c.z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  });

  // Per-sample half width, kind, and wall factor (0 at a section's mouth, 1 inside).
  const half = new Float32Array(SAMPLES).fill(OPEN_HALF);
  const kind = new Uint8Array(SAMPLES);
  const wallF = new Float32Array(SAMPLES);
  const walled = new Uint8Array(SAMPLES);
  {
    const i0 = cpIdx[LAGOON.a], i1 = cpIdx[LAGOON.b];
    for (let i = i0 - 60; i <= i1 + 60; i++) {
      const e = smooth(Math.min(i - (i0 - 60), i1 + 60 - i) / 60);
      half[wrap(i)] = OPEN_HALF + (LAGOON.half - OPEN_HALF) * e;
    }
  }
  for (const s of SECTIONS) {
    const i0 = cpIdx[s.a], i1 = cpIdx[s.b];
    s.i0 = i0; s.i1 = i1;
    for (let i = i0 - MOUTH; i < i0; i++) {
      const e = smooth((i - (i0 - MOUTH)) / MOUTH);
      half[wrap(i)] = OPEN_HALF + (s.half + 9 - OPEN_HALF) * e;
    }
    for (let i = i1 + 1; i <= i1 + MOUTH; i++) {
      const e = smooth((i1 + MOUTH - i) / MOUTH);
      half[wrap(i)] = OPEN_HALF + (s.half + 9 - OPEN_HALF) * e;
    }
    for (let i = i0; i <= i1; i++) {
      const e = smooth(Math.min(i - i0, i1 - i) / MOUTH);
      const k = wrap(i);
      half[k] = s.half + 9 * (1 - e);
      kind[k] = s.kind; wallF[k] = e; walled[k] = 1;
    }
  }

  const at = (u) => {
    const f = (((u % 1) + 1) % 1) * SAMPLES;
    const i = Math.floor(f) % SAMPLES, j = (i + 1) % SAMPLES, k = f - Math.floor(f);
    return {
      p: pts[i].clone().lerp(pts[j], k),
      t: tans[i].clone().lerp(tans[j], k).normalize(),
      r: rights[i].clone().lerp(rights[j], k).normalize(),
      half: half[i] + (half[j] - half[i]) * k,
      idx: i,
    };
  };
  const uOf = (cp) => cpIdx[cp] / SAMPLES;

  // Nearest sample, searched around a hint so it is cheap every frame.
  function nearest(x, z, hint = -1, window = 60) {
    let best = 0, bestD = Infinity;
    const from = hint < 0 ? 0 : hint - window, to = hint < 0 ? SAMPLES : hint + window;
    for (let o = from; o < to; o++) {
      const i = wrap(o);
      const p = pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const lat = (x - pts[best].x) * rights[best].x + (z - pts[best].z) * rights[best].z;
    return { idx: best, u: best / SAMPLES, lat, dist: Math.sqrt(bestD) };
  }

  // How far a bank may reach out from sample i on one side before it
  // would meet another part of the course (or fold over a tight corner).
  function bankExtent(i, side, max) {
    let lim = max;
    const k = curv[i] * side; // > 0: this side is the inside of the corner
    if (k > 1e-4) lim = Math.min(lim, 0.8 / k);
    const p = pts[i], r = rights[i];
    for (let d = half[i] + 2; d < lim; d += 1.5) {
      const x = p.x + r.x * side * d, z = p.z + r.z * side * d;
      for (let j = 0; j < SAMPLES; j += 3) {
        if (cyc(i, j) < 70) continue;
        const dd = Math.hypot(pts[j].x - x, pts[j].z - z);
        if (dd < d || dd < half[j] + (walled[j] ? 2 : 7)) return Math.max(half[i] + 1, d - 1.5);
      }
    }
    return lim;
  }

  const solids = []; // { x, z, r, wobble } circles for collision and the land map
  const shoreR = (s, th) => s.r * (1 + s.wobble * (0.6 * Math.sin(3 * th + s.ph) + 0.4 * Math.sin(7 * th + 2 * s.ph)));
  const landLines = []; // polylines [[x, z], ...] along bank shores (for the land map)

  // ---------- islands with palms ----------

  const islandGeos = [];
  function addIsland(x, z, r, h, palms, force = false) {
    const s = { x, z, r, wobble: 0.1, ph: rnd() * 6 };
    if (!force) {
      for (let i = 0; i < SAMPLES; i += 4) {
        const d = Math.hypot(pts[i].x - x, pts[i].z - z);
        if (d < r * 1.25 + half[i] + (walled[i] ? 55 : 10)) return null;
      }
    }
    solids.push(s);
    const prof = [[0, h], [r * 0.15, h * 0.95], [r * 0.35, h * 0.78], [r * 0.55, h * 0.5], [r * 0.72, h * 0.25],
      [r * 0.86, h * 0.1], [r * 0.95, 1.6], [r, 0.4], [r * 1.08, -1.5], [r * 1.2, -6]].reverse()
      .map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(prof, 48);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xf0d2a0), wet = new THREE.Color(0xa88a62), green = new THREE.Color(0x3f8a3a),
      dark = new THREE.Color(0x2c6434), rock = new THREE.Color(0x9a7a62);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const th = Math.atan2(pz, px);
      const k = shoreR(s, th) / r * (py > 3 ? 1 + 0.07 * Math.sin(th * 11 + py * 0.4) : 1);
      pos.setXYZ(i, x + px * k, py, z + pz * k);
      const hy = py + Math.sin(th * 5 + s.ph) * 1.4;
      if (py < 0.5) c.copy(wet);
      else if (hy < 3.2) c.copy(sand);
      else if (hy < h * 0.75) c.copy(green).lerp(dark, Math.abs(Math.sin(th * 9 + py)) * 0.6);
      else c.copy(rock);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    islandGeos.push(g);
    for (let i = 0; i < palms; i++) {
      const th = (i / palms) * Math.PI * 2 + rnd() * 0.3;
      const rr = shoreR(s, th) * (0.8 - rnd() * 0.08);
      addPalm(x + Math.cos(th) * rr, z + Math.sin(th) * rr, 1.2, 0.8 + rnd() * 0.5, th);
    }
    return s;
  }

  const palmTrunks = [], palmLeaves = [];
  const trunkBase = new THREE.CylinderGeometry(0.2, 0.34, 9, 6, 4).translate(0, 4.5, 0);
  {
    const p = trunkBase.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 9, 2) * 1.6);
    trunkBase.deleteAttribute('uv');
    trunkBase.deleteAttribute('normal');
  }
  const leafBase = new THREE.ConeGeometry(1.0, 4.4, 4, 1, true).translate(0, 2.2, 0).scale(1, 1, 0.25);
  leafBase.deleteAttribute('uv');
  leafBase.deleteAttribute('normal');
  function addPalm(x, z, y, s, th) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -th + Math.PI, 0)), new THREE.Vector3(s, s, s));
    palmTrunks.push(trunkBase.clone().applyMatrix4(m));
    for (let j = 0; j < 6; j++) {
      const lm = new THREE.Matrix4().compose(new THREE.Vector3(1.6, 9, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (j / 6) * Math.PI * 2, 1.9, 'YXZ')), new THREE.Vector3(1, 1, 1));
      palmLeaves.push(leafBase.clone().applyMatrix4(lm).applyMatrix4(m));
    }
  }

  addIsland(40, 110, 50, 22, 12);
  addIsland(-120, 110, 38, 16, 8);
  addIsland(160, 100, 34, 15, 8);
  addIsland(-170, -170, 45, 20, 8);
  addIsland(80, -170, 40, 18, 7);
  addIsland(430, 60, 55, 26, 10);
  addIsland(-400, 60, 60, 30, 10);
  addIsland(140, 360, 42, 18, 8);
  addIsland(-260, 340, 45, 20, 7);
  addIsland(380, -280, 60, 30, 8);
  addIsland(-360, -200, 50, 22, 6);
  const lighthouseRock = addIsland(286, -128, 15, 7, 2, true);
  addIsland(1100, -900, 160, 70, 0, true);   // far horizon
  addIsland(-1300, -600, 200, 90, 0, true);
  addIsland(-900, 1300, 170, 60, 0, true);
  addIsland(1400, 700, 220, 80, 0, true);

  // ---------- banks: gorge cliffs and town quays ----------

  const bankGeos = [];
  const sandstone = [0xd38a5c, 0xe8b07a, 0xb5654a, 0xdf9c68, 0xc47452].map((h) => new THREE.Color(h));
  const wetRock = new THREE.Color(0x5a4038), moss = new THREE.Color(0x4f8a3c), mossDark = new THREE.Color(0x3a6a32);
  const quayStone = new THREE.Color(0xd8cbb2), quayDark = new THREE.Color(0x8c7f6c), plaza = new THREE.Color(0xc98a6a);
  const extents = { [-1]: new Float32Array(SAMPLES), [1]: new Float32Array(SAMPLES) };
  const noise = (a, b) => Math.sin(a * 1.7 + b) * 0.5 + Math.sin(a * 0.63 + b * 2.1) * 0.35 + Math.sin(a * 3.9 + b * 0.7) * 0.15;

  for (const s of SECTIONS) {
    for (const side of [-1, 1]) {
      const verts = [], cols = [], idx = [];
      let R = 0, rowsN = 0;
      const inner = [], outer = [], ledge = [];
      landLines.push(inner, outer, ledge);
      const STEP = 2;
      for (let i = s.i0; i <= s.i1 + 1; i += STEP) {
        const k = wrap(Math.min(i, s.i1));
        const p = pts[k], r = rights[k];
        const e = wallF[k];
        const w = half[k] + 0.4;
        const ext = bankExtent(k, side, s.kind === KIND.gorge ? 60 : 34);
        for (let j = Math.max(s.i0, i - STEP); j <= Math.min(s.i1, i); j++) extents[side][wrap(j)] = ext;
        let rows;
        if (s.kind === KIND.gorge) {
          const top = (5 + 17 * Math.pow(e, 0.7)) * (1 + 0.18 * noise(i * 0.05, side));
          const lip = Math.sin(i * 0.37 + side) * 0.6;
          const room = Math.max(4, ext - w);
          rows = [
            [w + 1.2, -3], [w, 0.4], [w - 0.4 + lip, top * 0.2], [w + 0.3 + lip * 0.5, top * 0.45], [w - 0.2, top * 0.7],
            [w + 0.8, top * 0.92], [w + Math.min(4, room * 0.2), top], [w + room * 0.55, top * (0.96 + 0.06 * noise(i * 0.11, 3))],
            [w + room * 0.85, top * 0.55], [w + room, -4],
          ];
        } else {
          const room = Math.max(3, ext - w);
          rows = [[w, -2.5], [w, 1.15], [w + 0.6, 1.15], [w + room, 1.15], [w + room + 1.5, -2]];
        }
        R = rows.length;
        for (let j = 0; j < R; j++) {
          const [off, y] = rows[j];
          verts.push(p.x + r.x * off * side, y, p.z + r.z * off * side);
          let c;
          if (s.kind === KIND.gorge) {
            const top = rows[6][1];
            if (y < 1.0) c = wetRock;
            else if (j >= 6 && j <= 7) c = (i + j) % 3 ? moss : mossDark;
            else {
              const band = Math.floor(y * 0.55 + noise(i * 0.08, j) * 1.2 + 10) % sandstone.length;
              c = sandstone[band].clone().multiplyScalar(0.72 + 0.28 * (y / Math.max(1, top)));
            }
          } else c = j <= 1 ? quayDark : j === 2 ? quayStone : plaza;
          cols.push(c.r, c.g, c.b);
        }
        if (rowsN > 0) {
          const base = (rowsN - 1) * R;
          for (let j = 0; j < R - 1; j++) {
            const a = base + j, b = a + 1, c2 = a + R, d = c2 + 1;
            if (side > 0) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
          }
        }
        rowsN++;
        inner.push([p.x + r.x * w * side, p.z + r.z * w * side]);
        const ow = rows[rows.length - 2][0];
        outer.push([p.x + r.x * ow * side, p.z + r.z * ow * side]);
        if (s.kind === KIND.gorge) ledge.push([p.x + r.x * (w + 3) * side, p.z + r.z * (w + 3) * side]);
      }
      // End caps: close the bank ends so you can't see under them.
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setIndex(idx);
      bankGeos.push(g.toNonIndexed());
    }
  }

  // ---------- canal town: houses, bridges, string lights ----------

  const town = SECTIONS.find((s) => s.kind === KIND.town);
  const houseGeos = [], windowGeos = [];
  const pastel = [0xf7a8b8, 0xa8e6cf, 0xffd3a5, 0xfdf2a1, 0xa8d8f0, 0xd4b8f0, 0xf6c6a0, 0xffffff].map((h) => new THREE.Color(h));
  const roofCols = [0xc0563a, 0x9b3f2f, 0x5f7f9a, 0xd07040].map((h) => new THREE.Color(h));
  const winDark = new THREE.Color(0x2a3550);
  function colorGeo(g, c) {
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  }
  const bridges = [];
  function addHouse(k, side, w, depth, frontage, tall) {
    const p = pts[k], r = rights[k];
    const h = tall + Math.floor(rnd() * 3) * 3 + (rnd() < 0.2 ? 3 : 0);
    const cx = p.x + r.x * side * (w + depth / 2), cz = p.z + r.z * side * (w + depth / 2);
    const yaw = Math.atan2(r.x * side, r.z * side); // +Z of the box faces away from the canal
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, 1.15, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const body = colorGeo(new THREE.BoxGeometry(frontage, h, depth).translate(0, h / 2, 0), pastel[Math.floor(rnd() * pastel.length)]);
    houseGeos.push(body.applyMatrix4(m));
    const roofC = roofCols[Math.floor(rnd() * roofCols.length)];
    if (rnd() < 0.65) {
      // Gable roof along the frontage.
      const shape = new THREE.Shape();
      shape.moveTo(-depth / 2 - 0.3, 0); shape.lineTo(depth / 2 + 0.3, 0); shape.lineTo(0, 2.4); shape.closePath();
      const roof = new THREE.ExtrudeGeometry(shape, { depth: frontage + 0.4, bevelEnabled: false }).translate(0, h, -(frontage + 0.4) / 2).rotateY(Math.PI / 2);
      houseGeos.push(colorGeo(roof, roofC).applyMatrix4(m));
    } else {
      houseGeos.push(colorGeo(new THREE.BoxGeometry(frontage + 0.2, 0.5, depth + 0.2).translate(0, h + 0.25, 0), roofC.clone().multiplyScalar(0.8)).applyMatrix4(m));
    }
    // Windows on the canal side (-Z face after the yaw), some lit.
    const floors = Math.floor((h - 1) / 3);
    const cols = Math.max(1, Math.floor(frontage / 2.2));
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const x = -frontage / 2 + (c + 0.5) * (frontage / cols);
        const y = 1.6 + f * 3 + (f === 0 ? 0.2 : 0);
        const win = new THREE.PlaneGeometry(1.0, 1.4).rotateY(Math.PI).translate(x, y, -depth / 2 - 0.02);
        if (rnd() < 0.55) windowGeos.push(colorGeo(win, new THREE.Color().setHSL(0.09 + rnd() * 0.04, 1, 0.6 + rnd() * 0.15)).applyMatrix4(m));
        else houseGeos.push(colorGeo(win, winDark).applyMatrix4(m));
      }
    }
  }
  for (const side of [-1, 1]) {
    // Two rows: on the quay, and taller ones behind an alley.
    for (const row of [0, 1]) {
      let acc = 0, nextW = 6;
      for (let i = town.i0 + 10; i <= town.i1 - 10; i++) {
        acc += step;
        if (acc < nextW) continue;
        const k = wrap(i);
        const depth = 6 + rnd() * 3;
        const w = half[k] + 1.6 + row * 13;
        if (extents[side][k] < w + depth + 0.5 || Math.abs(curv[k]) > (row ? 0.02 : 0.035)) { acc = nextW - 1; continue; }
        const frontage = nextW - 0.3;
        acc = 0; nextW = 5 + rnd() * 3;
        addHouse(wrap(i - Math.round(frontage / 2 / step)), side, w, depth, frontage, row ? 9 : 6);
      }
    }
  }
  // Bridges across the town canals.
  const bridgeGeos = [];
  const stone = new THREE.Color(0xf2ead8), stoneDark = new THREE.Color(0xb8a888);
  for (const f of [0.22, 0.55, 0.86]) {
    const k = wrap(Math.round(town.i0 + (town.i1 - town.i0) * f));
    const p = pts[k], t = tans[k];
    const span = half[k] * 2 + 3;
    const yaw = Math.atan2(t.x, t.z);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    // Deck with an arched underside (built across local X), railings.
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2 - 2, 1.15); shape.lineTo(-span / 2, 3.0);
    for (let a = 0; a <= 16; a++) { const x = -span / 2 + (a / 16) * span; shape.lineTo(x, 3.0 + Math.sin((a / 16) * Math.PI) * 1.4); }
    shape.lineTo(span / 2 + 2, 1.15); shape.lineTo(span / 2 + 2, 5.2); shape.lineTo(-span / 2 - 2, 5.2); shape.closePath();
    const deck = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: false }).translate(0, 0, -1.6);
    bridgeGeos.push(colorGeo(deck, stone).applyMatrix4(m));
    for (const zz of [-1.5, 1.5]) bridgeGeos.push(colorGeo(new THREE.BoxGeometry(span + 4, 0.9, 0.25).translate(0, 5.65, zz), stoneDark).applyMatrix4(m));
    bridges.push({ idx: k, pos: p.clone() });
  }

  // String lights: warm bulbs hanging across the canal.
  const bulbs = [];
  const wirePts = [];
  for (let i = town.i0 + 25; i < town.i1 - 15; i += 22) {
    const k = wrap(i);
    if (bridges.some((b) => cyc(b.idx, k) < 8)) continue;
    const p = pts[k], r = rights[k];
    const w = half[k] + 1.8, N = 11;
    let prev = null;
    for (let n = 0; n <= N; n++) {
      const f = n / N, lat = -w + f * 2 * w;
      const y = 6.4 - Math.sin(f * Math.PI) * 1.2;
      const v = new THREE.Vector3(p.x + r.x * lat, y, p.z + r.z * lat);
      if (n > 0 && n < N) bulbs.push([v.x, y - 0.12, v.z, n % 3]);
      if (prev) wirePts.push(prev, v);
      prev = v;
    }
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), Math.max(1, bulbs.length));
  {
    const bc = [new THREE.Color(1.0, 0.75, 0.35), new THREE.Color(1.0, 0.45, 0.6), new THREE.Color(0.55, 0.9, 1.0)];
    const mm = new THREE.Matrix4();
    bulbs.forEach(([x, y, z, c], i) => { bulbMesh.setMatrixAt(i, mm.makeTranslation(x, y, z)); bulbMesh.setColorAt(i, bc[c]); });
    bulbMesh.count = bulbs.length;
  }
  const wireGeo = new THREE.BufferGeometry().setFromPoints(wirePts);
  const wires = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x2a2228 }));

  // ---------- gorge: rock arch and waterfall ----------

  const gorge = SECTIONS.find((s) => s.kind === KIND.gorge);
  const wfIdx = wrap(Math.round(gorge.i0 + (gorge.i1 - gorge.i0) * 0.52));
  const archGeos = [];
  let waterfall;
  {
    const p = pts[wfIdx], t = tans[wfIdx];
    const span = half[wfIdx] * 2 + 10;
    const yaw = Math.atan2(t.x, t.z);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2, 4);
    for (let a = 0; a <= 20; a++) { const x = -span / 2 + (a / 20) * span; shape.lineTo(x, 8.5 + Math.sin((a / 20) * Math.PI) * 3.5 + Math.sin(a * 1.9) * 0.4); }
    shape.lineTo(span / 2, 4); shape.lineTo(span / 2 + 3, 22); shape.lineTo(-span / 2 - 3, 22); shape.closePath();
    const arch = new THREE.ExtrudeGeometry(shape, { depth: 7, bevelEnabled: false }).translate(0, 0, -3.5);
    const ap = arch.attributes.position, ac = new Float32Array(ap.count * 3);
    for (let i = 0; i < ap.count; i++) {
      const y = ap.getY(i);
      const c = y > 21 ? moss : sandstone[Math.floor(y * 0.55 + 10) % sandstone.length].clone().multiplyScalar(0.8);
      ac.set([c.r, c.g, c.b], i * 3);
    }
    arch.setAttribute('color', new THREE.BufferAttribute(ac, 3));
    arch.deleteAttribute('uv'); arch.deleteAttribute('normal');
    archGeos.push(arch.applyMatrix4(m));

    // The curtain: falls from the arch's front edge to the water.
    const wW = half[wfIdx] * 2 + 2, wH = 9.5;
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(wW, wH, 1, 1),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        uniforms: { time: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`
          uniform float time; varying vec2 vUv;
          float h(float x) { return fract(sin(x * 127.1) * 43758.5); }
          float n1(float x) { float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
          void main() {
            float x = vUv.x * 60.0;
            float col = n1(x) * 0.6 + n1(x * 2.7 + 3.0) * 0.4;
            float y = vUv.y * 3.0 + time * (2.2 + col * 1.2);
            float streak = n1(y * 4.0 + floor(x) * 7.0);
            float a = 0.35 + 0.45 * smoothstep(0.35, 0.9, streak * col + 0.25);
            a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
            float foam = smoothstep(0.25, 0.0, vUv.y);
            vec3 c = mix(vec3(0.72, 0.86, 0.92), vec3(1.0, 0.92, 0.86), foam + streak * 0.3);
            gl_FragColor = vec4(c, clamp(a + foam * 0.4, 0.0, 0.92));
          }`,
      }),
    );
    curtain.position.set(p.x - t.x * 3.6, wH / 2, p.z - t.z * 3.6);
    curtain.rotation.y = Math.atan2(-t.x, -t.z);
    scene.add(curtain);
    waterfall = { idx: wfIdx, pos: new THREE.Vector3(p.x - t.x * 3.6, 1, p.z - t.z * 3.6), mesh: curtain };
  }

  // ---------- lighthouse ----------

  const lighthouse = new THREE.Group();
  {
    const s = lighthouseRock;
    lighthouse.position.set(s.x, 6.5, s.z);
    const bands = [];
    for (let b = 0; b < 6; b++) {
      const g = new THREE.CylinderGeometry(1.7 - (b + 1) * 0.12, 1.7 - b * 0.12, 2.6, 16).translate(0, 1.3 + b * 2.6, 0);
      bands.push(colorGeo(g, new THREE.Color(b % 2 ? 0xd93b30 : 0xf4f0ea)));
    }
    bands.push(colorGeo(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 16).translate(0, 15.75, 0), new THREE.Color(0x2a2a30)));
    bands.push(colorGeo(new THREE.ConeGeometry(1.1, 1.4, 16).translate(0, 18.6, 0), new THREE.Color(0xd93b30)));
    lighthouse.add(new THREE.Mesh(mergeGeometries(bands), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 12).translate(0, 17, 0), new THREE.MeshBasicMaterial({ color: 0xfff0b0, toneMapped: false }));
    lighthouse.add(lamp);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Group();
    beam.position.y = 17;
    for (const s2 of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 60, 16, 1, true).translate(0, -30, 0).rotateZ(s2 * Math.PI / 2), beamMat);
      beam.add(cone);
    }
    lighthouse.add(beam);
    lighthouse.userData.beam = beam;
    scene.add(lighthouse);
  }

  // ---------- arrow boards on the outside of tight walled corners ----------

  const boardTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = '#16121e'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#ffd23f';
    for (let k = 0; k < 3; k++) {
      const x = 40 + k * 70;
      g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 34, 48); g.lineTo(x, 82); g.lineTo(x - 16, 82); g.lineTo(x + 18, 48); g.lineTo(x - 16, 14); g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  const boardGeos = [];
  for (const s of SECTIONS) {
    let last = -99;
    for (let i = s.i0 + 20; i < s.i1 - 10; i++) {
      const k = wrap(i);
      if (Math.abs(curv[k]) < 1 / 32 || i - last < 14) continue;
      last = i;
      const out = curv[k] > 0 ? -1 : 1; // outside of the turn
      const p = pts[k], r = rights[k];
      const w = half[k] + 0.25;
      const g = new THREE.PlaneGeometry(3.2, 1.2);
      // Chevrons point in the turn direction: flip the uvs for left turns.
      if (curv[k] < 0) { const uv = g.attributes.uv; for (let j = 0; j < uv.count; j++) uv.setX(j, 1 - uv.getX(j)); }
      const yaw = Math.atan2(-r.x * out, -r.z * out); // face the channel
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p.x + r.x * w * out, 2.6, p.z + r.z * w * out),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
      boardGeos.push(g);
    }
  }

  // ---------- marker buoys along the open water ----------

  const buoyPos = [];
  {
    let acc = 0;
    for (let i = 0; i < SAMPLES; i++) {
      acc += step;
      if (acc < 34) continue;
      let near = false;
      for (let o = -MOUTH - 10; o <= MOUTH + 10; o += 5) if (walled[wrap(i + o)]) near = true;
      if (near) continue;
      acc = 0;
      for (const side of [-1, 1]) {
        const p = pts[i], r = rights[i];
        buoyPos.push([p.x + r.x * side * (half[i] + 1), p.z + r.z * side * (half[i] + 1), side]);
      }
    }
  }
  const buoyMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), buoyPos.length);
  buoyPos.forEach((b, i) => buoyMesh.setColorAt(i, new THREE.Color(b[2] < 0 ? 0xff5a3a : 0xffd23f)));
  buoyMesh.frustumCulled = false;

  // ---------- assemble static meshes ----------

  const vc = (extra = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...extra });
  const static_ = new THREE.Group();
  const nonIdx = (gs) => gs.map((g) => (g.index ? g.toNonIndexed() : g));
  static_.add(new THREE.Mesh(mergeGeometries(nonIdx(islandGeos)), vc()));
  static_.add(new THREE.Mesh(mergeGeometries(bankGeos), vc({ side: THREE.DoubleSide })));
  static_.add(new THREE.Mesh(mergeGeometries([...houseGeos, ...bridgeGeos, ...archGeos]), vc()));
  static_.add(new THREE.Mesh(mergeGeometries(windowGeos), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  static_.add(new THREE.Mesh(mergeGeometries(boardGeos), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false })));
  static_.add(new THREE.Mesh(mergeGeometries(nonIdx(palmTrunks)), new THREE.MeshLambertMaterial({ color: 0x7a5a3e, flatShading: true })));
  static_.add(new THREE.Mesh(mergeGeometries(nonIdx(palmLeaves)), new THREE.MeshLambertMaterial({ color: 0x3a8a34, flatShading: true, side: THREE.DoubleSide })));
  static_.add(bulbMesh, wires, buoyMesh);
  for (const m of static_.children) if (m.geometry && !m.geometry.attributes.normal && !m.isLineSegments) m.geometry.computeVertexNormals();
  scene.add(static_);

  // ---------- distance-to-land map ----------
  // R: distance to land (0..LMAX_D m). Stamped from island circles and
  // points along the bank edges.

  const LN = 1024, LMINX = -500, LMINZ = -420, LSIZE = 1000, LMAX_D = 40;
  const texel = LSIZE / LN;
  const dist = new Float32Array(LN * LN).fill(LMAX_D);
  const stamp = (cx, cz, rad, fn) => {
    const x0 = Math.max(0, Math.floor((cx - rad - LMINX) / texel)), x1 = Math.min(LN - 1, Math.ceil((cx + rad - LMINX) / texel));
    const y0 = Math.max(0, Math.floor((cz - rad - LMINZ) / texel)), y1 = Math.min(LN - 1, Math.ceil((cz + rad - LMINZ) / texel));
    for (let y = y0; y <= y1; y++) {
      const wz = LMINZ + (y + 0.5) * texel;
      for (let x = x0; x <= x1; x++) {
        const wx = LMINX + (x + 0.5) * texel;
        const d = fn(wx, wz);
        const i = y * LN + x;
        if (d < dist[i]) dist[i] = d;
      }
    }
  };
  for (const s of solids) {
    if (Math.abs(s.x) > 900 || Math.abs(s.z) > 900) continue;
    stamp(s.x, s.z, s.r * 1.3 + LMAX_D, (wx, wz) => Math.max(0, Math.hypot(wx - s.x, wz - s.z) - shoreR(s, Math.atan2(wz - s.z, wx - s.x))));
  }
  for (const line of landLines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1], [bx, bz] = line[i];
      const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez || 1;
      stamp((ax + bx) / 2, (az + bz) / 2, LMAX_D + Math.sqrt(ll) / 2, (wx, wz) => {
        const t = Math.max(0, Math.min(1, ((wx - ax) * ex + (wz - az) * ez) / ll));
        return Math.hypot(wx - ax - ex * t, wz - az - ez * t);
      });
    }
  }
  const landData = new Uint8Array(LN * LN * 4);
  for (let i = 0; i < LN * LN; i++) {
    const v = Math.round((dist[i] / LMAX_D) * 255);
    landData[i * 4] = v; landData[i * 4 + 1] = v; landData[i * 4 + 2] = v; landData[i * 4 + 3] = 255;
  }
  const landTexture = new THREE.DataTexture(landData, LN, LN, THREE.RGBAFormat);
  landTexture.magFilter = THREE.LinearFilter;
  landTexture.minFilter = THREE.LinearFilter;
  landTexture.needsUpdate = true;
  const landBounds = new THREE.Vector4(LMINX, LMINZ, LSIZE, LMAX_D);
  // CPU lookup (bilinear), metres to land.
  function landDist(x, z) {
    const fx = (x - LMINX) / texel - 0.5, fz = (z - LMINZ) / texel - 0.5;
    if (fx < 0 || fz < 0 || fx >= LN - 1 || fz >= LN - 1) return 999;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0;
    const i = z0 * LN + x0;
    const v = (landData[i * 4] * (1 - ax) + landData[(i + 1) * 4] * ax) * (1 - az) + (landData[(i + LN) * 4] * (1 - ax) + landData[(i + LN + 1) * 4] * ax) * az;
    return (v / 255) * LMAX_D;
  }

  // ---------- gates (glowing arches) ----------

  const gates = [];
  const GATE_COUNT = 18;
  const archMat = new THREE.MeshLambertMaterial({ color: 0xf4f0f8 });
  const glowIdle = new THREE.MeshBasicMaterial({ color: 0x6a3a7a, toneMapped: false });
  const glowNext = new THREE.MeshBasicMaterial({ color: 0x7dffa0, toneMapped: false });
  const glowDone = new THREE.MeshBasicMaterial({ color: 0xffc83a, toneMapped: false });
  for (let g = 0; g < GATE_COUNT; g++) {
    let u = g / GATE_COUNT;
    let k = Math.round(u * SAMPLES) % SAMPLES;
    // Keep gates off bridges, the waterfall arch and section mouths.
    for (let tries = 0; tries < 60; tries++) {
      const bad = bridges.some((b) => cyc(b.idx, k) < 12) || cyc(wfIdx, k) < 15 ||
        SECTIONS.some((s) => cyc(s.i0, k) < MOUTH + 4 || cyc(s.i1, k) < MOUTH + 4);
      if (!bad) break;
      k = wrap(k + 3);
    }
    if (g === 0) k = 0;
    u = k / SAMPLES;
    const p = pts[k], t = tans[k], r = rights[k];
    const hw = half[k] + (walled[k] ? 0.2 : -0.5);
    const grp = new THREE.Group();
    grp.position.copy(p);
    grp.rotation.y = Math.atan2(-t.x, -t.z);
    const height = walled[k] ? 6.5 : 7.5;
    const tube = 0.32;
    const pathPts = [];
    for (let a = 0; a <= 28; a++) { const th = (a / 28) * Math.PI; pathPts.push(new THREE.Vector3(Math.cos(th) * hw, Math.sin(th) * height, 0)); }
    const path = new THREE.CatmullRomCurve3(pathPts);
    // Arch and its two floats in one mesh; the glowing strip in another.
    const parts = [new THREE.TubeGeometry(path, 40, tube, 8, false)];
    for (const s of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.75, 0.9, 1.2, 12).translate(s * hw, 0, 0));
    const body = new THREE.Mesh(mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; })), archMat);
    const glow = new THREE.Mesh(new THREE.TubeGeometry(path, 40, tube * 0.55, 6, false), glowIdle);
    glow.position.z = tube * 0.75; // on the side facing the riders
    grp.add(body, glow);
    scene.add(grp);
    gates.push({ u, idx: k, pos: p, tan: t, right: r, half: hw, group: grp, glow, flash: 0 });
  }
  gates.setNext = (i) => gates.forEach((g, j) => { g.glow.material = j === i ? glowNext : g.flash > 0 ? glowDone : glowIdle; });

  // ---------- cash rings (boost) ----------

  const RING_SPOTS = [ // [control point (fractional), lateral]
    [2.4, -4], [5.6, 5], [9.3, 5], [11.5, -3], [16.0, 0], [18.5, 2], [21.6, -6], [22.6, 6], [23.6, -5],
    [27.4, 0], [30.4, 0], [33.0, -4],
  ];
  const ringGeo = new THREE.TorusGeometry(1.6, 0.16, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf40, toneMapped: false });
  const haloTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,220,120,0)'); gr.addColorStop(0.55, 'rgba(255,210,90,0.55)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#ffe08a'; g.font = '900 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 64, 68);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const rings = [];
  for (const [cp, lat] of RING_SPOTS) {
    const a = Math.floor(cp), f = cp - a;
    let i0 = cpIdx[a % CONTROL.length], i1 = cpIdx[(a + 1) % CONTROL.length];
    if (i1 < i0) i1 += SAMPLES;
    const k = wrap(Math.round(i0 + (i1 - i0) * f));
    const p = pts[k], t = tans[k], r = rights[k];
    const l = Math.max(-half[k] + 2.5, Math.min(half[k] - 2.5, lat));
    const grp = new THREE.Group();
    grp.position.set(p.x + r.x * l, 0, p.z + r.z * l);
    grp.rotation.y = Math.atan2(-t.x, -t.z);
    grp.add(new THREE.Mesh(ringGeo, ringMat));
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), haloMat);
    grp.add(halo);
    scene.add(grp);
    rings.push({ idx: k, group: grp, x: grp.position.x, z: grp.position.z, tx: t.x, tz: t.z, cool: 0 });
  }

  // ---------- trampolines ----------

  const RAMP_CPS = [1.4, 6.3, 23.4, 33.6];
  const ramps = [];
  const RAMP_LEN = 7, RAMP_W = 5, RAMP_LIP = 1.7;
  {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.4); shape.lineTo(RAMP_LEN, -0.4); shape.lineTo(RAMP_LEN, RAMP_LIP); shape.lineTo(0, 0.05); shape.closePath();
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: RAMP_W, bevelEnabled: false });
    wedge.translate(0, 0, -RAMP_W / 2);
    wedge.rotateY(Math.PI / 2);
    const p = wedge.attributes.position;
    const cols = [];
    for (let i = 0; i < p.count; i++) {
      const stripe = Math.floor((-p.getZ(i) / RAMP_LEN) * 6 + 0.001) % 2 === 0;
      const top = p.getY(i) > -0.3;
      const c = new THREE.Color(top ? (stripe ? 0xff7a2f : 0xfff4e6) : 0x2a3340);
      cols.push(c.r, c.g, c.b);
    }
    wedge.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    wedge.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const cp of RAMP_CPS) {
      const a = Math.floor(cp), f = cp - a;
      let i0 = cpIdx[a % CONTROL.length], i1 = cpIdx[(a + 1) % CONTROL.length];
      if (i1 < i0) i1 += SAMPLES;
      const k = wrap(Math.round(i0 + (i1 - i0) * f));
      const c = pts[k], t = tans[k];
      const mesh = new THREE.Mesh(wedge, mat);
      const yaw = Math.atan2(-t.x, -t.z);
      mesh.rotation.y = yaw;
      scene.add(mesh);
      const start = c.clone().addScaledVector(t, -RAMP_LEN / 2);
      mesh.position.copy(start);
      ramps.push({ u: k / SAMPLES, idx: k, start, t: t.clone(), r: new THREE.Vector3(-t.z, 0, t.x), mesh, base: 0, yaw });
    }
  }
  function rampHeight(x, z) {
    for (const r of ramps) {
      const dx = x - r.start.x, dz = z - r.start.z;
      const a = dx * r.t.x + dz * r.t.z;
      if (a < 0 || a > RAMP_LEN) continue;
      const b = dx * r.r.x + dz * r.r.z;
      if (Math.abs(b) > RAMP_W / 2) continue;
      return r.base + 0.05 + (a / RAMP_LEN) * (RAMP_LIP - 0.05);
    }
    return -Infinity;
  }

  // ---------- collisions ----------

  // Push a craft out of island shores. Returns the impact speed, or 0.
  function collide(c) {
    let hit = 0;
    for (const s of solids) {
      const dx = c.x - s.x, dz = c.z - s.z;
      const dd = Math.hypot(dx, dz);
      if (dd > s.r * 1.4 + 3) continue;
      const lim = shoreR(s, Math.atan2(dz, dx)) + 1.6;
      if (dd < lim && dd > 0.001) {
        const nx = dx / dd, nz = dz / dd;
        c.x = s.x + nx * lim; c.z = s.z + nz * lim;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) { c.vx -= vn * nx * 1.3; c.vz -= vn * nz * 1.3; hit = Math.max(hit, -vn); c.vx *= 0.85; c.vz *= 0.85; }
      }
    }
    return hit;
  }

  // Keep a craft between the walls. It slides along a wall: the speed into
  // the wall is removed (with a small bounce) and a little speed is lost.
  // Returns { hit: speed into the wall, scrape: 0..1, side }.
  const wallResult = { hit: 0, scrape: 0, side: 0 };
  function wallClamp(c, idx, dt) {
    wallResult.hit = 0; wallResult.scrape = 0; wallResult.side = 0;
    if (!walled[idx]) return wallResult;
    const p = pts[idx], r = rights[idx];
    const lat = (c.x - p.x) * r.x + (c.z - p.z) * r.z;
    const lim = half[idx] - 0.9;
    if (Math.abs(lat) <= lim) return wallResult;
    const s = Math.sign(lat), over = Math.abs(lat) - lim;
    // Far outside (entered at a mouth from off the line): ease back in.
    const push = over > 3 ? Math.min(over, 14 * dt) : over;
    c.x -= r.x * s * push; c.z -= r.z * s * push;
    const vn = (c.vx * r.x + c.vz * r.z) * s;
    if (vn > 0) {
      c.vx -= r.x * s * vn * 1.25; c.vz -= r.z * s * vn * 1.25;
      const keep = 1 - Math.min(0.25, vn * 0.025);
      c.vx *= keep; c.vz *= keep;
    }
    // Scraping drag while touching.
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.1) { const k = 1 - Math.min(0.5, dt * 0.6); c.vx *= k; c.vz *= k; }
    wallResult.hit = Math.max(0, vn); wallResult.scrape = Math.min(1, sp / 15); wallResult.side = s;
    // Turn the nose away from the wall a little.
    c.yawRate += s * 0.6 * Math.min(1, vn / 4);
    return wallResult;
  }

  // How enclosed the water is at a sample (0 open .. 1 deep gorge), for reverb and echo.
  function enclosure(idx) {
    let e = walled[idx] ? (kind[idx] === KIND.gorge ? 0.6 + 0.4 * wallF[idx] : 0.55) : 0;
    for (const b of bridges) { const d = cyc(b.idx, idx) * step; if (d < 6) e = Math.max(e, 1); }
    if (cyc(wfIdx, idx) * step < 6) e = 1;
    return e;
  }

  function update(t) {
    waterfall.mesh.material.uniforms.time.value = t;
    lighthouse.userData.beam.rotation.y = t * 0.9;
  }

  const sectionU = SECTIONS.map((s) => ({ kind: s.kind, u0: s.i0 / SAMPLES, u1: s.i1 / SAMPLES }));
  const dolphinWindows = [[uOf(1), uOf(5)], [uOf(21), uOf(24)]];
  const inWalled = (u) => walled[wrap(Math.floor((((u % 1) + 1) % 1) * SAMPLES))] === 1;

  return {
    curve, length, SAMPLES, pts, tans, rights, half, kind, walled, curv, at, nearest, inWalled, sectionU, dolphinWindows,
    gates, ramps, rings, rampHeight, collide, wallClamp, enclosure, landTexture, landBounds, landDist, solids,
    waterfall, lighthouse, bridges, buoyPos, buoyMesh, update, uOf,
  };
}
