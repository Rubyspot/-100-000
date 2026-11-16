// $100,000 jetski race.
// Seated VR at sunset: race Jane around the archipelago, through a sandstone
// gorge with a waterfall, a turquoise lagoon and the canals of a little
// town, while seagulls drop $100 bills you catch with your free hand.
// Controls are hands first and one-handed: either hand makes a fist on its
// grip, and that's full throttle. Tilt the fist to steer (like turning a
// dial); pushing or pulling it around the bar works too. Open the hand to
// coast. The other hand stays free to catch bills. Controllers and the
// keyboard work as fallbacks for testing.
// Mechanics: Hype builds with every gate cleared without touching a wall
// (up to x5): more top speed and more money per bill. Gold cash rings and
// big jumps give a boost.
import * as THREE from 'three';
import { createSky, SUN_DIR, HAZE_COLOR } from './sky.js';
import { createOcean } from './ocean.js';
import { buildCourse } from './track.js';
import { Craft } from './craft.js';
import { loadJetski, makeJetski, makeRider, HEAD_Y } from './models.js';
import { createWake, createSpray, createStreaks } from './effects.js';
import { Sfx } from './sfx.js';
import { createGulls } from './gulls.js';
import { createDolphins } from './dolphins.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const LAPS = Math.max(1, Math.min(5, parseInt(params.get('laps') || '2', 10) || 2));
const USE_VIGNETTE = params.get('vignette') !== '0';
const HEAVE = params.get('heave') === '0' ? 0 : 1; // 0 keeps the rider's view at a fixed height
const MUSIC = params.get('music') !== '0';
const STREAKS = params.get('streaks') !== '0';
const STEER = ['twist', 'bar', 'sway', 'mix'].includes(params.get('steer')) ? params.get('steer') : 'mix';
const TWIST_FULL = THREE.MathUtils.degToRad(parseFloat(params.get('twist')) || 32); // fist tilt for full lock
const SQUEEZE = params.has('squeeze');     // old throttle: squeeze the fist for more
const AUTOPILOT = params.has('autopilot'); // drives itself, for testing
const CHASE = params.has('chase');         // flat preview from behind
const MAP = params.has('map');             // flat preview from above, for checking the course
const START_AT = params.has('at') ? parseFloat(params.get('at')) : null; // preview: start at a control point
const PLAYER_COLOR = 0xffc812;
const JANE_COLOR = 0xff4fa3;
const MAX_HYPE = 5;
const GOAL = 100000;    // the song's number: catch this much in one race
const RING_CASH = 2500; // each cash ring
const TRACKS = ['./audio/seagulls-love-too.mp3', './audio/indecision-let-that-go.mp3', './audio/on-my-own.mp3'];

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// ---------- renderer, scene, camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
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

const sky = createSky(renderer);
scene.add(sky.dome);
scene.environment = sky.env;
scene.fog = new THREE.FogExp2(HAZE_COLOR.getHex(), 0.0007);
scene.add(new THREE.HemisphereLight(0x9a86cc, 0x2a3048, 1.1));
const sunLight = new THREE.DirectionalLight(0xffa468, 2.6);
sunLight.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sunLight);

const track = buildCourse(scene);
const ocean = createOcean({ sky, landTexture: track.landTexture, landBounds: track.landBounds, landDist: track.landDist });
scene.add(ocean.mesh);

const listener = new THREE.AudioListener();
camera.add(listener);
const sfx = new Sfx(listener);
const gulls = createGulls({ scene, listener, sfx, ocean });
const dolphins = createDolphins({ scene, track, ocean, sfx });

const playerWake = createWake(scene, ocean);
const janeWake = createWake(scene, ocean);
const spray = createSpray(scene, sky.uniforms.sunColor.value);

// Chevron over the next gate.
const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 4), new THREE.MeshBasicMaterial({ color: 0x9cffb0, fog: false }));
chevron.rotation.x = Math.PI;
scene.add(chevron);

// ---------- canvas text ----------

function makeTextTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const api = { tex, redraw: (...a) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h, ...a); tex.needsUpdate = true; } };
  api.redraw();
  return api;
}

// Start / finish banner on gate 0.
{
  const g = track.gates[0];
  const banner = makeTextTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = '#1b1030'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffc812'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
    ctx.font = '700 92px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8fd18a'; ctx.fillText('$100,000  ·  START / FINISH', w / 2, h / 2 + 4);
  });
  const width = g.half * 1.5;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 160 / 1024),
    new THREE.MeshBasicMaterial({ map: banner.tex, side: THREE.DoubleSide, toneMapped: false }));
  mesh.position.set(0, 6.4, 0.4);
  g.group.add(mesh);
}

// ---------- craft and rider rig ----------

const player = { craft: new Craft(), ski: null };
const jane = { craft: new Craft(), ski: null };

// The holder follows the player's jetski (heading, and height smoothed);
// the rig inside it is the XR reference space, moved so the calibrated
// head sits on the seat. The view never pitches or rolls with the hull.
const holder = new THREE.Group();
scene.add(holder);
const rig = new THREE.Group();
holder.add(rig);
rig.add(camera);
camera.position.set(0, HEAD_Y, 0);
const streaks = STREAKS ? createStreaks(holder) : null;

// ---------- HUD ----------

