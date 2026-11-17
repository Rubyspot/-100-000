// The $100,000 jetski race, as a module: the race page runs it on its own,
// and the main experience runs it inside its own VR session when the player
// touches the floating jetski after the video.
//
// One lap of a tropical lagoon, about two minutes: a start straight, a long
// bend, a fast rock canal, a slalom between limestone stacks, a tighter
// canal and a jump back into the lagoon, with inflatable ramps on the way.
// Seagulls fly ahead and drop a trail of $100 bills along the racing line.
// Ride through them: each bill in a row is worth $250 more, up to $2,500,
// and the song's $100,000 comes with ease on a decent lap. Jane (her first
// scan) races you standing on her own jetski.
//
//   const race = createRace({ renderer, embedded, onExit, options });
//   await race.ready;       // assets loaded, world built, shaders compiled
//   race.start();           // sit the player on the jetski
//   race.frame(time, xrFrame);   // every frame while it runs (draws too)
import * as THREE from 'three';
import { createSky, SUN_DIR, HAZE_COLOR } from './sky.js';
import { createOcean } from './ocean.js';
import { buildWorld, PINK, YELLOW } from './world.js';
import { Craft } from './craft.js';
import { loadJetski, makeJetski, makeGloves, makeJaneRider, makeSimpleRider, SEAT } from './models.js';
import { createWake, createSpray, createStreaks, createConfetti } from './effects.js';
import { Sfx } from './sfx.js';
import { createControls } from './controls.js';
import { createHud, loadFonts, money, clock, COLORS } from './hud.js';
import { loadGullAssets, createGulls, MAX_COMBO, STEP_VALUE } from './gulls.js';

export const GOAL = 100000;
const START_BACK = 12;     // the grid is this far before the start arch, metres
const TRACKS = ['indecision-let-that-go.mp3', 'seagulls-love-too.mp3', 'on-my-own.mp3'].map((f) => new URL('./audio/' + f, import.meta.url).href);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

