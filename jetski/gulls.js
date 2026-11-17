// The gulls and the money. A flock of Ilia's rigged seagull flies ahead of
// the player along the racing line and drops $100 bills that flutter down
// and hover over the water. A bill is Ilia's Bill_03_Gentle_Twist mesh (a
// thin twisted sheet of paper) printed with his photo of a real $100 bill,
// drawn 0.9 m wide (?bill= on the link), lit by the sun and sky and turning
// slowly, so its twist catches the light. The trail of bills is
// the way round the course: ride through them to pick them up (a bill that
// is close enough flies into your hands).
// Every bill in a row is worth $250 more than the last, up to $2,500
// ("Crispy x10"). A missed bill takes one step off the combo and a wall hit
// three. A golden bill hangs in the air over each ramp: $10,000 and a
// boost. The song's $100,000 is meant to come "with ease": a first lap that
// takes a bit over half of the bills gets there, a clean one triples it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { GullVoice } from '../audio.js';
import { SKY_SAMPLE_GLSL } from './sky.js';

const asset = (path) => new URL(path, import.meta.url).href;
export const MAX_COMBO = 10;
export const STEP_VALUE = 250;   // each step of the combo adds this to a bill
export const GOLD_VALUE = 10000;
const FLOCK = 5;
const LEAD = 62;          // how far ahead of the player the flock flies, metres
const BILL_W = 0.9;       // drawn width of a bill, metres (?bill=)
const BILL_LEN = 773.66;  // length of the bill mesh in its own units
const SPIN = 1.5;         // a hovering bill turns this fast, rad/s
// A bill this close to the jetski flies to the rider, metres. The reach is
// longer while the combo is low, so the money comes to a rider who is
// struggling, and tightens as the combo climbs.
const PICK = 3.4, PICK_HELP = 1.6;
const SPACING = 10;       // between bills in a run, metres

