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
// position + colour + kind (0 rock, 1 plain, 2 leaves, 3 sand, 4 bark).
// Painted props take their normals from screen-space derivatives in the
// shader, so every facet is flat. Rock and sand carry averaged normals
// (smoothNormals), leaves a normal that points out of their clump, and bark
// one that points out of the trunk.

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
  // Averaged normals for the given kinds: each vertex takes the normal of
  // the faces around it, bigger faces counting for more.
  smoothNormals(kinds) {
    const P = this.pos, I = this.idx, N = this.nrm, K = this.kind, acc = new Float32Array(P.length);
    for (let t = 0; t < I.length; t += 3) {
      if (!kinds.includes(K[I[t]])) continue;
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz; acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz; acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz;
    }
    for (let v = 0; v < P.length; v += 3) {
      if (!kinds.includes(K[v / 3])) continue;
      const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]);
      if (l > 1e-9) { N[v] = acc[v] / l; N[v + 1] = acc[v + 1] / l; N[v + 2] = acc[v + 2] / l; }
    }
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

// Tileable rock relief, 256² (one tile is about 8 m of stone). Limestone
// breaks into blocks along upright joints and the blocks into chips, each a
// plane of its own tilt, so the light catches it face by face; over that,
// rounded lumps, pits in patches and fine grain. RG: slope of that surface
// (±SLOPE m per m), B: how much light gets in (a shade per block, dark down
// an open joint or a pit), A: fine grain.
const ROCK_SLOPE = 1.2;
function makeRockTexture() {
  const N = 256, NN = N * N, PX = 8.33 / N;
  let s = 1234;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Smooth fields: sums of waves that wrap at the tile's edges.
  const field = (n, kmin, kmax, pow) => {
    const ws = Array.from({ length: n }, () => {
      let kx = 0, ky = 0;
      while (Math.hypot(kx, ky) < kmin) { kx = Math.round((r() - 0.5) * 2 * kmax); ky = Math.round((r() - 0.5) * 2 * kmax); }
      return { kx, ky, ph: r() * 6.2831853, a: 1 / Math.pow(Math.hypot(kx, ky), pow) };
    });
    const f = new Float32Array(NN);
    let max = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of ws) v += Math.cos(((w.kx * x + w.ky * y) / N) * 6.2831853 + w.ph) * w.a;
      f[y * N + x] = v; if (Math.abs(v) > max) max = Math.abs(v);
    }
    for (let i = 0; i < NN; i++) f[i] /= max;
    return f;
  };
  const lumps = field(16, 2, 8, 1.0), patch = field(10, 1, 4, 0.8), grain = field(22, 28, 64, 0.3);
  // Blocks and chips: cells on a jittered grid, taller than wide.
  const cells = (nx, ny, tilt) => {
    const cw = N / nx, ch = N / ny, pts = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = r() * Math.PI * 2, m = tilt * (0.3 + 0.7 * r());
      pts.push({ x: (i + 0.15 + 0.7 * r()) * cw, y: (j + 0.15 + 0.7 * r()) * ch, sx: Math.cos(a) * m, sy: Math.sin(a) * m, shade: r(), open: r() });
    }
    return { nx, ny, cw, ch, pts };
  };
  const blocks = cells(7, 4, 0.5), chips = cells(20, 12, 0.32);
  const near = { a: null, b: null, edge: 0, across: 0 };
  const nearest = (C, x, y) => {
    const ci = Math.floor(x / C.cw), cj = Math.floor(y / C.ch);
    let d1 = Infinity, d2 = Infinity, a = null, b = null, ax = 0, ay = 0, bx = 0, by = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = ci + di, jj = cj + dj;
      const p = C.pts[(((jj % C.ny) + C.ny) % C.ny) * C.nx + (((ii % C.nx) + C.nx) % C.nx)];
      const px = p.x + Math.floor(ii / C.nx) * N, py = p.y + Math.floor(jj / C.ny) * N;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < d1) { d2 = d1; b = a; bx = ax; by = ay; d1 = d; a = p; ax = px; ay = py; }
      else if (d < d2) { d2 = d; b = p; bx = px; by = py; }
    }
    const L = Math.hypot(bx - ax, by - ay) || 1;
    near.a = a; near.b = b; near.edge = (d2 - d1) / (2 * L); near.across = Math.abs(bx - ax) / L;
    return near;
  };
  // Pits, many small and a few big, where the patch field says so.
  const pit = new Float32Array(NN);
  for (let n = 0; n < 1100; n++) {
    const x = r() * N, y = r() * N;
    if (r() > smooth((patch[(Math.floor(y) % N) * N + (Math.floor(x) % N)] - 0.05) / 0.5)) continue;
    const rad = 0.8 + 3.6 * Math.pow(r(), 2.4), depth = rad * PX * 0.45, R = Math.ceil(rad);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const q = 1 - ((i + 0.5 - (x % 1)) ** 2 + (j + 0.5 - (y % 1)) ** 2) / (rad * rad);
      if (q <= 0) continue;
      const k = ((((Math.floor(y) + j) % N) + N) % N) * N + ((((Math.floor(x) + i) % N) + N) % N);
      pit[k] = Math.max(pit[k], depth * Math.sqrt(q));
    }
  }
  // Smooth part of the surface, in metres.
  const h = new Float32Array(NN);
  for (let i = 0; i < NN; i++) h[i] = lumps[i] * 0.1 + grain[i] * 0.004 - pit[i];
  const data = new Uint8Array(NN * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let gx = (h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N]) / (2 * PX);
    let gy = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) / (2 * PX);
    const B = nearest(blocks, x + 0.5, y + 0.5);
    gx += B.a.sx; gy += B.a.sy;
    let light = 0.86 + 0.14 * B.a.shade;
    // Some joints between blocks side by side stand open: a dark crack
    // running down the rock.
    if (B.across > 0.75 && (B.a.open + B.b.open) % 1 < 0.45) light *= 1 - 0.7 * Math.exp(-((B.edge / 1.2) ** 2));
    const Cc = nearest(chips, x + 0.5, y + 0.5);
    gx += Cc.a.sx; gy += Cc.a.sy;
    light *= 0.94 + 0.06 * Cc.a.shade;
    light *= 1 - 0.38 * Math.min(1, pit[i] / (PX * 1.5));
    data[i * 4] = Math.round(clamp(gx / ROCK_SLOPE, -1, 1) * 127 + 128);
    data[i * 4 + 1] = Math.round(clamp(gy / ROCK_SLOPE, -1, 1) * 127 + 128);
    data[i * 4 + 2] = Math.round(clamp(light, 0, 1) * 255);
    data[i * 4 + 3] = Math.round((grain[i] * 0.5 + 0.5) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}

// Scanned relief for the stone and the sand (assets/stone, CC0): an upright
// cliff face for the sides of the rock, rough stone for its tops and grit for
// the beaches. Flat if they can't load.
function flatNormal() {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
export async function loadWorldTextures() {
  const loader = new THREE.TextureLoader();
  const one = (file) => loader.loadAsync(new URL('./assets/stone/' + file, import.meta.url).href).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }).catch(() => flatNormal());
  const [cliff, rough, grain] = await Promise.all(['cliff-normal.webp', 'rough-normal.webp', 'grain-normal.webp'].map(one));
  return { cliff, rough, grain };
}

