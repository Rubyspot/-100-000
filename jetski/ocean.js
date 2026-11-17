// Lagoon water. A gentle Gerstner swell on a camera-following polar grid,
// detail from two scrolling tileable normal maps, and a colour that comes
// from what is under it: the shader looks through the surface at a sand bed
// (with sea-grass patches and dancing caustics) whose depth is baked in the
// world's water map, and absorbs red first on the way down and back, so
// shallows turn pale aqua, the lagoon turquoise and the open sea deep blue.
// On top: sky reflections that give way to rock and trees inside the canals,
// cliff shadows, sun glitter, crest and shore foam. The same wave sum runs
// on the CPU so the jetskis float, jump and land on the surface you see.
import * as THREE from 'three';
import { SKY_SAMPLE_GLSL } from './sky.js';

const WAVES = [ // direction (deg), wavelength (m), amplitude (m), steepness
  [30, 46, 0.26, 0.10],
  [-18, 27, 0.20, 0.13],
  [66, 17, 0.11, 0.12],
  [-55, 10.5, 0.055, 0.11],
  [118, 6.2, 0.028, 0.09],
  [-140, 3.9, 0.014, 0.07],
].map(([deg, L, A, steep]) => {
  const a = THREE.MathUtils.degToRad(deg), k = (2 * Math.PI) / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(9.81 * k), A, steep, f0: L * 3.5, f1: L * 7 };
});

