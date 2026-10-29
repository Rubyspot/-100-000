// $100,000 jetski race prototype.
// Seated VR: the player rides a jetski around the island against Jane.
// Hands-first controls: a floating handlebar, fist on each grip; the right
// grip is the throttle and turning the bar steers. Controllers and the
// keyboard work as fallbacks for testing.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const LAPS = Math.max(1, Math.min(5, parseInt(params.get('laps') || '2', 10) || 2));
const AUTOPILOT = params.has('autopilot'); // drives itself, for testing
const CHASE = params.has('chase'); // flat preview from behind and above, for checking the scene
const USE_VIGNETTE = params.get('vignette') !== '0';
const HEAVE = params.get('heave') === '0' ? 0 : 0.55; // how much of the swell the rider's head follows

// Rider layout in jetski space: forward is -Z, the water line is y = 0.
const SEAT_HEAD = 1.45;                          // eye height above the water when seated
const BAR = new THREE.Vector3(0, SEAT_HEAD - 0.42, -0.45); // handlebar centre
const GRIP_HALF = 0.26;                          // grips at BAR ± x

const MAX_SPEED = 17;      // m/s, about 61 km/h
const ACCEL = 5.5;         // m/s² at full throttle from rest
const DRAG = ACCEL / MAX_SPEED;
const TURN_RATE = 0.85;    // rad/s at full lock

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// ---------- renderer, scene, camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 6000);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const SUN_DIR = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();
const COL = {
  zenith: new THREE.Color(0x2b6fd3),
  horizon: new THREE.Color(0xcde8f4),
  sun: new THREE.Color(0xfff1d6),
  deep: new THREE.Color(0x032c45),
  scatter: new THREE.Color(0x11a3a0),
  foam: new THREE.Color(0xf4fbfb),
};
const FOG_DENSITY = 0.00055;
scene.fog = new THREE.FogExp2(COL.horizon.getHex(), FOG_DENSITY);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a5a66, 1.6));
const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.4);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

const SKY_GLSL = /* glsl */`
  uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
  vec3 skyColor(vec3 d) {
    float y = d.y;
    vec3 c = y >= 0.0 ? mix(horizon, zenith, pow(y, 0.55)) : horizon * (1.0 + y * 0.6);
    float s = max(dot(d, sunDir), 0.0);
    c += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.5);
    return c;
  }`;
const skyUniforms = {
  zenith: { value: COL.zenith }, horizon: { value: COL.horizon },
  sunColor: { value: COL.sun }, sunDir: { value: SUN_DIR },
};

// ---------- sky ----------

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(5000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyColor(d);
        float s = dot(d, sunDir);
        c += sunColor * smoothstep(0.99955, 0.9998, s) * 12.0;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

// ---------- ocean ----------
// Gerstner swell on a polar grid that follows the camera. The same wave sum
// runs on the CPU so the jetskis and buoys float on the drawn surface. Each
// wave fades out with distance (shorter waves first), which keeps the far
// grid from aliasing and keeps the horizon still.

const WAVES = [ // direction (deg), wavelength (m), amplitude (m), steepness
  [20, 44, 0.30, 0.17],
  [-35, 23, 0.19, 0.16],
  [75, 13, 0.09, 0.14],
  [140, 7.5, 0.045, 0.12],
  [-100, 4.2, 0.022, 0.10],
].map(([deg, L, A, steep]) => {
  const a = THREE.MathUtils.degToRad(deg), k = (2 * Math.PI) / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), A, steep, f0: L * 3, f1: L * 6 };
});

const waveA = WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.w));
const waveB = WAVES.map((w) => new THREE.Vector4(w.A, w.steep, w.f0, w.f1));

// Island shoreline: radius at y = 0 as a function of angle (shared by the
// mesh, the shore foam and collisions).
const ISLAND_SCALE = 1.5;
const ISLAND_R = 58 * ISLAND_SCALE;
const shoreRadius = (theta) => ISLAND_R * (1 + 0.08 * Math.sin(3 * theta) + 0.05 * Math.sin(7 * theta + 1));

const waterUniforms = {
  time: { value: 0 },
  camPos: { value: new THREE.Vector3() },
  waveA: { value: waveA },
  waveB: { value: waveB },
  deep: { value: COL.deep }, scatter: { value: COL.scatter }, foamColor: { value: COL.foam },
  fogDensity: { value: FOG_DENSITY },
  islandR: { value: ISLAND_R },
  ...skyUniforms,
};

