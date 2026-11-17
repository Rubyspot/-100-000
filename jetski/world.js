// The world: a 1.9 km loop around a turquoise lagoon.
//   1. Start under the arch in the lagoon, first ramp, a long left-hand bend
//      around a tall rock.
//   2. East canal: fast S-bends between limestone walls, under a rock arch.
//   3. North side: open water, a slalom between rock stacks, second ramp.
//   4. West canal: narrower, with quicker turns, a second arch, and a ramp
//      that throws you out of the rocks back into the lagoon for the finish.
// The centreline has a half-width per sample. Canal walls, islands and rock
// stacks are generated here, then drawn into a height grid, from which come:
// a distance-to-land field (collisions, shore foam, calmer water in canals),
// the water depth (turquoise shallows, deep blue outside the lagoon), sun
// shadows and sky cover for the water, and sun and sky light baked into
// every rock vertex.
import * as THREE from 'three';
import { SKY_SAMPLE_GLSL, SUN_DIR } from './sky.js';

// ---------- deterministic noise ----------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function h3(ix, iy, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(h3(ix, iy, iz), h3(ix + 1, iy, iz), u), lerp(h3(ix, iy + 1, iz), h3(ix + 1, iy + 1, iz), u), v);
  const b = lerp(lerp(h3(ix, iy, iz + 1), h3(ix + 1, iy, iz + 1), u), lerp(h3(ix, iy + 1, iz + 1), h3(ix + 1, iy + 1, iz + 1), u), v);
  return lerp(a, b, w);
}
const noise2 = (x, y) => noise3(x, y, 7.31);
function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; x = x * 2.03 + 11.7; y = y * 2.03 + 5.3; z = z * 2.03 + 3.1; a *= 0.5; }
  return s / n;
}
const fbm2 = (x, y, oct = 3) => fbm3(x, y, 3.7, oct);
let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- the course ----------

// x, z of the centreline control points (x east, z south).
const CONTROL = [
  [-140, 210], [-60, 214], [30, 208],                                            // 0-2 start straight
  [118, 214], [196, 204], [262, 176], [284, 122], [262, 76],                     // 3-7 the long bend
  [234, 40], [216, -6], [242, -56], [214, -106], [240, -156], [218, -200],       // 8-13 east canal
  [160, -238], [90, -226], [20, -252], [-50, -230], [-120, -250],                // 14-18 slalom
  [-190, -236], [-238, -190], [-244, -130],                                      // 19-21 north-west sweep
  [-228, -88], [-243, -46], [-219, -4], [-242, 38], [-219, 80], [-240, 122], [-218, 162], // 22-28 west canal
  [-188, 196],                                                                   // 29 back into the lagoon
];
const CANALS = [
  { a: 8, b: 13, half: 7.6, name: 'east' },
  { a: 22, b: 28, half: 6.8, name: 'west' },
];
export const OPEN_HALF = 13;
const SAMPLES = 2400;
const MOUTH = 44;        // samples over which a canal narrows to its width
const RAMP_CPS = [1.45, 4.55, 16.55, 28.62];
const GATE_CPS = [0, 4.0, 8.25, 10.5, 13.3, 16.0, 19.5, 22.2, 25.5, 28.3];
const ARCH_CPS = [11.5, 27.45];
export const RAMP_LEN = 8, RAMP_W = 6.4, RAMP_LIP = 1.9;

// Colours of the Crispy J look.
export const PINK = 0xff4fa3, YELLOW = 0xffd23f, CREAM = 0xfff6e0;

// ---------- mesh builder ----------
// position + colour + kind (0 rock, 1 plain, 2 leaves, 3 sand). Normals come
// from screen-space derivatives in the shader, so every facet is flat.

class Builder {
  constructor() { this.pos = []; this.col = []; this.kind = []; this.idx = []; this.nrm = []; }
  get count() { return this.pos.length / 3; }
  vert(x, y, z, c, kind, nx = 0, ny = 1, nz = 0) {
    const n = this.pos.length / 3;
    this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.kind.push(kind); this.nrm.push(nx, ny, nz);
    return n;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // Grid of rows x cols vertices starting at `base`; rows go up/outward and
  // columns go to the viewer's left when seen from outside.
  grid(base, rows, cols, wrapCols = false) {
    const n = wrapCols ? cols : cols - 1;
    for (let c = 0; c < n; c++) {
      const c1 = (c + 1) % cols;
      for (let j = 0; j < rows - 1; j++) {
        const a = base + c * rows + j, b = a + 1, c2 = base + c1 * rows + j, d = c2 + 1;
        this.idx.push(a, b, c2, b, d, c2);
      }
    }
  }
  // A three.js primitive, transformed and painted.
  add(geo, matrix, color, kind = 1, paint = null) {
    const g = geo.index ? geo : geo.clone();
    const p = g.attributes.position, base = this.count;
    const v = new THREE.Vector3(), c = new THREE.Color(), o = new THREE.Vector3(), nn = new THREE.Vector3(0, 1, 0);
    if (matrix) o.setFromMatrixPosition(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      c.copy(color);
      if (paint) paint(v, c, i);
      if (matrix) v.applyMatrix4(matrix);
      // Leaves are shaded as if round: the normal points out from the middle.
      if (kind === 2) nn.copy(v).sub(o).normalize();
      this.vert(v.x, v.y, v.z, c, kind, nn.x, nn.y, nn.z);
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]); }
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    const n = this.count, bake = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { bake[i * 3] = 1; bake[i * 3 + 1] = 1; bake[i * 3 + 2] = this.kind[i]; }
    g.setAttribute('bake', new THREE.BufferAttribute(bake, 3));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}
const M4 = (x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
const C = (hex) => new THREE.Color(hex);

// Tileable noise for the rock shader: R soft blotches, G mid detail,
// B streaks that run along v, A fine grain.
function makeNoiseTexture() {
  const N = 128;
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const sets = [
    Array.from({ length: 14 }, () => ({ kx: Math.round((r() - 0.5) * 8) || 1, ky: Math.round((r() - 0.5) * 8) || 1, ph: r() * 6.283 })),
    Array.from({ length: 22 }, () => ({ kx: Math.round((r() - 0.5) * 26) || 3, ky: Math.round((r() - 0.5) * 26) || 2, ph: r() * 6.283 })),
    Array.from({ length: 18 }, () => ({ kx: Math.round(4 + r() * 26) * (r() < 0.5 ? -1 : 1), ky: Math.round((r() - 0.5) * 4), ph: r() * 6.283 })),
    Array.from({ length: 22 }, () => ({ kx: Math.round((r() - 0.5) * 60) || 9, ky: Math.round((r() - 0.5) * 60) || 7, ph: r() * 6.283 })),
  ];
  const data = new Uint8Array(N * N * 4);
  const tmp = new Float32Array(N * N);
  sets.forEach((waves, ch) => {
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x / N) * 6.2831853, v = (y / N) * 6.2831853;
      let f = 0;
      for (const w of waves) f += Math.cos(w.kx * u + w.ky * v + w.ph) / Math.sqrt(Math.abs(w.kx) + Math.abs(w.ky) + 1);
      tmp[y * N + x] = f; if (f < min) min = f; if (f > max) max = f;
    }
    for (let i = 0; i < N * N; i++) data[i * 4 + ch] = Math.round(((tmp[i] - min) / (max - min)) * 255);
  });
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