// Rock, sand, leaves, bark and props, lit by the sun and sky with baked shadows.
// `like` makes the variant for the mesh that holds the plants: the same
// uniforms, plus the ragged outline of the leaf clumps (kept out of the rock's
// shader, where a discard would cost the whole landscape its early depth test).
function makeTerrainMaterial(sky, noiseMap, like = null, textures = null) {
  const T = textures || {};
  return new THREE.ShaderMaterial({
    defines: like ? { CUT_LEAVES: 1 } : {},
    uniforms: like ? like.uniforms : {
      ...sky.uniforms, noiseMap: { value: noiseMap }, rockMap: { value: makeRockTexture() }, camPos: { value: new THREE.Vector3() },
      cliffMap: { value: T.cliff || flatNormal() }, roughMap: { value: T.rough || flatNormal() }, grainMap: { value: T.grain || flatNormal() },
    },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute vec3 bake;
      varying vec3 vWorld; varying vec3 vColor; varying vec3 vBake; varying vec3 vRound;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz; vColor = color; vBake = bake; vRound = mat3(modelMatrix) * normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
      #define ROCK_SLOPE ${ROCK_SLOPE.toFixed(2)}
      uniform sampler2D noiseMap; uniform sampler2D rockMap; uniform vec3 camPos;
      uniform sampler2D cliffMap; uniform sampler2D roughMap; uniform sampler2D grainMap;
      uniform vec3 sunLight; uniform vec3 skyLight; uniform vec3 bounceLight;
      varying vec3 vWorld; varying vec3 vColor; varying vec3 vBake; varying vec3 vRound;
      void main() {
        vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 Nv = normalize(vRound);
        float kind = vBake.z;
        float isRock = 1.0 - step(0.5, kind);
        float isPlain = step(0.5, kind) * (1.0 - step(1.5, kind));
        float isLeaf = step(1.5, kind) * (1.0 - step(2.5, kind));
        float isSand = step(2.5, kind) * (1.0 - step(3.5, kind));
        float isBark = step(3.5, kind);
        // Rock is a smooth shape that keeps some of each facet's own slant,
        // so the stone still breaks along planes; sand, bark, leaf clumps
        // and the inflatables are smooth.
        vec3 N = normalize(mix(Nf, Nv, 0.6 * isRock + isSand + isBark + isLeaf + isPlain));
        vec3 Nbase = N;

        // The relief texture, laid on from the three sides and blended.
        vec3 w = N * N; w *= w; w /= (w.x + w.y + w.z);
        vec4 tx = texture2D(rockMap, vWorld.zy * 0.12), ty = texture2D(rockMap, vWorld.xz * 0.12), tz = texture2D(rockMap, vWorld.xy * 0.12);
        vec4 n = tx * w.x + ty * w.y + tz * w.z;   // b: light reaching in, a: grain
        vec3 bump = vec3(0.0, tx.g - 0.5, tx.r - 0.5) * w.x + vec3(ty.r - 0.5, 0.0, ty.g - 0.5) * w.y + vec3(tz.r - 0.5, tz.g - 0.5, 0.0) * w.z;
        vec4 big = texture2D(noiseMap, vWorld.xz * 0.013 + vWorld.y * 0.017);
        float steep = 1.0 - smoothstep(0.35, 0.8, Nbase.y);
        // How broken the stone is here: it changes over tens of metres, so
        // the relief never repeats the same way twice.
        float rough = 0.55 + 0.45 * smoothstep(0.3, 0.7, big.g);

        // Limestone: broken faces, here and there a bed a couple of metres
        // thick with a ledge under it, open joints and pits dark inside;
        // rain leaves dark streaks down the steep faces and rust stains
        // here and there; plants take every ledge; and at the water there
        // is a wet band with a pale tide line.
        float sy = vWorld.y * 0.42 + big.r * 2.0 + dot(vWorld.xz, vec2(0.019, 0.013));
        float bed = fract(sy);
        float lower = smoothstep(0.95, 1.0, bed), upper = 1.0 - smoothstep(0.0, 0.05, bed);
        float beds = steep * smoothstep(0.45, 0.7, big.b) * smoothstep(0.35, 0.6, n.a) * isRock;
        N = normalize(N - bump * (2.0 * ROCK_SLOPE) * rough * isRock + vec3(0.0, (lower - upper) * 0.6 * beds, 0.0));
        // Scanned relief up close: an upright cliff face on the sides of the
        // rock, rough stone on its tops, grit in the sand. Cracks and hollows
        // in it are darker.
        // Two sizes on the sides: the cliff's runnels and ribs, about a
        // metre and a half to a tile, and rough grit on them, under a metre.
        float camDist = length(camPos - vWorld);
        float nearK = 1.0 - smoothstep(45.0, 150.0, camDist), fineK = 1.0 - smoothstep(12.0, 45.0, camDist);
        vec3 c1 = texture2D(cliffMap, vWorld.zy * 0.55).xyz * 2.0 - 1.0;
        vec3 c3 = texture2D(cliffMap, vWorld.xy * 0.55 + 0.43).xyz * 2.0 - 1.0;
        vec3 f1 = texture2D(roughMap, vWorld.zy * 1.25 + 0.21).xyz * 2.0 - 1.0;
        vec3 f3 = texture2D(roughMap, vWorld.xy * 1.25 + 0.67).xyz * 2.0 - 1.0;
        vec3 c2 = texture2D(roughMap, vWorld.xz * 0.6).xyz * 2.0 - 1.0;
        f1 = mix(vec3(0.0, 0.0, 1.0), f1, fineK); f3 = mix(vec3(0.0, 0.0, 1.0), f3, fineK);
        vec3 dn = vec3(0.0, c1.y + f1.y * 0.7, c1.x + f1.x * 0.7) * w.x + vec3(c2.x, 0.0, c2.y) * w.y + vec3(c3.x + f3.x * 0.7, c3.y + f3.y * 0.7, 0.0) * w.z;
        float cav = mix(1.0, smoothstep(0.45, 0.97, (c1.z * f1.z) * w.x + c2.z * w.y + (c3.z * f3.z) * w.z), nearK);
        vec3 gr = texture2D(grainMap, vWorld.xz * 0.7).xyz * 2.0 - 1.0;
        N = normalize(N + dn * (1.15 * nearK * isRock) + vec3(gr.x, 0.0, gr.y) * (0.5 * nearK * isSand));

        vec3 rock = vColor * mix(vec3(0.86, 0.89, 0.95), vec3(1.12, 1.03, 0.90), big.r);
        rock *= 1.0 + (fract(sin(floor(sy) * 12.9898) * 43758.5453) - 0.5) * 0.14 * steep;
        rock *= 1.0 - 0.3 * (lower + upper) * beds;
        rock *= mix(1.0, 0.3 + 0.7 * n.b, rough) * (0.9 + 0.2 * n.a);
        rock *= 0.42 + 0.64 * cav;
        // Rain runs down the runnels of the cliff and stains them.
        rock *= 1.0 - 0.28 * smoothstep(0.18, 0.55, abs(c1.x) * w.x + abs(c3.x) * w.z) * nearK * steep;
        float streak = texture2D(noiseMap, vec2(dot(vWorld.xz, vec2(0.7, 0.71)) * 0.075, vWorld.y * 0.011)).b;
        rock *= mix(1.0, 0.52 + 0.55 * streak, steep * (0.35 + 0.65 * big.g));
        rock = mix(rock, rock * vec3(1.14, 0.88, 0.64), smoothstep(0.62, 0.9, big.b) * 0.55);
        float veg = smoothstep(0.45, 0.75, Nbase.y + (n.a - 0.5) * 0.5) * smoothstep(2.4, 5.0, vWorld.y);
        veg = max(veg, smoothstep(0.55, 0.8, big.r * 0.6 + n.a * 0.7) * smoothstep(5.0, 10.0, vWorld.y) * 0.5 * (1.0 - steep * 0.5));
        rock = mix(rock, vec3(0.085, 0.19, 0.05) * (0.5 + 0.9 * n.b), veg);
        float wet = 1.0 - smoothstep(0.2, 1.0, vWorld.y + (n.a - 0.5) * 0.5);
        rock = mix(rock, rock * vec3(0.36, 0.37, 0.36), wet);
        float tide = exp(-pow((vWorld.y - 1.15 - (big.g - 0.5) * 0.4) / 0.2, 2.0));
        rock = mix(rock, vec3(0.80, 0.77, 0.66), tide * 0.35 * steep);

        vec3 sand = vColor * (0.9 + 0.2 * n.a) * (0.96 + 0.08 * sin(vWorld.x * 2.1 + big.r * 6.0));
        sand *= mix(1.0, 0.8 + 0.24 * smoothstep(0.55, 1.0, gr.z), nearK);
        sand = mix(sand, sand * vec3(0.72, 0.70, 0.64), 1.0 - smoothstep(0.1, 0.5, vWorld.y + (n.a - 0.5) * 0.2));
        // Bark: ring scars up the trunk.
        float ring = smoothstep(0.0, 0.35, abs(fract(vWorld.y * 2.6 + n.a * 0.3) - 0.5) * 2.0);
        vec3 bark = vColor * (0.55 + 0.45 * ring) * (0.8 + 0.4 * n.a);
        // Leaf clusters (only the plants' mesh has leaves), laid on from
        // the three sides of the clump's round shape.
        #ifdef CUT_LEAVES
        vec3 lw = Nv * Nv; lw *= lw; lw /= (lw.x + lw.y + lw.z);
        vec4 cl = texture2D(noiseMap, vWorld.zy * 0.31 + 0.37) * lw.x + texture2D(noiseMap, vWorld.xz * 0.31 + 0.37) * lw.y + texture2D(noiseMap, vWorld.xy * 0.31 + 0.37) * lw.z;
        // A clump's outline is ragged: toward its edge the gaps between the
        // leaves show what is behind.
        if (isLeaf > 0.5 && cl.r * 0.45 + cl.g * 0.35 + cl.a * 0.2 > 0.12 + abs(dot(Nv, normalize(camPos - vWorld))) * 1.15) discard;
        #else
        vec4 cl = vec4(0.5);
        #endif
        float clump = cl.g;
        vec3 leaf = vColor * mix(vec3(0.42, 0.55, 0.40), vec3(1.05, 1.12, 0.72), clump) * (0.55 + 0.8 * n.a);
        // Shadowed gaps between the clusters.
        leaf *= mix(0.56, 1.1, smoothstep(0.28, 0.62, cl.g * 0.65 + cl.a * 0.35));
        vec3 albedo = vColor;
        albedo = mix(albedo, rock, isRock);
        albedo = mix(albedo, leaf, isLeaf);
        albedo = mix(albedo, sand, isSand);
        albedo = mix(albedo, bark, isBark);

        float ndl = max(dot(N, sunDir), 0.0);
        // Leaves: a round clump whose clusters catch the light this way and
        // that, hardly a facet. Painted props: soft, like inflatables.
        vec3 Nl = normalize(Nv + vec3(0.0, 0.3, 0.0) + (vec3(cl.r, cl.a, cl.g) - 0.5) * 1.1);
        float ndlLeaf = max(dot(Nl, sunDir), 0.0) * 0.8 + 0.2;
        ndl = mix(ndl, ndlLeaf, isLeaf);
        // Inflatables: wrapped light, as their skin is a little translucent.
        ndl = mix(ndl, max(dot(N, sunDir) * 0.75 + 0.25, 0.0), isPlain);
        vec3 light = sunLight * ndl * vBake.x
          + skyLight * (0.6 + 0.4 * N.y) * vBake.y
          + bounceLight * (0.5 - 0.5 * N.y) * (0.35 + 0.65 * vBake.x);
        // Light thrown back into the shade by the sunlit rock and water. It
        // comes from the side away from the sun, so the broken faces of a
        // wall in shade still show.
        float fill = max(dot(N, normalize(vec3(-sunDir.x, 0.35, -sunDir.z))), 0.0);
        light += vec3(0.24, 0.15, 0.12) * (1.0 - vBake.x) * (0.55 + 0.45 * vBake.y) * mix(1.0, 0.25 + 1.2 * fill, isRock) * (1.0 - isPlain);
        // Light off the water on the lower rock.
        light += vec3(0.05, 0.06, 0.12) * exp(-max(vWorld.y, 0.0) / 5.0) * (0.8 - 0.5 * N.y) * vBake.y * (1.0 - isPlain);
        // Paint keeps its colour: a softer light, never blown out.
        light = mix(light, vec3(0.2) + light * 0.62, isPlain);
        vec3 col = albedo * light;
        // Glossy PVC: the sky in it at grazing angles and a glint of the sun.
        vec3 V = normalize(camPos - vWorld);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        float glint = pow(max(dot(N, normalize(sunDir + V)), 0.0), 90.0) * 2.2;
        col += (skyColor(reflect(-V, N)) * fres * 0.55 + sunLight * glint * vBake.x * 0.6) * isPlain;
        col = applyHaze(col, length(camPos - vWorld), vWorld - camPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// One palm frond, base at the top: a bare stalk, then thin leaflets that
// slant toward the tip, long in the middle and short at the end, with gaps
// between them.
function makeFrondTexture() {
  const W = 256, H = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  let s = 77;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const COUNT = 54;
  for (let i = 0; i < COUNT; i++) {
    const f = i / (COUNT - 1), y = 50 + f * 438;
    const len = 122 * Math.pow(Math.sin(Math.min(1, f * 0.9 + 0.08) * Math.PI), 0.55) * (0.86 + 0.14 * r());
    for (const side of [-1, 1]) {
      const l = len * (0.92 + 0.08 * r()), fall = l * (0.42 + 0.1 * r());
      const hue = 82 + r() * 26, light = 20 + r() * 13;
      const grad = g.createLinearGradient(W / 2, y, W / 2 + side * l, y + fall);
      grad.addColorStop(0, `hsl(${hue}, 58%, ${light * 0.8}%)`); grad.addColorStop(0.6, `hsl(${hue}, 60%, ${light}%)`); grad.addColorStop(1, `hsl(${hue - 14}, 62%, ${light + 9}%)`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(W / 2, y - 3.6);
      g.quadraticCurveTo(W / 2 + side * l * 0.55, y + fall * 0.42 - 3.0, W / 2 + side * l, y + fall);
      g.quadraticCurveTo(W / 2 + side * l * 0.5, y + fall * 0.5 + 3.4, W / 2, y + 4.4);
      g.closePath(); g.fill();
    }
  }
  // The stalk and midrib, thick at the base.
  const rib = g.createLinearGradient(0, 0, 0, H);
  rib.addColorStop(0, '#8f8a4a'); rib.addColorStop(0.3, '#a3ad55'); rib.addColorStop(1, '#8fae4c');
  g.fillStyle = rib;
  g.beginPath(); g.moveTo(W / 2 - 7, 0); g.lineTo(W / 2 + 7, 0); g.lineTo(W / 2 + 1.5, H - 14); g.lineTo(W / 2 - 1.5, H - 14); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Fronds: leaves that let the sun through (lit from behind they glow
// yellow-green), in the same light and haze as the rest of the world.
function makeFrondMaterial(sky, camPos) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...sky.uniforms, map: { value: makeFrondTexture() }, camPos },
    vertexShader: /* glsl */`
      attribute vec3 color;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN; varying vec3 vTint;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vUv = uv; vTint = color; vN = mat3(modelMatrix) * normal; vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
      uniform sampler2D map; uniform vec3 camPos;
      uniform vec3 sunLight; uniform vec3 skyLight; uniform vec3 bounceLight;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vN; varying vec3 vTint;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.3) discard;
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float ndl = dot(N, sunDir);
        vec3 light = sunLight * (max(ndl, 0.0) * 0.85 + 0.08)
          + sunLight * vec3(0.85, 1.0, 0.30) * max(-ndl, 0.0) * 0.6
          + skyLight * (0.6 + 0.4 * N.y)
          + bounceLight * (0.5 - 0.5 * N.y);
        vec3 col = t.rgb * vTint * light;
        col = applyHaze(col, length(camPos - vWorld), vWorld - camPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
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

export function buildWorld({ sky, font = 'system-ui, sans-serif', textures = null }) {
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
  const rockA = C(0x9a968d), rockB = C(0xbbb09a), rockTop = C(0x6f7f4a);
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
      const FACE = 14, ROWS = 5 + FACE + 6; // waterline, the face, the top
      // At the canal's mouths the wall dips under the sea over its last
      // columns (about 7 m), so its end is never an open cut you can see
      // into (Ilia, Nov 17: no holes in the landscape).
      const DIP = 5;
      const base = land.count;
      cols.forEach((k, c) => {
        const p = pts[k], r = rights[k], e = wallF[k];
        const dip = smooth(1 - Math.min(c, cols.length - 1 - c) / DIP);
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
        for (let j = 1; j <= FACE; j++) {
          const f = j / FACE;
          rows.push([0.1 + 4.2 * Math.pow(f, 2.3) + 0.4 * Math.sin(f * 8 + ph), lerp(y4, T, Math.pow(f, 0.85))]);
        }
        const topOff = rows[rows.length - 1][0];
        rows.push([lerp(topOff, room, 0.3), T * (0.97 + 0.1 * noise2(c * 0.21, side * 5))]);
        rows.push([lerp(topOff, room, 0.55), T * (0.9 + 0.16 * noise2(c * 0.17, side * 9))]);
        rows.push([lerp(topOff, room, 0.8), T * 0.66]);
        rows.push([lerp(topOff, room, 0.95), T * 0.3 + 0.3]);
        rows.push([room + 0.8, 0.6]);
        rows.push([room + 2.4, -3.5]);
        // Where the wall is low (towards the mouths) its rows lie close
        // together: the bulges are smaller there, the face only climbs, and
        // the top and the back stay outside the face, so the rock never folds
        // through itself (a fold shows as a slit of sky).
        const calm = clamp((T - 1.3) / 6, 0.15, 1);
        let faceOut = -Infinity, lastOut = -Infinity, lastY = -Infinity;
        for (let j = 0; j < ROWS; j++) {
          const [off, y0] = rows[j];
          let x = p.x + r.x * side * (w0 + off), z = p.z + r.z * side * (w0 + off), y = y0;
          // Bulges, vertical ribs and roughness. At the water the wall only
          // moves away from the channel, so the riding width stays clear.
          let d = (fbm3(x * 0.1, y * 0.1, z * 0.1, 3) - 0.5) * 3.0;
          if (j >= 5 && j < 5 + FACE) d += (noise2(c * 0.33 + side * 11, y * 0.05) - 0.5) * 1.5 + (fbm3(x * 0.34, y * 0.34, z * 0.34, 2) - 0.5) * 0.9;
          if (j <= 4) d = Math.max(0, d) * 0.5;
          if (j >= ROWS - 2) d = 0;
          let o = w0 + off + d * calm;
          if (j >= 5 && j < 5 + FACE) faceOut = Math.max(faceOut, o);
          else if (j >= 5 + FACE) o = Math.max(o, faceOut + 0.2, lastOut + 0.1);
          lastOut = o;
          x = p.x + r.x * side * o; z = p.z + r.z * side * o;
          if (j >= 5 && j < ROWS - 2) y += (noise3(x * 0.23, y * 0.23, z * 0.23) - 0.5) * Math.min(1.4, T * 0.12);
          if (j >= 5 && j < 5 + FACE) y = Math.max(y, lastY + 0.02);
          lastY = y;
          y = lerp(y, -2.4, dip);
          const col = rockColor(x, y, z);
          if (j >= 5 + FACE && j <= 7 + FACE) col.lerp(rockTop, 0.5);
          land.vert(x, y, z, col, 0);
          // (Bushes on a dipped end are drawn by nobody, but still drawn
          // lots for, so the rest of the island grows the same.)
          if (j >= 4 + FACE && j <= 6 + FACE && T > 4 && rnd() < 0.3) leafSpots.push([x, y, z, 1.8 + rnd() * 2.4, dip > 0]);
          if (j === 7 + FACE && T > 6 && rnd() < 0.15) leafSpots.push([x, y, z, 1.5 + rnd() * 1.5, dip > 0]);
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
    const SEG0 = segs || Math.max(20, Math.min(64, Math.round(r * 2.1)));
    const SEG = Math.round(SEG0 * 1.35);
    // Karst: undercut where the sea eats it, near-vertical sides almost to
    // the top, then a rounded crown.
    const prof = [ // [height (m below 3.2, fraction of h above), radius factor]
      [-4, 1.14], [-0.4, 1.03], [0.75, 1.01], [1.9, 1.09], [3.2, 1.07],
      [0.13, 1.10], [0.22, 1.12], [0.32, 1.10], [0.42, 1.08], [0.52, 1.05], [0.62, 1.02], [0.71, 0.97], [0.79, 0.90],
      [0.86, 0.79], [0.91, 0.64], [0.95, 0.46], [0.98, 0.25], [1.0, 0.0],
    ];
    // A row between each two on the face, so its breaks are finer.
    for (let j = 11; j >= 5; j--) prof.splice(j + 1, 0, [(prof[j][0] + prof[j + 1][0]) / 2, (prof[j][1] + prof[j + 1][1]) / 2]);
    const ROWS = prof.length, base = land.count, ph = rnd() * 50;
    const leafK = SEG0 / SEG; // as many plants as before on the finer mesh
    for (let k = 0; k < SEG; k++) {
      const th = (k / SEG) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th) * squash;
      const lobe = 1 + 0.2 * Math.sin(th * 2 + ph) + 0.12 * Math.sin(th * 5 + ph * 2);
      for (let j = 0; j < ROWS; j++) {
        const rr = r * prof[j][1] * lobe;
        let px = x + cs * rr, pz = z + sn * rr, y = j < 5 ? prof[j][0] : Math.max(3.4, prof[j][0] * h);
        if (j >= 2 && j < ROWS - 1) {
          // Big bulges, vertical ribs, and (above the water) a break at
          // every point, so the faces are split like weathered stone.
          const d = (fbm3(px * 0.09 + ph, y * 0.09, pz * 0.09, 3) - 0.5) * Math.min(4.5, r * 0.36)
            + (j >= 5 ? (noise2(k * 0.9 + ph, y * 0.05) - 0.5) * Math.min(2.4, r * 0.16) + (h3(k, j, 17) - 0.5) * Math.min(1.3, r * 0.09) : 0);
          const dd = j <= 4 ? Math.max(0, d) * 0.5 : d;
          px += cs * dd; pz += sn * dd;
          if (j >= 5) y += (noise3(px * 0.2, y * 0.2, pz * 0.2) - 0.5) * Math.min(2.0, h * 0.06);
        }
        const col = rockColor(px, y, pz);
        if (j >= ROWS - 6) col.lerp(rockTop, 0.5);
        land.vert(px, y, pz, col, 0);
        if (j >= ROWS - 6 && j < ROWS - 1 && rnd() < leaves * leafK) leafSpots.push([px, y, pz, Math.min(4.2, 1.4 + r * 0.07 + rnd() * 1.8)]);
        if (j >= 6 && j < ROWS - 6 && rnd() < leaves * 0.11 * leafK * 0.5) leafSpots.push([px, y, pz, 1.2 + rnd()]);
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
    const U = 48, V = 18, base = deco.count, ph = rnd() * 20;
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
        const d = (fbm3(x * 0.16 + ph, y * 0.16, z * 0.16, 3) - 0.5) * 2.4 + (fbm3(x * 0.45, y * 0.45 + ph, z * 0.45, 2) - 0.5) * 0.7;
        if (ro > 0.4) { x += r.x * nx * d + t.x * Math.sin(b) * d * 0.6; z += r.z * nx * d + t.z * Math.sin(b) * d * 0.6; y += ny * Math.abs(d) * 0.8; }
        deco.vert(x, y, z, rockColor(x, y, z), 0);
        if (ny > 0.7 && ro > thick * 0.8 && rnd() < 0.5 * (22 * 10) / (U * V)) leafSpots.push([x, y + 0.3, z, 1.3 + rnd() * 1.3]);
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
    for (let d = start; d < 110; d += d < 12 ? 1 : d < 60 ? 2 : 3) {
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
      if (d <= 0 || d > 100) { if (d <= 0) { skyW[i] = 0.6; sunW[i] = 0.3; } continue; }
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
        // Straight for 30 m before a ramp's foot, so riders (and the bills)
        // line up with its middle, clear of its side tubes.
        for (const r of rampIdx) {
          let d = (r - i) % SAMPLES;
          if (d < 0) d += SAMPLES;
          if (d > SAMPLES / 2) d -= SAMPLES; // positive: the ramp is ahead
          env = Math.min(env, smooth((Math.abs(d) * step - (d > 0 ? 34 : 16)) / 30));
        }
        // And through the middle of each arch.
        for (const g of gateIdx) env = Math.min(env, smooth((cyc(i, g) * step - 8) / 30));
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

  // Bushes: squashed, lumpy icosahedra in a few greens. The bigger ones
  // within sight of the course are subdivided once, so their outline is a
  // lumpy clump rather than a polygon. The face corners of an icosahedron
  // share its points (12, or 42 subdivided): the shape is rebuilt indexed on
  // those points, and each point gets one jitter, so a bush stays a closed
  // clump instead of breaking into shards.
  {
    const shapes = [0, 1].map((detail) => {
      const ico = new THREE.IcosahedronGeometry(1, detail);
      const index = [], seen = [], q = ico.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < q.count; i++) {
        v.fromBufferAttribute(q, i);
        let k = seen.findIndex((o) => o.distanceToSquared(v) < 1e-6);
        if (k < 0) { k = seen.length; seen.push(v.clone()); }
        index.push(k);
      }
      const geo = new THREE.BufferGeometry().setFromPoints(seen);
      geo.setIndex(index);
      return { geo, jitter: new Float32Array(seen.length) };
    });
    const greens = [C(0x2a5f20), C(0x357a28), C(0x4a8a2e), C(0x23501f), C(0x5a8f33)];
    const hill = lagoonIsle;
    // The lagoon island's jungle, between the beach and the rock.
    for (let i = 0; i < 150; i++) {
      const th = rnd() * Math.PI * 2, rr = hill.shore(th) * (0.42 + rnd() * 0.3);
      const x = hill.x + Math.cos(th) * rr, z = hill.z + Math.sin(th) * rr;
      leafSpots.push([x, Math.max(1.6, heightAt(x, z)) + 0.6, z, 2.2 + rnd() * 2.6]);
    }
    for (const [x, y, z, s, sunk] of leafSpots) {
      const g = greens[Math.floor(rnd() * greens.length)];
      const m = M4(x, y + s * 0.25, z, rnd() * 6, s * (0.9 + rnd() * 0.5), s * (0.6 + rnd() * 0.3), s * (0.9 + rnd() * 0.5), rnd() * 0.5, rnd() * 0.5);
      const sh = shapes[s >= 2.2 && courseNear(x, z, 2).dist < 40 ? 1 : 0];
      for (let i = 0; i < sh.jitter.length; i++) sh.jitter[i] = 0.72 + 0.56 * rnd();
      if (sunk) continue;
      deco.add(sh.geo, m, g, 2, (v, c, i) => { v.multiplyScalar(sh.jitter[i]); c.multiplyScalar(0.75 + 0.5 * (v.y * 0.5 + 0.5)); });
    }
  }

  // Palms: a curved trunk with ring scars, swollen at the foot; a crown of
  // arching fronds, each folded along its midrib so the leaflets hang (young
  // ones stand up in the middle, old ones hang down); a few coconuts.
  const fronds = { pos: [], uv: [], col: [], idx: [] };
  {
    const trunkA = C(0xa08a6c), trunkB = C(0x7d6950), nut = C(0x4c5a26);
    const nutGeo = new THREE.IcosahedronGeometry(1, 0), tone = new THREE.Color();
    for (const [x, y0, z, dir, s] of palmSpots) {
      const hgt = (7.5 + rnd() * 5) * s, lean = (1.0 + rnd() * 2.6) * s, ldx = Math.cos(dir), ldz = Math.sin(dir);
      const y = Math.max(0.6, heightAt(x, z) - 0.2, y0 - 0.6);
      const RINGS = 9, SIDES = 7, base = deco.count;
      let tx = x, ty = y + hgt, tz = z;
      tone.copy(trunkA).lerp(trunkB, rnd());
      for (let j = 0; j < RINGS; j++) {
        const f = j / (RINGS - 1);
        const rad = (0.2 + 0.17 * Math.exp(-f * 9) - 0.055 * f + 0.05 * smooth((f - 0.86) / 0.14)) * s;
        const cx = x + ldx * lean * f * f, cz = z + ldz * lean * f * f, cy = y - 0.3 + (hgt + 0.3) * f;
        if (j === RINGS - 1) { tx = cx; ty = cy; tz = cz; }
        for (let k = 0; k < SIDES; k++) {
          const a = (k / SIDES) * Math.PI * 2;
          deco.vert(cx + Math.cos(a) * rad, cy, cz + Math.sin(a) * rad, tone, 4, Math.cos(a), 0.15, Math.sin(a));
        }
      }
      // Rings were emitted row by row here: columns are rings going up.
      for (let j = 0; j < RINGS - 1; j++) for (let k = 0; k < SIDES; k++) {
        const a = base + j * SIDES + k, b = base + (j + 1) * SIDES + k, c = base + j * SIDES + (k + 1) % SIDES, d = base + (j + 1) * SIDES + (k + 1) % SIDES;
        deco.idx.push(a, b, c, b, d, c);
      }
      for (let i = 0; i < 3; i++) {
        const a = rnd() * 6.28, rr = 0.3 * s;
        deco.add(nutGeo, M4(tx + Math.cos(a) * rr, ty - 0.28 * s, tz + Math.sin(a) * rr, rnd() * 3, 0.19 * s, 0.23 * s, 0.19 * s), nut, 1);
      }
      // Four young fronds standing in the middle, eight around them, three
      // old ones hanging: each tier spread evenly round the crown.
      const SEGS = 6, plan = [];
      for (const [tier, count] of [[0, 4], [1, 8], [2, 3]]) {
        const a0 = rnd() * 6.28;
        for (let k = 0; k < count; k++) plan.push([tier, a0 + (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.5]);
      }
      for (const [tier, az] of plan) {
        // Which way it leaves the crown, and how far it arches over.
        const up = tier === 0 ? 1.0 + rnd() * 0.3 : tier === 1 ? 0.25 + rnd() * 0.45 : -0.25 - rnd() * 0.3;
        const bend = tier === 0 ? 1.0 + rnd() * 0.4 : tier === 1 ? 1.15 + rnd() * 0.45 : 0.9 + rnd() * 0.3;
        const len = (4.4 + rnd() * 1.6) * s * (tier === 0 ? 0.8 : 1), wid = (1.5 + rnd() * 0.3) * s;
        const b0 = fronds.pos.length / 3;
        const tint = (tier === 2 ? 0.7 : 0.85) + rnd() * 0.3, warm = tier === 2 ? 1.12 : 1;
        const dx = Math.cos(az), dz = Math.sin(az), sx = -dz, sz = dx;
        let out = 0.12 * s, rise = 0;
        for (let k = 0; k <= SEGS; k++) {
          const f = k / SEGS, th = up - bend * Math.pow(f, 1.3);
          if (k > 0) { const thm = up - bend * Math.pow(f - 0.5 / SEGS, 1.3); out += Math.cos(thm) * len / SEGS; rise += Math.sin(thm) * len / SEGS; }
          const px = tx + dx * out, py = ty + rise, pz = tz + dz * out;
          const w = wid * 0.5;
          // The leaflets hang from the midrib: both edges sit below it,
          // measured across the frond's own "up".
          const ux = -dx * Math.sin(th), uy = Math.cos(th), uz = -dz * Math.sin(th), hang = 0.5 * w;
          fronds.pos.push(px - sx * w - ux * hang, py - uy * hang, pz - sz * w - uz * hang, px, py, pz, px + sx * w - ux * hang, py - uy * hang, pz + sz * w - uz * hang);
          fronds.uv.push(0, 1 - f, 0.5, 1 - f, 1, 1 - f);
          for (let c = 0; c < 3; c++) fronds.col.push(tint * warm, tint, tint * (2 - warm) * 0.9);
          if (k < SEGS) { const a = b0 + k * 3; fronds.idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); }
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
    const SEG = 72, RAD = 12; // six rings to a stripe
    deco.add(new THREE.TubeGeometry(path, SEG, tube, RAD, false), null, white, 1, (v, c, i) => {
      c.copy(stripes[(Math.floor(i / (RAD + 1) / 6) + g) % (g === 0 ? 3 : 2)]);
    });
    for (const s of [-1, 1]) {
      deco.add(new THREE.CylinderGeometry(tube * 2.1, tube * 2.4, 1.5, 28), M4(p.x + r.x * s * hw, 0.25, p.z + r.z * s * hw), s < 0 ? pink : yellow);
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
    deco.add(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), M4(x, y + 1.25, z), cream);
    deco.add(new THREE.ConeGeometry(1.7, 0.7, 30), M4(x, y + 2.6, z, rnd() * 3), white, 1, (v, c, i) => { c.copy(Math.floor(((Math.atan2(v.z, v.x) / Math.PI + 1) * 5)) % 2 ? a : b); });
  }
  function board(x, z, col) {
    const y = Math.max(0.5, heightAt(x, z));
    deco.add(new THREE.SphereGeometry(1, 18, 10), M4(x, y + 1.0, z, rnd() * 3, 0.28, 1.15, 0.06, 0, 0.12), col);
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
    deco.add(new THREE.CylinderGeometry(2.2, 2.2, 2.4, 20), M4(x, y + 1.2, z), C(0xb98a56));
    deco.add(new THREE.ConeGeometry(3.6, 2.4, 20), M4(x, y + 3.5, z), C(0xd9b86a));
    deco.add(new THREE.BoxGeometry(3.4, 0.9, 0.12), M4(x, y + 1.7, z - 2.3), pink);
  }
  // Hot-air balloons over the lagoon.
  for (const [x, y, z, s, a, b] of [[40, 95, 60, 1, pink, yellow], [-250, 130, -260, 1.3, yellow, cream], [330, 110, -40, 1.1, pink, cream]]) {
    deco.add(new THREE.SphereGeometry(9 * s, 30, 18), M4(x, y, z, 0, 1, 1.15, 1), white, 1, (v, c) => {
      c.copy(Math.floor((Math.atan2(v.z, v.x) / Math.PI + 1) * 6) % 2 ? a : b);
      if (v.y < 0) { const k = 1 + (v.y / (9 * s)) * 0.55; v.x *= k; v.z *= k; }
    });
    deco.add(new THREE.BoxGeometry(2.2 * s, 1.6 * s, 2.2 * s), M4(x, y - 15 * s, z), C(0x8a5a34));
  }

  // Ramps: inflatable wedges, striped, bobbing on the water.
  const ramps = [];
  const rampBuilder = new Builder();
  {
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const f = i / N, zz = -f * RAMP_LEN, y = 0.05 + f * (RAMP_LIP - 0.05);
      const c = Math.floor(i / 2) % 2 ? pink : yellow;
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
      const tube = new THREE.CylinderGeometry(0.42, 0.42, Math.hypot(RAMP_LEN, RAMP_LIP) + 0.4, 20);
      rampBuilder.add(tube, M4(s * (RAMP_W / 2 + 0.2), RAMP_LIP / 2 + 0.1, -RAMP_LEN / 2, 0, 1, 1, 1, -Math.PI / 2 + Math.atan2(RAMP_LIP, RAMP_LEN)), cream);
    }
  }
  const terrainMat = makeTerrainMaterial(sky, makeNoiseTexture(), null, textures);
  rampBuilder.smoothNormals([1]);
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
  const buoyGeo = new THREE.SphereGeometry(0.55, 20, 14);
  const buoyMesh = new THREE.InstancedMesh(buoyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 }), buoyPos.length);
  buoyPos.forEach((b, i) => buoyMesh.setColorAt(i, b[2] < 0 ? pink : yellow));
  buoyMesh.frustumCulled = false;
  group.add(buoyMesh);

  // Pool floats drifting in the lagoon: flamingos and ducks.
  const floats = [];
  {
    const fl = new Builder();
    fl.add(new THREE.TorusGeometry(1.5, 0.55, 16, 44), M4(0, 0.35, 0, 0, 1, 1, 1, Math.PI / 2), pink);
    const neck = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.4, -1.5), new THREE.Vector3(0, 1.8, -1.9), new THREE.Vector3(0, 3.0, -1.5), new THREE.Vector3(0, 3.3, -2.1)]);
    fl.add(new THREE.TubeGeometry(neck, 28, 0.3, 14, false), null, pink);
    fl.add(new THREE.SphereGeometry(0.46, 18, 12), M4(0, 3.3, -2.2), pink);
    fl.add(new THREE.ConeGeometry(0.2, 0.75, 14), M4(0, 3.12, -2.75, 0, 1, 1, 1, -Math.PI / 2 - 0.5), C(0x2a1a22));
    fl.smoothNormals([1]);
    const flamingo = fl.geometry();
    const du = new Builder();
    du.add(new THREE.SphereGeometry(1.7, 26, 16), M4(0, 0.7, 0, 0, 1, 0.75, 1.15), yellow);
    du.add(new THREE.SphereGeometry(1.0, 22, 14), M4(0, 2.3, -1.0), yellow);
    du.add(new THREE.ConeGeometry(0.42, 0.9, 14), M4(0, 2.2, -2.15, 0, 1, 0.55, 1, -Math.PI / 2), C(0xff8a2a));
    du.add(new THREE.SphereGeometry(0.13, 10, 8), M4(0.42, 2.62, -1.75), plum);
    du.add(new THREE.SphereGeometry(0.13, 10, 8), M4(-0.42, 2.62, -1.75), plum);
    du.smoothNormals([1]);
    const duck = du.geometry();
    const spots = [[-96, 190, 0], [-20, 188, 1], [64, 184, 0], [-170, 236, 1], [130, 240, 0], [176, 176, 1], [-250, 214, 0], [0, -196, 1], [-88, -210, 0], [150, -202, 1]];
    for (const [x, z, kind] of spots) {
      if (landDist(x, z) < 4 || courseNear(x, z, 3).clear < 3) continue;
      const m = new THREE.Mesh(kind ? duck : flamingo, terrainMat);
      m.position.set(x, 0, z); m.rotation.y = rnd() * 6.28;
      const ph = rnd() * 9, spin = (rnd() - 0.5) * 0.08;
      m.userData = { ph, spin, base: spin };
      m.frustumCulled = false;
      group.add(m);
      floats.push(m);
    }
  }

  // ---------- things in the water you can hit ----------

  // Seen from above each is a disc, with a top that a jump can clear (a
  // ramp's side tube is a long one: a capsule, so a hull slides along it).
  // Buoys and pool floats are moored: a hull knocks them aside and they swing
  // back on their lines. The gates' floats and the ramps' side tubes are fixed.
  const things = [];
  const TH = 12, thingCells = new Map();
  function addThing(o) {
    Object.assign(o, { ox: 0, oz: 0, vx: 0, vz: 0, dip: 0, under: 0 });
    things.push(o);
    const key = Math.floor(o.x / TH) + ',' + Math.floor(o.z / TH);
    if (!thingCells.has(key)) thingCells.set(key, []);
    thingCells.get(key).push(o);
  }
  buoyPos.forEach(([x, z], i) => addThing({ kind: 'buoy', x, z, r: 0.55, top: 0.75, mass: 80, moor: 2.4, i }));
  gates.forEach((g, n) => {
    const r = (n === 0 ? 0.62 : 0.42) * 2.4;
    for (const s of [-1, 1]) addThing({ kind: 'gate', x: g.pos.x + g.right.x * s * g.half, z: g.pos.z + g.right.z * s * g.half, r, top: 1.0, mass: Infinity });
  });
  for (const f of floats) addThing({ kind: 'float', x: f.position.x, z: f.position.z, r: 1.95, top: 1.2, mass: 60, moor: 5, mesh: f });
  for (const rp of ramps) {
    for (const s of [-1, 1]) {
      // From just before the ramp's foot to just past its lip; its top rises with the deck.
      const a0 = -0.2, a1 = RAMP_LEN + 0.2, side = s * (RAMP_W / 2 + 0.2);
      const ax = rp.start.x + rp.r.x * side + rp.t.x * a0, az = rp.start.z + rp.r.z * side + rp.t.z * a0;
      const bx = rp.start.x + rp.r.x * side + rp.t.x * a1, bz = rp.start.z + rp.r.z * side + rp.t.z * a1;
      addThing({
        kind: 'ramp', x: (ax + bx) / 2, z: (az + bz) / 2, r: 0.45, top: 0.55, rise: RAMP_LIP, mass: Infinity, ramp: rp,
        seg: { ax, az, dx: bx - ax, dz: bz - az, len2: (bx - ax) ** 2 + (bz - az) ** 2, a0, a1 }, half: (a1 - a0) / 2,
      });
    }
  }

  const floatThings = things.filter((o) => o.kind === 'float');

  // The hull seen from above: discs along its length (bow at -z).
  const HULL_DISCS = [[-1.25, 0.4], [-0.6, 0.58], [0.1, 0.62], [0.85, 0.6]];
  const I_YAW = 300, CRAFT_MASS = 350;
  const bumpResult = { hit: 0, kind: '', x: 0, z: 0 };
  // Keeps a craft out of the things in the water (water: the sea's height
  // there; buoys and floats ride it). Returns the hardest contact this step:
  // { hit: closing speed, kind, x, z (where) }.
  function bump(c, water = 0) {
    bumpResult.hit = 0; bumpResult.kind = '';
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    const cx = Math.floor(c.x / TH), cz = Math.floor(c.z / TH);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) {
      const list = thingCells.get(a + ',' + b);
      if (!list) continue;
      for (const o of list) {
        if (o.under > 0) continue; // pushed under the hull
        const top = o.top + (o.ramp ? o.ramp.base : o.kind === 'gate' ? 0 : water);
        if (c.y > top + (o.rise || 0)) continue; // in the air over it
        let ox = o.x + o.ox, oz = o.z + o.oz;
        const reach = o.r + (o.half || 0) + 2.2;
        if (Math.abs(c.x - ox) > reach || Math.abs(c.z - oz) > reach) continue;
        let deep = 0, nx = 0, nz = 0, lever = 0;
        for (const [zc, rc] of HULL_DISCS) {
          const px = c.x + s * zc, pz = c.z + co * zc;
          let qx = ox, qz = oz;
          if (o.seg) {
            // The nearest point of the tube's axis, and the tube's top there.
            const g = o.seg, f = clamp(((px - g.ax) * g.dx + (pz - g.az) * g.dz) / g.len2, 0, 1);
            qx = g.ax + g.dx * f; qz = g.az + g.dz * f;
            if (c.y > top + o.rise * clamp((g.a0 + (g.a1 - g.a0) * f) / RAMP_LEN, 0, 1)) continue;
          }
          const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
          const pen = rc + o.r - d;
          if (pen > deep && d > 1e-4) { deep = pen; nx = dx / d; nz = dz / d; lever = zc; ox = qx; oz = qz; }
        }
        if (deep <= 0) continue;
        // A moored thing whose line is taut doesn't give any further. A buoy
        // then goes under the hull instead, and pops up again behind it.
        let iO = o.mass === Infinity ? 0 : 1 / o.mass;
        if (iO && Math.hypot(o.ox - nx * deep, o.oz - nz * deep) > o.moor) {
          if (o.kind === 'buoy') {
            const v = Math.max(0, -((c.vx - o.vx) * nx + (c.vz - o.vz) * nz));
            o.under = 0.9; o.vx = o.vz = 0;
            c.vx *= 0.72; c.vz *= 0.72; c.vy = Math.max(c.vy, 0.9);
            if (v > bumpResult.hit) { bumpResult.hit = v; bumpResult.kind = o.kind; bumpResult.x = ox + nx * o.r; bumpResult.z = oz + nz * o.r; }
            continue;
          }
          iO = 0;
        }
        const iM = 1 / CRAFT_MASS, share = iM / (iM + iO);
        c.x += nx * deep * share; c.z += nz * deep * share;
        o.ox -= nx * deep * (1 - share); o.oz -= nz * deep * (1 - share);
        const rv = (c.vx - o.vx) * nx + (c.vz - o.vz) * nz;
        if (rv >= 0) continue;
        const j = (-(1 + (iO ? 0.35 : 0.25)) * rv) / (iM + iO);
        c.vx += j * iM * nx; c.vz += j * iM * nz;
        o.vx -= j * iO * nx; o.vz -= j * iO * nz;
        o.dip = Math.min(0.5, o.dip + -rv * 0.04);
        // Scraping along it costs a little speed; off-centre it turns the hull.
        const keep = 1 - Math.min(0.12, -rv * 0.012);
        c.vx *= keep; c.vz *= keep;
        c.yawRate += clamp((j * lever * (co * nx - s * nz)) / I_YAW * 0.25, -1.2, 1.2);
        if (o.mesh) o.mesh.userData.spin += clamp(((c.vx * nz - c.vz * nx) * 0.004), -0.05, 0.05);
        if (-rv > bumpResult.hit) {
          bumpResult.hit = -rv; bumpResult.kind = o.kind;
          bumpResult.x = ox + nx * o.r; bumpResult.z = oz + nz * o.r;
        }
      }
    }
    return bumpResult;
  }
  // The moored ones swing back on their lines, slowed by the water.
  function stepThings(dt) {
    for (const o of things) {
      if (o.mass === Infinity || (o.ox === 0 && o.oz === 0 && o.vx === 0 && o.vz === 0 && o.under <= 0 && o.dip < 1e-3)) continue;
      const k = o.kind === 'buoy' ? 9 : 2.5, dmp = o.kind === 'buoy' ? 2.2 : 1.4;
      o.vx += (-o.ox * k - o.vx * dmp) * dt; o.vz += (-o.oz * k - o.vz * dmp) * dt;
      o.ox += o.vx * dt; o.oz += o.vz * dt;
      const d = Math.hypot(o.ox, o.oz);
      if (d > o.moor) {
        o.ox *= o.moor / d; o.oz *= o.moor / d;
        const out = (o.vx * o.ox + o.vz * o.oz) / o.moor;
        if (out > 0) { o.vx -= out * o.ox / o.moor; o.vz -= out * o.oz / o.moor; }
      }
      if (o.under > 0) { o.under -= dt; o.dip += (1.1 - o.dip) * Math.min(1, dt * 12); }
      else o.dip *= Math.exp(-dt * 3);
      if (Math.abs(o.ox) + Math.abs(o.oz) < 1e-3 && Math.abs(o.vx) + Math.abs(o.vz) < 1e-3) { o.ox = o.oz = o.vx = o.vz = 0; }
    }
  }

  // ---------- assemble ----------

  land.smoothNormals([0, 3]);
  deco.smoothNormals([0, 1]);
  const landGeo = land.geometry(), decoGeo = deco.geometry(), farGeo = far.geometry();
  bakeLight(land, landGeo);
  bakeLight(deco, decoGeo);
  const landMesh = new THREE.Mesh(landGeo, terrainMat);
  const decoMesh = new THREE.Mesh(decoGeo, makeTerrainMaterial(sky, null, terrainMat));
  const farMesh = new THREE.Mesh(farGeo, terrainMat);
  for (const m of [landMesh, decoMesh, farMesh]) { m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
  const frondGeo = new THREE.BufferGeometry();
  frondGeo.setAttribute('position', new THREE.Float32BufferAttribute(fronds.pos, 3));
  frondGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fronds.uv, 2));
  frondGeo.setAttribute('color', new THREE.Float32BufferAttribute(fronds.col, 3));
  frondGeo.setIndex(fronds.idx);
  frondGeo.computeVertexNormals();
  const frondMesh = new THREE.Mesh(frondGeo, makeFrondMaterial(sky, terrainMat.uniforms.camPos));
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

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _p = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);
  let lastT = null;
  function update(t, camPos, ocean) {
    const dt = lastT === null ? 0 : clamp(t - lastT, 0, 0.1);
    lastT = t;
    stepThings(dt);
    terrainMat.uniforms.camPos.value.copy(camPos);
    for (const r of ramps) {
      r.base = ocean.heightAt(r.start.x + r.t.x * RAMP_LEN * 0.5, r.start.z + r.t.z * RAMP_LEN * 0.5, t) - 0.12;
      r.mesh.position.y = r.base;
    }
    for (let i = 0; i < buoyPos.length; i++) {
      const o = things[i], x = o.x + o.ox, z = o.z + o.oz;
      if (Math.abs(x - camPos.x) + Math.abs(z - camPos.z) > 280) continue;
      // Knocked: it leans the way it is going and is pushed under a little.
      const sp = Math.hypot(o.vx, o.vz);
      if (sp > 0.02) _q.setFromAxisAngle(_ax.set(o.vz / sp, 0, -o.vx / sp), Math.min(0.75, sp * 0.14));
      else _q.identity();
      buoyMesh.setMatrixAt(i, _m.compose(_p.set(x, ocean.heightAt(x, z, t) + 0.12 - o.dip, z), _q, _s1));
    }
    buoyMesh.instanceMatrix.needsUpdate = true;
    for (const o of floatThings) {
      const f = o.mesh;
      f.position.x = o.x + o.ox; f.position.z = o.z + o.oz;
      if (Math.abs(f.position.x - camPos.x) + Math.abs(f.position.z - camPos.z) > 320) continue;
      f.position.y = ocean.heightAt(f.position.x, f.position.z, t) - 0.05 - o.dip * 0.5;
      f.userData.spin += (f.userData.base - f.userData.spin) * Math.min(1, dt * 0.4);
      f.rotation.y += f.userData.spin * 0.016;
      f.rotation.z = Math.sin(t * 0.9 + f.userData.ph) * 0.05;
    }
  }

  const course = { SAMPLES, length, step, pts, tans, rights, half, walled, wallF, curv, lineLat, at, nearest, idxOfCp, cpIdx };
  return {
    group, course, gates, ramps, arches, solids, rampHeight, collide, bump, things, enclosure, landDist, heightAt, depthAt,
    landTexture, landBounds, update,
    stats: { landTris: land.idx.length / 3, decoTris: deco.idx.length / 3, frondTris: fronds.idx.length / 3, palms: palmSpots.length, bushes: leafSpots.length },
  };
}