const WAVE_COUNT = WAVES.length;
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  vertexShader: /* glsl */`
    #define WAVES ${WAVE_COUNT}
    uniform float time; uniform vec3 camPos;
    uniform vec4 waveA[WAVES]; uniform vec4 waveB[WAVES];
    varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
    void main() {
      vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
      float dist = length(p.xz - camPos.xz);
      vec3 disp = vec3(0.0);
      vec3 n = vec3(0.0, 1.0, 0.0);
      float crest = 0.0;
      for (int i = 0; i < WAVES; i++) {
        vec4 a = waveA[i]; vec4 b = waveB[i];
        float fade = 1.0 - smoothstep(b.z, b.w, dist);
        float amp = b.x * fade, st = b.y * fade;
        float ph = a.z * dot(a.xy, p.xz) - a.w * time;
        float c = cos(ph), s = sin(ph);
        disp.xz += a.xy * (st / a.z) * c;
        disp.y += amp * s;
        n.xz -= a.xy * a.z * amp * c;
        n.y -= st * s;
        crest += st * s;
      }
      p += disp;
      vWorld = p;
      vNormal = n;
      vCrest = crest;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: SKY_GLSL + /* glsl */`
    uniform float time; uniform vec3 camPos;
    uniform vec3 deep; uniform vec3 scatter; uniform vec3 foamColor;
    uniform float fogDensity; uniform float islandR;
    varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    // Small ripples, normals only.
    vec2 ripple(vec2 p, vec2 dir, float k, float amp, float speed, float dist) {
      // Fade each ripple before it gets small enough on screen to shimmer.
      float L = 6.2832 / k;
      float fade = 1.0 - smoothstep(L * 7.0, L * 22.0, dist);
      float ph = k * dot(dir, p) - speed * time;
      return dir * (k * amp * cos(ph) * fade);
    }

    void main() {
      vec3 toCam = camPos - vWorld;
      float dist = length(toCam);
      vec3 V = toCam / dist;
      vec2 p = vWorld.xz;
      vec2 r = ripple(p, vec2(0.8, 0.6), 3.9, 0.012, 6.2, dist)
             + ripple(p, vec2(-0.47, 0.88), 5.7, 0.008, 7.4, dist)
             + ripple(p, vec2(0.96, -0.28), 8.3, 0.005, 9.0, dist)
             + ripple(p, vec2(-0.71, -0.7), 2.3, 0.02, 4.7, dist);
      vec3 N = normalize(vNormal + vec3(-r.x, 0.0, -r.y));

      float ndv = max(dot(N, V), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
      vec3 R = reflect(-V, N);
      R.y = abs(R.y);
      vec3 refl = skyColor(R);

      // Body colour: deep blue, with turquoise light scattered through crests
      // that face away from the sun.
      float sss = pow(max(dot(V, -sunDir), 0.0), 3.0) * 0.5 + 0.5;
      vec3 body = deep + scatter * clamp(0.25 + vCrest * 1.6, 0.0, 1.0) * sss * 0.55;
      vec3 col = mix(body, refl, F);

      float sd = max(dot(R, sunDir), 0.0);
      col += sunColor * (pow(sd, 900.0) * 14.0 + pow(sd, 120.0) * 0.9);

      // Foam on the sharpest crests and around the island.
      float n1 = vnoise(p * 0.9 + time * 0.15), n2 = vnoise(p * 3.1 - time * 0.3);
      float foam = smoothstep(0.4, 0.6, vCrest + (n1 - 0.5) * 0.3) * smoothstep(0.45, 0.8, n2) * 0.7;
      float th = atan(p.y, p.x);
      float shore = islandR * (1.0 + 0.08 * sin(3.0 * th) + 0.05 * sin(7.0 * th + 1.0));
      float sdist = length(p) - shore;
      float band = 1.0 - smoothstep(0.0, 9.0, sdist);
      foam += band * smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(sdist * 1.4 - time * 1.6) + (n2 - 0.5) * 0.6);
      foam = clamp(foam, 0.0, 1.0);
      col = mix(col, foamColor * (0.75 + 0.25 * max(dot(N, sunDir), 0.0)), foam);

      float fogF = 1.0 - exp(-dist * fogDensity);
      col = mix(col, horizon, fogF);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

function makeWaterGeometry() {
  const radii = [0];
  let r = 0, step = 0.5;
  while (r < 45) { r += step; radii.push(r); }
  while (r < 5200) { step *= 1.055; r += step; radii.push(r); }
  const SEG = 192;
  const verts = [0, 0, 0];
  for (let i = 1; i < radii.length; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      verts.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  const idx = [];
  const ring = (i, j) => 1 + (i - 1) * SEG + (j % SEG);
  for (let j = 0; j < SEG; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < radii.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}
const water = new THREE.Mesh(makeWaterGeometry(), waterMaterial);
water.frustumCulled = false;
scene.add(water);

// CPU copy of the wave sum. Heights are relative to the camera position so
// they match the faded waves that are drawn.
const camXZ = new THREE.Vector2();
const _d = { x: 0, y: 0, z: 0 };
function displacement(x, z, t, out) {
  out.x = out.y = out.z = 0;
  const dist = Math.hypot(x - camXZ.x, z - camXZ.y);
  for (const w of WAVES) {
    const fade = 1 - THREE.MathUtils.smoothstep(dist, w.f0, w.f1);
    if (fade <= 0) continue;
    const ph = w.k * (w.dx * x + w.dz * z) - w.w * t;
    const c = Math.cos(ph), s = Math.sin(ph);
    const h = (w.steep * fade) / w.k;
    out.x += w.dx * h * c;
    out.z += w.dz * h * c;
    out.y += w.A * fade * s;
  }
  return out;
}
function waterHeight(x, z, t) {
  // Undo the horizontal Gerstner shift with two fixed-point steps.
  let px = x, pz = z;
  for (let i = 0; i < 2; i++) {
    displacement(px, pz, t, _d);
    px = x - _d.x; pz = z - _d.z;
  }
  return displacement(px, pz, t, _d).y;
}

// ---------- island ----------

function makeIsland(scale = 1, seed = 0) {
  const profile = [
    [0, 31], [9, 29], [20, 24], [31, 16], [41, 9], [49, 4.5], [55, 2.2], [58, 0.6], [62, -1.5], [70, -6],
  ].reverse().map(([x, y]) => new THREE.Vector2(x, y)); // bottom to top, so faces point outward
  const g = new THREE.LatheGeometry(profile, 72);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe9d3a1), wetSand = new THREE.Color(0xb59b6c);
  const green = new THREE.Color(0x3f8f3a), dark = new THREE.Color(0x2b6a33), rock = new THREE.Color(0x7d7468);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const th = Math.atan2(z, x) + seed;
    const k = 1 + 0.08 * Math.sin(3 * th) + 0.05 * Math.sin(7 * th + 1);
    const bump = y > 3 ? 1 + 0.06 * Math.sin(th * 11 + y * 0.3) * Math.min(1, (y - 3) / 6) : 1;
    pos.setX(i, x * k * bump);
    pos.setZ(i, z * k * bump);
    const hy = y + Math.sin(th * 5 + seed) * 1.2;
    if (y < 0.4) c.copy(wetSand);
    else if (hy < 3.0) c.copy(sand);
    else if (hy < 22) c.copy(green).lerp(dark, Math.abs(Math.sin(th * 9 + y)) * 0.6);
    else c.copy(rock);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.scale.setScalar(scale);
  return m;
}

const island = makeIsland(ISLAND_SCALE);
scene.add(island);

// Placeholder palms on the beach.
{
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 9, 6, 4);
  trunkGeo.translate(0, 4.5, 0);
  {
    const p = trunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.pow(p.getY(i) / 9, 2) * 1.6);
    trunkGeo.computeVertexNormals();
  }
  const leafGeo = new THREE.ConeGeometry(0.9, 4.2, 4, 1, true);
  leafGeo.translate(0, 2.1, 0);
  leafGeo.scale(1, 1, 0.25);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a47, flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3e9a3a, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 22; i++) {
    const th = (i / 22) * Math.PI * 2 + Math.sin(i * 7.3) * 0.15;
    const r = (shoreRadius(th) - 9 - Math.abs(Math.sin(i * 3.1)) * 6) / ISLAND_SCALE;
    const palm = new THREE.Group();
    palm.position.set(Math.cos(th) * r, 2.2, Math.sin(th) * r);
    palm.rotation.y = -th + Math.PI;
    palm.scale.setScalar((0.85 + Math.abs(Math.sin(i * 1.7)) * 0.4) / ISLAND_SCALE);
    palm.add(new THREE.Mesh(trunkGeo, trunkMat));
    for (let j = 0; j < 6; j++) {
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(1.6, 9, 0);
      leaf.rotation.set(0, (j / 6) * Math.PI * 2, 1.9);
      leaf.rotation.order = 'YXZ';
      palm.add(leaf);
    }
    island.add(palm);
  }
}

