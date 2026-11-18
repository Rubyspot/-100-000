// The jetskis: the Kawasaki STX-15F model (converted from the FBX, 13k
// triangles) with our own paint and a raised handlebar, gloves that show
// your grip, and Jane (her first 3D scan, the wide stance with both fists
// out) standing on hers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Where the rider's eyes are relative to the grips. A stock sit-down bar is
// lap-high for someone sitting upright on a sofa, so the bar is raised on a
// riser and the eyes sit this far above and behind the grips.
export const SEAT = { below: 0.36, ahead: 0.42, riser: 0.12 };

// Jane's first scan (jane-*.sog): height in scan units, where her feet and
// centre are. The same numbers the opening uses.
export const JANE_SCAN = { height: 3.675, feetY: 0.099, cx: -0.075, cz: -0.69 };
export const JANE_HEIGHT = 1.75;

const asset = (path) => new URL(path, import.meta.url).href;
let template = null, loading = null;

// Loads the model once; the race and the opening's jetski button share it.
export function loadJetski() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(asset('./assets/kawasaki-st15f.glb')).then((gltf) => {
      template = gltf.scene;
      return template;
    });
  }
  return loading;
}

const PAINT = { paint: 'paint', trim: 'trim', seat: 'seat', bar: 'bar', dark: 'dark' };

// Gloss black for the parts that used to be pink (Ilia, Nov 17).
export const JET_BLACK = 0x121316;

// Builds one jetski (forward -Z, hull bottom at y = 0):
// { root, body (pitch and roll), bar (steering pivot), grips: [left, right],
//   eye (where a seated rider's eyes are, in the body's space) }.
// The model is placed so that those eyes are over the origin.
export function makeJetski(paintColor, env, { riser = SEAT.riser, below = SEAT.below, ahead = SEAT.ahead, accent = 0xffffff } = {}) {
  const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, ...o });
  const mats = {
    paint: std({ color: paintColor, roughness: 0.26, metalness: 0.0, envMapIntensity: 1.1 }),
    trim: std({ color: accent, roughness: 0.4, envMapIntensity: 0.9 }),
    seat: std({ color: 0x241a2c, roughness: 0.75, envMapIntensity: 0.5 }),
    bar: std({ color: 0x26282c, roughness: 0.55, envMapIntensity: 0.6 }),
    dark: std({ color: 0x2a2c30, roughness: 0.6, envMapIntensity: 0.6 }),
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = template.clone(true);
  body.add(model);
  let barMesh = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const key = PAINT[o.material.name] || 'dark';
    o.material = mats[key];
    if (key === 'bar') barMesh = o;
  });

  const bar = new THREE.Group();
  const grips = [new THREE.Object3D(), new THREE.Object3D()];
  const eye = new THREE.Vector3(0, 1.5, 0);
  if (barMesh) {
    barMesh.geometry.computeBoundingBox();
    const bb = barMesh.geometry.boundingBox;
    const centreLocal = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - 0.03, (bb.min.z + bb.max.z) / 2 + 0.02);
    root.updateMatrixWorld(true);
    const centre = centreLocal.clone().applyMatrix4(barMesh.matrixWorld);
    // Slide the model so the eyes come out over the origin.
    model.position.z = -(centre.z + ahead);
    centre.z = -ahead;
    const half = (bb.max.x - bb.min.x) / 2 - 0.06;
    bar.position.copy(centre);
    body.add(bar);
    // Hang the bar mesh on the pivot where it is, then lift the pivot.
    root.updateMatrixWorld(true);
    bar.attach(barMesh);
    bar.position.y += riser;
    grips[0].position.set(-half, 0, 0);
    grips[1].position.set(half, 0, 0);
    bar.add(grips[0], grips[1]);
    // The riser: a steering column from the hull up to the raised bar, with
    // a rubber boot where it goes into the hull, a clamp and a pad. Where the
    // hull is under the bar is found by casting a ray down onto the model,
    // so the column always reaches it.
    if (riser > 0.02) {
      const tilt = 0.2; // the column leans back toward the rider at the top
      const down = new THREE.Vector3(0, -Math.cos(tilt), -Math.sin(tilt)); // bar space: down and forward
      root.updateMatrixWorld(true);
      const from = bar.localToWorld(new THREE.Vector3(0, -0.06, 0));
      const dirW = down.clone().transformDirection(bar.matrixWorld);
      const hit = new THREE.Raycaster(from, dirW, 0, riser + 0.8).intersectObject(model, true)
        .find((h) => h.object !== barMesh);
      const len = (hit ? hit.distance : riser + 0.15) + 0.06 + 0.04; // into the hull a little
      const column = new THREE.Group();
      column.rotation.x = tilt; // its foot forward, along the ray
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.046, len, 14), mats.dark);
      stem.position.y = -len / 2;
      const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.11, 14), mats.seat);
      boot.position.y = -len + 0.07;
      column.add(stem, boot);
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.075), mats.dark);
      clamp.position.set(0, -0.035, 0.012);
      const pad = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.12, 4, 10), mats.trim);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(0, 0.008, 0.004);
      bar.add(column, clamp, pad);
    }
    eye.set(0, bar.position.y + below, 0);
  }
  return { root, body, bar, grips, mats, eye };
}

