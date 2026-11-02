// $100,000 opening scene prototype.
// Mixed reality: a $100 bill falls from the ceiling, a seagull flies out of a
// portal standing in the room's entrance, grabs it and flies back in, then the
// player flies through the portal and on toward the table.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Video180 } from './video.js';
import { GullVoice } from './audio.js';

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
// The player rig: the flight moves this, so the room's splats stay put (moving
// the room instead makes Spark re-place every splat each frame).
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
const listener = new THREE.AudioListener();
camera.add(listener);

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

// Pure additive in colour and alpha. With the default additive mode a glow
// quad writes alpha 1 everywhere and shows as a black square in passthrough.
const GLOW_BLEND = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
};

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
  transparent: true, depthWrite: false, ...GLOW_BLEND, side: THREE.DoubleSide,
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
      col *= opacity;
      gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
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
  transparent: true, depthWrite: false, ...GLOW_BLEND,
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
      float k = d * vAlpha * opacity;
      gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * k, min(1.0, k));
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
  beak.position.set(0, 0.04, 0.24);
  gull.add(beak);
  const jaw = new THREE.Group(); // hinged at the base of the beak
  jaw.position.set(0, 0.03, 0.205);
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.062, 8), orange);
  lower.rotation.x = Math.PI / 2;
  lower.position.z = 0.031;
  jaw.add(lower);
  gull.add(jaw);
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
  gull.userData = { wings, beakTip, jaw, materials: [white, grey, dark, orange] };
  return gull;
}
const gull = makeSeagull();
gull.scale.setScalar(1.1);
anchor.add(gull);

