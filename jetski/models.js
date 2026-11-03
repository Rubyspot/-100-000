// Kawasaki STX-15F model (converted from the FBX, 13k triangles) with our
// own paint, plus a simple stand-in for Jane riding it.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/addons/loaders/GLTFLoader.js';

// Where the model sits in jetski space (forward -Z, hull bottom y = 0):
// shifted back so the rider's head (at z = 0) is over the front of the seat.
export const MODEL_OFFSET = new THREE.Vector3(0, 0, -0.25);
export const HEAD_Y = 1.62; // seated eye height above the hull bottom

let template = null;

export async function loadJetski() {
  const gltf = await new GLTFLoader().loadAsync('./assets/kawasaki-st15f.glb');
  template = gltf.scene;
  return template;
}

const PAINT = { paint: 'paint', trim: 'trim', seat: 'seat', bar: 'bar', dark: 'dark' };

// Builds one jetski: { root, body, bar (steering pivot), grips: [left, right] markers, pivot }.
export function makeJetski(paintColor, env) {
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.28, metalness: 0.0, envMap: env, envMapIntensity: 1.2 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4, envMap: env }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.75, envMap: env, envMapIntensity: 0.5 }),
    bar: new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.6, envMap: env, envMapIntensity: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, envMap: env, envMapIntensity: 0.6 }),
  };
  const root = new THREE.Group();
  const body = new THREE.Group(); // pitch and roll
  root.add(body);
  const model = template.clone(true);
  model.position.copy(MODEL_OFFSET);
  body.add(model);
  let barMesh = null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const key = PAINT[o.material.name] || 'dark';
    o.material = mats[key];
    if (key === 'bar') barMesh = o;
  });

  // Steering pivot at the middle of the handlebar.
  const bar = new THREE.Group();
  const grips = [new THREE.Object3D(), new THREE.Object3D()];
  if (barMesh) {
    barMesh.geometry.computeBoundingBox();
    const bb = barMesh.geometry.boundingBox;
    const centreLocal = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - 0.03, (bb.min.z + bb.max.z) / 2 + 0.02);
    model.updateMatrixWorld(true);
    const centre = centreLocal.clone().applyMatrix4(barMesh.matrixWorld);
    const half = (bb.max.x - bb.min.x) / 2 - 0.06;
    bar.position.copy(centre);
    body.add(bar);
    // Move the bar mesh under the pivot, keeping where it is.
    barMesh.parent.remove(barMesh);
    barMesh.position.sub(centre).add(MODEL_OFFSET);
    bar.add(barMesh);
    grips[0].position.set(-half, 0, 0);
    grips[1].position.set(half, 0, 0);
    bar.add(grips[0], grips[1]);
  }
  return { root, body, bar, grips, mats };
}

// Jane: simple shapes seated on the jetski with her hands on the grips.
export function makeRider(ski) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x9a6a4e });
  const suit = new THREE.MeshLambertMaterial({ color: 0xff4fa0 });
  const vest = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  const hair = new THREE.MeshLambertMaterial({ color: 0x1a1210 });
  const seatY = HEAD_Y - 0.78, hipZ = 0.18;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), vest);
  torso.position.set(0, seatY + 0.36, hipZ - 0.1);
  torso.rotation.x = -0.3;
  g.add(torso);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), suit);
  hips.position.set(0, seatY + 0.08, hipZ);
  g.add(hips);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), skin);
  head.position.set(0, HEAD_Y - 0.02, -0.06);
  g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
  cap.position.copy(head.position).add(new THREE.Vector3(0, 0.015, 0.02));
  cap.rotation.x = -0.4;
  g.add(cap);
  const pony = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.24, 3, 6), hair);
  pony.position.set(0, HEAD_Y - 0.08, 0.13);
  pony.rotation.x = 0.9;
  g.add(pony);
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
    ski.root.worldToLocal(grip);
    limb(new THREE.Vector3(side * 0.19, HEAD_Y - 0.25, -0.02), grip, 0.045, skin);
    limb(new THREE.Vector3(side * 0.12, seatY + 0.05, hipZ), new THREE.Vector3(side * 0.3, seatY - 0.05, -0.35), 0.07, skin);
    limb(new THREE.Vector3(side * 0.3, seatY - 0.05, -0.35), new THREE.Vector3(side * 0.33, seatY - 0.4, -0.15), 0.055, skin);
  }
  ski.body.add(g);
  return g;
}