const dash = makeTextTexture(512, 288, (ctx, w, h, info = {}) => {
  ctx.fillStyle = 'rgba(16,10,30,.86)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 26); ctx.fill();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = info.rank === 1 ? '#8fd18a' : '#ff8fc0';
  ctx.font = '800 92px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(info.rank === 1 ? '1st' : info.rank === 2 ? '2nd' : '—', 28, 100);
  ctx.fillStyle = '#eef6f7';
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillText(info.time || '0:00.0', 30, 152);
  ctx.fillStyle = '#b8a8d0';
  ctx.font = '500 28px system-ui, sans-serif';
  ctx.fillText(info.lap || '', 30, 194);
  ctx.fillStyle = '#9cff9c';
  ctx.font = '800 50px system-ui, sans-serif';
  ctx.fillText(info.cash || '$0', 30, 252);
  // Progress toward $100,000.
  const k = Math.min(1, (info.money || 0) / GOAL);
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.roundRect(30, 266, 260, 10, 5); ctx.fill();
  ctx.fillStyle = k >= 1 ? '#ffd23f' : '#9cff9c'; ctx.beginPath(); ctx.roundRect(30, 266, Math.max(10, 260 * k), 10, 5); ctx.fill();
  // Hype pips.
  const hype = info.hype || 0;
  for (let i = 0; i < MAX_HYPE; i++) {
    ctx.fillStyle = i < hype ? (hype === MAX_HYPE ? '#ffd23f' : '#ff8fc0') : 'rgba(255,255,255,.14)';
    ctx.beginPath(); ctx.roundRect(300 + i * 38, 20, 30, 16, 6); ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = hype ? '#ffd23f' : '#6f6488';
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.fillText(`HYPE x${hype + 1}`, w - 30, 66);
  ctx.fillStyle = info.boost ? '#ffd23f' : '#eef6f7';
  ctx.font = '700 64px system-ui, sans-serif';
  ctx.fillText(String(info.kmh ?? 0), w - 30, 252);
  ctx.font = '500 24px system-ui, sans-serif';
  ctx.fillStyle = '#b8a8d0';
  ctx.fillText(info.boost ? 'BOOST' : 'km/h', w - 30, 190);
  if (info.fps) ctx.fillText(info.fps + ' fps', w - 30, 278);
  if (info.arrow !== undefined) {
    ctx.save();
    ctx.translate(w - 200, 130);
    ctx.rotate(info.arrow);
    ctx.fillStyle = '#9cffb0';
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(26, 16); ctx.lineTo(0, 4); ctx.lineTo(-26, 16); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
});
const dashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.169), new THREE.MeshBasicMaterial({ map: dash.tex, transparent: true, fog: false, toneMapped: false }));

