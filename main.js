// $100,000 opening.
// Mixed reality: "Seagulls Love Too" starts, a portal opens in the room's
// entrance, a seagull comes out and settles on the bottom of its rim. A $100
// bill flutters down from the ceiling to it, the gull jumps up, catches it and
// flies back in, and the player flies through the portal into the room scan.
// Jane is there already, and goes through her poses, 3 s each (yoga, surf,
// singing, heart). The play ball starts the 180 video, with palm-sized
// controls (back 10 s, pause, close) at the lower edge of the picture while
// it plays. After the video Jane offers the jetski race: a toy
// jetski floats in front of the player, and touching it starts the race
// (jetski/race.js) right here, in the same session. Back from the race, the
// video's play ball floats beside the jetski.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { Video180 } from './video.js';
import { VideoControls } from './video-controls.js';
import { GullVoice } from './audio.js';
import { createJane } from './jane/jane.js';
import { createSplatJane, JANE_SCANS } from './jane/splat-jane.js';

const params = new URLSearchParams(location.search);
const num = (name, def) => {
  const v = params.get(name);
  return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def;
};
const USE_LOD = params.get('lod') !== '0';
const DEBUG = params.has('debug');
const FLY_SPEED = num('speed', 0.4); // m/s, constant
// Untouched 8K60 HEVC master (tools/segment-original.sh, 130 Mbit/s): too big
// for GitHub Pages (1 GB a site), so it lives on the video-8k branch and
// streams from GitHub's raw file server. Next to it, in light/, is the same 8K
// picture at 60 Mbit/s (tools/encode-8k-light.sh) for connections that can't
// keep up with the master. The headset loads the best of the two it can ahead
// of time and plays the one that will run without stalling (video.js); the 4K
// H.264 copy in ./video/ takes over where HEVC can't be decoded or the
// connection is too slow for both, and is all a flat screen or a phone needs.
// ?video=original, light, 8k (both 8K ones) or 4k picks; ?video=<folder>/,<folder>/ lists others.
const ORIGINAL_SRC = 'https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/';
const LIGHT_SRC = `${ORIGINAL_SRC}light/`;
const COPY_SRC = './video/';
const IS_HEADSET = /OculusBrowser|Quest/i.test(navigator.userAgent);
const VIDEO_SRC = (() => {
  const named = { original: [ORIGINAL_SRC], light: [LIGHT_SRC], '8k': [ORIGINAL_SRC, LIGHT_SRC], '4k': [COPY_SRC] };
  const asked = (params.get('video') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (asked.length) return asked.flatMap((s) => named[s.toLowerCase()] || [s]);
  return IS_HEADSET ? [ORIGINAL_SRC, LIGHT_SRC, COPY_SRC] : [COPY_SRC];
})();
// Room scan: 400k splats (Ilia, Nov 16), its floor lifted 7 cm to meet the
// real one. ?scan=<url> and ?floor=<metres> override.
const ROOM_URL = params.get('scan') || './assets/room-400k.sog';
const FLOOR = num('floor', 0.07);
// Quest settings Ilia picked on the Jane splat test page (Nov 16): splat
// budget 500k, 80% resolution, strongest fixed foveation, and the "fast"
// preset. Each takes the same URL option as on that page.
const SPARK_KNOBS = {
  lodSplatCount: num('budget', 500) * 1000,
  lodRenderScale: num('lodpx', 1),
  maxStdDev: num('stddev', 2.4),
  minSortIntervalMs: num('sortms', 33),
  clipXY: num('clip', 1.2),
  minPixelRadius: num('minpx', 0.5),
  maxPixelRadius: num('maxpx', 256),
  coneFoveate: num('cone', 0.3),
  behindFoveate: num('behind', 0.1),
};
const FB = Math.min(1.5, Math.max(0.3, num('fb', 0.8)));
const FFR = Math.min(1, Math.max(0, num('ffr', 1)));
// Where Jane stands, in room-scan x,z: clear floor right of the coffee table,
// 0.5 m further right than the first spot (Ilia, Nov 16). Same as the test page.
const JANE_SPOT = new THREE.Vector2(...(params.get('spot') || '-0.68,-1.93').split(',').map(Number));
const MUSIC_VOLUME = Math.min(1, Math.max(0, num('music', 0.55)));

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

// No multisampling: it does nothing for splats and costs frame rate. The
// jetski race's islands and jetskis do get smoother edges with it, so ?aa=1
// turns it on for the whole session, to compare in the headset.
const renderer = new THREE.WebGLRenderer({ antialias: params.get('aa') === '1', alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(FFR);
renderer.xr.setFramebufferScaleFactor(FB);
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
  if (raceBox.api) raceBox.api.resize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun);

const spark = new SparkRenderer({ renderer, ...SPARK_KNOBS });
Object.assign(spark, SPARK_KNOBS);
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

// Outside the room: a 360 photo of a tropical island all round, in place of
// the plain sky (Ilia, Nov 17: "so it's not just black"). Until his photo
// comes, assets/outside.jpg is a 360 view of the race's lagoon from its start
// beach, the lagoon ahead. Any 2:1 equirectangular JPEG or PNG works:
// ?outside=<url> tries another, ?outside=off keeps the plain sky, and
// ?outsideturn=<degrees> turns it. It is in before the Start buttons unlock.
const OUTSIDE_URL = params.get('outside') || './assets/outside.jpg';
const outsideReady = OUTSIDE_URL === 'off' ? Promise.resolve() : new THREE.TextureLoader().loadAsync(OUTSIDE_URL).then((tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  renderer.initTexture(tex);
  const geo = new THREE.SphereGeometry(60, 64, 32);
  geo.scale(-1, 1, 1); // seen from inside without being mirrored
  sky.geometry.dispose();
  sky.geometry = geo;
  Object.assign(sky.material, { map: tex, vertexColors: false, side: THREE.FrontSide, toneMapped: false });
  sky.material.needsUpdate = true;
  sky.position.y = 1.5; // its horizon at eye height
  sky.rotation.y = THREE.MathUtils.degToRad(num('outsideturn', 0));
}).catch(() => console.info(`outside: no ${OUTSIDE_URL}, the plain sky stays`));

maskToPortal(spark.material);

const room = new SplatMesh({
  url: ROOM_URL,
  lod: USE_LOD ? true : undefined,
  onProgress: (e) => {
    if (e.lengthComputable) statusEl.textContent = `Loading room scan ${Math.round((e.loaded / e.total) * 100)}%`;
  },
});
room.rotation.x = Math.PI;
room.position.y = FLOOR;
scanGroup.add(room);

// Jane's splats stand in the room at JANE_SPOT, turned toward the point where
// the flight ends (jane/splat-jane.js has the particle transformation).
// Scan (x, z) is (x, -z) in scanGroup. Ilia's five poses (Nov 17): she is
// already in the room in the first one while the player flies in (yoga),
// goes through the next ones on arrival, ?hold=3 seconds each (surf, sing,
// heart), and stays on the last while she offers the video. After the video
// she forms again in the jetski pose, offering the race. ?poses=yoga,surf,
// sing,heart and ?after=jetski change them (also: new, the shaka pose). A
// pose whose file isn't in assets/jane/ yet is skipped.
const ARRIVAL_SCAN = TARGET.at.clone().addScaledVector(FLY_DIR, -TARGET.stop);
const poseList = (name, def) => {
  const list = (params.get(name) || '').split(',').map((s) => s.trim()).filter((k) => JANE_SCANS[k]);
  return list.length ? list : def;
};
const JANE_POSES = poseList('poses', ['yoga', 'surf', 'sing', 'heart']);
const JANE_AFTER = poseList('after', ['jetski'])[0];
const splatJane = params.get('jane') === 'off' ? null : createSplatJane({
  parent: scanGroup,
  spot: new THREE.Vector3(JANE_SPOT.x, 0, -JANE_SPOT.y),
  faceTo: new THREE.Vector3(ARRIVAL_SCAN.x, 0, -ARRIVAL_SCAN.y),
  spark,
  height: num('height', 1.75),
  sparks: num('sparks', 0.35), // share of splats that fly as sparks in her transformation
  hold: Math.max(0.5, num('hold', 3)),
  morph: Math.max(0.5, num('morph', 2)),
  scans: [...JANE_POSES, JANE_AFTER].map((k) => JANE_SCANS[k]),
  chainEnd: JANE_POSES.length - 1,
});
if (splatJane) {
  addEventListener('scene:arrived', () => splatJane.chain());
  addEventListener('scene:video-start', () => splatJane.hide());
  addEventListener('scene:video-end', () => splatJane.appear(JANE_POSES.length, false));
}

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

// Ilia's twisted bill mesh (assets/seagull/bill.glb, from his FBX) wearing his
// photo of a real $100 note (Nov 17). It lies in the XY plane facing +Z, like
// a sheet of paper. Its UVs spread the whole image over each face, mirrored
// on the back, so each face is pointed at its half of bill-100.jpg here: the
// front of the note on top, the back below, both upright.
function mapBillFaces(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position, uv = g.attributes.uv;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const across = (i) => (pos.getX(i) - min.x) / (max.x - min.x); // 0 at one end of the note, 1 at the other
  for (let i = 0; i < pos.count; i += 3) {
    let front = 0, back = 0;
    for (let k = i; k < i + 3; k++) {
      front = Math.max(front, Math.abs(uv.getX(k) - across(k)));
      back = Math.max(back, Math.abs(uv.getX(k) - (1 - across(k))));
    }
    for (let k = i; k < i + 3; k++) {
      if (front < 0.02) uv.setY(k, 0.5 + 0.5 * uv.getY(k));
      else if (back < 0.02) uv.setY(k, 0.5 * uv.getY(k));
      else uv.setXY(k, 0.003, 0.75); // the thin edges: paper from the margin
    }
  }
  uv.needsUpdate = true;
  return g;
}
const billTexture = new THREE.TextureLoader().load('./assets/seagull/bill-100.jpg');
billTexture.colorSpace = THREE.SRGBColorSpace;
billTexture.anisotropy = 4;
const gltfLoader = new GLTFLoader();
const bill = new THREE.Group();
const billMaterial = new THREE.MeshBasicMaterial({ map: billTexture, side: THREE.DoubleSide });
anchor.add(bill);
const billReady = gltfLoader.loadAsync('./assets/seagull/bill.glb').then((gltf) => {
  let mesh = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  mesh.geometry = mapBillFaces(mesh.geometry);
  mesh.material = billMaterial;
  // The model is 773.7 units long. A real bill is 15.6 cm; it's drawn 1.3x
  // (20.3 cm) so it reads at arm's length, centred on its twist.
  const s = 0.203 / 773.66;
  mesh.scale.setScalar(s);
  mesh.position.set(0, 0, -8.54 * s);
  bill.add(mesh);
});

// ---------- seagull ----------
// Ilia's rigged gull (assets/seagull/seagull.glb, from SK_Mesh_Seagull.FBX and
// Anim_Seagull_Fly.FBX): a 0.4 s wing-beat loop ("fly", its forward root
// motion taken out) and a wings-level pose from it ("glide"). It is painted
// as a herring gull with vertex colours until its texture PNGs come over.
// The model faces +Z, so Object3D.lookAt points the beak along the flight path.
const GULL_SIZE = 0.68; // the model spans 1.77 m wing to wing; 1.2 m suits a room
const gull = new THREE.Group();
gull.userData = { materials: [], beakTip: new THREE.Object3D(), jaw: null, head: null, mixer: null, fly: null, glide: null, phase: 0 };
anchor.add(gull);

// The model only has flying animations, so its sitting pose is made here: the
// rest pose (standing on its legs, wings spread) with each wing folded in a Z,
// upper arm back, forearm down and forward, hand back along the body so the
// primaries lie over the tail. Works on the rest pose before the model joins
// the scene, so its own frame is the world frame. Returns [bone, quaternion].
function foldWings(model) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bone = (n) => model.getObjectByName(`Seagull_${n}_bone`);
  const chain = [];
  for (const [s, side] of [[1, 'l'], [-1, 'r']]) {
    chain.push(
      [bone(`${side}_Humerus`), V(s * 0.08, -0.3, -1), V(-s, 0.2, 0), s],
      [bone(`${side}_Ulna`), V(0, -0.95, 0.3), V(s, 0, 0), s],
      [bone(`${side}_Aula`), V(s * 0.04, 0.06, -1), V(0, 1, 0), s],
    );
  }
  model.updateMatrixWorld(true);
  const rest = chain.map(([b]) => b.quaternion.clone());
  // In the rest pose each wing bone runs straight out along x, upper side up.
  const axes = chain.map(([b, , , s]) => {
    const inv = b.getWorldQuaternion(new THREE.Quaternion()).invert();
    return [V(s, 0, 0).applyQuaternion(inv), V(0, 1, 0).applyQuaternion(inv)];
  });
  chain.forEach(([b, L, N], i) => {
    const q = b.getWorldQuaternion(new THREE.Quaternion());
    const l0 = axes[i][0].clone().applyQuaternion(q).normalize();
    const n0 = axes[i][1].clone().applyQuaternion(q);
    n0.addScaledVector(l0, -n0.dot(l0)).normalize();
    const l1 = L.clone().normalize();
    const n1 = N.clone().addScaledVector(l1, -N.dot(l1)).normalize();
    const m0 = new THREE.Matrix4().makeBasis(l0, n0, l0.clone().cross(n0));
    const m1 = new THREE.Matrix4().makeBasis(l1, n1, l1.clone().cross(n1));
    const turn = new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
    const parentInv = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    b.quaternion.copy(parentInv.multiply(turn.multiply(q)));
    b.updateMatrixWorld(true);
  });
  const fold = chain.map(([b]) => [b, b.quaternion.clone()]);
  chain.forEach(([b], i) => b.quaternion.copy(rest[i]));
  model.updateMatrixWorld(true);
  return fold;
}

const gullReady = gltfLoader.loadAsync('./assets/seagull/seagull.glb').then((gltf) => {
  const u = gull.userData;
  const model = gltf.scene;
  model.scale.setScalar(GULL_SIZE);
  u.fold = foldWings(model);
  gull.add(model);
  let skinned = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false; // the bind-pose bounds don't follow the wings
    skinned = skinned || o;
    for (const m of [].concat(o.material)) u.materials.push(m);
  });
  // The beak tip (front-most vertex of the bind pose) rides on the beak bone.
  model.updateMatrixWorld(true);
  const beak = model.getObjectByName('Seagull_Beak_bone');
  const p = skinned.geometry.attributes.position, v = new THREE.Vector3(), tip = new THREE.Vector3(0, 0, -1e9);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(skinned.matrixWorld);
    if (v.z > tip.z) tip.copy(v);
  }
  u.beakTip.position.copy(beak.worldToLocal(tip));
  beak.add(u.beakTip);
  u.jaw = model.getObjectByName('Seagull_Mandible_bone');
  u.head = model.getObjectByName('Seagull_Head_bone');
  // Bones the code turns on top of the animation (folded wings, head, jaw).
  // The mixer only writes a bone when its animated value changes, so these
  // are put back to the animation's own pose before every update.
  u.animQ = new Map([...u.fold.map(([b]) => b), u.head, u.jaw].map((b) => [b, b.quaternion.clone()]));
  u.mixer = new THREE.AnimationMixer(model);
  u.fly = u.mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'fly'));
  u.glide = u.mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'glide'));
  u.fly.play();
  u.glide.play();
  // Where its feet are when it sits, in its own frame.
  poseGull(0, 0, BEAT, 1, false);
  gull.updateMatrixWorld(true);
  const toes = ['l', 'r'].map((side) => model.getObjectByName(`Seagull_${side}_Toe_bone`).getWorldPosition(new THREE.Vector3()));
  u.feet = gull.worldToLocal(toes[0].add(toes[1]).multiplyScalar(0.5));
  u.feet.y -= 0.004; // the toe joint sits just above the sole
  const pelvis = model.getObjectByName('Seagull_Pelvis_bone');
  u.bodyRest = gull.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3()));
  // Its body in flight, averaged over a wing beat.
  u.bodyFly = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    poseGull(1 / 8 / BEAT, 1, BEAT, 0, false);
    gull.updateMatrixWorld(true);
    u.bodyFly.add(gull.worldToLocal(pelvis.getWorldPosition(new THREE.Vector3())));
  }
  u.bodyFly.divideScalar(8);
  // Where the beak tip sits in its own frame, mid wing beat.
  u.phase = 0;
  poseGull(0, 1, BEAT, 0, false);
  gull.updateMatrixWorld(true);
  u.tipLocal = gull.worldToLocal(u.beakTip.getWorldPosition(new THREE.Vector3()));
  setObjectMasked(false);
});

