// The race's interface, in the Crispy J look: hot pink, sunny yellow, cream
// and plum outlines, set in Fredoka, drawn like stickers and bouncing a
// little when they change.
//   - a dash on the handlebar: cash and the way to $100,000, the Crispy
//     combo, place, speed, time, and a strip showing you and Jane on the lap
//   - big messages ahead (countdown, GO, wrong way)
//   - Jane's lines in a speech bubble
//   - "+$700" pops when a bill is picked up
//   - a results board with two palm-size buttons at arm's reach
//   - a soft vignette in fast turns and the fade used between scenes
import * as THREE from 'three';

export const COLORS = { pink: '#ff4fa3', yellow: '#ffd23f', plum: '#2a1030', cream: '#fff6e0', mint: '#7ef0c8', sky: '#4fd6ff' };
const C = COLORS;

export async function loadFonts() {
  try {
    const base = new URL('./assets/fonts/', import.meta.url).href;
    const faces = [['700', 'fredoka-latin-700-normal.woff2'], ['600', 'fredoka-latin-600-normal.woff2']]
      .map(([weight, file]) => new FontFace('Fredoka', `url(${base}${file})`, { weight }));
    await Promise.all(faces.map((f) => f.load().then((loaded) => document.fonts.add(loaded))));
    return 'Fredoka, system-ui, sans-serif';
  } catch {
    return 'system-ui, sans-serif';
  }
}

function canvasTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex, w, h };
}
const flat = (map, extra = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, ...extra });

export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
export const clock = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