const panel = makeTextTexture(1024, 256, (ctx, w, h, text = '', sub = '') => {
  if (!text) return;
  ctx.fillStyle = 'rgba(16,10,30,.78)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 40); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffc812';
  ctx.font = `800 ${sub ? 92 : 110}px system-ui, sans-serif`;
  ctx.fillText(text, w / 2, sub ? 96 : h / 2 + 4, w - 60);
  if (sub) {
    ctx.fillStyle = '#eef6f7';
    ctx.font = '500 46px system-ui, sans-serif';
    ctx.fillText(sub, w / 2, 186, w - 60);
  }
});
const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.425), new THREE.MeshBasicMaterial({ map: panel.tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
panelMesh.position.set(0, HEAD_Y + 0.25, -2.6);
panelMesh.renderOrder = 20;
holder.add(panelMesh);
let panelKey = '';
function showPanel(text, sub = '') {
  const key = text + '|' + sub;
  if (key === panelKey) return;
  panelKey = key;
  panel.redraw(text, sub);
  panelMesh.visible = !!text;
}

// Comfort vignette: darkens the edges of view while turning.
const vignette = new THREE.Mesh(
  new THREE.SphereGeometry(0.3, 24, 12),
  new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { strength: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float strength; varying vec3 vDir;
      void main() { float f = -normalize(vDir).z; gl_FragColor = vec4(0.0, 0.0, 0.0, strength * (1.0 - smoothstep(0.45, 0.82, f))); }`,
  }),
);
vignette.renderOrder = 100;
vignette.frustumCulled = false;
vignette.visible = false;
camera.add(vignette);

// Drenched: a cool white veil after riding through the waterfall.
const drench = new THREE.Mesh(
  new THREE.SphereGeometry(0.25, 16, 8),
  new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
    uniforms: { amount: { value: 0 }, time: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float amount; uniform float time; varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      void main() {
        vec3 d = normalize(vDir);
        vec2 p = d.xy / max(0.2, -d.z) * 9.0 + vec2(0.0, time * 0.6);
        vec2 c = floor(p); vec2 f = fract(p) - 0.5;
        float drop = smoothstep(0.22, 0.0, length(f - (vec2(h(c), h(c + 3.1)) - 0.5) * 0.5)) * step(0.55, h(c + 7.0));
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.0), amount * (0.35 + drop * 0.5));
      }`,
  }),
);
drench.renderOrder = 99;
drench.frustumCulled = false;
drench.visible = false;
camera.add(drench);

// ---------- hands ----------

const TIP_JOINTS = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'];
const KNUCKLE_JOINTS = ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'];
const handMat = new THREE.MeshLambertMaterial({ color: 0xc89a7c });
const jointSphere = new THREE.IcosahedronGeometry(1, 1);
const hands = [0, 1].map((i) => {
  const space = renderer.xr.getHand(i);
  rig.add(space);
  const dots = new THREE.InstancedMesh(jointSphere, handMat, 25);
  dots.frustumCulled = false;
  dots.count = 0;
  rig.add(dots);
  const h = {
    space, dots, handedness: null, closed: false, grabbing: false, ratio: 2, tracked: false,
    palm: new THREE.Vector3(), palmWorld: new THREE.Vector3(), knuckle: new THREE.Vector3(),
    neutral: null, // pose captured when the grip is taken: { twist, bar, x }
  };
  space.addEventListener('connected', (e) => { h.handedness = e.data.handedness; });
  space.addEventListener('disconnected', () => { h.handedness = null; h.tracked = false; h.grabbing = false; dots.count = 0; });
  return h;
});
const controllerGrips = [0, 1].map((i) => { const g = renderer.xr.getControllerGrip(i); rig.add(g); return g; });

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _rigRot = new THREE.Quaternion();
// Joint positions are in the rig's space; rig.matrix takes them to the
// holder's space, where the grips are compared too.
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
  h.ratio = ratio / 3;
  if (h.closed && h.ratio > 1.58) h.closed = false;
  else if (!h.closed && h.ratio < 1.38) h.closed = true;
  _a.copy(wrist.position).lerp(joints['middle-finger-phalanx-proximal'].position, 0.6);
  rig.updateMatrix();
  h.palm.copy(_a).applyMatrix4(rig.matrix);
  h.palmWorld.copy(h.palm);
  holder.localToWorld(h.palmWorld);
  // Knuckle line (index to pinky knuckles), in the holder's space: its
  // tilt in the frontal plane is the "twist" used for steering.
  const ik = joints['index-finger-phalanx-proximal'], pk = joints['pinky-finger-phalanx-proximal'];
  if (ik && pk) {
    _rigRot.setFromRotationMatrix(rig.matrix);
    h.knuckle.subVectors(ik.position, pk.position).applyQuaternion(_rigRot);
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Fist tilt in the frontal plane, counter-clockwise positive (seen from behind).
const twistOf = (v) => Math.atan2(v.y, v.x);

// ---------- calibration ----------
// Put the player's head on the seat, facing along the jetski.

let calibrated = false;
function calibrate() {
  const head = camera.position;
  const fwd = _a.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  rig.rotation.set(0, -yaw, 0);
  _b.set(head.x, 0, head.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
  rig.position.set(-_b.x, HEAD_Y - head.y, -_b.z);
  rig.updateMatrix();
  calibrated = true;
}

// ---------- race state ----------

const race = {
  state: 'loading', clock: 0, countdown: 0, nextGate: 1, lap: 1, s: 0, idx: 0, finish: null, rank: 2,
  barkAt: -99, msgUntil: 0, needRelease: false, doneAt: 0, prevAlong: undefined, xrStart: 0,
  hype: 0, clean: true, bestHype: 0, freeSide: -1, lastBeep: 0, wfSide: 0,
};
const ai = { s: 0, idx: 0, finish: null, lat: 3.5, prevWf: 0 };
let START_U = 8 / track.length;
let elapsed = 0;

function resetRace() {
  if (START_AT !== null && !renderer.xr.isPresenting) START_U = track.uOf(Math.floor(START_AT)) + 0.0005;
  const { p, t, r } = track.at(START_U);
  const yaw = Math.atan2(-t.x, -t.z);
  player.craft.reset(p.x - r.x * 3.5, p.z - r.z * 3.5, yaw);
  jane.craft.reset(p.x + r.x * 3.5, p.z + r.z * 3.5, yaw);
  for (const c of [player.craft, jane.craft]) c.y = ocean.heightAt(c.x, c.z, elapsed) - 0.2;
  Object.assign(race, { state: 'ready', clock: 0, nextGate: 1, lap: 1, s: START_U, finish: null, rank: 2, prevAlong: undefined, hype: 0, clean: true, bestHype: 0 });
  race.idx = Math.round(START_U * track.SAMPLES) % track.SAMPLES;
  if (START_AT !== null) {
    // Testing from mid-course: aim at the next gate ahead.
    race.nextGate = track.gates.findIndex((g) => g.idx > race.idx);
    if (race.nextGate < 0) race.nextGate = 0;
  }
  Object.assign(ai, { s: START_U, idx: race.idx, finish: null, lat: 3.5 });
  for (const g of track.gates) g.flash = 0;
  track.gates.setNext(race.nextGate);
  for (const r of track.rings) r.cool = 0;
  goalHit = false;
  playerWake.reset(); janeWake.reset();
  gulls.reset();
  showPanel('Grab a grip', 'Fist on it = go. Tilt it to steer. Free hand catches bills!');
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
const money = (n) => '$' + n.toLocaleString('en-US');

let goalHit = false;
function addMoney(n, now) {
  gulls.state.money += n;
  checkGoal(now);
}
function checkGoal(now) {
  if (goalHit || gulls.state.money < GOAL || race.state !== 'race') return;
  goalHit = true;
  sfx.fanfare(true);
  race.msgUntil = now + 3;
  showPanel('$100,000!', '“Okay, you can keep it. This time.”');
}

gulls.state.onCatch = (n) => {
  checkGoal(elapsed);
  if (n === 5) bark('Ooh, five bills! Save some for me!', elapsed, true);
  else if (n === 10) bark(`${money(gulls.state.money)}?! The gulls like you!`, elapsed, true);
  else if (n === 20) bark('Okay, now you’re showing off.', elapsed, true);
};

function setHype(n, now) {
  n = Math.max(0, Math.min(MAX_HYPE, n));
  if (n < race.hype && race.hype >= 2 && race.state === 'race') {
    sfx.hypeLost();
    if (now - race.barkAt > 8) bark('Ha! Bye-bye, hype!', now);
  }
  race.hype = n;
  race.bestHype = Math.max(race.bestHype, n);
  gulls.state.value = 100 * (n + 1);
  player.craft.thrustScale = 1 + 0.06 * n;
}

// ---------- input ----------

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));

const input = { throttle: 0, steer: 0, engaged: false, barAngle: 0, gripL: false, gripR: false, rider: null };
const GRAB_RADIUS = 0.2;
const BAR_LOCK = 0.45; // rad of bar push for full steering
const SWAY_FULL = 0.12; // m of sideways fist travel for full steering
const DEAD = 0.05;
const grips = [new THREE.Vector3(), new THREE.Vector3()];
const barCentre = new THREE.Vector3();
const ctrlNeutral = new Map();
const _cx = new THREE.Vector3();

// Bar angle a hand gives, from where it is around the bar's pivot
// (right hand forward = turn left, left hand back = turn left).
function barAngleOf(h) {
  const dz = h.palm.z - barCentre.z, dx = h.palm.x - barCentre.x;
  return h.handedness === 'left' ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx);
}

function steerFromHand(h) {
  const n = h.neutral;
  // The tilt is only defined while the knuckle line lies mostly across the
  // view; if it points along the bike, keep the last value.
  const v = h.knuckle, planar = Math.hypot(v.x, v.y);
  if (planar > 0.45 * v.length()) h.lastTwist = wrapAngle(twistOf(v) - n.twist) / TWIST_FULL;
  const twist = h.lastTwist || 0;
  const bar = wrapAngle(barAngleOf(h) - n.bar) / BAR_LOCK;
  const sway = -(h.palm.x - n.x) / SWAY_FULL;
  const s = STEER === 'twist' ? twist : STEER === 'bar' ? bar : STEER === 'sway' ? sway : twist + bar * 0.8;
  return Math.abs(s) < DEAD ? 0 : s - Math.sign(s) * DEAD;
}

function readInput() {
  let throttle = 0, steer = 0, engaged = false;
  const ski = player.ski;
  // Grip and pivot positions in the holder's space, with the bar straight.
  ski.bar.rotation.y = 0;
  ski.root.updateMatrixWorld(true);
  holder.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) holder.worldToLocal(ski.grips[i].getWorldPosition(grips[i]));
  holder.worldToLocal(ski.bar.getWorldPosition(barCentre));

  const riding = [];
  for (const h of hands) {
    updateHand(h);
    if (!h.tracked) { h.grabbing = false; continue; }
    const grip = grips[h.handedness === 'left' ? 0 : 1];
    if (!h.closed) h.grabbing = false;
    else if (!h.grabbing && h.palm.distanceTo(grip) < GRAB_RADIUS) {
      h.grabbing = true;
      h.neutral = { twist: twistOf(h.knuckle), bar: barAngleOf(h), x: h.palm.x };
      h.lastTwist = 0;
      h.grabbedAt = elapsed;
    }
    if (h.grabbing) riding.push(h);
  }
  // One hand rides; with both on the bar, the steering averages.
  if (riding.length) {
    for (const h of riding) steer += steerFromHand(h);
    steer /= riding.length;
    throttle = 1;
    if (SQUEEZE) {
      const r = riding.find((h) => h.handedness === 'right') || riding[0];
      throttle = THREE.MathUtils.clamp(0.5 + (1.32 - r.ratio) * 2.5, 0.5, 1);
    }
    engaged = true;
    const first = riding.reduce((a, b) => (a.grabbedAt <= b.grabbedAt ? a : b));
    input.rider = first.handedness;
  }
  input.gripL = riding.some((h) => h.handedness === 'left');
  input.gripR = riding.some((h) => h.handedness === 'right');
  // The free hand: the one not riding (left if both or neither).
  race.freeSide = input.gripL && !input.gripR ? 1 : -1;

  // Controllers (fallback): trigger or grip = go, tilt the controller or
  // push the thumbstick to steer.
  const session = renderer.xr.getSession();
  if (session) {
    let ci = 0;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp || src.hand) continue;
      const grip = controllerGrips[ci++];
      const pressed = (gp.buttons[0] && gp.buttons[0].value > 0.3) || (gp.buttons[1] && gp.buttons[1].pressed);
      if (pressed) {
        throttle = Math.max(throttle, gp.buttons[0] ? Math.max(gp.buttons[0].value, gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0) : 1);
        engaged = true;
        if (grip) {
          rig.updateMatrix();
          _rigRot.setFromRotationMatrix(rig.matrix);
          _cx.set(1, 0, 0).applyQuaternion(grip.quaternion).applyQuaternion(_rigRot);
          if (!ctrlNeutral.has(src)) ctrlNeutral.set(src, twistOf(_cx));
          const v = wrapAngle(twistOf(_cx) - ctrlNeutral.get(src)) / TWIST_FULL;
          if (Math.abs(v) > DEAD) steer += v - Math.sign(v) * DEAD;
        }
        race.freeSide = src.handedness === 'right' ? -1 : 1;
      } else ctrlNeutral.delete(src);
      const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = -ax;
    }
  }
  // Keyboard.
  if (keys.has('KeyW') || keys.has('ArrowUp')) throttle = 1;
  const kl = keys.has('KeyA') || keys.has('ArrowLeft'), kr = keys.has('KeyD') || keys.has('ArrowRight');
  if (kl) steer = 1;
  if (kr) steer = -1;
  if (keys.has('Space') || throttle > 0) engaged = true;

  if (AUTOPILOT) {
    const c = player.craft;
    const look = 10 + c.speed * 0.7;
    const { p } = track.at(race.s + look / track.length);
    const tx = p.x, tz = p.z;
    let rel = Math.atan2(-(tx - c.x), -(tz - c.z)) - c.yaw;
    rel = wrapAngle(rel);
    throttle = 1; steer = rel * 3 - c.yawRate * 0.25; engaged = race.state !== 'done';
    // ?autopilot=sloppy weaves, to test wall hits.
    if (params.get('autopilot') === 'sloppy') steer += Math.sin(elapsed * 1.1) * 0.9;
  }
  input.throttle = throttle;
  input.steer = THREE.MathUtils.clamp(steer, -1, 1);
  input.engaged = engaged;
  input.barAngle = input.steer * 0.4;
}