// Distant islands for the horizon.
for (const [x, z, s, seed] of [[-900, -1400, 1.6, 1], [1500, -700, 1.1, 2], [700, 1600, 2.2, 3], [-1700, 600, 1.3, 4]]) {
  const isl = makeIsland(s, seed);
  isl.position.set(x, -1.5, z);
  scene.add(isl);
}

// ---------- track ----------

const TRACK_POINTS = [];
for (let i = 0; i < 12; i++) {
  const th = (i / 12) * Math.PI * 2;
  const r = 152 + 20 * Math.sin(2 * th + 0.5) + 12 * Math.cos(3 * th);
  TRACK_POINTS.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
}
const curve = new THREE.CatmullRomCurve3(TRACK_POINTS, true, 'centripetal');
const TRACK_LEN = curve.getLength();
const SAMPLES = 720;
const samplePts = [], sampleTan = [];
for (let i = 0; i < SAMPLES; i++) {
  samplePts.push(curve.getPointAt(i / SAMPLES));
  sampleTan.push(curve.getTangentAt(i / SAMPLES).setY(0).normalize());
}
const rightOf = (t, out) => out.set(-t.z, 0, t.x);
function trackFrame(u, pos, tan) {
  u = ((u % 1) + 1) % 1;
  curve.getPointAt(u, pos);
  curve.getTangentAt(u, tan).setY(0).normalize();
}
const yawFromDir = (d) => Math.atan2(-d.x, -d.z);

const GATES = 10;
const GATE_HALF = 8.5;
const gates = [];
{
  const buoyGeo = new THREE.SphereGeometry(0.7, 16, 10);
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6);
  poleGeo.translate(0, 1.6, 0);
  const lampGeo = new THREE.SphereGeometry(0.28, 12, 8);
  lampGeo.translate(0, 2.9, 0);
  const red = new THREE.MeshLambertMaterial({ color: 0xe5492f });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c45a });
  const pole = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const lampIdle = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const lampNext = new THREE.MeshBasicMaterial({ color: 0x9cffb0 });
  const pos = new THREE.Vector3(), tan = new THREE.Vector3(), right = new THREE.Vector3();
  for (let g = 0; g < GATES; g++) {
    trackFrame(g / GATES, pos, tan);
    rightOf(tan, right);
    const gate = { u: g / GATES, pos: pos.clone(), tan: tan.clone(), right: right.clone(), buoys: [], lamps: [] };
    for (const side of [-1, 1]) {
      const b = new THREE.Group();
      b.position.copy(pos).addScaledVector(right, side * GATE_HALF);
      b.add(new THREE.Mesh(buoyGeo, side < 0 ? red : yellow));
      b.add(new THREE.Mesh(poleGeo, pole));
      const lamp = new THREE.Mesh(lampGeo, lampIdle);
      b.add(lamp);
      scene.add(b);
      gate.buoys.push(b);
      gate.lamps.push(lamp);
    }
    gates.push(gate);
  }
  gates.setNext = (i) => {
    gates.forEach((g, j) => g.lamps.forEach((l) => (l.material = j === i ? lampNext : lampIdle)));
  };
}

// Start / finish banner over gate 0.
function makeTextTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const api = { canvas: c, ctx, tex, redraw: (...a) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, ...a); tex.needsUpdate = true; } };
  api.redraw();
  return api;
}
{
  const g = gates[0];
  const banner = makeTextTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#0e2633'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2c45a'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
    ctx.font = '700 92px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8fd18a'; ctx.fillText('$100,000  ·  START / FINISH', w / 2, h / 2 + 4);
  });
  const width = GATE_HALF * 2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 160 / 1024),
    new THREE.MeshBasicMaterial({ map: banner.tex, side: THREE.DoubleSide, fog: true }));
  mesh.position.copy(g.pos).setY(6.2);
  mesh.rotation.y = yawFromDir(g.tan);
  scene.add(mesh);
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 6.6, 8);
  postGeo.translate(0, 3.3, 0);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x0e2633 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.copy(g.pos).addScaledVector(g.right, side * GATE_HALF).setY(-0.5);
    scene.add(p);
  }
}

// Chevron that floats over the next gate.
const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 4), new THREE.MeshBasicMaterial({ color: 0x9cffb0, fog: true }));
chevron.rotation.x = Math.PI;
scene.add(chevron);

// ---------- jetskis ----------

function makeJetski(main, accent) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // gets pitch and roll from the waves
  root.add(body);

  const s = new THREE.Shape();
  s.moveTo(-0.5, -1.35);
  s.lineTo(0.5, -1.35);
  s.quadraticCurveTo(0.62, 0.0, 0.42, 0.85);
  s.quadraticCurveTo(0.2, 1.5, 0, 1.68);
  s.quadraticCurveTo(-0.2, 1.5, -0.42, 0.85);
  s.quadraticCurveTo(-0.62, 0.0, -0.5, -1.35);
  const hullGeo = new THREE.ExtrudeGeometry(s, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 2, curveSegments: 8 });
  hullGeo.rotateX(-Math.PI / 2);
  // Taper the bottom into a V.
  {
    const p = hullGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0.05) p.setX(i, p.getX(i) * 0.55);
    }
    hullGeo.computeVertexNormals();
  }
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color: main }));
  hull.position.y = -0.12;
  body.add(hull);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.06, 2.2), new THREE.MeshLambertMaterial({ color: accent }));
  stripe.position.set(0, 0.2, 0.05);
  body.add(stripe);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 1.1), new THREE.MeshLambertMaterial({ color: 0x1b1f24 }));
  seat.position.set(0, 0.42, 0.42);
  body.add(seat);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.7), new THREE.MeshLambertMaterial({ color: main }));
  hood.position.set(0, 0.4, -0.7);
  hood.rotation.x = -0.35;
  body.add(hood);

  // Steering column, kept low so it doesn't hide the dash.
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x1b1f24 }));
  column.position.set(0, BAR.y - 0.24, BAR.z - 0.04);
  column.rotation.x = 0.25;
  body.add(column);

  const bar = new THREE.Group(); // pivots for steering
  bar.position.copy(BAR);
  const barTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GRIP_HALF * 2 + 0.06, 8), new THREE.MeshLambertMaterial({ color: 0xb8c0c8 }));
  barTube.rotation.z = Math.PI / 2;
  bar.add(barTube);
  const gripGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.13, 10);
  gripGeo.rotateZ(Math.PI / 2);
  const grips = [-1, 1].map((side) => {
    const g = new THREE.Mesh(gripGeo, new THREE.MeshLambertMaterial({ color: 0x23272d, emissive: 0x000000 }));
    g.position.x = side * GRIP_HALF;
    bar.add(g);
    return g;
  });
  body.add(bar);

  return { root, body, bar, grips };
}

