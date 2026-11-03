// Seagulls fly ahead of the player and drop $100 bills that flutter down
// toward the left of the seat, where the free hand can catch them. Each
// three bills caught bring another gull, up to eight.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { GullVoice } from '../audio.js';

const MAX_BILLS = 40;
const FALL_SPEED = 2.3;     // m/s
const CATCH_RADIUS = 0.3;   // m around the palm

function makeBillTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 218;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 218);
  grad.addColorStop(0, '#d9e3cf'); grad.addColorStop(0.5, '#c4d6b8'); grad.addColorStop(1, '#d5dcc4');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 218);
  g.strokeStyle = '#3f6b4a'; g.lineWidth = 7; g.strokeRect(9, 9, 494, 200);
  g.lineWidth = 2; g.strokeRect(20, 20, 472, 178);
  g.fillStyle = '#e9e2cf'; g.beginPath(); g.ellipse(256, 109, 60, 75, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3f6b4a'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#3f6b4a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 75px Georgia, serif'; g.fillText('$', 256, 111);
  g.font = 'bold 46px Georgia, serif'; g.fillText('100', 70, 55); g.fillText('100', 442, 165);
  g.font = 'bold 35px Georgia, serif'; g.fillStyle = '#c9a646'; g.fillText('100', 442, 55);
  g.fillStyle = '#3f6b4a'; g.font = 'bold 17px Georgia, serif'; g.fillText('ONE HUNDRED', 256, 197);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Gull built facing -Z (forward), 1.6x life size so it reads from the water.
function makeGull(mats) {
  const parts = [];
  const add = (geo, m) => { geo.applyMatrix4(m); geo.deleteAttribute('uv'); parts.push(geo); };
  const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));
  add(new THREE.SphereGeometry(1, 12, 8), M(0, 0, 0, 0.12, 0.1, 0.3));
  add(new THREE.SphereGeometry(0.085, 10, 8), M(0, 0.07, -0.26));
  add(new THREE.BoxGeometry(0.15, 0.02, 0.15), M(0, 0.02, 0.32));
  const body = new THREE.Mesh(mergeGeometries(parts), mats.white);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.12, 6).rotateX(-Math.PI / 2).translate(0, 0.06, -0.39), mats.orange);
  const g = new THREE.Group();
  g.add(body, beak);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.09 * s, 0.05, -0.02);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.21).translate(0.21 * s, 0, 0), mats.grey);
    pivot.add(inner);
    const outer = new THREE.Group();
    outer.position.x = 0.42 * s;
    outer.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.016, 0.16).translate(0.16 * s, 0, 0.01), mats.grey));
    outer.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.14).translate(0.27 * s, 0, 0.01), mats.dark));
    pivot.add(outer);
    g.add(pivot);
    wings.push({ pivot, outer, s });
  }
  g.userData.wings = wings;
  return g;
}

