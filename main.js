// $100,000 opening scene prototype.
// Mixed reality: a $100 bill falls from the ceiling, a seagull flies out of a
// portal standing in the room's entrance, grabs it and flies back in, then the
// player flies through the portal and on toward the table.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Video180 } from './video.js';

const params = new URLSearchParams(location.search);
const USE_LOD = params.get('lod') !== '0';
const DEBUG = params.has('debug');
const FLY_SPEED = Number(params.get('speed')) || 0.4; // m/s, constant
// Untouched 8K60 HEVC master (tools/segment-original.sh), too big for GitHub
// Pages so it's hosted separately; the 4K H.264 copy in ./video/ plays wherever
// HEVC can't. ?video=<folder>/ forces one source.
const ORIGINAL_SRC = '';
const VIDEO_SRC = params.get('video') || [ORIGINAL_SRC, './video/'];

// Room scan landmarks, as (x, z) in the scan's own coordinates. The scan has
// y pointing down with the floor at y = 0, so it gets flipped upright.
const ENTRANCE = new THREE.Vector2(2.25, 0.2);   // centre of the doorway in the long wall
const TARGETS = {
  table: { at: new THREE.Vector2(-0.47, -3.0), stop: 1.4 }, // coffee table between the pink poufs
  desk: { at: new THREE.Vector2(-1.63, 0.18), stop: 1.4 },  // desk in front of the window
};
const TARGET = TARGETS[params.get('to')] || TARGETS.table;
const PORTAL_DIST = 1.05; // portal distance in front of the player, and from the doorway on the outside

// Flight line: from just outside the doorway, through it, toward the target.
const FLY_DIR = new THREE.Vector2().subVectors(TARGET.at, ENTRANCE).normalize();
const SCAN_START = ENTRANCE.clone().addScaledVector(FLY_DIR, -PORTAL_DIST);
const FLY_DIST = SCAN_START.distanceTo(TARGET.at) - TARGET.stop;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

// ---------- renderer, scene, camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
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

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Everything the scene places is relative to where the player's head was
// when the sequence started: forward is -Z, the floor is y = 0.
const anchor = new THREE.Group();
scene.add(anchor);

// ---------- stencil portal ----------
// The portal disk writes stencil 1. World materials draw only where the
// stencil is 1 until the player has passed through the portal.

const worldMaterials = [];
function maskToPortal(material) {
  material.stencilWrite = true; // enables the stencil test
  material.stencilRef = 1;
  material.stencilFail = material.stencilZFail = material.stencilZPass = THREE.KeepStencilOp;
  material.stencilFunc = THREE.EqualStencilFunc;
  worldMaterials.push(material);
  return material;
}
function setWorldMasked(masked) {
  for (const m of worldMaterials) m.stencilFunc = masked ? THREE.EqualStencilFunc : THREE.AlwaysStencilFunc;
}

const portal = new THREE.Group();
anchor.add(portal);

const portalMask = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  }),
);
portalMask.renderOrder = -100;
portal.add(portalMask);

