// Hands that look like hands (Ilia, Nov 18): the WebXR Input Profiles generic
// hand meshes (vendor/hands/, MIT), one skinned mesh per hand with a bone for
// each tracked joint, posed from the joints every frame. The opening uses them
// in the room and during the video; the jetski race can show the same ones.
//
//   const hands = createHands({ parent: rig }); // what the XR reference space maps to
//   const tips = hands.update(frame, referenceSpace); // each XR frame: index fingertips, world space
//   hands.visible = false;                      // e.g. in passthrough, where the real hands show
//   hands.offset.right.set(x, y, z);            // moves a drawn hand (parent space), e.g. onto a grip it holds
//
// Without hand tracking (controllers, or a flat screen) nothing is drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];
const TIP = JOINTS.indexOf('index-finger-tip');

export const SKIN = 0xd29f82;

export function createHands({ parent, color = SKIN, path = new URL('./vendor/hands/', import.meta.url).href } = {}) {
  const group = new THREE.Group();
  parent.add(group);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
  const hands = {};
  const loader = new GLTFLoader();
  const ready = Promise.all(['left', 'right'].map((side) => loader.loadAsync(`${path}${side}.glb`).then((gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (o.isSkinnedMesh) { o.material = material; o.frustumCulled = false; }
    });
    root.visible = false;
    group.add(root);
    hands[side] = { root, bones: JOINTS.map((name) => root.getObjectByName(name) || null) };
  }))).catch((err) => console.warn('Hands: no hand meshes', err));

  const tips = [];
  const tip = new THREE.Vector3();
  const seen = { left: false, right: false };
  // Where each hand is drawn, relative to where it is tracked (zero unless
  // set). The fingertips returned stay the tracked ones.
  const offset = { left: new THREE.Vector3(), right: new THREE.Vector3() };

  // Poses the hand meshes from this frame's joints and returns the index
  // fingertips in world space (empty without hand tracking).
  function update(frame, referenceSpace) {
    tips.length = 0;
    seen.left = seen.right = false;
    const session = frame && frame.session;
    if (session && referenceSpace && frame.getJointPose) {
      group.updateWorldMatrix(true, false);
      for (const source of session.inputSources) {
        if (!source.hand) continue;
        const hand = hands[source.handedness];
        let tracked = true;
        for (let j = 0; j < JOINTS.length && tracked; j++) {
          const space = source.hand.get(JOINTS[j]);
          const pose = space && frame.getJointPose(space, referenceSpace);
          if (!pose) { tracked = false; break; }
          const p = pose.transform.position, o = pose.transform.orientation;
          const bone = hand && hand.bones[j];
          if (bone) { bone.position.set(p.x, p.y, p.z); bone.quaternion.set(o.x, o.y, o.z, o.w); }
          if (j === TIP) tip.set(p.x, p.y, p.z);
        }
        if (!tracked) continue;
        tips.push(tip.clone().applyMatrix4(group.matrixWorld));
        seen[source.handedness] = true;
      }
    }
    for (const side of ['left', 'right']) {
      if (!hands[side]) continue;
      hands[side].root.visible = seen[side];
      hands[side].root.position.copy(offset[side]);
    }
    return tips;
  }

  return {
    group, ready, update, tips, offset, seen,
    get loaded() { return !!(hands.left && hands.right); }, // both meshes are in
    get visible() { return group.visible; },
    set visible(on) { group.visible = on; },
  };
}
