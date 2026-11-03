// The course: a ~1.8 km loop through an archipelago. A long canal cuts
// through a cliff island, an S-section weaves between rocks, trampolines
// sit on the straights, and buoy gates mark the line. Also bakes a
// distance-to-land map that the ocean uses for shore foam and shallows.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

const CONTROL = [
  [0, 165], [110, 158], [200, 112], [252, 30], [292, -60], [300, -150], [262, -228], [180, -262],
  [95, -238], [40, -185], [-25, -215], [-95, -248], [-170, -210], [-215, -120], [-196, -30],
  [-228, 55], [-190, 140], [-100, 178],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export const GATE_HALF = 9;
export const CANAL = { u0: 0.215, u1: 0.375, half: 15 }; // track fraction where the canal runs
const RAMP_US = [0.06, 0.56, 0.86];

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function buildCourse(scene) {
  const curve = new THREE.CatmullRomCurve3(CONTROL, true, 'centripetal');
  const length = curve.getLength();
  const SAMPLES = 1600;
  const pts = [], tans = [], rights = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    pts.push(p); tans.push(t); rights.push(new THREE.Vector3(-t.z, 0, t.x));
  }
  const at = (u) => {
    const f = (((u % 1) + 1) % 1) * SAMPLES;
    const i = Math.floor(f) % SAMPLES, j = (i + 1) % SAMPLES, k = f - Math.floor(f);
    return {
      p: pts[i].clone().lerp(pts[j], k),
      t: tans[i].clone().lerp(tans[j], k).normalize(),
      r: rights[i].clone().lerp(rights[j], k).normalize(),
    };
  };
  const inCanal = (u) => { u = ((u % 1) + 1) % 1; return u > CANAL.u0 && u < CANAL.u1; };

  // Nearest sample, searched around a hint so it is cheap every frame.
  function nearest(x, z, hint = -1, window = 60) {
    let best = 0, bestD = Infinity;
    const from = hint < 0 ? 0 : hint - window, to = hint < 0 ? SAMPLES : hint + window;
    for (let o = from; o < to; o++) {
      const i = ((o % SAMPLES) + SAMPLES) % SAMPLES;
      const p = pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const lat = (x - pts[best].x) * rights[best].x + (z - pts[best].z) * rights[best].z;
    return { idx: best, u: best / SAMPLES, lat, dist: Math.sqrt(bestD) };
  }

  // ---------- land: islands, rocks, canal cliffs ----------

  const solids = []; // { x, z, r, wobble } circles for collision and the land map
  const shoreR = (s, th) => s.r * (1 + s.wobble * (0.6 * Math.sin(3 * th + s.ph) + 0.4 * Math.sin(7 * th + 2 * s.ph)));

  const sandMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const islandGeos = [];
  function addIsland(x, z, r, h, palms) {
    const s = { x, z, r, wobble: 0.1, ph: rnd() * 6 };
    // Keep islands clear of the racing line.
    for (let i = 0; i < SAMPLES; i += 4) {
      const d = Math.hypot(pts[i].x - x, pts[i].z - z);
      if (d < r * 1.25 + GATE_HALF + 12) return;
    }
    solids.push(s);
    const prof = [[0, h], [r * 0.15, h * 0.95], [r * 0.35, h * 0.78], [r * 0.55, h * 0.5], [r * 0.72, h * 0.25],
      [r * 0.86, h * 0.1], [r * 0.95, 1.6], [r, 0.4], [r * 1.08, -1.5], [r * 1.2, -6]].reverse()
      .map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(prof, 64);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0xe6c79a), wet = new THREE.Color(0xa88a62), green = new THREE.Color(0x3f7f3a),
      dark = new THREE.Color(0x2c5f34), rock = new THREE.Color(0x7a6a62);
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
    g.computeVertexNormals();
    islandGeos.push(g);
    for (let i = 0; i < palms; i++) {
      const th = (i / palms) * Math.PI * 2 + rnd() * 0.3;
      const rr = shoreR(s, th) * (0.8 - rnd() * 0.08);
      addPalm(x + Math.cos(th) * rr, z + Math.sin(th) * rr, 1.2, 0.8 + rnd() * 0.5, th);
    }
  }

  const palmTrunks = [], palmLeaves = [];
  const trunkBase = new THREE.CylinderGeometry(0.2, 0.34, 9, 6, 4).translate(0, 4.5, 0);
  {
    const p = trunkBase.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 9, 2) * 1.6);
    trunkBase.deleteAttribute('uv');
    trunkBase.computeVertexNormals();
  }
  const leafBase = new THREE.ConeGeometry(1.0, 4.4, 4, 1, true).translate(0, 2.2, 0).scale(1, 1, 0.25);
  leafBase.deleteAttribute('uv');
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

  // Islands placed around the course; any that would touch the line are skipped.
  addIsland(0, -20, 85, 42, 26);       // the big island in the middle
  addIsland(395, 95, 55, 26, 10);
  addIsland(-345, 10, 70, 34, 12);
  addIsland(80, 330, 42, 18, 8);
  addIsland(-120, -390, 50, 22, 9);
  addIsland(420, -300, 60, 30, 8);
  addIsland(-330, 280, 45, 20, 7);
  addIsland(190, -40, 30, 14, 6);
  addIsland(1100, -900, 160, 70, 0);   // far horizon
  addIsland(-1300, -600, 200, 90, 0);
  addIsland(-900, 1300, 170, 60, 0);
  addIsland(1400, 700, 220, 80, 0);

  // Canal: cliffs along both sides of the line, high in the middle and
  // sloping down at the ends.
  const cliffGeos = [];
  const cliffCol = [new THREE.Color(0x8a7466), new THREE.Color(0x6e5c55), new THREE.Color(0x9b8a6c)];
  for (const side of [-1, 1]) {
    const N = 90;
    const verts = [], cols = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = CANAL.u0 - 0.012 + (CANAL.u1 - CANAL.u0 + 0.024) * (i / N);
      const { p, r } = at(u);
      const e = Math.sin(Math.PI * i / N);
      const top = 4 + 22 * Math.pow(e, 0.6) + 4 * Math.sin(i * 1.7) * e;
      const inner = CANAL.half + 1.5 + Math.sin(i * 2.3) * 1.0;
      const rows = [
        [inner + 1.2, -3], [inner, 0.6], [inner - 0.6 + Math.sin(i * 3.1) * 0.8, top * 0.45], [inner + 1.2, top * 0.85],
        [inner + 6, top], [inner + 22, top * 0.9], [inner + 40, top * 0.5], [inner + 52, -4],
      ];
      for (let j = 0; j < rows.length; j++) {
        const [off, y] = rows[j];
        verts.push(p.x + r.x * off * side, y, p.z + r.z * off * side);
        const c = y > top * 0.8 && j > 3 ? new THREE.Color(0x4f7f3c) : cliffCol[(i + j) % 3];
        cols.push(c.r, c.g, c.b);
      }
      if (i < N) {
        const R = rows.length;
        for (let j = 0; j < R - 1; j++) {
          const a = i * R + j, b = a + 1, c2 = a + R, d = c2 + 1;
          if (side > 0) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
        }
      }
      if (i % 3 === 0) {
        // Collision and land map: circles along the cliff face.
        solids.push({ x: p.x + r.x * (inner + 6) * side, z: p.z + r.z * (inner + 6) * side, r: 6, wobble: 0, ph: 0, cliff: true });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    cliffGeos.push(g);
  }

  // Rocks in the S-section and scattered along the outside of turns.
  const rockGeos = [];
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  function addRock(x, z, r, h) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const c = new THREE.Color(), cols = [];
    for (let i = 0; i < p.count; i++) {
      const n = 0.75 + 0.5 * Math.abs(Math.sin(p.getX(i) * 5.1 + p.getZ(i) * 3.7 + x));
      p.setXYZ(i, p.getX(i) * r * n, Math.max(-0.4, p.getY(i)) * h * n, p.getZ(i) * r * n);
      c.setHex(0x7d6e66).multiplyScalar(0.8 + 0.4 * Math.abs(Math.sin(i * 1.3)));
      cols.push(c.r, c.g, c.b);
    }
    g.translate(x, 0, z);
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    rockGeos.push(g);
    solids.push({ x, z, r: r * 0.9, wobble: 0, ph: 0 });
  }
  for (const [u, side, off, r, h] of [
    [0.47, 1, 17, 5, 6], [0.5, -1, 16, 6, 8], [0.53, 1, 18, 5, 5], [0.565, -1, 19, 4, 4], [0.6, 1, 16, 6, 7],
    [0.63, -1, 18, 5, 5], [0.17, 1, 24, 7, 6], [0.1, -1, 26, 5, 4], [0.72, -1, 24, 6, 7], [0.78, 1, 25, 5, 5],
    [0.93, -1, 25, 6, 6], [0.44, 0, 0, 0, 0],
  ]) {
    if (!r) continue;
    const { p, r: rt } = at(u);
    addRock(p.x + rt.x * off * side, p.z + rt.z * off * side, r, h);
  }

  const static_ = new THREE.Group();
  static_.add(new THREE.Mesh(mergeGeometries(islandGeos), sandMat));
  static_.add(new THREE.Mesh(mergeGeometries(cliffGeos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })));
  static_.add(new THREE.Mesh(mergeGeometries(rockGeos), rockMat));
  static_.add(new THREE.Mesh(mergeGeometries(palmTrunks), new THREE.MeshLambertMaterial({ color: 0x7a5a3e, flatShading: true })));
  static_.add(new THREE.Mesh(mergeGeometries(palmLeaves), new THREE.MeshLambertMaterial({ color: 0x356f2f, flatShading: true, side: THREE.DoubleSide })));
  scene.add(static_);

  // ---------- distance-to-land map ----------

  const LN = 512, LMIN = -700, LSIZE = 1400, LMAX_D = 40;
  const landData = new Uint8Array(LN * LN * 4);
  const near = solids.filter((s) => Math.abs(s.x) < 800 && Math.abs(s.z) < 800);
  for (let y = 0; y < LN; y++) {
    for (let x = 0; x < LN; x++) {
      const wx = LMIN + ((x + 0.5) / LN) * LSIZE, wz = LMIN + ((y + 0.5) / LN) * LSIZE;
      let dmin = LMAX_D;
      for (const s of near) {
        const dx = wx - s.x, dz = wz - s.z;
        const dd = Math.sqrt(dx * dx + dz * dz);
        if (dd - s.r * 1.3 > dmin) continue;
        const d = dd - shoreR(s, Math.atan2(dz, dx));
        if (d < dmin) dmin = d;
      }
      const v = Math.round((Math.max(0, dmin) / LMAX_D) * 255);
      const i = (y * LN + x) * 4;
      landData[i] = v; landData[i + 1] = v; landData[i + 2] = v; landData[i + 3] = 255;
    }
  }
  const landTexture = new THREE.DataTexture(landData, LN, LN, THREE.RGBAFormat);
  landTexture.magFilter = THREE.LinearFilter;
  landTexture.minFilter = THREE.LinearFilter;
  landTexture.needsUpdate = true;
  const landBounds = new THREE.Vector4(LMIN, LMIN, LSIZE, LMAX_D);

  // ---------- gates ----------

  const GATES = 16;
  const gates = [];
  const buoyGeo = new THREE.SphereGeometry(0.75, 16, 10);
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6).translate(0, 1.6, 0);
  const lampGeo = new THREE.SphereGeometry(0.3, 12, 8).translate(0, 2.95, 0);
  const red = new THREE.MeshLambertMaterial({ color: 0xe5492f });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c45a });
  const white = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const lampIdle = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const lampNext = new THREE.MeshBasicMaterial({ color: 0x9cffb0 });
  for (let g = 0; g < GATES; g++) {
    const u = g / GATES;
    const { p, t, r } = at(u);
    const half = inCanal(u) ? CANAL.half - 3 : GATE_HALF;
    const gate = { u, pos: p, tan: t, right: r, half, buoys: [], lamps: [] };
    for (const side of [-1, 1]) {
      const b = new THREE.Group();
      b.position.copy(p).addScaledVector(r, side * half);
      b.add(new THREE.Mesh(buoyGeo, side < 0 ? red : yellow));
      b.add(new THREE.Mesh(poleGeo, white));
      const lamp = new THREE.Mesh(lampGeo, lampIdle);
      b.add(lamp);
      scene.add(b);
      gate.buoys.push(b);
      gate.lamps.push(lamp);
    }
    gates.push(gate);
  }
  gates.setNext = (i) => gates.forEach((g, j) => g.lamps.forEach((l) => (l.material = j === i ? lampNext : lampIdle)));

  // ---------- trampolines ----------

  const ramps = [];
  const RAMP_LEN = 7, RAMP_W = 5, RAMP_LIP = 1.7;
  {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.4); shape.lineTo(RAMP_LEN, -0.4); shape.lineTo(RAMP_LEN, RAMP_LIP); shape.lineTo(0, 0.05); shape.closePath();
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: RAMP_W, bevelEnabled: false });
    wedge.translate(0, 0, -RAMP_W / 2);
    // x along the ramp; rotate so the ramp runs along -Z (forward).
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
    for (const u of RAMP_US) {
      const { p: c, t } = at(u);
      const mesh = new THREE.Mesh(wedge, mat);
      const yaw = Math.atan2(-t.x, -t.z);
      mesh.rotation.y = yaw;
      scene.add(mesh);
      // Start edge (low end) of the ramp, so it runs from start to start + t * len.
      const start = c.clone().addScaledVector(t, -RAMP_LEN / 2);
      mesh.position.copy(start);
      ramps.push({ u, start, t: t.clone(), r: new THREE.Vector3(-t.z, 0, t.x), mesh, base: 0, yaw });
    }
  }
  // Ramp surface height at (x, z), or -Infinity off the ramps.
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

  // Push a craft out of land. Returns the impact speed, or 0.
  function collide(c, hintIdx) {
    let hit = 0;
    for (const s of solids) {
      const dx = c.x - s.x, dz = c.z - s.z;
      const dd = Math.hypot(dx, dz);
      if (dd > s.r * 1.4 + 3) continue;
      const lim = (s.cliff ? s.r : shoreR(s, Math.atan2(dz, dx))) + 1.6;
      if (dd < lim && dd > 0.001) {
        const nx = dx / dd, nz = dz / dd;
        c.x = s.x + nx * lim; c.z = s.z + nz * lim;
        const vn = c.vx * nx + c.vz * nz;
        if (vn < 0) { c.vx -= vn * nx * 1.4; c.vz -= vn * nz * 1.4; hit = Math.max(hit, -vn); c.vx *= 0.8; c.vz *= 0.8; }
      }
    }
    return hit;
  }

  return { curve, length, SAMPLES, pts, tans, rights, at, nearest, inCanal, gates, ramps, rampHeight, collide, landTexture, landBounds, solids };
}
