// Jane splat test: Jane's Gaussian splat standing in the room scan, a live
// performance readout (in the headset and on screen), and a "slideshow" of
// splat poses swapped every few seconds over a voiceover, like old PC
// adventure games. Only one pose scan exists so far, so the extra poses are
// the same scan turned a little; drop real pose files in with ?urls=.
//
// URL options (all optional):
//   ?q=315k | 315k-sh0 | 150k | 75k   Jane file (default 315k, the original upload)
//   ?mode=preload | stream            preload: every pose decoded up front, a swap is a visibility flip
//                                     stream: each swap decodes the next file, then flips
//   ?poses=3                          how many poses to cycle (preload keeps them all in memory)
//   ?urls=a.sog,b.sog                 real pose files instead of the placeholder copies
//   ?every=5                          seconds per pose
//   ?fade=0                           cross-fade seconds (0 = hard cut)
//   ?room=0                           start with the room scan hidden
//   ?vo=0                             no voiceover
//   ?hz=90                            ask Quest for 90 Hz (default: the headset's own rate, 72)
//   ?face=0                           extra yaw in degrees if Jane faces the wrong way
//   ?height=1.65                      Jane's height in metres; ?dist=1.3 how far in front of you she stands
//   ?lod=0                            no Spark LoD on the room
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { SCRIPTED } from '../jane/persona.js';

const params = new URLSearchParams(location.search);
const QUALITIES = {
  '315k': { url: '../assets/jane/jane-315k.sog', count: 315490, note: 'original, SH3' },
  '315k-sh0': { url: '../assets/jane/jane-315k-sh0.sog', count: 315490, note: 'no SH' },
  '150k': { url: '../assets/jane/jane-150k.sog', count: 150000, note: 'no SH' },
  '75k': { url: '../assets/jane/jane-75k.sog', count: 75000, note: 'no SH' },
};
const Q = QUALITIES[params.get('q')] ? params.get('q') : '315k';
const MODE = params.get('mode') === 'stream' ? 'stream' : 'preload';
const EVERY = Math.max(1, Number(params.get('every')) || 5);
const FADE = Math.max(0, Number(params.get('fade')) || 0);
const VO = params.get('vo') !== '0';
const HZ = Number(params.get('hz')) || 0;
const FACE = (Number(params.get('face')) || 0) * Math.PI / 180;
const USE_LOD = params.get('lod') !== '0';
const ROOM_COUNT = 900000; // assets/room.sog, decimated from the 4.4M scan

// Placeholder poses: the same scan turned by a different angle each, so the
// swap is visible. Real poses replace these one for one.
const PLACEHOLDER = [
  { name: 'wave', yaw: 0 },
  { name: 'meditate', yaw: 28 },
  { name: 'point', yaw: -28 },
  { name: 'dance', yaw: 50 },
  { name: 'heart', yaw: -50 },
  { name: 'laugh', yaw: 14 },
];
const URLS = (params.get('urls') || '').split(',').map((s) => s.trim()).filter(Boolean);
const N_POSES = URLS.length || Math.min(PLACEHOLDER.length, Math.max(1, Number(params.get('poses')) || 3));
const POSES = Array.from({ length: N_POSES }, (_, i) => URLS.length
  ? { name: URLS[i].split('/').pop().replace(/\.\w+$/, ''), yaw: 0, url: URLS[i], count: 0 }
  : { ...PLACEHOLDER[i], url: QUALITIES[Q].url, count: QUALITIES[Q].count });

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// Option chips on the start card are plain links that reload with new params.
const CHIPS = { q: Object.keys(QUALITIES), mode: ['preload', 'stream'], poses: ['1', '3', '6'] };
const CURRENT = { q: Q, mode: MODE, poses: String(N_POSES) };
for (const box of document.querySelectorAll('.opts')) {
  const key = box.dataset.param;
  for (const v of CHIPS[key]) {
    const p = new URLSearchParams(location.search); p.set(key, v);
    const a = document.createElement('a');
    a.href = `?${p}`; a.textContent = key === 'q' ? `${v} (${QUALITIES[v].note})` : v;
    if (CURRENT[key] === v) a.setAttribute('aria-current', 'true');
    box.append(a);
  }
}