const gullVoice = new GullVoice(listener, gull);
// Wing beats per second; the clip's own pace is 2.5. BEAT_HOVER: braking to
// land and taking off, when a gull beats harder and faster.
const BEAT = 2.2, BEAT_HOVER = 3.1;
const JAW_SIGN = -1; // which way round the mandible bone opens the beak
// strength: 1 full wing beats, 0 gliding with the wings level.
// perch: 1 sitting (standing legs, folded wings), blending in from flight.
// sound: a soft rustle on the hard downstrokes of landing and take-off (a
// gull cruising is all but silent).
function poseGull(dt, strength, beat = BEAT, perch = 0, sound = true) {
  const u = gull.userData;
  if (!u.mixer) return;
  for (const [b, q] of u.animQ) b.quaternion.copy(q);
  const w = clamp01(perch), s = clamp01(strength);
  const before = Math.floor(u.phase - 0.05);
  u.phase += dt * beat * (1 - w);
  u.flapS = s * (1 - w);
  // On the downstroke (the beat starts with the wings up).
  if (sound && Math.floor(u.phase - 0.05) !== before && s > 0.85 && beat > BEAT + 0.3 && w < 0.5) gullVoice.flap(s);
  // Whatever weight flight doesn't take goes to the rest pose (standing).
  u.fly.setEffectiveWeight(s * (1 - w));
  u.glide.setEffectiveWeight((1 - s) * (1 - w));
  u.fly.time = (u.phase % 1) * u.fly.getClip().duration;
  u.mixer.update(0);
  for (const [b, q] of u.animQ) q.copy(b.quaternion);
  if (w > 0) for (const [b, q] of u.fold) b.quaternion.slerp(q, w);
}