// Border: a thin bright line with a faint halo, plus sparks riding the rim.
// The portal group is scaled to its radius, so widths are divided by it to
// stay a constant few millimetres.
const ringMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { time: { value: 0 }, opacity: { value: 1 }, radius: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec2 vPos;
    void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform float time; uniform float opacity; uniform float radius; varying vec2 vPos;
    void main() {
      float r = length(vPos);
      float a = atan(vPos.y, vPos.x);
      float w = 0.003 / radius;
      float x = (r - 1.0) / w;
      float core = exp(-x * x);
      float halo = exp(-abs(x) / 9.0) * 0.22;
      float shimmer = 0.7 + 0.3 * sin(a * 37.0 - time * 2.6) * sin(a * 5.0 + time * 1.1);
      vec3 col = vec3(1.0, 0.93, 0.78) * core + vec3(1.0, 0.72, 0.32) * halo * shimmer;
      gl_FragColor = vec4(col * opacity, 1.0);
    }`,
});
const ring = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), ringMaterial);
ring.renderOrder = 10;
portal.add(ring);

const SPARKS = 110;
const sparkGeo = new THREE.BufferGeometry();
{
  const seed = new Float32Array(SPARKS * 4);
  for (let i = 0; i < SPARKS; i++) {
    seed.set([Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.9, Math.random(), 0.4 + Math.random() * 0.9], i * 4);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  sparkGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
}
const sparkMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: ringMaterial.uniforms,
  vertexShader: /* glsl */`
    uniform float time; uniform float radius;
    attribute vec4 seed; // start angle, angular speed, phase, life rate
    varying float vAlpha;
    void main() {
      float life = fract(time * seed.w * 0.6 + seed.z);
      float a = seed.x + seed.y * time;
      // Born on the rim, drift a few centimetres outward and fade.
      float r = 1.0 + (life * 0.045) / radius;
      vec4 mv = modelViewMatrix * vec4(cos(a) * r, sin(a) * r, 0.0, 1.0);
      float twinkle = 0.5 + 0.5 * sin(time * 23.0 * seed.w + seed.z * 40.0);
      vAlpha = (1.0 - life) * (0.35 + 0.65 * twinkle);
      gl_PointSize = 1300.0 * 0.006 * (1.2 - life) / max(0.05, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float opacity; varying float vAlpha;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = exp(-dot(c, c) * 22.0);
      gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * d * vAlpha * opacity, 1.0);
    }`,
});
const sparks = new THREE.Points(sparkGeo, sparkMaterial);
sparks.frustumCulled = false;
sparks.renderOrder = 11;
ring.add(sparks);

// ---------- splat world ----------

// worldRoot follows the anchor; flyGroup slides the room toward the player;
// alignGroup turns the flight line to face forward; scanGroup puts the start
// point (just outside the doorway) at the player's feet.
const worldRoot = new THREE.Group();
scene.add(worldRoot);
const flyGroup = new THREE.Group();
worldRoot.add(flyGroup);
const alignGroup = new THREE.Group();
// Upright coordinates are (x, -y, -z) of the scan.
alignGroup.quaternion.setFromUnitVectors(
  new THREE.Vector3(FLY_DIR.x, 0, -FLY_DIR.y), new THREE.Vector3(0, 0, -1));
flyGroup.add(alignGroup);
const scanGroup = new THREE.Group();
scanGroup.position.set(-SCAN_START.x, 0, SCAN_START.y);
alignGroup.add(scanGroup);

const skyGeo = new THREE.SphereGeometry(60, 48, 24);
{
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0x3b7fd0), horizon = new THREE.Color(0xbfe6f5), ground = new THREE.Color(0x6f8a7a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 60;
    if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
const sky = new THREE.Mesh(skyGeo, maskToPortal(new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
})));
sky.renderOrder = -50;
worldRoot.add(sky);

maskToPortal(spark.material);

const room = new SplatMesh({
  url: params.get('scan') || './assets/room.sog',
  lod: USE_LOD ? true : undefined,
  onProgress: (e) => {
    if (e.lengthComputable) statusEl.textContent = `Loading room scan ${Math.round((e.loaded / e.total) * 100)}%`;
  },
});
room.rotation.x = Math.PI;
scanGroup.add(room);

// A plain room stands in for passthrough when previewing on a flat screen.
const fakeRoom = new THREE.Group();
{
  const tex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#c9c4ba'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#a9a398'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3);
    t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const box = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 6), new THREE.MeshStandardMaterial({
    map: tex, side: THREE.BackSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
  }));
  box.position.y = 1.3;
  fakeRoom.add(box);
  fakeRoom.visible = false;
  scene.add(fakeRoom);
}

// ---------- $100 bill ----------

function makeBillTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 436;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 436);
  grad.addColorStop(0, '#d9e3cf'); grad.addColorStop(0.5, '#c4d6b8'); grad.addColorStop(1, '#d5dcc4');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 436);
  g.strokeStyle = '#3f6b4a'; g.lineWidth = 14; g.strokeRect(18, 18, 988, 400);
  g.lineWidth = 4; g.strokeRect(40, 40, 944, 356);
  g.fillStyle = '#e9e2cf'; g.beginPath(); g.ellipse(512, 218, 120, 150, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3f6b4a'; g.lineWidth = 6; g.stroke();
  g.fillStyle = '#3f6b4a';
  g.font = 'bold 150px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('$', 512, 222);
  g.font = 'bold 92px Georgia, serif';
  g.fillText('100', 140, 110); g.fillText('100', 884, 330);
  g.font = 'bold 70px Georgia, serif'; g.fillStyle = '#c9a646';
  g.fillText('100', 884, 110);
  g.fillStyle = '#3f6b4a'; g.font = 'bold 34px Georgia, serif';
  g.fillText('ONE HUNDRED', 512, 395);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const bill = new THREE.Group();
{
  // Real bill is 15.6 x 6.6 cm; drawn 1.3x so it reads at arm's length.
  const geo = new THREE.PlaneGeometry(0.203, 0.086, 12, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.012 * Math.sin((p.getX(i) / 0.203) * Math.PI));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: makeBillTexture(), side: THREE.DoubleSide }));
  bill.add(m);
}
anchor.add(bill);

// ---------- seagull (placeholder) ----------
// Built facing +Z so Object3D.lookAt points the beak along the flight path.

function makeSeagull() {
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xa9b0b8, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.5 });
  const gull = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), white);
  body.scale.set(0.075, 0.065, 0.19);
  gull.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), white);
  head.position.set(0, 0.045, 0.165);
  gull.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.075, 10), orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.035, 0.24);
  gull.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), dark);
    eye.position.set(0.04 * s, 0.065, 0.195);
    gull.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.09), grey);
  tail.position.set(0, 0.012, -0.2);
  gull.add(tail);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.06 * s, 0.035, 0.02);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.13), grey);
    inner.position.x = 0.13 * s;
    pivot.add(inner);
    const outer = new THREE.Group();
    outer.position.x = 0.26 * s;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.1), grey);
    tip.position.set(0.1 * s, 0, -0.01);
    outer.add(tip);
    const black = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.011, 0.09), dark);
    black.position.set(0.17 * s, 0, -0.012);
    outer.add(black);
    pivot.add(outer);
    gull.add(pivot);
    wings.push({ pivot, outer, side: s });
  }
  const beakTip = new THREE.Object3D();
  beakTip.position.set(0, 0.025, 0.27);
  gull.add(beakTip);
  gull.userData = { wings, beakTip, materials: [white, grey, dark, orange] };
  return gull;
}
const gull = makeSeagull();
gull.scale.setScalar(1.1);
anchor.add(gull);

function flap(t, strength) {
  for (const w of gull.userData.wings) {
    const a = Math.sin(t * 13) * 0.75 * strength;
    w.pivot.rotation.z = w.side * a;
    w.outer.rotation.z = w.side * a * 0.6;
  }
}

// Bill and gull go behind the stencil while they are on the world side of the portal.
const gullMaterials = [...gull.userData.materials, bill.children[0].material];
function setObjectMasked(masked) {
  for (const m of gullMaterials) {
    m.stencilWrite = masked;
    m.stencilRef = 1;
    m.stencilFunc = THREE.EqualStencilFunc;
  }
}

// ---------- hands (drawn once inside the world, where passthrough is hidden) ----------

const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];
const handMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 10, 8),
  new THREE.MeshStandardMaterial({ color: 0xf1d2bd, roughness: 0.6 }),
  JOINTS.length * 2,
);
handMesh.frustumCulled = false;
handMesh.visible = false;
scene.add(handMesh);
const fingertips = [];
const tmpMat = new THREE.Matrix4(), tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), tmpScale = new THREE.Vector3();

function updateHands(frame) {
  const session = renderer.xr.getSession();
  const ref = renderer.xr.getReferenceSpace();
  let n = 0;
  fingertips.length = 0;
  if (session && frame && ref && frame.getJointPose) {
    for (const src of session.inputSources) {
      if (!src.hand) continue;
      for (const name of JOINTS) {
        const space = src.hand.get(name);
        const pose = space && frame.getJointPose(space, ref);
        if (!pose) continue;
        const p = pose.transform.position, o = pose.transform.orientation;
        tmpPos.set(p.x, p.y, p.z); tmpQuat.set(o.x, o.y, o.z, o.w);
        tmpScale.setScalar(Math.max(0.006, pose.radius || 0.008));
        handMesh.setMatrixAt(n++, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
        if (name === 'index-finger-tip') fingertips.push(tmpPos.clone());
      }
    }
  }
  handMesh.count = n;
  handMesh.instanceMatrix.needsUpdate = true;
}

// ---------- in-headset text (replay hint, debug fps) ----------

function makeLabel(width = 512, height = 128) {
  const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width / 1000, height / 1000),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 20;
  mesh.userData.draw = (text) => {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, width, height);
    g.fillStyle = 'rgba(13,20,18,0.72)';
    g.beginPath(); g.roundRect(4, 4, width - 8, height - 8, 28); g.fill();
    g.fillStyle = '#f2c45a'; g.font = '600 46px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, width / 2, height / 2);
    tex.needsUpdate = true;
  };
  return mesh;
}
// ---------- play button and 180 video ----------

const video = new Video180({ renderer, scene, src: VIDEO_SRC });
video.ready.catch((err) => console.warn('Video not available:', err.message || err));

const playBall = new THREE.Group();
{
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 48, 32), new THREE.MeshStandardMaterial({
    color: 0xf2c45a, metalness: 0.65, roughness: 0.22, emissive: 0x3a2a05,
  }));
  playBall.add(ball);
  // Play triangle, always turned toward the viewer.
  const shape = new THREE.Shape();
  shape.moveTo(-0.028, -0.036); shape.lineTo(0.042, 0); shape.lineTo(-0.028, 0.036); shape.closePath();
  const icon = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  icon.position.z = 0.112;
  const iconPivot = new THREE.Group();
  iconPivot.add(icon);
  playBall.add(iconPivot);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: ringMaterial.uniforms,
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() { vPos = position.xy / 0.21; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec2 vPos;
      void main() {
        float r = length(vPos);
        float g = smoothstep(1.0, 0.5, r) * smoothstep(0.45, 0.55, r) * (0.55 + 0.25 * sin(time * 2.5));
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.3) * g, 1.0);
      }`,
  }));
  iconPivot.add(halo);
  playBall.userData = { ball, iconPivot, pressedAt: -1 };
  playBall.visible = false;
  anchor.add(playBall);
}

