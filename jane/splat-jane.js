// Jane as Gaussian splats in the room scan. When the player arrives she forms
// out of a swirl of glowing particles and then goes through her poses, 10 s
// each: surfboard, NEW (shaka), then singing into a microphone, where she
// stays. Each change is a swirl: the old scan's splats shrink to golden points
// that spiral up and away while the next scan's points spiral down into place.
//
// How it works: all scans are loaded up front and each gets a Spark "dyno"
// object modifier, a few lines of GLSL that run on the GPU for every splat
// whenever the mesh regenerates. Two numbers drive it, `form` and `gone`: a
// wave that sweeps from her feet (0) to her head (1). A splat the `form` wave
// has passed is in place; one the `gone` wave has passed is blown away. In
// between, about a third of the splats (`sparks`) become small bright particles
// on their way and the rest fade where they are; the same path run backwards
// brings the next scan's particles in. This is the approach of
// Spark's own "Splat Transitions" examples (Morph, Flow): shrink each splat
// to a point, move it along a per-splat random path, fade it, and do the
// reverse for the incoming splats. Nothing is re-uploaded, so it costs one
// generator pass per frame while the effect runs and nothing after.
import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';

// Measured on the files (see jane-splat/main.js): scan height feet to head,
// feet height, and the body's vertical axis, all in scan units (y down).
// All are Postshot's anti-aliased model, so Spark needs its 0.1 filter.
// The singing scan (Ilia, Nov 17) came out about 10% larger in its units than
// the other two (measured on her shirt logo, which is the same size in both
// of those), so its height is 1.634 x 1.10. She stands with her feet apart in
// it, which puts the top of her head at 1.72 m instead of 1.75.
export const JANE_SCANS = {
  surf: { url: './assets/jane/surf-150k.sog', height: 1.634, feetY: -0.065, cx: -0.003, cz: -0.19, aa: true },
  new: { url: './assets/jane/new-150k.sog', height: 1.634, feetY: -0.07, cx: -0.092, cz: -0.147, aa: true },
  sing: { url: './assets/jane/sing-150k.sog', height: 1.80, feetY: -0.065, cx: -0.098, cz: -0.193, aa: true },
};

const FORM_SEC = 2.2;   // first appearance
const HOLD_SEC = 10;    // each pose on show before the next (Ilia: 10 s)
const MORPH_SEC = 3.6;  // one scan out, the next in
const LAG_SEC = 0.7;    // the incoming scan's wave trails the outgoing one's
const LIFE = 0.45;      // how far behind the wave a particle settles (in body heights)
const WAVE_START = -0.12, WAVE_END = 1 + LIFE + 0.12;
const PARTICLE_M = 0.0028; // particle size (Gaussian sigma) in metres
const SPARKS = 0.35;    // share of splats that fly as glowing sparks; the rest dissolve in place
const AA_BLUR = 0.1, CLASSIC_BLUR = 0.3;

const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const wave = (u) => WAVE_START + (WAVE_END - WAVE_START) * smooth(u);