// Rock, sand, leaves and props, lit by the sun and sky with baked shadows.
function makeTerrainMaterial(sky, noiseMap) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sky.uniforms, noiseMap: { value: noiseMap }, camPos: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute vec3 bake;
      varying vec3 vWorld; varying vec3 vColor; varying vec3 vBake; varying vec3 vRound;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vColor = color; vBake = bake; vRound = normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
      uniform sampler2D noiseMap; uniform vec3 camPos;
      uniform vec3 sunLight; uniform vec3 skyLight; uniform vec3 bounceLight;
      varying vec3 vWorld; varying vec3 vColor; varying vec3 vBake; varying vec3 vRound;
      void main() {
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float kind = vBake.z;
        float isRock = 1.0 - step(0.5, kind);
        float isLeaf = step(1.5, kind) * (1.0 - step(2.5, kind));
        float isSand = step(2.5, kind);
        vec3 w = abs(N); w /= (w.x + w.y + w.z);
        vec4 n = texture2D(noiseMap, vWorld.zy * 0.11) * w.x + texture2D(noiseMap, vWorld.xz * 0.11) * w.y + texture2D(noiseMap, vWorld.xy * 0.11) * w.z;
        vec4 big = texture2D(noiseMap, vWorld.xz * 0.013 + vWorld.y * 0.017);
        // Rough rock: the noise leans the facets this way and that.
        N = normalize(N + (vec3(n.r, n.g, n.a) - 0.5) * 0.7 * isRock + (vec3(big.g, 0.5, big.b) - 0.5) * 0.5 * isRock);

        // Limestone: warm and cool patches, thin strata, dark rain streaks on
        // the steep faces, plants on every ledge, and a wet band with a pale
        // tide line at the water.
        vec3 rock = vColor * mix(vec3(0.88, 0.90, 0.94), vec3(1.12, 1.03, 0.90), big.r);
        rock *= 0.95 + 0.06 * sin(vWorld.y * 1.7 + n.g * 4.0 + big.g * 7.0);
        rock *= 0.84 + 0.30 * n.a;
        float steep = 1.0 - smoothstep(0.35, 0.8, N.y);
        float streak = texture2D(noiseMap, vec2(dot(vWorld.xz, vec2(0.7, 0.71)) * 0.075, vWorld.y * 0.011)).b;
        rock *= mix(1.0, 0.68 + 0.36 * streak, steep * (0.35 + 0.65 * big.g));
        // Rusty stains here and there.
        rock = mix(rock, rock * vec3(1.10, 0.90, 0.70), smoothstep(0.62, 0.9, big.b) * 0.5);
        float veg = smoothstep(0.45, 0.75, N.y + (n.r - 0.5) * 0.6) * smoothstep(2.4, 5.0, vWorld.y);
        veg = max(veg, smoothstep(0.55, 0.8, big.r * 0.6 + n.r * 0.7) * smoothstep(5.0, 10.0, vWorld.y) * 0.5 * (1.0 - steep * 0.5));
        rock = mix(rock, vec3(0.085, 0.19, 0.05) * (0.6 + 0.8 * n.g), veg);
        float wet = 1.0 - smoothstep(0.2, 1.0, vWorld.y + (n.a - 0.5) * 0.5);
        rock = mix(rock, rock * vec3(0.36, 0.37, 0.36), wet);
        float tide = exp(-pow((vWorld.y - 1.15 - (n.r - 0.5) * 0.4) / 0.2, 2.0));
        rock = mix(rock, vec3(0.80, 0.77, 0.66), tide * 0.35 * steep);

        vec3 sand = vColor * (0.9 + 0.2 * n.a) * (0.96 + 0.08 * sin(vWorld.x * 2.1 + n.r * 6.0));
        sand = mix(sand, sand * vec3(0.72, 0.70, 0.64), 1.0 - smoothstep(0.1, 0.5, vWorld.y + (n.g - 0.5) * 0.2));
        // Leaf clusters, looked up in the plane each facet lies closest to,
        // so the pattern never smears down a steep side.
        vec3 aN = abs(N);
        vec2 lp = aN.y > max(aN.x, aN.z) ? vWorld.xz : (aN.x > aN.z ? vWorld.zy : vWorld.xy);
        vec4 cl = texture2D(noiseMap, lp * 0.31 + 0.37);
        float clump = cl.g;
        vec3 leaf = vColor * mix(vec3(0.42, 0.55, 0.40), vec3(1.05, 1.12, 0.72), clump) * (0.55 + 0.8 * n.a);
        // Shadowed gaps between the clusters.
        leaf *= mix(0.56, 1.1, smoothstep(0.28, 0.62, cl.g * 0.65 + cl.a * 0.35));
        vec3 plain = vColor;
        vec3 albedo = plain;
        albedo = mix(albedo, rock, isRock);
        albedo = mix(albedo, leaf, isLeaf);
        albedo = mix(albedo, sand, isSand);

        float isPlain = step(0.5, kind) * (1.0 - step(1.5, kind));
        float ndl = max(dot(N, sunDir), 0.0);
        // Leaves: a round clump whose clusters catch the light this way and
        // that, hardly a facet. Painted props: soft, like inflatables.
        vec3 Nl = normalize(normalize(vRound) + vec3(0.0, 0.3, 0.0) + N * 0.1 + (vec3(cl.r, cl.a, cl.g) - 0.5) * 0.85);
        float ndlLeaf = max(dot(Nl, sunDir), 0.0) * 0.8 + 0.2;
        ndl = mix(ndl, ndlLeaf, isLeaf);
        ndl = mix(ndl, max(dot(N, sunDir) * 0.6 + 0.4, 0.0), isPlain);
        vec3 light = sunLight * ndl * vBake.x
          + skyLight * (0.6 + 0.4 * N.y) * vBake.y
          + bounceLight * (0.5 - 0.5 * N.y) * (0.35 + 0.65 * vBake.x);
        // Turquoise light off the water on the lower rock.
        light += vec3(0.04, 0.15, 0.14) * exp(-max(vWorld.y, 0.0) / 5.0) * (0.8 - 0.5 * N.y) * vBake.y * (1.0 - isPlain);
        // Paint keeps its colour: a flatter light, never blown out.
        light = mix(light, vec3(0.42) + light * 0.40, isPlain);
        vec3 col = albedo * light;
        col = applyHaze(col, length(camPos - vWorld));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function makeFrondTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
  const g = cv.getContext('2d');
  for (let i = 0; i < 46; i++) {
    const v = 16 + i * 10.4;
    const len = 60 * Math.sin(Math.min(1, (i + 4) / 48) * Math.PI * 0.9 + 0.14);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(64, v);
      g.lineTo(64 + s * len, v + 24 + len * 0.3);
      g.lineTo(64 + s * len * 0.9, v + 33 + len * 0.3);
      g.lineTo(64, v + 9.5);
      g.closePath();
      g.fillStyle = `rgb(${52 + (i * 13) % 36}, ${118 + (i * 37) % 50}, ${30 + (i * 7) % 22})`;
      g.fill();
    }
  }
  g.strokeStyle = '#93a548'; g.lineWidth = 5; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 500); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function makeBannerTexture(lines, bg, fg, font) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 192);
  // Checker strip along the bottom.
  for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#2a1030'; g.fillRect(i * 32, 168, 32, 12); g.fillStyle = i % 2 ? '#2a1030' : '#ffffff'; g.fillRect(i * 32, 180, 32, 12); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 104px ${font}`;
  g.lineWidth = 14; g.strokeStyle = '#2a1030'; g.lineJoin = 'round';
  g.strokeText(lines, 512, 86, 960); g.fillStyle = fg; g.fillText(lines, 512, 86, 960);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------- build ----------