export function createGulls({ scene, listener, sfx, ocean }) {
  const mats = {
    white: new THREE.MeshLambertMaterial({ color: 0xf4f2ee }),
    grey: new THREE.MeshLambertMaterial({ color: 0xa8aeb8 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x25272b }),
    orange: new THREE.MeshLambertMaterial({ color: 0xf0a020 }),
  };
  const gulls = [];
  const voices = [];

  // Bills: one instanced mesh.
  const billGeo = new THREE.PlaneGeometry(0.25, 0.107, 8, 1);
  {
    const p = billGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.014 * Math.sin((p.getX(i) / 0.25) * Math.PI));
    billGeo.computeVertexNormals();
  }
  const billMesh = new THREE.InstancedMesh(billGeo, new THREE.MeshLambertMaterial({ map: makeBillTexture(), side: THREE.DoubleSide }), MAX_BILLS);
  billMesh.frustumCulled = false;
  billMesh.count = 0;
  scene.add(billMesh);
  const bills = [];

  // "+$100" pop-ups.
  const pops = [];
  {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
    const g = cv.getContext('2d');
    g.font = '800 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#1d3a26'; g.strokeText('+$100', 128, 50);
    g.fillStyle = '#9cff9c'; g.fillText('+$100', 128, 50);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
      s.scale.set(0.24, 0.09, 1);
      s.renderOrder = 30;
      s.visible = false;
      scene.add(s);
      pops.push({ s, age: 9 });
    }
  }
  let popNext = 0;

  const state = { caught: 0, onCatch: null };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3();

  function ensureGulls(n, player) {
    while (gulls.length < n) {
      const g = makeGull(mats);
      const i = gulls.length;
      // Enter from far ahead and high up.
      g.position.set(player.x - Math.sin(player.yaw) * 120 + (Math.random() - 0.5) * 60, 30, player.z - Math.cos(player.yaw) * 120);
      scene.add(g);
      gulls.push({
        obj: g, vel: new THREE.Vector3(), phase: Math.random() * 10,
        ahead: 35 + Math.random() * 35, side: (Math.random() - 0.5) * 22, height: 8 + Math.random() * 5,
        nextDrop: 2.5 + Math.random() * 4 + i * 0.8, callAt: 2 + Math.random() * 6, carrying: false,
      });
      if (voices.length < 2) {
        const v = new GullVoice(listener, g);
        v.audio.setRefDistance(7);
        voices.push(v);
      }
    }
  }

  function dropBill(gull, player, t) {
    if (bills.length >= MAX_BILLS) return;
    const p = gull.obj.position;
    const catchY = player.y + 1.1;
    const T = Math.max(1.2, (p.y - catchY) / FALL_SPEED);
    // Aim at the left of the seat where the player will be after T.
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), lx = -Math.cos(player.yaw), lz = Math.sin(player.yaw);
    const travel = Math.max(0, player.fwdSpeed) * T;
    const target = new THREE.Vector3(player.x + fx * travel + lx * 0.5, catchY, player.z + fz * travel + lz * 0.5);
    bills.push({
      start: p.clone().add(new THREE.Vector3(0, -0.15, 0)), target, T, age: 0, state: 'fall',
      spin: (Math.random() - 0.5) * 6, wob: Math.random() * 10, pos: p.clone(), rot: new THREE.Euler(), floatAge: 0,
    });
    if (voices.length && Math.random() < 0.5) voices[Math.floor(Math.random() * voices.length)].call(Math.floor(Math.random() * 2));
  }

  function update(dt, t, player, catchers, active) {
    const want = active ? Math.min(8, 2 + Math.floor(state.caught / 3)) : 2;
    ensureGulls(want, player);
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const lx = -rx, lz = -rz;

    // The gull due to drop next flies to where its bill will meet the player.
    let dropper = null;
    for (const g of gulls) if (!dropper || g.nextDrop < dropper.nextDrop) dropper = g;
    const fallT = 11 / FALL_SPEED;

    for (const g of gulls) {
      g.nextDrop -= dt;
      const isDropper = g === dropper && active;
      const ahead = isDropper ? THREE.MathUtils.clamp(Math.max(0, player.fwdSpeed) * fallT, 12, 90) : g.ahead + Math.sin(t * 0.2 + g.phase) * 8;
      const side = isDropper ? -1.5 : g.side + Math.sin(t * 0.33 + g.phase) * 5;
      const height = isDropper ? 11.5 + player.y : g.height + Math.sin(t * 0.5 + g.phase) * 1.5;
      _v.set(player.x + fx * ahead + rx * side, height, player.z + fz * ahead + rz * side);
      const o = g.obj;
      // Steer toward the slot with a cruise speed above the player's.
      const desired = _v.sub(o.position);
      const dist = desired.length();
      const maxV = Math.max(10, Math.abs(player.fwdSpeed) + 9);
      desired.multiplyScalar(Math.min(maxV, dist * 1.2) / Math.max(0.001, dist));
      g.vel.lerp(desired, Math.min(1, dt * 1.6));
      o.position.addScaledVector(g.vel, dt);
      // Face along the flight, banking into turns.
      const sp = Math.hypot(g.vel.x, g.vel.z);
      if (sp > 0.5) {
        const yaw = Math.atan2(-g.vel.x, -g.vel.z);
        let dy = yaw - o.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        o.rotation.set(THREE.MathUtils.clamp(g.vel.y * 0.05, -0.4, 0.4), o.rotation.y + dy * Math.min(1, dt * 3), -dy * 0.8, 'YXZ');
      }
      // Flap when climbing or catching up, glide otherwise.
      const effort = THREE.MathUtils.clamp(0.25 + g.vel.y * 0.15 + (dist > 15 ? 0.5 : 0), 0, 1);
      g.phase += dt * (6 + 4 * effort);
      for (const w of o.userData.wings) {
        const a = Math.sin(g.phase) * 0.7 * effort + 0.12;
        w.pivot.rotation.z = w.s * a;
        w.outer.rotation.z = w.s * a * 0.7;
      }
      g.callAt -= dt;
      if (g.callAt < 0) { g.callAt = 4 + Math.random() * 7; const v = voices.find((vv) => vv.audio.parent === o); if (v) v.call(Math.floor(Math.random() * 2)); }
      if (active && isDropper && g.nextDrop <= 0) {
        const rel = (o.position.x - player.x) * fx + (o.position.z - player.z) * fz;
        if (rel > 8 && Math.abs(rel - ahead) < 15) {
          dropBill(g, player, t);
          g.nextDrop = Math.max(1.8, 6 - state.caught * 0.15) * (0.7 + Math.random() * 0.6) / Math.max(1, gulls.length * 0.5);
        }
      }
    }

    // Bills.
    for (let i = bills.length - 1; i >= 0; i--) {
      const b = bills[i];
      b.age += dt;
      if (b.state === 'fall') {
        const s = Math.min(1, b.age / b.T);
        // Keep aiming at where the player's left hand will be when it arrives.
        const rem = Math.max(0, b.T - b.age);
        b.target.set(player.x + (player.vx || 0) * rem + lx * 0.5, player.y + 1.1, player.z + (player.vz || 0) * rem + lz * 0.5);
        const e = s * s * (3 - 2 * s);
        b.pos.lerpVectors(b.start, b.target, e);
        b.pos.y = b.start.y + (b.target.y - b.start.y) * s;
        b.pos.x += Math.sin(b.age * 2.3 + b.wob) * 0.25 * (1 - s * 0.7);
        b.pos.z += Math.cos(b.age * 1.7 + b.wob) * 0.2 * (1 - s * 0.7);
        b.rot.set(Math.sin(b.age * 3 + b.wob) * 0.9, b.age * b.spin, Math.sin(b.age * 2.2) * 0.6);
        // Catch?
        let caught = false;
        for (const c of catchers) if (c && b.pos.distanceTo(c.pos) < (c.radius || CATCH_RADIUS)) { caught = true; break; }
        if (caught) {
          bills.splice(i, 1);
          state.caught++;
          sfx.cash();
          const pop = pops[popNext++ % pops.length];
          pop.s.position.copy(b.pos); pop.age = 0; pop.s.visible = true;
          state.onCatch && state.onCatch(state.caught);
          continue;
        }
        const water = ocean.heightAt(b.pos.x, b.pos.z, t);
        if (b.pos.y <= water + 0.02 || s >= 1 && b.age > b.T + 2.5) b.state = 'float';
        if (s >= 1) b.pos.y -= (b.age - b.T) * FALL_SPEED * dt * 4;
      } else {
        b.floatAge += dt;
        b.pos.y = ocean.heightAt(b.pos.x, b.pos.z, t) + 0.02 - Math.max(0, b.floatAge - 2.5) * 0.3;
        b.rot.set(-Math.PI / 2, b.rot.y, 0);
        if (b.floatAge > 4) { bills.splice(i, 1); continue; }
      }
    }
    billMesh.count = bills.length;
    for (let i = 0; i < bills.length; i++) {
      const b = bills[i];
      _m.compose(b.pos, _q.setFromEuler(b.rot), _s);
      billMesh.setMatrixAt(i, _m);
    }
    billMesh.instanceMatrix.needsUpdate = true;

    for (const p of pops) {
      if (!p.s.visible) continue;
      p.age += dt;
      p.s.position.y += dt * 0.35;
      p.s.material.opacity = Math.max(0, 1 - p.age / 1.1);
      if (p.age > 1.1) p.s.visible = false;
    }
  }

  function reset() {
    state.caught = 0;
    bills.length = 0;
    billMesh.count = 0;
  }

  return { update, reset, state, gulls, bills };
}
