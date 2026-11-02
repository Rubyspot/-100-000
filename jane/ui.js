// Small in-headset UI for Jane: a caption panel over her head and a pokeable
// orb button (touch it with a fingertip, or pinch while pointing at it).
import * as THREE from 'three';

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

const tmp = new THREE.Vector3();
export function makeOrb(label, color) {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 40, 28), new THREE.MeshStandardMaterial({
    color, metalness: 0.3, roughness: 0.25, emissive: color, emissiveIntensity: 0.25,
  }));
  group.add(ball);
  // A little wave on the ball, so it reads as "water".
  const wave = new THREE.Mesh(new THREE.TorusGeometry(0.093, 0.008, 8, 40, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  wave.rotation.z = Math.PI;
  ball.add(wave);

  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(13,20,18,0.72)'; g.beginPath(); g.roundRect(4, 4, 504, 104, 30); g.fill();
  g.fillStyle = '#f2c45a'; g.font = '600 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 256, 58);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.066), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  tag.position.y = -0.16;
  group.add(tag);

  let pressed = false, session = null;
  const world = new THREE.Vector3();
  function press() { if (pressed || !group.visible) return; pressed = true; group.userData.onPress && group.userData.onPress(); }
  function onSelect(e) {
    const ref = group.userData.renderer.xr.getReferenceSpace();
    const pose = e.frame.getPose(e.inputSource.targetRaySpace, ref);
    if (!pose || !group.visible) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const ray = new THREE.Ray(new THREE.Vector3().setFromMatrixPosition(m), new THREE.Vector3(0, 0, -1).transformDirection(m));
    // XR poses are in the rig's space (the player moves by moving the rig).
    const rig = group.userData.rig;
    const p = rig ? rig.worldToLocal(group.getWorldPosition(world)) : group.getWorldPosition(world);
    if (ray.distanceSqToPoint(p) < 0.15 * 0.15) press();
  }
  group.userData.update = (t, head, renderer, frame, rig) => {
    group.userData.renderer = renderer;
    group.userData.rig = rig;
    ball.rotation.y = t * 0.6;
    ball.position.y = 0.02 * Math.sin(t * 1.8);
    ball.scale.setScalar(pressed ? 1.3 : 1 + 0.04 * Math.sin(t * 3));
    tag.lookAt(head);
    const s = renderer.xr.getSession();
    if (s && s !== session) { session = s; s.addEventListener('select', onSelect); }
    // Poke with an index fingertip.
    const ref = renderer.xr.getReferenceSpace();
    if (s && frame && ref && frame.getJointPose) {
      group.getWorldPosition(world);
      for (const src of s.inputSources) {
        const tip = src.hand && src.hand.get('index-finger-tip');
        const pose = tip && frame.getJointPose(tip, ref);
        if (!pose) continue;
        tmp.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        if (rig) rig.localToWorld(tmp);
        if (tmp.distanceTo(world) < 0.12) press();
      }
    }
  };
  group.userData.click = press; // flat preview
  group.userData.ball = ball;
  return group;
}