// Tileable detail: random waves with whole-number wave vectors over a
// 256² tile. RG hold the surface slope, B a pattern of thin bright veins
// (foam on top, caustics on the bed).
function makeDetailTexture() {
  const N = 256;
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    let kx = 0, ky = 0;
    while (kx === 0 && ky === 0) { kx = Math.round((rnd() - 0.5) * 40); ky = Math.round((rnd() - 0.5) * 40); }
    const k = Math.hypot(kx, ky);
    waves.push({ kx, ky, amp: 1 / Math.pow(k, 1.5), ph: rnd() * Math.PI * 2 });
  }
  const foamWaves = [];
  for (let i = 0; i < 20; i++) {
    const kx = Math.round((rnd() - 0.5) * 24) || 3, ky = Math.round((rnd() - 0.5) * 24) || 2;
    foamWaves.push({ kx, ky, amp: 1 / Math.hypot(kx, ky), ph: rnd() * Math.PI * 2 });
  }
  // cos and sin of every whole multiple of the tile angle, looked up instead of recomputed.
  const cosT = new Float32Array(N), sinT = new Float32Array(N);
  for (let i = 0; i < N; i++) { cosT[i] = Math.cos((i / N) * Math.PI * 2); sinT[i] = Math.sin((i / N) * Math.PI * 2); }
  const sx = new Float32Array(N * N), sy = new Float32Array(N * N), fo = new Float32Array(N * N);
  let maxS = 0, minF = Infinity, maxF = -Infinity;
  const cph = waves.map((w) => [Math.cos(w.ph), Math.sin(w.ph)]), fph = foamWaves.map((w) => [Math.cos(w.ph), Math.sin(w.ph)]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0, f = 0;
      for (let n = 0; n < waves.length; n++) {
        const w = waves[n], a = (((w.kx * x + w.ky * y) % N) + N) % N;
        const c = (cosT[a] * cph[n][0] - sinT[a] * cph[n][1]) * w.amp;
        dx += c * w.kx; dy += c * w.ky;
      }
      for (let n = 0; n < foamWaves.length; n++) {
        const w = foamWaves[n], a = (((w.kx * x + w.ky * y) % N) + N) % N;
        f += (sinT[a] * fph[n][0] + cosT[a] * fph[n][1]) * w.amp;
      }
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
  let r = 0, step = 0.5;
  while (r < 40) { r += step; radii.push(r); }
  while (r < 5200) { step *= 1.05; r += step; radii.push(r); }
  const SEG = 160;
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

const CALM_MIN = 0.25, CALM_D0 = 2.0, CALM_D1 = 30.0;

export function createOcean({ sky, landTexture, landBounds, landDist }) {
  const detail = makeDetailTexture();
  const uniforms = {
    ...sky.uniforms,
    time: { value: 0 },
    camPos: { value: new THREE.Vector3() },
    waveA: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.w)) },
    waveB: { value: WAVES.map((w) => new THREE.Vector4(w.A, w.steep, w.f0, w.f1)) },
    detailMap: { value: detail },
    landMap: { value: landTexture },
    landBounds: { value: landBounds }, // minX, minZ, size, metres per unit of distance
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      #define WAVES ${WAVES.length}
      uniform float time; uniform vec3 camPos;
      uniform vec4 waveA[WAVES]; uniform vec4 waveB[WAVES];
      uniform sampler2D landMap; uniform vec4 landBounds;
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;
      void main() {
        vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        float dist = length(p.xz - camPos.xz);
        // Swell calms down in narrow water and near shores.
        vec2 luv = (p.xz - landBounds.xy) / landBounds.z;
        float ld = (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) ? texture2D(landMap, luv).r * landBounds.w : 999.0;
        float calm = mix(${CALM_MIN.toFixed(3)}, 1.0, smoothstep(${CALM_D0.toFixed(1)}, ${CALM_D1.toFixed(1)}, ld));
        vec3 disp = vec3(0.0), n = vec3(0.0, 1.0, 0.0);
        float crest = 0.0;
        for (int i = 0; i < WAVES; i++) {
          vec4 a = waveA[i]; vec4 b = waveB[i];
          float fade = (1.0 - smoothstep(b.z, b.w, dist)) * calm;
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
      uniform vec3 sunLight; uniform vec3 skyLight;
      varying vec3 vWorld; varying vec3 vNormal; varying float vCrest;

      vec4 landAt(vec2 xz) {
        vec2 uv = (xz - landBounds.xy) / landBounds.z;
        return (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ? texture2D(landMap, uv) : vec4(1.0, 1.0, 1.0, 0.0);
      }

      void main() {
        vec3 toCam = camPos - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 p = vWorld.xz;

        vec4 d1 = texture2D(detailMap, p / 19.0 + vec2(0.021, 0.013) * time);
        vec4 d2 = texture2D(detailMap, p / 6.7 + vec2(-0.034, 0.041) * time);
        vec2 slope = (d1.rg - 0.5) * 0.5 + (d2.rg - 0.5) * 0.38;
        vec3 N = normalize(vNormal + vec3(-slope.x, 0.0, -slope.y));

        vec4 lm = landAt(p);
        float land = lm.r * landBounds.w;  // metres to the shore
        float sun = lm.b;                  // 1 in sunlight, 0 in a cliff's shadow
        float cover = lm.a;                // how high the land stands around

        float ndv = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

        // Looking through the surface: the view bends toward straight down,
        // so the bed is seen a little this side of where the eye points.
        float cosI = max(V.y, 0.04);
        float sinR = sqrt(1.0 - cosI * cosI) / 1.33;
        float cosR = sqrt(1.0 - sinR * sinR);
        vec2 away = -normalize(V.xz + vec2(1e-5));
        vec2 bed = p + away * (lm.g * 16.0) * (sinR / cosR) + N.xz * (lm.g * 16.0) * 0.7;
        float depth = landAt(bed).g * 16.0;

        // Sand, patches of sea grass, and caustics where the sun reaches.
        vec4 s1 = texture2D(detailMap, bed / 37.0);
        float grass = smoothstep(0.55, 0.66, s1.r) * smoothstep(1.4, 3.2, depth);
        vec3 bedCol = mix(vec3(0.93, 0.87, 0.70) * (0.9 + 0.2 * d2.b), vec3(0.13, 0.28, 0.20), grass * 0.8);
        float c1 = texture2D(detailMap, bed / 5.3 + vec2(0.03, 0.017) * time).b;
        float c2 = texture2D(detailMap, bed / 3.1 - vec2(0.021, 0.028) * time).b;
        float caust = (c1 + c2) * 0.5 + c1 * c2 * 3.0;
        bedCol *= 0.8 + caust * 0.7 * sun * exp(-depth * 0.2);

        // Water takes the red out first, on the way down and back up.
        float path = depth * (1.0 + 1.0 / max(cosR, 0.4));
        vec3 T = exp(-vec3(0.40, 0.080, 0.042) * path);
        vec3 scatter = vec3(0.010, 0.19, 0.33);
        vec3 lit = vec3(1.0, 0.98, 0.94) * mix(0.40, 1.0, sun);
        vec3 body = (bedCol * T + scatter * (1.0 - T)) * lit;
        // A little light through the crests.
        body += vec3(0.05, 0.30, 0.26) * clamp(vCrest * 2.0, 0.0, 1.0) * sun * 0.5;

        // Reflection: sky, or the rock and trees that stand around the water.
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        R = normalize(R);
        vec4 refl = skySample(R);
        float horizon = cover * 1.3;
        float landRefl = (1.0 - smoothstep(horizon - 0.14, horizon + 0.1, R.y)) * smoothstep(0.03, 0.2, cover);
        vec3 rockRefl = mix(vec3(0.16, 0.22, 0.13), vec3(0.44, 0.42, 0.36), smoothstep(0.05, 0.6, R.y)) * (0.45 + 0.55 * sun);
        vec3 col = mix(body, mix(refl.rgb, rockRefl, landRefl), F);

        // Sun glitter.
        vec3 Hh = normalize(V + sunDir);
        float nh = max(dot(N, Hh), 0.0);
        float spec = pow(nh, 900.0) * 30.0 + pow(nh, 110.0) * 1.1;
        col += sunColor * spec * sun * (1.0 - refl.a * 0.8) * (1.0 - landRefl * 0.7);

        // Foam: crests, shorelines, and lace drifting off the rocks.
        float fA = d1.b, fB = d2.b;
        float crestFoam = smoothstep(0.42, 0.7, vCrest + fA * 0.3) * (0.3 + 0.7 * fB) * 0.6;
        float shore = 1.0 - smoothstep(0.1, 1.5, land);
        float surf = smoothstep(0.35, 0.85, 0.5 + 0.5 * sin(land * 1.6 - time * 1.5) + fA * 0.6 - 0.3);
        float lace = (1.0 - smoothstep(0.8, 6.0, land)) * surf * fB * 0.4;
        float foam = clamp(crestFoam + shore * (0.2 + 0.8 * surf) * (0.25 + 0.75 * fB) + lace, 0.0, 1.0);
        vec3 foamLit = skyLight * 0.95 + sunLight * 0.36 * sun;
        col = mix(col, foamLit, foam);

        col = applyHaze(col, dist);
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
  let calm = 1;
  function displacement(x, z, t) {
    d.x = d.y = d.z = 0;
    const dist = Math.hypot(x - cam.x, z - cam.y);
    for (const w of WAVES) {
      const fade = (1 - THREE.MathUtils.smoothstep(dist, w.f0, w.f1)) * calm;
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
    calm = landDist ? CALM_MIN + (1 - CALM_MIN) * THREE.MathUtils.smoothstep(Math.min(40, landDist(x, z)), CALM_D0, CALM_D1) : 1;
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
      mesh.position.set(Math.round(camPos.x / 0.5) * 0.5, 0, Math.round(camPos.z / 0.5) * 0.5);
      uniforms.camPos.value.copy(camPos);
      uniforms.time.value = t;
    },
  };
}
