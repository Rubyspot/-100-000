// Small in-headset UI for Jane: a caption panel over her head and the
// floating jetski she offers after the video (touch it to ride).
import * as THREE from 'three';
import { loadJetski, makeJetski, JET_BLACK } from '../jetski/models.js';

function wrap(g, text, maxWidth, maxLines) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  // Keep the end of long replies: that's what she is saying now.
  if (lines.length > maxLines) { const tail = lines.slice(-maxLines); tail[0] = '… ' + tail[0]; return tail; }
  return lines;
}

export function makeCaption() {
  const W = 1024, H = 360;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82 * H / W),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.renderOrder = 30;
  const st = { jane: '', user: '', status: '', dirty: true, janeAt: 0 };
  function draw() {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (!st.jane && !st.status && !st.user) { mesh.visible = false; return; }
    mesh.visible = true;
    g.font = '500 40px system-ui, sans-serif';
    const lines = st.jane ? wrap(g, st.jane, W - 96, 4) : [];
    const h = 40 + (st.user ? 50 : 0) + lines.length * 52 + (st.status ? 50 : 0) + 24;
    const y0 = H - h;
    g.fillStyle = 'rgba(13,20,18,0.72)';
    g.beginPath(); g.roundRect(8, y0, W - 16, h - 8, 30); g.fill();
    let y = y0 + 52;
    g.textAlign = 'center';
    if (st.user) {
      g.font = 'italic 32px system-ui, sans-serif'; g.fillStyle = '#9fb2a6';
      g.fillText(`you: ${st.user.length > 60 ? st.user.slice(0, 57) + '…' : st.user}`, W / 2, y); y += 50;
    }
    g.font = '500 40px system-ui, sans-serif'; g.fillStyle = '#eef3ea';
    for (const l of lines) { g.fillText(l, W / 2, y); y += 52; }
    if (st.status) { g.font = '600 32px system-ui, sans-serif'; g.fillStyle = '#8fd18a'; g.fillText(st.status, W / 2, y); }
    tex.needsUpdate = true;
  }
  mesh.userData = {
    set(jane, user) {
      if (jane != null) { st.jane = jane; st.janeAt = performance.now(); }
      if (user !== undefined) st.user = user || '';
      st.dirty = true;
    },
    status(s) { if (s !== st.status) { st.status = s; st.dirty = true; } },
    update() {
      // Fade her line out a while after she stops, so the panel isn't stuck on screen.
      if (st.jane && performance.now() - st.janeAt > 9000) { st.jane = ''; st.user = ''; st.dirty = true; }
      if (st.dirty) { st.dirty = false; draw(); }
    },
  };
  return mesh;
}

