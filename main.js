// $100,000 opening.
// Mixed reality: "Seagulls Love Too" starts, a portal opens in the room's
// entrance, a seagull comes out and settles on the bottom of its rim. A $100
// bill flutters down from the ceiling to it, the gull jumps up, catches it,
// turns round and flies back in, and the player flies through the portal into
// the room scan (?world=stage: over a flower garden to the deck in front of
// two bamboo huts). Jane is there already, and goes through her poses, 3 s
// each (sing, surf, heart). The play ball starts the 180 video, with
// palm-sized controls (back 10 s, pause, close) beside the picture while it
// plays. After the video Jane offers the jetski race: a toy jetski stands in
// front of the player, and touching it starts the race (jetski/race.js) right
// here, in the same session. Back from the race, the video's play button
// stands beside the jetski.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SparkRenderer, SplatMesh, dyno } from '@sparkjsdev/spark';
import { Video180 } from './video.js';
import { VideoControls } from './video-controls.js';
import { GullVoice } from './audio.js';
import { createHands } from './hands.js';
import { createQuitButton } from './quit-button.js';
import { createPlayButton } from './play-button.js';
import { createJane } from './jane/jane.js';
import { createSplatJane, JANE_SCANS } from './jane/splat-jane.js';

const params = new URLSearchParams(location.search);
const num = (name, def) => {
  const v = params.get(name);
  return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : def;
};
const USE_LOD = params.get('lod') !== '0';
const DEBUG = params.has('debug');
const FLY_SPEED = num('speed', 0.3); // m/s, constant
// Untouched 8K60 HEVC master of the full 2:34 cut (tools/segment-original.sh,
// 130 Mbit/s, 2.5 GB): too big for GitHub Pages (1 GB a site), so it lives in
// the full/ folder of the video-8k branch and streams from GitHub's raw file
// server. Next to it, in full/light/, is the same 8K picture at 60 Mbit/s
// (tools/encode-8k-light.sh) for connections that can't keep up with the
// master. The headset loads the best of the two it can ahead of time and plays
// the one that will run without stalling (video.js). Ilia, Nov 18: "video
// always 8k": on a connection too slow for both, the lighter one plays anyway
// and waits for what it needs, rather than giving way to the 4K H.264 copy in
// ./video/. That one is the headset's last resort, only for one that can't
// decode the 8K at all (or whose decoder gives up on both), and is all a flat
// screen or a phone needs. (The branch's root and its light/ still hold the
// 66 s demo cut, which nothing plays any more.)
// ?video=original, light, 8k (both 8K ones) or 4k picks; ?video=<folder>/,<folder>/ lists others.
const ORIGINAL_SRC = 'https://raw.githubusercontent.com/Rubyspot/-100-000/video-8k/full/';
const LIGHT_SRC = `${ORIGINAL_SRC}light/`;
const COPY_SRC = './video/';
const IS_HEADSET = /OculusBrowser|Quest/i.test(navigator.userAgent);
const VIDEO_SRC = (() => {
  const named = { original: [ORIGINAL_SRC], light: [LIGHT_SRC], '8k': [ORIGINAL_SRC, LIGHT_SRC], '4k': [COPY_SRC] };
  const asked = (params.get('video') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (asked.length) return asked.flatMap((s) => named[s.toLowerCase()] || [s]);
  return IS_HEADSET ? [ORIGINAL_SRC, LIGHT_SRC] : [COPY_SRC];
})();
const VIDEO_LAST_RESORT = IS_HEADSET && !params.get('video') ? [COPY_SRC] : [];
// The world past the portal: the room scan, 400k splats (Ilia, Nov 16), its
// floor lifted 7 cm to meet the real one. Ilia, Nov 18: "back to room splat".
// ?world=stage is his "Home outside" splat of the same day instead: two bamboo
// huts with an opening between them, a deck in front of it, a flower garden
// and palms all round (400k of its 3.7M splats, no SH, shifted so the deck is
// at the real floor). ?scan=<url> and ?floor=<metres> override.
const STAGE = params.get('world') === 'stage';
const ROOM_URL = params.get('scan') || (STAGE ? './assets/stage-400k.sog' : './assets/room-400k.sog');
const FLOOR = num('floor', STAGE ? 0 : 0.07);
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
// Where Jane stands, in the scan's own x,z. In the room: clear floor right of
// the coffee table, 0.5 m further right than the first spot (Ilia, Nov 16),
// as on the test page. On the stage: its origin, on the deck in front of the
// opening between the huts (Ilia, Nov 18: "Jane position 0,0,0").
const JANE_SPOT = new THREE.Vector2(...(params.get('spot') || (STAGE ? '0,0' : '-0.68,-1.93')).split(',').map(Number));
const MUSIC_VOLUME = Math.min(1, Math.max(0, num('music', 0.55)));

// Room scan landmarks, as (x, z) in the scan's own coordinates. The scans have
// y pointing down with the floor at y = 0, so they get flipped upright.
const ENTRANCE = new THREE.Vector2(2.25, 0.2);   // centre of the doorway in the long wall
const TARGETS = {
  table: { at: new THREE.Vector2(-0.47, -3.0), stop: 1.4 }, // coffee table between the pink poufs
  desk: { at: new THREE.Vector2(-1.63, 0.18), stop: 1.4 },  // desk in front of the window
};
const TARGET = TARGETS[params.get('to')] || TARGETS.table;
const PORTAL_DIST = 1.05; // portal distance in front of the player

// Flight line. In the room: from the doorway toward the target, ending
// TARGET.stop short of it, where Jane and the play button are set up around
// the player. On the stage (whose huts' opening faces +x): in over the flower
// garden, level with the deck, straight at the huts, stopping over the last
// flowers 0.35 m short of the deck's knee-high front rail, 1.85 m from Jane,
// who stands 20 degrees to the right. Ilia, Nov 18: "shorter but slower": it
// is 2.4 m at 0.3 m/s, so in the room it starts just inside the doorway and
// the portal opens onto the room itself. ?arrive=x,z (the scan's x,z),
// ?fly=<metres> and ?speed=<m/s> change it.
const FLY_DIR = STAGE ? new THREE.Vector2(-1, 0) : new THREE.Vector2().subVectors(TARGET.at, ENTRANCE).normalize();
const ARRIVAL_SCAN = params.get('arrive')
  ? new THREE.Vector2(...params.get('arrive').split(',').map(Number))
  : STAGE ? new THREE.Vector2(1.75, -0.64) : TARGET.at.clone().addScaledVector(FLY_DIR, -TARGET.stop);
const FLY_DIST = Math.max(1.2, num('fly', 2.4));
const SCAN_START = ARRIVAL_SCAN.clone().addScaledVector(FLY_DIR, -FLY_DIST);

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
// point (just inside the room's doorway, or over the stage's flower garden)
// at the player's feet.
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

// Outside the world, all round: Ilia's 360 render (Nov 18,
// "Mono_NewLevelSequence1", 16000 px square, here 6144x3072) of the place the
// stage splat shows. It turns with the world (alignGroup), so the middle of
// the picture lies ahead along the flight: on the stage that is over the deck
// at the huts, where its palms and sky carry on from the splats.
// ?outside=<url> tries another equirectangular JPEG or PNG
// (assets/outside-8k.jpg is the same at 8192x4096), ?outside=off keeps the
// plain sky, and ?outsideturn=<degrees> turns it further. No mipmaps: at 17
// texels a degree it is about as sharp as the headset shows it, and that
// saves 24 MB of graphics memory. It is in before the Start buttons unlock.
const OUTSIDE_URL = params.get('outside') || './assets/outside.jpg';
const outsideReady = OUTSIDE_URL === 'off' ? Promise.resolve() : new THREE.TextureLoader().loadAsync(OUTSIDE_URL).then((tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  renderer.initTexture(tex);
  const geo = new THREE.SphereGeometry(60, 64, 32);
  geo.scale(-1, 1, 1); // seen from inside without being mirrored
  sky.geometry.dispose();
  sky.geometry = geo;
  Object.assign(sky.material, { map: tex, vertexColors: false, side: THREE.FrontSide, toneMapped: false });
  sky.material.needsUpdate = true;
  sky.position.y = 1.5; // its horizon at eye height
  // The world's own turn (alignGroup), so the picture stays lined up with it.
  sky.rotation.y = new THREE.Euler().setFromQuaternion(alignGroup.quaternion, 'YXZ').y
    + THREE.MathUtils.degToRad(num('outsideturn', 0));
}).catch(() => console.info(`outside: no ${OUTSIDE_URL}, the plain sky stays`));

maskToPortal(spark.material);

const room = new SplatMesh({
  url: ROOM_URL,
  lod: USE_LOD ? true : undefined,
  onProgress: (e) => {
    if (e.lengthComputable) statusEl.textContent = `Loading the world ${Math.round((e.loaded / e.total) * 100)}%`;
  },
});
room.rotation.x = Math.PI;
room.position.y = FLOOR;
scanGroup.add(room);
// Ilia, Nov 18: "splat transparent on the floor and some walls". The 400k cut
// of the scan leaves thin, half-clear splats there, and the 360 render behind
// the room showed through them. Every room splat is made more solid: its
// opacity times ?solid=2 (above 1 Spark draws a splat as a fuller disc).
// ?solid=1 turns it off.
const SOLID = Math.max(0.1, num('solid', 2));
if (SOLID !== 1) {
  const solidFx = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat },
    outTypes: { gsplat: dyno.Gsplat },
    statements: ({ inputs, outputs }) => dyno.unindentLines(/* glsl */`
      ${outputs.gsplat} = ${inputs.gsplat};
      ${outputs.gsplat}.rgba.a = ${inputs.gsplat}.rgba.a * ${SOLID.toFixed(3)};
    `),
  });
  room.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
    gsplat: solidFx.apply({ gsplat }).gsplat,
  }));
  room.updateGenerator();
}