function particleModifier(scan, unit, form, gone, sparks) {
  const f = (x) => x.toFixed(5);
  const fx = new dyno.Dyno({
    inTypes: { gsplat: dyno.Gsplat, form: 'float', gone: 'float' },
    outTypes: { gsplat: dyno.Gsplat },
    globals: () => [dyno.unindent(/* glsl */`
      // Integer hash (pcg3d): stable per-splat randoms without sin() precision trouble on mobile GPUs.
      vec3 janeFxRand(int i) {
        uvec3 v = uvec3(uint(i), uint(i) ^ 0x9E3779B9u, uint(i) * 0x85EBCA6Bu);
        v = v * 1664525u + 1013904223u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        v ^= v >> 16u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        return vec3(v) * (1.0 / 4294967296.0);
      }
    `)],
    statements: ({ inputs, outputs }) => dyno.unindentLines(/* glsl */`
      ${outputs.gsplat} = ${inputs.gsplat};
      vec3 c = ${inputs.gsplat}.center;
      vec3 r = janeFxRand(${inputs.gsplat}.index);
      // Height on the body, 0 at the feet to 1 at the head (the scan is y down).
      float h = clamp((${f(scan.feetY)} - c.y) / ${f(scan.height)}, 0.0, 1.0);
      float th = h + (r.x - 0.5) * 0.16;
      float sf = clamp((${inputs.form} - th) / ${f(LIFE)}, 0.0, 1.0); // 1 = in place
      float sg = clamp((${inputs.gone} - th) / ${f(LIFE)}, 0.0, 1.0); // 1 = blown away
      float k = max(1.0 - sf, sg);  // 0 = in place, 1 = far out in the swirl
      // Only some splats fly as sparks (all of them would be a dense cloud);
      // the rest shrink and fade out on the first stretch of the path.
      bool isSpark = fract(r.x * 97.31 + r.z * 41.17) < ${f(sparks)};
      if (k >= 1.0 || (!isSpark && k >= 0.3)) {
        ${outputs.gsplat}.flags = 0u;
      } else if (k > 0.0) {
        // Spiral around her vertical axis, out and up. Incoming particles run
        // the path backwards, so the whole swirl keeps turning the same way.
        float spin = (1.0 - sf) >= sg ? -1.0 : 1.0;
        vec2 axis = vec2(${f(scan.cx)}, ${f(scan.cz)});
        vec2 rel = c.xz - axis;
        float ang = spin * k * (1.4 + 2.4 * r.y);
        float cs = cos(ang), sn = sin(ang);
        rel = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
        float rad = length(rel);
        vec2 dir = rad > 1e-5 ? rel / rad : vec2(cos(r.z * 6.2832), sin(r.z * 6.2832));
        rel += dir * k * (0.10 + 0.32 * r.z) * ${f(unit)};
        float rise = k * k * (0.25 + 0.65 * r.x) * ${f(unit)};
        ${outputs.gsplat}.center = vec3(axis.x + rel.x, c.y - rise, axis.y + rel.y);
        float p = smoothstep(0.0, 0.3, k);
        ${outputs.gsplat}.scales = mix(${inputs.gsplat}.scales, vec3(${f(PARTICLE_M * unit)}), p);
        ${outputs.gsplat}.rgba.rgb = mix(${inputs.gsplat}.rgba.rgb, vec3(1.0, 0.84, 0.48), p * 0.75);
        float a = mix(${inputs.gsplat}.rgba.a, max(${inputs.gsplat}.rgba.a, 0.85), p);
        ${outputs.gsplat}.rgba.a = a * (1.0 - (isSpark ? smoothstep(0.55, 1.0, k) : smoothstep(0.0, 0.3, k)));
      }
    `),
  });
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
    gsplat: fx.apply({ gsplat, form, gone }).gsplat,
  }));
}

