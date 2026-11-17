// The way out of the ride: the 180 video's Back button, in the same place
// and the same look. A gold button, 8.4 cm across, with a white arrow on a
// deep teal face, stands on a small dark glass plate low in front of the
// rider, where the video's controls are: here that is on the handlebar,
// between the hands.
//
// A hand on a grip never comes near it, and to be sure a passing hand can't
// end a race, it takes a hold: a fingertip (or a controller) on the button,
// or the B button, for half a second. A gold ring fills around it meanwhile.
// On a screen a click is enough.
import * as THREE from 'three';

const R = 0.042;            // button radius, as on the video's controls
const DEPTH = 0.016;        // button thickness
const HIT_R = 0.06;         // touch radius, a little bigger than the button
const PLATE_W = 0.2, PLATE_H = 0.092;
const BX = -0.05;           // button centre on the plate; the words are to its right
const HOLD = 0.5;           // seconds of holding it
const GOLD = '#f2c45a';
const SEG = 48;             // segments of the ring that fills

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { g: canvas.getContext('2d'), tex, w, h };
}

// The face: a white "return" arrow on the teal disc of the video's buttons.
function drawFace(g, w) {
  const c = w / 2;
  const grad = g.createRadialGradient(c, c * 0.8, c * 0.1, c, c, c);
  grad.addColorStop(0, '#24433d'); grad.addColorStop(1, '#0b1513');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff';
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 22;
  g.translate(3, 6); // centres the arrow on the face
  const top = c - 34, bottom = c + 46, turn = c + 16, rr = (bottom - top) / 2;
  g.beginPath();
  g.moveTo(c - 34, top); g.lineTo(turn, top);
  g.arc(turn, top + rr, rr, -Math.PI / 2, Math.PI / 2);
  g.lineTo(c - 36, bottom);
  g.stroke();
  g.beginPath(); g.moveTo(c - 72, top); g.lineTo(c - 30, top - 36); g.lineTo(c - 30, top + 36); g.closePath(); g.fill();
}

function drawPlate(g, w, h, label, hint) {
  g.clearRect(0, 0, w, h);
  const px = w / PLATE_W;
  g.fillStyle = 'rgba(9, 15, 14, 0.8)';
  g.strokeStyle = 'rgba(242, 196, 90, 0.55)';
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, 56); g.fill(); g.stroke();
  const x = w / 2 + 0.046 * px;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255, 255, 255, 0.92)';
  g.font = '600 70px system-ui, sans-serif';
  g.fillText(label, x, h / 2 - 0.009 * px, 0.1 * px);
  g.fillStyle = hint.active ? GOLD : 'rgba(255, 255, 255, 0.55)';
  g.font = '500 31px system-ui, sans-serif';
  g.fillText(hint.text, x, h / 2 + 0.024 * px, 0.104 * px);
}

// label: the word on the plate. Returns the plate (to hang on the jetski) and
// update(), which says when the hold is done.
export function createBackButton({ label = 'Back' } = {}) {
  const root = new THREE.Group();
  root.visible = false;

  const plate = canvasTexture(512, Math.round(512 * PLATE_H / PLATE_W));
  const hints = { idle: { text: 'Hold to leave', active: false }, held: { text: 'Leaving…', active: true } };
  let hintNow = null;
  const setHint = (hint) => {
    if (hint === hintNow) return;
    hintNow = hint;
    drawPlate(plate.g, plate.w, plate.h, label, hint);
    plate.tex.needsUpdate = true;
  };
  setHint(hints.idle);
  const plateMat = new THREE.MeshBasicMaterial({ map: plate.tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H), plateMat);
  plateMesh.renderOrder = 6;
  root.add(plateMesh);

  const face = canvasTexture(256, 256);
  drawFace(face.g, face.w);
  face.tex.needsUpdate = true;

  const button = new THREE.Group();
  const rest = DEPTH / 2 + 0.002;
  button.position.set(BX, 0, rest);
  const bodyGeo = new THREE.CylinderGeometry(R, R * 1.04, DEPTH, 48);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xf2c45a, metalness: 0.7, roughness: 0.3 }));
  body.renderOrder = 7;
  const faceMat = new THREE.MeshBasicMaterial({ map: face.tex, transparent: true, color: 0xd8d8d8, fog: false, toneMapped: false });
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(R * 0.93, 48), faceMat);
  faceMesh.position.z = DEPTH / 2 + 0.0006;
  faceMesh.renderOrder = 8;
  // Glow when a hand is at it, and the ring that fills while it is held
  // (clockwise from the top).
  const glow = { transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
  const halo = new THREE.Mesh(new THREE.RingGeometry(R + 0.003, R + 0.016, 64), new THREE.MeshBasicMaterial({ color: 0xffc860, ...glow }));
  halo.position.z = -DEPTH / 2 + 0.001;
  halo.renderOrder = 9; halo.visible = false;
  const ringGeo = new THREE.RingGeometry(R + 0.005, R + 0.013, SEG, 1, Math.PI / 2, Math.PI * 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide }));
  ring.scale.x = -1; // so it fills clockwise (both sides drawn, as this turns it over)
  ring.position.z = DEPTH / 2 + 0.001;
  ring.renderOrder = 10;
  ringGeo.setDrawRange(0, 0);
  button.add(body, faceMesh, halo, ring);
  root.add(button);

  const inv = new THREE.Matrix4(), _p = new THREE.Vector3();
  let held = 0, armed = false, hover = false, shownAt = 0, now = 0;

  function show(on) {
    if (on === root.visible) return;
    root.visible = on;
    held = 0; armed = false; shownAt = now;
    ringGeo.setDrawRange(0, 0);
  }

  // pointers: fingertips and controllers (world positions). pressed: a
  // button for it is held down (B, Escape). Returns true once it has been
  // held long enough.
  function update(pointers, pressed, dt, t) {
    now = t;
    if (!root.visible) return false;
    root.updateWorldMatrix(true, false);
    inv.copy(root.matrixWorld).invert();
    let touch = false;
    hover = false;
    for (const p of pointers) {
      _p.copy(p).applyMatrix4(inv);
      const r = Math.hypot(_p.x - BX, _p.y);
      if (r < HIT_R + 0.04 && _p.z < 0.18 && _p.z > -0.08) hover = true;
      // On the face or pushed into it (a controller's grip sits a few
      // centimetres behind its tip, so a little in front counts too).
      if (r < HIT_R && _p.z < 0.075 && _p.z > -0.06) touch = true;
    }
    // A hand that was already there when it showed has to come off it first.
    if (!touch) armed = true;
    const holding = (touch && armed) || pressed;
    if (now - shownAt < 0.4) held = 0;
    else if (holding) held += dt / HOLD;
    else held = Math.max(0, held - dt * 1.2);
    let done = false;
    if (held >= 1) { done = true; held = 0; armed = false; }

    ringGeo.setDrawRange(0, 6 * Math.round(Math.min(1, held) * SEG));
    const lit = hover || holding;
    halo.visible = lit;
    faceMat.color.setHex(lit ? 0xffffff : 0xd8d8d8);
    button.position.z = rest - (holding ? 0.006 : 0);
    button.scale.setScalar(lit ? 1.06 : 1);
    setHint(holding || held > 0.05 ? hints.held : hints.idle);
    return done;
  }

  // A click on a screen (a ray in world space).
  const meshes = [body, faceMesh];
  function hit(raycaster) {
    return root.visible && raycaster.intersectObjects(meshes, false).length > 0;
  }

  return { root, show, update, hit, get visible() { return root.visible; }, get progress() { return held; } };
}