// Jane's splats stand in the room at JANE_SPOT, turned toward the point where
// the flight ends (jane/splat-jane.js has the particle transformation).
// Scan (x, z) is (x, -z) in scanGroup. Ilia's order (Nov 18: "first comes
// sing, then surf, then heart and video play button appears, jetski pose
// only for game"): she is already in the room singing while the player flies
// in, turns into surf on arrival, ?hold=3 seconds, then heart, where the play
// button comes up, and she stays in heart while she offers the video and
// after it (the jetski pose is the race's). ?poses=sing,surf,heart changes
// the order, ?after=<pose> adds a pose after the video (also: yoga, new, the
// shaka pose). A pose whose file isn't in assets/jane/ is skipped.
const poseList = (name, def) => {
  const list = (params.get(name) || '').split(',').map((s) => s.trim()).filter((k) => JANE_SCANS[k]);
  return list.length ? list : def;
};
const JANE_POSES = poseList('poses', ['sing', 'surf', 'heart']);
const JANE_AFTER = poseList('after', [])[0];
const splatJane = params.get('jane') === 'off' ? null : createSplatJane({
  parent: scanGroup,
  spot: new THREE.Vector3(JANE_SPOT.x, 0, -JANE_SPOT.y),
  faceTo: new THREE.Vector3(ARRIVAL_SCAN.x, 0, -ARRIVAL_SCAN.y),
  spark,
  height: num('height', 1.75),
  sparks: num('sparks', 0.35), // share of splats that fly as sparks in her transformation
  hold: Math.max(0.5, num('hold', 3)),
  morph: Math.max(0.5, num('morph', 2)),
  scans: [...JANE_POSES, ...(JANE_AFTER ? [JANE_AFTER] : [])].map((k) => JANE_SCANS[k]),
  chainEnd: JANE_POSES.length - 1,
  // The play button comes up as she changes into her last pose.
  onLastPose: () => onJaneLastPose(),
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

// Sound must never stop the opening from loading: if the voice can't be
// made, the gull is silent.
const gullVoice = (() => {
  try { return new GullVoice(listener, gull); } catch (err) {
    console.warn('Gull sounds are off:', err);
    return { setLevel() {}, call() {}, flap() {} };
  }
})();
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
// Real hand meshes (hands.js), posed from the tracked joints each frame; in
// mixed reality the real hands show instead. fingertips: index fingertips,
// world space, for touching the buttons.
const hands = createHands({ parent: rig });
hands.visible = false;
const fingertips = hands.tips;
const tmpQuat = new THREE.Quaternion(); // scratch, for the gull's turns

// Controller rays, drawn only while they point at the video controls or the
// quit button. selecting: the trigger is down.
const pointers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xf2c45a, transparent: true, opacity: 0.85 }),
  );
  line.visible = false;
  c.add(line);
  c.userData.tip = new THREE.Vector3();
  c.addEventListener('connected', (e) => { c.userData.source = e.data; });
  c.addEventListener('disconnected', () => { c.userData.source = null; c.userData.selecting = false; line.visible = false; });
  c.addEventListener('selectstart', () => { c.userData.selecting = true; });
  c.addEventListener('selectend', () => { c.userData.selecting = false; });
  rig.add(c);
  return { c, line };
});
const rayOf = (obj) => {
  const m = obj.matrixWorld;
  return new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m), new THREE.Vector3(0, 0, -1).transformDirection(m));
};

