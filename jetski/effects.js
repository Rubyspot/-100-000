// Effects around the jetskis: a foam wake ribbon, spray (sheets off the bow,
// the rooster tail behind the jet, curtains in hard turns, landing bursts,
// drops and mist), speed streaks and pink and yellow confetti for pick-ups
// and the finish.
import * as THREE from 'three';

export function createWake(scene, ocean) {
  const N = 60;
  const pts = Array.from({ length: N }, () => ({ x: 0, z: 0, age: 99, rx: 1, rz: 0, v: 0, spread: 1 }));
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3);
  const uv = new Float32Array(N * 2 * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { time: { value: 0 }, detailMap: { value: ocean.detail }, foamColor: { value: new THREE.Color(0xf4fbff) }, sunColor: ocean.uniforms.sunColor },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec2 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform sampler2D detailMap; uniform vec3 foamColor; uniform vec3 sunColor;
      varying vec2 vUv; varying vec2 vW;
      void main() {
        float across = abs(vUv.x * 2.0 - 1.0);
        float n = texture2D(detailMap, vW / 5.0 + time * 0.01).b * 0.7 + texture2D(detailMap, vW / 1.9 - time * 0.02).b * 0.6;
        // Churned water down the middle, two thin lines at the outer edges.
        float centre = (1.0 - smoothstep(0.0, 0.45, across)) * (0.35 + n);
        float lines = exp(-pow((across - 0.85) / 0.08, 2.0)) * (0.3 + n);
        float a = clamp((centre * 0.75 + lines * 0.6) * vUv.y, 0.0, 1.0);
        gl_FragColor = vec4(foamColor * (0.55 + 0.45 * sunColor), a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let acc = 0, fresh = true;
  const baseFoam = mat.uniforms.foamColor.value.clone(), gold = new THREE.Color(0xff8fc6);
  return {
    reset() { fresh = true; },
    // 0..1: tint the wake gold (boost).
    setTint(k) { mat.uniforms.foamColor.value.copy(baseFoam).lerp(gold, k * 0.75); },
    // wet: 0..1, how much of the hull is in the water
    update(dt, t, x, z, yaw, speed, wet) {
      if (fresh) {
        fresh = false;
        for (const p of pts) { p.x = x; p.z = z; p.age = 99; p.v = 0; }
      }
      acc += dt;
      if (acc > 0.09) {
        acc = 0;
        const p = pts.pop();
        p.x = x + Math.sin(yaw) * 1.2; p.z = z + Math.cos(yaw) * 1.2;
        p.rx = Math.cos(yaw); p.rz = -Math.sin(yaw);
        p.age = 0; p.v = Math.min(1, speed / 9) * (wet > 0 ? 1 : 0); p.spread = 0.5 + speed * 0.3;
        pts.unshift(p);
      }
      // The newest point rides with the stern, so the wake starts under the
      // hull and never a step behind it.
      const head = pts[0];
      head.x = x + Math.sin(yaw) * 1.2; head.z = z + Math.cos(yaw) * 1.2;
      head.rx = Math.cos(yaw); head.rz = -Math.sin(yaw); head.age = 0;
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        p.age += dt;
        const life = Math.max(0, 1 - p.age / 5.5) * p.v;
        const half = 0.45 + p.age * p.spread;
        const y = ocean.heightAt(p.x, p.z, t) + 0.05;
        pos[i * 6] = p.x - p.rx * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = p.z - p.rz * half;
        pos[i * 6 + 3] = p.x + p.rx * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = p.z + p.rz * half;
        uv[i * 4] = 0; uv[i * 4 + 1] = life; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = life;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.uv.needsUpdate = true;
      mat.uniforms.time.value = t;
    },
  };
}

// Spray off the jetskis: droplets that fly and fall back into the sea, and
// mist that hangs, spreads and fades. Sheets peel off both sides of the bow
// at speed, the jet throws a rooster tail, the outside of a hard turn throws
// a curtain, and landings burst. Mist glows when the sun is behind it.
// view() each frame gives the eye's position and the height of its picture
// in pixels, so a drop is the right size on any screen and in the headset.
export function createSpray(scene, sunColor, sunDir) {
  const N = 1100;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const size = new Float32Array(N);
  const kind = new Float32Array(N);    // 0 a drop, 1 mist
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('kind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
  const vel = new Float32Array(N * 3), fade = new Float32Array(N), grow = new Float32Array(N), floor = new Float32Array(N);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { sunColor: { value: sunColor }, sunDir: { value: sunDir || new THREE.Vector3(0, 1, 0) }, camPos: { value: new THREE.Vector3() }, halfH: { value: 400 } },
    vertexShader: /* glsl */`
      attribute float life; attribute float size; attribute float kind;
      uniform vec3 camPos; uniform vec3 sunDir; uniform float halfH;
      varying float vA; varying float vKind; varying float vSun;
      void main() {
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float d = max(0.1, -mv.z);
        gl_PointSize = min(240.0, projectionMatrix[1][1] * halfH * size / d);
        gl_Position = projectionMatrix * mv;
        vKind = kind;
        // Mist right at the eyes would fill the view: it thins out within a metre or two.
        vA = pow(life, 0.6) * (kind > 0.5 ? 0.55 : 0.95) * smoothstep(0.6, 1.8, d);
        vSun = pow(max(dot(normalize(position - camPos), sunDir), 0.0), 6.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunColor; varying float vA; varying float vKind; varying float vSun;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c);
        float a = (vKind > 0.5 ? exp(-r2 * 9.0) * (1.0 - smoothstep(0.15, 0.25, r2)) : 1.0 - smoothstep(0.06, 0.25, r2)) * vA;
        if (a < 0.006) discard;
        vec3 col = vec3(0.86, 0.88, 0.92) * (0.55 + 0.5 * sunColor) + sunColor * vSun * (vKind > 0.5 ? 1.5 : 0.7);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  const R = Math.random;
  // A drop (mist = false) or a puff of mist.
  const emit = (x, y, z, vx, vy, vz, s, mist, water) => {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    life[i] = 1; size[i] = s; kind[i] = mist ? 1 : 0;
    fade[i] = mist ? 0.55 + R() * 0.35 : 0.75 + R() * 0.4;
    grow[i] = mist ? s * (1.1 + R()) : 0;
    floor[i] = water - 0.25;
  };
  const acc = new Map();
  return {
    view(camPos, pixelsHigh) { mat.uniforms.camPos.value.copy(camPos); mat.uniforms.halfH.value = pixelsHigh / 2; },
    // A jetski's spray. key keeps each one's emitters apart.
    emitCraft(key, dt, c, waterY) {
      if (c.airborne || c.wet === 0) return;
      let st = acc.get(key);
      if (!st) acc.set(key, st = { bow: 0, tail: 0, turn: 0 });
      const speed = Math.abs(c.fwdSpeed);
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      // Bow sheets, both sides, from a walking pace up.
      st.bow += dt * (speed > 4 ? (speed - 4) * 9 : 0);
      while (st.bow >= 1) {
        st.bow -= 1;
        const side = R() < 0.5 ? -1 : 1, back = R() * 0.9, mist = R() < 0.25;
        const out = 1.4 + speed * 0.11 + R() * 1.6, up = 0.9 + speed * 0.07 + R() * 1.5;
        emit(c.x + fx * (0.9 - back) + rx * side * 0.52, waterY + 0.05, c.z + fz * (0.9 - back) + rz * side * 0.52,
          rx * side * out + c.vx * 0.55, up, rz * side * out + c.vz * 0.55, mist ? 0.35 + R() * 0.3 : 0.05 + R() * 0.05, mist, waterY);
      }
      // The rooster tail: the jet's plume behind, as tall as the throttle.
      st.tail += dt * c.rpm * (14 + speed * 3);
      while (st.tail >= 1) {
        st.tail -= 1;
        const mist = R() < 0.45, back = 2.2 + c.rpm * 4.2, up = (1.8 + c.rpm * 4.6) * (0.7 + R() * 0.55);
        emit(c.x - fx * 1.6 + (R() - 0.5) * 0.3, waterY + 0.15, c.z - fz * 1.6 + (R() - 0.5) * 0.3,
          -fx * back + c.vx * 0.5 + rx * (R() - 0.5) * 1.3, up, -fz * back + c.vz * 0.5 + rz * (R() - 0.5) * 1.3,
          mist ? 0.5 + R() * 0.45 : 0.06 + R() * 0.06, mist, waterY);
      }
      // A curtain off the outside of a hard turn.
      const carve = Math.abs(c.yawRate) * speed;
      st.turn += dt * (carve > 4 ? (carve - 4) * 7 : 0);
      while (st.turn >= 1) {
        st.turn -= 1;
        const side = c.yawRate > 0 ? 1 : -1, mist = R() < 0.3, out = 2.5 + R() * 3.2, up = 1.2 + R() * 2.2;
        emit(c.x - fx * (0.2 + R() * 0.9) + rx * side * 0.55, waterY + 0.05, c.z - fz * (0.2 + R() * 0.9) + rz * side * 0.55,
          rx * side * out + c.vx * 0.4, up, rz * side * out + c.vz * 0.4, mist ? 0.4 + R() * 0.35 : 0.05 + R() * 0.05, mist, waterY);
      }
    },
    burst(x, y, z, strength) {
      const k = Math.sqrt(Math.max(0.2, strength));
      const n = Math.min(170, 30 + strength * 30);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, mist = i % 5 === 0, out = (1.2 + R() * 3.6) * k;
        emit(x + Math.cos(a) * 0.9, y, z + Math.sin(a) * 0.9, Math.cos(a) * out, (1.8 + R() * 3.5) * k, Math.sin(a) * out,
          mist ? 0.6 + R() * 0.6 : 0.06 + R() * 0.07, mist, y - 0.1);
      }
    },
    update(dt) {
      const drag = Math.exp(-2.6 * dt), air = Math.exp(-0.25 * dt);
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * fade[i];
        const j = i * 3;
        if (kind[i] > 0.5) {
          // Mist slows at once, sinks slowly and spreads.
          vel[j] *= drag; vel[j + 1] = vel[j + 1] * drag - 1.4 * dt; vel[j + 2] *= drag;
          size[i] += grow[i] * dt;
        } else {
          vel[j] *= air; vel[j + 1] -= 9.8 * dt; vel[j + 2] *= air;
          if (pos[j + 1] < floor[i] && vel[j + 1] < 0) life[i] = 0; // back in the sea
        }
        pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
        if (life[i] < 0) life[i] = 0;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.life.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
      geo.attributes.kind.needsUpdate = true;
    },
  };
}

// Speed streaks: short bright lines that rush past close to the rider at
// speed and while boosting. Lives in the rider's (holder) space.
export function createStreaks(parent) {
  const N = 70;
  const pos = new Float32Array(N * 6), col = new Float32Array(N * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  parent.add(lines);
  const p = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 99, live: false }));
  const spawn = (s) => {
    const a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 3.5;
    s.x = Math.cos(a) * r; s.y = 1.5 + Math.sin(a) * r * 0.6; s.z = -25 - Math.random() * 20; s.live = true;
  };
  return {
    // speed m/s, boost 0..1, gold 0..1 (Hype colour)
    update(dt, speed, boost) {
      const level = Math.max(0, (speed - 13) / 10) * 0.5 + boost;
      const want = Math.min(N, Math.floor(level * N));
      const v = speed * (1.2 + boost * 0.8);
      for (let i = 0; i < N; i++) {
        const s = p[i];
        if (!s.live) { if (i < want && Math.random() < dt * 6) spawn(s); else { pos.fill(0, i * 6, i * 6 + 6); continue; } }
        s.z += v * dt;
        if (s.z > 3) { s.live = false; continue; }
        const len = 0.6 + v * 0.06;
        pos[i * 6] = s.x; pos[i * 6 + 1] = s.y; pos[i * 6 + 2] = s.z;
        pos[i * 6 + 3] = s.x; pos[i * 6 + 4] = s.y; pos[i * 6 + 5] = s.z - len;
        const fade = Math.min(1, (s.z + 45) / 15) * Math.min(1, (3 - s.z) / 4) * Math.min(1, level);
        const r = 0.5 + 0.5 * boost, g = 0.5 + 0.3 * boost, b = 0.55 - 0.3 * boost;
        col.set([r * fade, g * fade, b * fade, 0, 0, 0], i * 6);
      }
      lines.visible = want > 0 || p.some((s) => s.live);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// Confetti: little squares in the Crispy colours that pop, flutter and fall.
export function createConfetti(scene) {
  const N = 260;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3), ph = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec3 color; attribute float life; varying vec3 vColor; varying float vLife;
      void main() { vColor = color; vLife = life; vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_PointSize = (life > 0.0 ? 46.0 : 0.0) / max(0.3, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vLife;
      void main() { gl_FragColor = vec4(vColor, min(1.0, vLife * 3.0)); if (gl_FragColor.a < 0.02) discard;
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const palette = [[1, 0.31, 0.64], [1, 0.82, 0.25], [1, 0.96, 0.88], [0.49, 0.94, 0.78]].map(([r, g, b]) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace));
  let next = 0, live = 0;
  return {
    // n pieces from a point; vx, vz: the speed of whatever threw them.
    burst(x, y, z, n = 12, power = 3, vx = 0, vz = 0) {
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % N;
        const a = Math.random() * Math.PI * 2, out = Math.random() * power, c = palette[(Math.random() * palette.length) | 0];
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        vel[i * 3] = Math.cos(a) * out + vx; vel[i * 3 + 1] = 1.5 + Math.random() * power; vel[i * 3 + 2] = Math.sin(a) * out + vz;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        life[i] = 0.9 + Math.random() * 0.8; ph[i] = Math.random() * 6.28;
      }
      live = 2;
    },
    update(dt, t) {
      if (live <= 0) { points.visible = false; return; }
      points.visible = true; live -= dt;
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        vel[i * 3 + 1] -= 6.5 * dt;
        const drag = 1 - Math.min(1, dt * 1.6);
        vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
        pos[i * 3] += (vel[i * 3] + Math.sin(t * 9 + ph[i]) * 0.8) * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += (vel[i * 3 + 2] + Math.cos(t * 8 + ph[i]) * 0.8) * dt;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.life.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}
