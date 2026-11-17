// 180° side-by-side (left eye | right eye) lat-long video.
// In the headset it plays on a WebXR equirect media layer: the compositor
// samples the video directly, so it stays sharp and costs almost no GPU time.
// Without layers (flat preview, other browsers) it falls back to a textured
// half sphere per eye.
import * as THREE from 'three';

// Streams the video as fragmented MP4 segments through Media Source Extensions,
// so no single file has to fit GitHub's 100 MB limit. Each folder in `bases`
// holds manifest.json ({ label, mime, init, segments, duration }) written by
// tools/segment-original.sh (untouched 8K HEVC master) or tools/encode-video.sh
// (4K H.264 copy). They are tried in order. A source is used when the browser
// can decode it and, if another source follows it, the connection keeps up
// with it. If it fails to decode after all, the next one takes over at the
// same moment in the video.
const MIN_SPEED = 1;   // a segment has to download at least this many times faster than it plays
const GIVE_UP = 2.5;   // stop timing a segment that takes longer than this many times its length
const MANIFEST_WAIT = 6000; // ms before a host that doesn't answer is passed over

async function fetchBytes(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

const nameOf = (source) => source.manifest.label || 'video';

// The sources this browser can decode, in the order given. `notes` collects
// why a source was passed over, for the ?debug label in the headset.
async function findSources(bases, notes) {
  // All manifests at once, so a host that is slow to answer holds nothing up.
  const tries = await Promise.all(bases.map(async (base) => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), MANIFEST_WAIT);
    try {
      const r = await fetch(base + 'manifest.json', { signal: stop.signal });
      if (!r.ok) throw new Error(`${r.status} for manifest.json`);
      return { base, manifest: await r.json() };
    } catch (error) {
      return { base, error };
    } finally {
      clearTimeout(timer);
    }
  }));
  const found = [];
  for (const { base, manifest, error } of tries) {
    if (error) {
      notes.push('a source is unreachable');
      console.info(`video: skipping ${base}`, error);
    } else if (window.MediaSource && MediaSource.isTypeSupported(manifest.mime)) {
      found.push({ base, manifest });
    } else {
      notes.push(`${nameOf({ manifest })} can't decode`);
      console.info(`video: skipping ${base}, can't decode ${manifest.mime}`);
    }
  }
  return found;
}

