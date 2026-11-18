// The play button for the 180 video (Ilia, Nov 18: "make play button for
// video look better"). It is the video controls' gold button made big, 20 cm
// across: a polished gold rim with a rounded edge around a deep teal face
// with a white play arrow, a soft glow that breathes behind it and a ring
// that ripples out every couple of seconds, over a dark glass plate that
// says what it does. It stands still where it is put (Ilia, Nov 18: buttons
// that drift are hard to press), turned once to face the viewer; it pops
// up, lights up as a hand comes near, and flashes as it is touched.
//
//   const play = createPlayButton();
//   anchor.add(play.root);
//   play.setText('Play the video', 'Touch the button');
//   play.face(eyes);                                  // once, where it is put
//   play.update(t, { appear, press, hover });         // each frame while shown
//   raycaster.intersectObjects(play.hits);            // a click on a screen
import * as THREE from 'three';

const R = 0.085;           // face radius
const RIM = R * 1.17;      // outer radius of the gold rim
const DEPTH = 0.026;
const PLATE_W = 0.25, PLATE_H = 0.078;
const GOLD = '#f2c45a';

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { g: canvas.getContext('2d'), tex, w, h };
}

// Polished gold, as a matcap: it shines the same in any light and costs no
// lights at all.
function goldMatcap() {
  const { g, tex, w } = canvasTexture(256, 256);
  const c = w / 2;
  const base = g.createRadialGradient(c * 0.86, c * 0.8, 0, c, c, c);
  base.addColorStop(0, '#fff1c4');
  base.addColorStop(0.25, '#f7cf6a');
  base.addColorStop(0.62, '#c98f2a');
  base.addColorStop(0.88, '#7a5114');
  base.addColorStop(1, '#3c2606');
  g.fillStyle = base;
  g.fillRect(0, 0, w, w);
  // A soft window highlight up and to the left, a warm bounce low right.
  const hi = g.createRadialGradient(c * 0.62, c * 0.52, 0, c * 0.62, c * 0.52, c * 0.42);
  hi.addColorStop(0, 'rgba(255,255,255,0.95)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi;
  g.fillRect(0, 0, w, w);
  const lo = g.createRadialGradient(c * 1.45, c * 1.5, 0, c * 1.45, c * 1.5, c * 0.5);
  lo.addColorStop(0, 'rgba(255,214,140,0.55)');
  lo.addColorStop(1, 'rgba(255,214,140,0)');
  g.fillStyle = lo;
  g.fillRect(0, 0, w, w);
  tex.needsUpdate = true;
  return tex;
}

// The face: the teal of the video's buttons, a fine gold line inside the
// rim, a white play arrow with a soft shadow, and a glassy sheen on top.
function drawFace(g, w) {
  const c = w / 2;
  g.clearRect(0, 0, w, w);
  const grad = g.createRadialGradient(c, c * 0.72, c * 0.08, c, c, c);
  grad.addColorStop(0, '#2d5a51'); grad.addColorStop(0.7, '#123029'); grad.addColorStop(1, '#081311');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(242, 196, 90, 0.6)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(c, c, c * 0.9, 0, Math.PI * 2); g.stroke();
  // The arrow, its middle (not its box) on the face's middle so it looks centred.
  const s = c * 0.46, x0 = c - s * 0.42, x1 = c + s * 0.84;
  const tri = () => {
    g.beginPath(); g.moveTo(x0, c - s * 0.98); g.lineTo(x1, c); g.lineTo(x0, c + s * 0.98); g.closePath();
  };
  g.lineJoin = 'round'; g.lineWidth = s * 0.26;
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff';
  // Its shadow first, then the arrow again on top (the shadow of the round
  // outline would otherwise fall inside it).
  g.save();
  g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = 22; g.shadowOffsetY = 8;
  tri(); g.fill(); g.stroke();
  g.restore();
  tri(); g.fill(); g.stroke();
  // Sheen: a soft lighter band across the top half.
  g.save();
  g.beginPath(); g.arc(c, c, c * 0.88, 0, Math.PI * 2); g.clip();
  const sheen = g.createLinearGradient(0, c * 0.1, 0, c * 1.05);
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.beginPath(); g.ellipse(c, c * 0.42, c * 0.8, c * 0.5, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawPlate(g, w, h, title, sub) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(9, 15, 14, 0.82)';
  g.strokeStyle = 'rgba(242, 196, 90, 0.55)';
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, (h - 6) / 2); g.fill(); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255, 255, 255, 0.95)';
  g.font = `600 ${Math.round(h * 0.36)}px system-ui, sans-serif`;
  g.fillText(title, w / 2, h * (sub ? 0.4 : 0.5), w - 60);
  if (sub) {
    g.fillStyle = GOLD;
    g.font = `500 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    g.fillText(sub, w / 2, h * 0.74, w - 80);
  }
}

const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createPlayButton() {
  const root = new THREE.Group();   // floats where it is put, turned to the viewer
  const button = new THREE.Group(); // pops up, leans in, pushes in
  root.add(button);

  // The rim: a coin with a rounded edge (lathe profile from the back's middle
  // round the edge to the face), the face set a little into it.
  const e = DEPTH / 2, prof = [new THREE.Vector2(0.0001, -e)];
  for (let i = 0; i <= 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI;
    prof.push(new THREE.Vector2(RIM - e + e * Math.cos(a), e * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(R * 1.035, e * 0.9), new THREE.Vector2(R * 1.0, e * 0.45), new THREE.Vector2(0.0001, e * 0.45));
  const rimGeo = new THREE.LatheGeometry(prof, 96);
  rimGeo.rotateX(Math.PI / 2);
  const rimMat = new THREE.MeshMatcapMaterial({ matcap: goldMatcap(), color: 0xffffff, fog: false });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.renderOrder = 7;

  const face = canvasTexture(512, 512);
  drawFace(face.g, face.w);
  face.tex.needsUpdate = true;
  const faceMat = new THREE.MeshBasicMaterial({ map: face.tex, transparent: true, color: 0xe6e6e6, fog: false, toneMapped: false });
  const faceMesh = new THREE.Mesh(new THREE.CircleGeometry(R, 64), faceMat);
  faceMesh.position.z = e * 0.45 + 0.0005;
  faceMesh.renderOrder = 8;

  // Behind it: a glow that breathes and a ring that ripples outward.
  const glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { time: { value: 0 }, level: { value: 1 }, rim: { value: RIM / (RIM * 2.8) } },
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() { vPos = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time, level, rim; varying vec2 vPos;
      void main() {
        float r = length(vPos);
        float out_ = max(0.0, r - rim);
        float halo = exp(-out_ * 9.0) * smoothstep(rim - 0.04, rim + 0.01, r) * (0.42 + 0.12 * sin(time * 2.4));
        float k = fract(time / 2.4);                       // one ripple every 2.4 s
        float rr = rim + k * (1.0 - rim) * 0.92;
        float ripple = smoothstep(0.035, 0.0, abs(r - rr)) * (1.0 - k) * (1.0 - k) * 0.7;
        float g = (halo + ripple) * level * smoothstep(1.0, 0.9, r);
        gl_FragColor = vec4(vec3(1.0, 0.76, 0.32) * g, g);
      }`,
  });
  const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(RIM * 5.6, RIM * 5.6), glowMat);
  glowMesh.position.z = -e - 0.002;
  glowMesh.renderOrder = 6;
  button.add(glowMesh, rim, faceMesh);

  // The plate underneath, with what it does.
  const plate = canvasTexture(640, Math.round(640 * PLATE_H / PLATE_W));
  const plateMat = new THREE.MeshBasicMaterial({ map: plate.tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H), plateMat);
  plateMesh.position.set(0, -RIM - 0.016 - PLATE_H / 2, 0);
  plateMesh.renderOrder = 9;
  root.add(plateMesh);
  let text = '';
  function setText(title, sub = '') {
    if (text === title + '\n' + sub) return;
    text = title + '\n' + sub;
    drawPlate(plate.g, plate.w, plate.h, title, sub);
    plate.tex.needsUpdate = true;
  }
  setText('Play the video', 'Touch the button');

  const _v = new THREE.Vector3();
  // Turn it to face `eyes` (a world position), leaning back a little toward
  // them. Once, where it is put: from then on it stays as it is.
  function face(eyes) {
    root.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(root.matrixWorld);
    root.lookAt(_v.set(eyes.x, _v.y + (eyes.y - _v.y) * 0.6, eyes.z));
  }

  // appear 0..1 since it was asked for; press 0..1 since it was touched;
  // hover 0..1 a hand is near.
  function update(t, { appear = 1, press = 0, hover = 0 } = {}) {
    const pop = easeOutBack(clamp01(appear / 0.75));
    button.scale.setScalar(Math.max(0.0001, pop * (1 + 0.05 * hover + 0.35 * press)));
    button.position.z = -0.01 * Math.sin(Math.PI * Math.min(1, press * 2));
    const shown = clamp01((appear - 0.35) / 0.4);
    plateMat.opacity = shown * (1 - press);
    plateMesh.visible = plateMat.opacity > 0.01;
    faceMat.color.setScalar(0.9 + 0.1 * hover + 0.3 * press);
    glowMat.uniforms.time.value = t;
    glowMat.uniforms.level.value = clamp01(appear / 0.8) * (1 + 0.8 * hover + 1.6 * press);
  }

  return { root, setText, face, update, hits: [rim, faceMesh] };
}
