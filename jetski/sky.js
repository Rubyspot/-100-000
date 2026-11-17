// Sunset sky, the one the first builds had: a peach horizon, a rose band,
// violet and a deep blue zenith, with clouds lit pink from below, baked once
// into an equirectangular texture. The dome and the water's reflections both
// read that texture, so clouds show up in the water for one lookup. The same
// sun and sky colours light the rocks, sand and palms, and far things fade
// into the sky's own colour along the horizon (applyHaze).
import * as THREE from 'three';

// Low sun, 8 degrees up, ahead and a little to the left of the start
// straight (+X): a long road of glitter toward it, warm light on every face
// that turns to it and long shadows behind the rocks.
export const SUN_DIR = new THREE.Vector3(0.92, 0.14, -0.38).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.62, 0.36);    // linear
export const HAZE_COLOR = new THREE.Color(0xf3a98e);          // fog for plain meshes

// Uniform values shared by every shader that lights with the sun and sky.
export const LIGHT = {
  sunLight: new THREE.Color(1.0, 0.62, 0.36).multiplyScalar(2.1),
  skyLight: new THREE.Color(0.42, 0.38, 0.64).multiplyScalar(0.8),
  bounceLight: new THREE.Color(0.30, 0.22, 0.30).multiplyScalar(0.6),
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
  // Aerial perspective: far things fade into the colour of the sky low
  // over the horizon in their direction (orange toward the sun, violet away
  // from it), so the fog and the sky behind meet without a seam.
  vec3 applyHaze(vec3 col, float dist, vec3 dir) {
    vec3 hz = skySample(normalize(vec3(dir.x, 0.035, dir.z))).rgb;
    return mix(col, hz, 1.0 - exp(-dist * hazeDensity));
  }
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

  void main() {
    float az = (vUv.x - 0.5) * 6.28318;
    float el = mix(-0.15, 1.5708, vUv.y);
    vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    float h = max(d.y, 0.0);
    float s = max(dot(d, sunDir), 0.0);
    // Azimuthal closeness to the sun, ignoring height.
    float sa = max(dot(normalize(d.xz), normalize(sunDir.xz)), 0.0);

    // Peach horizon (orange under the sun), rose band, violet, deep blue zenith.
    vec3 horizon = mix(vec3(0.95, 0.42, 0.30), vec3(1.0, 0.55, 0.22), pow(sa, 3.0));
    vec3 rose = vec3(0.78, 0.36, 0.48);
    vec3 violet = vec3(0.30, 0.22, 0.48);
    vec3 zenith = vec3(0.06, 0.09, 0.26);
    vec3 col = mix(horizon, rose, smoothstep(0.0, 0.12, h));
    col = mix(col, violet, smoothstep(0.08, 0.4, h));
    col = mix(col, zenith, smoothstep(0.35, 1.2, h));
    col += vec3(1.0, 0.55, 0.25) * (pow(s, 6.0) * 0.9 + pow(s, 2.0) * 0.2) * (1.0 - smoothstep(0.0, 0.5, h));
    if (d.y < 0.0) col = mix(horizon, horizon * 0.8, smoothstep(0.0, -0.15, d.y));

    // Clouds on a plane above the sea, lit pink from below, rims glowing
    // near the sun, and thin streaks higher up.
    float density = 0.0;
    vec3 cloud = vec3(0.0);
    if (d.y > 0.004) {
      vec2 p = d.xz / (d.y + 0.035) * 0.9;
      vec2 w = vec2(fbm(p * 0.6 + 3.1), fbm(p * 0.6 - 7.4));
      float f = fbm(p * 0.75 + w * 1.6);
      float cover = 0.44 + 0.08 * sin(az * 2.0 + 1.0);
      density = smoothstep(cover, cover + 0.22, f);
      float cir = fbm(vec2(p.x * 0.25, p.y * 1.8) + w);
      density = max(density, smoothstep(0.58, 0.8, cir) * 0.55 * smoothstep(0.05, 0.3, h));
      float thick = smoothstep(cover, cover + 0.5, f);
      vec3 lit = mix(vec3(1.0, 0.36, 0.58), vec3(1.0, 0.62, 0.36), pow(sa, 5.0));
      vec3 shade = vec3(0.46, 0.22, 0.46);
      cloud = mix(lit, shade, thick * 0.75 * (1.0 - pow(s, 3.0) * 0.6));
      cloud += vec3(1.0, 0.75, 0.45) * pow(s, 10.0) * (1.0 - thick) * 2.5;
      // Fade into haze at the horizon.
      float haze = smoothstep(0.0, 0.12, d.y);
      density *= haze;
      cloud = mix(horizon, cloud, haze);
    }
    col = mix(col, cloud, density * 0.92);
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
    hazeDensity: { value: 0.0015 },
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
          vec3 sun = sunColor * (smoothstep(0.99935, 0.99965, s) * 30.0 + pow(max(s, 0.0), 900.0) * 4.0 + pow(max(s, 0.0), 90.0) * 0.5);
          gl_FragColor = vec4(sky.rgb + sun * (1.0 - sky.a * 0.85), 1.0);
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
