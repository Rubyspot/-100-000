// Water effects that follow a jetski: a foam wake ribbon, and spray
// particles (bow spray, the rooster tail behind the jet, landing bursts).
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
    uniforms: { time: { value: 0 }, detailMap: { value: ocean.detail }, foamColor: { value: new THREE.Color(0xfff1ea) }, sunColor: ocean.uniforms.sunColor },
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
  return {
    reset() { fresh = true; },
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

export function createSpray(scene, sunColor) {
  const N = 260;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const size = new Float32Array(N);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('life', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const vel = new Float32Array(N * 3);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { sunColor: { value: sunColor } },
    vertexShader: /* glsl */`
      attribute float life; attribute float size; varying float vLife;
      void main() { vLife = life; vec4 mv = viewMatrix * vec4(position, 1.0); gl_PointSize = 900.0 * size / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunColor; varying float vLife;
      void main() { vec2 c = gl_PointCoord - 0.5; float d = smoothstep(0.25, 0.0, dot(c, c));
        gl_FragColor = vec4(vec3(0.85) * (0.6 + 0.5 * sunColor), d * vLife * 0.7); if (gl_FragColor.a < 0.01) discard;
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let next = 0;
  const emit = (x, y, z, vx, vy, vz, s) => {
    const i = next; next = (next + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    life[i] = 1; size[i] = s;
  };
  const acc = new Map();
  return {
    // A jetski's continuous spray. key separates emitters.
    emitCraft(key, dt, c, waterY) {
      if (c.airborne || c.wet === 0) return;
      const speed = Math.abs(c.fwdSpeed);
      let a = (acc.get(key) || 0) + dt * (speed > 3 ? speed * 3.5 : 0) + dt * c.rpm * 14;
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      while (a >= 1) {
        a -= 1;
        if (Math.random() < 0.6 && speed > 3) {
          // Bow spray to the sides.
          const side = Math.random() < 0.5 ? -1 : 1;
          const out = 1.5 + Math.random() * 2.5, up = 1.2 + Math.random() * 2;
          emit(c.x + fx * 0.6 + rx * side * 0.5, waterY + 0.05, c.z + fz * 0.6 + rz * side * 0.5,
            rx * side * out + c.vx * 0.6, up, rz * side * out + c.vz * 0.6, 0.05);
        } else {
          // Rooster tail from the jet.
          const back = 2 + c.rpm * 5, up = 1 + c.rpm * 3.5;
          emit(c.x - fx * 1.5, waterY + 0.1, c.z - fz * 1.5,
            -fx * back + c.vx * 0.5 + (Math.random() - 0.5), up * (0.7 + Math.random() * 0.5), -fz * back + c.vz * 0.5 + (Math.random() - 0.5), 0.09);
        }
      }
      acc.set(key, a);
    },
    burst(x, y, z, strength) {
      const n = Math.min(80, 20 + strength * 12);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, out = 1 + Math.random() * 2.5 * strength * 0.4;
        emit(x + Math.cos(a) * 0.8, y, z + Math.sin(a) * 0.8, Math.cos(a) * out, 1.5 + Math.random() * strength * 0.9, Math.sin(a) * out, 0.07 + Math.random() * 0.06);
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt * 1.2;
        vel[i * 3 + 1] -= 9.8 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.life.needsUpdate = true;
      geo.attributes.size.needsUpdate = true;
    },
  };
}