// ---------- simulation ----------

const env = {
  t: 0,
  surface: (x, z) => ocean.heightAt(x, z, env.t),
  rampHeight: (x, z) => track.rampHeight(x, z),
};

function advance(state, c) {
  const n = track.nearest(c.x, c.z, state.idx, 60);
  let delta = n.idx - state.idx;
  if (delta > track.SAMPLES / 2) delta -= track.SAMPLES;
  if (delta < -track.SAMPLES / 2) delta += track.SAMPLES;
  state.idx = n.idx;
  state.s += delta / track.SAMPLES;
  return n;
}

function aiControls(dt) {
  const c = jane.craft;
  advance(ai, c);
  const racing = race.state === 'race' || race.state === 'done';
  if (!racing) return { throttle: 0, steer: 0 };
  // Aim along the line, weaving a little in open water, straight over the trampolines.
  const look = 9 + c.speed * 0.65;
  const u = ai.s + look / track.length;
  const nearRamp = track.ramps.some((r) => (((r.u - ai.s) % 1) + 1) % 1 < 70 / track.length);
  const { p, r, half, idx } = track.at(u);
  const room = Math.max(0, half - 3.2);
  let lat = track.walled[idx] ? Math.min(room, 1.5) * Math.sin(elapsed * 0.3) : Math.min(room, 3.5) * Math.sin(elapsed * 0.21) + 1.5 * Math.sin(elapsed * 0.53 + 1);
  // Cut the inside of corners a little.
  lat += THREE.MathUtils.clamp(track.curv[idx] * 60, -1, 1) * room * 0.4;
  if (nearRamp) lat = 0;
  // Keep clear of the player alongside.
  const pc = player.craft;
  const px = pc.x - c.x, pz = pc.z - c.z;
  if (!nearRamp && Math.hypot(px, pz) < 8) lat += (px * r.x + pz * r.z > 0 ? -1 : 1) * Math.min(3, room);
  lat = THREE.MathUtils.clamp(lat, -room, room);
  ai.lat += (lat - ai.lat) * Math.min(1, dt * 1.2);
  const tx = p.x + r.x * ai.lat, tz = p.z + r.z * ai.lat;
  const rel = wrapAngle(Math.atan2(-(tx - c.x), -(tz - c.z)) - c.yaw);
  // Rubber band: ease off when well ahead, a little extra when far behind.
  let throttle = 1;
  c.thrustScale = 1.14;
  if (ai.finish !== null) throttle = 0.45;
  else {
    const gap = (ai.s - race.s) * track.length;
    if (gap > 60) throttle = 0.72;
    else if (gap > 25) throttle = 0.88;
    else if (gap < -40) c.thrustScale = 1.36;
    else if (gap < -15) c.thrustScale = 1.25;
  }
  return { throttle, steer: THREE.MathUtils.clamp(rel * 2.8 - c.yawRate * 0.3, -1, 1) };
}

