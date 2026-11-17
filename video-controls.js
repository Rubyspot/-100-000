// Palm-sized controls for the 180° video: back 10 s, pause / play, close.
// Three round buttons, 8.4 cm across, stand on a dark glass plate within arm's
// reach, at the lower edge of the picture: under its middle, about 35 degrees
// below eye level, so they show at the bottom of the view while the viewer
// looks ahead. They stay there for the whole video (Ilia, Nov 17). Press one
// with a fingertip (hand tracking), or point a controller or a pinching hand
// at it and pull the trigger / pinch. The plate also shows how far the video
// has played.
import * as THREE from 'three';

const R = 0.042;           // button radius: 8.4 cm across, about a palm
const GAP = 0.118;         // button centre to centre
const DEPTH = 0.016;       // button thickness
const HIT_R = 0.058;       // hit radius, a little bigger than the button
const PLATE_W = 0.4, PLATE_H = 0.16;
const BTN_Y = -0.004;      // button centres, plate coordinates (y up from its middle)
const LABEL_Y = -0.063, BAR_Y = 0.056;
const GOLD = '#f2c45a';

// Additive glow that leaves alpha alone (see GLOW_BLEND in main.js).
const GLOW = {
  transparent: true, depthWrite: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
};

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.redraw = (...args) => { draw(cv.getContext('2d'), w, h, ...args); tex.needsUpdate = true; };
  tex.userData.redraw();
  return tex;
}

// Button faces: white icon on a deep teal disc.
function drawIcon(g, w, h, icon) {
  g.clearRect(0, 0, w, h);
  const c = w / 2;
  const grad = g.createRadialGradient(c, c * 0.8, c * 0.1, c, c, c);
  grad.addColorStop(0, '#24433d'); grad.addColorStop(1, '#0b1513');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff';
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (icon === 'pause') {
    g.beginPath(); g.roundRect(c - 52, c - 62, 36, 124, 10); g.roundRect(c + 16, c - 62, 36, 124, 10); g.fill();
  } else if (icon === 'play') {
    g.beginPath(); g.moveTo(c - 38, c - 66); g.lineTo(c + 66, c); g.lineTo(c - 38, c + 66); g.closePath(); g.fill();
  } else if (icon === 'close') {
    g.lineWidth = 30;
    g.beginPath(); g.moveTo(c - 50, c - 50); g.lineTo(c + 50, c + 50); g.moveTo(c + 50, c - 50); g.lineTo(c - 50, c + 50); g.stroke();
  } else if (icon === 'back') {
    // Counter-clockwise arrow around "10".
    g.lineWidth = 20;
    g.beginPath(); g.arc(c, c, 76, -Math.PI * 0.62, Math.PI * 1.05); g.stroke();
    const a = -Math.PI * 0.62, ax = c + 76 * Math.cos(a), ay = c + 76 * Math.sin(a);
    g.beginPath(); g.moveTo(ax + 34, ay - 12); g.lineTo(ax - 14, ay - 4); g.lineTo(ax + 18, ay + 34); g.closePath(); g.fill();
    g.font = '700 70px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('10', c + 2, c + 6);
  }
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function drawPlate(g, w, h, st = {}) {
  g.clearRect(0, 0, w, h);
  const px = w / PLATE_W; // pixels per metre
  g.fillStyle = 'rgba(9, 15, 14, 0.8)';
  g.strokeStyle = 'rgba(242, 196, 90, 0.55)';
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, 56); g.fill(); g.stroke();
  // Progress bar and time along the top, with the playing source's tag
  // ("8K", "4K") between them when there is one.
  const y = h / 2 - BAR_Y * px, x0 = w / 2 - 0.16 * px, x1 = w / 2 + (st.label ? 0.036 : 0.07) * px;
  const k = st.duration ? Math.min(1, Math.max(0, st.time / st.duration)) : 0;
  g.lineCap = 'round'; g.lineWidth = 10;
  g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
  g.strokeStyle = GOLD;
  g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * Math.max(0.001, k), y); g.stroke();
  g.fillStyle = 'rgba(255, 255, 255, 0.85)';
  g.font = '600 34px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(`${fmt(st.time)} / ${fmt(st.duration)}`, w / 2 + 0.084 * px, y + 1);
  if (st.label) {
    const cx = w / 2 + 0.0605 * px, tw = 0.026 * px, th = 40;
    g.lineWidth = 3; g.strokeStyle = GOLD; g.fillStyle = GOLD;
    g.beginPath(); g.roundRect(cx - tw / 2, y - th / 2, tw, th, 10); g.stroke();
    g.font = '700 27px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(String(st.label).slice(0, 3), cx, y + 2);
  }
  // Labels under the buttons.
  g.font = '600 32px system-ui, sans-serif'; g.textAlign = 'center';
  const labels = ['Back 10 s', st.paused ? 'Play' : 'Pause', 'Close'];
  labels.forEach((text, i) => {
    g.fillStyle = st.hover === i ? GOLD : 'rgba(255, 255, 255, 0.82)';
    g.fillText(text, w / 2 + (i - 1) * GAP * px, h / 2 - LABEL_Y * px);
  });
}