const gullVoice = new GullVoice(listener, gull);
let lastStroke = -1;
function flap(t, strength, rate = 13) {
  // One whoosh per downstroke.
  const stroke = Math.floor((t * rate) / (Math.PI * 2) + 0.25);
  if (stroke !== lastStroke) { lastStroke = stroke; if (strength > 0.3) gullVoice.flap(strength); }
  for (const w of gull.userData.wings) {
    const a = Math.sin(t * rate) * 0.75 * strength;
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
rig.add(handMesh);
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
        if (name === 'index-finger-tip') fingertips.push(tmpPos.clone().applyMatrix4(rig.matrixWorld));
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
    transparent: true, depthWrite: false, ...GLOW_BLEND,
    uniforms: ringMaterial.uniforms,
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() { vPos = position.xy / 0.21; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec2 vPos;
      void main() {
        float r = length(vPos);
        float g = smoothstep(1.0, 0.5, r) * smoothstep(0.45, 0.55, r) * (0.55 + 0.25 * sin(time * 2.5));
        gl_FragColor = vec4(vec3(1.0, 0.75, 0.3) * g, g);
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
  playBall.userData.pressedAt = clock.now;
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
    window.dispatchEvent(new Event('scene:video-start'));
    video.play(pose, rig).catch((err) => {
      console.warn('Video failed:', err);
      if (video.playing) video.stop();
      else video.onEnded();
    });
  }, 450);
}
video.onEnded = () => {
  worldRoot.visible = spark.visible = true;
  playBall.visible = sceneApi.autoPlayBall;
  playBall.userData.pressedAt = -1;
  hint.visible = sceneApi.autoPlayBall;
  window.dispatchEvent(new Event('scene:video-end'));
};

const fpsLabel = makeLabel(320, 96);
fpsLabel.position.set(0, -0.18, -0.6);
fpsLabel.visible = DEBUG;
camera.add(fpsLabel);

// ---------- timeline ----------

const T_BILL = 0.6;        // bill appears at the ceiling and flutters to the floor
const T_PORTAL = 1.2;      // portal opens
const T_GULL_OUT = 2.6;    // gull flies out of the portal
const T_HOVER = 5.8;       // gull hovers in front of the viewer and looks at them
const T_CALLS = [6.5, 8.0]; // gull yells
const T_SWOOP = 9.4;       // gull dives for the bill on the floor
const T_GRAB = 10.6;       // gull picks it up
const T_GULL_IN = 12.4;    // gull is back through the portal
const T_GLIDE = 11.8;      // player starts flying through the portal

// Flight: constant speed with soft raised-cosine ramps at both ends, so it
// starts and stops without a jolt.
const RAMP = 1.2;
const GLIDE_DUR = FLY_DIST / FLY_SPEED + RAMP;
const T_ARRIVE = T_GLIDE + GLIDE_DUR;
const T_HINT = T_ARRIVE + 1.0; // play ball appears

const PORTAL_Z = -PORTAL_DIST, PORTAL_R = 0.55, PORTAL_END_R = 1.3;
const BILL_FALL = 0.42; // m/s

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const state = { running: false, start: 0, eye: 1.6, inside: false, arrived: false, calls: 0 };
const clock = { now: 0, last: 0, frames: 0, fpsT: 0 };

function flightDistance(t) {
  const v = FLY_SPEED, x = t - T_GLIDE;
  const ramp = (u) => v * (u / 2 - (RAMP / (2 * Math.PI)) * Math.sin((Math.PI * u) / RAMP));
  if (x <= 0) return 0;
  if (x >= GLIDE_DUR) return FLY_DIST;
  if (x < RAMP) return ramp(x);
  if (x > GLIDE_DUR - RAMP) return FLY_DIST - ramp(GLIDE_DUR - x);
  return (v * RAMP) / 2 + v * (x - RAMP);
}

const BILL_LAND_T = (2.35 - 0.006) / BILL_FALL;
function billPose(tb, out) {
  // Fluttering fall, drifting side to side, then lying flat on the floor.
  const k = Math.min(tb, BILL_LAND_T);
  out.position.set(
    0.24 + 0.12 * Math.sin(k * 2.2),
    Math.max(0.006, 2.35 - BILL_FALL * k),
    -0.8 + 0.06 * Math.sin(k * 1.7),
  );
  const settle = clamp01((tb - BILL_LAND_T + 0.5) / 0.5);
  out.rotation.set(
    THREE.MathUtils.lerp(0.6 * Math.sin(k * 2.2 + 1.0), -Math.PI / 2, settle),
    0.45 * k,
    THREE.MathUtils.lerp(0.9 * Math.sin(k * 2.2), 0, settle),
  );
}
const scratchBill = new THREE.Object3D();
function billPositionAt(tb) { billPose(tb, scratchBill); return scratchBill.position.clone(); }

// The portal stands in the doorway, fixed to the room. It widens as the player
// reaches it so it passes around the head.
function portalPoseAt(t, fly) {
  const reach = clamp01(fly / PORTAL_DIST);
  return {
    z: PORTAL_Z,
    y: state.eye - 0.08,
    r: THREE.MathUtils.lerp(PORTAL_R, PORTAL_END_R, reach) * easeOutBack(clamp01((t - T_PORTAL) / 1.2)),
  };
}

const gullOutCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullDiveCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullInCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const hoverPoint = new THREE.Vector3();
let grabPoint = new THREE.Vector3();

function startSequence() {
  // Anchor everything to the current head pose, yaw only.
  rig.position.set(0, 0, 0);
  rig.updateMatrixWorld(true);
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.updateMatrixWorld(true);
  const headPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  anchor.position.set(headPos.x, 0, headPos.z);
  anchor.rotation.set(0, yaw, 0);
  worldRoot.position.copy(anchor.position);
  worldRoot.rotation.set(0, yaw, 0);
  state.eye = THREE.MathUtils.clamp(headPos.y, 1.0, 1.9);

  const pz = PORTAL_Z, py = state.eye - 0.08;
  hoverPoint.set(-0.18, state.eye - 0.02, -0.72);
  grabPoint = billPositionAt(T_GRAB - T_BILL).add(new THREE.Vector3(0, 0.03, 0));
  // Out of the portal, a wide loop to the left and over the top, then in to
  // hover facing the viewer, never closer than ~0.6 m to the head.
  gullOutCurve.points = [
    new THREE.Vector3(0.05, py, pz - 0.6),
    new THREE.Vector3(0.0, py + 0.1, pz + 0.15),
    new THREE.Vector3(-0.7, py + 0.35, -1.0),
    new THREE.Vector3(-0.9, py + 0.8, -1.6),
    new THREE.Vector3(0.1, py + 0.95, -1.9),
    new THREE.Vector3(0.75, py + 0.6, -1.3),
    new THREE.Vector3(0.35, py + 0.25, -0.95),
    hoverPoint.clone(),
  ];
  gullDiveCurve.points = [
    hoverPoint.clone(),
    new THREE.Vector3(hoverPoint.x - 0.05, hoverPoint.y + 0.15, hoverPoint.z - 0.35),
    new THREE.Vector3(grabPoint.x - 0.1, grabPoint.y + 0.5, grabPoint.z - 0.35),
    new THREE.Vector3(grabPoint.x - 0.02, grabPoint.y + 0.1, grabPoint.z - 0.12),
    grabPoint.clone(),
  ];
  gullInCurve.points = [
    grabPoint.clone(),
    new THREE.Vector3(grabPoint.x - 0.05, grabPoint.y + 0.35, grabPoint.z - 0.25),
    new THREE.Vector3(0.05, py + 0.05, pz + 0.3),
    new THREE.Vector3(0, py, pz - 0.4),
    new THREE.Vector3(-0.4, py + 0.6, pz - 2.4),
    new THREE.Vector3(-0.8, py + 1.3, pz - 4.4),
  ];

  state.start = clock.now;
  state.running = true;
  state.inside = false;
  state.arrived = false;
  state.calls = 0;
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

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), camLocal = new THREE.Vector3(), camWorld = new THREE.Vector3();

function update(t, dt) {
  ringMaterial.uniforms.time.value = t;
  if (!state.running) return;
  const T = state.fixedT ?? (t - state.start);

  // Flight: move the player rig along the anchor's forward direction.
  const fly = flightDistance(T);
  rig.position.set(0, 0, -fly).applyQuaternion(anchor.quaternion);
  rig.updateMatrixWorld(true);
  if (!state.arrived && T >= T_ARRIVE) {
    state.arrived = true;
    window.dispatchEvent(new Event('scene:arrived'));
  }

  const pp = portalPoseAt(T, fly);
  portal.position.set(0, pp.y, pp.z);
  portal.scale.setScalar(Math.max(0.0001, pp.r));
  ringMaterial.uniforms.radius.value = Math.max(0.05, pp.r);
  portal.visible = T > T_PORTAL;

  // Crossing: once the head is on the far side of the portal plane, show the
  // world everywhere.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  camWorld.setFromMatrixPosition(cam.matrixWorld);
  camLocal.copy(camWorld);
  anchor.worldToLocal(camLocal);
  if (!state.inside && T > T_GLIDE && camLocal.z < pp.z) {
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

  // Bill: flutters down and lands on the floor until the gull picks it up.
  if (T >= T_BILL && T < T_GRAB) {
    bill.visible = true;
    billPose(T - T_BILL, bill);
  }

  // Gull.
  const jaw = gull.userData.jaw;
  jaw.rotation.x = 0;
  if (T >= T_GULL_OUT) {
    gull.visible = true;
    let pos, look = null, ahead = null;
    if (T < T_HOVER) {
      // Out of the portal and around in a loop.
      const u = easeInOut(clamp01((T - T_GULL_OUT) / (T_HOVER - T_GULL_OUT)));
      pos = gullOutCurve.getPointAt(u, v1);
      ahead = gullOutCurve.getPointAt(Math.min(1, u + 0.02), v2);
      if (u > 0.97) look = camWorld;
      gull.scale.setScalar(1.1 * clamp01((T - T_GULL_OUT) / 0.4 + 0.3));
      flap(T, u > 0.85 ? 0.7 : 1);
    } else if (T < T_SWOOP) {
      // Hover, face the viewer, yell.
      const h = T - T_HOVER;
      pos = v1.copy(hoverPoint).add(v2.set(0.02 * Math.sin(h * 1.3), 0.03 * Math.sin(h * 2.1), 0.015 * Math.sin(h * 0.9)));
      look = camWorld;
      flap(T, 0.85, 17);
      if (state.calls < T_CALLS.length && T >= T_CALLS[state.calls]) gullVoice.call(state.calls++);
      for (const tc of T_CALLS) {
        const c = (T - tc) / 0.6;
        if (c > 0 && c < 1) jaw.rotation.x = 0.55 * Math.sin(Math.PI * Math.min(1, c * 1.6)) * (0.8 + 0.2 * Math.sin(T * 40));
      }
      // Glance down at the bill before diving.
      if (T > T_SWOOP - 0.8) look = anchor.localToWorld(billPositionAt(T - T_BILL));
    } else if (T < T_GRAB) {
      const u = easeInOut(clamp01((T - T_SWOOP) / (T_GRAB - T_SWOOP)));
      pos = gullDiveCurve.getPointAt(u, v1);
      ahead = gullDiveCurve.getPointAt(Math.min(1, u + 0.03), v2);
      if (u > 0.95) ahead.copy(pos).add(new THREE.Vector3(0.05, -0.05, -0.3));
      flap(T, u > 0.7 ? 1 : 0.4);
    } else {
      // Take off with the bill and fly back through the portal into the room.
      const u = clamp01((T - T_GRAB) / ((T_GULL_IN - T_GRAB) * 2.4));
      const uu = u < 0.5 ? 2 * u * u : u;
      pos = gullInCurve.getPointAt(Math.min(1, uu), v1);
      ahead = gullInCurve.getPointAt(Math.min(1, uu + 0.02), v2);
      if (uu >= 0.99) ahead.copy(pos).add(new THREE.Vector3(-0.2, 0.2, -1));
      flap(T, 1);
      gull.visible = u < 1;
      // Behind the portal plane, only show the gull through the disk.
      setObjectMasked(!state.inside && pos.z < pp.z);
    }
    gull.position.copy(pos);
    gull.lookAt(look ? look : anchor.localToWorld(ahead.clone()));
    if (T >= T_GRAB) {
      bill.visible = gull.visible;
      const tip = gull.userData.beakTip;
      gull.updateMatrixWorld(true);
      bill.position.copy(anchor.worldToLocal(tip.getWorldPosition(new THREE.Vector3()))).add(new THREE.Vector3(0, -0.035, 0));
      bill.quaternion.copy(gull.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(1.2, Math.PI / 2, 0.2 * Math.sin(T * 9))));
    }
  }

  if (sceneApi.autoPlayBall && T > T_HINT && state.inside && !playBall.visible && !video.playing && playBall.userData.pressedAt < 0) {
    showPlayBall(true);
  }
  if (!renderer.xr.isPresenting && T > T_HINT) $('replay').hidden = false;
  if (playBall.visible) updatePlayBall(T, t);
}

function showPlayBall(on = true) {
  playBall.visible = hint.visible = on;
  playBall.userData.shownAt = state.fixedT ?? (clock.now - state.start);
  playBall.userData.pressedAt = -1;
  hint.position.set(0, state.eye - 0.38, -FLY_DIST - 0.62);
}

const ballWorld = new THREE.Vector3();
function updatePlayBall(T, t) {
  const u = playBall.userData;
  const appear = easeOutBack(clamp01((T - u.shownAt) / 0.8));
  const press = u.pressedAt > 0 ? clamp01((t - u.pressedAt) / 0.45) : 0;
  playBall.position.set(0, state.eye - 0.2 + 0.025 * Math.sin(t * 1.6), -FLY_DIST - 0.62);
  playBall.scale.setScalar(Math.max(0.0001, appear * (1 + press * 0.6)));
  u.ball.rotation.y = t * 0.4;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  u.iconPivot.lookAt(new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld));
  // Poke with an index fingertip.
  playBall.getWorldPosition(ballWorld);
  if (u.pressedAt < 0 && appear > 0.9 && fingertips.some((p) => p.distanceTo(ballWorld) < 0.13)) startVideo();
}

