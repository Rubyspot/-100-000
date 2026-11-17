// The race on its own page: a start card, Enter VR, and a flat preview with
// keyboard controls. The game itself is race.js, which the main experience
// also runs inside its own session.
//
// Test switches (URL): ?autostart (go straight to the preview), ?autopilot
// (rides itself; =sloppy weaves into walls), ?chase, ?map, ?at=N (start at
// control point N), ?debug (fps on the dash, window.simulate(seconds)),
// ?bar=below,ahead (grips this far below and ahead of the eyes, metres),
// ?riser=0.12, ?steer=1.3 (how strongly the hands steer), ?throttle=any (either
// hand is the throttle), ?bill=0.9 (width of a bill, metres), ?fb=0.9 (headset
// resolution scale), ?music=0, ?vignette=0, ?heave=0, ?jane=simple (no scan).
import * as THREE from 'three';
import { createRace } from './race.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const num = (key, fallback) => { const v = parseFloat(params.get(key)); return Number.isFinite(v) ? v : fallback; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
renderer.xr.setFramebufferScaleFactor(num('fb', 0.9));
document.body.prepend(renderer.domElement);

const bar = (params.get('bar') || '').split(',').map(parseFloat);
const race = createRace({
  renderer,
  onExit: () => {
    const session = renderer.xr.getSession();
    if (session) session.end().catch(() => {});
    else showCard();
  },
  options: {
    autopilot: params.has('autopilot') ? (params.get('autopilot') || true) : false,
    chase: params.has('chase') ? (params.get('chase') || true) : false,
    look: params.has('look') ? num('look', -0.14) : null,
    map: params.has('map') ? num('map', 1) : 0,
    at: params.has('at') ? num('at', 0) : null,
    debug: params.has('debug'),
    music: params.get('music') !== '0',
    vignette: params.get('vignette') !== '0',
    streaks: params.get('streaks') !== '0',
    splat: params.get('jane') !== 'simple',
    heave: params.get('heave') === '0' ? 0 : 1,
    ...(bar.length === 2 && bar.every(Number.isFinite) ? { below: bar[0], ahead: bar[1] } : {}),
    ...(params.has('riser') ? { riser: num('riser', 0.12) } : {}),
    ...(params.has('steer') ? { steer: num('steer', 1.3) } : {}),
    ...(params.has('bill') ? { bill: num('bill', 0.9) } : {}),
    ...(params.get('throttle') === 'any' ? { throttle: 'any' } : {}),
  },
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  race.resize(innerWidth, innerHeight);
});
// The lagoon is alive behind the start card too.
renderer.setAnimationLoop((time, frame) => race.frame(time, frame));

const enterBtn = $('enterXr');
const previewBtn = $('preview');
previewBtn.disabled = true;

function showCard() {
  race.stop();
  $('ui').hidden = false;
  $('keys').hidden = true;
}

race.ready.then(() => {
  previewBtn.disabled = false;
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      enterBtn.disabled = !ok;
      statusEl.textContent = ok ? 'Ready. Put on the headset and tap Enter VR.' : 'This browser cannot run VR. Use the preview.';
    }).catch(() => { statusEl.textContent = 'VR check failed. Use the preview.'; });
  } else {
    statusEl.textContent = 'No WebXR here. Use the preview (keyboard controls).';
  }
  if (params.has('debug')) Object.assign(window, { raceApi: race, race: race.debug.race, ai: race.debug.ai, player: race.debug.player, jane: race.debug.jane, world: race.debug.world, gulls: race.debug.gulls, renderer, THREE, simulate: race.simulate });
  if (params.has('autostart')) previewBtn.click();
}).catch((err) => {
  statusEl.textContent = 'Error: ' + (err && err.message ? err.message : err);
  statusEl.style.color = '#ffd23f';
});

enterBtn.addEventListener('click', async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking'],
    });
    session.addEventListener('end', showCard);
    await renderer.xr.setSession(session);
    const ref = renderer.xr.getReferenceSpace();
    if (ref && ref.addEventListener) ref.addEventListener('reset', () => race.recenter());
    $('ui').hidden = true;
    race.start();
  } catch (err) {
    statusEl.textContent = 'Could not start VR: ' + err.message;
  }
});

previewBtn.addEventListener('click', () => {
  $('ui').hidden = true;
  $('keys').hidden = false;
  race.start();
});
