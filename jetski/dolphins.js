// A pod of dolphins that races alongside the player on two stretches of
// the course, leaping in arcs with a splash on each entry.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

function makeDolphinGeometry() {
  // Body: a lathe along Z (nose at -Z), plus dorsal fin, flippers and flukes.
  const prof = [[0, -1.2], [0.06, -1.15], [0.09, -1.02], [0.17, -0.85], [0.24, -0.5], [0.25, -0.15], [0.21, 0.25], [0.13, 0.65], [0.06, 0.95], [0.04, 1.05]]
    .map(([r, z]) => new THREE.Vector2(r, z));
  const body = new THREE.LatheGeometry(prof, 12).rotateX(Math.PI / 2);
  body.scale(1, 0.9, 1);
  const fin = new THREE.ConeGeometry(0.12, 0.32, 4).scale(0.25, 1, 1).rotateX(0.5).translate(0, 0.3, 0.05);
  const flipL = new THREE.ConeGeometry(0.08, 0.3, 4).scale(0.3, 1, 1).rotateZ(-2.1).translate(-0.24, -0.1, -0.45);
  const flipR = flipL.clone().scale(-1, 1, 1);
  const fluke = new THREE.BoxGeometry(0.55, 0.03, 0.18).translate(0, 0, 1.1);
  const parts = [body, fin, flipL, flipR, fluke].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; });
  const merged = mergeGeometries(parts);
  // Two-tone: grey back, pale belly.
  const p = merged.attributes.position, cols = [];
  const back = new THREE.Color(0x56677a), belly = new THREE.Color(0xd8dde2), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(p.getY(i), -0.08, 0.08)); cols.push(c.r, c.g, c.b); }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  merged.computeVertexNormals();
  return merged;
}

export function createDolphins({ scene, track, ocean, sfx }) {
  const geo = makeDolphinGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pod = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    pod.push({ m, lat: (i % 2 ? 1 : -1) * (7 + i * 2.2), lead: 6 + i * 4, phase: i * 0.7, wasUp: false });
  }
  const windows = [[0.09, 0.2], [0.66, 0.8]]; // track fractions where the pod shows up
  const tmp = new THREE.Vector3();

  function update(dt, t, player, playerU) {
    const on = windows.some(([a, b]) => playerU > a && playerU < b);
    for (const d of pod) {
      if (!on) { d.m.visible = false; continue; }
      const u = playerU + (d.lead + Math.sin(t * 0.3 + d.phase) * 3) / track.length;
      const { p, t: tan, r } = track.at(u);
      const x = p.x + r.x * d.lat, z = p.z + r.z * d.lat;
      const water = ocean.heightAt(x, z, t);
      // Leap cycle: 2.4 s, airborne for the middle 0.9 s.
      const cyc = ((t + d.phase) % 2.4) / 2.4;
      const air = THREE.MathUtils.clamp((cyc - 0.3) / 0.38, 0, 1);
      const up = air > 0 && air < 1;
      const y = water + (up ? Math.sin(air * Math.PI) * 1.7 : -0.9);
      d.m.visible = true;
      d.m.position.set(x, y, z);
      d.m.rotation.set(up ? (0.5 - air) * 1.6 : 0, Math.atan2(-tan.x, -tan.z), 0, 'YXZ');
      if (d.wasUp && !up) { tmp.set(x, water, z); sfx.splash(1.2, tmp); }
      d.wasUp = up;
    }
  }

  return { update };
}