function updateGates(now) {
  const c = player.craft;
  advance(race, c);
  if (race.state !== 'race') return;
  const g = track.gates[race.nextGate];
  const rx = c.x - g.pos.x, rz = c.z - g.pos.z;
  const along = rx * g.tan.x + rz * g.tan.z;
  const across = rx * g.right.x + rz * g.right.z;
  if (race.prevAlong !== undefined && race.prevAlong < 0 && along >= 0 && Math.abs(across) < g.half + 2) {
    g.flash = 1;
    if (race.clean) { setHype(race.hype + 1, now); sfx.chime(race.hype); }
    else sfx.gate();
    race.clean = true;
    if (race.hype === MAX_HYPE && race.prevHypeMsg !== race.lap) { race.prevHypeMsg = race.lap; race.msgUntil = now + 1.6; showPanel('MAX HYPE', 'Bills are worth $600!'); }
    if (race.nextGate === 0) {
      if (race.lap >= LAPS) {
        race.finish = race.clock;
        race.state = 'done';
        race.doneAt = now;
        const won = ai.finish === null;
        sfx.fanfare(won);
        const rich = gulls.state.money >= GOAL;
        showPanel(won ? (rich ? 'You win! And $100,000!' : 'You win!') : (rich ? 'Jane wins, you got rich' : 'Jane wins'),
          `${fmt(race.finish)}  ·  ${money(gulls.state.money)}` + (won ? '' : `  ·  ${(race.finish - ai.finish).toFixed(1)} s behind`));
        race.msgUntil = Infinity;
        race.needRelease = true;
      } else {
        race.lap++;
        race.msgUntil = now + 3;
        sfx.bell();
        for (const gg of track.gates) gg.flash = 0;
        showPanel('Final lap', '“This $100,000 is mine!”');
      }
    }
    race.nextGate = (race.nextGate + 1) % track.gates.length;
    track.gates.setNext(race.state === 'done' ? -1 : race.nextGate);
    race.prevAlong = undefined;
    return;
  }
  race.prevAlong = along;
}

function bump(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
  if (d < 2.6 && d > 0.001) {
    const push = (2.6 - d) / 2, nx = dx / d, nz = dz / d;
    a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push;
    const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rv < 0) { a.vx -= rv * nx * 0.6; a.vz -= rv * nz * 0.6; b.vx += rv * nx * 0.6; b.vz += rv * nz * 0.6; return -rv; }
  }
  return 0;
}