// Riding gloves in the Crispy colours. They sit on the grips and show while
// that hand is holding on.
export function makeGloves(ski) {
  const yellow = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  const pink = new THREE.MeshLambertMaterial({ color: 0xff4fa3 });
  const fist = new THREE.SphereGeometry(1, 14, 10);
  return ski.grips.map((grip, i) => {
    const side = i === 0 ? -1 : 1;
    const g = new THREE.Group();
    const hand = new THREE.Mesh(fist, yellow);
    hand.scale.set(0.056, 0.046, 0.05);
    hand.position.set(0, 0.012, 0.006);
    const thumb = new THREE.Mesh(fist, yellow);
    thumb.scale.set(0.034, 0.02, 0.022);
    thumb.position.set(-side * 0.04, -0.01, -0.028);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.044, 0.07, 12), pink);
    cuff.rotation.x = 1.15;
    cuff.position.set(side * 0.006, 0.03, 0.07);
    g.add(hand, thumb, cuff);
    g.visible = false;
    grip.add(g);
    return g;
  });
}

// Jane's scan standing on her jetski: feet in the footwells either side of
// the seat, leaning into the wind, fists on a tall stand-up bar.
// SplatMesh comes from Spark; the race page hands it over.
export function makeJaneRider(ski, SplatMesh, { url = asset('../assets/jane/jane-75k.sog'), footY = 0.3, standZ = 0.1, lean = 0.2 } = {}) {
  const stand = new THREE.Group();
  const mesh = new SplatMesh({ url });
  const k = JANE_HEIGHT / JANE_SCAN.height;
  mesh.rotation.x = Math.PI;
  mesh.scale.setScalar(k);
  mesh.position.set(-JANE_SCAN.cx * k, JANE_SCAN.feetY * k, JANE_SCAN.cz * k);
  stand.add(mesh);
  // The scan faces +Z; turn her to face the bow, then lean her forward.
  stand.rotation.set(-lean, Math.PI, 0);
  stand.position.set(0, footY, standZ);
  ski.body.add(stand);
  return { stand, mesh, ready: mesh.initialized };
}

// A stand-in rider for when the scan can't load: simple shapes in her colours.
export function makeSimpleRider(ski) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x9a6a4e });
  const top = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  const pants = new THREE.MeshLambertMaterial({ color: 0x7a4fc0 });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
  const eyeY = ski.eye.y;
  const seatY = eyeY - 0.72, hipZ = 0.2;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), top);
  torso.position.set(0, seatY + 0.36, hipZ - 0.1);
  torso.rotation.x = -0.3;
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), pants);
  hips.position.set(0, seatY + 0.08, hipZ);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.position.set(0, eyeY - 0.02, -0.06);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
  cap.position.copy(head.position).add(new THREE.Vector3(0, 0.015, 0.02));
  cap.rotation.x = -0.4;
  g.add(torso, hips, head, cap);
  const limb = (from, to, r, mat) => {
    const d = new THREE.Vector3().subVectors(to, from);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, d.length(), 8), mat);
    m.position.copy(from).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(m);
  };
  ski.root.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const grip = ski.grips[side < 0 ? 0 : 1].getWorldPosition(new THREE.Vector3());
    ski.body.worldToLocal(grip);
    limb(new THREE.Vector3(side * 0.19, eyeY - 0.25, -0.02), grip, 0.045, skin);
    limb(new THREE.Vector3(side * 0.12, seatY + 0.05, hipZ), new THREE.Vector3(side * 0.3, seatY - 0.05, -0.2), 0.07, pants);
    limb(new THREE.Vector3(side * 0.3, seatY - 0.05, -0.2), new THREE.Vector3(side * 0.33, seatY - 0.4, 0.0), 0.055, pants);
  }
  ski.body.add(g);
  return g;
}