export class VideoControls {
  // onBack / onToggle / onClose are called when a button is pressed.
  // below / ahead: where the plate's middle sits in the headset, metres under
  // the eyes and in front of them.
  constructor({ scene, listener, onBack, onToggle, onClose, below = 0.3, ahead = 0.43 }) {
    this.actions = [onBack, onToggle, onClose];
    this.spot = { below, ahead };
    // root: on while a video plays. body: the plate and buttons.
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.ctx = listener.context;
    this.out = listener.getInput();

    this.plateTex = canvasTexture(1024, Math.round(1024 * PLATE_H / PLATE_W), drawPlate);
    this.plateMat = new THREE.MeshBasicMaterial({ map: this.plateTex, transparent: true, depthWrite: false });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H), this.plateMat);
    plate.renderOrder = 30;
    this.body.add(plate);

    this.icons = { back: canvasTexture(256, 256, (g, w, h) => drawIcon(g, w, h, 'back')),
      pause: canvasTexture(256, 256, (g, w, h) => drawIcon(g, w, h, 'pause')),
      play: canvasTexture(256, 256, (g, w, h) => drawIcon(g, w, h, 'play')),
      close: canvasTexture(256, 256, (g, w, h) => drawIcon(g, w, h, 'close')) };
    const bodyGeo = new THREE.CylinderGeometry(R, R * 1.04, DEPTH, 48);
    bodyGeo.rotateX(Math.PI / 2);
    const faceGeo = new THREE.CircleGeometry(R * 0.93, 48);
    const haloGeo = new THREE.RingGeometry(R + 0.003, R + 0.016, 64);
    this.buttons = ['back', 'pause', 'close'].map((icon, i) => {
      const group = new THREE.Group();
      group.position.set((i - 1) * GAP, BTN_Y, DEPTH / 2 + 0.002);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf2c45a, metalness: 0.7, roughness: 0.3, transparent: true });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.renderOrder = 31;
      const faceMat = new THREE.MeshBasicMaterial({ map: this.icons[icon], transparent: true, color: 0xd8d8d8 });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.position.z = DEPTH / 2 + 0.0006;
      face.renderOrder = 32;
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffc860, ...GLOW }));
      halo.position.z = -DEPTH / 2 + 0.001;
      halo.renderOrder = 33;
      halo.visible = false;
      group.add(body, face, halo);
      this.body.add(group);
      return { group, body, face, halo, bodyMat, faceMat, pressT: -1, hover: false };
    });

    this.click = this.makeClick();
    this.state = { hover: -1, paused: false, time: 0, duration: 0, label: '', drawn: '' };
    this.opacity = 0;
    this.xr = true;
    this.cooldownUntil = 0;
    this.lastTips = new Map();
    this.now = 0;
  }

  makeClick() {
    const sr = this.ctx.sampleRate, n = Math.round(sr * 0.05);
    const buf = this.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = (Math.sin(2 * Math.PI * 1750 * t) * 0.5 + Math.sin(2 * Math.PI * 900 * t) * 0.3) * Math.exp(-t / 0.012) * 0.5;
    }
    return buf;
  }

  // head: the viewer's head (camera) object. forward: the direction the
  // picture faces (world space); without it, the way the head faces. In the
  // headset the plate sits under the middle of the picture within reach; on
  // a flat screen further out, so it is on the screen.
  show(head, xr = true, forward = null) {
    this.xr = xr;
    this.place(head, forward);
    this.root.visible = true;
    this.opacity = 0;
  }

  // Put the plate below the eyes along `forward`, turned toward the viewer.
  place(head, forward = null) {
    head.updateMatrixWorld(true);
    const pos = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
    const fwd = forward ? forward.clone() : new THREE.Vector3(0, 0, -1).transformDirection(head.matrixWorld);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const { ahead, below } = this.xr ? this.spot : { ahead: 0.62, below: 0.26 };
    this.root.position.copy(pos).addScaledVector(fwd, ahead);
    this.root.position.y -= below;
    this.root.lookAt(pos);
    this.root.updateMatrixWorld(true);
    this.cooldownUntil = this.now + 0.6; // ignore the finger that just touched the play ball
    this.lastTips.clear();
  }

  hide() {
    this.root.visible = false;
    this.setHover(-1);
  }

  // visible: a video is playing and the controls are there for it.
  // shown: the plate has faded in.
  get visible() { return this.root.visible; }
  get shown() { return this.root.visible && this.opacity > 0.6; }

  // Which button a ray (world space) points at: index or -1, and the hit distance.
  hitRay(ray) {
    if (!this.root.visible) return { index: -1, distance: Infinity, near: false };
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const local = ray.clone().applyMatrix4(inv);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(DEPTH + 0.002));
    const p = local.intersectPlane(plane, new THREE.Vector3());
    if (!p) return { index: -1, distance: Infinity, near: false };
    const distance = p.clone().applyMatrix4(this.root.matrixWorld).distanceTo(ray.origin);
    const near = Math.abs(p.x) < PLATE_W / 2 + 0.12 && Math.abs(p.y) < PLATE_H / 2 + 0.12;
    for (let i = 0; i < 3; i++) {
      if (Math.hypot(p.x - (i - 1) * GAP, p.y - BTN_Y) < HIT_R) return { index: i, distance, near };
    }
    return { index: -1, distance, near };
  }

  // A trigger pull, pinch or click along a ray. Returns true if it pressed a button.
  pressRay(ray) {
    if (!this.root.visible) return false;
    const hit = this.hitRay(ray);
    if (hit.index < 0) return false;
    this.press(hit.index);
    return true;
  }

  press(i) {
    if (this.now < this.cooldownUntil || !this.shown) return;
    this.cooldownUntil = this.now + 0.35;
    this.buttons[i].pressT = this.now;
    if (this.ctx.state === 'running') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.click;
      src.connect(this.out);
      src.start();
    }
    this.actions[i]?.();
  }

  setHover(i) {
    if (this.state.hover === i) return;
    this.state.hover = i;
    this.buttons.forEach((b, j) => {
      b.halo.visible = j === i;
      b.faceMat.color.setHex(j === i ? 0xffffff : 0xd8d8d8);
    });
  }

  // fingertips: world positions of index fingertips. rayHits: results of
  // hitRay for the pointing controllers this frame.
  update(t, dt, { fingertips = [], rayHits = [], paused = false, time = 0, duration = 0, label = '' }) {
    this.now = t;
    if (!this.root.visible) return;
    let hover = -1;
    // Fingertip pokes: press when a tip crosses into a button's face from the front.
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const seen = new Set();
    fingertips.forEach((tip, k) => {
      const p = tip.clone().applyMatrix4(inv);
      seen.add(k);
      for (let i = 0; i < 3; i++) {
        const r = Math.hypot(p.x - (i - 1) * GAP, p.y - BTN_Y);
        if (r > HIT_R) continue;
        if (p.z < 0.07) hover = i;
        const front = DEPTH + 0.004;
        const prev = this.lastTips.get(k);
        if (p.z < front && p.z > -0.05 && prev !== undefined && prev >= front) this.press(i);
      }
      this.lastTips.set(k, p.z);
    });
    for (const k of [...this.lastTips.keys()]) if (!seen.has(k)) this.lastTips.delete(k);
    for (const h of rayHits) if (h.index >= 0) hover = h.index;
    this.setHover(hover);

    // Fades in when the video starts.
    this.opacity += (1 - this.opacity) * Math.min(1, dt * 8);
    if (this.opacity > 0.995) this.opacity = 1;
    this.plateMat.opacity = this.opacity;
    this.buttons.forEach((b) => {
      b.bodyMat.opacity = b.faceMat.opacity = this.opacity;
      const k = b.pressT >= 0 ? Math.min(1, (t - b.pressT) / 0.22) : 1;
      const sink = Math.sin(Math.PI * k) * 0.009;
      b.group.position.z = DEPTH / 2 + 0.002 - sink;
      b.group.scale.setScalar(b.halo.visible ? 1.06 : 1);
    });

    // Redraw the plate only when what it shows changes.
    this.state.paused = paused; this.state.time = time; this.state.duration = duration; this.state.label = label;
    const key = `${this.state.hover}|${paused}|${Math.floor(time)}|${Math.floor(duration)}|${label}`;
    if (key !== this.state.drawn) {
      this.state.drawn = key;
      this.plateTex.userData.redraw(this.state);
      this.buttons[1].face.material.map = this.icons[paused ? 'play' : 'pause'];
    }
  }
}