// ---------- renderer, scene, camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// ---------- room scan ----------
// Scan coordinates (y down, floor y = 0). The player stands where the opening
// flight ends, 1.4 m short of the coffee table, looking at it.
const ENTRANCE = new THREE.Vector2(2.25, 0.2);
const TABLE = new THREE.Vector2(-0.47, -3.0);
const dir = new THREE.Vector2().subVectors(TABLE, ENTRANCE).normalize();
const STAND = TABLE.clone().addScaledVector(dir, -1.4);

const roomRoot = new THREE.Group();
{
  // Flipping the scan upright maps scan (x, z) to world (x, -z). Then move
  // the stand point to the origin with the table straight ahead (-Z).
  const look = new THREE.PerspectiveCamera();
  look.position.set(STAND.x, 0, -STAND.y);
  look.lookAt(TABLE.x, 0, -TABLE.y);
  look.updateMatrixWorld();
  look.matrixWorld.clone().invert().decompose(roomRoot.position, roomRoot.quaternion, roomRoot.scale);
}
scene.add(roomRoot);
const room = new SplatMesh({
  url: params.get('scan') || '../assets/room.sog',
  lod: USE_LOD ? true : undefined,
});
room.rotation.x = Math.PI;
roomRoot.add(room);
roomRoot.visible = params.get('room') !== '0';

// ---------- Jane ----------
// Her scan is y down, 3.67 units from feet to head, so it is scaled to
// ?height (default 1.65 m). She stands 1.3 m in front of the player and her
// scan already faces +Z, toward them.
const JANE_SCAN = { height: 3.675, feetY: 0.099, cx: -0.075, cz: -0.69 }; // splat-transform --stats
const JANE_HEIGHT = Number(params.get('height')) || 1.65;
const JANE_SCALE = JANE_HEIGHT / JANE_SCAN.height;
const janeRoot = new THREE.Group();
janeRoot.position.set(0, 0, -Number(params.get('dist') || 1.3));
janeRoot.rotation.y = FACE;
scene.add(janeRoot);

function makePose(pose) {
  const pivot = new THREE.Group();
  pivot.rotation.y = (pose.yaw * Math.PI) / 180;
  const mesh = new SplatMesh({ url: pose.url });
  // Flip upright, scale, and put her feet on the floor at the pivot.
  mesh.rotation.x = Math.PI;
  mesh.scale.setScalar(JANE_SCALE);
  mesh.position.set(-JANE_SCAN.cx * JANE_SCALE, JANE_SCAN.feetY * JANE_SCALE, JANE_SCAN.cz * JANE_SCALE);
  pivot.add(mesh);
  pivot.visible = false;
  pivot.userData.mesh = mesh;
  return pivot;
}