const hint = makeLabel();
hint.userData.draw('Touch the ball to play');
hint.scale.setScalar(0.6);
anchor.add(hint);

function startVideo() {
  if (video.playing || !playBall.visible) return;
  playBall.userData.pressedAt = performance.now() / 1000;
  hint.visible = false;
  // Centre the 180 on the viewer's head, facing the way the room faces.
  const head = (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  head.updateMatrixWorld(true);
  const pose = new THREE.Object3D();
  pose.position.setFromMatrixPosition(head.matrixWorld);
  pose.quaternion.copy(anchor.quaternion);
  setTimeout(() => {
    worldRoot.visible = spark.visible = false;
    playBall.visible = false;
    video.play(pose).catch((err) => {
      console.warn('Video failed:', err);
      if (video.playing) video.stop();
      else video.onEnded();
    });
  }, 450);
}
video.onEnded = () => {
  worldRoot.visible = spark.visible = true;
  playBall.visible = true;
  playBall.userData.pressedAt = -1;
  hint.visible = true;
};

const fpsLabel = makeLabel(320, 96);
fpsLabel.position.set(0, -0.18, -0.6);
fpsLabel.visible = DEBUG;
camera.add(fpsLabel);

// ---------- timeline ----------

const T_BILL = 0.6;        // bill appears at the ceiling
const T_PORTAL = 1.2;      // portal starts opening
const T_GULL_OUT = 2.2;    // gull leaves the portal
const T_GRAB = 4.2;        // gull catches the bill
const T_GULL_IN = 5.6;     // gull is back through the portal
const T_GLIDE = 4.5;       // player starts flying through the portal
const GLIDE_DUR = FLY_DIST / FLY_SPEED;
const T_HINT = T_GLIDE + GLIDE_DUR + 1.0; // play ball appears

const PORTAL_Z = -PORTAL_DIST, PORTAL_R = 0.55, PORTAL_END_R = 1.3;

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const state = { running: false, start: 0, eye: 1.6, inside: false };

function billPose(tb, out) {
  // Fluttering fall: drift side to side while sinking ~0.33 m/s.
  out.position.set(
    0.24 + 0.12 * Math.sin(tb * 2.2),
    2.35 - 0.33 * tb,
    -0.8 + 0.06 * Math.sin(tb * 1.7),
  );
  out.rotation.set(0.6 * Math.sin(tb * 2.2 + 1.0), 0.45 * tb, 0.9 * Math.sin(tb * 2.2));
}
const scratchBill = new THREE.Object3D();
function billPositionAt(tb) { billPose(tb, scratchBill); return scratchBill.position.clone(); }

// The portal sits in the doorway, so it travels with the room as the player
// flies in; it widens as it reaches the player so it passes around the head.
function portalPoseAt(t) {
  // Constant speed: no easing, so there is no acceleration to feel.
  const fly = FLY_DIST * clamp01((t - T_GLIDE) / GLIDE_DUR);
  const reach = clamp01(fly / PORTAL_DIST);
  return {
    fly,
    z: PORTAL_Z + fly,
    y: state.eye - 0.08 + 0.08 * reach,
    r: THREE.MathUtils.lerp(PORTAL_R, PORTAL_END_R, reach) * easeOutBack(clamp01((t - T_PORTAL) / 1.2)),
  };
}

const gullOutCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullInCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
let grabPoint = new THREE.Vector3();

function startSequence() {
  // Anchor everything to the current head pose, yaw only.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.updateMatrixWorld(true);
  const headPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  anchor.position.set(headPos.x, 0, headPos.z);
  anchor.rotation.set(0, yaw, 0);
  worldRoot.position.copy(anchor.position);
  worldRoot.rotation.set(0, yaw, 0);
  flyGroup.position.set(0, 0, 0);
  state.eye = THREE.MathUtils.clamp(headPos.y, 1.0, 1.9);

  grabPoint = billPositionAt(T_GRAB - T_BILL);
  const pz = PORTAL_Z, py = state.eye - 0.08;
  // Keep the gull at least ~0.6 m from the head: out to the left, around the
  // front of the bill, then in to grab it.
  gullOutCurve.points = [
    new THREE.Vector3(0.05, py, pz - 0.6),
    new THREE.Vector3(-0.1, py + 0.12, pz + 0.2),
    new THREE.Vector3(-0.75, py + 0.45, -1.0),
    new THREE.Vector3(-0.35, grabPoint.y + 0.45, grabPoint.z - 0.45),
    new THREE.Vector3(grabPoint.x - 0.12, grabPoint.y + 0.12, grabPoint.z - 0.12),
    grabPoint.clone().add(new THREE.Vector3(0, 0.03, -0.02)),
  ];

  state.start = performance.now() / 1000;
  state.running = true;
  state.inside = false;
  state.lastD = 1;
  setWorldMasked(true);
  setObjectMasked(false);
  portalMask.visible = true;
  ring.visible = true;
  hint.visible = false;
  bill.visible = false;
  gull.visible = false;
  video.stop();
  worldRoot.visible = spark.visible = true;
  playBall.visible = false;
  playBall.userData.pressedAt = -1;
  portal.scale.setScalar(0.0001);
  $('replay').hidden = true;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), camLocal = new THREE.Vector3();

function update(t, dt) {
  ringMaterial.uniforms.time.value = t;
  if (!state.running) return;
  const T = state.fixedT ?? (t - state.start);

  // Portal opens in the doorway; then the room (portal included) flies to the player.
  const pp = portalPoseAt(T);
  flyGroup.position.z = pp.fly;
  portal.position.set(0, pp.y, pp.z);
  portal.scale.setScalar(Math.max(0.0001, pp.r));
  ringMaterial.uniforms.radius.value = Math.max(0.05, pp.r);
  portal.visible = T > T_PORTAL;

  // Crossing: once the head is on the far side of the portal plane, show the
  // world everywhere.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  camLocal.setFromMatrixPosition(cam.matrixWorld);
  anchor.worldToLocal(camLocal);
  const d = camLocal.z - pp.z;
  if (!state.inside && T > T_GLIDE && d < 0) {
    state.inside = true;
    state.insideAt = T;
    setWorldMasked(false);
    portalMask.visible = false;
  }
  if (state.inside) {
    const k = clamp01((T - state.insideAt) / 1.0);
    ringMaterial.uniforms.opacity.value = 1 - k;
    ring.visible = k < 1;
  } else {
    ringMaterial.uniforms.opacity.value = 1;
  }
  fakeRoom.visible = !renderer.xr.isPresenting && !state.inside;
  handMesh.visible = state.inside;

  // Bill: falls until the gull grabs it, then hangs from the beak.
  if (T >= T_BILL && T < T_GRAB) {
    bill.visible = true;
    billPose(T - T_BILL, bill);
  }

  // Gull: out of the portal, swoop to the bill, back through the portal.
  if (T >= T_GULL_OUT) {
    gull.visible = true;
    let pos, ahead;
    if (T < T_GRAB) {
      const u = easeInOut(clamp01((T - T_GULL_OUT) / (T_GRAB - T_GULL_OUT)));
      pos = gullOutCurve.getPointAt(u, v1);
      ahead = gullOutCurve.getPointAt(Math.min(1, u + 0.02), v2);
      if (u > 0.98) ahead.copy(pos).add(new THREE.Vector3(0.1, 0.05, -0.3));
      gull.scale.setScalar(1.1 * clamp01((T - T_GULL_OUT) / 0.4 + 0.3));
      flap(T, u > 0.75 ? 0.35 : 1);
    } else {
      // Rebuild the return path each frame: the portal is already moving.
      // The far points sit in the room, so they ride along with the flight.
      const c = new THREE.Vector3(0, pp.y, pp.z);
      gullInCurve.points = [
        grabPoint.clone().add(new THREE.Vector3(0, 0.03, -0.02)),
        new THREE.Vector3(grabPoint.x - 0.05, grabPoint.y + 0.4, grabPoint.z - 0.2),
        c.clone().add(new THREE.Vector3(0.05, 0.05, 0.25)),
        c.clone().add(new THREE.Vector3(0, 0, -0.4)),
        c.clone().add(new THREE.Vector3(-0.4, 0.6, -2.0)),
        c.clone().add(new THREE.Vector3(-0.8, 1.3, -4.0)),
      ];
      const u = clamp01((T - T_GRAB) / ((T_GULL_IN - T_GRAB) * 2.6));
      const uu = u < 0.5 ? 2 * u * u : u; // speed up on take-off
      pos = gullInCurve.getPointAt(Math.min(1, uu), v1);
      ahead = gullInCurve.getPointAt(Math.min(1, uu + 0.02), v2);
      if (uu >= 0.99) ahead.copy(pos).add(new THREE.Vector3(-0.2, 0.2, -1));
      flap(T, 1);
      gull.visible = u < 1;
      // Behind the portal plane, only show the gull through the disk.
      if (!state.inside) setObjectMasked(pos.z < pp.z);
      else setObjectMasked(false);
      bill.visible = gull.visible;
      const tip = gull.userData.beakTip;
      gull.updateMatrixWorld(true);
      bill.position.copy(anchor.worldToLocal(tip.getWorldPosition(new THREE.Vector3()))).add(new THREE.Vector3(0, -0.035, 0));
      bill.quaternion.copy(gull.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(1.2, Math.PI / 2, 0.2 * Math.sin(T * 9))));
    }
    gull.position.copy(pos);
    gull.lookAt(anchor.localToWorld(ahead.clone()));
  }

  if (T > T_HINT && state.inside && !playBall.visible && !video.playing && playBall.userData.pressedAt < 0) {
    playBall.visible = hint.visible = true;
    playBall.userData.shownAt = T;
    hint.position.set(0, state.eye - 0.38, -0.62);
    if (!renderer.xr.isPresenting) $('replay').hidden = false;
  }
  if (playBall.visible) updatePlayBall(T, t);
}