// Turn the head on top of the pose so the beak points at `target` (world
// position), by at most 75 degrees, `weight` of the way.
function aimHead(target, weight) {
  const u = gull.userData;
  if (!u.head || weight <= 0) return;
  gull.updateMatrixWorld(true);
  const hp = u.head.getWorldPosition(new THREE.Vector3());
  const cur = u.beakTip.getWorldPosition(new THREE.Vector3()).sub(hp).normalize();
  const want = target.clone().sub(hp).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(cur, want);
  const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
  const part = new THREE.Quaternion().slerp(turn, weight * Math.min(1, THREE.MathUtils.degToRad(75) / Math.max(angle, 1e-6)));
  const hq = u.head.getWorldQuaternion(new THREE.Quaternion());
  const parentInv = u.head.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  u.head.quaternion.copy(parentInv.multiply(part.multiply(hq)));
}

// Bill and gull go behind the stencil while they are on the world side of the portal.
function setObjectMasked(masked) {
  for (const m of [...gull.userData.materials, billMaterial]) {
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
      for (let j = 0; j < JOINTS.length; j++) {
        const space = src.hand.get(JOINTS[j]);
        const pose = space && frame.getJointPose(space, ref);
        if (!pose) continue;
        const p = pose.transform.position, o = pose.transform.orientation;
        tmpPos.set(p.x, p.y, p.z); tmpQuat.set(o.x, o.y, o.z, o.w);
        tmpScale.setScalar(Math.max(0.006, pose.radius || 0.008));
        handMesh.setMatrixAt(n++, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
        if (JOINTS[j] === 'index-finger-tip') fingertips.push(tmpPos.clone().applyMatrix4(rig.matrixWorld));
      }
    }
  }
  handMesh.count = n;
  handMesh.instanceMatrix.needsUpdate = true;
}