function splatCount(mesh, fallback) {
  const n = mesh.packedSplats?.numSplats ?? mesh.splats?.numSplats ?? mesh.numSplats;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const poseState = {
  index: 0, shown: null, loaded: [], swapAt: 0, nextSwap: Infinity, busy: false,
  lastLoadMs: 0, lastHitchMs: 0, hitchWindowEnd: 0, fading: null,
};

async function loadPoses() {
  const t0 = performance.now();
  if (MODE === 'preload') {
    poseState.loaded = POSES.map(makePose);
    poseState.loaded.forEach((p) => janeRoot.add(p));
    await Promise.all(poseState.loaded.map((p) => p.userData.mesh.initialized));
    poseState.loaded.forEach((p, i) => { POSES[i].count = splatCount(p.userData.mesh, POSES[i].count); });
  } else {
    const p = makePose(POSES[0]);
    janeRoot.add(p);
    await p.userData.mesh.initialized;
    POSES[0].count = splatCount(p.userData.mesh, POSES[0].count);
    poseState.loaded = [p];
  }
  poseState.lastLoadMs = performance.now() - t0;
  show(poseState.loaded[0], 0);
}

function show(pivot, index) {
  const old = poseState.shown;
  pivot.visible = true;
  poseState.shown = pivot;
  poseState.index = index;
  poseState.swapAt = clock.now;
  poseState.hitchWindowEnd = clock.now + 1;
  poseState.lastHitchMs = 0;
  if (old && old !== pivot) {
    if (FADE > 0) {
      pivot.userData.mesh.opacity = 0;
      poseState.fading = { from: old, to: pivot, t0: clock.now };
    } else {
      retire(old);
    }
  }
}

function retire(pivot) {
  pivot.visible = false;
  if (MODE === 'stream') {
    janeRoot.remove(pivot);
    pivot.userData.mesh.dispose?.();
  }
}

async function nextPose() {
  if (poseState.busy || !poseState.shown) return;
  const i = (poseState.index + 1) % POSES.length;
  if (MODE === 'preload') {
    show(poseState.loaded[i], i);
  } else {
    poseState.busy = true;
    const t0 = performance.now();
    const p = makePose(POSES[i]);
    janeRoot.add(p);
    try {
      await p.userData.mesh.initialized;
      POSES[i].count = splatCount(p.userData.mesh, POSES[i].count);
      poseState.lastLoadMs = performance.now() - t0;
      show(p, i);
    } catch (err) {
      console.warn('Pose failed to load', err);
      janeRoot.remove(p);
    }
    poseState.busy = false;
  }
  poseState.nextSwap = clock.now + EVERY;
}

// ---------- voiceover ----------
// The scripted host lines in the browser voice, one after another, as a
// stand-in for baked ElevenLabs lines. Each line names a gesture; once real
// pose scans exist the pose can follow the line instead of the timer.
const LINES = [...SCRIPTED.welcome, ...SCRIPTED.after].map((l) => l.text);
const vo = { i: 0, text: '', timer: 0, on: false };
function speakNext() {
  if (!vo.on) return;
  const text = LINES[vo.i % LINES.length];
  vo.i++;
  vo.text = text;
  const next = () => { clearTimeout(vo.timer); vo.timer = setTimeout(speakNext, 1200); };
  if (!('speechSynthesis' in window)) { vo.timer = setTimeout(next, 1500 + text.length * 60); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  u.voice = voices.find((v) => /female|samantha|zira|jenny|aria|google us english/i.test(v.name) && /^en/.test(v.lang))
    || voices.find((v) => /^en/.test(v.lang)) || null;
  u.rate = 1.04; u.pitch = 1.12;
  u.onend = next; u.onerror = next;
  speechSynthesis.speak(u);
  vo.timer = setTimeout(next, 3000 + text.length * 85); // onend is unreliable on some browsers
}
function startVoice() {
  if (!VO || vo.on) return;
  vo.on = true;
  speakNext();
}
function stopVoice() {
  vo.on = false;
  clearTimeout(vo.timer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// ---------- performance readout ----------

const perf = {
  frames: 0, windowStart: 0, fps: 0, avgMs: 0, worstMs: 0, cpuMs: 0, slow: 0, slowRate: 0, slowTotal: 0,
  deltas: [], cpu: [], targetHz: 0,
};

function memoryMb() {
  const m = performance.memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
}

function perfLines() {
  const pose = POSES[poseState.index];
  const janeSplats = MODE === 'preload'
    ? POSES.reduce((s, p) => s + p.count, 0)
    : pose?.count || 0;
  const drawn = (poseState.shown ? pose.count : 0) + (roomRoot.visible ? ROOM_COUNT : 0);
  const hz = perf.targetHz ? ` / ${perf.targetHz} Hz` : '';
  const mem = memoryMb();
  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`);
  return [
    `${perf.fps} fps${hz}   frame ${perf.avgMs.toFixed(1)} ms   worst ${perf.worstMs.toFixed(1)} ms`,
    `slow frames ${perf.slowRate}/s (total ${perf.slowTotal})   js ${perf.cpuMs.toFixed(1)} ms${mem ? `   heap ${mem} MB` : ''}`,
    `drawn ${fmt(drawn)} splats   room ${roomRoot.visible ? 'on' : 'off'}   Jane ${Q} (${QUALITIES[Q].note})`,
    `${MODE}: pose ${poseState.index + 1}/${POSES.length} ${pose?.name || ''}   in memory ${fmt(janeSplats)}`,
    `last ${MODE === 'stream' ? 'decode' : 'load'} ${Math.round(poseState.lastLoadMs)} ms   swap hitch ${poseState.lastHitchMs.toFixed(1)} ms`,
  ];
}

// In-headset panel, slightly below the view and tilted up.
const HUD_W = 900, HUD_H = 330;
const hudCanvas = document.createElement('canvas');
hudCanvas.width = HUD_W; hudCanvas.height = HUD_H;
const hudTex = new THREE.CanvasTexture(hudCanvas);
hudTex.colorSpace = THREE.SRGBColorSpace;
const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD_W / 2000, HUD_H / 2000),
  new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false }));
hudMesh.renderOrder = 100;
hudMesh.position.set(0, -0.2, -0.62);
hudMesh.rotation.x = -0.3;
camera.add(hudMesh);
const hudDom = $('hud');

function drawHud() {
  const lines = perfLines();
  const g = hudCanvas.getContext('2d');
  g.clearRect(0, 0, HUD_W, HUD_H);
  g.fillStyle = 'rgba(13,20,18,0.78)';
  g.beginPath(); g.roundRect(4, 4, HUD_W - 8, HUD_H - 8, 26); g.fill();
  const good = perf.targetHz ? perf.fps >= perf.targetHz - 2 : perf.fps >= 70;
  g.textBaseline = 'top';
  g.font = '600 34px ui-monospace, Menlo, monospace';
  g.fillStyle = good ? '#8fd18a' : '#ff8a6b';
  g.fillText(lines[0], 24, 20);
  g.font = '28px ui-monospace, Menlo, monospace';
  g.fillStyle = '#eef3ea';
  lines.slice(1).forEach((l, i) => g.fillText(l, 24, 72 + i * 42));
  if (vo.text) {
    g.fillStyle = '#f2c45a';
    g.font = 'italic 24px system-ui, sans-serif';
    const t = vo.text.length > 70 ? `${vo.text.slice(0, 68)}…` : vo.text;
    g.fillText(`Jane: ${t}`, 24, 72 + 4 * 42 + 8);
  }
  hudTex.needsUpdate = true;
  hudDom.textContent = lines.join('\n') + (vo.text ? `\nJane: ${vo.text}` : '');
}

// ---------- main loop ----------

const clock = { now: 0, last: 0 };
let started = false;

renderer.setAnimationLoop((time) => {
  const t = time / 1000;
  const dt = clock.last ? t - clock.last : 0;
  clock.now = t; clock.last = t;

  if (dt > 0 && dt < 1) {
    perf.deltas.push(dt * 1000);
    const budget = 1000 / (perf.targetHz || 72);
    if (dt * 1000 > budget * 1.5) { perf.slow++; perf.slowTotal++; }
    if (t < poseState.hitchWindowEnd) poseState.lastHitchMs = Math.max(poseState.lastHitchMs, dt * 1000);
  }

  if (started && t >= poseState.nextSwap) nextPose();
  if (poseState.fading) {
    const f = Math.min(1, (t - poseState.fading.t0) / FADE);
    poseState.fading.to.userData.mesh.opacity = f;
    poseState.fading.from.userData.mesh.opacity = 1 - f;
    if (f >= 1) {
      poseState.fading.from.userData.mesh.opacity = 1;
      retire(poseState.fading.from);
      poseState.fading = null;
    }
  }

  const c0 = performance.now();
  renderer.render(scene, camera);
  perf.cpu.push(performance.now() - c0);

  if (t - perf.windowStart >= 0.5) {
    const span = t - perf.windowStart;
    if (perf.windowStart && perf.deltas.length) {
      perf.fps = Math.round(perf.deltas.length / span);
      perf.avgMs = perf.deltas.reduce((a, b) => a + b, 0) / perf.deltas.length;
      perf.worstMs = Math.max(...perf.deltas);
      perf.cpuMs = perf.cpu.reduce((a, b) => a + b, 0) / perf.cpu.length;
      perf.slowRate = Math.round(perf.slow / span);
      drawHud();
    }
    perf.windowStart = t; perf.deltas = []; perf.cpu = []; perf.slow = 0;
  }
});

// ---------- start ----------

let loaded = false;
statusEl.textContent = 'Loading the room scan and Jane…';
Promise.all([room.initialized, loadPoses()]).then(() => {
  loaded = true;
  statusEl.textContent = `Ready. Jane ${Q}, ${POSES.length} pose${POSES.length > 1 ? 's' : ''}, ${MODE}; loaded in ${(poseState.lastLoadMs / 1000).toFixed(1)} s.`;
  $('preview').disabled = false;
  checkXr();
}).catch((err) => {
  statusEl.textContent = `Could not load: ${err.message || err}`;
});

async function checkXr() {
  const vr = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  const ar = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  $('enterVr').disabled = !vr || !loaded;
  $('enterAr').disabled = !ar || !loaded;
  if (!vr && !ar) statusEl.textContent += ' Open this page in Quest Browser to enter the headset.';
}

function begin() {
  started = true;
  poseState.nextSwap = clock.now + EVERY;
  startVoice();
}

async function enter(kind) {
  try {
    const session = await navigator.xr.requestSession(kind, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    if (kind === 'immersive-ar') {
      renderer.setClearColor(0x000000, 0);
      roomRoot.visible = false;
    } else {
      renderer.setClearColor(0x000000, 1);
      roomRoot.visible = params.get('room') !== '0';
    }
    await renderer.xr.setSession(session);
    perf.targetHz = Math.round(session.frameRate || 72);
    if (HZ && session.updateTargetFrameRate && session.supportedFrameRates?.includes(HZ)) {
      session.updateTargetFrameRate(HZ).then(() => { perf.targetHz = HZ; }).catch(() => {});
    }
    hudDom.hidden = true;
    $('ui').hidden = true;
    session.addEventListener('select', (e) => {
      if (e.inputSource.handedness === 'left') roomRoot.visible = !roomRoot.visible;
      else nextPose();
    });
    session.addEventListener('end', () => {
      $('ui').hidden = false;
      started = false;
      stopVoice();
      perf.targetHz = 0;
    });
    begin();
  } catch (err) {
    statusEl.textContent = `Could not enter the headset: ${err.message || err}`;
  }
}

$('enterVr').addEventListener('click', () => enter('immersive-vr'));
$('enterAr').addEventListener('click', () => enter('immersive-ar'));
$('preview').addEventListener('click', () => {
  $('ui').hidden = true;
  hudDom.hidden = false;
  hudMesh.visible = false;
  begin();
});

// Flat preview: drag to look around, R toggles the room, N next pose.
{
  let drag = null, yaw = 0, pitch = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', (e) => {
    if (!drag || renderer.xr.isPresenting) return;
    yaw = drag.yaw - (e.clientX - drag.x) * 0.004;
    pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - (e.clientY - drag.y) * 0.004));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'r') roomRoot.visible = !roomRoot.visible;
    if (e.key === 'n') nextPose();
  });
}

// For console poking: splatTest.camera.position.z = 2 etc.
window.splatTest = { scene, camera, janeRoot, roomRoot, room, poseState, perf };