export function createRace({ renderer, embedded = false, onExit = null, options = {} }) {
  const O = {
    autopilot: false,      // true, 'wander' or 'sloppy': rides by itself, for testing
    chase: false, map: 0,  // flat previews from behind (or 'jane': looking at her) and from above
    look: null,            // flat preview: pitch of the rider's view, radians
    at: null,              // start at this control point (testing)
    debug: false, music: true, vignette: true, splat: true, streaks: true,
    heave: 1,              // 0 keeps the rider's view at a fixed height
    below: SEAT.below, ahead: SEAT.ahead, riser: SEAT.riser,
    exposure: 1.0,
    ...options,
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 6000);
  // The holder follows the player's jetski (position, heading, and a
  // smoothed height). The rig inside it is the XR reference space, placed so
  // the player's head is where a rider's would be. The view never pitches or
  // rolls with the hull.
  const holder = new THREE.Group();
  const rig = new THREE.Group();
  scene.add(holder); holder.add(rig); rig.add(camera);
  const listener = new THREE.AudioListener();
  camera.add(listener);
  scene.fog = new THREE.FogExp2(HAZE_COLOR.getHex(), 0.0014);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x8f9474, 1.25));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);

  // Filled in by build().
  let sky, world, ocean, course, hud, gulls, controls, sfx, spray, confetti, streaks, spark = null;
  const player = { craft: new Craft(), ski: null, wake: null, gloves: null };
  const jane = { craft: new Craft(), ski: null, wake: null, rider: null };
  const layout = { grips: [new THREE.Vector3(), new THREE.Vector3()], pivot: new THREE.Vector3(), fit: new THREE.Vector3() };
  let eyeY = 1.5;
  let built = false, active = false;

  const race = {
    state: 'off', clock: 0, countdown: 0, lastBeep: 9, dist: -START_BACK, idx: 0, lat: 0, off: 0, finish: null, rank: 2,
    barkAt: -99, msgUntil: 0, doneAt: 0, readyAt: 0, stuck: 0, lost: 0, wrong: 0, gateNext: 1, goalHit: false, halfHit: false, maxHit: false, moreHit: 1,
    hits: 0, airPeak: 0, wasRamp: false, result: null, shown: false, lastCanal: false, greeted: false, shift: 0,
  };
  const ai = { dist: -START_BACK, idx: 0, lat: 0, off: 0, finish: null, side: 0 };
  let elapsed = 0, lastTime = 0, calibrated = false, calibAt = 0, viewY = -0.2, fadeV = 0, fadeTo = 0, scrape = 0, slapCool = 0, missCool = 0;
  let engineP = null, engineJ = null, pannerJ = null, audioOn = false;
  let frames = 0, fpsT = 0, fps = 0, skipRender = false, exiting = false, pendingReset = false;

  // ---------- build ----------

  const ready = (async () => {
    const fontP = loadFonts();
    const sparkP = O.splat ? import('@sparkjsdev/spark').catch(() => null) : Promise.resolve(null);
    const [font] = await Promise.all([fontP, loadJetski(), loadGullAssets()]);
    sky = createSky(renderer);
    world = buildWorld({ sky, font });
    course = world.course;
    ocean = createOcean({ sky, landTexture: world.landTexture, landBounds: world.landBounds, landDist: world.landDist });
    scene.add(sky.dome, world.group, ocean.mesh);
    scene.environment = sky.env;

    player.ski = makeJetski(YELLOW, sky.env, { riser: O.riser, below: O.below, ahead: O.ahead, accent: PINK });
    jane.ski = makeJetski(PINK, sky.env, { riser: 0.36, accent: YELLOW });
    player.gloves = makeGloves(player.ski);
    scene.add(player.ski.root, jane.ski.root);
    eyeY = player.ski.eye.y;
    const bar = player.ski.bar.position, gx = player.ski.grips[1].position.x;
    layout.pivot.copy(bar);
    layout.grips[0].set(-gx, bar.y, bar.z);
    layout.grips[1].set(gx, bar.y, bar.z);

    // Jane: her scan standing on her jetski, or simple shapes if it can't load.
    const sparkLib = await sparkP;
    if (sparkLib) {
      try {
        spark = new sparkLib.SparkRenderer({ renderer, maxStdDev: 2.4 });
        spark.blurAmount = 0.3;
        scene.add(spark);
        jane.rider = makeJaneRider(jane.ski, sparkLib.SplatMesh);
        jane.rider.ready.catch(() => { jane.rider.stand.removeFromParent(); makeSimpleRider(jane.ski); });
      } catch { spark = null; }
    }
    if (!jane.rider) makeSimpleRider(jane.ski);

    sfx = new Sfx(listener);
    sfx.loadRecorded().catch(() => {});
    player.wake = createWake(scene, ocean);
    jane.wake = createWake(scene, ocean);
    spray = createSpray(scene, sky.uniforms.sunColor.value);
    confetti = createConfetti(scene);
    streaks = O.streaks ? createStreaks(holder) : null;
    controls = createControls({ renderer, holder, rig });
    hud = createHud({ holder, camera, font, eyeY, embedded, goal: GOAL, maxCombo: MAX_COMBO });
    hud.attach(player.ski);
    gulls = createGulls({ scene, world, ocean, listener, onPickup, onMiss });
    built = true;
    resetRace();
    race.state = 'off';

    // Compile the shaders and upload the buffers now, not on the first frame in the headset.
    const tone = renderer.toneMapping, exp = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = O.exposure;
    try { await renderer.compileAsync(scene, camera); } catch { /* compiled on first use instead */ }
    if (embedded && !renderer.xr.isPresenting) {
      const size = renderer.getSize(new THREE.Vector2());
      renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
      try { placeAll(0); renderer.render(scene, camera); } catch { /* first frame does it */ }
      renderer.setScissorTest(false); renderer.setScissor(0, 0, size.x, size.y);
    }
    renderer.toneMapping = tone; renderer.toneMappingExposure = exp;
    return api;
  })();

  // ---------- race state ----------

  const idxAt = (dist) => ((Math.round(dist / course.step) % course.SAMPLES) + course.SAMPLES) % course.SAMPLES;

  function resetRace() {
    let d0 = -START_BACK;
    if (O.at !== null) d0 = course.idxOfCp(O.at) * course.step;
    const i = idxAt(d0), p = course.pts[i], t = course.tans[i], r = course.rights[i];
    const yaw = Math.atan2(-t.x, -t.z);
    player.craft.reset(p.x - r.x * 3.4, p.z - r.z * 3.4, yaw);
    jane.craft.reset(p.x + r.x * 3.4, p.z + r.z * 3.4, yaw);
    for (const c of [player.craft, jane.craft]) c.y = ocean.heightAt(c.x, c.z, elapsed) - 0.2;
    player.craft.thrustScale = 1; jane.craft.thrustScale = 1;
    Object.assign(race, {
      state: 'ready', clock: 0, dist: d0, idx: i, finish: null, rank: 2, readyAt: elapsed, stuck: 0, lost: 0, wrong: 0,
      goalHit: false, halfHit: false, maxHit: false, moreHit: 1, hits: 0, airPeak: 0, wasRamp: false, msgUntil: 0, barkAt: elapsed - 4,
      result: null, shown: false, lastCanal: false, greeted: false, shift: 0,
    });
    race.gateNext = world.gates.findIndex((g, n) => n > 0 && g.idx * course.step > d0);
    if (race.gateNext < 0) race.gateNext = world.gates.length;
    Object.assign(ai, { dist: d0, idx: i, finish: null, side: 0 });
    viewY = player.craft.y;
    layout.fit.set(0, 0, 0);
    player.wake.reset(); jane.wake.reset();
    gulls.reset(elapsed);
    controls.release();
    hud.results(null, elapsed);
    hud.panel('');
    exiting = false;
    if (O.at !== null && O.autopilot) race.state = 'race';
  }

  function bark(text, force = false) {
    if (!force && elapsed - race.barkAt < 6) return false;
    race.barkAt = elapsed;
    hud.say(text, elapsed);
    return true;
  }
  const pick = (list) => list[(Math.random() * list.length) | 0];

  function onPickup(b, value) {
    const s = gulls.state, pc = player.craft;
    sfx.pickup(s.combo, b.gold);
    hud.pop('+' + money(value), b.gold ? COLORS.mint : s.combo >= MAX_COMBO ? COLORS.yellow : COLORS.cream);
    confetti.burst(b.pos.x, b.pos.y, b.pos.z, b.gold ? 46 : 7, b.gold ? 5 : 2.4, pc.vx * 0.8, pc.vz * 0.8);
    pc.thrustScale = 1 + 0.012 * s.combo;
    if (b.gold) { pc.boost = Math.max(pc.boost, 1.6); sfx.boost(); bark(pick(['Golden! Ten grand, just like that!', 'Ooh, the gold one!']), true); }
    if (s.combo >= MAX_COMBO && !race.maxHit) {
      race.maxHit = true; race.msgUntil = elapsed + 1.6;
      hud.panel('CRISPY x10!', `Every bill is ${money(STEP_VALUE * MAX_COMBO)} now`, { color: COLORS.pink });
      sfx.chime(5);
    }
    if (!race.halfHit && s.money >= GOAL / 2) { race.halfHit = true; bark('Halfway to a hundred grand. Keep flowing!', true); }
    // The song's line: "Blessings to me, a hundred thousand, it happened with ease."
    if (!race.goalHit && s.money >= GOAL) {
      race.goalHit = true; race.msgUntil = elapsed + 2.8;
      hud.panel('$100,000!', 'It happened with ease', { color: COLORS.yellow });
      sfx.fanfare(true);
      confetti.burst(pc.x, pc.y + 2.2, pc.z, 90, 7, pc.vx, pc.vz);
      bark('Blessings to you! A hundred thousand!', true);
    }
    const more = Math.floor(s.money / GOAL);
    if (more >= 2 && more > race.moreHit) {
      race.moreHit = more;
      bark(more === 2 ? 'Two hundred grand?! Abundance never dries out!' : 'Okay, save some for the seagulls!', true);
      sfx.chime(6);
    }
  }
  function onMiss() {
    if (missCool > 0) return;
    missCool = 1.5;
    sfx.miss();
    if (gulls.state.combo <= 2) bark(pick(['Follow the bills, they show the way!', 'The gulls are dropping money. Take it!']));
  }

  // ---------- seating ----------

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _cam = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const head = { pos: new THREE.Vector3(), ok: false };
  // Put the player's head where the rider's is, facing along the jetski.
  function calibrate(xrFrame) {
    if (!readHead(xrFrame)) return false;
    // Heading from the head's right-hand direction, which stays level when looking down at the bar.
    const right = _a.set(1, 0, 0).applyQuaternion(_q);
    const yaw = Math.atan2(-right.z, right.x);
    rig.rotation.set(0, -yaw, 0);
    _b.set(head.pos.x, 0, head.pos.z).applyAxisAngle(UP, -yaw);
    rig.position.set(-_b.x, eyeY - head.pos.y, -_b.z);
    rig.updateMatrix();
    layout.fit.set(0, 0, 0);
    calibrated = true; calibAt = elapsed;
    return true;
  }
  function readHead(xrFrame) {
    head.ok = false;
    try {
      const ref = renderer.xr.getReferenceSpace();
      const pose = xrFrame && ref ? xrFrame.getViewerPose(ref) : null;
      if (!pose) return false;
      const p = pose.transform.position, o = pose.transform.orientation;
      head.pos.set(p.x, p.y, p.z); _q.set(o.x, o.y, o.z, o.w);
      head.ok = true;
    } catch { head.ok = false; }
    return head.ok;
  }

  // ---------- simulation ----------

  const env = {
    t: 0,
    surface: (x, z) => ocean.heightAt(x, z, env.t),
    rampHeight: (x, z) => world.rampHeight(x, z),
  };

  function advance(state, c) {
    const n = course.nearest(c.x, c.z, state.idx, 60);
    let delta = n.idx - state.idx;
    if (delta > course.SAMPLES / 2) delta -= course.SAMPLES;
    if (delta < -course.SAMPLES / 2) delta += course.SAMPLES;
    state.idx = n.idx; state.dist += delta * course.step; state.lat = n.lat; state.off = n.dist;
  }

  // Steer a craft along the racing line (Jane, and the autopilot used in
  // tests): aim at a point ahead on the line, and close the sideways gap.
  function follow(c, state, lat, gain = 2.6) {
    const look = 6 + c.speed * 0.5;
    const i = idxAt(state.dist + look);
    const p = course.pts[i], r = course.rights[i];
    const tx = p.x + r.x * (course.lineLat[i] + lat), tz = p.z + r.z * (course.lineLat[i] + lat);
    const rel = wrapAngle(Math.atan2(-(tx - c.x), -(tz - c.z)) - c.yaw);
    const cross = state.lat - (course.lineLat[state.idx] + lat);
    return clamp(rel * gain + clamp(cross, -4, 4) * 0.09 - c.yawRate * 0.28, -1, 1);
  }

  function aiControls(dt) {
    const c = jane.craft, pc = player.craft;
    advance(ai, c);
    if (race.state !== 'race' && race.state !== 'done') return { throttle: 0, steer: 0 };
    // Give the player room when side by side.
    const i = ai.idx, r = course.rights[i];
    const dx = pc.x - c.x, dz = pc.z - c.z;
    let side = 0;
    if (Math.hypot(dx, dz) < 9) side = (dx * r.x + dz * r.z > 0 ? -1 : 1) * Math.min(2.2, Math.max(0, course.half[i] - 4));
    ai.side += (side - ai.side) * Math.min(1, dt * 1.5);
    let throttle = 1;
    c.thrustScale = 0.97;
    if (ai.finish !== null) throttle = 0.3;
    else {
      // Rubber band: she waits when she gets ahead, and digs in when far behind,
      // so the race stays close and a tidy lap beats her.
      const gap = ai.dist - race.dist;
      if (gap > 30) throttle = 0.72;
      else if (gap > 12) throttle = 0.88;
      else if (gap < -60) c.thrustScale = 1.3;
      else if (gap < -25) c.thrustScale = 1.15;
    }
    return { throttle, steer: follow(c, ai, ai.side, 2.8) };
  }

  function bump(a, b) {
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
    if (d < 2.5 && d > 0.001) {
      const push = (2.5 - d) / 2, nx = dx / d, nz = dz / d;
      a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push;
      const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rv < 0) { a.vx -= rv * nx * 0.6; a.vz -= rv * nz * 0.6; b.vx += rv * nx * 0.6; b.vz += rv * nz * 0.6; return -rv; }
    }
    return 0;
  }

  const drive = { throttle: 0, steer: 0 };
  function physics(dt, input) {
    env.t = elapsed;
    const pc = player.craft, jc = jane.craft;
    const racing = race.state === 'race';
    drive.throttle = racing ? input.throttle : 0;
    drive.steer = input.steer;
    if (race.state === 'done') { drive.throttle = elapsed - race.doneAt < 2 ? 0.35 : 0; drive.steer = follow(pc, race, 0); }
    else if (O.autopilot && racing) {
      // 'wander' drifts off the line and back like a first-time rider; 'sloppy' weaves into walls.
      const wander = O.autopilot === 'wander' ? 3.6 * (Math.sin(elapsed * 0.31) + 0.6 * Math.sin(elapsed * 0.83 + 1)) : 0;
      drive.throttle = 1; drive.steer = follow(pc, race, wander, O.autopilot === 'wander' ? 1.8 : 2.6);
      if (O.autopilot === 'sloppy') drive.steer = clamp(drive.steer + Math.sin(elapsed * 1.1) * 0.9, -1, 1);
    }
    pc.step(dt, drive, env);
    jc.step(dt, aiControls(dt), env);
    const b = bump(pc, jc);
    if (b > 2) { sfx.thud(b, null); if (racing) bark(pick(['Hey! Watch my paint!', 'Bumper boats? Okay!'])); }

    const hit = world.collide(pc, dt);
    scrape = hit.scrape * (hit.hit > 0 || world.landDist(pc.x, pc.z) < 1.3 ? 1 : 0);
    if (hit.hit > 1.6) {
      sfx.thud(hit.hit, null);
      spray.burst(pc.x, ocean.heightAt(pc.x, pc.z, elapsed) + 0.3, pc.z, Math.min(3, hit.hit * 0.4));
      if (racing) {
        race.hits++;
        gulls.knock();
        pc.thrustScale = 1 + 0.012 * gulls.state.combo;
        if (hit.hit > 4.5) bark(pick(course.walled[race.idx] ? ['Rocks are hard, huh?', 'That canal bites!'] : ['Watch the rocks!', 'Careful, that island was there first.']));
      }
    }
    world.collide(jc, dt);

    // Ramps: a boing off the lip, a splash and maybe a boost on the way down.
    const onRamp = world.rampHeight(pc.x, pc.z) > -1e3;
    if (race.wasRamp && !onRamp && pc.speed > 7) sfx.boing();
    race.wasRamp = onRamp;
    if (pc.airborne) race.airPeak = Math.max(race.airPeak, pc.airTime);
    slapCool -= dt;
    for (const c of [pc, jc]) {
      if (c === pc && c.landing > 0.35 && c.landing < 1.5 && slapCool < 0) { sfx.slap(c.landing); slapCool = 0.18; }
      if (c.landing < 1.5) continue;
      const w = ocean.heightAt(c.x, c.z, elapsed);
      sfx.splash(c.landing, c === pc ? null : _a.set(c.x, w, c.z));
      spray.burst(c.x, w + 0.1, c.z, c.landing);
      if (c === pc) {
        if (race.airPeak > 0.8 && racing) {
          pc.boost = Math.max(pc.boost, 0.7 + Math.min(1.1, race.airPeak - 0.8));
          sfx.boost();
          bark(pick(race.airPeak > 1.3 ? ['Whoa! Big air!', 'You can fly?!'] : ['Nice jump!', 'Stuck the landing!']));
        }
        race.airPeak = 0;
      }
    }

    advance(race, pc);
    if (!racing) return;
    // Gates chime as you ride through them.
    const g = world.gates[race.gateNext];
    if (g && race.dist >= g.idx * course.step) {
      if (Math.abs(race.lat) < g.half + 1.5) sfx.gate();
      race.gateNext++;
    }
    // Stuck on a rock, lost at sea or facing the wrong way.
    race.stuck = drive.throttle > 0.5 && pc.speed < 1.3 ? race.stuck + dt : 0;
    race.lost = race.off > 80 ? race.lost + dt : 0;
    const t = course.tans[race.idx];
    const along = -Math.sin(pc.yaw) * t.x - Math.cos(pc.yaw) * t.z;
    race.wrong = along < -0.35 && pc.speed > 4 ? race.wrong + dt : 0;
    if (race.stuck > 3.5 || race.lost > 5) respawn();
  }

  function respawn() {
    const i = race.idx, p = course.pts[i], t = course.tans[i], r = course.rights[i], lat = course.lineLat[i];
    player.craft.reset(p.x + r.x * lat, p.z + r.z * lat, Math.atan2(-t.x, -t.z));
    player.craft.y = ocean.heightAt(player.craft.x, player.craft.z, elapsed) - 0.2;
    player.craft.thrustScale = 1 + 0.012 * gulls.state.combo;
    race.stuck = 0; race.lost = 0;
    fadeV = 1; fadeTo = 0;
    player.wake.reset();
    bark('Back on the line. Go go go!', true);
  }

  // ---------- one frame ----------

  function placeAll(dt) {
    const pc = player.craft, jc = jane.craft, ps = player.ski, js = jane.ski;
    ps.root.position.set(pc.x, pc.y, pc.z);
    ps.root.rotation.y = pc.yaw;
    ps.body.rotation.set(pc.pitch, 0, pc.lean * 0.35, 'YXZ');
    ps.bar.rotation.y = pc.steer * 0.42;
    js.root.position.set(jc.x, jc.y, jc.z);
    js.root.rotation.y = jc.yaw;
    js.body.rotation.set(jc.pitch, 0, jc.lean, 'YXZ');
    js.bar.rotation.y = jc.steer * 0.35;
    // The view follows the hull's height (jumps included) without its jitter.
    const rest = -0.2;
    viewY += (rest + (pc.y - rest) * O.heave - viewY) * Math.min(1, dt * 14);
    holder.position.set(pc.x, viewY, pc.z);
    holder.rotation.y = pc.yaw;
  }

  function frame(time, xrFrame) {
    const dt = lastTime ? clamp((time - lastTime) / 1000, 0.0005, 1 / 30) : 1 / 72;
    lastTime = time;
    if (!built) return;
    elapsed += dt;
    const now = elapsed;
    frames++; fpsT += dt;
    if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
    const xr = renderer.xr.isPresenting;
    const pc = player.craft, jc = jane.craft;

    // Seat the player. Before the ride starts, follow them if they shift or sit down.
    if (xr) {
      if (!calibrated) calibrate(xrFrame);
      else if (race.state === 'ready' && now - calibAt > 1 && readHead(xrFrame) && !controls.input.riding) {
        rig.updateMatrix();
        const h = _a.copy(head.pos).applyMatrix4(rig.matrix);
        const far = Math.hypot(h.x, h.z) > 0.3 || Math.abs(h.y - eyeY) > 0.22;
        race.shift = far ? (race.shift || 0) + dt : 0;
        if (race.shift > 0.8) { race.shift = 0; calibrate(xrFrame); }
      } else if (race.state !== 'ready' && readHead(xrFrame)) {
        // Sat down or stood up in the middle of the ride: the seat follows,
        // eased in like the bar's fit. Leaning into a turn is not enough to move it.
        rig.updateMatrix();
        const h = _a.copy(head.pos).applyMatrix4(rig.matrix).add(layout.fit);
        const far = Math.abs(h.y - eyeY) > 0.3 || Math.hypot(h.x, h.z) > 0.45;
        race.shift = far ? (race.shift || 0) + dt : 0;
        if (race.shift > 1.5) { race.shift = 0; layout.fit.x -= h.x; layout.fit.y += eyeY - h.y; layout.fit.z -= h.z; }
      }
    } else {
      calibrated = true;
      rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
    }

    const input = controls.update(dt, now, xrFrame, layout, race.state === 'ready' || race.state === 'countdown');
    // Ease in the shift that brings the bar to the hand.
    if (layout.fit.lengthSq() > 1e-8) {
      const stepV = _a.copy(layout.fit).multiplyScalar(Math.min(1, dt * 10));
      rig.position.add(stepV); layout.fit.sub(stepV);
    }
    player.gloves[0].visible = input.gripL; player.gloves[1].visible = input.gripR;

    // State machine.
    if (race.state === 'ready') {
      hud.gripHint(xr && !input.riding);
      if (now > race.msgUntil) {
        if (xr && (input.handsSeen || input.device === 'hands')) hud.panel('GRAB THE BAR', 'Sit down, then make a fist on a grip. One hand is enough!', { size: 120 });
        else if (xr) hud.panel('GRAB THE BAR', 'Sit down. Hands: make a fist on a grip. Controller: squeeze the trigger.', { size: 120 });
        else hud.panel('PRESS SPACE', 'W or ↑ go · A / D or ← → steer', { size: 120 });
      }
      if (!race.greeted && now - race.readyAt > 1.2) { race.greeted = true; bark('Follow the gulls and grab the cash!', true); }
      if ((input.engaged || O.autopilot) && calibrated && now - race.readyAt > 0.6) {
        race.state = 'countdown'; race.countdown = 3; race.lastBeep = 4;
        hud.gripHint(false);
        if (O.music) sfx.restartMusic();
      }
    } else if (race.state === 'countdown') {
      race.countdown -= dt;
      const n = Math.ceil(race.countdown);
      if (n < race.lastBeep) { race.lastBeep = n; sfx.beep(n <= 0); }
      if (race.countdown <= 0) {
        race.state = 'race'; race.clock = 0; race.msgUntil = now + 0.9;
        hud.panel('GO!', '', { color: COLORS.pink });
        confetti.burst(pc.x - Math.sin(pc.yaw) * 6, pc.y + 3, pc.z - Math.cos(pc.yaw) * 6, 60, 6);
      } else hud.panel(String(n), n === 3 ? 'Turn your fist to steer' : n === 2 ? 'Ride through the bills' : 'Catch $100,000!');
    } else if (race.state === 'race') {
      race.clock += dt;
    }

    physics(dt, input);

    if (race.state === 'race') {
      if (ai.finish === null && ai.dist >= course.length) { ai.finish = race.clock; bark('Finished! Come on, slowpoke!', true); }
      const rank = race.dist >= ai.dist ? 1 : 2;
      if (rank !== race.rank && race.clock > 3) bark(pick(rank === 1 ? ['Hey! Where did you learn that?', 'Oh no you don\'t!'] : ['See you at the finish!', 'Catch me if you can!']));
      race.rank = rank;
      if (race.wrong > 2.5) { hud.panel('WRONG WAY', 'Turn around', { color: COLORS.pink, size: 130 }); race.msgUntil = now + 0.3; }
      else if (now > race.msgUntil) hud.panel('');
      if (!race.lastCanal && race.dist > course.cpIdx[22] * course.step) { race.lastCanal = true; bark('Last canal! Stay in the flow!', true); }
      if (race.dist >= course.length) {
        race.finish = race.clock; race.state = 'done'; race.doneAt = now;
        const won = ai.finish === null, s = gulls.state, rich = s.money >= GOAL;
        sfx.fanfare(won);
        confetti.burst(pc.x, pc.y + 2.5, pc.z, 120, 8, pc.vx, pc.vz);
        hud.panel(won ? 'YOU WIN!' : 'JANE WINS!', '', { color: won ? COLORS.yellow : COLORS.pink });
        race.msgUntil = now + 1.4;
        race.result = {
          won, title: won ? 'YOU WIN!' : 'JANE WINS!', time: race.finish, money: s.money, bills: s.taken, total: s.total, best: Math.max(1, s.best),
          line: rich ? (won ? 'A hundred grand AND the win. So crispy!' : 'I won, but you got your $100,000. Call it even?')
            : won ? `Fast! ${money(GOAL - s.money)} more and it's a hundred grand.` : `${(race.finish - ai.finish).toFixed(1)} s behind me, ${money(GOAL - s.money)} to go. Again?`,
        };
      }
    } else if (race.state === 'done') {
      if (now > race.msgUntil && race.result && !race.shown) {
        race.shown = true;
        hud.panel('');
        hud.results(race.result, now);
        bark(race.result.won ? 'Okay, you can ride.' : 'Told you it\'s my island!', true);
      }
      if (race.shown && !exiting && !pendingReset) {
        let choice = hud.pressButtons(input.pointers, now);
        if (!choice && now - race.doneAt > 2.5) { if (input.confirm) choice = 'again'; else if (input.back) choice = 'exit'; }
        if (choice) choose(choice);
      }
    }
    if (pendingReset && fadeV >= 0.98) { pendingReset = false; resetRace(); fadeTo = 0; }
    if (exiting && fadeV >= 0.98) { exiting = false; stop(); if (onExit) onExit(summary()); }

    placeAll(dt);

    // Water effects and sound.
    const boostK = Math.min(1, pc.boost / 0.5);
    const pw = ocean.heightAt(pc.x, pc.z, elapsed), jw = ocean.heightAt(jc.x, jc.z, elapsed);
    player.wake.setTint(boostK);
    player.wake.update(dt, elapsed, pc.x, pc.z, pc.yaw, pc.speed, pc.wet);
    jane.wake.update(dt, elapsed, jc.x, jc.z, jc.yaw, jc.speed, jc.wet);
    spray.emitCraft('p', dt, pc, pw);
    spray.emitCraft('j', dt, jc, jw);
    spray.update(dt);
    confetti.update(dt, elapsed);
    if (streaks) streaks.update(dt, pc.speed, boostK);
    missCool -= dt;
    if (engineP) {
      engineP.set(pc.rpm, pc.speed, pc.wet, pc.airborne, 1, boostK);
      const dx = jc.x - pc.x, dz = jc.z - pc.z, d = Math.max(1, Math.hypot(dx, dz));
      const vr = ((jc.vx - pc.vx) * dx + (jc.vz - pc.vz) * dz) / d;
      engineJ.set(jc.rpm, jc.speed, jc.wet, jc.airborne, clamp(1 - (vr * 2.5) / 343, 0.8, 1.2), jc.boost > 0 ? 1 : 0);
      const ct = listener.context.currentTime;
      pannerJ.positionX.setTargetAtTime(jc.x, ct, 0.03);
      pannerJ.positionY.setTargetAtTime(jc.y + 0.6, ct, 0.03);
      pannerJ.positionZ.setTargetAtTime(jc.z, ct, 0.03);
      sfx.setSpace(world.enclosure(race.idx), Math.max(1.5, course.half[race.idx] - Math.abs(race.lat)));
      sfx.setRace(pc.speed, pc.airborne, scrape);
    }

    gulls.update(dt, elapsed, pc, race.dist, race.state === 'race', input.freeHands);

    // Flat previews.
    if (!xr) {
      if (O.map) {
        if (camera.parent !== scene) { scene.add(camera); scene.fog = null; sky.uniforms.hazeDensity.value = 0.00004; }
        camera.position.set(0, O.map > 1 ? O.map : 830, 0.01); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
      } else if (O.chase === 'jane') {
        // Look at Jane from her front quarter.
        if (camera.parent !== scene) scene.add(camera);
        const a = jc.yaw + (O.look || 0.7);
        camera.position.set(jc.x - Math.sin(a) * 4.2, jc.y + 1.9, jc.z - Math.cos(a) * 4.2);
        camera.up.set(0, 1, 0); camera.lookAt(jc.x, jc.y + 1.2, jc.z);
      } else if (O.chase) { camera.position.set(0, eyeY + 2.4, 7.5); camera.rotation.set(-0.2, 0, 0); }
      else { camera.position.set(0, eyeY, 0); camera.rotation.set(O.look ?? -0.14, 0, 0); }
    }

    // Ocean and sky follow the camera; ramps, buoys and floats ride the swell.
    camera.getWorldPosition(_cam);
    ocean.update(_cam, elapsed);
    sky.dome.position.copy(_cam);
    world.update(elapsed, _cam, ocean);

    // Interface.
    hud.dash({
      money: gulls.state.money, combo: gulls.state.combo, kmh: Math.round(pc.speed * 3.6), boost: pc.boost > 0,
      rank: race.state === 'race' || race.state === 'done' ? (race.state === 'done' ? (race.result && race.result.won ? 1 : 2) : race.rank) : 0,
      time: clock(race.state === 'done' ? race.finish : race.clock),
      lap: race.dist / course.length, janeLap: ai.dist / course.length, fps: O.debug ? fps : 0,
    }, now);
    hud.vignette(Math.min(1, Math.abs(pc.yawRate) / 0.9) * 0.6, O.vignette && xr);
    fadeV += clamp(fadeTo - fadeV, -dt * 2.4, dt * 2.4);
    hud.fade(fadeV);
    hud.update(dt, now);

    if (!skipRender) {
      const tone = renderer.toneMapping, exp = renderer.toneMappingExposure;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = O.exposure;
      renderer.render(scene, camera);
      renderer.toneMapping = tone; renderer.toneMappingExposure = exp;
    }
  }

  function choose(choice) {
    sfx.gate();
    if (choice === 'again') { pendingReset = true; fadeTo = 1; }
    else { exiting = true; fadeTo = 1; }
  }
  const summary = () => ({ money: gulls.state.money, time: race.finish, won: !!(race.result && race.result.won), bills: gulls.state.taken, total: gulls.state.total, finished: race.finish !== null });

  // ---------- audio ----------

  function startAudio() {
    if (listener.context.state !== 'running') listener.context.resume().catch(() => {});
    sfx.setActive(true);
    gulls.setVolume(1);
    if (audioOn) return;
    audioOn = true;
    try {
      engineP = sfx.engine(null, 0.8);
      pannerJ = sfx.pannerAt(new THREE.Vector3());
      pannerJ.refDistance = 6;
      engineJ = sfx.engine(pannerJ, 0.8);
      engineP.start(); engineJ.start();
      sfx.startAmbience();
      if (O.music) sfx.startMusic(TRACKS);
    } catch (err) { console.warn('Race audio could not start:', err); }
  }

  // ---------- start, stop ----------

  const ndc = new THREE.Vector2();
  function onClick(e) {
    if (renderer.xr.isPresenting || race.state !== 'done' || !race.shown) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const c = hud.clickButtons(ndc);
    if (c) choose(c);
  }

  // The race runs at 72 Hz in the headset, which leaves room for the water
  // and the islands; the rate the session had before comes back afterwards.
  let rateBefore = 0;
  function setRate(racing) {
    try {
      const session = renderer.xr.getSession();
      if (!session || !session.updateTargetFrameRate || !session.supportedFrameRates) return;
      if (racing) {
        const rates = Array.from(session.supportedFrameRates);
        const want = rates.includes(72) ? 72 : Math.min(...rates);
        rateBefore = session.frameRate || 0;
        if (want !== rateBefore) session.updateTargetFrameRate(want).catch(() => {});
      } else if (rateBefore) {
        if (rateBefore !== session.frameRate) session.updateTargetFrameRate(rateBefore).catch(() => {});
        rateBefore = 0;
      }
    } catch { /* the rate stays as it is */ }
  }

  function start() {
    if (!built || active) return;
    active = true;
    lastTime = 0; calibrated = false;
    resetRace();
    fadeV = 1; fadeTo = 0;
    controls.listen(true);
    renderer.domElement.addEventListener('click', onClick);
    setRate(true);
    startAudio();
  }
  function stop() {
    if (!active) return;
    active = false;
    race.state = 'off';
    setRate(false);
    controls.listen(false); controls.release();
    renderer.domElement.removeEventListener('click', onClick);
    if (hud) hud.gripHint(false);
    if (sfx) sfx.setActive(false);
    if (gulls) gulls.setVolume(0);
    if (engineP) { engineP.out.gain.setTargetAtTime(0, listener.context.currentTime, 0.1); engineJ.out.gain.setTargetAtTime(0, listener.context.currentTime, 0.1); }
  }

  // Testing: run the game for a while without drawing.
  function simulate(seconds, stepS = 1 / 60) {
    skipRender = true;
    let t = lastTime || performance.now();
    for (let i = 0; i < seconds / stepS; i++) { t += stepS * 1000; frame(t, null); }
    skipRender = false;
    lastTime = 0;
  }

  const api = {
    ready, scene, camera, start, stop, frame, simulate,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    recenter() { calibrated = false; },
    get active() { return active; },
    get state() { return race.state; },
    summary,
    debug: { race, ai, player, jane, layout, options: O, get world() { return world; }, get gulls() { return gulls; }, get controls() { return controls; }, get hud() { return hud; }, get ocean() { return ocean; }, get sky() { return sky; }, rig, holder, respawn },
  };
  return api;
}