// Hooks for the Jane avatar and other scene modules.
// Events on window: 'scene:arrived' (flight into the room finished),
// 'scene:video-start', 'scene:video-end'.
const sceneApi = {
  THREE, scene, renderer, camera, rig, anchor, listener, state,
  // Set false to let Jane decide when the play ball appears (showPlayBall).
  autoPlayBall: true,
  showPlayBall,
  playVideo: () => { if (!playBall.visible) showPlayBall(true); startVideo(); },
  // Where the player stands after the flight, in world space: feet position
  // and horizontal forward direction (toward the coffee table).
  arrivalPose() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.quaternion);
    return { position: anchor.localToWorld(new THREE.Vector3(0, 0, -FLY_DIST)), forward };
  },
};
window.sceneApi = sceneApi;

// ---------- startup ----------

let loaded = false;
renderer.setAnimationLoop((time, frame) => {
  // One clock for everything: the frame's own timestamp (XR display time in
  // the headset), so motion steps evenly from frame to frame.
  const t = time / 1000;
  clock.now = t;
  const dt = Math.min(0.1, t - clock.last); clock.last = t;
  if (!renderer.xr.isPresenting && state.running) {
    // Gentle head sway in the flat preview so depth reads.
    camera.position.set(Math.sin(t * 0.5) * 0.04, 1.6, 0);
  }
  update(t, dt);
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
    listener.context.resume();
    await renderer.xr.setSession(session);
    $('ui').hidden = true;
    // Pinch (select) with either hand replays once the sequence has finished.
    // Pinch while pointing at the ball also plays.
    session.addEventListener('select', (e) => {
      const ref = renderer.xr.getReferenceSpace();
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
      if (!pose || !playBall.visible) return;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(rig.matrixWorld);
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
  listener.context.resume();
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
