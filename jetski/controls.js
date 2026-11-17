// Riding controls. Hands first, and one hand is enough:
//   - Make a fist (or pinch) on either grip: that hand rides, full throttle.
//     Open it to coast.
//   - Steer by turning the fist like a dial, by turning it like a handlebar,
//     or by pushing the grip forward and pulling it back around the bar's
//     pivot. All three add up, so whatever feels natural works.
//   - With both hands on the bar it steers like a real handlebar (the line
//     between the hands), or like a wheel (one hand up, one down).
// The steering goes through a One Euro filter (steady when the hand is
// still, quick when it moves), a small dead zone and a soft curve around the
// middle. A hand that drops out of tracking for a moment keeps its grip.
// Joints are read straight from the XR frame, so this works the same on the
// race page and inside the main experience's session. Controllers and the
// keyboard are fallbacks.
import * as THREE from 'three';

const deg = THREE.MathUtils.degToRad;
const clamp = THREE.MathUtils.clamp;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

class OneEuro {
  constructor(minCut, beta, dCut = 1) { this.minCut = minCut; this.beta = beta; this.dCut = dCut; this.x = null; this.dx = 0; }
  reset(x = null) { this.x = x; this.dx = 0; }
  filter(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const alpha = (cut) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
    this.dx += alpha(this.dCut) * ((x - this.x) / dt - this.dx);
    this.x += alpha(this.minCut + this.beta * Math.abs(this.dx)) * (x - this.x);
    return this.x;
  }
}

// WebXR hand joints, in the order XRHand lists them.
const J = { wrist: 0, thumbTip: 4, indexProx: 6, indexTip: 9, middleProx: 11, middleTip: 14, ringProx: 16, ringTip: 19, pinkyProx: 21 };
const JOINTS = 25;
const TIP = new Set([4, 9, 14, 19, 24]);