// Controller rays, drawn only while they point at the video controls.
const pointers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xf2c45a, transparent: true, opacity: 0.85 }),
  );
  line.visible = false;
  c.add(line);
  c.addEventListener('connected', (e) => { c.userData.source = e.data; });
  c.addEventListener('disconnected', () => { c.userData.source = null; line.visible = false; });
  rig.add(c);
  return { c, line };
});
const rayOf = (obj) => {
  const m = obj.matrixWorld;
  return new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m), new THREE.Vector3(0, 0, -1).transformDirection(m));
};

// ---------- in-headset text (replay hint, debug fps) ----------

function makeLabel(width = 512, height = 128, size = 46) {
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
    g.fillStyle = '#f2c45a'; g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    lines.forEach((line, i) => g.fillText(line, width / 2, height / 2 + (i - (lines.length - 1) / 2) * size * 1.25, width - 40));
    tex.needsUpdate = true;
  };
  return mesh;
}
// ---------- play button and 180 video ----------

// ?edge=6: degrees the dark surround reaches into the picture's rim. ?hz=90:
// display refresh rate while the video plays (0 leaves it alone; by default
// one the video's frame rate divides, 120 for 60 fps). ?disk=300: sources of
// at least this many MB are kept on disk between visits.
const video = new Video180({
  renderer, scene, src: VIDEO_SRC,
  edge: num('edge', 6),
  hz: params.has('hz') ? num('hz', 0) : undefined,
  keepFrom: num('disk', 300) * 1e6,
});
video.ready.catch((err) => console.warn('Video not available:', err.message || err));
// The video starts loading as soon as the opening has what it needs (the
// start buttons are unlocked and Jane's scans are in), so by the time the
// ball is touched most of it is here. ?preload=0 leaves it until then.
if (params.get('preload') !== '0') {
  const startButton = $('preview');
  const unlocked = new Promise((done) => {
    const check = () => { if (!startButton.disabled) { watch.disconnect(); done(); } };
    const watch = new MutationObserver(check);
    watch.observe(startButton, { attributes: true, attributeFilter: ['disabled'] });
    check();
  });
  Promise.allSettled([unlocked, splatJane?.ready]).then(() => video.preload());
}
// Back 10 s, pause / play and close, within reach at the lower edge of the
// picture for as long as the video plays. ?controls=0.3,0.43: how far below
// and ahead of the eyes the plate's middle is, metres.
const CONTROLS_AT = (params.get('controls') || '').split(',').map(parseFloat);
const videoControls = new VideoControls({
  scene, listener,
  onBack: () => video.seekBy(-10),
  onToggle: () => video.togglePause(),
  onClose: () => video.stop(),
  ...(CONTROLS_AT.length === 2 && CONTROLS_AT.every(Number.isFinite) ? { below: CONTROLS_AT[0], ahead: CONTROLS_AT[1] } : {}),
});

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
  // base: where it floats (anchor space); null for its own spot past the end of the flight.
  playBall.userData = { ball, iconPivot, pressedAt: -1, base: null };
  playBall.visible = false;
  anchor.add(playBall);
}

const hint = makeLabel();
hint.userData.draw('Touch the ball to play');
hint.scale.setScalar(0.6);
anchor.add(hint);

function startVideo() {
  if (video.playing || !playBall.visible) return;
  video.prime(); // the player fills while the room fades
  stopMusic();
  playBall.userData.pressedAt = clock.now;
  hint.visible = false;
  // Centre the 180 on the viewer's head, facing the way the room faces.
  const head = (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  head.updateMatrixWorld(true);
  const pose = new THREE.Object3D();
  pose.position.setFromMatrixPosition(head.matrixWorld);
  pose.quaternion.copy(anchor.quaternion);
  gullVoice.setLevel(0, 0.2);
  setTimeout(() => {
    worldRoot.visible = spark.visible = false;
    playBall.visible = false;
    // Under the middle of the picture, which faces the way the room does.
    videoControls.show(renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, renderer.xr.isPresenting,
      new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion));
    window.dispatchEvent(new Event('scene:video-start'));
    video.play(pose, rig).catch((err) => {
      console.warn('Video failed:', err);
      if (video.playing) video.stop();
      else video.onEnded();
    });
  }, 450);
}
video.onEnded = () => {
  videoControls.hide();
  worldRoot.visible = spark.visible = true;
  showPlayBall(sceneApi.autoPlayBall);
  window.dispatchEvent(new Event('scene:video-end'));
};

// ---------- music ----------
// "Seagulls Love Too" plays under everything until the video starts, a
// little quieter while Jane talks. ?music=0 mutes it, ?music=0.3 sets the level.

const music = new Audio('./jetski/audio/seagulls-love-too.mp3');
music.loop = true;
music.preload = 'auto';
music.volume = 0;
const musicState = { target: 0, level: 0 };
// Call inside the Enter / Preview click so the browser lets it play with sound.
function unlockMusic() {
  if (!MUSIC_VOLUME) return;
  const p = music.play();
  if (p) p.then(() => { if (!musicState.target) music.pause(); }).catch(() => {});
}
function startMusic() {
  if (!MUSIC_VOLUME) return;
  music.currentTime = 0;
  musicState.target = MUSIC_VOLUME;
  music.play().catch((err) => console.warn('Music did not start:', err.message || err));
}
function stopMusic(now = false) {
  musicState.target = 0;
  if (now) { musicState.level = 0; music.volume = 0; music.pause(); }
}
function updateMusic(dt) {
  const talking = window.__jane?.st?.talking;
  const want = musicState.target * (talking ? 0.45 : 1);
  const rate = want < musicState.level ? 6 : 2; // quick fade out, slow fade in
  musicState.level += (want - musicState.level) * Math.min(1, dt * rate);
  music.volume = Math.min(1, Math.max(0, musicState.level));
  if (!musicState.target && musicState.level < 0.005 && !music.paused) music.pause();
}

const fpsLabel = makeLabel(900, 150, 38);
fpsLabel.position.set(0, -0.18, -0.6);
fpsLabel.visible = DEBUG;
camera.add(fpsLabel);

// ---------- timeline ----------

const T_PORTAL = 0.6;      // portal opens
const T_GULL_OUT = 1.0;    // a gull flies across the room on the far side toward the portal...
const T_PERCH = 2.8;       // ...brakes and lands on the bottom of its rim, facing the viewer
const T_CALLS = [3.25];    // and yells at them
const T_BILL = 3.5;        // a $100 bill appears at the ceiling and flutters down to the gull
const BILL_FALL = 0.42;    // m/s
const BILL_TOP = 0.75;     // m above eye level, where it appears
const BILL_DROP = 0.88;    // m it falls before the gull catches it, half a metre above the rim's lowest point
const T_GRAB = T_BILL + BILL_DROP / BILL_FALL; // the gull catches it (~5.6 s)
const T_SWOOP = T_GRAB - 0.5;     // gull jumps up off the rim for it
const T_GULL_GONE = T_GRAB + 2.7; // gull is through the portal and out of sight
const T_GLIDE = T_GRAB + 0.9;     // player starts flying through the portal