export function createHud({ holder, camera, font, eyeY, embedded = false, goal = 100000, maxCombo = 10 }) {
  const F = (weight, px) => `${weight} ${px}px ${font}`;
  // Text with a fat outline, like a sticker.
  const sticker = (g, text, x, y, px, fill, { stroke = C.plum, width = px * 0.18, weight = 700, align = 'center', maxWidth, shadow = null } = {}) => {
    g.font = F(weight, px); g.textAlign = align; g.textBaseline = 'middle'; g.lineJoin = 'round';
    if (shadow) { g.fillStyle = shadow; g.strokeStyle = shadow; g.lineWidth = width; g.strokeText(text, x + px * 0.05, y + px * 0.07, maxWidth); }
    g.lineWidth = width; g.strokeStyle = stroke; g.strokeText(text, x, y, maxWidth);
    g.fillStyle = fill; g.fillText(text, x, y, maxWidth);
  };
  const pill = (g, x, y, w, h, fill, stroke = null, lw = 6) => {
    g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) / 2);
    g.fillStyle = fill; g.fill();
    if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
  };

  // ---------- dash ----------
  const dash = canvasTexture(640, 320);
  const dashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), flat(dash.tex, { depthTest: true }));
  dashMesh.renderOrder = 5;
  function drawDash(i) {
    const g = dash.ctx, w = dash.w, h = dash.h;
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 44);
    g.fillStyle = 'rgba(42,16,48,.9)'; g.fill();
    g.lineWidth = 10; g.strokeStyle = C.pink; g.stroke();
    g.beginPath(); g.roundRect(18, 18, w - 36, h - 36, 34); g.lineWidth = 3; g.strokeStyle = 'rgba(255,210,63,.55)'; g.stroke();
    // Cash and the way to the goal.
    // Past the goal the bar starts over toward the next hundred thousand.
    const got = Math.floor(i.money / goal), rich = got >= 1;
    sticker(g, money(i.money), 40, 84, 78, rich ? C.mint : C.yellow, { align: 'left', width: 10, maxWidth: 380 });
    const k = Math.min(1, (i.money - got * goal) / goal);
    pill(g, 40, 136, 370, 22, rich ? 'rgba(126,240,200,.3)' : 'rgba(255,255,255,.14)');
    if (k > 0.02) {
      const grad = g.createLinearGradient(40, 0, 410, 0); grad.addColorStop(0, C.pink); grad.addColorStop(1, C.yellow);
      pill(g, 40, 136, Math.max(22, 370 * k), 22, grad);
    }
    g.font = F(600, 20); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = rich ? C.mint : 'rgba(255,246,224,.75)';
    g.fillText(rich ? `got ${money(got * goal)}!  next ${money((got + 1) * goal)}` : `to ${money(goal)}`, 408, 172);
    // Crispy combo.
    const combo = i.combo || 0, hot = combo >= maxCombo;
    sticker(g, hot ? 'CRISPY MAX' : 'CRISPY', 40, 212, 30, hot ? C.yellow : C.pink, { align: 'left', width: 6 });
    sticker(g, 'x' + Math.max(1, combo), hot ? 236 : 164, 212, 34, C.cream, { align: 'left', width: 6 });
    for (let n = 0; n < maxCombo; n++) {
      pill(g, 40 + n * 37, 240, 30, 16, n < combo ? (hot ? C.yellow : C.pink) : 'rgba(255,255,255,.14)');
    }
    // Place, speed, time.
    const first = i.rank === 1;
    if (i.rank) {
      g.save(); g.translate(540, 62); g.rotate(-0.08);
      pill(g, -70, -34, 140, 68, first ? C.yellow : C.pink, C.plum, 6);
      sticker(g, first ? '1ST' : '2ND', 0, 2, 44, first ? C.plum : C.cream, { stroke: first ? C.yellow : C.plum, width: 4 });
      g.restore();
    }
    sticker(g, String(i.kmh ?? 0), 600, 148, 74, i.boost ? C.yellow : C.cream, { align: 'right', width: 9 });
    g.font = F(600, 22); g.textAlign = 'right'; g.fillStyle = i.boost ? C.yellow : 'rgba(255,246,224,.75)';
    g.fillText(i.boost ? 'BOOST!' : 'km/h', 600, 196);
    g.font = F(600, 30); g.fillStyle = C.cream; g.fillText(i.time || '0:00.0', 600, 240);
    if (i.fps) { g.font = F(600, 18); g.fillStyle = 'rgba(255,246,224,.6)'; g.fillText(i.fps + ' fps', 600, 24); }
    // The lap: you (yellow) and Jane (pink).
    pill(g, 40, 278, 560, 10, 'rgba(255,255,255,.16)');
    const dot = (u, col, r) => { g.beginPath(); g.arc(40 + 560 * Math.max(0, Math.min(1, u)), 283, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = C.plum; g.stroke(); };
    dot(i.janeLap || 0, C.pink, 9); dot(i.lap || 0, C.yellow, 11);
    dash.tex.needsUpdate = true;
  }
  drawDash({ money: 0 });

  // ---------- messages ahead ----------
  const panel = canvasTexture(1024, 384);
  const panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.5625), flat(panel.tex));
  panelMesh.position.set(0, eyeY + 0.16, -2.4);
  panelMesh.renderOrder = 30; panelMesh.visible = false;
  holder.add(panelMesh);
  let panelKey = '', panelPop = 1;
  function showPanel(text = '', sub = '', { color = C.yellow, size = 0 } = {}) {
    const key = text + '|' + sub + '|' + color;
    if (key === panelKey) return;
    panelKey = key;
    panelMesh.visible = !!text;
    if (!text) return;
    const g = panel.ctx;
    g.clearRect(0, 0, panel.w, panel.h);
    const px = size || (text.length <= 3 ? 250 : text.length <= 8 ? 170 : 118);
    sticker(g, text, 512, sub ? 150 : 192, px, color, { width: px * 0.16, shadow: color === C.pink ? C.yellow : C.pink, maxWidth: 980 });
    if (sub) sticker(g, sub, 512, 318, 52, C.cream, { width: 12, weight: 600, maxWidth: 980 });
    panel.tex.needsUpdate = true;
    panelPop = 0;
  }

  // ---------- Jane's speech bubble ----------
  const bubble = canvasTexture(896, 320);
  const bubbleMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.3), flat(bubble.tex));
  bubbleMesh.position.set(0.72, eyeY - 0.02, -1.75);
  bubbleMesh.rotation.y = -0.36;
  bubbleMesh.renderOrder = 31; bubbleMesh.visible = false;
  holder.add(bubbleMesh);
  let bubbleUntil = 0, bubblePop = 1;
  function say(text, now, seconds = 3.2) {
    const g = bubble.ctx, w = bubble.w, h = bubble.h;
    g.clearRect(0, 0, w, h);
    // Bubble with a tail toward Jane's side.
    g.beginPath(); g.roundRect(14, 40, w - 28, h - 96, 54);
    g.moveTo(w - 200, h - 58); g.lineTo(w - 120, h - 8); g.lineTo(w - 130, h - 58);
    g.fillStyle = C.cream; g.fill();
    g.lineWidth = 10; g.strokeStyle = C.plum; g.lineJoin = 'round';
    g.beginPath(); g.roundRect(14, 40, w - 28, h - 96, 54); g.stroke();
    g.beginPath(); g.moveTo(w - 200, h - 60); g.lineTo(w - 120, h - 8); g.lineTo(w - 130, h - 60); g.stroke();
    g.fillStyle = C.cream; g.fillRect(w - 196, h - 70, 62, 14);
    g.save(); g.translate(120, 40); g.rotate(-0.06);
    pill(g, -86, -30, 172, 60, C.pink, C.plum, 7);
    sticker(g, 'JANE', 0, 2, 36, C.cream, { width: 5 });
    g.restore();
    // Up to two lines.
    g.font = F(600, 50); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.plum;
    const words = text.split(' '), lines = ['']; const max = w - 110;
    for (const word of words) {
      const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + word : word;
      if (g.measureText(t).width > max && lines[lines.length - 1]) lines.push(word); else lines[lines.length - 1] = t;
    }
    const lh = 60, y0 = 40 + (h - 96) / 2 - ((lines.length - 1) * lh) / 2 + 6;
    lines.slice(0, 3).forEach((l, n) => g.fillText(l, w / 2, y0 + n * lh, max));
    bubble.tex.needsUpdate = true;
    bubbleMesh.visible = true; bubbleUntil = now + seconds; bubblePop = 0;
  }

  // ---------- "+$700" pops ----------
  const pops = Array.from({ length: 5 }, () => {
    const c = canvasTexture(384, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.11), flat(c.tex));
    m.renderOrder = 32; m.visible = false;
    holder.add(m);
    return { c, m, t: 9, x: 0 };
  });
  let popNext = 0;
  function pop(text, color = C.yellow) {
    const p = pops[popNext]; popNext = (popNext + 1) % pops.length;
    const g = p.c.ctx;
    g.clearRect(0, 0, p.c.w, p.c.h);
    sticker(g, text, 192, 66, 84, color, { width: 14, maxWidth: 370 });
    p.c.tex.needsUpdate = true;
    p.t = 0; p.x = (Math.random() - 0.5) * 0.28;
    p.m.visible = true;
  }

  // ---------- results and buttons ----------
  const board = canvasTexture(1024, 640);
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9375), flat(board.tex));
  boardMesh.position.set(0, eyeY + 0.22, -2.1);
  boardMesh.renderOrder = 33; boardMesh.visible = false;
  holder.add(boardMesh);
  function drawBoard(r) {
    const g = board.ctx, w = board.w, h = board.h;
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, 70);
    g.fillStyle = 'rgba(42,16,48,.93)'; g.fill();
    g.lineWidth = 14; g.strokeStyle = C.pink; g.stroke();
    g.beginPath(); g.roundRect(30, 30, w - 60, h - 60, 54); g.lineWidth = 4; g.strokeStyle = C.yellow; g.stroke();
    sticker(g, r.title, w / 2, 112, 112, r.won ? C.yellow : C.pink, { width: 18, shadow: r.won ? C.pink : C.yellow, maxWidth: 900 });
    const rows = [['TIME', clock(r.time)], ['CASH', money(r.money)], ['BILLS', `${r.bills} of ${r.total}`], ['BEST CRISPY', 'x' + r.best]];
    rows.forEach(([k, v], n) => {
      const y = 232 + n * 76;
      g.font = F(600, 40); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,246,224,.7)'; g.fillText(k, 110, y);
      sticker(g, v, 914, y, 56, n === 1 ? (r.money >= goal ? C.mint : C.yellow) : C.cream, { align: 'right', width: 8 });
    });
    if (r.money >= goal) {
      g.save(); g.translate(250, 330); g.rotate(-0.2);
      g.lineWidth = 8; g.strokeStyle = C.mint; g.beginPath(); g.roundRect(-190, -52, 380, 104, 20); g.stroke();
      sticker(g, '$100,000 CLUB', 0, 2, 50, C.mint, { width: 8 });
      g.restore();
    }
    g.font = F(600, 36); g.textAlign = 'center'; g.fillStyle = C.cream;
    g.fillText(r.line, w / 2, 560, 880);
    board.tex.needsUpdate = true;
  }

  function makeButton(label, bg, fg, icon) {
    const c = canvasTexture(256, 256), g = c.ctx;
    g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
    g.lineWidth = 14; g.strokeStyle = C.plum; g.stroke();
    g.beginPath(); g.arc(128, 128, 98, Math.PI * 1.05, Math.PI * 1.75); g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
    g.strokeStyle = fg; g.fillStyle = fg; g.lineWidth = 13; g.lineCap = 'round'; g.lineJoin = 'round';
    if (icon === 'again') {
      g.beginPath(); g.arc(128, 104, 40, Math.PI * 0.35, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.moveTo(170, 60); g.lineTo(174, 100); g.lineTo(136, 92); g.closePath(); g.fill(); g.stroke();
    } else {
      g.beginPath(); g.moveTo(170, 104); g.lineTo(92, 104); g.stroke();
      g.beginPath(); g.moveTo(120, 72); g.lineTo(88, 104); g.lineTo(120, 136); g.stroke();
    }
    g.font = F(700, 38); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg;
    g.fillText(label, 128, 186, 190);
    c.tex.needsUpdate = true;
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.075, 40), flat(c.tex));
    mesh.renderOrder = 34; mesh.visible = false;
    holder.add(mesh);
    return { mesh, scale: 1, armed: false, inside: false };
  }
  const buttons = {
    again: makeButton('AGAIN', C.yellow, C.plum, 'again'),
    exit: makeButton(embedded ? 'JANE' : 'EXIT', C.pink, C.cream, 'back'),
  };
  buttons.again.mesh.position.set(-0.13, eyeY - 0.2, -0.43);
  buttons.exit.mesh.position.set(0.13, eyeY - 0.2, -0.43);
  for (const b of Object.values(buttons)) b.mesh.rotation.x = -0.35;
  let buttonsAt = -1;
  function showResults(r, now) {
    boardMesh.visible = !!r;
    for (const b of Object.values(buttons)) { b.mesh.visible = !!r; b.armed = false; b.inside = false; b.scale = 0.2; }
    dashMesh.visible = !r;
    if (r) { drawBoard(r); buttonsAt = now; }
  }
  const _p = new THREE.Vector3(), _c = new THREE.Vector3();
  // Fingertips or controllers (world positions) near a button press it once
  // they come in from outside. Returns 'again', 'exit' or null.
  function pressButtons(pointers, now) {
    if (!boardMesh.visible || now - buttonsAt < 0.8) return null;
    let pressed = null;
    for (const [name, b] of Object.entries(buttons)) {
      b.mesh.getWorldPosition(_c);
      let near = 9;
      for (const p of pointers) near = Math.min(near, _p.copy(p).distanceTo(_c));
      const inside = near < 0.075;
      if (!inside && near > 0.11) b.armed = true;
      if (inside && b.armed && !b.inside) pressed = name;
      b.inside = inside;
      b.hover = near < 0.16;
    }
    return pressed;
  }
  // Desktop: a click on the canvas.
  const ray = new THREE.Raycaster();
  function clickButtons(ndc) {
    if (!boardMesh.visible) return null;
    ray.setFromCamera(ndc, camera);
    for (const [name, b] of Object.entries(buttons)) if (ray.intersectObject(b.mesh).length) return name;
    return null;
  }

  // ---------- head-locked: vignette and fade ----------
  const headShader = (frag, uniforms) => new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide, uniforms,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: frag,
  });
  const vignette = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 12), headShader(
    `uniform float strength; varying vec3 vDir;
     void main() { float f = -normalize(vDir).z; gl_FragColor = vec4(0.03, 0.0, 0.06, strength * (1.0 - smoothstep(0.42, 0.8, f))); }`,
    { strength: { value: 0 } }));
  vignette.renderOrder = 100; vignette.frustumCulled = false; vignette.visible = false;
  const fade = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), headShader(
    'uniform float amount; uniform vec3 tint; void main() { gl_FragColor = vec4(tint, amount); }',
    { amount: { value: 0 }, tint: { value: new THREE.Color(0x1a0a20) } }));
  fade.renderOrder = 110; fade.frustumCulled = false; fade.visible = false;
  camera.add(vignette, fade);

  // ---------- grip hint ----------
  const hintMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false, fog: false });
  const hints = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 8, 28), hintMat); m.rotation.y = Math.PI / 2; m.renderOrder = 20; m.visible = false; return m; });

  let lastDash = -1;
  return {
    dashMesh, buttons, hints,
    attach(ski) {
      dashMesh.position.copy(ski.bar.position).add(new THREE.Vector3(0, 0.1, -0.2));
      dashMesh.rotation.x = -0.5;
      ski.body.add(dashMesh);
      ski.grips.forEach((g, i) => g.add(hints[i]));
    },
    dash(info, now) { if (now - lastDash < 0.1) return; lastDash = now; drawDash(info); },
    panel: showPanel, say, pop, results: showResults, pressButtons, clickButtons,
    gripHint(on) { for (const m of hints) m.visible = on; },
    fade(amount) { fade.material.uniforms.amount.value = amount; fade.visible = amount > 0.003; },
    vignette(strength, on) { vignette.material.uniforms.strength.value = strength; vignette.visible = on && strength > 0.02; },
    update(dt, now) {
      panelPop = Math.min(1, panelPop + dt * 5);
      const e = 1 + 0.35 * Math.sin(panelPop * Math.PI) * (1 - panelPop) + (panelPop < 1 ? -0.25 * (1 - panelPop) : 0);
      panelMesh.scale.setScalar(e);
      if (bubbleMesh.visible) {
        bubblePop = Math.min(1, bubblePop + dt * 6);
        bubbleMesh.scale.setScalar(0.7 + 0.3 * bubblePop + 0.12 * Math.sin(bubblePop * Math.PI));
        if (now > bubbleUntil) bubbleMesh.visible = false;
      }
      for (const p of pops) {
        if (!p.m.visible) continue;
        p.t += dt;
        const k = p.t / 0.95;
        if (k >= 1) { p.m.visible = false; continue; }
        p.m.position.set(p.x, eyeY - 0.3 + k * 0.34, -0.95);
        p.m.scale.setScalar(0.6 + 0.6 * Math.min(1, k * 5) - 0.2 * k);
        p.m.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      }
      for (const b of Object.values(buttons)) {
        if (!b.mesh.visible) continue;
        b.scale += ((b.hover ? 1.18 : 1) - b.scale) * Math.min(1, dt * 10);
        b.mesh.scale.setScalar(b.scale * (1 + 0.03 * Math.sin(now * 3)));
      }
      const pulse = 1 + 0.18 * Math.sin(now * 5);
      for (const m of hints) if (m.visible) m.scale.setScalar(pulse);
      hintMat.opacity = 0.6 + 0.35 * Math.sin(now * 5);
    },
  };
}