export function createControls({ renderer, holder, rig, options = {} }) {
  const O = {
    rollFull: deg(35), yawFull: deg(45), arcFull: deg(40),   // one hand: full lock at these angles
    twoYawFull: deg(28), twoRollFull: deg(30),               // both hands
    grabRadius: 0.24, fitMax: 0.18, dead: 0.04, expo: 1.3,
    ...options,
  };
  const keys = new Set();
  const onKeyDown = (e) => { keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); };
  const onKeyUp = (e) => keys.delete(e.code);
  let listening = false;

  const dotGeo = new THREE.IcosahedronGeometry(1, 1);
  const dotMat = new THREE.MeshLambertMaterial({ color: 0xffd23f });
  const hands = ['left', 'right'].map((side, index) => {
    const dots = new THREE.InstancedMesh(dotGeo, dotMat, JOINTS);
    dots.frustumCulled = false; dots.count = 0;
    holder.add(dots);
    return {
      side, index, dots, seen: false, lostFor: 9, closed: false, pinching: false, grabbing: false, grabbedAt: 0, ratio: 2,
      joints: new Float32Array(JOINTS * 3),          // in the holder's space
      palm: new THREE.Vector3(), knuckle: new THREE.Vector3(), tip: new THREE.Vector3(),
      palmWorld: new THREE.Vector3(), tipWorld: new THREE.Vector3(),
      neutral: null, part: { roll: 0, yaw: 0, arc: 0 }, one: 0,
    };
  });

  const poses = new Float32Array(JOINTS * 16);
  const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const _rigQ = new THREE.Quaternion();

  function readHand(h, src, frame, ref) {
    let ok = false;
    try {
      if (frame.fillPoses) ok = frame.fillPoses(src.hand.values(), ref, poses);
      if (!ok) {
        let i = 0; ok = true;
        for (const space of src.hand.values()) {
          const p = frame.getJointPose(space, ref);
          if (!p) { ok = false; break; }
          poses.set(p.transform.matrix, i * 16); i++;
        }
      }
    } catch { ok = false; }
    if (!ok) return false;
    for (let i = 0; i < JOINTS; i++) {
      _v.set(poses[i * 16 + 12], poses[i * 16 + 13], poses[i * 16 + 14]);
      if (!Number.isFinite(_v.x + _v.y + _v.z)) return false;
      _v.applyMatrix4(rig.matrix);
      h.joints[i * 3] = _v.x; h.joints[i * 3 + 1] = _v.y; h.joints[i * 3 + 2] = _v.z;
    }
    return true;
  }
  const joint = (h, i, out) => out.set(h.joints[i * 3], h.joints[i * 3 + 1], h.joints[i * 3 + 2]);

  function analyse(h) {
    const wrist = joint(h, J.wrist, _a);
    // Curl: fingertip-to-wrist over knuckle-to-wrist. About 1.9 open, near 1 in a fist.
    let ratio = 0;
    for (const [tip, prox] of [[J.indexTip, J.indexProx], [J.middleTip, J.middleProx], [J.ringTip, J.ringProx]]) {
      ratio += joint(h, tip, _b).distanceTo(wrist) / Math.max(0.01, joint(h, prox, _v).distanceTo(wrist));
    }
    h.ratio = ratio / 3;
    if (h.closed && h.ratio > 1.58) h.closed = false;
    else if (!h.closed && h.ratio < 1.38) h.closed = true;
    const pinch = joint(h, J.thumbTip, _b).distanceTo(joint(h, J.indexTip, _v));
    if (h.pinching && pinch > 0.045) h.pinching = false;
    else if (!h.pinching && pinch < 0.022) h.pinching = true;
    joint(h, J.indexTip, h.tip);
    h.palm.copy(wrist).lerp(joint(h, J.middleProx, _v), 0.6);
    // Knuckle line, pinky to index.
    h.knuckle.subVectors(joint(h, J.indexProx, _b), joint(h, J.pinkyProx, _v));
    holder.localToWorld(h.palmWorld.copy(h.palm));
    holder.localToWorld(h.tipWorld.copy(h.tip));
  }

  // Angles of the fist, each counter-clockwise positive (= steer left).
  const rollOf = (v) => Math.atan2(v.y, v.x);            // seen from behind
  const yawOf = (v) => Math.atan2(-v.z, v.x);            // seen from above
  // Where the hand is around the bar's pivot.
  const arcOf = (h, p, pivot) => {
    const dx = p.x - pivot.x, dz = p.z - pivot.z;
    return h.index === 0 ? Math.atan2(dz, -dx) : Math.atan2(-dz, dx);
  };

  function oneHand(h, eff, pivot) {
    const v = h.knuckle, n = h.neutral, len = v.length() || 1;
    if (Math.hypot(v.x, v.y) > 0.5 * len) h.part.roll = wrap(rollOf(v) - n.roll) / O.rollFull;
    if (n.yawOk && Math.hypot(v.x, v.z) > 0.5 * len) h.part.yaw = wrap(yawOf(v) - n.yaw) / O.yawFull;
    h.part.arc = wrap(arcOf(h, eff, pivot) - n.arc) / O.arcFull;
    h.one = h.part.roll + h.part.yaw + h.part.arc;
    return h.one;
  }

  const euro = new OneEuro(1.6, 1.2);
  let twoW = 0, two = { yaw: 0, roll: 0 }, keySteer = 0, wasTwo = false;
  const ctrlNeutral = new Map();
  const input = {
    throttle: 0, steer: 0, engaged: false, gripL: false, gripR: false, riding: 0, device: 'none',
    pointers: [], freeHands: [], confirm: false, back: false, grabbed: null, handsSeen: 0,
  };
  const pointerPool = Array.from({ length: 6 }, () => new THREE.Vector3());

  // layout: { grips: [left, right], pivot } in the holder's space, and
  // fit: a shift of the rig that is still being eased in (this adds to it
  // when allowFit is set and a hand takes hold a little off the grip).
  function update(dt, now, frame, layout, allowFit = false) {
    let throttle = 0, steer = 0, engaged = false, device = 'none';
    input.pointers.length = 0; input.freeHands.length = 0; input.confirm = false; input.back = false; input.grabbed = null;
    const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
    const ref = session ? renderer.xr.getReferenceSpace() : null;
    let nPointer = 0;
    const pointer = (p) => { if (nPointer < pointerPool.length) input.pointers.push(pointerPool[nPointer++].copy(p)); };
    rig.updateMatrix();
    _rigQ.setFromRotationMatrix(rig.matrix);

    for (const h of hands) h.seen = false;
    if (session && frame && ref) {
      for (const src of session.inputSources) {
        if (!src.hand) continue;
        const h = src.handedness === 'left' ? hands[0] : src.handedness === 'right' ? hands[1] : null;
        if (h) h.seen = readHand(h, src, frame, ref);
      }
    }
    let seenCount = 0;
    for (const h of hands) {
      const grip = layout.grips[h.index];
      if (h.seen) {
        seenCount++;
        h.lostFor = 0;
        analyse(h);
        pointer(h.tipWorld);
        const eff = _a.copy(h.palm).add(layout.fit);
        const d = eff.distanceTo(grip);
        const holding = h.closed || h.pinching;
        if (!holding || d > 0.5) h.grabbing = false;
        else if (!h.grabbing && d < O.grabRadius) {
          h.grabbing = true; h.grabbedAt = now;
          if (allowFit && !hands[1 - h.index].grabbing) {
            // The bar comes to the hand: shift the rider so the grip is in the fist.
            const fit = _b.subVectors(grip, eff);
            if (fit.length() > O.fitMax) fit.setLength(O.fitMax);
            layout.fit.add(fit);
            eff.add(fit);
          }
          const v = h.knuckle;
          h.neutral = { roll: rollOf(v), yaw: yawOf(v), yawOk: Math.hypot(v.x, v.z) > 0.6 * (v.length() || 1), arc: arcOf(h, eff, layout.pivot) };
          h.part.roll = h.part.yaw = h.part.arc = 0; h.one = 0;
          input.grabbed = h;
        }
        if (h.grabbing) oneHand(h, _a.copy(h.palm).add(layout.fit), layout.pivot);
        else input.freeHands.push(h.palmWorld);
      } else {
        h.lostFor += dt;
        if (h.lostFor > 0.45) h.grabbing = false;
      }
    }
    input.handsSeen = seenCount;

    const riding = hands.filter((h) => h.grabbing);
    if (riding.length) {
      let one = 0;
      for (const h of riding) one += h.one;
      one /= riding.length;
      let both = one;
      if (riding.length === 2) {
        const L = hands[0].palm, R = hands[1].palm;
        const dx = R.x - L.x, yaw = Math.atan2(-(R.z - L.z), dx), roll = Math.atan2(R.y - L.y, dx);
        if (!wasTwo) two = { yaw: clamp(yaw, -deg(6), deg(6)), roll: clamp(roll, -deg(6), deg(6)) };
        both = (yaw - two.yaw) / O.twoYawFull + (roll - two.roll) / O.twoRollFull;
      }
      wasTwo = riding.length === 2;
      twoW += ((wasTwo ? 1 : 0) - twoW) * Math.min(1, dt * 6);
      let s = euro.filter(one + (both - one) * twoW, Math.max(dt, 1e-3));
      s = Math.abs(s) < O.dead ? 0 : (s - Math.sign(s) * O.dead) / (1 - O.dead);
      steer = Math.sign(s) * Math.pow(Math.min(1, Math.abs(s)), O.expo);
      throttle = 1; engaged = true; device = 'hands';
    } else {
      euro.reset(0); twoW = 0; wasTwo = false;
    }

    // Controllers: trigger or grip = go, tilt the controller or push the stick to steer.
    if (session && frame && ref) {
      for (const src of session.inputSources) {
        const gp = src.gamepad;
        if (!gp || src.hand) continue;
        const trig = gp.buttons[0] ? gp.buttons[0].value : 0, squeeze = gp.buttons[1] && gp.buttons[1].pressed ? 1 : 0;
        let pose = null;
        try { pose = src.gripSpace ? frame.getPose(src.gripSpace, ref) : null; } catch { pose = null; }
        if (pose) {
          const p = pose.transform.position;
          pointer(holder.localToWorld(_v.set(p.x, p.y, p.z).applyMatrix4(rig.matrix)));
        }
        if (trig > 0.25 || squeeze) {
          throttle = Math.max(throttle, Math.max(trig, squeeze));
          engaged = true; device = 'controller';
          if (pose) {
            const o = pose.transform.orientation;
            _v.set(1, 0, 0).applyQuaternion(_q.set(o.x, o.y, o.z, o.w)).applyQuaternion(_rigQ);
            if (!ctrlNeutral.has(src)) ctrlNeutral.set(src, rollOf(_v));
            const s = wrap(rollOf(_v) - ctrlNeutral.get(src)) / O.rollFull;
            if (Math.abs(s) > O.dead) steer += s - Math.sign(s) * O.dead;
          }
        } else ctrlNeutral.delete(src);
        const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0] || 0;
        if (Math.abs(ax) > 0.15) steer = -ax;
        if (gp.buttons[4] && gp.buttons[4].pressed) input.confirm = true;
        if (gp.buttons[5] && gp.buttons[5].pressed) input.back = true;
      }
    }

    // Keyboard (eased, so the keys steer smoothly too).
    const kl = keys.has('KeyA') || keys.has('ArrowLeft'), kr = keys.has('KeyD') || keys.has('ArrowRight');
    keySteer += ((kl ? 1 : 0) - (kr ? 1 : 0) - keySteer) * Math.min(1, dt * 5);
    if (Math.abs(keySteer) > 0.01) { steer = keySteer; device = 'keys'; }
    if (keys.has('KeyW') || keys.has('ArrowUp')) { throttle = 1; device = 'keys'; }
    if (keys.has('Space') || throttle > 0) engaged = true;
    if (keys.has('KeyR') || keys.has('Enter')) input.confirm = true;
    if (keys.has('Escape') || keys.has('KeyB')) input.back = true;

    input.throttle = throttle;
    input.steer = clamp(steer, -1, 1);
    input.engaged = engaged;
    input.device = device;
    input.gripL = hands[0].grabbing; input.gripR = hands[1].grabbing;
    input.riding = riding.length;

    // Loose hands are drawn as dots; a hand on the bar is drawn as its glove.
    for (const h of hands) {
      if (!h.seen || h.grabbing) { h.dots.count = 0; continue; }
      for (let i = 0; i < JOINTS; i++) {
        _s.setScalar(TIP.has(i) ? 0.0075 : i === 0 ? 0.014 : 0.0095);
        _m.compose(joint(h, i, _v), _q.identity(), _s);
        h.dots.setMatrixAt(i, _m);
      }
      h.dots.count = JOINTS;
      h.dots.instanceMatrix.needsUpdate = true;
    }
    return input;
  }

  return {
    hands, input, update,
    listen(on) {
      if (on === listening) return;
      listening = on;
      const f = on ? 'addEventListener' : 'removeEventListener';
      window[f]('keydown', onKeyDown); window[f]('keyup', onKeyUp);
      if (!on) keys.clear();
    },
    release() { for (const h of hands) { h.grabbing = false; h.dots.count = 0; } euro.reset(0); keySteer = 0; },
  };
}