// Flight: constant speed with soft raised-cosine ramps at both ends, so it
// starts and stops without a jolt.
const RAMP = 1.2;
const GLIDE_DUR = FLY_DIST / FLY_SPEED + RAMP;
const T_ARRIVE = T_GLIDE + GLIDE_DUR;
const T_HINT = T_ARRIVE + 1.0; // play ball appears

const PORTAL_Z = -PORTAL_DIST, PORTAL_R = 0.55, PORTAL_END_R = 1.3;
const OPEN_AHEAD = 0.3; // m before the portal's plane where the world opens up around the player

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };

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

function billPose(tb, out) {
  // Flutters down from the ceiling in front of the portal, drifting side to
  // side, to the gull waiting under it (it never reaches the floor).
  const top = state.eye + BILL_TOP;
  out.position.set(
    0.08 + 0.1 * Math.sin(tb * 2.2),
    Math.max(0.006, top - BILL_FALL * tb),
    -0.8 + 0.05 * Math.sin(tb * 1.7),
  );
  out.rotation.set(0.6 * Math.sin(tb * 2.2 + 1.0), 0.45 * tb, 0.9 * Math.sin(tb * 2.2));
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

// Gull paths, through the gull's body (anchor space).
const gullOutCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullSwoopCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullClimbCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
const gullDiveCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
// The way off with the bill: a climb, a stall turn at the top (it hangs
// nose up and swings round, as gulls do in a breeze) and a dive into the
// portal. A U-turn that tight in level flight is beyond any bird.
const EXIT_CLIMB = 0.24, EXIT_TURN = 0.42; // shares of the way off
// Where it catches the bill it's flying up and toward the viewer, a little to the right.
const SWOOP_END = new THREE.Vector3(0.3, 0.62, 0.72).normalize();
const ZERO = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpM = new THREE.Matrix4();
// Rotation (anchor space) that turns the gull's beak along `dir`.
const facing = (dir, out = new THREE.Quaternion()) => out.setFromRotationMatrix(tmpM.lookAt(dir, ZERO, UP));
// Put the gull's body at `body` (anchor space). The body sits lower in the
// model when it stands than when it flies, so shift by the blend of the two.
// Flapping, it rises a little on each downstroke and sinks on the upstroke.
function placeGull(body, quat, perch) {
  const u = gull.userData;
  gull.quaternion.copy(quat);
  const off = new THREE.Vector3().lerpVectors(u.bodyFly, u.bodyRest, clamp01(perch)).applyQuaternion(quat);
  gull.position.copy(body).sub(off);
  gull.position.y -= 0.014 * (u.flapS || 0) * Math.cos(2 * Math.PI * u.phase);
}
// How a bird sits in the air along a path: beak along the path, rolled into
// a turn the way lift has to lean toward its inside (a bank), and with
// `flare` (radians) the nose pitched up as it brakes. `speed` in m/s.
const BANK_MAX = 0.95; // about 55 degrees
const tanA = new THREE.Vector3(), tanB = new THREE.Vector3(), lean = new THREE.Vector3();
const wingAxis = new THREE.Vector3(), backAxis = new THREE.Vector3(), flareQ = new THREE.Quaternion();
function flightQuat(curve, u, speed, flare = 0, out = new THREE.Quaternion()) {
  const len = curve.getLength(), d = Math.min(0.03, 0.12 / len);
  const ua = Math.max(0.001, u - d), ub = Math.min(0.999, u + d);
  const fwd = curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)), v2);
  curve.getTangentAt(ua, tanA); curve.getTangentAt(ub, tanB);
  // Sideways acceleration: the path's curvature times speed squared.
  lean.subVectors(tanB, tanA).divideScalar(Math.max(1e-4, (ub - ua) * len)).multiplyScalar(speed * speed);
  lean.addScaledVector(fwd, -lean.dot(fwd));
  lean.clampLength(0, 9.8 * Math.tan(BANK_MAX));
  lean.y += 9.8;
  // Wings across the lift, back up along it (the model's x, y and z).
  wingAxis.crossVectors(lean, fwd);
  if (wingAxis.lengthSq() < 1e-8) wingAxis.set(1, 0, 0); // straight up or down
  wingAxis.normalize();
  backAxis.crossVectors(fwd, wingAxis);
  out.setFromRotationMatrix(tmpM.makeBasis(wingAxis, backAxis, fwd));
  if (flare) out.multiply(flareQ.setFromAxisAngle(X_AXIS, -flare));
  return out;
}
// The lowest point of the portal's rim, where the gull sits (anchor space).
const perchPoint = (pp) => new THREE.Vector3(0, pp.y - pp.r + 0.003, pp.z);
// Its body when it sits there turned by `quat`.
function perchBody(pp, quat) {
  const u = gull.userData;
  return perchPoint(pp).add(u.bodyRest.clone().sub(u.feet).applyQuaternion(quat));
}

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
  const u = gull.userData;
  // Sitting on the bottom of the open portal's rim, facing the viewer (the anchor's +Z).
  const sit = perchBody({ y: py, r: PORTAL_R, z: pz }, new THREE.Quaternion());
  // In from high up at the back of the room on the far side, curving down
  // toward the portal, lined up with its rim for the last metre, and a flare
  // onto the rim's lowest point: always moving forward, like landing on a
  // window sill from inside.
  gullOutCurve.points = [
    new THREE.Vector3(-0.85, py + 0.7, pz - 3.3),
    new THREE.Vector3(-0.38, py + 0.4, pz - 1.9),
    new THREE.Vector3(0.03, sit.y + 0.22, pz - 0.75),
    new THREE.Vector3(0.0, sit.y + 0.06, pz - 0.2),
    sit.clone(),
  ];
  // Catch: the beak tip meets the falling bill while the gull flies along
  // SWOOP_END, so its body is that far back from the bill.
  const billAt = billPositionAt(T_GRAB - T_BILL);
  const grabBody = billAt.clone().sub(u.tipLocal.clone().sub(u.bodyFly).applyQuaternion(facing(SWOOP_END)));
  gullSwoopCurve.points = [
    sit.clone(),
    sit.clone().lerp(grabBody, 0.45).add(new THREE.Vector3(0.01, -0.02, -0.02)),
    grabBody.clone(),
  ];
  // Off with it: on up the way it jumped, a stall turn at the top, and a
  // dive in through the middle of the disk, curving away into the room.
  const apex = new THREE.Vector3(grabBody.x + 0.06, Math.min(py + 0.42, grabBody.y + 0.4), grabBody.z + 0.14);
  gullClimbCurve.points = [
    grabBody.clone(),
    grabBody.clone().addScaledVector(SWOOP_END, 0.14),
    apex.clone().add(new THREE.Vector3(-0.01, -0.1, -0.05)),
    apex.clone(),
  ];
  gullDiveCurve.points = [
    apex.clone(),
    new THREE.Vector3(apex.x * 0.5, py + 0.16, pz + 0.12),
    new THREE.Vector3(-0.12, py + 0.1, pz - 0.6),
    new THREE.Vector3(-0.5, py + 0.35, pz - 2.4),
    new THREE.Vector3(-0.9, py + 0.8, pz - 4.2),
  ];
  state.gullAway = false;
  gullVoice.setLevel(1);
  videoControls.hide();

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
  // Jane is in the room already, in her first pose, seen through the portal.
  splatJane?.appear(0, false, false);
  startMusic();
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

  // Crossing: shortly before the head reaches the portal's plane, show the
  // world everywhere. Waiting until it is through let the near clipping plane
  // (5 cm in front of the eyes) cut the portal's disk away for the last few
  // centimetres, and passthrough flashed up for a moment. OPEN_AHEAD before
  // the plane the disk already fills the view, so the switch can't be seen.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  camWorld.setFromMatrixPosition(cam.matrixWorld);
  camLocal.copy(camWorld);
  anchor.worldToLocal(camLocal);
  if (!state.inside && T > T_GLIDE && camLocal.z < pp.z + OPEN_AHEAD) {
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

  // Bill: flutters down from the ceiling until the gull catches it.
  if (T >= T_BILL && T < T_GRAB) {
    bill.visible = true;
    billPose(T - T_BILL, bill);
  }

  // Gull.
  const gu = gull.userData;
  if (T >= T_GULL_OUT && T < T_GULL_GONE && gu.mixer) {
    gull.visible = true;
    gull.scale.setScalar(1);
    let jawOpen = 0, look = null, lookW = 0;
    const toViewer = (from) => facing(v2.set(camLocal.x - from.x, 0, camLocal.z - from.z));
    if (T < T_PERCH) {
      // In across the room on the far side, slowing all the way (4 m/s
      // down to nothing): a glide, a few beats, a glide lined up with the
      // rim, then nose up, wings forward and fast short beats to brake, and
      // down onto its feet facing the viewer.
      const dur = T_PERCH - T_GULL_OUT;
      const k = clamp01((T - T_GULL_OUT) / dur);
      const u = 1 - (1 - k) * (1 - k);
      const speed = (gullOutCurve.getLength() * 2 * (1 - k)) / dur;
      const body = gullOutCurve.getPointAt(u, v1);
      const flare = 0.9 * smooth01((k - 0.58) / 0.22) * (1 - smooth01((k - 0.9) / 0.1));
      const sit = smooth01((k - 0.86) / 0.14);
      const q = flightQuat(gullOutCurve, u, speed, flare).slerp(toViewer(body), sit);
      const beats = k < 0.18 ? 0.25 : k < 0.42 ? 1 : k < 0.56 ? 0.3 : 1;
      gu.effort = THREE.MathUtils.damp(gu.effort ?? beats, beats, 9, dt);
      poseGull(dt, gu.effort, k > 0.56 ? BEAT_HOVER : BEAT, sit);
      placeGull(body, q, sit);
      setObjectMasked(!state.inside && body.z < pp.z);
    } else if (T < T_SWOOP) {
      // Sitting on the rim: looks at the viewer, yells, then watches the bill come down.
      const q = toViewer(perchPoint(pp));
      poseGull(dt, 0, BEAT, 1);
      placeGull(perchBody(pp, q), q, 1);
      setObjectMasked(false);
      if (state.calls < T_CALLS.length && T >= T_CALLS[state.calls]) gullVoice.call(state.calls++);
      for (const tc of T_CALLS) {
        const c = (T - tc) / 0.6;
        if (c > 0 && c < 1) jawOpen = 0.45 * Math.sin(Math.PI * Math.min(1, c * 1.6)) * (0.8 + 0.2 * Math.sin(T * 40));
      }
      const watchBill = smooth01((T - T_BILL - 0.3) / 0.5);
      look = camWorld.clone().lerp(anchor.localToWorld(billPositionAt(Math.max(0, T - T_BILL))), watchBill);
      lookW = smooth01((T - T_PERCH) / 0.4);
    } else if (T < T_GRAB) {
      // Jumps up off the rim and catches the bill, beak open until it has it.
      const k = clamp01((T - T_SWOOP) / (T_GRAB - T_SWOOP));
      const u = 1 - (1 - k) * (1 - k); // springs off, slowing to the top of the jump
      const body = gullSwoopCurve.getPointAt(u, v1);
      // From facing the viewer on the rim to pointing up the jump at the bill.
      const q = toViewer(perchPoint(pp)).slerp(facing(SWOOP_END, tmpQuat), smooth01(k / 0.75));
      const sit = 1 - smooth01(k / 0.45);
      poseGull(dt, 1, BEAT_HOVER, sit);
      placeGull(body, q, sit);
      look = anchor.localToWorld(billPositionAt(T - T_BILL));
      lookW = 1 - smooth01((k - 0.5) / 0.4);
      jawOpen = 0.5 * smooth01((k - 0.2) / 0.4);
    } else {
      // Off through the portal with the bill; its sounds fade as it goes.
      const dur = T_GULL_GONE - T_GRAB;
      const k = clamp01((T - T_GRAB) / dur);
      let body, q, beats, beat = BEAT_HOVER;
      if (k < EXIT_CLIMB) {
        // Climbing on, hard beats, slowing to a hang at the top.
        const c = k / EXIT_CLIMB, u = 1 - (1 - c) * (1 - c);
        body = gullClimbCurve.getPointAt(u, v1);
        q = facing(SWOOP_END).slerp(flightQuat(gullClimbCurve, u, 0, 0.35 * c, tmpQuat), smooth01(c / 0.5));
        beats = 1;
      } else if (k < EXIT_TURN) {
        // The stall turn: hanging nose up, it swings round to face the
        // portal and tips over into the dive, wings spread.
        const c = (k - EXIT_CLIMB) / (EXIT_TURN - EXIT_CLIMB);
        body = gullDiveCurve.getPoint(0, v1);
        body.y += 0.03 * Math.sin(Math.PI * c);
        const top = flightQuat(gullClimbCurve, 0.999, 0, 0.35);
        const yaw = tmpQuat.setFromAxisAngle(UP, Math.PI * smooth01(c / 0.8) * (body.x >= 0 ? 1 : -1));
        q = yaw.multiply(top);
        q.slerp(flightQuat(gullDiveCurve, 0.02, 1.5), smooth01((c - 0.55) / 0.45));
        beats = c < 0.6 ? 0.6 : 0.2;
      } else {
        // The dive: wings held half open, gathering speed, one or two beats
        // as it levels out inside, banking into the curve away.
        const c = (k - EXIT_TURN) / (1 - EXIT_TURN), u = c * c * (1.6 - 0.6 * c);
        const speed = (gullDiveCurve.getLength() * c * (3.2 - 1.8 * c)) / (dur * (1 - EXIT_TURN));
        body = gullDiveCurve.getPointAt(u, v1);
        q = flightQuat(gullDiveCurve, u, speed);
        beats = c < 0.45 ? 0.1 : c < 0.75 ? 0.9 : 0.35;
        beat = BEAT;
      }
      gu.effort = THREE.MathUtils.damp(gu.effort ?? beats, beats, 9, dt);
      poseGull(dt, gu.effort, beat, 0, !state.gullAway);
      placeGull(body, q, 0);
      const behind = !state.inside && body.z < pp.z;
      setObjectMasked(behind);
      if (behind && !state.gullAway) {
        state.gullAway = true;
        gullVoice.setLevel(0, 1.2);
      }
    }
    if (look && lookW > 0) aimHead(look, lookW);
    // Yell: open the lower mandible on top of the pose.
    if (jawOpen) gu.jaw.rotateZ(JAW_SIGN * jawOpen);
    if (T >= T_GRAB) {
      bill.visible = true;
      gull.updateMatrixWorld(true);
      // Held crosswise by its top edge, swinging a little; eased in from where
      // it was caught over a fifth of a second so the catch doesn't jump.
      const held = anchor.worldToLocal(gu.beakTip.getWorldPosition(new THREE.Vector3()))
        .add(new THREE.Vector3(0, -0.043, 0.012).applyQuaternion(gull.quaternion));
      const heldQ = gull.quaternion.clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35 + 0.1 * Math.sin(T * 7), 0, 0.15 * Math.sin(T * 9))));
      const k = clamp01((T - T_GRAB) / 0.22);
      if (k < 1) {
        billPose(T_GRAB - T_BILL, scratchBill);
        const e = k * k * (3 - 2 * k);
        bill.position.lerpVectors(scratchBill.position, held, e);
        bill.quaternion.slerpQuaternions(scratchBill.quaternion, heldQ, e);
      } else {
        bill.position.copy(held);
        bill.quaternion.copy(heldQ);
      }
    }
  } else if (T >= T_GULL_GONE && gull.visible) {
    gull.visible = bill.visible = false;
    gullVoice.setLevel(0, 0.3);
  }

  if (sceneApi.autoPlayBall && T > T_HINT && state.inside && !playBall.visible && !video.playing && playBall.userData.pressedAt < 0) {
    showPlayBall(true);
  }
  if (!renderer.xr.isPresenting && T > T_HINT) $('replay').hidden = false;
  if (playBall.visible) updatePlayBall(T, t);
}

