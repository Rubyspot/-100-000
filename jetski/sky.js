// Tropical afternoon sky: a deep blue gradient with fair-weather cumulus and a
// bank of towering clouds on the horizon, baked once into an equirectangular
// texture. The dome and the water's reflections both read that texture, so
// clouds show up in the water for one lookup. The same sun and sky colours
// light the rocks, sand and palms (LIGHT_GLSL).
import * as THREE from 'three';

// Afternoon sun, 34 degrees up, ahead and a little to the right of the start
// straight (+X), so the water ahead of the start carries a road of glitter.
export const SUN_DIR = new THREE.Vector3(0.753, 0.559, 0.347).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.86);    // linear
export const HAZE_COLOR = new THREE.Color(0.62, 0.79, 0.93);  // distance haze

// Uniform values shared by every shader that lights with the sun and sky.
export const LIGHT = {
  sunLight: new THREE.Color(1.0, 0.94, 0.84).multiplyScalar(2.05),
  skyLight: new THREE.Color(0.44, 0.58, 0.80).multiplyScalar(0.95),
  bounceLight: new THREE.Color(0.34, 0.44, 0.36).multiplyScalar(0.75),
};

// GLSL shared by everything that samples the baked sky.
export const SKY_SAMPLE_GLSL = /* glsl */`
  uniform sampler2D skyMap;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 hazeColor;
  uniform float hazeDensity;
  vec2 skyUv(vec3 d) {
    float u = atan(d.z, d.x) / 6.28318 + 0.5;
    float el = asin(clamp(d.y, -1.0, 1.0));
    float v = (el + 0.15) / (1.5708 + 0.15);
    return vec2(u, clamp(v, 0.0, 1.0));
  }
  // Gradients with the wrap at u = 0/1 removed, so the seam doesn't drop to
  // the smallest mip and draw a line.
  vec4 skySample(vec3 d) {
    vec2 uv = skyUv(d);
    vec2 gx = dFdx(uv), gy = dFdy(uv);
    gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);
    return textureGrad(skyMap, uv, gx, gy);
  }
  vec3 skyColor(vec3 d) { return skySample(d).rgb; }
  // Aerial perspective for anything in the world.
  vec3 applyHaze(vec3 col, float dist) {
    return mix(col, hazeColor, 1.0 - exp(-dist * hazeDensity));
  }
`;

const BAKE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 sunDir;
  varying vec2 vUv;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) { s += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  // Cumulus cover on a plane above the sea.
  float cover(vec2 p) {
    vec2 w = vec2(fbm(p * 0.5 + 3.1), fbm(p * 0.5 - 7.4));
    float f = fbm(p * 0.62 + w * 1.3);
    float big = fbm(p * 0.16 + 21.0);
    return smoothstep(0.55, 0.78, f * 0.72 + big * 0.38);
  }

  void main() {
    float az = (vUv.x - 0.5) * 6.28318;
    float el = mix(-0.15, 1.5708, vUv.y);
    vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    float h = max(d.y, 0.0);
    float s = max(dot(d, sunDir), 0.0);

    // Blue gradient, pale and bright at the horizon.
    vec3 zenith = vec3(0.07, 0.23, 0.60);
    vec3 mid = vec3(0.19, 0.45, 0.84);
    vec3 horizon = vec3(0.60, 0.79, 0.94);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.32, h));
    col = mix(col, zenith, smoothstep(0.25, 1.0, h));
    // Glow around the sun.
    col += vec3(1.0, 0.9, 0.7) * (pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.12);
    if (d.y < 0.0) col = mix(horizon, horizon * vec3(0.78, 0.86, 0.92), smoothstep(0.0, -0.15, d.y));

    float density = 0.0;
    vec3 cloud = vec3(1.0);
    if (d.y > 0.003) {
      vec2 p = d.xz / (d.y + 0.07) * 1.1;
      density = cover(p);
      // Light from the sun's side: compare with the cover a step toward it.
      vec2 toSun = normalize(sunDir.xz + 1e-4) * 0.35;
      float lit = clamp(0.62 + (density - cover(p + toSun)) * 1.6, 0.0, 1.0);
      float thick = smoothstep(0.0, 1.0, density);
      vec3 bright = vec3(1.12, 1.10, 1.06);
      vec3 shade = vec3(0.56, 0.64, 0.78);
      cloud = mix(shade, bright, lit * (1.0 - thick * 0.35));
      cloud += vec3(1.0, 0.92, 0.75) * pow(s, 12.0) * (1.0 - thick) * 0.9;
      // Tall cloud bank sitting on the horizon.
      float bank = smoothstep(0.42, 0.7, fbm(vec2(az * 2.2, 3.0)) * 0.7 + fbm(vec2(az * 6.0, el * 9.0)) * 0.5);
      float bankH = 0.06 + 0.13 * fbm(vec2(az * 3.1 + 5.0, 1.0));
      float inBank = bank * (1.0 - smoothstep(bankH * 0.55, bankH, d.y));
      vec3 bankCol = mix(vec3(0.74, 0.82, 0.92), vec3(1.08, 1.05, 1.0), smoothstep(0.0, bankH, d.y));
      // Thin out toward the horizon haze.
      float haze = smoothstep(0.0, 0.10, d.y);
      density *= haze;
      cloud = mix(horizon, cloud, haze);
      cloud = mix(cloud, bankCol, inBank * (1.0 - density));
      density = max(density, inBank * 0.92);
    }
    col = mix(col, cloud, density);
    gl_FragColor = vec4(col, density);
  }`;

export function createSky(renderer) {
  // Half-float keeps the bright cloud tops; fall back to 8-bit where the
  // headset can't render to it.
  const canFloat = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const target = new THREE.WebGLRenderTarget(2048, 512, {
    type: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BAKE_FRAG,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  quad.frustumCulled = false;
  const bakeScene = new THREE.Scene();
  bakeScene.add(quad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevXr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(target);
  renderer.render(bakeScene, bakeCam);
  renderer.setRenderTarget(prevTarget);
  renderer.xr.enabled = prevXr;
  quad.geometry.dispose();
  quad.material.dispose();

  const uniforms = {
    skyMap: { value: target.texture },
    sunDir: { value: SUN_DIR },
    sunColor: { value: SUN_COLOR },
    hazeColor: { value: HAZE_COLOR },
    hazeDensity: { value: 0.00085 },
    sunLight: { value: LIGHT.sunLight },
    skyLight: { value: LIGHT.skyLight },
    bounceLight: { value: LIGHT.bounceLight },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_SAMPLE_GLSL + /* glsl */`
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec4 sky = skySample(d);
          float s = dot(d, sunDir);
          vec3 sun = sunColor * (smoothstep(0.99955, 0.99985, s) * 40.0 + pow(max(s, 0.0), 1500.0) * 6.0 + pow(max(s, 0.0), 120.0) * 0.6);
          gl_FragColor = vec4(sky.rgb + sun * (1.0 - sky.a * 0.9), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;

  // Environment map for the jetskis' paint, from the same sky.
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(dome.geometry, dome.material);
  envDome.scale.setScalar(0.01);
  envScene.add(envDome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  renderer.xr.enabled = false;
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  const env = pmrem.fromScene(envScene, 0.02).texture;
  renderer.toneMapping = prevTone;
  renderer.xr.enabled = prevXr;
  renderer.setRenderTarget(prevTarget);
  pmrem.dispose();

  return { dome, uniforms, texture: target.texture, env };
}
