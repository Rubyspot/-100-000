// Ocean: Gerstner swell on a camera-following polar grid, detail from two
// scrolling tileable normal maps, sky reflections from the baked sunset,
// sun glitter, subsurface light through the crests, crest and shore foam,
// and shallow turquoise water near land. The same wave sum runs on the CPU
// so the jetskis float, jump and land on the surface you see.
import * as THREE from 'three';
import { SKY_SAMPLE_GLSL } from './sky.js';

const WAVES = [ // direction (deg), wavelength (m), amplitude (m), steepness
  [25, 62, 0.50, 0.10],
  [-12, 37, 0.42, 0.15],
  [62, 23, 0.20, 0.13],
  [-58, 14.5, 0.10, 0.12],
  [112, 9, 0.05, 0.10],
  [-145, 5.5, 0.026, 0.08],
  [165, 3.4, 0.013, 0.06],
].map(([deg, L, A, steep]) => {
  const a = THREE.MathUtils.degToRad(deg), k = (2 * Math.PI) / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), A, steep, f0: L * 3.5, f1: L * 7 };
});

// Tileable detail: random waves with whole-number wave vectors over a
// 256² tile. RG hold the surface slope, B a foam pattern.
function makeDetailTexture() {
  const N = 256;
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 48; i++) {
    let kx = 0, ky = 0;
    while (kx === 0 && ky === 0) { kx = Math.round((rnd() - 0.5) * 40); ky = Math.round((rnd() - 0.5) * 40); }
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, amp: 1 / Math.pow(k, 1.5), ph: rnd() * Math.PI * 2 });
  }
  const foamWaves = [];
  for (let i = 0; i < 24; i++) {
    const kx = Math.round((rnd() - 0.5) * 24) || 3, ky = Math.round((rnd() - 0.5) * 24) || 2;
    foamWaves.push({ kx, ky, amp: 1 / Math.hypot(kx, ky), ph: rnd() * Math.PI * 2 });
  }
  const sx = new Float32Array(N * N), sy = new Float32Array(N * N), fo = new Float32Array(N * N);
  let maxS = 0, minF = Infinity, maxF = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
      let dx = 0, dy = 0, f = 0;
      for (const w of waves) {
        const c = Math.cos(w.kx * u + w.ky * v + w.ph) * w.amp;
        dx += c * w.kx; dy += c * w.ky;
      }
      for (const w of foamWaves) f += Math.sin(w.kx * u + w.ky * v + w.ph) * w.amp;
      const i = y * N + x;
      sx[i] = dx; sy[i] = dy; fo[i] = Math.abs(f);
      maxS = Math.max(maxS, Math.abs(dx), Math.abs(dy));
      minF = Math.min(minF, fo[i]); maxF = Math.max(maxF, fo[i]);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round((sx[i] / maxS) * 127 + 128);
    data[i * 4 + 1] = Math.round((sy[i] / maxS) * 127 + 128);
    // Foam: thin bright veins where the pattern crosses zero.
    const f = 1 - (fo[i] - minF) / (maxF - minF);
    data[i * 4 + 2] = Math.round(Math.pow(f, 3) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function makeGridGeometry() {
  const radii = [0];
  let r = 0, step = 0.45;
  while (r < 40) { r += step; radii.push(r); }
  while (r < 5200) { step *= 1.05; r += step; radii.push(r); }
  const SEG = 200;
  const verts = [0, 0, 0];
  for (let i = 1; i < radii.length; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      verts.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  const idx = [];
  const ring = (i, j) => 1 + (i - 1) * SEG + (j % SEG);
  for (let j = 0; j < SEG; j++) idx.push(0, ring(1, j + 1), ring(1, j));
  for (let i = 1; i < radii.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j), d = ring(i + 1, j + 1);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

export function createOcean({ sky, landTexture, landBounds }) {
  const detail = makeDetailTexture();
  const uniforms = {
    ...sky.uniforms,
    time: { value: 0 },
    camPos: { value: new THREE.Vector3() },
    waveA: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.w)) },
    waveB: { value: WAVES.map((w) => new THREE.Vector4(w.A, w.steep, w.f0, w.f1)) },
    detailMap: { value: detail },
    landMap: { value: landTexture },
    landBounds: { value: landBounds }, // minX, minZ, size, metres per unit
    deep: { value: new THREE.Color(0x032a44) },
    shallow: { value: new THREE.Color(0x1a8c8a) },
    sss: { value: new THREE.Color(0x29c9b4) },
    foamColor: { value: new THREE.Color(0xfff1ea) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      #define WAVES ${WAVES.length}
      uniform float time; uniform vec3 camPos;
      uniform vec4 waveA[WAVES]; uniform vec4 waveB[WAVES];
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        float dist = length(p.xz - camPos.xz);
        vec3 disp = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
        float crest = 0.0;
        for (int i = 0; i < WAVES; i++) {
          vec4 a = waveA[i]; vec4 b = waveB[i];
          float fade = 1.0 - smoothstep(b.z, b.w, dist);
          float amp = b.x * fade, st = b.y * fade;
          float ph = a.z * dot(a.xy, p.xz) - a.w * time;
          float c = cos(ph), s = sin(ph);
          disp.xz += a.xy * (st / a.z) * c;
          disp.y += amp * s;
          n.xz -= a.xy * a.z * amp * c;
          n.y -= st * s;
          crest += st * s;
        }
        p += disp;
        vWorld = p; vNormal = n; vCrest = crest;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
      uniform float time; uniform vec3 camPos;
      uniform sampler2D detailMap; uniform sampler2D landMap; uniform vec4 landBounds;
      uniform vec3 deep; uniform vec3 shallow; uniform vec3 sss; uniform vec3 foamColor;
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;

      void main() {
        vec3 toCam = camPos - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;

        vec4 d1 = texture2D(detailMap, p / 17.0 + vec2(0.021, 0.013) * time);
        vec4 d2 = texture2D(detailMap, p / 6.1 + vec2(-0.034, 0.041) * time);
        vec2 slope = (d1.rg - 0.5) * 0.55 + (d2.rg - 0.5) * 0.35;
        vec3 N = normalize(vNormal + vec3(-slope.x, 0.0, -slope.y));

        vec2 luv = (p - landBounds.xy) / landBounds.z;
        float land = (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) ? texture2D(landMap, luv).r * landBounds.w : 999.0;

        float ndv = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        vec4 refl = skySample(normalize(R));

        // Water body: deep blue-green, turquoise in the shallows near land,
        // and light scattered through crests that face the low sun.
        float shallowAmt = 1.0 - smoothstep(2.0, 30.0, land);
        vec3 body = mix(deep, shallow, shallowAmt * 0.8);
        vec3 Lh = normalize(vec3(sunDir.x, 0.0, sunDir.z));
        float toward = pow(max(dot(-V, Lh), 0.0), 3.0);
        float lift = clamp(vCrest * 1.8 + 0.15, 0.0, 1.0);
        body += sss * sunColor * (toward * 0.9 + 0.12) * lift * 0.55;
        vec3 col = mix(body, refl.rgb * 0.85, F);

        // Sun glitter: a long road toward the low sun.
        vec3 H = normalize(V + sunDir);
        float nh = max(dot(N, H), 0.0);
        float spec = pow(nh, 1400.0) * 40.0 + pow(nh, 160.0) * 1.6;
        col += sunColor * spec * (1.0 - refl.a * 0.8);

        // Foam: crests, shorelines.
        float fA = texture2D(detailMap, p / 9.0 + vec2(0.01, -0.017) * time).b;
        float fB = texture2D(detailMap, p / 3.7 - vec2(0.02, 0.012) * time).b;
        float crestFoam = smoothstep(0.5, 0.8, vCrest + fA * 0.3) * (0.3 + 0.7 * fB);
        float shore = 1.0 - smoothstep(0.5, 9.0, land);
        float surf = smoothstep(0.35, 0.85, 0.5 + 0.5 * sin(land * 1.25 - time * 1.7) + fA * 0.6 - 0.3);
        float foam = clamp(crestFoam + shore * (0.35 + 0.65 * surf) * (0.5 + 0.5 * fB), 0.0, 1.0);
        vec3 foamLit = foamColor * (0.45 + 0.55 * sunColor * max(dot(N, sunDir), 0.0) * 1.6 + refl.rgb * 0.35);
        col = mix(col, foamLit, foam);

        // Aerial perspective: blend toward the sky right at the horizon.
        vec3 hz = skyColor(normalize(vec3(-V.x, 0.02, -V.z)));
        col = mix(col, hz, smoothstep(250.0, 3500.0, dist));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const mesh = new THREE.Mesh(makeGridGeometry(), material);
  mesh.frustumCulled = false;

  // CPU wave sum. Heights are relative to the camera, matching the faded
  // waves that are drawn.
  const cam = new THREE.Vector2();
  const d = { x: 0, y: 0, z: 0 };
  function displacement(x, z, t) {
    d.x = d.y = d.z = 0;
    const dist = Math.hypot(x - cam.x, z - cam.y);
    for (const w of WAVES) {
      const fade = 1 - THREE.MathUtils.smoothstep(dist, w.f0, w.f1);
      if (fade <= 0) continue;
      const ph = w.k * (w.dx * x + w.dz * z) - w.w * t;
      const c = Math.cos(ph), s = Math.sin(ph);
      const h = (w.steep * fade) / w.k;
      d.x += w.dx * h * c;
      d.z += w.dz * h * c;
      d.y += w.A * fade * s;
    }
    return d;
  }
  function heightAt(x, z, t) {
    // Undo the horizontal Gerstner shift with two fixed-point steps.
    let px = x, pz = z;
    for (let i = 0; i < 2; i++) {
      displacement(px, pz, t);
      px = x - d.x; pz = z - d.z;
    }
    return displacement(px, pz, t).y;
  }

  return {
    mesh, uniforms, detail, heightAt,
    update(camPos, t) {
      cam.set(camPos.x, camPos.z);
      mesh.position.set(Math.round(camPos.x / 0.45) * 0.45, 0, Math.round(camPos.z / 0.45) * 0.45);
      uniforms.camPos.value.copy(camPos);
      uniforms.time.value = t;
    },
  };
}
