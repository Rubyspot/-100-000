// 180° side-by-side (left eye | right eye) lat-long video.
// In the headset it plays on a WebXR equirect media layer: the compositor
// samples the video directly, so it stays sharp and costs almost no GPU time.
// Without layers (flat preview, other browsers) it falls back to a textured
// half sphere per eye.
import * as THREE from 'three';

// Streams the video as fragmented MP4 segments through Media Source Extensions,
// so no single file has to fit GitHub's 100 MB limit. `base` holds
// manifest.json ({ mime, init, segments, duration }) written by tools/encode-video.sh.
async function attachSegments(video, base) {
  const manifest = await (await fetch(base + 'manifest.json')).json();
  if (!window.MediaSource || !MediaSource.isTypeSupported(manifest.mime)) {
    throw new Error(`This browser can't play ${manifest.mime}`);
  }
  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
  ms.duration = manifest.duration;
  const sb = ms.addSourceBuffer(manifest.mime);
  const appended = () => new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
  const fetchBytes = async (name) => new Uint8Array(await (await fetch(base + name)).arrayBuffer());

  sb.appendBuffer(await fetchBytes(manifest.init));
  await appended();

  let next = 0, busy = false;
  const AHEAD = 24, BEHIND = 10; // seconds kept buffered around the playhead
  async function pump() {
    if (busy || ms.readyState !== 'open') return;
    busy = true;
    try {
      const end = sb.buffered.length ? sb.buffered.end(sb.buffered.length - 1) : 0;
      if (video.currentTime - BEHIND > 1 && sb.buffered.length && sb.buffered.start(0) < video.currentTime - BEHIND) {
        sb.remove(0, video.currentTime - BEHIND);
        await appended();
      }
      if (next < manifest.segments.length && end - video.currentTime < AHEAD) {
        const bytes = await fetchBytes(manifest.segments[next++]);
        sb.appendBuffer(bytes);
        await appended();
      } else if (next >= manifest.segments.length) {
        ms.endOfStream();
        return;
      }
    } finally {
      busy = false;
    }
    setTimeout(pump, 0);
  }
  video.addEventListener('timeupdate', pump);
  video.addEventListener('seeking', pump);
  await pump();
}

export class Video180 {
  constructor({ renderer, scene, src }) {
    this.renderer = renderer;
    this.src = src;
    this.layer = null;
    this.playing = false;
    this.onEnded = null;

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
    if (/\.(mp4|webm|mov)$/i.test(this.src)) this.video.src = this.src;
    else await attachSegments(this.video, this.src);
  }

  // Call inside a user gesture (the Enter button) so later play() calls are allowed with sound.
  unlock() {
    const v = this.video;
    const p = v.play();
    if (p) p.then(() => { if (!this.playing) v.pause(); }).catch(() => {});
  }

  // pose: THREE.Object3D whose world position/rotation is the viewer's head
  // position and forward direction when the video starts.
  async play(pose) {
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
        transform: new XRRigidTransform(
          { x: pos.x, y: pos.y, z: pos.z },
          { x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
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