// at: where the ball floats (world position), e.g. beside the toy jetski
// after a race; without it, ahead of where the flight ended.
function showPlayBall(on = true, at = null) {
  const u = playBall.userData;
  playBall.visible = hint.visible = on;
  if (!on) return;
  u.shownAt = state.fixedT ?? (clock.now - state.start);
  u.pressedAt = -1;
  u.base = at ? anchor.worldToLocal(at.clone()) : null;
  const base = playBallBase();
  hint.userData.draw(at ? 'Touch to watch again' : 'Touch the ball to play');
  hint.position.set(base.x, base.y - 0.18, base.z);
}
const playBallBase = () => playBall.userData.base || new THREE.Vector3(0, state.eye - 0.2, -FLY_DIST - 0.62);

const ballWorld = new THREE.Vector3();
function updatePlayBall(T, t) {
  const u = playBall.userData;
  const appear = easeOutBack(clamp01((T - u.shownAt) / 0.8));
  const press = u.pressedAt > 0 ? clamp01((t - u.pressedAt) / 0.45) : 0;
  playBall.position.copy(playBallBase());
  playBall.position.y += 0.025 * Math.sin(t * 1.6);
  playBall.scale.setScalar(Math.max(0.0001, appear * (1 + press * 0.6)));
  u.ball.rotation.y = t * 0.4;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  u.iconPivot.lookAt(new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld));
  // Poke with an index fingertip.
  playBall.getWorldPosition(ballWorld);
  if (u.pressedAt < 0 && appear > 0.9 && fingertips.some((p) => p.distanceTo(ballWorld) < 0.13)) startVideo();
}