// Cash rings: fly through for a boost.
function ringCheck(c, who, now) {
  for (const r of track.rings) {
    if (r.cool > 0 && who === 'p') continue;
    const dx = c.x - r.x, dz = c.z - r.z;
    const along = dx * r.tx + dz * r.tz;
    if (Math.abs(along) > 1.6) continue;
    const across = Math.hypot(dx - r.tx * along, dz - r.tz * along);
    if (across > 2.1) continue;
    const key = who + 'ringAt';
    if ((r[key] || -9) > now - 2) continue;
    r[key] = now;
    c.boost = 2.2;
    if (who === 'p') { r.cool = 3; sfx.boost(); sfx.cash(); addMoney(RING_CASH, now); }
  }
}

let airPeak = 0, scrape = 0, slapCool = 0;
function physics(dt, now) {
  env.t = elapsed;
  const racing = race.state === 'race' || race.state === 'done';
  const pc = player.craft, jc = jane.craft;
  pc.step(dt, { throttle: racing ? input.throttle : 0, steer: input.steer }, env);
  jc.step(dt, aiControls(dt), env);
  const b = bump(pc, jc);
  if (b > 2) sfx.thud(b, null);
  const island = track.collide(pc);
  const wall = track.wallClamp(pc, race.idx, dt);
  const hit = Math.max(island, wall.hit);
  scrape = wall.scrape;
  if (hit > 1.5) {
    sfx.thud(hit, null);
    spray.burst(pc.x, ocean.heightAt(pc.x, pc.z, elapsed) + 0.3, pc.z, Math.min(3, hit * 0.4));
    if (race.state === 'race') { race.clean = false; if (race.hype > 0) setHype(0, now); }
    if (hit > 5) bark(track.walled[race.idx] ? 'Walls are hard, huh?' : 'Watch the rocks!', now);
  }
  track.collide(jc);
  track.wallClamp(jc, ai.idx, dt);
  if (racing) { ringCheck(pc, 'p', now); ringCheck(jc, 'j', now); }

  if (pc.airborne) airPeak = Math.max(airPeak, pc.airTime);
  slapCool -= dt;
  for (const c of [pc, jc]) {
    if (c.landing > 0.35 && c.landing < 1.5 && c === pc && slapCool < 0) { sfx.slap(c.landing); slapCool = 0.18; }
    if (c.landing < 1.5) continue;
    const w = ocean.heightAt(c.x, c.z, elapsed);
    sfx.splash(c.landing, c === pc ? null : _a.set(c.x, w, c.z));
    spray.burst(c.x, w + 0.1, c.z, c.landing);
    if (c === pc) {
      if (airPeak > 0.9 && race.state === 'race') {
        pc.boost = Math.max(pc.boost, 0.6 + Math.min(1.2, airPeak - 0.9));
        sfx.boost();
        bark(airPeak > 1.5 ? 'Whoa! Big air!' : 'Nice jump!', now);
      }
      airPeak = 0;
    }
  }

  // The waterfall: ride through it.
  const wf = track.waterfall;
  const side = Math.sign((pc.x - wf.pos.x) * track.tans[wf.idx].x + (pc.z - wf.pos.z) * track.tans[wf.idx].z);
  if (race.wfSide && side !== race.wfSide && Math.hypot(pc.x - wf.pos.x, pc.z - wf.pos.z) < 14) {
    drench.material.uniforms.amount.value = 1;
    sfx.splash(4, null);
    spray.burst(pc.x, pc.y + 1.2, pc.z, 3);
    if (race.state === 'race' && now - race.barkAt > 4) bark('Free car wash!', now);
  }
  race.wfSide = side;
}

// ---------- frame loop ----------