export function buildWorld({ sky, font = 'system-ui, sans-serif' }) {
  seed = 4242;
  const group = new THREE.Group();

  const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const pts = [], tans = [], rights = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / SAMPLES;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u).setY(0).normalize();
    pts.push(p); tans.push(t); rights.push(new THREE.Vector3(-t.z, 0, t.x));
  }
  const wrap = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const cyc = (a, b) => { const d = Math.abs(a - b) % SAMPLES; return Math.min(d, SAMPLES - d); };
  const step = length / SAMPLES;

  // Signed curvature (positive = turning right, toward +right).
  const curv = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const a = tans[wrap(i - 6)], b = tans[wrap(i + 6)];
    curv[i] = Math.asin(clamp(a.x * b.z - a.z * b.x, -1, 1)) / (12 * step);
  }
  const cpIdx = CONTROL.map(([cx, cz]) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < SAMPLES; i++) { const d = (pts[i].x - cx) ** 2 + (pts[i].z - cz) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  });
  // Sample index at a fractional control point.
  const idxOfCp = (cp) => {
    const a = Math.floor(cp), f = cp - a, n = CONTROL.length;
    const i0 = cpIdx[a % n]; let i1 = cpIdx[(a + 1) % n];
    if (i1 < i0) i1 += SAMPLES;
    return wrap(Math.round(i0 + (i1 - i0) * f));
  };

  // Per-sample half width, and wall factor (0 at a canal's mouth, 1 inside).
  const half = new Float32Array(SAMPLES).fill(OPEN_HALF);
  const wallF = new Float32Array(SAMPLES);
  const walled = new Uint8Array(SAMPLES);
  for (const s of CANALS) {
    const i0 = cpIdx[s.a], i1 = cpIdx[s.b];
    s.i0 = i0; s.i1 = i1;
    for (let i = i0 - MOUTH; i < i0; i++) half[wrap(i)] = OPEN_HALF + (s.half + 9 - OPEN_HALF) * smooth((i - (i0 - MOUTH)) / MOUTH);
    for (let i = i1 + 1; i <= i1 + MOUTH; i++) half[wrap(i)] = OPEN_HALF + (s.half + 9 - OPEN_HALF) * smooth((i1 + MOUTH - i) / MOUTH);
    for (let i = i0; i <= i1; i++) {
      const e = smooth(Math.min(i - i0, i1 - i) / MOUTH), k = wrap(i);
      half[k] = s.half + 9 * (1 - e) + 1.1 * Math.sin(i * 0.043 + s.a) * e;
      wallF[k] = e; walled[k] = 1;
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

  // Nearest sample, searched around a hint so it is cheap every frame.
  function nearest(x, z, hint = -1, window = 60) {
    let best = 0, bestD = Infinity;
    const from = hint < 0 ? 0 : hint - window, to = hint < 0 ? SAMPLES : hint + window;
    for (let o = from; o < to; o++) {
      const i = wrap(o), p = pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    const lat = (x - pts[best].x) * rights[best].x + (z - pts[best].z) * rights[best].z;
    return { idx: best, u: best / SAMPLES, lat, dist: Math.sqrt(bestD) };
  }

  // Samples in a coarse grid, to ask "how far is this point from the course".
  const HASH = 22, hash = new Map();
  for (let i = 0; i < SAMPLES; i += 2) {
    const key = Math.floor(pts[i].x / HASH) + ',' + Math.floor(pts[i].z / HASH);
    if (!hash.has(key)) hash.set(key, []);
    hash.get(key).push(i);
  }
  const near = { dist: 0, clear: 0, idx: 0 };
  // dist: to the nearest centreline sample; clear: to the nearest corridor edge.
  function courseNear(x, z, reach = 2) {
    const cx = Math.floor(x / HASH), cz = Math.floor(z / HASH);
    near.dist = 1e9; near.clear = 1e9; near.idx = -1;
    for (let a = cx - reach; a <= cx + reach; a++) for (let b = cz - reach; b <= cz + reach; b++) {
      const list = hash.get(a + ',' + b);
      if (!list) continue;
      for (const i of list) {
        const d = Math.hypot(pts[i].x - x, pts[i].z - z);
        if (d < near.dist) { near.dist = d; near.idx = i; }
        if (d - half[i] < near.clear) near.clear = d - half[i];
      }
    }
    return near;
  }
  // How far a bank may reach from sample i on one side: until another part
  // of the course is as close as its own (which also stops it folding over
  // on the inside of a corner).
  function bankExtent(i, side, max) {
    const p = pts[i], r = rights[i];
    let d = half[i] + 2;
    for (; d < max; d += 1.5) {
      const n = courseNear(p.x + r.x * side * d, p.z + r.z * side * d, 2);
      if (n.dist < d - 0.9 || n.clear < 1.5) break;
    }
    return Math.max(half[i] + 1.5, d - 1.5);
  }

  const land = new Builder();      // rock and sand: drawn into the height grid
  const deco = new Builder();      // arches of rock, leaves, trunks, props: lit only
  const leafSpots = [];            // [x, y, z, size] where bushes grow
  const palmSpots = [];            // [x, y, z, lean direction, size]
  const rockA = C(0x8d8a82), rockB = C(0xa39a86), rockTop = C(0x6f7f4a);
  const sandA = C(0xf3e2b8), sandB = C(0xe9d3a0);
  const tmpC = new THREE.Color();
  const rockColor = (x, y, z) => tmpC.copy(rockA).lerp(rockB, fbm3(x * 0.05, y * 0.08, z * 0.05, 2));

  // ---------- canal walls ----------

  for (const s of CANALS) {
    for (const side of [-1, 1]) {
      const cols = [];
      for (let i = s.i0; i <= s.i1; i += 2) cols.push(wrap(i));
      // Bank width: as far as the course allows, varied, then smoothed.
      let ext = cols.map((k, c) => Math.min(bankExtent(k, side, 46), half[k] + 14 + 30 * fbm2(c * 0.035 + side * 7.1 + s.a, 2.2)));
      ext = ext.map((_, c) => { let m = 1e9; for (let o = -5; o <= 5; o++) m = Math.min(m, ext[clamp(c + o, 0, ext.length - 1)]); return m; });
      ext = ext.map((_, c) => { let a = 0, n = 0; for (let o = -4; o <= 4; o++) { a += ext[clamp(c + o, 0, ext.length - 1)]; n++; } return a / n; });
      const ROWS = 19;
      const base = land.count;
      cols.forEach((k, c) => {
        const p = pts[k], r = rights[k], e = wallF[k];
        const w0 = half[k] + 0.35;
        const room = Math.max(5, ext[c] - w0);
        // Height: towers and saddles along the canal, low at the mouths.
        const hn = fbm2(c * 0.03 + side * 3.7 + s.a * 1.3, 1.3, 3);
        let T = lerp(8, 36, smooth((hn - 0.3) / 0.42)) * (0.12 + 0.88 * Math.pow(e, 0.8));
        T = Math.max(1.3, Math.min(T, room * 2.4));
        const y4 = Math.min(3.2, 0.62 * T);
        const rows = [
          [1.3, -4], [1.05, -0.4], [0.95, Math.min(0.75, 0.25 * T)], [-0.1, Math.min(1.9, 0.5 * T)], [0.1, y4],
        ];
        const ph = c * 0.4 + side;
        for (let j = 1; j <= 8; j++) {
          const f = j / 8;
          rows.push([0.1 + 4.2 * Math.pow(f, 2.3) + 0.4 * Math.sin(f * 8 + ph), lerp(y4, T, Math.pow(f, 0.85))]);
        }
        const topOff = rows[rows.length - 1][0];
        rows.push([lerp(topOff, room, 0.3), T * (0.97 + 0.1 * noise2(c * 0.21, side * 5))]);
        rows.push([lerp(topOff, room, 0.55), T * (0.9 + 0.16 * noise2(c * 0.17, side * 9))]);
        rows.push([lerp(topOff, room, 0.8), T * 0.66]);
        rows.push([lerp(topOff, room, 0.95), T * 0.3 + 0.3]);
        rows.push([room + 0.8, 0.6]);
        rows.push([room + 2.4, -3.5]);
        for (let j = 0; j < ROWS; j++) {
          const [off, y0] = rows[j];
          let x = p.x + r.x * side * (w0 + off), z = p.z + r.z * side * (w0 + off), y = y0;
          // Bulges, vertical ribs and roughness. At the water the wall only
          // moves away from the channel, so the riding width stays clear.
          let d = (fbm3(x * 0.1, y * 0.1, z * 0.1, 3) - 0.5) * 3.0;
          if (j >= 5 && j <= 12) d += (noise2(c * 0.33 + side * 11, y * 0.05) - 0.5) * 1.5;
          if (j <= 4) d = Math.max(0, d) * 0.5;
          if (j >= ROWS - 2) d = 0;
          x += r.x * side * d; z += r.z * side * d;
          if (j >= 5 && j < ROWS - 2) y += (noise3(x * 0.23, y * 0.23, z * 0.23) - 0.5) * Math.min(1.4, T * 0.12);
          const col = rockColor(x, y, z);
          if (j >= 13 && j <= 15) col.lerp(rockTop, 0.5);
          land.vert(x, y, z, col, 0);
          if ((j === 13 || j === 14 || j === 12) && T > 4 && rnd() < 0.3) leafSpots.push([x, y, z, 1.8 + rnd() * 2.4]);
          if (j === 15 && T > 6 && rnd() < 0.15) leafSpots.push([x, y, z, 1.5 + rnd() * 1.5]);
        }
      });
      // Seen from the channel, the right wall's columns run to the left and
      // the left wall's to the right.
      if (side > 0) land.grid(base, ROWS, cols.length);
      else {
        for (let c = 0; c < cols.length - 1; c++) for (let j = 0; j < ROWS - 1; j++) {
          const a = base + c * ROWS + j, b = a + 1, c2 = a + ROWS, d = c2 + 1;
          land.idx.push(a, c2, b, b, c2, d);
        }
      }
    }
  }

  // ---------- islands and rock stacks ----------

  const solids = []; // { x, z, r } for placing things; collisions use the distance field
  // A limestone tower: undercut at the waterline, steep sides, green crown.
  function addStack(x, z, r, h, { segs = 0, squash = 1, leaves = 0.26 } = {}) {
    const SEG = segs || Math.max(20, Math.min(64, Math.round(r * 2.1)));
    const prof = [ // [height (m below 3.2, fraction of h above), radius factor]
      [-4, 1.14], [-0.4, 1.03], [0.75, 1.01], [1.9, 1.09], [3.2, 1.07],
      [0.16, 1.1], [0.3, 1.12], [0.44, 1.08], [0.58, 1.0], [0.7, 0.9], [0.8, 0.76], [0.88, 0.6], [0.94, 0.42], [0.98, 0.22], [1.0, 0.0],
    ];
    const ROWS = prof.length, base = land.count, ph = rnd() * 50;
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th) * squash;
      const lobe = 1 + 0.2 * Math.sin(th * 2 + ph) + 0.12 * Math.sin(th * 5 + ph * 2);
      for (let j = 0; j < ROWS; j++) {
        const rr = r * prof[j][1] * lobe;
        let px = x + cs * rr, pz = z + sn * rr, y = j < 5 ? prof[j][0] : Math.max(3.4, prof[j][0] * h);
        if (j >= 2 && j < ROWS - 1) {
          const d = (fbm3(px * 0.09 + ph, y * 0.09, pz * 0.09, 3) - 0.5) * Math.min(4.5, r * 0.36) + (j >= 5 ? (noise2(k * 0.9 + ph, y * 0.05) - 0.5) * Math.min(1.8, r * 0.12) : 0);
          const dd = j <= 4 ? Math.max(0, d) * 0.5 : d;
          px += cs * dd; pz += sn * dd;
          if (j >= 5) y += (noise3(px * 0.2, y * 0.2, pz * 0.2) - 0.5) * Math.min(2.0, h * 0.06);
        }
        const col = rockColor(px, y, pz);
        if (j >= ROWS - 6) col.lerp(rockTop, 0.5);
        land.vert(px, y, pz, col, 0);
        if (j >= ROWS - 6 && j < ROWS - 1 && rnd() < leaves) leafSpots.push([px, y, pz, Math.min(4.2, 1.4 + r * 0.07 + rnd() * 1.8)]);
        if (j >= 6 && j < ROWS - 6 && rnd() < leaves * 0.15) leafSpots.push([px, y, pz, 1.2 + rnd()]);
      }
    }
    land.grid(base, ROWS, SEG, true);
    solids.push({ x, z, r: r * 1.25 });
  }

  // A sand island: a gentle beach all round and low dunes.
  function addSand(x, z, r, { hill = 2.4, palms = 0, wob = 0.14 } = {}) {
    const SEG = Math.max(28, Math.min(72, Math.round(r * 1.1)));
    const prof = [[1.28, -3.6], [1.12, -1.2], [1.0, 0.0], [0.93, 0.5], [0.82, 1.1], [0.6, 1.7], [0.32, 0.85 * hill + 1], [0.0, hill + 1]];
    const ROWS = prof.length, base = land.count, ph = rnd() * 50;
    const shore = (th) => r * (1 + wob * (0.6 * Math.sin(3 * th + ph) + 0.4 * Math.sin(7 * th + 2 * ph)));
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), R = shore(th);
      for (let j = 0; j < ROWS; j++) {
        const px = x + cs * R * prof[j][0], pz = z + sn * R * prof[j][0];
        let y = prof[j][1];
        if (j >= 4) y += (fbm2(px * 0.06, pz * 0.06) - 0.4) * hill * 0.9;
        land.vert(px, y, pz, tmpC.copy(sandA).lerp(sandB, noise2(px * 0.1, pz * 0.1)), 3);
      }
    }
    land.grid(base, ROWS, SEG, true);
    for (let i = 0; i < palms; i++) {
      const th = (i / palms) * Math.PI * 2 + rnd() * 0.5, rr = shore(th) * (r > 60 ? 0.7 + rnd() * 0.2 : 0.55 + rnd() * 0.25);
      palmSpots.push([x + Math.cos(th) * rr, 1.35, z + Math.sin(th) * rr, th, 0.85 + rnd() * 0.45]);
    }
    const sIsland = { x, z, r: r * 1.3, shore };
    solids.push(sIsland);
    return sIsland;
  }

  // The lagoon's island: beach, palms and a jungle-covered rock in the middle.
  const lagoonIsle = addSand(12, 38, 92, { hill: 3, palms: 34, wob: 0.1 });
  addStack(6, 32, 38, 46, { segs: 60 });
  addStack(52, 58, 20, 26);
  addStack(-36, 10, 18, 22);
  // Start beach on the right of the grid, and a cay inside the first bend.
  const startBeach = addSand(-64, 276, 30, { palms: 9 });
  addSand(62, 284, 20, { palms: 5 });
  addSand(150, 138, 22, { palms: 6 });
  // The tall rock the long bend goes around, and its little brother.
  addStack(222, 140, 17, 52);
  addStack(246, 118, 8, 20);
  // Slalom stacks on alternating sides of the north side.
  addStack(92, -249, 7.5, 24);
  addStack(22, -229, 7.5, 28);
  addStack(-48, -253, 7.5, 22);
  addStack(-118, -227, 7, 18, { leaves: 0.1 });
  // Inside the north-west sweep.
  addStack(-178, -168, 38, 58, { segs: 56 });
  addStack(-150, -205, 12, 30);
  // The outside: towers all around the loop.
  for (const [x, z, r, h] of [
    [318, 30, 30, 56], [352, 186, 34, 44], [330, 262, 16, 30], [300, -224, 34, 62], [336, -110, 20, 38],
    [118, -326, 40, 70], [186, -310, 16, 34], [-36, -334, 26, 46], [-112, -316, 14, 30], [-300, -300, 36, 66],
    [-336, -64, 34, 52], [-322, 106, 30, 44], [-298, 246, 28, 40], [-150, 318, 22, 34], [196, 306, 22, 32],
    [24, 356, 30, 40], [-240, 318, 12, 24], [372, 60, 14, 30], [-372, 20, 16, 34], [258, 330, 12, 22],
  ]) {
    const n = courseNear(x, z, 4);
    const rr = Math.min(r, Math.max(6, (n.clear - 6) / 1.3));
    addStack(x, z, rr, h * (rr / r) ** 0.5, { leaves: 0.13 });
  }

  // Far islands on the horizon (outside the baked area): hazy silhouettes.
  const far = new Builder();
  for (const [x, z, r, h] of [[1150, -700, 210, 120], [-1300, -500, 260, 150], [-800, 1300, 220, 100], [1300, 800, 260, 130], [200, -1500, 300, 160], [-1500, 500, 200, 110], [300, 1500, 240, 120]]) {
    const SEG = 22, ROWS = 6, base = far.count, ph = rnd() * 9;
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      for (let j = 0; j < ROWS; j++) {
        const f = j / (ROWS - 1);
        const rr = r * (1 - f * f) * (1 + 0.3 * Math.sin(th * 3 + ph) + 0.15 * Math.sin(th * 7 + ph));
        far.vert(x + Math.cos(th) * rr, f === 0 ? -2 : h * Math.pow(f, 0.8) * (0.8 + 0.4 * noise2(th * 2 + ph, f * 3)), z + Math.sin(th) * rr * 0.8, C(0x3f6a3a), 1);
      }
    }
    far.grid(base, ROWS, SEG, true);
  }

  // ---------- rock arches over the canals ----------

  const arches = [];
  for (const cp of ARCH_CPS) {
    const k = idxOfCp(cp), p = pts[k], t = tans[k], r = rights[k];
    const span = half[k] + 3.2, top = 11.5, thick = 4.5, depth = 7;
    const U = 22, V = 10, base = deco.count, ph = rnd() * 20;
    for (let u = 0; u <= U; u++) {
      const a = (u / U) * Math.PI;                       // from the right wall over to the left
      const cx = Math.cos(a) * span, cy = 3 + Math.sin(a) * (top - 3);
      const nx = Math.cos(a), ny = Math.sin(a);          // outward from the arch's inside
      for (let v = 0; v < V; v++) {
        const b = (v / V) * Math.PI * 2;
        const ro = Math.cos(b) * thick * 0.5 + thick * 0.5; // 0 at the underside
        const al = Math.sin(b) * depth * 0.5;
        let lat = cx + nx * ro, y = cy + ny * ro * 1.25;
        const along = al;
        let x = p.x + r.x * lat + t.x * along, z = p.z + r.z * lat + t.z * along;
        const d = (fbm3(x * 0.16 + ph, y * 0.16, z * 0.16, 3) - 0.5) * 2.4;
        if (ro > 0.4) { x += r.x * nx * d + t.x * Math.sin(b) * d * 0.6; z += r.z * nx * d + t.z * Math.sin(b) * d * 0.6; y += ny * Math.abs(d) * 0.8; }
        deco.vert(x, y, z, rockColor(x, y, z), 0);
        if (ny > 0.7 && ro > thick * 0.8 && rnd() < 0.5) leafSpots.push([x, y + 0.3, z, 1.3 + rnd() * 1.3]);
      }
    }
    for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
      const a = base + u * V + v, b = base + u * V + (v + 1) % V, c = base + (u + 1) * V + v, d = base + (u + 1) * V + (v + 1) % V;
      deco.idx.push(a, b, c, b, d, c);
    }
    arches.push({ idx: k, pos: p.clone() });
  }

  // ---------- height grid, distance field, baked light ----------

  const G0 = -430, GN = 860;                      // 1 m cells over [-430, 430]²
  const H = new Float32Array(GN * GN).fill(-10);
  // Where the land meets the water: 1 along a beach, 2 along rock. (Rock
  // leans out over the water, so its outline from above is not its waterline.)
  const waterline = new Uint8Array(GN * GN);
  {
    const P = land.pos, I = land.idx, KIND = land.kind;
    const markLine = (x, z, k) => {
      const ix = Math.floor(x), iz = Math.floor(z);
      if (ix >= 0 && iz >= 0 && ix < GN && iz < GN) waterline[iz * GN + ix] = k;
    };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a] - G0, ay = P[a + 1], az = P[a + 2] - G0, bx = P[b] - G0, by = P[b + 1], bz = P[b + 2] - G0, cx = P[c] - G0, cy = P[c + 1], cz = P[c + 2] - G0;
      if (Math.max(ay, by, cy) < 0.05) continue;
      const lineKind = KIND[I[t]] === 3 ? 1 : 2;
      if (Math.min(ay, by, cy) < 0) {
        // Edges that cross the water level.
        const cross = (x0, y0, z0, x1, y1, z1) => { if ((y0 < 0) !== (y1 < 0)) { const f = y0 / (y0 - y1); markLine(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, lineKind); } };
        cross(ax, ay, az, bx, by, bz); cross(bx, by, bz, cx, cy, cz); cross(cx, cy, cz, ax, ay, az);
      }
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(GN - 1, Math.floor(Math.max(ax, bx, cx)));
      const z0 = Math.max(0, Math.floor(Math.min(az, bz, cz))), z1 = Math.min(GN - 1, Math.floor(Math.max(az, bz, cz)));
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, pz = z + 0.5;
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
        const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const y = w0 * ay + w1 * by + w2 * cy, i = z * GN + x;
        if (y > H[i]) H[i] = y;
        if (y > -0.2 && y < 0.25) waterline[i] = lineKind;
      }
    }
    // Thin cliff faces can miss every cell centre: mark their vertices too.
    for (let v = 0; v < P.length; v += 3) {
      const x = Math.floor(P[v] - G0), z = Math.floor(P[v + 2] - G0);
      if (x < 0 || z < 0 || x >= GN || z >= GN || P[v + 1] < 0.05) continue;
      if (P[v + 1] > H[z * GN + x]) H[z * GN + x] = P[v + 1];
    }
  }
  const heightAt = (x, z) => {
    const ix = Math.floor(x - G0), iz = Math.floor(z - G0);
    return ix < 0 || iz < 0 || ix >= GN || iz >= GN ? -10 : H[iz * GN + ix];
  };

  // Exact Euclidean distance transform (Felzenszwalb), rows then columns.
  function distanceField(isSource) {
    const INF = 1e12, f = new Float64Array(GN), d = new Float64Array(GN), v = new Int32Array(GN), zz = new Float64Array(GN + 1);
    const out = new Float32Array(GN * GN);
    const pass = (n) => {
      let k = 0; v[0] = 0; zz[0] = -INF; zz[1] = INF;
      for (let q = 1; q < n; q++) {
        let s;
        do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= zz[k] && --k >= 0);
        k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
    };
    for (let x = 0; x < GN; x++) {
      for (let z = 0; z < GN; z++) f[z] = isSource(z * GN + x) ? 0 : INF;
      pass(GN);
      for (let z = 0; z < GN; z++) out[z * GN + x] = d[z];
    }
    for (let z = 0; z < GN; z++) {
      for (let x = 0; x < GN; x++) f[x] = out[z * GN + x];
      pass(GN);
      for (let x = 0; x < GN; x++) out[z * GN + x] = Math.sqrt(d[x]);
    }
    return out;
  }
  const toLand = distanceField((i) => H[i] > 0.05);
  const toWater = distanceField((i) => H[i] <= 0.05);
  const toBeach = distanceField((i) => waterline[i] === 1);
  const toRock = distanceField((i) => waterline[i] === 2);
  const fieldAt = (f, x, z) => {
    const fx = clamp(x - G0 - 0.5, 0, GN - 1.001), fz = clamp(z - G0 - 0.5, 0, GN - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0, i = z0 * GN + x0;
    return (f[i] * (1 - ax) + f[i + 1] * ax) * (1 - az) + (f[i + GN] * (1 - ax) + f[i + GN + 1] * ax) * az;
  };
  // Signed distance to the shore, metres: positive over water.
  const sdf = new Float32Array(GN * GN);
  for (let i = 0; i < GN * GN; i++) sdf[i] = toLand[i] > 0 ? toLand[i] - 0.5 : 0.5 - toWater[i];
  function landDist(x, z) {
    const fx = x - G0 - 0.5, fz = z - G0 - 0.5;
    if (fx < 0 || fz < 0 || fx >= GN - 1 || fz >= GN - 1) return 999;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0, i = z0 * GN + x0;
    return (sdf[i] * (1 - ax) + sdf[i + 1] * ax) * (1 - az) + (sdf[i + GN] * (1 - ax) + sdf[i + GN + 1] * ax) * az;
  }

  // Is the sun hidden from a point? Walks toward the sun over the height grid.
  const sunH = Math.hypot(SUN_DIR.x, SUN_DIR.z), sunTan = SUN_DIR.y / sunH, sdx = SUN_DIR.x / sunH, sdz = SUN_DIR.z / sunH;
  function sunAt(x, y, z, start) {
    let vis = 1;
    for (let d = start; d < 62; d += d < 12 ? 1 : 2) {
      const ry = y + d * sunTan;
      if (ry > 72) break;
      const over = heightAt(x + sdx * d, z + sdz * d) - ry;
      if (over > 0) { vis = Math.min(vis, 1 - Math.min(1, over / 1.2)); if (vis <= 0) return 0; }
    }
    return vis;
  }
  const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4 + 0.3), Math.sin(i * Math.PI / 4 + 0.3)]);
  // Share of the sky a point sees (walls around it hide the rest).
  function skyAt(x, y, z, dists) {
    let sum = 0;
    for (const [dx, dz] of DIRS) {
      let maxTan = 0;
      for (const d of dists) maxTan = Math.max(maxTan, (heightAt(x + dx * d, z + dz * d) - y) / d);
      sum += Math.atan(maxTan);
    }
    return 1 - sum / (8 * Math.PI / 2);
  }
  function bakeLight(builder, geo) {
    const P = builder.pos, bake = geo.attributes.bake.array;
    for (let v = 0, i = 0; v < P.length; v += 3, i += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2];
      if (y < -0.5 || x < G0 || z < G0 || x > G0 + GN || z > G0 + GN) continue;
      bake[i] = sunAt(x, y + 0.4, z, 1.6);
      bake[i + 1] = 0.3 + 0.7 * clamp(skyAt(x, y + 0.3, z, [2.5, 6, 12]) * 1.5 - 0.1, 0, 1);
    }
  }

  // Water map, 1024² over the same square: R distance to the waterline (0..40 m),
  // G depth (0..16 m), B sunlight on the water, A how high the land around
  // stands (what the water reflects instead of sky).
  const LN = 1024, LSIZE = GN, LMAX_D = 40, LMAX_DEPTH = 16;
  const landData = new Uint8Array(LN * LN * 4);
  const SANDBARS = [[30, 208, 34, 13], [-150, 232, 26, 12], [118, 190, 30, 14], [-206, 190, 22, 12], [176, -246, 20, 10]];
  // Depth from the distances to the nearest beach and the nearest rock:
  // beaches shelve gently, rock drops straight into a metre and a half.
  function depthAt(x, z, dBeach, dRock) {
    let depth = Math.min(0.12 + dBeach * 0.4, 1.5 + dRock * 0.5);
    if (depth > 2.6) {
      const q = Math.pow(Math.abs(x) / 292, 4) + Math.pow(Math.abs(z) / 300, 4);
      const inside = 1 - smooth((q - 0.7) / 0.6);
      const lagoon = inside > 0 ? 2.6 + 3.4 * fbm2(x * 0.021 + 5, z * 0.021) : 0;
      depth = Math.min(depth, lerp(LMAX_DEPTH, lagoon, inside));
    }
    for (const [bx, bz, rx, rz] of SANDBARS) {
      const e = ((x - bx) / rx) ** 2 + ((z - bz) / rz) ** 2;
      if (e < 1.6) depth = Math.min(depth, 0.45 + 2.8 * smooth(e / 1.6) + 0.25 * noise2(x * 0.3, z * 0.3));
    }
    return Math.max(0, depth);
  }
  {
    // Sun and sky for the water on a 2 m grid, then blurred a little.
    const SN = GN / 2, sunW = new Float32Array(SN * SN).fill(1), skyW = new Float32Array(SN * SN);
    for (let z = 0; z < SN; z++) for (let x = 0; x < SN; x++) {
      const wx = G0 + x * 2 + 1, wz = G0 + z * 2 + 1, i = z * SN + x;
      const d = toLand[(z * 2 + 1) * GN + x * 2 + 1];
      if (d <= 0 || d > 50) { if (d <= 0) { skyW[i] = 0.6; sunW[i] = 0.3; } continue; }
      sunW[i] = sunAt(wx, 0.1, wz, 1);
      skyW[i] = 1 - skyAt(wx, 0.2, wz, [3, 6, 12, 20, 32]);
    }
    const blur = (a) => {
      const b = new Float32Array(a.length);
      for (let z = 0; z < SN; z++) for (let x = 0; x < SN; x++) {
        let s = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz2 = z + dz;
          if (xx < 0 || zz2 < 0 || xx >= SN || zz2 >= SN) continue;
          s += a[zz2 * SN + xx]; n++;
        }
        b[z * SN + x] = s / n;
      }
      return b;
    };
    const sunB = blur(sunW), skyB = blur(skyW);
    const texel = LSIZE / LN;
    for (let y = 0; y < LN; y++) for (let x = 0; x < LN; x++) {
      const wx = G0 + (x + 0.5) * texel, wz = G0 + (y + 0.5) * texel;
      const dBeach = fieldAt(toBeach, wx, wz), dRock = fieldAt(toRock, wx, wz), d = Math.min(dBeach, dRock);
      const sx = clamp((wx - G0) / 2 - 0.5, 0, SN - 1.001), sz = clamp((wz - G0) / 2 - 0.5, 0, SN - 1.001);
      const x0 = Math.floor(sx), z0 = Math.floor(sz), ax = sx - x0, az = sz - z0, si = z0 * SN + x0;
      const bil = (a) => (a[si] * (1 - ax) + a[si + 1] * ax) * (1 - az) + (a[si + SN] * (1 - ax) + a[si + SN + 1] * ax) * az;
      const o = (y * LN + x) * 4;
      landData[o] = Math.round(Math.min(1, d / LMAX_D) * 255);
      landData[o + 1] = Math.round(Math.min(1, depthAt(wx, wz, dBeach, dRock) / LMAX_DEPTH) * 255);
      landData[o + 2] = Math.round(clamp(bil(sunB), 0, 1) * 255);
      landData[o + 3] = Math.round(clamp(bil(skyB), 0, 1) * 255);
    }
  }
  const landTexture = new THREE.DataTexture(landData, LN, LN, THREE.RGBAFormat);
  landTexture.magFilter = THREE.LinearFilter; landTexture.minFilter = THREE.LinearFilter;
  landTexture.needsUpdate = true;
  const landBounds = new THREE.Vector4(G0, G0, LSIZE, LMAX_D);

  // ---------- the racing line ----------
  // Where bills are dropped and where Jane rides: the inside of the canal
  // corners, a lazy weave in open water, straight over the ramps.

  const rampIdx = RAMP_CPS.map(idxOfCp), gateIdx = GATE_CPS.map(idxOfCp);
  const lineLat = new Float32Array(SAMPLES);
  {
    const raw = new Float32Array(SAMPLES);
    const slalom = [cpIdx[14], cpIdx[19]];
    for (let i = 0; i < SAMPLES; i++) {
      if (walled[i]) raw[i] = clamp(curv[i] * 70, -1, 1) * Math.max(0, half[i] - 2.8) * 0.8;
      else {
        let env = 1;
        for (const r of rampIdx) env = Math.min(env, smooth((cyc(i, r) * step - 16) / 30));
        for (const s of CANALS) env = Math.min(env, smooth((Math.min(cyc(i, s.i0), cyc(i, s.i1)) * step - 30) / 40));
        env = Math.min(env, smooth((cyc(i, 0) * step - 20) / 40));
        const inSlalom = i > slalom[0] && i < slalom[1];
        raw[i] = inSlalom ? clamp(curv[i] * 90, -1, 1) * 3 : 5.5 * Math.sin((i * step * Math.PI * 2) / 128) * env;
      }
    }
    for (let i = 0; i < SAMPLES; i++) { let a = 0; for (let o = -14; o <= 14; o++) a += raw[wrap(i + o)]; lineLat[i] = a / 29; }
    // Keep the line off the rocks.
    for (let i = 0; i < SAMPLES; i++) {
      for (let n = 0; n < 6; n++) {
        const x = pts[i].x + rights[i].x * lineLat[i], z = pts[i].z + rights[i].z * lineLat[i];
        if (landDist(x, z) > 4.5) break;
        lineLat[i] *= 0.7;
      }
    }
  }

  // ---------- plants ----------

  // Bushes: squashed, lumpy icosahedra in a few greens. The 60 face corners
  // of an icosahedron share 12 points; each point gets one jitter, so a bush
  // stays a closed clump instead of breaking into shards.
  {
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const icoPoint = [], icoFirst = [];
    {
      const seen = [], q = ico.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < q.count; i++) {
        v.fromBufferAttribute(q, i);
        let k = seen.findIndex((o) => o.distanceToSquared(v) < 1e-6);
        if (k < 0) { k = seen.length; seen.push(v.clone()); icoFirst.push(i); }
        icoPoint.push(k);
      }
    }
    const jitter = new Float32Array(ico.attributes.position.count);
    const greens = [C(0x2a5f20), C(0x357a28), C(0x4a8a2e), C(0x23501f), C(0x5a8f33)];
    const hill = lagoonIsle;
    // The lagoon island's jungle, between the beach and the rock.
    for (let i = 0; i < 150; i++) {
      const th = rnd() * Math.PI * 2, rr = hill.shore(th) * (0.42 + rnd() * 0.3);
      const x = hill.x + Math.cos(th) * rr, z = hill.z + Math.sin(th) * rr;
      leafSpots.push([x, Math.max(1.6, heightAt(x, z)) + 0.6, z, 2.2 + rnd() * 2.6]);
    }
    for (const [x, y, z, s] of leafSpots) {
      const g = greens[Math.floor(rnd() * greens.length)];
      const m = M4(x, y + s * 0.25, z, rnd() * 6, s * (0.9 + rnd() * 0.5), s * (0.6 + rnd() * 0.3), s * (0.9 + rnd() * 0.5), rnd() * 0.5, rnd() * 0.5);
      for (let i = 0; i < jitter.length; i++) jitter[i] = 0.76 + 0.5 * rnd();
      deco.add(ico, m, g, 2, (v, c, i) => { v.multiplyScalar(jitter[icoFirst[icoPoint[i]]]); c.multiplyScalar(0.75 + 0.5 * (v.y * 0.5 + 0.5)); });
    }
  }

  // Palms: a curved trunk and a crown of drooping fronds.
  const fronds = { pos: [], uv: [], col: [], idx: [] };
  {
    const trunkA = C(0x8a6d4c), trunkB = C(0x6e5438);
    for (const [x, y0, z, dir, s] of palmSpots) {
      const hgt = (7 + rnd() * 4) * s, lean = (0.8 + rnd() * 1.8) * s, ldx = Math.cos(dir), ldz = Math.sin(dir);
      const y = Math.max(0.6, heightAt(x, z) - 0.2, y0 - 0.6);
      const RINGS = 7, SIDES = 6, base = deco.count;
      let tx = x, ty = y + hgt, tz = z;
      for (let j = 0; j < RINGS; j++) {
        const f = j / (RINGS - 1), rad = (0.3 - 0.12 * f) * s;
        const cx = x + ldx * lean * f * f, cz = z + ldz * lean * f * f, cy = y + hgt * f;
        if (j === RINGS - 1) { tx = cx; ty = cy; tz = cz; }
        for (let k = 0; k < SIDES; k++) {
          const a = (k / SIDES) * Math.PI * 2;
          deco.vert(cx + Math.cos(a) * rad, cy, cz + Math.sin(a) * rad, tmpC.copy(j % 2 ? trunkA : trunkB), 1);
        }
      }
      // Rings were emitted row by row here: columns are rings going up.
      for (let j = 0; j < RINGS - 1; j++) for (let k = 0; k < SIDES; k++) {
        const a = base + j * SIDES + k, b = base + (j + 1) * SIDES + k, c = base + j * SIDES + (k + 1) % SIDES, d = base + (j + 1) * SIDES + (k + 1) % SIDES;
        deco.idx.push(a, b, c, b, d, c);
      }
      const N = 11;
      for (let i = 0; i < N; i++) {
        const az = (i / N) * Math.PI * 2 + rnd() * 0.4, up = i % 3 === 0 ? 0.95 : 0.35 + rnd() * 0.3;
        const len = (3.6 + rnd() * 1.4) * s * (i % 3 === 0 ? 0.75 : 1), wid = 1.25 * s, SEGS = 5;
        const b0 = fronds.pos.length / 3, tint = 0.75 + rnd() * 0.4;
        const dx = Math.cos(az), dz = Math.sin(az), sx = -dz, sz = dx;
        for (let k = 0; k <= SEGS; k++) {
          const f = k / SEGS, out = len * f * Math.cos(up) * (1 - 0.12 * f), rise = len * (f * Math.sin(up) - f * f * (0.55 + 0.35 * (1 - up)));
          const px = tx + dx * out, py = ty + rise, pz = tz + dz * out, w = wid * 0.5 * (0.55 + 0.45 * Math.sin(f * Math.PI));
          fronds.pos.push(px - sx * w, py - 0.12 * w, pz - sz * w, px + sx * w, py - 0.12 * w, pz + sz * w);
          fronds.uv.push(0, 1 - f, 1, 1 - f);
          fronds.col.push(tint, tint, tint, tint, tint, tint);
          if (k < SEGS) { const a = b0 + k * 2; fronds.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
      }
    }
  }

  // ---------- gates, ramps, props ----------

  const pink = C(PINK), yellow = C(YELLOW), cream = C(CREAM), plum = C(0x3a1840), white = C(0xffffff);
  const stripes = [pink, yellow, cream];

  // Inflatable arches: a striped tube over the water on two fat floats.
  const gates = [];
  GATE_CPS.forEach((cp, g) => {
    const k = gateIdx[g], p = pts[k], t = tans[k], r = rights[k];
    const hw = half[k] + (walled[k] ? 0.1 : -1.5), height = g === 0 ? 9.5 : 7.2, tube = g === 0 ? 0.62 : 0.42;
    const path = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, a) => {
      const th = (a / 24) * Math.PI;
      return new THREE.Vector3(p.x + r.x * Math.cos(th) * hw, Math.sin(th) * height, p.z + r.z * Math.cos(th) * hw);
    }));
    const SEG = 48;
    deco.add(new THREE.TubeGeometry(path, SEG, tube, 8, false), null, white, 1, (v, c, i) => {
      c.copy(stripes[(Math.floor(i / 9 / 4) + g) % (g === 0 ? 3 : 2)]);
    });
    for (const s of [-1, 1]) {
      deco.add(new THREE.CylinderGeometry(tube * 2.1, tube * 2.4, 1.5, 12), M4(p.x + r.x * s * hw, 0.25, p.z + r.z * s * hw), s < 0 ? pink : yellow);
    }
    gates.push({ idx: k, u: k / SAMPLES, pos: p.clone(), tan: t.clone(), right: r.clone(), half: hw, height });
  });
  // Start / finish banner under the big arch.
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(9.6, 9.6 * 192 / 1024),
    new THREE.MeshBasicMaterial({ map: makeBannerTexture('CRISPY J  ·  $100,000', '#ff4fa3', '#ffd23f', font), side: THREE.DoubleSide, toneMapped: false }),
  );
  banner.position.copy(gates[0].pos).setY(7.2);
  banner.rotation.y = Math.atan2(-gates[0].tan.x, -gates[0].tan.z);
  group.add(banner);

  // Bunting across the canals.
  for (const s of CANALS) {
    for (let i = s.i0 + 70; i < s.i1 - 50; i += 96) {
      const k = wrap(i), p = pts[k], r = rights[k], w = half[k] + 0.6, N = 13;
      if (arches.some((a) => cyc(a.idx, k) < 30) || gateIdx.some((g) => cyc(g, k) < 24)) continue;
      for (let n = 0; n < N; n++) {
        const f = (n + 0.5) / N, lat = -w + f * 2 * w, y = 8.6 - Math.sin(f * Math.PI) * 1.5;
        const b = deco.count, c = n % 2 ? pink : yellow, dx = r.x * 0.5, dz = r.z * 0.5;
        const px = p.x + r.x * lat, pz = p.z + r.z * lat;
        deco.vert(px - dx, y, pz - dz, c, 1); deco.vert(px + dx, y, pz + dz, c, 1); deco.vert(px, y - 1.25, pz, c, 1);
        deco.tri(b, b + 1, b + 2); deco.tri(b, b + 2, b + 1);
      }
    }
  }

  // Beach life on the lagoon island and the start beach: parasols, boards, a hut.
  function parasol(x, z, a, b) {
    const y = Math.max(0.5, heightAt(x, z));
    deco.add(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), M4(x, y + 1.25, z), cream);
    deco.add(new THREE.ConeGeometry(1.7, 0.7, 10), M4(x, y + 2.6, z, rnd() * 3), white, 1, (v, c, i) => { c.copy(Math.floor(((Math.atan2(v.z, v.x) / Math.PI + 1) * 5)) % 2 ? a : b); });
  }
  function board(x, z, col) {
    const y = Math.max(0.5, heightAt(x, z));
    deco.add(new THREE.SphereGeometry(1, 10, 6), M4(x, y + 1.0, z, rnd() * 3, 0.28, 1.15, 0.06, 0, 0.12), col);
  }
  for (const [isle, n] of [[lagoonIsle, 12], [startBeach, 5]]) {
    for (let i = 0; i < n; i++) {
      // On the side that faces the start straight.
      const th = isle === lagoonIsle ? 0.6 + (i / n) * 2.0 : -2.3 + (i / n) * 1.6;
      const rr = isle.shore(th) * (isle === lagoonIsle ? 0.84 : 0.6);
      const x = isle.x + Math.cos(th) * rr, z = isle.z + Math.sin(th) * rr;
      if (i % 3 === 2) board(x, z, [pink, yellow, C(0x4fd6ff)][i % 3]);
      else parasol(x, z, i % 2 ? pink : yellow, cream);
    }
  }
  {
    // Tiki hut on the start beach.
    const x = startBeach.x + 4, z = startBeach.z - 6, y = Math.max(0.8, heightAt(x, z));
    deco.add(new THREE.CylinderGeometry(2.2, 2.2, 2.4, 10), M4(x, y + 1.2, z), C(0xb98a56));
    deco.add(new THREE.ConeGeometry(3.6, 2.4, 10), M4(x, y + 3.5, z), C(0xd9b86a));
    deco.add(new THREE.BoxGeometry(3.4, 0.9, 0.12), M4(x, y + 1.7, z - 2.3), pink);
  }
  // Hot-air balloons over the lagoon.
  for (const [x, y, z, s, a, b] of [[40, 95, 60, 1, pink, yellow], [-250, 130, -260, 1.3, yellow, cream], [330, 110, -40, 1.1, pink, cream]]) {
    deco.add(new THREE.SphereGeometry(9 * s, 16, 12), M4(x, y, z, 0, 1, 1.15, 1), white, 1, (v, c) => {
      c.copy(Math.floor((Math.atan2(v.z, v.x) / Math.PI + 1) * 6) % 2 ? a : b);
      if (v.y < 0) { const k = 1 + (v.y / (9 * s)) * 0.55; v.x *= k; v.z *= k; }
    });
    deco.add(new THREE.BoxGeometry(2.2 * s, 1.6 * s, 2.2 * s), M4(x, y - 15 * s, z), C(0x8a5a34));
  }

  // Ramps: inflatable wedges, striped, bobbing on the water.
  const ramps = [];
  const rampBuilder = new Builder();
  {
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const f = i / N, zz = -f * RAMP_LEN, y = 0.05 + f * (RAMP_LIP - 0.05);
      const c = i % 2 ? pink : yellow;
      for (const [x, yy] of [[-RAMP_W / 2, -0.5], [-RAMP_W / 2, y], [RAMP_W / 2, y], [RAMP_W / 2, -0.5]]) rampBuilder.vert(x, yy, zz, c, 1);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 4, b = a + 4;
      rampBuilder.idx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); // deck
      rampBuilder.idx.push(a, a + 1, b, a + 1, b + 1, b);             // left side
      rampBuilder.idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // right side
    }
    const e = N * 4;
    rampBuilder.idx.push(e, e + 1, e + 2, e, e + 2, e + 3);           // tall end
    rampBuilder.idx.push(0, 2, 1, 0, 3, 2);
    // Fat side tubes.
    for (const s of [-1, 1]) {
      const tube = new THREE.CylinderGeometry(0.42, 0.42, Math.hypot(RAMP_LEN, RAMP_LIP) + 0.4, 10);
      rampBuilder.add(tube, M4(s * (RAMP_W / 2 + 0.2), RAMP_LIP / 2 + 0.1, -RAMP_LEN / 2, 0, 1, 1, 1, -Math.PI / 2 + Math.atan2(RAMP_LIP, RAMP_LEN)), cream);
    }
  }
  const terrainMat = makeTerrainMaterial(sky, makeNoiseTexture());
  const rampGeo = rampBuilder.geometry();
  for (const k of rampIdx) {
    const c = pts[k], t = tans[k];
    const mesh = new THREE.Mesh(rampGeo, terrainMat);
    const start = c.clone().addScaledVector(t, -RAMP_LEN / 2);
    mesh.position.copy(start);
    mesh.rotation.y = Math.atan2(-t.x, -t.z);
    mesh.frustumCulled = false;
    group.add(mesh);
    ramps.push({ idx: k, u: k / SAMPLES, start, t: t.clone(), r: new THREE.Vector3(-t.z, 0, t.x), mesh, base: 0 });
  }
  function rampHeight(x, z) {
    for (const r of ramps) {
      const dx = x - r.start.x, dz = z - r.start.z;
      const a = dx * r.t.x + dz * r.t.z;
      if (a < 0 || a > RAMP_LEN) continue;
      if (Math.abs(dx * r.r.x + dz * r.r.z) > RAMP_W / 2) continue;
      return r.base + 0.05 + (a / RAMP_LEN) * (RAMP_LIP - 0.05);
    }
    return -Infinity;
  }

  // Buoys along the open water, pink on the left and yellow on the right.
  const buoyPos = [];
  {
    let acc = 0;
    for (let i = 0; i < SAMPLES; i++) {
      acc += step;
      if (acc < 30) continue;
      let nearWall = false;
      for (let o = -MOUTH - 14; o <= MOUTH + 14; o += 6) if (walled[wrap(i + o)]) nearWall = true;
      if (nearWall) continue;
      acc = 0;
      for (const side of [-1, 1]) {
        const x = pts[i].x + rights[i].x * side * (half[i] + 1.5), z = pts[i].z + rights[i].z * side * (half[i] + 1.5);
        if (landDist(x, z) > 3) buoyPos.push([x, z, side]);
      }
    }
  }
  const buoyGeo = new THREE.SphereGeometry(0.55, 12, 8);
  const buoyMesh = new THREE.InstancedMesh(buoyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), buoyPos.length);
  buoyPos.forEach((b, i) => buoyMesh.setColorAt(i, b[2] < 0 ? pink : yellow));
  buoyMesh.frustumCulled = false;
  group.add(buoyMesh);

  // Pool floats drifting in the lagoon: flamingos and ducks.
  const floats = [];
  {
    const fl = new Builder();
    fl.add(new THREE.TorusGeometry(1.5, 0.55, 10, 22), M4(0, 0.35, 0, 0, 1, 1, 1, Math.PI / 2), pink);
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.4, -1.5), new THREE.Vector3(0, 1.8, -1.9), new THREE.Vector3(0, 3.0, -1.5), new THREE.Vector3(0, 3.3, -2.1)]);
    fl.add(new THREE.TubeGeometry(neck, 14, 0.3, 8, false), null, pink);
    fl.add(new THREE.SphereGeometry(0.46, 10, 8), M4(0, 3.3, -2.2), pink);
    fl.add(new THREE.ConeGeometry(0.2, 0.75, 8), M4(0, 3.12, -2.75, 0, 1, 1, 1, -Math.PI / 2 - 0.5), C(0x2a1a22));
    const flamingo = fl.geometry();
    const du = new Builder();
    du.add(new THREE.SphereGeometry(1.7, 14, 10), M4(0, 0.7, 0, 0, 1, 0.75, 1.15), yellow);
    du.add(new THREE.SphereGeometry(1.0, 12, 10), M4(0, 2.3, -1.0), yellow);
    du.add(new THREE.ConeGeometry(0.42, 0.9, 8), M4(0, 2.2, -2.15, 0, 1, 0.55, 1, -Math.PI / 2), C(0xff8a2a));
    du.add(new THREE.SphereGeometry(0.13, 6, 6), M4(0.42, 2.62, -1.75), plum);
    du.add(new THREE.SphereGeometry(0.13, 6, 6), M4(-0.42, 2.62, -1.75), plum);
    const duck = du.geometry();
    const spots = [[-96, 190, 0], [-20, 188, 1], [64, 184, 0], [-170, 236, 1], [130, 240, 0], [176, 176, 1], [-250, 214, 0], [0, -196, 1], [-88, -210, 0], [150, -202, 1]];
    for (const [x, z, kind] of spots) {
      if (landDist(x, z) < 4 || courseNear(x, z, 3).clear < 3) continue;
      const m = new THREE.Mesh(kind ? duck : flamingo, terrainMat);
      m.position.set(x, 0, z); m.rotation.y = rnd() * 6.28;
      m.userData = { ph: rnd() * 9, spin: (rnd() - 0.5) * 0.08 };
      m.frustumCulled = false;
      group.add(m);
      floats.push(m);
    }
  }

  // ---------- assemble ----------

  const landGeo = land.geometry(), decoGeo = deco.geometry(), farGeo = far.geometry();
  bakeLight(land, landGeo);
  bakeLight(deco, decoGeo);
  const landMesh = new THREE.Mesh(landGeo, terrainMat);
  const decoMesh = new THREE.Mesh(decoGeo, terrainMat);
  const farMesh = new THREE.Mesh(farGeo, terrainMat);
  for (const m of [landMesh, decoMesh, farMesh]) { m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
  const frondGeo = new THREE.BufferGeometry();
  frondGeo.setAttribute('position', new THREE.Float32BufferAttribute(fronds.pos, 3));
  frondGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fronds.uv, 2));
  frondGeo.setAttribute('color', new THREE.Float32BufferAttribute(fronds.col, 3));
  frondGeo.setIndex(fronds.idx);
  frondGeo.computeVertexNormals();
  // Fronds are lit from above whichever way they face.
  { const n = frondGeo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, Math.abs(n.getY(i)) * 0.6 + 0.6, n.getZ(i) * 0.3); n.needsUpdate = true; }
  const frondMesh = new THREE.Mesh(frondGeo, new THREE.MeshLambertMaterial({ map: makeFrondTexture(), alphaTest: 0.35, side: THREE.DoubleSide, vertexColors: true }));
  frondMesh.frustumCulled = false; frondMesh.matrixAutoUpdate = false;
  group.add(frondMesh);

  // ---------- collisions ----------

  // Keep a craft off the land: it slides along shores and walls. The speed
  // into the rock is removed (with a small bounce) and a little is lost.
  // Returns { hit: speed into the land, scrape: 0..1 }.
  const HULL = 1.15;
  const hitResult = { hit: 0, scrape: 0, nx: 0, nz: 0 };
  function collide(c, dt) {
    hitResult.hit = 0; hitResult.scrape = 0;
    const d = landDist(c.x, c.z);
    if (d >= HULL) return hitResult;
    let gx = landDist(c.x + 1.2, c.z) - landDist(c.x - 1.2, c.z), gz = landDist(c.x, c.z + 1.2) - landDist(c.x, c.z - 1.2);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-4) return hitResult;
    gx /= gl; gz /= gl;
    const push = Math.min(HULL - d, 12 * dt + 0.05);
    c.x += gx * push; c.z += gz * push;
    const vn = c.vx * gx + c.vz * gz;
    if (vn < 0) {
      c.vx -= gx * vn * 1.2; c.vz -= gz * vn * 1.2;
      const keep = 1 - Math.min(0.22, -vn * 0.022);
      c.vx *= keep; c.vz *= keep;
      // Turn the nose along the wall a little.
      const side = Math.sign(gx * Math.cos(c.yaw) - gz * Math.sin(c.yaw)) || 1;
      c.yawRate -= side * 0.5 * Math.min(1, -vn / 4);
    }
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 0.1) { const k = 1 - Math.min(0.4, dt * 0.5); c.vx *= k; c.vz *= k; }
    hitResult.hit = Math.max(0, -vn); hitResult.scrape = Math.min(1, sp / 15); hitResult.nx = gx; hitResult.nz = gz;
    return hitResult;
  }

  // How enclosed the water is at a sample (0 open .. 1 under an arch), for reverb and echo.
  function enclosure(idx) {
    let e = walled[idx] ? 0.45 + 0.4 * wallF[idx] : 0;
    for (const a of arches) if (cyc(a.idx, idx) * step < 7) e = 1;
    return e;
  }

  const _m = new THREE.Matrix4();
  function update(t, camPos, ocean) {
    terrainMat.uniforms.camPos.value.copy(camPos);
    for (const r of ramps) {
      r.base = ocean.heightAt(r.start.x + r.t.x * RAMP_LEN * 0.5, r.start.z + r.t.z * RAMP_LEN * 0.5, t) - 0.12;
      r.mesh.position.y = r.base;
    }
    for (let i = 0; i < buoyPos.length; i++) {
      const [x, z] = buoyPos[i];
      if (Math.abs(x - camPos.x) + Math.abs(z - camPos.z) > 280) continue;
      buoyMesh.setMatrixAt(i, _m.makeTranslation(x, ocean.heightAt(x, z, t) + 0.12, z));
    }
    buoyMesh.instanceMatrix.needsUpdate = true;
    for (const f of floats) {
      if (Math.abs(f.position.x - camPos.x) + Math.abs(f.position.z - camPos.z) > 320) continue;
      f.position.y = ocean.heightAt(f.position.x, f.position.z, t) - 0.05;
      f.rotation.y += f.userData.spin * 0.016;
      f.rotation.z = Math.sin(t * 0.9 + f.userData.ph) * 0.05;
    }
  }

  const course = { SAMPLES, length, step, pts, tans, rights, half, walled, wallF, curv, lineLat, at, nearest, idxOfCp, cpIdx };
  return {
    group, course, gates, ramps, arches, solids, rampHeight, collide, enclosure, landDist, heightAt, depthAt,
    landTexture, landBounds, update,
    stats: { landTris: land.idx.length / 3, decoTris: deco.idx.length / 3, frondTris: fronds.idx.length / 3, palms: palmSpots.length, bushes: leafSpots.length },
  };
}