// The printed face: a $100 note in the song's spirit (engraved green, a gold
// 100, a blue ribbon, pink seals), bold enough to read from across the water.
function makeBillTexture() {
  const W = 1024, H = 448;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const ink = '#1d5438', pink = '#e0407f', gold = '#b8892a';
  const paper = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 580);
  paper.addColorStop(0, '#edf2dc'); paper.addColorStop(1, '#cfe1c1');
  g.fillStyle = paper; g.fillRect(0, 0, W, H);
  // Fine engraved waves across the field.
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(29,84,56,.20)';
  for (let k = 0; k < 40; k++) {
    g.beginPath();
    for (let x = 52; x <= W - 52; x += 8) {
      const y = H / 2 + Math.sin(x * 0.0123 + k * 0.157) * 158 * Math.cos(k * 0.0785) + Math.sin(x * 0.05 + k) * 5;
      if (x === 52) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  // The frame: a heavy band with a scalloped inner edge and a fine line.
  g.strokeStyle = ink; g.lineWidth = 22; g.strokeRect(15, 15, W - 30, H - 30);
  g.fillStyle = ink;
  for (let x = 40; x < W - 30; x += 22) { g.beginPath(); g.arc(x, 28, 9, 0, Math.PI); g.fill(); g.beginPath(); g.arc(x, H - 28, 9, Math.PI, 0); g.fill(); }
  for (let y = 40; y < H - 30; y += 22) { g.beginPath(); g.arc(28, y, 9, -Math.PI / 2, Math.PI / 2); g.fill(); g.beginPath(); g.arc(W - 28, y, 9, Math.PI / 2, -Math.PI / 2); g.fill(); }
  g.lineWidth = 3; g.strokeRect(50, 50, W - 100, H - 100);
  // The blue ribbon, right of the middle.
  g.fillStyle = '#3f74b4'; g.fillRect(606, 52, 30, H - 104);
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let y = 66; y < H - 70; y += 26) { g.beginPath(); g.moveTo(610, y + 12); g.lineTo(621, y); g.lineTo(632, y + 12); g.lineTo(621, y + 7); g.fill(); }
  // The oval where the portrait would be: rays, and the song's dollar sign.
  const ox = 452, oy = H / 2 + 4, rx = 118, ry = 150;
  g.save();
  g.beginPath(); g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#f3f5e3'; g.fillRect(ox - rx, oy - ry, rx * 2, ry * 2);
  g.strokeStyle = 'rgba(29,84,56,.30)'; g.lineWidth = 2;
  for (let a = 0; a < 72; a++) { const an = a / 72 * Math.PI * 2; g.beginPath(); g.moveTo(ox + Math.cos(an) * 54, oy + Math.sin(an) * 70); g.lineTo(ox + Math.cos(an) * 200, oy + Math.sin(an) * 200); g.stroke(); }
  g.restore();
  g.strokeStyle = ink; g.lineWidth = 9; g.beginPath(); g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.ellipse(ox, oy, rx + 12, ry + 12, 0, 0, Math.PI * 2); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = ink; g.font = 'bold 206px Georgia, "Times New Roman", serif';
  g.fillText('$', ox, oy + 8);
  // The numerals: engraved green top left and top right, the big gold one
  // bottom right.
  g.font = 'bold 118px Georgia, "Times New Roman", serif';
  g.fillText('100', 184, 126);
  g.font = 'bold 60px Georgia, "Times New Roman", serif';
  g.fillText('100', W - 122, 106);
  g.font = 'bold 150px Georgia, "Times New Roman", serif';
  g.fillStyle = '#7d5a12'; g.fillText('100', 829, H - 122);
  g.fillStyle = gold; g.fillText('100', 825, H - 126);
  // Seals and serial numbers in the song's pink.
  g.strokeStyle = pink; g.fillStyle = pink; g.lineWidth = 5;
  g.beginPath(); g.arc(724, 150, 42, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2; g.beginPath(); g.arc(724, 150, 33, 0, Math.PI * 2); g.stroke();
  g.font = 'bold 42px Georgia, "Times New Roman", serif'; g.fillText('CJ', 724, 153);
  g.font = 'bold 27px "Courier New", monospace';
  g.fillText('CJ 00100000 K', 190, 212); g.fillText('CJ 00100000 K', 860, 196);
  // Lettering.
  g.fillStyle = ink;
  g.font = 'bold 26px Georgia, "Times New Roman", serif';
  g.fillText('C R I S P Y   J', 748, 76);
  g.font = 'bold 19px Georgia, "Times New Roman", serif';
  g.fillText('SEAGULLS LOVE TOO', 190, 256);
  g.font = 'bold 34px Georgia, "Times New Roman", serif';
  g.fillText('ONE HUNDRED', 190, 318);
  g.fillText('DOLLARS', 190, 360);
  // The creases of a note that has been in a pocket.
  for (const [x, a] of [[W / 2, 0.20], [W / 4, 0.10], [W * 3 / 4, 0.10]]) {
    const cr = g.createLinearGradient(x - 9, 0, x + 9, 0);
    cr.addColorStop(0, 'rgba(0,0,0,0)'); cr.addColorStop(0.45, `rgba(20,40,20,${a})`); cr.addColorStop(0.55, `rgba(255,255,255,${a * 1.6})`); cr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cr; g.fillRect(x - 9, 0, 18, H);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Ilia's real bill texture is an atlas made for the mesh's own UVs: the
// front of the bill on the top half, the back on the bottom half, both
// printed upside down. The GLB carries planar UVs instead (0 to 1 across
// each face, the back mirrored so it reads left to right); fold them into
// the atlas, the right way up.
function atlasUv(geo) {
  const p = geo.attributes.position, uv = geo.attributes.uv, out = new Float32Array(uv.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < p.count; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    const front = b.sub(a).cross(c.sub(a)).z >= 0;
    for (let i = t; i < t + 3; i++) { out[i * 2] = uv.getX(i); out[i * 2 + 1] = (front ? 0.5 : 0) + 0.5 * (1 - uv.getY(i)); }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(out, 2));
  return geo;
}

// The mesh comes faceted (every triangle has its own corners). A sheet of
// paper is smooth: average the normals of the faces that meet at a point,
// front and back kept apart.
function smoothBill(source) {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  const p = geo.attributes.position, n = p.count, face = new Float32Array(n * 3), out = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    b.sub(a); c.sub(a); b.cross(c); // length = twice the area: bigger faces count for more
    for (let k = 0; k < 3; k++) b.toArray(face, (t + k) * 3);
  }
  const at = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(p.getX(i) * 20) + ',' + Math.round(p.getY(i) * 20) + ',' + Math.round(p.getZ(i) * 20);
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(i);
  }
  for (const group of at.values()) for (const i of group) {
    a.fromArray(face, i * 3); c.set(0, 0, 0);
    for (const j of group) { b.fromArray(face, j * 3); if (a.dot(b) > 0.5 * a.length() * b.length()) c.add(b); }
    c.normalize().toArray(out, i * 3);
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

// Paper in the sun: lit on the side that faces it, glowing a little where
// the sun is behind the sheet, with the sky and the water filling in.
function makeBillMaterial(sky, map, { tint = 0xffffff, sheen = 0.16, lift = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sky.uniforms, map: { value: map }, tint: { value: new THREE.Color(tint) }, sheen: { value: sheen }, lift: { value: lift } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vUv = uv; vN = mat3(m) * normal; vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
      uniform sampler2D map; uniform vec3 tint; uniform float sheen; uniform float lift;
      uniform vec3 sunLight; uniform vec3 skyLight; uniform vec3 bounceLight;
      varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
      void main() {
        vec3 N = normalize(vN);
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float ndl = dot(N, sunDir);
        vec3 albedo = texture2D(map, vUv).rgb * tint;
        vec3 light = sunLight * (max(ndl, 0.0) + 0.42 * max(-ndl, 0.0))
          + skyLight * (0.6 + 0.4 * N.y)
          + bounceLight * (0.5 - 0.5 * N.y)
          + vec3(0.05, 0.06, 0.12) * (0.8 - 0.5 * N.y);
        // Print keeps its colours: a flatter light, never blown out.
        light = vec3(0.14 + lift) + light * 0.60;
        float spec = pow(max(dot(N, normalize(sunDir + V)), 0.0), 14.0) * step(0.0, ndl);
        vec3 col = albedo * light + sunLight * spec * sheen;
        col = applyHaze(col, dist, -V);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

let assets = null;
export async function loadGullAssets() {
  const loader = new GLTFLoader();
  const [gull, bill, billTex] = await Promise.all([
    loader.loadAsync(asset('../assets/seagull/seagull.glb')),
    loader.loadAsync(asset('../assets/seagull/bill.glb')),
    new THREE.TextureLoader().loadAsync(asset('./assets/bill/bill-100.jpg')).catch(() => null),
  ]);
  let billMesh = null;
  bill.scene.traverse((o) => { if (o.isMesh && !billMesh) billMesh = o; });
  if (billTex) { billTex.colorSpace = THREE.SRGBColorSpace; billTex.anisotropy = 8; }
  assets = { gull, billMesh, billTex };
  return assets;
}

export function createGulls({ scene, world, ocean, sky, listener, billWidth = BILL_W, onPickup = () => {}, onMiss = () => {} }) {
  const course = world.course, { SAMPLES, pts, tans, rights, lineLat, step, length } = course;
  const wrapI = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const idxAt = (dist) => wrapI(Math.round(dist / step));

  // ---------- the bills ----------
  // Runs of bills along the racing line, with gaps between runs.
  const bills = [];
  const rampDist = world.ramps.map((r) => r.idx * step);
  {
    let run = 0;
    for (let d = 34; d < length - 26; d += SPACING) {
      const nearRamp = rampDist.some((r) => d > r - 9 && d < r + 30);
      run++;
      if (nearRamp || run % 9 >= 7) continue;
      const i = idxAt(d);
      bills.push({
        d, idx: i, x: pts[i].x + rights[i].x * lineLat[i], z: pts[i].z + rights[i].z * lineLat[i], h: 1.15,
        yaw: Math.atan2(-tans[i].x, -tans[i].z), gold: false, state: 0, t: 0, ph: (d * 0.37) % 6.28, from: new THREE.Vector3(), pos: new THREE.Vector3(),
      });
    }
    // Golden bills: up where a good jump carries you.
    for (const r of world.ramps) {
      const d = r.idx * step + 12, i = idxAt(d);
      bills.push({ d, idx: i, x: pts[i].x, z: pts[i].z, h: 3.7, yaw: Math.atan2(-tans[i].x, -tans[i].z), gold: true, state: 0, t: 0, ph: d % 6.28, from: new THREE.Vector3(), pos: new THREE.Vector3() });
    }
    bills.sort((a, b) => a.d - b.d);
  }
  const total = bills.length;

  const billGeo = smoothBill(assets.billMesh.geometry);
  if (assets.billTex) atlasUv(billGeo);
  const k = billWidth / BILL_LEN;
  // The mesh as the opening places it: scaled, centred on its twist.
  const billBase = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -8.54 * k), assets.billMesh.quaternion.clone(), new THREE.Vector3(k, k, k));
  // The drawn face is the fallback if the photo doesn't load.
  const billTex = assets.billTex || makeBillTexture();
  const MAXI = 40;
  // The mesh is a closed sheet with a printed front and back, so only the
  // faces toward the eye are drawn.
  const billMesh = new THREE.InstancedMesh(billGeo, makeBillMaterial(sky, billTex), MAXI);
  const goldMesh = new THREE.InstancedMesh(billGeo, makeBillMaterial(sky, billTex, { tint: 0xffc61f, sheen: 0.9, lift: 0.22 }), 6);
  for (const m of [billMesh, goldMesh]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
  // A golden halo behind each bill so the trail reads from far away, against
  // bright water as well as dark rock. It sits a metre behind the bill (the
  // bill is drawn clean in front of it), is never smaller than about a
  // degree, and fades as you come close.
  // The halo shrinks less than the bill, so a smaller bill still shows from far away.
  const glowScale = 0.5 + 0.5 * billWidth / 1.45;
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,250,215,1)'); grad.addColorStop(0.3, 'rgba(255,224,96,.85)'); grad.addColorStop(0.65, 'rgba(255,200,40,.32)'); grad.addColorStop(1, 'rgba(255,190,30,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowGeo = new THREE.BufferGeometry();
  const glowPos = new Float32Array((MAXI + 6) * 3), glowSize = new Float32Array(MAXI + 6);
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3).setUsage(THREE.DynamicDrawUsage));
  glowGeo.setAttribute('size', new THREE.BufferAttribute(glowSize, 1).setUsage(THREE.DynamicDrawUsage));
  const glowUniforms = { map: { value: glowTex }, viewH: { value: 720 } };
  const glow = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false,
    uniforms: glowUniforms,
    vertexShader: /* glsl */`
      attribute float size; uniform float viewH; varying float vFade;
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float d = max(0.5, -mv.z);
        mv.xyz *= (d + 1.0) / d;
        float px = viewH * 0.5 * projectionMatrix[1][1]; // pixels across one radian
        vFade = 0.3 + 0.7 * smoothstep(8.0, 30.0, d);
        gl_PointSize = clamp(size * px / d, 0.017 * px, 0.14 * px);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'uniform sampler2D map; varying float vFade; void main() { vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * 0.9 * vFade); }',
  }));
  glow.frustumCulled = false;
  const _view = new THREE.Vector2();
  glow.onBeforeRender = (renderer, _scene, camera) => {
    glowUniforms.viewH.value = camera.viewport ? camera.viewport.w : renderer.getDrawingBufferSize(_view).y;
  };
  scene.add(glow);

  // ---------- the flock ----------
  const flock = [];
  for (let i = 0; i < FLOCK; i++) {
    const model = cloneSkinned(assets.gull.scene);
    model.scale.setScalar(2.1);
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const holder = new THREE.Group();
    holder.add(model);
    scene.add(holder);
    const mixer = new THREE.AnimationMixer(model);
    const fly = mixer.clipAction(THREE.AnimationClip.findByName(assets.gull.animations, 'fly'));
    const glide = mixer.clipAction(THREE.AnimationClip.findByName(assets.gull.animations, 'glide'));
    fly.play(); glide.play();
    fly.timeScale = 0.85 + (i % 3) * 0.08;
    mixer.setTime(i * 0.13);
    flock.push({
      holder, model, mixer, fly, glide, flap: 1, mood: i * 1.7, dip: 0,
      heading: 0, turn: 0, bank: 0, pitch: 0, flapping: true, flapT: 0.4 + i * 0.37,
      off: { along: -i * 6 + (i % 2) * 3, lat: (i - (FLOCK - 1) / 2) * 3.2, up: 9 + (i * 1.9) % 4 },
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), voice: null,
    });
  }
  // Two of them have a voice (calls and wing beats carry over the water).
  for (const gI of [0, 3]) {
    try {
      const v = new GullVoice(listener, flock[gI].holder);
      v.audio.setRefDistance(16); v.audio.setRolloffFactor(1);
      flock[gI].voice = v;
    } catch { /* no audio */ }
  }

  const state = { money: 0, combo: 0, best: 0, taken: 0, total, lead: 0, first: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _t = new THREE.Vector3();
  const archDist = world.arches.map((a) => a.idx * step);

  function hoverPos(b, t, out) {
    return out.set(b.x, ocean.heightAt(b.x, b.z, t) * 0.5 + b.h + Math.sin(t * 2.1 + b.ph) * 0.07, b.z);
  }

  function reset(t = 0) {
    Object.assign(state, { money: 0, combo: 0, best: 0, taken: 0, lead: 20, first: 0 });
    for (const b of bills) { b.state = 0; b.t = 0; }
    // The first stretch is already laid out when you sit down.
    for (const b of bills) if (b.d < 95) b.state = 2;
    flock.forEach((g, i) => {
      const p = target(g, state.lead, t, _p);
      g.pos.copy(p); g.vel.set(0, 0, 0);
      g.holder.position.copy(p);
    });
  }

  // Where a gull wants to be: its place in the formation around the lead point.
  function target(g, lead, t, out) {
    const d = lead + g.off.along, i = idxAt(d);
    let up = g.off.up + Math.sin(t * 0.7 + g.mood) * 1.2;
    for (const a of archDist) if (Math.abs(d - a) < 26) up = Math.min(up, 6.2);
    const lat = lineLat[i] + g.off.lat * (course.walled[i] ? 0.45 : 1) + Math.sin(t * 0.45 + g.mood * 2) * 1.5;
    return out.set(pts[i].x + rights[i].x * lat, up - g.dip, pts[i].z + rights[i].z * lat);
  }

  // dist: the player's distance along the lap in metres; active: racing.
  function update(dt, t, player, dist, active, hands = []) {
    // The flock keeps its lead, and never comes back.
    const want = Math.min(length + 30, dist + LEAD);
    if (active) state.lead = Math.max(state.lead, Math.min(want, state.lead + Math.max(34, player.speed * 1.5) * dt));
    const circling = !active || state.lead >= length + 29;

    for (const g of flock) {
      target(g, state.lead, t, _t);
      if (circling) {
        // Wheel around over the same spot.
        const a = t * 0.5 + g.mood, r = 9 + (g.mood % 3) * 2.5;
        _t.x += Math.cos(a) * r; _t.z += Math.sin(a) * r; _t.y += 2;
      }
      // Spring toward the target, so they bank and swoop rather than slide.
      g.vel.x += ((_t.x - g.pos.x) * 3.2 - g.vel.x * 3.0) * dt;
      g.vel.y += ((_t.y - g.pos.y) * 4.0 - g.vel.y * 3.4) * dt;
      g.vel.z += ((_t.z - g.pos.z) * 3.2 - g.vel.z * 3.0) * dt;
      g.pos.addScaledVector(g.vel, dt);
      g.dip = Math.max(0, g.dip - dt * 3);
      g.holder.position.copy(g.pos);
      const sp = Math.hypot(g.vel.x, g.vel.z);
      // Like a glider: banked into the turn as far as the turn needs, nose
      // up in a climb and down in a dive.
      if (sp > 0.5) {
        const heading = Math.atan2(g.vel.x, g.vel.z);
        let dh = heading - g.heading;
        dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
        g.heading = heading;
        g.turn += (dh / Math.max(dt, 1e-3) - g.turn) * Math.min(1, dt * 4);
        const bank = Math.max(-0.95, Math.min(0.95, Math.atan((sp * g.turn) / 9.8)));
        g.bank += (bank - g.bank) * Math.min(1, dt * 3);
        g.pitch += (Math.max(-0.45, Math.min(0.45, Math.atan2(g.vel.y, sp) * 0.8)) - g.pitch) * Math.min(1, dt * 3);
        g.holder.rotation.set(-g.pitch, heading, -g.bank, 'YXZ');
      }
      // Gulls glide most of the time and flap in short bursts of a few
      // beats; they flap too to climb or to catch up with the flock.
      g.flapT -= dt;
      if (g.flapT <= 0) {
        g.flapping = !g.flapping;
        g.flapT = g.flapping ? 0.8 + Math.random() * 1.1 : 1.8 + Math.random() * 3.4;
      }
      const behind = Math.hypot(_t.x - g.pos.x, _t.z - g.pos.z);
      const wantFlap = g.flapping || g.vel.y > 0.7 || sp < 8 || behind > 7 ? 1 : 0.04;
      g.flap += (wantFlap - g.flap) * Math.min(1, dt * 4);
      g.fly.setEffectiveWeight(g.flap); g.glide.setEffectiveWeight(1 - g.flap);
      g.mixer.update(dt);
      if (g.voice && Math.random() < dt * 0.22) g.voice.call(Math.random() < 0.5 ? 0 : 1);
    }

    // Drop the bills the flock passes over.
    for (let n = state.first; n < bills.length; n++) {
      const b = bills[n];
      if (b.d > state.lead + 4) break;
      if (b.state !== 0) continue;
      let best = flock[0], bd = Infinity;
      for (const g of flock) { const d = (g.pos.x - b.x) ** 2 + (g.pos.z - b.z) ** 2; if (d < bd) { bd = d; best = g; } }
      b.state = 1; b.t = 0; b.from.copy(best.pos).y -= 0.4;
      best.dip = 1.2;
      if (best.voice && Math.random() < 0.5) best.voice.call(1);
    }

    // Move, draw and collect the bills near the player.
    let nb = 0, ng = 0, np = 0;
    while (state.first < bills.length && bills[state.first].d < dist - 14 && bills[state.first].state >= 3) state.first++;
    for (let n = state.first; n < bills.length; n++) {
      const b = bills[n];
      if (b.d > dist + 190) break;
      if (b.state === 0) continue;
      b.t += dt;
      // It turns slowly on the spot, each bill a little ahead of the last, so
      // a row of them turns like a wave.
      let scale = b.gold ? 1.6 : 1, spin = t * SPIN + b.d * 0.08, tilt = Math.sin(t * 1.3 + b.ph) * 0.16;
      if (b.state === 1) {
        // Flutter down from the gull: swing side to side, tumbling, then settle.
        const kf = Math.min(1, b.t / 1.5), e = kf * kf * (3 - 2 * kf);
        hoverPos(b, t, _p);
        b.pos.lerpVectors(b.from, _p, e);
        const sway = Math.sin(b.t * 6 + b.ph) * (1 - e) * 1.2;
        b.pos.x += Math.cos(b.yaw) * sway; b.pos.z -= Math.sin(b.yaw) * sway;
        spin += (1 - e) * (b.t * 7); tilt += (1 - e) * Math.sin(b.t * 9) * 0.9;
        if (kf >= 1) b.state = 2;
      } else if (b.state === 2) {
        hoverPos(b, t, b.pos);
        const dx = player.x - b.x, dz = player.z - b.z;
        const reach = PICK + PICK_HELP * (1 - state.combo / MAX_COMBO);
        let got = dx * dx + dz * dz < reach * reach && Math.abs(b.pos.y - (player.y + 1.1)) < (b.gold ? 2.2 : 1.9);
        // A free hand can snatch a bill too.
        if (!got) for (const h of hands) if (h.distanceToSquared(b.pos) < 0.3) { got = true; break; }
        if (got && active) {
          b.state = 3; b.t = 0; b.from.copy(b.pos);
          state.taken++;
          state.combo = Math.min(MAX_COMBO, state.combo + 1);
          state.best = Math.max(state.best, state.combo);
          const value = b.gold ? GOLD_VALUE : STEP_VALUE * state.combo;
          state.money += value;
          onPickup(b, value);
        } else if (active && dist > b.d + 8) {
          b.state = 4; b.t = 0;
          if (!b.gold) { state.combo = Math.max(0, state.combo - 1); onMiss(b); }
        }
      }
      if (b.state === 3) {
        // Taken: it flies to the rider's chest, spinning, and is gone.
        const kf = b.t / 0.2;
        if (kf >= 1) continue;
        _p.set(player.x - Math.sin(player.yaw) * 0.5, player.y + 1.15, player.z - Math.cos(player.yaw) * 0.5);
        b.pos.lerpVectors(b.from, _p, kf);
        scale *= 1 - 0.75 * kf; spin += b.t * 30;
      } else if (b.state === 4) {
        const kf = b.t / 0.8;
        if (kf >= 1) continue;
        hoverPos(b, t, b.pos); b.pos.y += kf * 1.5; scale *= 1 - kf;
      }
      _q.setFromEuler(_e.set(tilt * 0.6, b.yaw + Math.PI + spin, tilt, 'YXZ'));
      _m.compose(b.pos, _q, _s.setScalar(scale)).multiply(billBase);
      if (b.gold) { if (ng < 6) goldMesh.setMatrixAt(ng++, _m); }
      else if (nb < MAXI) billMesh.setMatrixAt(nb++, _m);
      if (np < MAXI + 6 && b.state <= 2) { glowPos[np * 3] = b.pos.x; glowPos[np * 3 + 1] = b.pos.y; glowPos[np * 3 + 2] = b.pos.z; glowSize[np] = (b.gold ? 3.4 : 2.1) * glowScale; np++; }
    }
    billMesh.count = nb; goldMesh.count = ng;
    billMesh.instanceMatrix.needsUpdate = true; goldMesh.instanceMatrix.needsUpdate = true;
    glowGeo.setDrawRange(0, np);
    glowGeo.attributes.position.needsUpdate = true; glowGeo.attributes.size.needsUpdate = true;
  }

  // A wall hit shakes some of the combo out.
  function knock() { state.combo = Math.max(0, state.combo - 3); }

  return { state, bills, flock, reset, update, knock, setVolume(v) { for (const g of flock) if (g.voice) g.voice.setLevel(v, 0.3); } };
}