function makeRider() {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x9a6a4e });
  const suit = new THREE.MeshLambertMaterial({ color: 0xff5fa2 });
  const vest = new THREE.MeshLambertMaterial({ color: 0xf2c45a });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), vest);
  torso.position.set(0, 0.98, 0.12);
  torso.rotation.x = -0.25;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), suit);
  hips.position.set(0, 0.65, 0.25);
  g.add(hips);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.position.set(0, 1.42, -0.02);
  g.add(head);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
  hairCap.position.copy(head.position).add(new THREE.Vector3(0, 0.015, 0.02));
  hairCap.rotation.x = -0.4;
  g.add(hairCap);
  const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 3, 6), hair);
  pony.position.set(0, 1.36, 0.17);
  pony.rotation.x = 0.9;
  g.add(pony);
  const limb = (from, to, r, mat) => {
    const d = new THREE.Vector3().subVectors(to, from);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, d.length(), 8), mat);
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  };
  for (const side of [-1, 1]) {
    limb(new THREE.Vector3(side * 0.19, 1.2, 0.02), new THREE.Vector3(side * GRIP_HALF, BAR.y, BAR.z), 0.045, skin);
    limb(new THREE.Vector3(side * 0.12, 0.62, 0.15), new THREE.Vector3(side * 0.3, 0.5, -0.3), 0.07, skin);
    limb(new THREE.Vector3(side * 0.3, 0.5, -0.3), new THREE.Vector3(side * 0.33, 0.2, -0.1), 0.055, skin);
  }
  return g;
}

const player = makeJetski(0xf2f4f6, 0xf2c45a);
scene.add(player.root);
const jane = makeJetski(0xff5fa2, 0xffffff);
jane.body.add(makeRider());
scene.add(jane.root);

// Name tag over Jane.
{
  const tag = makeTextTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(14,38,51,.85)';
    ctx.beginPath(); ctx.roundRect(4, 4, w - 8, h - 8, 28); ctx.fill();
    ctx.font = '700 58px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff8fc0'; ctx.fillText('JANE', w / 2, h / 2 + 3);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag.tex, depthWrite: false, fog: false }));
  sprite.scale.set(0.9, 0.34, 1);
  sprite.position.set(0, 2.05, 0);
  jane.root.add(sprite);
}

// The rider rig: XR reference space origin, moved so the calibrated head
// sits on the seat. It turns with the jetski but never pitches or rolls.
const rig = new THREE.Group();
player.root.add(rig);
rig.add(camera);
camera.position.set(0, 1.2, 0); // flat preview: a seated head

// ---------- HUD ----------

const dash = makeTextTexture(512, 256, (ctx, w, h, info = {}) => {
  ctx.fillStyle = 'rgba(8,24,33,.88)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 26); ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = info.rank === 1 ? '#8fd18a' : '#ff8fc0';
  ctx.font = '800 96px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(info.rank === 1 ? '1st' : info.rank === 2 ? '2nd' : '—', 28, 112);
  ctx.fillStyle = '#eef6f7';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText(info.time || '0:00.0', 30, 172);
  ctx.fillStyle = '#9cb8c2';
  ctx.font = '500 30px system-ui, sans-serif';
  ctx.fillText(info.lap || '', 30, 222);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#eef6f7';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText(String(info.kmh ?? 0), w - 30, 222);
  ctx.font = '500 24px system-ui, sans-serif';
  ctx.fillStyle = '#9cb8c2';
  ctx.fillText('km/h', w - 30, 168);
  if (info.fps) ctx.fillText(info.fps + ' fps', w - 30, 40);
  // Arrow toward the next gate.
  if (info.arrow !== undefined) {
    ctx.save();
    ctx.translate(w - 110, 92);
    ctx.rotate(info.arrow);
    ctx.fillStyle = '#9cffb0';
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(30, 18); ctx.lineTo(0, 4); ctx.lineTo(-30, 18); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
});
const dashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: dash.tex, transparent: true, fog: false, toneMapped: false }));
dashMesh.position.set(0, BAR.y + 0.02, BAR.z - 0.22);
dashMesh.rotation.x = -0.75;
player.body.add(dashMesh);

