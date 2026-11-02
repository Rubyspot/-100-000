// Placeholder Jane: a stylised low-poly figure that stands in for the
// MetaHuman until it is exported. Everything the conversation needs to drive
// lives on the returned object (setMouth, setMood, gesture, lookAt), so the
// real avatar only has to implement the same few calls.
import * as THREE from 'three';

const SKIN = 0xb9805a, HAIR = 0x2a1a12, DRESS = 0x2fa39a, DRESS_2 = 0xf2a03d;

export function createAvatar() {
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
  const skin = mat(SKIN), hair = mat(HAIR, { roughness: 0.9 }), dress = mat(DRESS), trim = mat(DRESS_2);
  const white = mat(0xffffff, { roughness: 0.3 }), dark = mat(0x161210, { roughness: 0.4 });
  const lips = mat(0x7a2e2a, { roughness: 0.5 }), flower = mat(0xff6f91), wood = mat(0xb07a3e, { roughness: 0.55 });

  const root = new THREE.Group(); // feet at y = 0, facing +Z
  const body = new THREE.Group();
  root.add(body);

  // Flowy dress and torso.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.3, 0.72, 24, 1, true), dress);
  skirt.material.side = THREE.DoubleSide;
  skirt.position.y = 0.6;
  body.add(skirt);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.018, 8, 32), trim);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.25;
  body.add(hem);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 10), skin);
    leg.position.set(0.08 * s, 0.13, 0);
    body.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.28, 6, 16), dress);
  torso.scale.set(1, 1, 0.75);
  torso.position.y = 1.12;
  body.add(torso);

  // Head: neck, face, eyes, mouth, big curly hair with a flower.
  const neckPivot = new THREE.Group();
  neckPivot.position.y = 1.36;
  body.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 12), skin);
  neck.position.y = 0.03;
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.17;
  neckPivot.add(head);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 32, 24), skin);
  face.scale.set(0.92, 1.08, 0.98);
  head.add(face);

  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.038 * s, 0.018, 0.088);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 12), white);
    ball.scale.z = 0.5;
    eye.add(ball);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 12, 10), dark);
    pupil.position.z = 0.007;
    eye.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.006, 0.006), hair);
    brow.position.set(0, 0.03, 0.006);
    eye.add(brow);
    head.add(eye);
    eyes.push({ eye, pupil, brow, side: s });
  }

  // Mouth: a dark opening behind two lips; opening = scale of the inside.
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.045, 0.096);
  head.add(mouth);
  const mouthInside = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 10), dark);
  mouthInside.scale.set(1, 0.12, 0.35);
  mouth.add(mouthInside);
  const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.03, 4, 8), lips);
  upperLip.rotation.z = Math.PI / 2;
  mouth.add(upperLip);
  const lowerLip = upperLip.clone();
  mouth.add(lowerLip);

  const hairGroup = new THREE.Group();
  head.add(hairGroup);
  // Curls placed on a jittered shell around the top and back of the head.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const phi = Math.acos(1 - 1.35 * rnd()), theta = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    if (dir.z > 0.55 && dir.y < 0.75) continue; // keep the face clear
    const curl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04 + rnd() * 0.025, 0), hair);
    curl.position.copy(dir).multiplyScalar(0.12 + rnd() * 0.03);
    curl.position.y += 0.02;
    hairGroup.add(curl);
  }
  const bloom = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), flower);
    const a = (i / 5) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0);
    petal.scale.z = 0.4;
    bloom.add(petal);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), trim);
  center.position.z = 0.006;
  bloom.add(center);
  bloom.position.set(0.11, 0.07, 0.07);
  bloom.rotation.y = 0.9;
  head.add(bloom);

  // Arms on shoulder pivots, with elbows, so a few poses read as gestures.
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.17 * s, 1.3, 0);
    body.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.2, 4, 10), skin);
    upper.position.y = -0.13;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.19, 4, 10), skin);
    fore.position.y = -0.12;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), skin);
    hand.position.y = -0.25;
    elbow.add(hand);
    arms.push({ shoulder, elbow, side: s });
  }

  // Ukulele on her back: she sings and plays, so it's part of the silhouette.
  const uke = new THREE.Group();
  const ukeBody = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), wood);
  ukeBody.scale.set(1, 1.25, 0.35);
  uke.add(ukeBody);
  const neckUke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.015), wood);
  neckUke.position.y = 0.22;
  uke.add(neckUke);
  uke.position.set(-0.05, 1.08, -0.16);
  uke.rotation.z = 0.5;
  body.add(uke);

  // Soft disc on the floor: brighter while she listens, so you know she hears you.
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { level: { value: 0.3 }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float level; uniform float time; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0;
        float ring = exp(-pow((r - 0.8 - 0.05 * sin(time * 3.0)) * 9.0, 2.0));
        float a = (ring * 0.9 + (1.0 - r) * 0.25) * level;
        gl_FragColor = vec4(vec3(0.55, 1.0, 0.75) * a, 1.0); }`,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.005;
  root.add(glow);

  // ---------- animation state ----------
  const st = {
    mouth: 0, mouthTarget: 0, mood: 'happy', gesture: null, gestureAt: 0,
    blinkAt: 1.5, look: new THREE.Vector3(0, 1.6, 2), listen: 0, listenTarget: 0.3,
  };
  const MOODS = { // brow height, smile (mouth width), head tilt
    happy: [0.004, 1.15, 0.06], laughing: [0.008, 1.3, 0.12], calm: [0, 1.0, 0.0],
    curious: [0.01, 0.95, -0.12], excited: [0.012, 1.25, 0.04], caring: [-0.002, 1.05, 0.1],
  };
  const tmp = new THREE.Vector3();

  function update(t, dt) {
    const k = 1 - Math.exp(-dt * 18);
    st.mouth += (st.mouthTarget - st.mouth) * k;
    st.listen += (st.listenTarget - st.listen) * (1 - Math.exp(-dt * 5));
    glow.material.uniforms.level.value = st.listen;
    glow.material.uniforms.time.value = t;

    const [brow, smile, tilt] = MOODS[st.mood] || MOODS.happy;
    const open = Math.min(1, st.mouth);
    mouthInside.scale.set(smile * (1 - 0.25 * open), 0.12 + open * 0.95, 0.35);
    upperLip.position.y = 0.002 + open * 0.008;
    lowerLip.position.y = -0.002 - open * 0.016;
    upperLip.scale.setScalar(smile); lowerLip.scale.setScalar(smile);

    // Blink every few seconds.
    let lid = 1;
    if (t > st.blinkAt) {
      const b = (t - st.blinkAt) / 0.14;
      lid = b < 1 ? Math.abs(1 - 2 * b) : 1;
      if (b >= 1) st.blinkAt = t + 2 + Math.random() * 3.5;
    }
    for (const e of eyes) {
      e.eye.scale.y = Math.max(0.08, lid);
      e.brow.position.y = 0.03 + brow + open * 0.002;
    }

    // Idle sway, breathing, a little bounce while talking (she grooves).
    body.position.y = 0.006 * Math.sin(t * 1.7) + open * 0.006;
    body.rotation.z = 0.025 * Math.sin(t * 0.8);
    body.rotation.y = 0.05 * Math.sin(t * 0.5);

    // Head turns toward the look target (the user's head), within limits.
    root.updateMatrixWorld(true);
    tmp.copy(st.look);
    root.worldToLocal(tmp);
    tmp.y -= neckPivot.position.y + head.position.y; // relative to her eyes
    const yaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.8, 0.8);
    const pitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.35, 0.35);
    neckPivot.rotation.y += (yaw - body.rotation.y - neckPivot.rotation.y) * (1 - Math.exp(-dt * 4));
    neckPivot.rotation.x += (pitch - neckPivot.rotation.x) * (1 - Math.exp(-dt * 4));
    neckPivot.rotation.z = tilt + 0.03 * Math.sin(t * 1.1);

    // Arms: relaxed by default; gestures play for a couple of seconds.
    const g = st.gesture, gt = t - st.gestureAt;
    if (g && gt > (g === 'dance' ? 6 : 2.4)) st.gesture = null;
    for (const a of arms) {
      let sz = a.side * (0.12 + 0.03 * Math.sin(t * 1.3 + a.side)), sx = 0.05 + open * 0.15 * Math.sin(t * 7 + a.side), ex = -0.25 - open * 0.25;
      if (st.gesture === 'wave' && a.side === 1) { sz = 2.5; sx = 0; ex = -0.4 + 0.45 * Math.sin(gt * 11); }
      if (st.gesture === 'point' && a.side === 1) { sz = 0.2; sx = -1.35; ex = -0.05; }
      if (st.gesture === 'shrug') { sz = a.side * 0.5; sx = -0.3; ex = -1.6; }
      if (st.gesture === 'heart') { sz = a.side * 0.35; sx = -1.4; ex = -1.5; }
      if (st.gesture === 'dance') { sz = a.side * (1.6 + 0.5 * Math.sin(gt * 6 + a.side)); sx = -0.3; ex = -0.9 + 0.4 * Math.sin(gt * 6); }
      if (st.gesture === 'meditate') { sz = a.side * 0.55; sx = -0.6; ex = -1.25; }
      a.shoulder.rotation.z += (sz - a.shoulder.rotation.z) * k * 0.5;
      a.shoulder.rotation.x += (sx - a.shoulder.rotation.x) * k * 0.5;
      a.elbow.rotation.x += (ex - a.elbow.rotation.x) * k * 0.5;
    }
    if (st.gesture === 'dance') {
      body.position.y += 0.03 * Math.abs(Math.sin(gt * 6));
      body.rotation.y += 0.25 * Math.sin(gt * 3);
    }
  }

  return {
    object: root,
    update,
    setMouth: (v) => { st.mouthTarget = v; },
    setMood: (m) => { if (MOODS[m]) st.mood = m; },
    gesture: (name, t) => { st.gesture = name; st.gestureAt = t; },
    setListening: (on) => { st.listenTarget = on ? 1 : 0.3; },
    lookAt: (worldPos) => { st.look.copy(worldPos); },
    headHeight: 1.55,
  };
}