// ---------- quit ----------
// A way out of the whole experience at the viewer's right (Ilia, Nov 18),
// 95 degrees round from the way the room faces, so just past the right edge
// of the 180 picture; held for 1.5 s it ends the session (quit-button.js).
// It is put there when the experience starts and travels with the viewer;
// it never moves after that ("keep it at the same spot"), and it is there
// for the whole session, in the room and during the video. ?quit=95: the
// angle; ?quit=off leaves it out.
const QUIT_ANGLE = params.get('quit') === 'off' ? null : num('quit', 95);
const quitButton = createQuitButton();
rig.add(quitButton.root);
const quitPointers = [];
// head: world position of the eyes; forward: the way the experience faces.
function placeQuit(head, forward) {
  if (QUIT_ANGLE !== null) quitButton.place(head, forward, { angle: QUIT_ANGLE });
}
function quitExperience() {
  const session = renderer.xr.getSession();
  if (session) session.end().catch((err) => console.warn('Quit:', err));
}

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
// one the video's frame rate divides, 120 for 60 fps). ?disk=700: sources of
// at least this many MB are kept on disk between visits. What an earlier visit
// kept on disk for any other folder (an older video's) is deleted.
const video = new Video180({
  renderer, scene, src: VIDEO_SRC,
  edge: num('edge', 6),
  hz: params.has('hz') ? num('hz', 0) : undefined,
  keepFrom: num('disk', 700) * 1e6,
  known: [...new Set([ORIGINAL_SRC, LIGHT_SRC, COPY_SRC, ...VIDEO_SRC])],
  lastResort: VIDEO_LAST_RESORT,
});
video.ready.catch((err) => console.warn('Video not available:', err.message || err));
// The video starts loading as soon as the opening has what it needs (the
// start buttons are unlocked and Jane's scans are in), so by the time the
// ball is touched most of it is here. ?preload=0 leaves it until then.
if (params.get('preload') !== '0') {
  const startButton = $('enterXr');
  const unlocked = new Promise((done) => {
    const check = () => { if (!startButton.disabled) { watch.disconnect(); done(); } };
    const watch = new MutationObserver(check);
    watch.observe(startButton, { attributes: true, attributeFilter: ['disabled'] });
    check();
  });
  Promise.allSettled([unlocked, splatJane?.ready]).then(() => video.preload());
}
// Back 10 s, pause / play and close, within reach for as long as the video
// plays: low at the right, 45 degrees round from the middle of the picture
// (Ilia, Nov 18). ?controls=0.4,0.32,45: how far below and out from the eyes
// the plate's middle is (metres), and how far round to the right (degrees).
const CONTROLS_AT = (params.get('controls') || '').split(',').map(parseFloat);
const videoControls = new VideoControls({
  scene, listener,
  onBack: () => video.seekBy(-10),
  onToggle: () => video.togglePause(),
  onClose: () => video.stop(),
  ...(CONTROLS_AT.length >= 2 && CONTROLS_AT.every(Number.isFinite)
    ? { below: CONTROLS_AT[0], ahead: CONTROLS_AT[1], ...(CONTROLS_AT.length > 2 ? { angle: CONTROLS_AT[2] } : {}) } : {}),
});