let lastTime = 0, lastHud = 0, frames = 0, fpsT = 0, fps = 0;
let viewY = -0.2;
const _cam = new THREE.Vector3();
let playerEngine = null, janeEngine = null, janePanner = null;
const buoyM = new THREE.Matrix4();

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 30) : 1 / 60;
  lastTime = time;
  elapsed += dt;
  const now = elapsed;
  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  if (race.state === 'loading') { renderer.render(scene, camera); return; }

  if (renderer.xr.isPresenting && !calibrated && now - race.xrStart > 0.4) calibrate();
  readInput();

  // State machine.
  if (race.state === 'ready' && input.engaged && calibrated) {
    race.state = 'countdown'; race.countdown = 3;
    race.barkAt = now; race.lastBeep = 4;
  } else if (race.state === 'countdown') {
    race.countdown -= dt;
    const n = Math.ceil(race.countdown);
    if (n < race.lastBeep) { race.lastBeep = n; sfx.beep(n <= 0); }
    if (race.countdown <= 0) { race.state = 'race'; race.clock = 0; race.msgUntil = now + 0.8; showPanel('GO!'); }
    else showPanel(String(n), n === 3 ? '“Hold on tight, it’s my island!”' : n === 2 ? 'Clean gates build Hype' : 'Gold rings = boost');
  } else if (race.state === 'race') {
    race.clock += dt;
  } else if (race.state === 'done' && now - race.doneAt > 3) {
    if (!input.engaged) race.needRelease = false;
    else if (!race.needRelease) resetRace();
  }

  physics(dt, now);
  updateGates(now);
  if (race.state === 'race' && ai.finish === null && ai.s >= LAPS) {
    ai.finish = race.clock;
    bark('Finished! Come on, slowpoke!', now, true);
  }
  if (race.state === 'race') {
    const rank = race.s >= ai.s ? 1 : 2;
    if (rank !== race.rank && race.clock > 2) bark(rank === 1 ? 'Hey! Where’d you learn to ride like that?' : 'See you at the finish!', now);
    race.rank = rank;
    if (now > race.msgUntil) showPanel('');
  }

  // Place the jetskis. The rider's view stays level; the hull pitches under it.
  const pc = player.craft, jc = jane.craft, ps = player.ski, js = jane.ski;
  ps.root.position.set(pc.x, pc.y, pc.z);
  ps.root.rotation.y = pc.yaw;
  ps.body.rotation.set(pc.pitch, 0, pc.lean * 0.4, 'YXZ');
  ps.bar.rotation.y = input.barAngle;
  js.root.position.set(jc.x, jc.y, jc.z);
  js.root.rotation.y = jc.yaw;
  js.body.rotation.set(jc.pitch, 0, jc.lean, 'YXZ');
  js.bar.rotation.y = jc.steer * 0.35;
  // View height follows the hull (jumps included), smoothing out jitter.
  const restY = -0.2;
  viewY += (restY + (pc.y - restY) * HEAVE - viewY) * Math.min(1, dt * 14);
  holder.position.set(pc.x, viewY, pc.z);
  holder.rotation.y = pc.yaw;

  const boostK = Math.min(1, pc.boost / 0.5);
  const pw = ocean.heightAt(pc.x, pc.z, elapsed), jw = ocean.heightAt(jc.x, jc.z, elapsed);
  playerWake.setTint(Math.max(boostK, race.hype === MAX_HYPE ? 0.5 : 0));
  playerWake.update(dt, elapsed, pc.x, pc.z, pc.yaw, pc.speed, pc.wet);
  janeWake.update(dt, elapsed, jc.x, jc.z, jc.yaw, jc.speed, jc.wet);
  spray.emitCraft('p', dt, pc, pw);
  spray.emitCraft('j', dt, jc, jw);
  spray.update(dt);
  if (streaks) streaks.update(dt, pc.speed, boostK);
  if (playerEngine) {
    playerEngine.set(pc.rpm, pc.speed, pc.wet, pc.airborne, 1, boostK);
    // Doppler (exaggerated) on Jane's engine.
    const dx = jc.x - pc.x, dz = jc.z - pc.z, d = Math.max(1, Math.hypot(dx, dz));
    const vr = ((jc.vx - pc.vx) * dx + (jc.vz - pc.vz) * dz) / d;
    const doppler = THREE.MathUtils.clamp(1 - (vr * 2.5) / 343, 0.8, 1.2);
    janeEngine.set(jc.rpm, jc.speed, jc.wet, jc.airborne, doppler, jc.boost > 0 ? 1 : 0);
    const ct = listener.context.currentTime;
    janePanner.positionX.setTargetAtTime(jc.x, ct, 0.03);
    janePanner.positionY.setTargetAtTime(jc.y + 0.6, ct, 0.03);
    janePanner.positionZ.setTargetAtTime(jc.z, ct, 0.03);
    const enc = track.enclosure(race.idx);
    const p = track.pts[race.idx], r = track.rights[race.idx];
    const lat = (pc.x - p.x) * r.x + (pc.z - p.z) * r.z;
    sfx.setSpace(enc, Math.max(1.5, track.half[race.idx] - Math.abs(lat)));
    sfx.setRace(pc.speed, pc.airborne, scrape);
  }

  // Bills: caught by a free hand (any tracked hand that isn't on the bar).
  const catchers = [];
  for (const h of hands) if (h.tracked && !h.grabbing) catchers.push({ pos: h.palmWorld });
  if (renderer.xr.isPresenting && !hands.some((h) => h.tracked)) {
    for (const g of controllerGrips) if (g.visible) catchers.push({ pos: g.getWorldPosition(new THREE.Vector3()) });
  }
  if (!renderer.xr.isPresenting) catchers.push({ pos: holder.localToWorld(new THREE.Vector3(-0.45, HEAD_Y - 0.35, -0.2)), radius: 1.1 });
  gulls.update(dt, elapsed, { x: pc.x, y: viewY, z: pc.z, vx: pc.vx, vz: pc.vz, yaw: pc.yaw, fwdSpeed: pc.fwdSpeed, side: race.freeSide }, catchers, race.state === 'race');
  dolphins.update(dt, elapsed, pc, ((race.s % 1) + 1) % 1);

  // Ocean and sky follow the camera; trampolines, rings and buoys float.
  camera.getWorldPosition(_cam);
  ocean.update(_cam, elapsed);
  sky.dome.position.copy(_cam);
  track.update(elapsed);
  for (const r of track.ramps) {
    r.base = ocean.heightAt(r.start.x + r.t.x * 3.5, r.start.z + r.t.z * 3.5, elapsed) - 0.1;
    r.mesh.position.set(r.start.x, r.base, r.start.z);
  }
  for (const r of track.rings) {
    r.cool = Math.max(0, r.cool - dt);
    r.group.position.y = ocean.heightAt(r.x, r.z, elapsed) + 1.9 + Math.sin(now * 2 + r.x) * 0.1;
    r.group.children[0].rotation.z = now * 1.5;
    r.group.visible = r.cool <= 0 || (r.cool < 1 && Math.sin(now * 30) > 0);
  }
  if (Math.abs(_cam.x) + Math.abs(_cam.z) >= 0) {
    // Only buoys within ~200 m are worth bobbing.
    const bp = track.buoyPos;
    for (let i = 0; i < bp.length; i++) {
      const [x, z] = bp[i];
      if (Math.abs(x - pc.x) + Math.abs(z - pc.z) > 260) continue;
      track.buoyMesh.setMatrixAt(i, buoyM.makeTranslation(x, ocean.heightAt(x, z, elapsed) + 0.15, z));
    }
    track.buoyMesh.instanceMatrix.needsUpdate = true;
  }
  for (const g of track.gates) {
    if (g.flash > 0 && g.flash < 1) g.flash = Math.max(0, g.flash - dt);
  }

  chevron.visible = race.state !== 'done';
  if (chevron.visible) {
    const g = track.gates[race.nextGate];
    chevron.position.set(g.pos.x, (track.walled[g.idx] ? 8.6 : 9.6) + Math.sin(now * 2.4) * 0.4, g.pos.z);
    chevron.rotation.y = now * 1.5;
  }

  const vs = vignette.material.uniforms.strength;
  vs.value += (Math.min(1, Math.abs(pc.yawRate) / 0.9) * 0.7 - vs.value) * Math.min(1, dt * 4);
  vignette.visible = USE_VIGNETTE && renderer.xr.isPresenting && vs.value > 0.02;
  const da = drench.material.uniforms.amount;
  da.value = Math.max(0, da.value - dt * 0.55);
  drench.material.uniforms.time.value = now;
  drench.visible = da.value > 0.01;

  if (now - lastHud > 0.1) {
    lastHud = now;
    const g = track.gates[race.nextGate];
    const rel = wrapAngle(Math.atan2(-(g.pos.x - pc.x), -(g.pos.z - pc.z)) - pc.yaw);
    const racing = race.state === 'race' || race.state === 'done';
    dash.redraw({
      rank: racing ? (race.state === 'done' ? (ai.finish === null || race.finish < ai.finish ? 1 : 2) : race.rank) : 0,
      time: fmt(race.state === 'done' ? race.finish : race.clock),
      lap: race.state === 'done' ? 'Finished' : `Lap ${race.lap}/${LAPS}  ·  Gate ${race.nextGate === 0 ? track.gates.length : race.nextGate}/${track.gates.length}`,
      cash: money(gulls.state.money),
      money: gulls.state.money,
      kmh: Math.round(pc.speed * 3.6),
      hype: race.hype,
      boost: pc.boost > 0,
      arrow: race.state === 'done' ? undefined : -rel,
      fps: DEBUG ? fps : 0,
    });
  }

  if (!renderer.xr.isPresenting) {
    rig.position.set(0, 0, 0);
    rig.rotation.set(0, 0, 0);
    if (MAP) {
      // Whole course from straight above (world space), no fog.
      if (camera.parent !== scene) { scene.add(camera); scene.fog = null; camera.far = 3000; camera.updateProjectionMatrix(); }
      const z = parseFloat(params.get('map')) || 0;
      camera.position.set(-10, z || 820, 25); camera.rotation.set(-Math.PI / 2, 0, 0);
    }
    else if (CHASE) { camera.position.set(0, HEAD_Y + 2.6, 7.5); camera.rotation.set(-0.22, 0, 0); }
    else { camera.position.set(0, HEAD_Y, 0); camera.rotation.set(-0.3, 0, 0); }
  }

  if (!skipRender) renderer.render(scene, camera);
}