// parent: the group the room scan lives in (upright, y = 0 at the floor).
// spot / faceTo: where she stands and the point she turns to face, in that group.
// scans: her poses in order; hold: seconds each one shows before the next.
export function createSplatJane({
  parent, spot, faceTo, spark, height = 1.75, sparks = SPARKS, hold = HOLD_SEC,
  scans = [JANE_SCANS.surf, JANE_SCANS.new, JANE_SCANS.sing],
}) {
  const root = new THREE.Group();
  root.position.set(spot.x, 0, spot.z);
  root.rotation.y = Math.atan2(faceTo.x - spot.x, faceTo.z - spot.z);
  parent.add(root);

  const poses = scans.map((scan) => {
    const k = height / scan.height;
    const mesh = new SplatMesh({ url: scan.url });
    // Flip upright, scale to her height, feet on the floor at the pivot.
    mesh.rotation.x = Math.PI;
    mesh.scale.setScalar(k);
    mesh.position.set(-scan.cx * k, scan.feetY * k, scan.cz * k);
    mesh.visible = false;
    const form = dyno.dynoFloat(WAVE_END);
    const gone = dyno.dynoFloat(WAVE_START);
    mesh.objectModifier = particleModifier(scan, 1 / k, form, gone, Math.min(1, Math.max(0, sparks)));
    mesh.updateGenerator();
    root.add(mesh);
    const pose = { scan, mesh, form, gone, loaded: false };
    mesh.initialized.then(() => { pose.loaded = true; }, (e) => console.warn('splat Jane: no', scan.url, e));
    return pose;
  });
  const ready = Promise.all(poses.map((p) => p.mesh.initialized));

  // mode: hidden | forming | hold | morph | still
  const st = { mode: 'hidden', t0: 0, now: 0, current: 0, next: -1, chain: false, wantShow: null };
  const nextOf = (i) => (st.chain && i + 1 < poses.length ? i + 1 : -1);

  function set(pose, { visible, form, gone }) {
    pose.mesh.visible = visible;
    if (form !== undefined) pose.form.value = form;
    if (gone !== undefined) pose.gone.value = gone;
    pose.mesh.updateVersion();
  }
  function setFilter() {
    const aa = poses.some((p) => p.mesh.visible && p.scan.aa);
    spark.blurAmount = aa ? AA_BLUR : CLASSIC_BLUR;
  }

  // Form scan i out of particles; with `then`, go on through the scans after
  // it, `hold` seconds each, and stay on the last.
  function appear(i = 0, then = true) {
    i = Math.min(Math.max(0, i), poses.length - 1);
    const w = { i, then };
    st.wantShow = w;
    poses[i].mesh.initialized.then(() => {
      if (st.wantShow !== w) return; // hidden or re-shown while loading
      st.wantShow = null;
      poses.forEach((p, j) => set(p, { visible: j === w.i, form: WAVE_START, gone: WAVE_START }));
      st.current = w.i;
      st.chain = w.then;
      st.next = nextOf(w.i);
      st.mode = 'forming';
      st.t0 = st.now;
      setFilter();
    }, () => {});
  }

  function hide() {
    st.wantShow = null;
    st.mode = 'hidden';
    poses.forEach((p) => set(p, { visible: false, form: WAVE_END, gone: WAVE_START }));
    setFilter();
  }

  function update(t) {
    st.now = t;
    const a = poses[st.current];
    const e = t - st.t0;
    if (st.mode === 'forming') {
      a.form.value = wave(e / FORM_SEC);
      a.mesh.updateVersion();
      if (e >= FORM_SEC) {
        st.mode = st.next >= 0 ? 'hold' : 'still';
        st.t0 = t;
      }
    } else if (st.mode === 'hold' && e >= hold && poses[st.next].loaded) {
      const b = poses[st.next];
      set(b, { visible: true, form: WAVE_START, gone: WAVE_START });
      st.mode = 'morph';
      st.t0 = t;
      setFilter();
    } else if (st.mode === 'morph') {
      const b = poses[st.next];
      a.gone.value = wave(e / MORPH_SEC);
      b.form.value = wave((e - LAG_SEC) / MORPH_SEC);
      a.mesh.updateVersion();
      b.mesh.updateVersion();
      if (e >= MORPH_SEC + LAG_SEC) {
        set(b, { visible: true, form: WAVE_END });
        set(a, { visible: false, gone: WAVE_START, form: WAVE_END });
        st.current = st.next;
        st.next = nextOf(st.current);
        st.mode = st.next >= 0 ? 'hold' : 'still';
        st.t0 = t;
        setFilter();
      }
    }
  }

  // World position of her feet, for the caption and the conversation.
  const position = () => root.getWorldPosition(new THREE.Vector3());

  // Test hook: freeze the effect. what = 'form' (scan i forming) or 'morph'
  // (scan i into scan i + 1), u = 0..1 through it.
  function freeze(what, u, i = 0) {
    st.wantShow = null;
    st.mode = 'frozen';
    poses.forEach((p) => set(p, { visible: false }));
    const a = poses[i], b = poses[i + 1];
    if (what === 'form' || !b) {
      set(a, { visible: true, form: wave(u), gone: WAVE_START });
    } else {
      const e = u * (MORPH_SEC + LAG_SEC);
      set(a, { visible: true, form: WAVE_END, gone: wave(e / MORPH_SEC) });
      set(b, { visible: true, form: wave((e - LAG_SEC) / MORPH_SEC), gone: WAVE_START });
    }
    setFilter();
  }

  return {
    root, ready, appear, hide, update, position, freeze,
    get mode() { return st.mode; },
    get current() { return st.current; },
  };
}