// ---------- jetski race ----------
// The race (jetski/race.js) is a world of its own, with its own scene, camera
// and sound. It is built while the start card is still up, so nothing stalls
// in the headset. Touching the floating jetski after the video hands the
// frame loop over to it, in the same session, and leaving the race comes
// back to Jane's room ('scene:jetski-end' carries the result). ?race=0 leaves
// it out; if it can't be loaded, the jetski opens the race's own page.
const raceBox = { api: null, on: false, ref: null };
// The ride's own switches work on this page too: ?bar=below,ahead (grips this
// far below and ahead of the eyes, metres), ?riser=, ?steer=1.3 (how strongly
// the hands steer), ?throttle=any (either hand), ?vignette=0, ?streaks=0,
// ?heave=0 (see jetski/README.md).
const raceBar = (params.get('bar') || '').split(',').map(parseFloat);
const raceRiser = parseFloat(params.get('riser'));
const raceSteer = parseFloat(params.get('steer'));
const raceReady = (params.get('race') === '0' ? Promise.resolve(null) : import('./jetski/race.js').then(({ createRace }) => {
  const r = createRace({
    renderer, embedded: true,
    onExit: (result) => leaveRace(result),
    options: {
      debug: DEBUG,
      music: MUSIC_VOLUME > 0,
      autopilot: params.has('autopilot') ? (params.get('autopilot') || true) : false, // rides itself, for tests
      vignette: params.get('vignette') !== '0',
      streaks: params.get('streaks') !== '0',
      heave: params.get('heave') === '0' ? 0 : 1,
      ...(raceBar.length === 2 && raceBar.every(Number.isFinite) ? { below: raceBar[0], ahead: raceBar[1] } : {}),
      ...(Number.isFinite(raceRiser) ? { riser: raceRiser } : {}),
      ...(Number.isFinite(raceSteer) ? { steer: raceSteer } : {}),
      ...(params.get('throttle') === 'any' ? { throttle: 'any' } : {}),
    },
  });
  return r.ready.then(() => { raceBox.api = r; return r; });
})).catch((err) => { console.warn('The jetski race did not load:', err); return null; });