// A toy jetski that floats in the air as a button (the model from the race,
// in Crispy J's yellow and pink, over a little puddle). Touch it with a hand
// or a controller, pinch or pull the trigger while pointing at it, or click
// it in the flat preview. show() brings it in; onPress runs once it has
// spun up after the touch.
const TOUCH_JOINTS = ['index-finger-tip', 'middle-finger-tip', 'thumb-tip', 'middle-finger-metacarpal'];
const TOUCH_RADIUS = 0.15, POINT_RADIUS = 0.2, PRESS_SEC = 0.5;
const tmp = new THREE.Vector3();
export function makeJetskiButton(label) {
  const group = new THREE.Group();
  group.visible = false;
  const toy = new THREE.Group();
  toy.rotation.order = 'YXZ';
  group.add(toy);
  let model = null;
  loadJetski().then(() => {
    const ski = makeJetski(0xffd23f, null, { accent: JET_BLACK });
    ski.mats.paint.emissive.set(0xffd23f); ski.mats.paint.emissiveIntensity = 0.14;
    const box = new THREE.Box3().setFromObject(ski.root);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const k = 0.36 / Math.max(size.x, size.z);
    ski.root.scale.setScalar(k);
    ski.root.position.copy(centre).multiplyScalar(-k);
    model = ski.root;
    toy.add(model);
    toy.remove(standIn);
  }).catch((err) => console.warn('Jetski button: the model did not load, showing a ball.', err));
  // Until the model is there (or if it can't load): a yellow ball.
  const standIn = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 20), new THREE.MeshStandardMaterial({
    color: 0xffd23f, roughness: 0.3, emissive: 0xffd23f, emissiveIntensity: 0.2,
  }));
  toy.add(standIn);

  // The puddle it floats over: rippling water with a pink rim.
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, glow: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() { vPos = position.xy / 0.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time, glow; varying vec2 vPos;
      void main() {
        float r = length(vPos);
        float ring = 0.5 + 0.5 * sin(r * 24.0 - time * 4.5);
        vec3 water = mix(vec3(0.04, 0.55, 0.74), vec3(0.55, 0.95, 0.96), ring * ring * (1.0 - 0.6 * r));
        float rim = smoothstep(0.74, 0.84, r) * smoothstep(1.0, 0.9, r);
        vec3 col = mix(water, vec3(1.0, 0.31, 0.64), rim) + glow * vec3(0.5, 0.42, 0.1);
        float a = smoothstep(1.0, 0.93, r) * mix(0.62, 1.0, rim);
        gl_FragColor = vec4(col, a);
      }`,
  }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.y = -0.12;
  puddle.renderOrder = 28;
  group.add(puddle);

  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 120;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3 * 120 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  tag.position.y = -0.215;
  tag.renderOrder = 29;
  group.add(tag);
  function drawTag() {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 512, 120);
    g.fillStyle = '#2a1030'; g.strokeStyle = '#ff4fa3'; g.lineWidth = 8;
    g.beginPath(); g.roundRect(8, 8, 496, 104, 52); g.fill(); g.stroke();
    g.fillStyle = '#ffd23f'; g.font = '700 50px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 256, 63);
    tex.needsUpdate = true;
  }

  // For clicks in the flat preview (a ray test needs no drawing).
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), new THREE.MeshBasicMaterial());
  hit.visible = false;
  group.add(hit);

  // armed: a hand that is already where the jetski pops up doesn't press it;
  // a touch counts once that spot has been free of hands for a moment.
  let shownAt = -1, pressedAt = -1, fired = false, armed = false, session = null, now = 0, spin = 0, last = 0;
  const world = new THREE.Vector3();
  let faceAt = null; // the point its tag faces; null: the player's head, each frame
  function press() {
    if (pressedAt >= 0 || !group.visible || shownAt < 0 || now - shownAt < 0.7) return;
    pressedAt = now;
  }
  function onSelect(e) {
    if (!group.visible) return;
    const ref = group.userData.renderer.xr.getReferenceSpace();
    const pose = ref && e.frame.getPose(e.inputSource.targetRaySpace, ref);
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const ray = new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m), new THREE.Vector3(0, 0, -1).transformDirection(m));
    // XR poses are in the rig's space (the player moves by moving the rig).
    const rig = group.userData.rig;
    const p = rig ? rig.worldToLocal(group.getWorldPosition(world)) : group.getWorldPosition(world);
    if (ray.distanceSqToPoint(p) < POINT_RADIUS * POINT_RADIUS) press();
  }
  const touches = (pose, rig) => {
    if (!pose) return false;
    tmp.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
    if (rig) rig.localToWorld(tmp);
    return tmp.distanceTo(world) < TOUCH_RADIUS;
  };

  group.userData = {
    hit,
    show() { group.visible = true; shownAt = -1; pressedAt = -1; fired = false; armed = false; drawTag(); },
    hide() { group.visible = false; },
    // Where its tag looks (world space), e.g. the eyes of a player standing at
    // the spot it was put on; null: at the player's head, wherever that is.
    face(at) { faceAt = at ? at.clone() : null; },
    click: press, // flat preview
    onPress: null,
    update(t, head, renderer, frame, rig) {
      group.userData.renderer = renderer;
      group.userData.rig = rig;
      now = t;
      const dt = Math.min(0.1, Math.max(0, t - last)); last = t;
      if (shownAt < 0) shownAt = t;
      const pressing = pressedAt >= 0 ? Math.min(1, (t - pressedAt) / PRESS_SEC) : 0;
      // Pops in and turns slowly in place (Ilia, Nov 18: the buttons must stay
      // put, so it no longer bobs, rocks or swells); spins up when touched.
      const a = Math.min(1, (t - shownAt) / 0.6);
      const pop = a < 1 ? 1 + 2.7 * Math.pow(a - 1, 3) + 1.7 * Math.pow(a - 1, 2) : 1;
      spin += dt * (0.7 + 14 * pressing * pressing);
      toy.rotation.set(0, spin, 0);
      toy.position.y = 0.05 * pressing;
      toy.scale.setScalar(Math.max(0.0001, pop * (1 + 0.3 * pressing)));
      puddle.scale.setScalar(Math.max(0.0001, pop * (1 + 0.5 * pressing)));
      puddle.material.uniforms.time.value = t;
      puddle.material.uniforms.glow.value = pressing;
      tag.visible = pressedAt < 0;
      tag.lookAt(faceAt || head);
      if (pressedAt >= 0) {
        if (!fired && pressing >= 1) { fired = true; group.userData.onPress && group.userData.onPress(); }
        return;
      }
      const s = renderer.xr.getSession();
      if (s && s !== session) { session = s; s.addEventListener('select', onSelect); }
      const ref = renderer.xr.getReferenceSpace();
      if (!s || !frame || !ref) return;
      group.getWorldPosition(world);
      let inside = false;
      for (const src of s.inputSources) {
        if (src.hand && frame.getJointPose) {
          for (const name of TOUCH_JOINTS) {
            const joint = src.hand.get(name);
            if (joint && touches(frame.getJointPose(joint, ref), rig)) inside = true;
          }
        } else if (src.gripSpace && touches(frame.getPose(src.gripSpace, ref), rig)) inside = true;
      }
      if (!inside) armed = true;
      else if (armed) press();
    },
  };
  return group;
}