// The play button (play-button.js, Ilia, Nov 18: "look better"). It comes up
// with Jane's last pose, at its spot ahead of where the flight ends, and
// stands still there (Ilia, Nov 18: "first location for play button is
// perfect, keep it as is"). playBall: where it stands, in the anchor's space.
const playButton = createPlayButton();
const playBall = playButton.root;
// base: where it floats (anchor space); null for its own spot past the end of
// the flight. hover: a hand or a controller's ray is at it.
playBall.userData = { pressedAt: -1, base: null, shownAt: 0, hover: 0, rayOn: false };
playBall.visible = false;
anchor.add(playBall);

function startVideo() {
  if (video.playing || !playBall.visible) return;
  video.prime(); // the player fills while the room fades
  stopMusic();
  playBall.userData.pressedAt = clock.now;
  state.lastPose = true; // from here on the button comes whenever it is asked for
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
    // Low at the right of the picture, which faces the way the room does,
    // measured from between the eyes (the XR camera stands a few centimetres
    // behind them, which turned 45 degrees into 51).
    videoControls.show(renderer.xr.isPresenting ? eyesInWorld() : camera, renderer.xr.isPresenting,
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
  if (!state.running) return; // the session ended under it: nobody to greet
  playSong(betweenSong);
  showPlayBall(sceneApi.autoPlayBall);
  window.dispatchEvent(new Event('scene:video-end'));
};

// ---------- music ----------
// Two of Jane's songs play in the room, a little quieter while she talks:
// "Seagulls Love Too" from the start until the video, and "On My Own",
// quietly, after the video and after each race (Ilia, Nov 18: "keep silent
// music On my own playing from Jane album in between sessions"), going on
// from where it stopped. The race plays its own. ?music=0 mutes them,
// ?music=0.3 sets the level; ?between=0.5: On My Own's level, as a part of it.
const BETWEEN_LEVEL = Math.min(1, Math.max(0, num('between', 0.5)));
function makeSong(file, level) {
  const el = new Audio('./jetski/audio/' + file);
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  return { el, level, target: 0, now: 0 };
}
const songs = [makeSong('seagulls-love-too.mp3', 1), makeSong('on-my-own.mp3', BETWEEN_LEVEL)];
const [introSong, betweenSong] = songs;
const music = introSong.el;
// Call inside the Enter / Preview click so the browser lets them play with sound.
function unlockMusic() {
  if (!MUSIC_VOLUME) return;
  for (const s of songs) {
    const p = s.el.play();
    if (p) p.then(() => { if (!s.target) s.el.pause(); }).catch(() => {});
  }
}
function playSong(s, fromTop = false) {
  if (!MUSIC_VOLUME || !s.level) return;
  for (const o of songs) if (o !== s) o.target = 0;
  if (fromTop) s.el.currentTime = 0;
  s.target = MUSIC_VOLUME * s.level;
  s.el.play().catch((err) => console.warn('Music did not start:', err.message || err));
}
// The start of the experience: Seagulls Love Too from the top, and On My Own
// from its top the next time it comes.
function startMusic() {
  stopMusic(true);
  betweenSong.el.currentTime = 0;
  playSong(introSong, true);
}
function stopMusic(now = false) {
  for (const s of songs) {
    s.target = 0;
    if (now) { s.now = 0; s.el.volume = 0; s.el.pause(); }
  }
}
function updateMusic(dt) {
  const talking = window.__jane?.st?.talking;
  for (const s of songs) {
    const want = s.target * (talking ? 0.45 : 1);
    const rate = want < s.now ? 6 : 2; // quick fade out, slow fade in
    s.now += (want - s.now) * Math.min(1, dt * rate);
    s.el.volume = Math.min(1, Math.max(0, s.now));
    if (!s.target && s.now < 0.005 && !s.el.paused) s.el.pause();
  }
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
// The way off with the bill (Ilia, Nov 18: "seagull shouldn't fly up, just
// pick up the bill uturn and fly back"): a few hard beats to get going from
// the top of its jump, a level U-turn round to the viewer's right in front of
// the portal, banked hard, and back in through the disk and away.
const gullExitCurve = new THREE.CatmullRomCurve3([], false, 'centripetal');
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

// The head's pose in the rig's space, where the headset reports it. In the
// headset the XR camera's own pose is last frame's, with the rig as it was
// then: from a session before, the rig may still stand where that one's
// flight ended, and the portal came up metres away (Ilia, Nov 18: "portal
// should be spawn always at same distance from player"). So it is read from
// the eyes' views, between the two.
const _eye = new THREE.Vector3(), _v1 = new THREE.Vector3();
function headInRig(out) {
  const eyes = renderer.xr.isPresenting ? renderer.xr.getCamera().cameras : [];
  if (!eyes.length) {
    camera.updateMatrix();
    return out.copy(camera.matrix);
  }
  out.copy(eyes[0].matrix);
  if (eyes.length > 1) {
    _eye.setFromMatrixPosition(eyes[0].matrix).add(_v1.setFromMatrixPosition(eyes[1].matrix)).multiplyScalar(0.5);
    out.setPosition(_eye);
  }
  return out;
}

// The head's pose in the world, as an object (for things placed around it).
function eyesInWorld() {
  const o = new THREE.Object3D();
  o.matrixAutoUpdate = false;
  rig.updateMatrixWorld(true);
  o.matrix.multiplyMatrices(rig.matrixWorld, headInRig(new THREE.Matrix4()));
  o.updateMatrixWorld(true);
  return o;
}

function startSequence() {
  // The headset hasn't drawn a frame of this session yet: no pose to go by.
  if (renderer.xr.isPresenting && !renderer.xr.getCamera().cameras.length) {
    setTimeout(startSequence, 100);
    return;
  }
  // Anchor everything to the current head pose, yaw only: the portal is
  // always PORTAL_DIST straight ahead.
  rig.position.set(0, 0, 0);
  rig.updateMatrixWorld(true);
  const head = headInRig(new THREE.Matrix4()); // the rig is at the origin: this is the world pose
  const headPos = new THREE.Vector3().setFromMatrixPosition(head);
  const fwd = new THREE.Vector3(0, 0, -1).transformDirection(head);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  anchor.position.set(headPos.x, 0, headPos.z);
  anchor.rotation.set(0, yaw, 0);
  worldRoot.position.copy(anchor.position);
  worldRoot.rotation.set(0, yaw, 0);
  state.eye = THREE.MathUtils.clamp(headPos.y, 1.0, 1.9);
  placeQuit(headPos, fwd.set(0, 0, -1).applyQuaternion(anchor.quaternion));

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
  // Off with it: levelling out of the jump, a U-turn about 0.25 m across at
  // the height it caught the bill (its nearest point 0.65 m from the eyes),
  // back in through the disk right of the middle, and away into the world.
  const lvl = grabBody.y + 0.05;
  gullExitCurve.points = [
    grabBody.clone(),
    new THREE.Vector3(grabBody.x + 0.1, lvl, grabBody.z + 0.17),
    new THREE.Vector3(0.27, lvl, Math.min(pz + 0.45, grabBody.z + 0.36)),
    new THREE.Vector3(0.46, lvl - 0.01, pz + 0.21),
    new THREE.Vector3(0.18, lvl - 0.03, pz - 0.2),
    new THREE.Vector3(-0.15, lvl, pz - 1.4),
    new THREE.Vector3(-0.6, lvl + 0.15, pz - 3.2),
  ];
  state.gullAway = false;
  gullVoice.setLevel(1);
  videoControls.hide();

  state.start = clock.now;
  state.running = true;
  state.inside = false;
  state.arrived = false;
  state.lastPose = false;
  state.calls = 0;
  setWorldMasked(true);
  setObjectMasked(false);
  portalMask.visible = true;
  ring.visible = true;
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
  hands.visible = state.inside;

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
      // From still at the top of its jump it gathers speed all the way
      // (about 1.2 m/s into the turn, 1.6 m/s through the portal, 2 m/s away),
      // banked by the turn's tightness, beating hard to get going, then
      // gliding in through the portal and beating on away.
      const u = k * k * (1.6 - 0.6 * k);
      const speed = (gullExitCurve.getLength() * k * (3.2 - 1.8 * k)) / dur;
      const body = gullExitCurve.getPointAt(u, v1);
      const q = facing(SWOOP_END).slerp(flightQuat(gullExitCurve, u, speed, 0, tmpQuat), smooth01(k / 0.22));
      const beats = k < 0.3 ? 1 : k < 0.45 ? 0.6 : k < 0.7 ? 0.15 : 0.5;
      const beat = k < 0.3 ? BEAT_HOVER : BEAT;
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

  // The play button comes up with Jane's last pose. Without her splat it
  // comes up a second after arriving (unless the conversation brings it up);
  // if her last pose never comes (a scan still loading), after half a minute.
  const autoAt = splatJane ? T_ARRIVE + 30 : sceneApi.autoPlayBall ? T_HINT : Infinity;
  if (T > autoAt && state.inside && !playBall.visible && !video.playing && playBall.userData.pressedAt < 0) {
    showPlayBall(true, null, true);
  }
  if (!renderer.xr.isPresenting && T > T_HINT) $('replay').hidden = false;
  if (playBall.visible) updatePlayBall(T, t, dt);
}

// The buttons' spot (Ilia, Nov 18: one place, they don't move): 0.62 m ahead
// of where the flight ends, 0.2 m below the eyes, in the anchor's space (on a
// flat screen 0.8 m and 0.12 m, so the plates under them are in the picture).
// The play button stands there, and the toy jetski after the video; after a
// race the two stand side by side (sceneApi.buttonSpot). buttonEyes: the
// point they face.
const BUTTON_GAP = 0.19; // after a race: each this far to one side of the spot
const buttonSpot = (offset = 0) => {
  const flat = !renderer.xr.isPresenting;
  return new THREE.Vector3(offset, state.eye - (flat ? 0.12 : 0.2), -FLY_DIST - (flat ? 0.8 : 0.62));
};
const buttonEyes = () => new THREE.Vector3(0, state.eye, -FLY_DIST);

// at: where it stands (world position), e.g. beside the toy jetski after a
// race; without it, at the buttons' spot. Before the video it waits for
// Jane's last pose (Ilia, Nov 18: "at the same time with last pose"), unless
// `now` (she was asked to play it). Asked again while it is already up in the
// same spot, it stays as it is.
function showPlayBall(on = true, at = null, now = false) {
  const u = playBall.userData;
  if (!on) { playBall.visible = false; return; }
  if (!at && !now && splatJane && !state.lastPose) return;
  const base = at ? anchor.worldToLocal(at.clone()) : null;
  const same = base ? u.base && u.base.distanceTo(base) < 0.05 : !u.base;
  if (playBall.visible && u.pressedAt < 0 && same) return;
  playBall.visible = true;
  u.shownAt = state.fixedT ?? (clock.now - state.start);
  u.pressedAt = -1;
  u.base = base;
  playButton.setText(at ? 'Watch again' : 'Play the video', 'Touch the button');
  // Put it there and turn it to the player once; it stays like that.
  playBall.position.copy(playBallBase());
  playButton.face(anchor.localToWorld(buttonEyes()));
}
const playBallBase = () => playBall.userData.base || buttonSpot();

// Jane's last pose is coming up: so does the play button.
function onJaneLastPose() {
  if (!state.running || state.lastPose) return;
  state.lastPose = true;
  if (state.inside && !video.playing && !raceBox.on && playBall.userData.pressedAt < 0) showPlayBall(true);
}

const ballWorld = new THREE.Vector3();
function updatePlayBall(T, t, dt) {
  const u = playBall.userData;
  const appear = clamp01((T - u.shownAt) / 0.9);
  const press = u.pressedAt > 0 ? clamp01((t - u.pressedAt) / 0.45) : 0;
  playBall.getWorldPosition(ballWorld);
  // Lights up as a fingertip (or a controller's ray) comes to it; a poke plays.
  let near = Infinity;
  for (const p of fingertips) near = Math.min(near, p.distanceTo(ballWorld));
  u.hover = THREE.MathUtils.damp(u.hover, near < 0.3 || u.rayOn ? 1 : 0, 10, dt);
  playButton.update(t, { appear, press, hover: u.hover });
  if (u.pressedAt < 0 && appear > 0.9 && near < 0.13) startVideo();
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
  playBall.visible = false;
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
  playSong(betweenSong);
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
  playVideo: () => { if (!playBall.visible) showPlayBall(true, null, true); startVideo(); },
  // Jane's splat stands here (world position of her feet); the conversation
  // puts its caption above her instead of building the stand-in figure.
  janeSpot: splatJane ? () => splatJane.position() : null,
  // The buttons' spot in world space (Ilia, Nov 18: the play button's first
  // spot; the toy jetski appears there too, and after a race the two stand
  // still side by side). offset: metres to the right of it (negative: left),
  // e.g. -0.19 for the play button and 0.19 for the jetski after a race.
  // position: where the button's middle goes; eyes: the point it faces.
  buttonSpot(offset = 0) {
    return { position: anchor.localToWorld(buttonSpot(offset)), eyes: anchor.localToWorld(buttonEyes()), gap: BUTTON_GAP };
  },
  // Where the player stands after the flight, in world space: feet position
  // and horizontal forward direction (along the flight).
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
  hands.update(inXr ? frame : null, renderer.xr.getReferenceSpace());
  // Controllers point at the play button, the video's buttons and the quit
  // button (the ray is drawn while it is on one); fingertips and controllers
  // touch them.
  quitButton.show(inXr && state.running && QUIT_ANGLE !== null);
  const rayHits = [];
  let quitPressed = false;
  quitPointers.length = 0;
  quitPointers.push(...fingertips);
  playBall.userData.rayOn = false;
  if (playBall.visible) playBall.getWorldPosition(ballWorld);
  for (const { c, line } of pointers) {
    const src = c.userData.source;
    line.visible = false;
    if (!inXr || !src || src.hand || src.targetRayMode !== 'tracked-pointer') continue;
    const ray = rayOf(c);
    let reach = Infinity;
    // On the play button (the trigger then plays, see 'select').
    if (playBall.visible && !video.playing && ray.distanceSqToPoint(ballWorld) < 0.2 * 0.2) {
      playBall.userData.rayOn = true;
      reach = ray.origin.distanceTo(ballWorld);
    }
    if (videoControls.visible) {
      const hit = videoControls.hitRay(ray);
      rayHits.push(hit);
      if (hit.near && videoControls.shown) reach = hit.distance;
    }
    if (quitButton.visible) {
      quitPointers.push(c.userData.tip.copy(ray.origin));
      const hit = quitButton.hitRay(ray);
      if (hit.near) {
        reach = Math.min(reach, hit.distance);
        if (c.userData.selecting) quitPressed = true;
      }
    }
    if (reach < Infinity) { line.visible = true; line.scale.z = reach; }
  }
  if (videoControls.visible) {
    videoControls.update(t, dt, {
      fingertips, rayHits,
      paused: video.paused, time: video.currentTime, duration: video.duration, label: video.label,
    });
  }
  if (quitButton.update(quitPointers, quitPressed, dt, t)) quitExperience();
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
  room.initialized.catch((err) => { throw new Error(`world: ${err.message || err}`); }),
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
  checkXr();
}).catch((err) => {
  statusEl.textContent = `Could not load the ${err.message || err}`;
});

// One button on the start card (Ilia, Nov 18: "keep it simple, just $100,000
// musical experience and button enter VR"). Where the browser can start an
// immersive session it is Enter VR (the experience opens in mixed reality);
// anywhere else it plays the preview on this screen.
let xrOk = false;
async function checkXr() {
  xrOk = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false));
  const button = $('enterXr');
  button.textContent = xrOk ? 'Enter VR' : 'Preview on this screen';
  button.disabled = !loaded;
  statusEl.textContent = xrOk ? '' : 'Open this page in Quest Browser to enter VR.';
}
$('enterXr').addEventListener('click', () => (xrOk ? enterXr() : startPreview()));

