// The gulls and the money. A flock of Ilia's rigged seagull flies ahead of
// the player along the racing line and drops $100 bills (Ilia's twisted bill
// mesh, drawn large) that flutter down and hover over the water. The trail
// of bills is the way round the course: ride through them to pick them up
// (a bill that is close enough flies into your hands).
// Every bill in a row is worth $250 more than the last, up to $2,500
// ("Crispy x10"). A missed bill takes one step off the combo and a wall hit
// three. A golden bill hangs in the air over each ramp: $10,000 and a
// boost. The song's $100,000 is meant to come "with ease": a first lap that
// takes a bit over half of the bills gets there, a clean one triples it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { GullVoice } from '../audio.js';

const asset = (path) => new URL(path, import.meta.url).href;
export const MAX_COMBO = 10;
export const STEP_VALUE = 250;   // each step of the combo adds this to a bill
export const GOLD_VALUE = 10000;
const FLOCK = 5;
const LEAD = 62;          // how far ahead of the player the flock flies, metres
const BILL_W = 0.95;      // drawn width of a bill, metres
// A bill this close to the jetski flies to the rider, metres. The reach is
// longer while the combo is low, so the money comes to a rider who is
// struggling, and tightens as the combo climbs.
const PICK = 3.4, PICK_HELP = 1.6;
const SPACING = 10;       // between bills in a run, metres

function makeBillTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 436;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 436);
  grad.addColorStop(0, '#d6ebc6'); grad.addColorStop(0.5, '#bfe0b0'); grad.addColorStop(1, '#d3e6be');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 436);
  g.strokeStyle = '#2f6b45'; g.lineWidth = 22; g.strokeRect(14, 14, 996, 408);
  g.lineWidth = 5; g.strokeRect(46, 46, 932, 344);
  g.fillStyle = '#eef0d8'; g.beginPath(); g.ellipse(512, 218, 124, 152, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2f6b45'; g.lineWidth = 7; g.stroke();
  g.fillStyle = '#2f6b45';
  g.font = 'bold 170px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('$', 512, 224);
  g.font = 'bold 104px Georgia, serif';
  g.fillText('100', 158, 118); g.fillText('100', 866, 322);
  g.font = 'bold 76px Georgia, serif'; g.fillStyle = '#c9a646';
  g.fillText('100', 870, 114);
  g.fillStyle = '#2f6b45'; g.font = 'bold 36px Georgia, serif';
  g.fillText('ONE HUNDRED', 512, 394);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

let assets = null;
export async function loadGullAssets() {
  const loader = new GLTFLoader();
  const [gull, bill] = await Promise.all([
    loader.loadAsync(asset('../assets/seagull/seagull.glb')),
    loader.loadAsync(asset('../assets/seagull/bill.glb')),
  ]);
  let billMesh = null;
  bill.scene.traverse((o) => { if (o.isMesh && !billMesh) billMesh = o; });
  assets = { gull, billMesh };
  return assets;
}

export function createGulls({ scene, world, ocean, listener, onPickup = () => {}, onMiss = () => {} }) {
  const course = world.course, { SAMPLES, pts, tans, rights, lineLat, step, length } = course;
  const wrapI = (i) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
  const idxAt = (dist) => wrapI(Math.round(dist / step));

  // ---------- the bills ----------
  // Runs of bills along the racing line, with gaps between runs.
  const bills = [];
  const rampDist = world.ramps.map((r) => r.idx * step);
  {
    let run = 0;
    for (let d = 34; d < length - 26; d += SPACING) {
      const nearRamp = rampDist.some((r) => d > r - 9 && d < r + 30);
      run++;
      if (nearRamp || run % 9 >= 7) continue;
      const i = idxAt(d);
      bills.push({
        d, idx: i, x: pts[i].x + rights[i].x * lineLat[i], z: pts[i].z + rights[i].z * lineLat[i], h: 1.15,
        yaw: Math.atan2(-tans[i].x, -tans[i].z), gold: false, state: 0, t: 0, ph: (d * 0.37) % 6.28, from: new THREE.Vector3(), pos: new THREE.Vector3(),
      });
    }
    // Golden bills: up where a good jump carries you.
    for (const r of world.ramps) {
      const d = r.idx * step + 12, i = idxAt(d);
      bills.push({ d, idx: i, x: pts[i].x, z: pts[i].z, h: 3.7, yaw: Math.atan2(-tans[i].x, -tans[i].z), gold: true, state: 0, t: 0, ph: d % 6.28, from: new THREE.Vector3(), pos: new THREE.Vector3() });
    }
    bills.sort((a, b) => a.d - b.d);
  }
  const total = bills.length;

  const billGeo = assets.billMesh.geometry;
  const k = BILL_W / 773.66;
  // The mesh as the opening places it: scaled, centred on its twist.
  const billBase = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -8.54 * k), assets.billMesh.quaternion.clone(), new THREE.Vector3(k, k, k));
  const billTex = makeBillTexture();
  const MAXI = 40;
  const billMesh = new THREE.InstancedMesh(billGeo, new THREE.MeshBasicMaterial({ map: billTex, side: THREE.DoubleSide, toneMapped: false }), MAXI);
  const goldMesh = new THREE.InstancedMesh(billGeo, new THREE.MeshBasicMaterial({ map: billTex, color: 0xffd23f, side: THREE.DoubleSide, toneMapped: false }), 6);
  for (const m of [billMesh, goldMesh]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
  // A soft glow behind each bill so the trail reads from far away.
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,235,150,.55)'); grad.addColorStop(1, 'rgba(255,210,63,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const glowGeo = new THREE.BufferGeometry();
  const glowPos = new Float32Array((MAXI + 6) * 3), glowSize = new Float32Array(MAXI + 6);
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3).setUsage(THREE.DynamicDrawUsage));
  glowGeo.setAttribute('size', new THREE.BufferAttribute(glowSize, 1).setUsage(THREE.DynamicDrawUsage));
  const glow = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: glowTex } },
    vertexShader: 'attribute float size; void main() { vec4 mv = viewMatrix * vec4(position, 1.0); gl_PointSize = min(70.0, 420.0 * size / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; void main() { gl_FragColor = texture2D(map, gl_PointCoord) * vec4(1.0, 0.86, 0.45, 0.42); }',
  }));
  glow.frustumCulled = false;
  scene.add(glow);

  // ---------- the flock ----------
  const flock = [];
  for (let i = 0; i < FLOCK; i++) {
    const model = cloneSkinned(assets.gull.scene);
    model.scale.setScalar(2.1);
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    const holder = new THREE.Group();
    holder.add(model);
    scene.add(holder);
    const mixer = new THREE.AnimationMixer(model);
    const fly = mixer.clipAction(THREE.AnimationClip.findByName(assets.gull.animations, 'fly'));
    const glide = mixer.clipAction(THREE.AnimationClip.findByName(assets.gull.animations, 'glide'));
    fly.play(); glide.play();
    fly.timeScale = 0.85 + (i % 3) * 0.08;
    mixer.setTime(i * 0.13);
    flock.push({
      holder, model, mixer, fly, glide, flap: 1, mood: i * 1.7, dip: 0,
      off: { along: -i * 6 + (i % 2) * 3, lat: (i - (FLOCK - 1) / 2) * 3.2, up: 9 + (i * 1.9) % 4 },
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), voice: null,
    });
  }
  // Two of them have a voice (calls and wing beats carry over the water).
  for (const gI of [0, 3]) {
    try {
      const v = new GullVoice(listener, flock[gI].holder);
      v.audio.setRefDistance(16); v.audio.setRolloffFactor(1);
      flock[gI].voice = v;
    } catch { /* no audio */ }
  }

  const state = { money: 0, combo: 0, best: 0, taken: 0, total, lead: 0, first: 0 };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _t = new THREE.Vector3(), _look = new THREE.Vector3();
  const archDist = world.arches.map((a) => a.idx * step);

  function hoverPos(b, t, out) {
    return out.set(b.x, ocean.heightAt(b.x, b.z, t) * 0.5 + b.h + Math.sin(t * 2.1 + b.ph) * 0.07, b.z);
  }

  function reset(t = 0) {
    Object.assign(state, { money: 0, combo: 0, best: 0, taken: 0, lead: 20, first: 0 });
    for (const b of bills) { b.state = 0; b.t = 0; }
    // The first stretch is already laid out when you sit down.
    for (const b of bills) if (b.d < 95) b.state = 2;
    flock.forEach((g, i) => {
      const p = target(g, state.lead, t, _p);
      g.pos.copy(p); g.vel.set(0, 0, 0);
      g.holder.position.copy(p);
    });
  }

  // Where a gull wants to be: its place in the formation around the lead point.
  function target(g, lead, t, out) {
    const d = lead + g.off.along, i = idxAt(d);
    let up = g.off.up + Math.sin(t * 0.7 + g.mood) * 1.2;
    for (const a of archDist) if (Math.abs(d - a) < 26) up = Math.min(up, 6.2);
    const lat = lineLat[i] + g.off.lat * (course.walled[i] ? 0.45 : 1) + Math.sin(t * 0.45 + g.mood * 2) * 1.5;
    return out.set(pts[i].x + rights[i].x * lat, up - g.dip, pts[i].z + rights[i].z * lat);
  }

  // dist: the player's distance along the lap in metres; active: racing.
  function update(dt, t, player, dist, active, hands = []) {
    // The flock keeps its lead, and never comes back.
    const want = Math.min(length + 30, dist + LEAD);
    if (active) state.lead = Math.max(state.lead, Math.min(want, state.lead + Math.max(34, player.speed * 1.5) * dt));
    const circling = !active || state.lead >= length + 29;

    for (const g of flock) {
      target(g, state.lead, t, _t);
      if (circling) {
        // Wheel around over the same spot.
        const a = t * 0.5 + g.mood, r = 9 + (g.mood % 3) * 2.5;
        _t.x += Math.cos(a) * r; _t.z += Math.sin(a) * r; _t.y += 2;
      }
      // Spring toward the target, so they bank and swoop rather than slide.
      g.vel.x += ((_t.x - g.pos.x) * 3.2 - g.vel.x * 3.0) * dt;
      g.vel.y += ((_t.y - g.pos.y) * 4.0 - g.vel.y * 3.4) * dt;
      g.vel.z += ((_t.z - g.pos.z) * 3.2 - g.vel.z * 3.0) * dt;
      g.pos.addScaledVector(g.vel, dt);
      g.dip = Math.max(0, g.dip - dt * 3);
      g.holder.position.copy(g.pos);
      const sp = Math.hypot(g.vel.x, g.vel.z);
      if (sp > 0.5) {
        _look.set(g.pos.x + g.vel.x, g.pos.y + g.vel.y * 0.5, g.pos.z + g.vel.z);
        g.holder.lookAt(_look);
      }
      // Flap to climb and to keep up, glide in between.
      const wantFlap = g.vel.y > 0.4 || sp < 9 || Math.sin(t * 0.8 + g.mood * 1.3) > 0.1 ? 1 : 0.12;
      g.flap += (wantFlap - g.flap) * Math.min(1, dt * 3);
      g.fly.setEffectiveWeight(g.flap); g.glide.setEffectiveWeight(1 - g.flap);
      g.mixer.update(dt);
      if (g.voice && Math.random() < dt * 0.22) g.voice.call(Math.random() < 0.5 ? 0 : 1);
    }

    // Drop the bills the flock passes over.
    for (let n = state.first; n < bills.length; n++) {
      const b = bills[n];
      if (b.d > state.lead + 4) break;
      if (b.state !== 0) continue;
      let best = flock[0], bd = Infinity;
      for (const g of flock) { const d = (g.pos.x - b.x) ** 2 + (g.pos.z - b.z) ** 2; if (d < bd) { bd = d; best = g; } }
      b.state = 1; b.t = 0; b.from.copy(best.pos).y -= 0.4;
      best.dip = 1.2;
      if (best.voice && Math.random() < 0.5) best.voice.call(1);
    }

    // Move, draw and collect the bills near the player.
    let nb = 0, ng = 0, np = 0;
    while (state.first < bills.length && bills[state.first].d < dist - 14 && bills[state.first].state >= 3) state.first++;
    for (let n = state.first; n < bills.length; n++) {
      const b = bills[n];
      if (b.d > dist + 190) break;
      if (b.state === 0) continue;
      b.t += dt;
      let scale = b.gold ? 1.7 : 1, spin = 0, tilt = Math.sin(t * 1.3 + b.ph) * 0.16;
      if (b.state === 1) {
        // Flutter down from the gull: swing side to side, tumbling, then settle.
        const kf = Math.min(1, b.t / 1.5), e = kf * kf * (3 - 2 * kf);
        hoverPos(b, t, _p);
        b.pos.lerpVectors(b.from, _p, e);
        const sway = Math.sin(b.t * 6 + b.ph) * (1 - e) * 1.2;
        b.pos.x += Math.cos(b.yaw) * sway; b.pos.z -= Math.sin(b.yaw) * sway;
        spin = (1 - e) * (b.t * 7); tilt += (1 - e) * Math.sin(b.t * 9) * 0.9;
        if (kf >= 1) b.state = 2;
      } else if (b.state === 2) {
        hoverPos(b, t, b.pos);
        spin = Math.sin(t * 0.9 + b.ph) * 0.5;
        const dx = player.x - b.x, dz = player.z - b.z;
        const reach = PICK + PICK_HELP * (1 - state.combo / MAX_COMBO);
        let got = dx * dx + dz * dz < reach * reach && Math.abs(b.pos.y - (player.y + 1.1)) < (b.gold ? 2.2 : 1.9);
        // A free hand can snatch a bill too.
        if (!got) for (const h of hands) if (h.distanceToSquared(b.pos) < 0.3) { got = true; break; }
        if (got && active) {
          b.state = 3; b.t = 0; b.from.copy(b.pos);
          state.taken++;
          state.combo = Math.min(MAX_COMBO, state.combo + 1);
          state.best = Math.max(state.best, state.combo);
          const value = b.gold ? GOLD_VALUE : STEP_VALUE * state.combo;
          state.money += value;
          onPickup(b, value);
        } else if (active && dist > b.d + 8) {
          b.state = 4; b.t = 0;
          if (!b.gold) { state.combo = Math.max(0, state.combo - 1); onMiss(b); }
        }
      }
      if (b.state === 3) {
        // Taken: it flies to the rider's chest, spinning, and is gone.
        const kf = b.t / 0.2;
        if (kf >= 1) continue;
        _p.set(player.x - Math.sin(player.yaw) * 0.5, player.y + 1.15, player.z - Math.cos(player.yaw) * 0.5);
        b.pos.lerpVectors(b.from, _p, kf);
        scale *= 1 - 0.75 * kf; spin = b.t * 30;
      } else if (b.state === 4) {
        const kf = b.t / 0.8;
        if (kf >= 1) continue;
        hoverPos(b, t, b.pos); b.pos.y += kf * 1.5; scale *= 1 - kf;
      }
      _q.setFromEuler(_e.set(tilt * 0.6, b.yaw + Math.PI + spin, tilt, 'YXZ'));
      _m.compose(b.pos, _q, _s.setScalar(scale)).multiply(billBase);
      if (b.gold) { if (ng < 6) goldMesh.setMatrixAt(ng++, _m); }
      else if (nb < MAXI) billMesh.setMatrixAt(nb++, _m);
      if (np < MAXI + 6 && b.state <= 2) { glowPos[np * 3] = b.pos.x; glowPos[np * 3 + 1] = b.pos.y; glowPos[np * 3 + 2] = b.pos.z; glowSize[np] = b.gold ? 2.6 : 1.5; np++; }
    }
    billMesh.count = nb; goldMesh.count = ng;
    billMesh.instanceMatrix.needsUpdate = true; goldMesh.instanceMatrix.needsUpdate = true;
    glowGeo.setDrawRange(0, np);
    glowGeo.attributes.position.needsUpdate = true; glowGeo.attributes.size.needsUpdate = true;
  }

  // A wall hit shakes some of the combo out.
  function knock() { state.combo = Math.max(0, state.combo - 3); }

  return { state, bills, flock, reset, update, knock, setVolume(v) { for (const g of flock) if (g.voice) g.voice.setLevel(v, 0.3); } };
}