const ballWorld = new THREE.Vector3();
function updatePlayBall(T, t) {
  const u = playBall.userData;
  const appear = easeOutBack(clamp01((T - u.shownAt) / 0.8));
  const press = u.pressedAt > 0 ? clamp01((t - u.pressedAt) / 0.45) : 0;
  playBall.position.set(0, state.eye - 0.2 + 0.025 * Math.sin(t * 1.6), -0.62);
  playBall.scale.setScalar(Math.max(0.0001, appear * (1 + press * 0.6)));
  u.ball.rotation.y = t * 0.4;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  u.iconPivot.lookAt(new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld));
  // Poke with an index fingertip.
  playBall.getWorldPosition(ballWorld);
  if (u.pressedAt < 0 && appear > 0.9 && fingertips.some((p) => p.distanceTo(ballWorld) < 0.13)) startVideo();
}

// ---------- startup ----------

let loaded = false;
const clock = { last: 0, frames: 0, fpsT: 0 };

renderer.setAnimationLoop((time, frame) => {
  const t = time / 1000;
  const dt = Math.min(0.1, t - clock.last); clock.last = t;
  if (!renderer.xr.isPresenting && state.running) {
    // Gentle head sway in the flat preview so depth reads.
    camera.position.set(Math.sin(t * 0.5) * 0.04, 1.6, 0);
  }
  update(performance.now() / 1000, dt);
  video.update();
  if (renderer.xr.isPresenting) updateHands(frame);
  if (DEBUG) {
    clock.frames++;
    if (t - clock.fpsT > 0.5) {
      fpsLabel.userData.draw(`${Math.round(clock.frames / (t - clock.fpsT))} fps`);
      clock.frames = 0; clock.fpsT = t;
    }
  }
  renderer.render(scene, camera);
});