async function enterXr() {
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
    // Quit, or the headset's own way out: everything stops and the start
    // card is back. 'scene:session-end' tells Jane.
    session.addEventListener('end', () => {
      state.running = false;
      rig.position.set(0, 0, 0);
      leaveRace(null, true);
      video.stop();
      videoControls.hide();
      quitButton.show(false);
      gullVoice.setLevel(0, 0.1);
      $('ui').hidden = false;
      stopMusic(true);
      window.dispatchEvent(new Event('scene:session-end'));
    });
    // Give tracking a moment to settle before reading the head pose.
    setTimeout(startSequence, 600);
  } catch (err) {
    statusEl.textContent = `Could not start: ${err.message || err}`;
  }
}

function startPreview() {
  jane.prepareMic();
  unlockMusic();
  video.unlock();
  listener.context.resume();
  $('ui').hidden = true;
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  startSequence();
}
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
  if (playBall.visible && rc.intersectObjects(playButton.hits, false).length) startVideo();
});
window.__startVideo = startVideo;
window.__debug = { state, room, playBall, playButton, video, worldRoot, gull, bill, splatJane, music, songs, spark, videoControls, gullVoice, raceBox, enterRace, leaveRace, hands, quitButton, times: { T_PORTAL, T_GLIDE, T_ARRIVE } };

// Test hook: freeze the sequence at a given time (seconds).
window.__setSequenceTime = (T) => { state.fixedT = T; };
window.__camera = camera;
window.__startPreview = startPreview;

if (params.has('autostart')) {
  allReady.then(() => startPreview());
}