// Does the connection keep up with this source? Times its first segment, and
// the second too if the first was slow (the page's other downloads compete
// with it while everything loads). What it fetched goes into `have` (segment
// index -> bytes) for the player.
async function keepsUp({ base, manifest }, have) {
  const segSec = manifest.duration / manifest.segments.length;
  for (let i = 0; i < Math.min(2, manifest.segments.length); i++) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), GIVE_UP * segSec * 1000);
    try {
      const url = new URL(base + manifest.segments[i], location.href).href;
      const r = await fetch(url, { signal: stop.signal });
      if (!r.ok) throw new Error(`${r.status} for ${manifest.segments[i]}`);
      const t0 = performance.now();
      const bytes = new Uint8Array(await r.arrayBuffer());
      // The browser's own record of the download is not thrown off by a busy
      // page; another site's file only shows its start and end there.
      const rec = performance.getEntriesByName(url).pop();
      const ms = rec && rec.responseEnd > 0
        ? rec.responseEnd - (rec.responseStart || rec.startTime)
        : performance.now() - t0;
      const speed = segSec / Math.max(0.001, ms / 1000);
      have.set(i, bytes);
      console.info(`video: ${base} segment ${i} came in at ${speed.toFixed(1)}x playing speed`);
      if (speed >= MIN_SPEED) return true;
    } catch (e) {
      console.info(`video: ${base} segment ${i} didn't arrive in time`, e.name || e);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

// Plays one source into the video element. `ready` resolves once the first
// segment is in, or rejects if the source can't start; onFail is called if it
// breaks after that. detach() lets go of the element.
function streamSource(video, { base, manifest }, have = new Map(), onFail = () => {}) {
  const ms = new MediaSource();
  const url = URL.createObjectURL(ms);
  let dead = false, started = false, failed = false, rejectReady;
  const fail = (err) => {
    if (dead || failed) return;
    failed = true;
    if (started) onFail(err); else rejectReady(err);
  };
  const onError = () => fail(video.error || new Error('video error'));
  let pump = () => {}, onSeeking = () => {};

  async function setUp() {
    video.addEventListener('error', onError);
    video.src = url;
    await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
    ms.duration = manifest.duration;
    const sb = ms.addSourceBuffer(manifest.mime);
    const appended = () => new Promise((r) => sb.addEventListener('updateend', r, { once: true }));

    sb.appendBuffer(await fetchBytes(base + manifest.init));
    await appended();

    // Keep about BUDGET bytes buffered ahead of the playhead: the 8K master runs
    // ~16 MB/s and browsers cap a SourceBuffer at a few hundred MB. Keep a little
    // behind it too, more for the lighter 4K copy, so "back 10 s" is instant there.
    const BUDGET = 120e6;
    const n = manifest.segments.length, segSec = manifest.duration / n;
    let ahead = 24, behind = 3, next = 0, busy = false, gen = 0;
    pump = async () => {
      if (dead || failed || busy || ms.readyState === 'closed') return;
      busy = true;
      const g = gen;
      try {
        const end = sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
        if (sb.buffered.length && sb.buffered.start(0) < video.currentTime - behind - 1) {
          sb.remove(0, video.currentTime - behind);
          await appended();
        }
        if (next < n && end - video.currentTime < ahead) {
          const i = next;
          const bytes = have.get(i) || await fetchBytes(base + manifest.segments[i]);
          have.delete(i);
          if (dead || g !== gen) return; // let go of, or the viewer skipped while this segment was loading
          const rate = bytes.length / segSec;
          ahead = Math.max(2 * segSec, Math.min(24, BUDGET / rate));
          behind = rate < 8e6 ? 12 : 3;
          try {
            sb.appendBuffer(bytes);
            await appended();
            next = i + 1;
          } catch (e) {
            if (e.name !== 'QuotaExceededError') throw e;
            ahead = Math.max(2 * segSec, ahead / 2); // buffer full: retry this segment later
            busy = false;
            setTimeout(pump, 500);
            return;
          }
        } else if (next >= n) {
          if (ms.readyState === 'open' && !sb.updating) ms.endOfStream();
          return;
        }
      } catch (e) {
        fail(e);
        return;
      } finally {
        busy = false;
      }
      setTimeout(pump, 0);
    };
    // A skip to a time that isn't buffered: drop what is, and load from the
    // segment holding the new time.
    onSeeking = async () => {
      const t = video.currentTime;
      for (let i = 0; i < sb.buffered.length; i++) {
        if (t >= sb.buffered.start(i) && t < sb.buffered.end(i) - 0.3) { pump(); return; }
      }
      const g = ++gen;
      while (busy || sb.updating) await new Promise((r) => setTimeout(r, 25));
      if (dead || g !== gen) return;
      next = Math.min(n - 1, Math.max(0, Math.floor(t / segSec)));
      try {
        if (sb.buffered.length) {
          sb.remove(0, Infinity);
          await appended();
        }
      } catch (e) {
        fail(e);
        return;
      }
      pump();
    };
    video.addEventListener('timeupdate', pump);
    video.addEventListener('seeking', onSeeking);
    await pump();
  }

  const ready = new Promise((resolve, reject) => {
    rejectReady = reject;
    setUp().then(() => { started = true; if (!failed) resolve(); }, fail);
  });
  function detach() {
    dead = true;
    video.removeEventListener('error', onError);
    video.removeEventListener('timeupdate', pump);
    video.removeEventListener('seeking', onSeeking);
    if (video.src === url) { video.removeAttribute('src'); video.load(); }
    URL.revokeObjectURL(url);
  }
  return { ready, detach };
}

// onSource(source, notes) is called with the source that plays ({ base,
// manifest }) and why any others were passed over, onSwap(time) after a later
// source took over from one that broke.
async function attachSegments(video, bases, { onSource, onSwap } = {}) {
  const notes = [];
  const sources = await findSources(bases, notes);
  if (!sources.length) throw new Error(`No playable video in ${bases.join(', ')}`);

  // Start with the first source the connection keeps up with; the last one
  // plays whatever the connection, since nothing lighter follows it.
  let first = 0, have = new Map();
  while (first < sources.length - 1 && !(await keepsUp(sources[first], have))) {
    console.info(`video: this connection is too slow for ${sources[first].base}`);
    notes.push(`${nameOf(sources[first])} too slow`);
    first += 1;
    have = new Map();
  }

  async function use(i, fetched) {
    for (; i < sources.length; i += 1, fetched = undefined) {
      const at = i;
      const stream = streamSource(video, sources[at], fetched, (err) => {
        // It played and then broke: carry on with the next source, if there is one.
        console.warn(`video: ${sources[at].base} stopped working`, err);
        notes.push(`${nameOf(sources[at])} failed`);
        if (at + 1 >= sources.length) return;
        const t = video.currentTime || 0;
        stream.detach();
        use(at + 1).then(() => onSwap?.(t), (e) => console.warn('video:', e));
      });
      try {
        await stream.ready;
        console.info(`video: playing ${sources[at].base} (${sources[at].manifest.mime})`);
        onSource?.(sources[at], notes);
        return;
      } catch (err) {
        stream.detach();
        notes.push(`${nameOf(sources[at])} failed`);
        console.warn(`video: ${sources[at].base} didn't start`, err);
      }
    }
    throw new Error(`No playable video in ${bases.join(', ')}`);
  }
  await use(first, have);
}

export class Video180 {
  constructor({ renderer, scene, src }) {
    this.renderer = renderer;
    this.src = src;
    this.layer = null;
    this.playing = false;
    this.onEnded = null;
    this.label = ''; // which source plays ("8K", "4K"), from its manifest
    this.note = '';  // the same plus why others were passed over, for ?debug

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('ended', () => this.stop());
    this.video = video;
    this.ready = this.load();

    // Fallback: half sphere, one per eye (camera layers 1 and 2 are the eyes in WebXR).
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const geo = new THREE.SphereGeometry(30, 96, 48, Math.PI, Math.PI); // front half, centred on -Z
    this.root = new THREE.Group();
    this.eyes = [0, 0.5].map((offset, i) => {
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false,
        uniforms: { map: { value: tex }, offset: { value: offset } },
        vertexShader: /* glsl */`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */`
          uniform sampler2D map; uniform float offset; varying vec2 vUv;
          void main() {
            // Seen from inside, u runs right to left; flip it.
            gl_FragColor = texture2D(map, vec2((1.0 - vUv.x) * 0.5 + offset, vUv.y));
            #include <colorspace_fragment>
          }`,
      }));
      mesh.renderOrder = -40;
      mesh.userData.eye = i + 1;
      this.root.add(mesh);
      return mesh;
    });
    // Behind the viewer: dark, so the 180° edge reads as a stage, not a hole.
    const back = new THREE.Mesh(
      new THREE.SphereGeometry(29, 32, 16, 0, Math.PI),
      new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.BackSide, depthWrite: false }),
    );
    back.renderOrder = -41;
    this.root.add(back);
    this.root.visible = false;
    scene.add(this.root);
  }

  async load() {
    const srcs = [].concat(this.src).filter(Boolean);
    if (srcs.length === 1 && /\.(mp4|webm|mov)$/i.test(srcs[0])) this.video.src = srcs[0];
    else {
      await attachSegments(this.video, srcs, {
        onSource: (source, notes) => {
          this.label = source.manifest.label || '';
          this.note = (this.label || 'video') + (notes.length ? ` (${notes.join(', ')})` : '');
        },
        // A source broke and the next one took over: pick up where it was.
        onSwap: (time) => {
          this.video.currentTime = time;
          if (this.playing) this.video.play().catch(() => {});
        },
      });
    }
  }

  // Call inside a user gesture (the Enter button) so later play() calls are allowed with sound.
  unlock() {
    const v = this.video;
    const p = v.play();
    if (p) p.then(() => { if (!this.playing) v.pause(); }).catch(() => {});
  }

  // pose: THREE.Object3D whose world position/rotation is the viewer's head
  // position and forward direction when the video starts.
  // rig: optional parent of the camera; the media layer lives in XR
  // reference space, which moves with it.
  async play(pose, rig = null) {
    await this.ready;
    const { renderer, video } = this;
    this.playing = true;
    video.currentTime = 0;
    pose.updateMatrixWorld(true);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    pose.matrixWorld.decompose(pos, quat, new THREE.Vector3());

    const session = renderer.xr.getSession();
    if (session && window.XRMediaBinding && session.renderState.layers) {
      const binding = new XRMediaBinding(session);
      this.layer = binding.createEquirectLayer(video, {
        space: renderer.xr.getReferenceSpace(),
        layout: 'stereo-left-right',
        transform: (() => {
          const m = pose.matrixWorld.clone();
          if (rig) m.premultiply(rig.matrixWorld.clone().invert());
          const p = new THREE.Vector3(), q = new THREE.Quaternion();
          m.decompose(p, q, new THREE.Vector3());
          return new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
        })(),
        radius: 0, // infinitely far, no parallax with head movement
        centralHorizontalAngle: Math.PI,
        upperVerticalAngle: Math.PI / 2,
        lowerVerticalAngle: -Math.PI / 2,
      });
      session.updateRenderState({ layers: [this.layer, ...session.renderState.layers] });
      this.eyes.forEach((m) => { m.visible = false; });
    } else {
      this.eyes.forEach((m) => { m.visible = true; });
    }
    this.root.position.copy(pos);
    this.root.quaternion.copy(quat);
    this.root.visible = true;
    await video.play();
  }

  get paused() { return this.video.paused; }
  get currentTime() { return this.video.currentTime || 0; }
  get duration() { return Number.isFinite(this.video.duration) ? this.video.duration : 0; }
  togglePause() {
    if (!this.playing) return;
    if (this.video.paused) this.video.play().catch(() => {});
    else this.video.pause();
  }
  seekBy(seconds) {
    if (!this.playing) return;
    const v = this.video;
    v.currentTime = Math.min(Math.max(0, this.duration - 0.5), Math.max(0, v.currentTime + seconds));
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.video.pause();
    const session = this.renderer.xr.getSession();
    if (this.layer && session) {
      session.updateRenderState({ layers: session.renderState.layers.filter((l) => l !== this.layer) });
      this.layer.destroy?.();
    }
    this.layer = null;
    this.root.visible = false;
    this.onEnded?.();
  }

  // Each frame: show the right half-sphere to each eye in the fallback path.
  update() {
    const xr = this.renderer.xr.isPresenting;
    this.eyes.forEach((m, i) => {
      if (xr) m.layers.set(m.userData.eye);
      else m.layers.set(i === 0 ? 0 : 3); // flat preview: left eye only
    });
  }
}