// Testing: run the game logic for a while without drawing (?debug only).
let skipRender = false;
function simulate(seconds, step = 1 / 60) {
  skipRender = true;
  let t = lastTime || performance.now();
  for (let i = 0; i < seconds / step; i++) { t += step * 1000; frame(t); }
  skipRender = false;
  lastTime = 0;
}

function startAudio() {
  listener.context.resume();
  if (playerEngine) return;
  playerEngine = sfx.engine(null, 0.9);
  janePanner = sfx.pannerAt(new THREE.Vector3());
  janePanner.refDistance = 6;
  janeEngine = sfx.engine(janePanner, 0.8);
  playerEngine.start(); janeEngine.start();
  sfx.startAmbience();
  sfx.startWaterfall(track.waterfall.pos);
  if (MUSIC) sfx.startMusic(TRACKS);
}

// ---------- boot ----------

renderer.setAnimationLoop(frame);
const enterBtn = $('enterXr');
const previewBtn = $('preview');
previewBtn.disabled = true;

(async () => {
  try {
    await Promise.all([loadJetski(), sfx.loadRecorded()]);
  } catch (err) {
    statusEl.textContent = 'Could not load the jetski model: ' + err.message;
    return;
  }
  player.ski = makeJetski(PLAYER_COLOR, sky.env);
  jane.ski = makeJetski(JANE_COLOR, sky.env);
  makeRider(jane.ski);
  scene.add(player.ski.root, jane.ski.root);
  // Dash display just above the bar.
  dashMesh.position.copy(player.ski.bar.position).add(new THREE.Vector3(0, 0.1, -0.16));
  dashMesh.rotation.x = -0.6;
  player.ski.body.add(dashMesh);
  race.state = 'ready';
  resetRace();
  previewBtn.disabled = false;
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      enterBtn.disabled = !ok;
      statusEl.textContent = ok ? 'Ready. Put on the headset and tap Enter VR.' : 'This browser cannot run VR. Use the preview.';
    }).catch(() => { statusEl.textContent = 'VR check failed. Use the preview.'; });
  } else {
    statusEl.textContent = 'No WebXR here. Use the preview (keyboard controls).';
  }
  if (params.has('autostart')) previewBtn.click();
})();

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
      session.updateTargetFrameRate(rates.includes(72) ? 72 : Math.min(...rates)).catch(() => {});
    }
    const ref = renderer.xr.getReferenceSpace();
    if (ref && ref.addEventListener) ref.addEventListener('reset', () => { calibrated = false; race.xrStart = elapsed; });
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

if (DEBUG) Object.assign(window, { race, ai, player, jane, scene, track, gulls, THREE, input, hands, simulate, renderer });