const panel = makeTextTexture(1024, 256, (ctx, w, h, text = '', sub = '') => {
  if (!text) return;
  ctx.fillStyle = 'rgba(8,24,33,.8)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 40); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2c45a';
  ctx.font = `800 ${sub ? 92 : 110}px system-ui, sans-serif`;
  ctx.fillText(text, w / 2, sub ? 96 : h / 2 + 4, w - 60);
  if (sub) {
    ctx.fillStyle = '#eef6f7';
    ctx.font = '500 48px system-ui, sans-serif';
    ctx.fillText(sub, w / 2, 186, w - 60);
  }
});
const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), new THREE.MeshBasicMaterial({ map: panel.tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
panelMesh.position.set(0, SEAT_HEAD + 0.25, -2.6);
panelMesh.renderOrder = 20;
player.root.add(panelMesh);
let panelKey = '';
function showPanel(text, sub = '') {
  const key = text + '|' + sub;
  if (key === panelKey) return;
  panelKey = key;
  panel.redraw(text, sub);
  panelMesh.visible = !!text;
}
showPanel('');

// Comfort vignette: darkens the edges of view while turning.
const vignette = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 12),
  new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { strength: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float strength; varying vec3 vDir;
      void main() {
        float f = -normalize(vDir).z;
        gl_FragColor = vec4(0.0, 0.0, 0.0, strength * (1.0 - smoothstep(0.45, 0.82, f)));
      }`,
  }),
);
vignette.renderOrder = 100;
vignette.frustumCulled = false;
vignette.visible = false;
camera.add(vignette);

// ---------- wakes ----------

function makeWake() {
  const N = 56;
  const pts = Array.from({ length: N }, () => ({ x: 0, z: 0, age: 99, rx: 1, rz: 0, v: 0, spread: 1 }));
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3);
  const uv = new Float32Array(N * 2 * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { time: { value: 0 }, foamColor: { value: COL.foam } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec2 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 foamColor; varying vec2 vUv; varying vec2 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float across = abs(vUv.x * 2.0 - 1.0);
        float n = vnoise(vW * 1.3 + time * 0.2) * 0.6 + vnoise(vW * 4.1 - time * 0.5) * 0.4;
        // Churned water down the middle, two thin lines at the outer edges.
        float centre = (1.0 - smoothstep(0.0, 0.4, across)) * smoothstep(0.35, 0.7, n + vUv.y * 0.35);
        float lines = exp(-pow((across - 0.86) / 0.07, 2.0)) * smoothstep(0.2, 0.55, n);
        float a = (centre * 0.8 + lines * 0.6) * vUv.y;
        gl_FragColor = vec4(foamColor, a * 0.85);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let acc = 0, fresh = true;
  return {
    mesh,
    reset() { fresh = true; },
    update(dt, t, x, z, yaw, speed) {
      if (fresh) {
        // Collapse the whole trail onto the jetski so no strip reaches back to an old spot.
        fresh = false;
        for (const p of pts) { p.x = x; p.z = z; p.age = 99; p.v = 0; }
      }
      acc += dt;
      if (acc > 0.1) {
        acc = 0;
        const p = pts.pop();
        // Spawn at the stern.
        p.x = x + Math.sin(yaw) * 1.3; p.z = z + Math.cos(yaw) * 1.3;
        p.rx = Math.cos(yaw); p.rz = -Math.sin(yaw);
        p.age = 0; p.v = Math.min(1, speed / 10); p.spread = 0.6 + speed * 0.3;
        pts.unshift(p);
      }
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        p.age += dt;
        const life = Math.max(0, 1 - p.age / 5.5) * p.v;
        const half = 0.45 + p.age * (p.spread || 1);
        const y = waterHeight(p.x, p.z, t) + 0.04;
        pos[i * 6] = p.x - p.rx * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = p.z - p.rz * half;
        pos[i * 6 + 3] = p.x + p.rx * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = p.z + p.rz * half;
        uv[i * 4] = 0; uv[i * 4 + 1] = life; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = life;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.uv.needsUpdate = true;
      mat.uniforms.time.value = t;
    },
  };
}
const playerWake = makeWake();
const janeWake = makeWake();

// Bow spray: a few drops thrown off the bow at speed.
function makeSpray() {
  const N = 90;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const vel = new Float32Array(N * 3);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float life; varying float vLife;
      void main() { vLife = life; vec4 mv = viewMatrix * vec4(position, 1.0); gl_PointSize = 900.0 * 0.05 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      varying float vLife;
      void main() { vec2 c = gl_PointCoord - 0.5; float d = smoothstep(0.25, 0.0, dot(c, c));
        gl_FragColor = vec4(vec3(0.95), d * vLife * 0.8); if (gl_FragColor.a < 0.01) discard; }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let next = 0, acc = 0;
  return {
    update(dt, x, y, z, yaw, speed) {
      const rate = speed > 4 ? speed * 3.2 : 0;
      acc += rate * dt;
      while (acc >= 1) {
        acc -= 1;
        const i = next; next = (next + 1) % N;
        const side = Math.random() < 0.5 ? -1 : 1;
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        pos[i * 3] = x + fx * 0.9 + rx * side * 0.45; pos[i * 3 + 1] = y + 0.05; pos[i * 3 + 2] = z + fz * 0.9 + rz * side * 0.45;
        const out = 1.5 + Math.random() * 2, up = 1.5 + Math.random() * 2.2;
        vel[i * 3] = rx * side * out + fx * speed * 0.25; vel[i * 3 + 1] = up; vel[i * 3 + 2] = rz * side * out + fz * speed * 0.25;
        life[i] = 1;
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 1.4;
        vel[i * 3 + 1] -= 9.8 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.life.needsUpdate = true;
    },
  };
}
const playerSpray = makeSpray();
const janeSpray = makeSpray();

// ---------- audio ----------
// A synthesized engine for each jetski; Jane's is positional.

const listener = new THREE.AudioListener();
camera.add(listener);
function makeEngine(positional) {
  const ctx = listener.context;
  const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
  const osc2 = ctx.createOscillator(); osc2.type = 'square';
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2;
  const mix = ctx.createGain(); mix.gain.value = 0;
  osc1.connect(filter); osc2.connect(filter); filter.connect(mix);
  const audio = positional ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener);
  if (positional) { audio.setRefDistance(6); audio.setRolloffFactor(1.4); }
  audio.setNodeSource(mix);
  let started = false;
  return {
    audio,
    start() { if (!started) { osc1.start(); osc2.start(); started = true; } },
    set(speed01, throttle) {
      const t = ctx.currentTime;
      const f = 42 + speed01 * 70 + throttle * 18;
      osc1.frequency.setTargetAtTime(f, t, 0.08);
      osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      filter.frequency.setTargetAtTime(300 + speed01 * 900 + throttle * 500, t, 0.08);
      mix.gain.setTargetAtTime(0.03 + throttle * 0.05 + speed01 * 0.04, t, 0.1);
    },
  };
}
const playerEngine = makeEngine(false);
const janeEngine = makeEngine(true);
jane.root.add(janeEngine.audio);
function startAudio() {
  listener.context.resume();
  playerEngine.start();
  janeEngine.start();
}

// ---------- hands ----------

const TIP_JOINTS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'];
const KNUCKLE_JOINTS = ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'];
const jointSphere = new THREE.IcosahedronGeometry(1, 1);
const handMat = new THREE.MeshLambertMaterial({ color: 0xc89a7c });
const hands = [0, 1].map((i) => {
  const space = renderer.xr.getHand(i);
  rig.add(space);
  const dots = new THREE.InstancedMesh(jointSphere, handMat, 25);
  dots.frustumCulled = false;
  dots.count = 0;
  rig.add(dots);
  const h = { space, dots, handedness: null, closed: false, grabbing: false, palm: new THREE.Vector3(), tracked: false };
  space.addEventListener('connected', (e) => { h.handedness = e.data.handedness; });
  space.addEventListener('disconnected', () => { h.handedness = null; h.tracked = false; h.grabbing = false; dots.count = 0; });
  return h;
});

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// Joint positions are in the XR reference space, which is the rig's space;
// rig.matrix takes them into jetski space.
function updateHand(h) {
  const joints = h.space.joints;
  const wrist = joints && joints['wrist'];
  if (!wrist || !wrist.visible || !h.handedness) { h.tracked = false; h.dots.count = 0; return; }
  h.tracked = true;
  let n = 0;
  for (const name in joints) {
    const j = joints[name];
    if (!j.visible) continue;
    _s.setScalar(j.jointRadius || 0.008);
    _m.compose(j.position, _q.identity(), _s);
    h.dots.setMatrixAt(n++, _m);
  }
  h.dots.count = n;
  h.dots.instanceMatrix.needsUpdate = true;
  // Curl: fingertip-to-wrist over knuckle-to-wrist. About 1.9 open, near 1 in a fist.
  let ratio = 0;
  for (let k = 0; k < 3; k++) {
    const tip = joints[TIP_JOINTS[k]], kn = joints[KNUCKLE_JOINTS[k]];
    ratio += tip.position.distanceTo(wrist.position) / Math.max(0.01, kn.position.distanceTo(wrist.position));
  }
  ratio /= 3;
  if (h.closed && ratio > 1.55) h.closed = false;
  else if (!h.closed && ratio < 1.35) h.closed = true;
  // Palm centre: between wrist and middle knuckle.
  _a.copy(wrist.position).lerp(joints['middle-finger-phalanx-proximal'].position, 0.6);
  rig.updateMatrix();
  h.palm.copy(_a).applyMatrix4(rig.matrix);
}

// ---------- calibration ----------
// Put the player's head on the seat, facing along the jetski.

let calibrated = false;
function calibrate() {
  const head = camera.position; // head pose in reference space, from last frame
  const fwd = _a.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  rig.rotation.set(0, -yaw, 0);
  _b.set(head.x, 0, head.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
  rig.position.set(-_b.x, SEAT_HEAD - head.y, -_b.z);
  rig.updateMatrix();
  calibrated = true;
}

// ---------- race state ----------

const ski = { x: 0, z: 0, yaw: 0, speed: 0, steer: 0, throttle: 0, heave: 0, pitch: 0, roll: 0 };
const ai = { s: 0, speed: 0, lat: 3.5, yaw: 0, x: 0, z: 0, steer: 0, heave: 0, pitch: 0, roll: 0, finish: null };
const race = { state: 'ready', t0: 0, clock: 0, countdown: 0, nextGate: 1, lap: 1, s: 0, idx: 0, finish: null, rank: 2, barkAt: -99, msgUntil: 0, needRelease: false };

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _r = new THREE.Vector3();
const START_U = 6 / TRACK_LEN; // a few metres past the line

function resetRace() {
  trackFrame(START_U, _p, _t);
  rightOf(_t, _r);
  ski.x = _p.x - _r.x * 3.5; ski.z = _p.z - _r.z * 3.5;
  ski.yaw = yawFromDir(_t); ski.speed = 0; ski.steer = 0; ski.throttle = 0;
  ai.s = START_U; ai.speed = 0; ai.lat = 3.5; ai.finish = null; ai.yaw = ski.yaw; ai.steer = 0;
  race.state = 'ready'; race.clock = 0; race.nextGate = 1; race.lap = 1; race.s = START_U;
  race.idx = Math.round(START_U * SAMPLES) % SAMPLES; race.finish = null; race.rank = 2; race.prevAlong = undefined;
  gates.setNext(1);
  playerWake.reset(); janeWake.reset();
  showPanel('Grab the handlebar', 'Make a fist on both grips to start');
}

function bark(text, now, force = false) {
  if (!force && now - race.barkAt < 6) return;
  race.barkAt = now;
  race.msgUntil = now + 3.2;
  showPanel('Jane', text);
}

const fmt = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

// ---------- input ----------

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));

const input = { throttle: 0, steer: 0, engaged: false, barAngle: 0, gripL: false, gripR: false };
const gripWorld = [new THREE.Vector3(-GRIP_HALF, BAR.y, BAR.z), new THREE.Vector3(GRIP_HALF, BAR.y, BAR.z)];
const GRAB_RADIUS = 0.15;

function readInput() {
  let throttle = 0, steer = 0, engaged = false, barAngle = 0;
  let L = null, R = null;
  for (const h of hands) {
    updateHand(h);
    if (!h.tracked) { h.grabbing = false; continue; }
    const grip = gripWorld[h.handedness === 'left' ? 0 : 1];
    if (!h.closed) h.grabbing = false;
    else if (!h.grabbing && h.palm.distanceTo(grip) < GRAB_RADIUS) h.grabbing = true;
    if (h.grabbing) (h.handedness === 'left' ? (L = h) : (R = h));
  }
  if (L && R) {
    // Turning the bar: right hand forward (more negative z) steers left.
    const vx = R.palm.x - L.palm.x, vz = R.palm.z - L.palm.z;
    barAngle = Math.atan2(-vz, vx);
    steer = barAngle / 0.45;
  } else if (L || R) {
    const h = L || R, grip = gripWorld[L ? 0 : 1];
    steer = -(h.palm.x - grip.x) / 0.14;
    barAngle = steer * 0.45;
  }
  if (R) throttle = 1;
  engaged = !!(L || R);
  input.gripL = !!L; input.gripR = !!R;

  // Controllers (fallback): trigger throttle, thumbstick steer.
  const session = renderer.xr.getSession();
  if (session) {
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp || src.hand) continue;
      if (src.handedness === 'right' && gp.buttons[0]) { throttle = Math.max(throttle, gp.buttons[0].value); if (gp.buttons[0].pressed) engaged = true; }
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) { steer = -ax; barAngle = steer * 0.45; }
      if (gp.buttons[1] && gp.buttons[1].pressed) engaged = true;
    }
  }
  // Keyboard.
  if (keys.has('KeyW') || keys.has('ArrowUp')) throttle = 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer = 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer = -1;
  if (keys.has('Space') || throttle > 0) engaged = true;
  if (keys.has('KeyA') || keys.has('KeyD') || keys.has('ArrowLeft') || keys.has('ArrowRight')) barAngle = steer * 0.45;

  if (AUTOPILOT) {
    // Aim at a point on the track about 25 m ahead of the nearest sample.
    const tgt = samplePts[(race.idx + Math.round((25 / TRACK_LEN) * SAMPLES)) % SAMPLES];
    let rel = Math.atan2(-(tgt.x - ski.x), -(tgt.z - ski.z)) - ski.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    throttle = 1; steer = rel * 3; engaged = race.state !== 'done';
  }
  input.throttle = throttle;
  input.steer = THREE.MathUtils.clamp(steer, -1, 1);
  input.engaged = engaged;
  input.barAngle = THREE.MathUtils.clamp(barAngle, -0.6, 0.6);
}

// ---------- simulation ----------

function floatPose(obj, x, z, yaw, t, dt) {
  const h = waterHeight(x, z, t);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const hf = waterHeight(x + fx * 1.2, z + fz * 1.2, t), hb = waterHeight(x - fx * 1.2, z - fz * 1.2, t);
  const hl = waterHeight(x + fz * 0.5, z - fx * 0.5, t), hr = waterHeight(x - fz * 0.5, z + fx * 0.5, t);
  const k = 1 - Math.exp(-dt * 6);
  obj.heave += (h - obj.heave) * k;
  obj.pitch += (Math.atan2(hf - hb, 2.4) - obj.pitch) * k;
  obj.roll += (Math.atan2(hr - hl, 1.0) - obj.roll) * k;
}

function collideIsland(o, onHit) {
  const d = Math.hypot(o.x, o.z), th = Math.atan2(o.z, o.x);
  const limit = shoreRadius(th) + 4;
  if (d < limit) {
    o.x *= limit / d; o.z *= limit / d;
    o.speed *= 0.5;
    onHit && onHit();
  }
  if (d > 420) { o.x *= 420 / d; o.z *= 420 / d; }
}

function updatePlayer(dt, t, now) {
  const racing = race.state === 'race' || race.state === 'done';
  const throttle = racing ? input.throttle : 0;
  ski.throttle += (throttle - ski.throttle) * (1 - Math.exp(-dt * 5));
  ski.steer += (input.steer - ski.steer) * (1 - Math.exp(-dt * 7));
  ski.speed += (ski.throttle * ACCEL - DRAG * ski.speed - Math.abs(ski.steer) * ski.speed * 0.06) * dt;
  ski.speed = Math.max(0, ski.speed);
  const turn = racing ? ski.steer * TURN_RATE * THREE.MathUtils.clamp(ski.speed / 6, 0.3, 1) : 0;
  ski.yaw += turn * dt;
  ski.x += -Math.sin(ski.yaw) * ski.speed * dt;
  ski.z += -Math.cos(ski.yaw) * ski.speed * dt;
  collideIsland(ski, () => bark('Watch the sand!', now));
  // Bump off Jane.
  const dx = ski.x - ai.x, dz = ski.z - ai.z, d = Math.hypot(dx, dz);
  if (d < 2.4 && d > 0.001) {
    ski.x = ai.x + (dx / d) * 2.4; ski.z = ai.z + (dz / d) * 2.4;
    ski.speed *= 0.9;
  }
  floatPose(ski, ski.x, ski.z, ski.yaw, t, dt);
  vignette.material.uniforms.strength.value += (Math.min(1, Math.abs(turn) / TURN_RATE) * 0.75 - vignette.material.uniforms.strength.value) * (1 - Math.exp(-dt * 4));
  vignette.visible = USE_VIGNETTE && renderer.xr.isPresenting && vignette.material.uniforms.strength.value > 0.02;
  return turn;
}

function updateProgress(now) {
  // Unwrapped arc position, from the nearest track sample near the last one.
  let best = race.idx, bestD = Infinity;
  for (let o = -40; o <= 40; o++) {
    const i = (race.idx + o + SAMPLES) % SAMPLES;
    const p = samplePts[i];
    const d = (p.x - ski.x) ** 2 + (p.z - ski.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  let delta = best - race.idx;
  if (delta > SAMPLES / 2) delta -= SAMPLES;
  if (delta < -SAMPLES / 2) delta += SAMPLES;
  race.idx = best;
  race.s += delta / SAMPLES;

  // Gates, in order.
  const g = gates[race.nextGate];
  const rx = ski.x - g.pos.x, rz = ski.z - g.pos.z;
  const along = rx * g.tan.x + rz * g.tan.z;
  const across = rx * g.right.x + rz * g.right.z;
  if (race.prevAlong !== undefined && race.prevAlong < 0 && along >= 0 && Math.abs(across) < GATE_HALF + 1.5) {
    if (race.nextGate === 0) {
      if (race.lap >= LAPS) {
        race.finish = race.clock;
        race.state = 'done';
        race.doneAt = now;
        const won = ai.finish === null;
        showPanel(won ? 'You win!' : 'Jane wins', won ? `${fmt(race.finish)}  ·  “Okay, okay… rematch?”` : `${fmt(race.finish)}, ${(race.finish - ai.finish).toFixed(1)} s behind  ·  “Told you!”`);
        race.msgUntil = Infinity;
        race.needRelease = true;
      } else {
        race.lap++;
        race.msgUntil = now + 3;
        showPanel('Final lap', '“This $100,000 is mine!”');
      }
    }
    race.nextGate = (race.nextGate + 1) % GATES;
    gates.setNext(race.state === 'done' ? -1 : race.nextGate);
    race.prevAlong = undefined;
    return;
  }
  race.prevAlong = along;
}

function updateJane(dt, t, now) {
  const racing = race.state === 'race' || race.state === 'done';
  let target = 0;
  if (racing) {
    if (ai.finish !== null) target = 8;
    else {
      const gap = (ai.s - race.s) * TRACK_LEN; // metres ahead of the player
      target = 15.6 + Math.sin(t * 0.37) * 0.8;
      if (gap > 30) target = 12.5;
      else if (gap > 12) target = 14.5;
      else if (gap < -40) target = 19;
      else if (gap < -15) target = 17.2;
    }
  }
  ai.speed += THREE.MathUtils.clamp(target - ai.speed, -5 * dt, 4.2 * dt);
  ai.s += (ai.speed * dt) / TRACK_LEN;
  if (racing && ai.finish === null && ai.s >= LAPS) {
    ai.finish = race.clock;
    if (race.state === 'race') bark('Finished! Come on, slowpoke!', now, true);
  }
  // Weave a little, and keep clear of the player.
  let lat = 3.5 * Math.sin(t * 0.21) + 1.5 * Math.sin(t * 0.53 + 1);
  trackFrame(ai.s, _p, _t);
  rightOf(_t, _r);
  const px = ski.x - _p.x, pz = ski.z - _p.z;
  const pAlong = px * _t.x + pz * _t.z, pLat = px * _r.x + pz * _r.z;
  if (Math.abs(pAlong) < 6 && Math.abs(pLat - lat) < 3.5) lat = pLat + (lat > pLat ? 3.5 : -3.5);
  ai.lat += (lat - ai.lat) * (1 - Math.exp(-dt * 1.5));
  const nx = _p.x + _r.x * ai.lat, nz = _p.z + _r.z * ai.lat;
  if (ai.speed > 0.1) {
    const yaw = Math.atan2(-(nx - ai.x), -(nz - ai.z));
    let dy = yaw - ai.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    ai.steer += (THREE.MathUtils.clamp(dy * 8, -1, 1) - ai.steer) * (1 - Math.exp(-dt * 3));
    ai.yaw += dy * Math.min(1, dt * 6);
  }
  ai.x = nx; ai.z = nz;
  floatPose(ai, ai.x, ai.z, ai.yaw, t, dt);
}

// ---------- frame loop ----------

let lastTime = 0;
let lastHud = 0, frames = 0, fpsT = 0, fps = 0;
let elapsed = 0;
const _fwd = new THREE.Vector3();

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 30) : 1 / 60;
  lastTime = time;
  elapsed += dt;
  const t = elapsed;
  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

  if (renderer.xr.isPresenting && !calibrated && t - (race.xrStart || 0) > 0.4) calibrate();

  readInput();
  const now = t;

  // State machine.
  if (race.state === 'ready' && input.engaged && calibrated) {
    race.state = 'countdown'; race.countdown = 3.999;
    bark('Hold on tight, it’s my island!', now, true);
    race.msgUntil = 0;
  } else if (race.state === 'countdown') {
    race.countdown -= dt;
    const n = Math.ceil(race.countdown);
    if (race.countdown <= 0) {
      race.state = 'race'; race.clock = 0; race.msgUntil = now + 0.8;
      showPanel('GO!');
    } else showPanel(String(n), n === 3 ? '“Hold on tight, it’s my island!”' : '');
  } else if (race.state === 'race') {
    race.clock += dt;
  } else if (race.state === 'done' && now - race.doneAt > 3) {
    if (!input.engaged) race.needRelease = false;
    else if (!race.needRelease) { resetRace(); }
  }

  const turn = updatePlayer(dt, t, now);
  updateJane(dt, t, now);
  if (race.state === 'race') updateProgress(now);

  // Rank by arc position (the gates keep the player honest).
  if (race.state === 'race') {
    const rank = race.s >= ai.s ? 1 : 2;
    if (rank !== race.rank && race.clock > 2) {
      bark(rank === 1 ? 'Hey! Where’d you learn to ride like that?' : 'See you at the finish!', now);
    }
    race.rank = rank;
  }
  if (race.state === 'race' && now > race.msgUntil && race.msgUntil !== Infinity) showPanel('');

  // Place the jetskis.
  player.root.position.set(ski.x, ski.heave * HEAVE, ski.z);
  player.root.rotation.y = ski.yaw;
  player.body.position.y = ski.heave * (1 - HEAVE);
  player.body.rotation.set(ski.pitch * 0.5, 0, ski.roll * 0.5, 'YXZ');
  player.bar.rotation.y = input.barAngle;
  player.grips[0].material.emissive.setHex(input.gripL ? 0x2a7a3a : 0x000000);
  player.grips[1].material.emissive.setHex(input.gripR ? 0x2a7a3a : 0x000000);

  jane.root.position.set(ai.x, ai.heave, ai.z);
  jane.root.rotation.y = ai.yaw;
  jane.body.rotation.set(ai.pitch, 0, ai.roll - ai.steer * 0.22 * Math.min(1, ai.speed / 10), 'YXZ');
  jane.bar.rotation.y = ai.steer * 0.3;

  playerWake.update(dt, t, ski.x, ski.z, ski.yaw, ski.speed);
  janeWake.update(dt, t, ai.x, ai.z, ai.yaw, ai.speed);
  playerSpray.update(dt, ski.x, ski.heave, ski.z, ski.yaw, ski.speed);
  janeSpray.update(dt, ai.x, ai.heave, ai.z, ai.yaw, ai.speed);
  playerEngine.set(ski.speed / MAX_SPEED, ski.throttle);
  janeEngine.set(ai.speed / MAX_SPEED, ai.speed > 1 ? 0.8 : 0);

  // Ocean and sky follow the camera.
  camera.getWorldPosition(_a);
  camXZ.set(_a.x, _a.z);
  water.position.set(Math.round(_a.x / 0.5) * 0.5, 0, Math.round(_a.z / 0.5) * 0.5);
  waterUniforms.camPos.value.copy(_a);
  waterUniforms.time.value = t;
  sky.position.copy(_a);

  // Chevron over the next gate.
  if (race.state === 'done') chevron.visible = false;
  else {
    const g = gates[race.nextGate];
    chevron.visible = true;
    chevron.position.set(g.pos.x, 7.5 + Math.sin(t * 2.4) * 0.4, g.pos.z);
    chevron.rotation.y = t * 1.5;
  }

  // Dash, ten times a second.
  if (t - lastHud > 0.1) {
    lastHud = t;
    const g = gates[race.nextGate];
    _fwd.set(g.pos.x - ski.x, 0, g.pos.z - ski.z);
    let rel = yawFromDir(_fwd) - ski.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    dash.redraw({
      rank: race.state === 'race' || race.state === 'done' ? (race.state === 'done' ? (ai.finish === null || race.finish < ai.finish ? 1 : 2) : race.rank) : 0,
      time: fmt(race.state === 'done' ? race.finish : race.clock),
      lap: race.state === 'done' ? 'Finished' : `Lap ${race.lap}/${LAPS}  ·  Gate ${race.nextGate === 0 ? GATES : race.nextGate}/${GATES}`,
      kmh: Math.round(ski.speed * 3.6),
      arrow: race.state === 'done' ? undefined : -rel,
      fps: DEBUG ? fps : 0,
    });
  }

  if (!renderer.xr.isPresenting) {
    // Flat preview: a chase-ish view from the seat, looking slightly down.
    if (CHASE) { camera.position.set(0, 4.5, 9); camera.rotation.set(-0.3, 0, 0); }
    else { camera.position.set(0, 1.25, 0.15); camera.rotation.set(-0.12, 0, 0); }
    rig.position.set(0, SEAT_HEAD - 1.25, 0);
    rig.rotation.set(0, 0, 0);
  }

  renderer.render(scene, camera);
}

// ---------- boot ----------

resetRace();
renderer.setAnimationLoop(frame);
if (DEBUG) Object.assign(window, { race, ai, ski, scene, island, THREE });

const enterBtn = $('enterXr');
const previewBtn = $('preview');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    enterBtn.disabled = !ok;
    statusEl.textContent = ok ? 'Ready. Put on the headset and tap Enter VR.' : 'This browser cannot run VR. Use the preview.';
  }).catch(() => { statusEl.textContent = 'VR check failed. Use the preview.'; });
} else {
  statusEl.textContent = 'No WebXR here. Use the preview (keyboard controls).';
}

enterBtn.addEventListener('click', async () => {
  try {
    startAudio();
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    session.addEventListener('end', () => { $('ui').hidden = false; calibrated = false; });
    await renderer.xr.setSession(session);
    if (session.updateTargetFrameRate && session.supportedFrameRates) {
      const rates = Array.from(session.supportedFrameRates);
      const want = rates.includes(90) ? 90 : Math.max(...rates);
      session.updateTargetFrameRate(want).catch(() => {});
    }
    const ref = renderer.xr.getReferenceSpace();
    ref && ref.addEventListener && ref.addEventListener('reset', () => { calibrated = false; race.xrStart = elapsed; });
    race.xrStart = elapsed;
    calibrated = false;
    resetRace();
    $('ui').hidden = true;
  } catch (err) {
    statusEl.textContent = 'Could not start VR: ' + err.message;
  }
});

previewBtn.addEventListener('click', () => {
  startAudio();
  calibrated = true;
  $('ui').hidden = true;
  $('keys').hidden = false;
  resetRace();
  showPanel('Press Space', 'W or ↑ throttle, A/D or ←/→ steer');
});
if (params.has('autostart')) previewBtn.click();