function enterRace() {
  const r = raceBox.api;
  if (!r || raceBox.on) return false;
  raceBox.on = true;
  stopMusic(true);
  gullVoice.setLevel(0, 0.2);
  playBall.visible = hint.visible = false;
  $('replay').hidden = true;
  r.resize(innerWidth, innerHeight);
  r.start();
  // Quest's own recenter (hold the Meta button) seats the rider again.
  const ref = renderer.xr.isPresenting ? renderer.xr.getReferenceSpace() : null;
  if (ref && ref.addEventListener && raceBox.ref !== ref) {
    raceBox.ref = ref;
    ref.addEventListener('reset', () => { if (raceBox.on) r.recenter(); });
  }
  return true;
}
// quiet: the session ended under the race, so nobody is in the room to greet.
function leaveRace(result, quiet = false) {
  if (!raceBox.on) return;
  raceBox.on = false;
  raceBox.api.stop();
  if (quiet) return;
  if (!renderer.xr.isPresenting) $('replay').hidden = false;
  window.dispatchEvent(new CustomEvent('scene:jetski-end', { detail: result || null }));
}

// Hooks for the Jane avatar and other scene modules.
// Events on window: 'scene:arrived' (flight into the room finished),
// 'scene:video-start', 'scene:video-end', 'scene:jetski-end' (back from the
// race; detail is its result).
const sceneApi = {
  THREE, scene, renderer, camera, rig, anchor, listener, state,
  // Starts the jetski race in this session. False if it isn't loaded.
  startJetski: enterRace,
  // Set false to let Jane decide when the play ball appears (showPlayBall).
  autoPlayBall: true,
  showPlayBall,
  playVideo: () => { if (!playBall.visible) showPlayBall(true); startVideo(); },
  // Jane's splat stands here (world position of her feet); the conversation
  // puts its caption above her instead of building the stand-in figure.
  janeSpot: splatJane ? () => splatJane.position() : null,
  // Where the player stands after the flight, in world space: feet position
  // and horizontal forward direction (toward the coffee table).
  arrivalPose() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.quaternion);
    return { position: anchor.localToWorld(new THREE.Vector3(0, 0, -FLY_DIST)), forward };
  },
};
window.sceneApi = sceneApi;
const jane = createJane(sceneApi);

// ---------- startup ----------

let loaded = false;
renderer.setAnimationLoop((time, frame) => {
  // The race draws its own world while it runs. If it breaks, back to the room.
  if (raceBox.on) {
    try { raceBox.api.frame(time, frame); return; } catch (err) {
      console.error('The jetski race stopped:', err);
      leaveRace(null);
    }
  }
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
  splatJane?.update(t);
  updateMusic(dt);
  const inXr = renderer.xr.isPresenting, head = inXr ? renderer.xr.getCamera() : camera;
  video.update(head);
  jane.update(t, dt, frame);
  if (inXr) updateHands(frame);
  if (videoControls.visible) {
    const rayHits = [];
    for (const { c, line } of pointers) {
      const src = c.userData.source;
      if (!inXr || !src || src.hand || src.targetRayMode !== 'tracked-pointer') { line.visible = false; continue; }
      const hit = videoControls.hitRay(rayOf(c));
      line.visible = hit.near && videoControls.shown;
      if (hit.near) line.scale.z = hit.distance;
      rayHits.push(hit);
    }
    videoControls.update(t, dt, {
      fingertips, rayHits,
      paused: video.paused, time: video.currentTime, duration: video.duration, label: video.label,
    });
  } else {
    for (const p of pointers) p.line.visible = false;
  }
  if (DEBUG) {
    clock.frames++;
    if (t - clock.fpsT > 0.5) {
      // Frame rate and which video source plays (and why not another); under
      // it, how the video is shown and how it is loading.
      const fps = `${Math.round(clock.frames / (t - clock.fpsT))} fps${video.note ? ` · ${video.note}` : ''}`;
      fpsLabel.userData.draw(video.stats ? `${fps}\n${video.stats}` : fps);
      clock.frames = 0; clock.fpsT = t;
    }
  }
  renderer.render(scene, camera);
});

// Jane's first pose is in before the start (she's in the room from the
// first moment); her other poses keep loading in the background.
const sceneReady = Promise.all([
  room.initialized.catch((err) => { throw new Error(`room scan: ${err.message || err}`); }),
  gullReady.catch((err) => { throw new Error(`seagull: ${err.message || err}`); }),
  billReady.catch((err) => { throw new Error(`bill: ${err.message || err}`); }),
  splatJane?.firstReady,
  outsideReady,
]);
// The race gets built before the buttons unlock (it would stall the headset
// if it happened later). It never holds the opening back for long.
const allReady = sceneReady.then(() => {
  if (!raceBox.api) statusEl.textContent = 'Loading the jetski race…';
  return Promise.race([raceReady, new Promise((done) => setTimeout(done, 30000))]);
});
allReady.then(() => {
  loaded = true;
  statusEl.textContent = 'Ready.';
  $('preview').disabled = false;
  checkXr();
}).catch((err) => {
  statusEl.textContent = `Could not load the ${err.message || err}`;
});

async function checkXr() {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  $('enterXr').disabled = !ok || !loaded;
  if (!ok) statusEl.textContent = 'Ready. Open this page in Quest Browser to enter mixed reality.';
}

$('enterXr').addEventListener('click', async () => {
  jane.prepareMic(); // ask for the mic now, not inside the headset
  unlockMusic();
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
      if (raceBox.on) return; // the race has its own controls
      const ref = renderer.xr.getReferenceSpace();
      const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
      if (!pose) return;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix).premultiply(rig.matrixWorld);
      const ray = new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m),
        new THREE.Vector3(0, 0, -1).transformDirection(m));
      // Trigger or pinch while pointing at a video button presses it.
      if (videoControls.visible) { videoControls.pressRay(ray); return; }
      if (!playBall.visible) return;
      playBall.getWorldPosition(ballWorld);
      if (ray.distanceSqToPoint(ballWorld) < 0.2 * 0.2) startVideo();
    });
    session.addEventListener('end', () => { leaveRace(null, true); $('ui').hidden = false; state.running = false; stopMusic(true); });
    // Give tracking a moment to settle before reading the head pose.
    setTimeout(startSequence, 600);
  } catch (err) {
    statusEl.textContent = `Could not start mixed reality: ${err.message || err}`;
  }
});

$('preview').addEventListener('click', () => {
  jane.prepareMic();
  unlockMusic();
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
  if (renderer.xr.isPresenting || raceBox.on) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  if (videoControls.visible) { videoControls.pressRay(rc.ray); return; }
  if (playBall.visible && rc.intersectObject(playBall.userData.ball).length) startVideo();
});
window.__startVideo = startVideo;
window.__debug = { state, playBall, video, worldRoot, gull, bill, splatJane, music, spark, videoControls, gullVoice, raceBox, enterRace, leaveRace };

// Test hook: freeze the sequence at a given time (seconds).
window.__setSequenceTime = (T) => { state.fixedT = T; };
window.__camera = camera;

if (params.has('autostart')) {
  allReady.then(() => $('preview').click());
}