room.initialized.then(() => {
  loaded = true;
  statusEl.textContent = 'Ready.';
  $('preview').disabled = false;
  checkXr();
}).catch((err) => {
  statusEl.textContent = `Could not load the room scan: ${err.message || err}`;
});

async function checkXr() {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  $('enterXr').disabled = !ok || !loaded;
  if (!ok) statusEl.textContent = 'Ready. Open this page in Quest Browser to enter mixed reality.';
}

$('enterXr').addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'layers'],
    });
    renderer.setClearColor(0x000000, 0);
    video.unlock();
    await renderer.xr.setSession(session);
    $('ui').hidden = true;
    // Pinch (select) with either hand replays once the sequence has finished.
    // Pinch while pointing at the ball also plays.
    session.addEventListener('select', (e) => {
      const ref = renderer.xr.getReferenceSpace();
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
      if (!pose || !playBall.visible) return;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const ray = new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m),
        new THREE.Vector3(0, 0, -1).transformDirection(m));
      playBall.getWorldPosition(ballWorld);
      if (ray.distanceSqToPoint(ballWorld) < 0.2 * 0.2) startVideo();
    });
    session.addEventListener('end', () => { $('ui').hidden = false; state.running = false; });
    // Give tracking a moment to settle before reading the head pose.
    setTimeout(startSequence, 600);
  } catch (err) {
    statusEl.textContent = `Could not start mixed reality: ${err.message || err}`;
  }
});

$('preview').addEventListener('click', () => {
  video.unlock();
  $('ui').hidden = true;
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  startSequence();
});
$('replay').addEventListener('click', () => {
  video.stop();
  camera.position.set(0, 1.6, 0);
  startSequence();
});
renderer.domElement.addEventListener('click', (e) => {
  if (renderer.xr.isPresenting || !playBall.visible) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  if (rc.intersectObject(playBall.userData.ball).length) startVideo();
});
window.__startVideo = startVideo;
window.__debug = { state, playBall, video, worldRoot };

// Test hook: freeze the sequence at a given time (seconds).
window.__setSequenceTime = (T) => { state.fixedT = T; };
window.__camera = camera;

if (params.has('autostart')) {
  room.initialized.then(() => $('preview').click());
}
