// Sound design, all synthesized at startup (no sample files needed):
// - Engine: a four-cylinder four-stroke firing loop (resampled with RPM),
//   jet-pump impeller whine, and water rush that drops out in the air,
//   where the unloaded engine revs up and gets brighter.
// - Ocean bed, splashes sized by landing speed, cash "cha-ching", and the
//   Crispy J playlist.
// Recorded files can replace the synthesized ones: drop engine.mp3,
// ocean.mp3 or splash.mp3 into jetski/audio/ and list them in sounds.json.
const SR = 44100;

function buffer(ctx, seconds, channels, fill) {
  const b = ctx.createBuffer(channels, Math.ceil(seconds * SR), SR);
  for (let c = 0; c < channels; c++) fill(b.getChannelData(c), c);
  return b;
}

// One second of a 4-cylinder 4-stroke at 3000 rpm: 100 firings per second.
// Each firing is a damped low resonance plus a noisy exhaust puff, with
// small per-cylinder differences so it doesn't sound like a pure buzz.
function makeEngineLoop(ctx) {
  const FIRE = 100;
  const cyl = [1.0, 0.86, 0.95, 0.8];
  return buffer(ctx, 1, 1, (d) => {
    const period = SR / FIRE;
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const k = Math.floor(i / period), t = (i - k * period) / SR;
      const a = cyl[k % 4] * (0.9 + 0.1 * Math.sin(k * 1.7));
      const body = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.0035) + 0.6 * Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t / 0.006);
      const n = Math.random() * 2 - 1;
      lp += 0.25 * (n - lp);
      const puff = lp * Math.exp(-t / 0.0022) * 1.4;
      d[i] = (body + puff) * a * 0.5;
    }
  });
}

function makeNoiseLoop(ctx, seconds, channels, color = 0.02) {
  return buffer(ctx, seconds, channels, (d) => {
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b += color * ((Math.random() * 2 - 1) - b);
      d[i] = b * (1 / Math.sqrt(color)) * 0.6;
    }
    // Cross-fade the ends so it loops without a click.
    const f = Math.floor(SR * 0.05);
    for (let i = 0; i < f; i++) { const w = i / f; d[i] = d[i] * w + d[d.length - f + i] * (1 - w); }
  });
}

// Ocean: brown-ish noise with slow swells, stereo.
function makeOcean(ctx) {
  return buffer(ctx, 12, 2, (d, ch) => {
    let b = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      b += 0.03 * ((Math.random() * 2 - 1) - b);
      b2 += 0.004 * ((Math.random() * 2 - 1) - b2);
      const swell = 0.55 + 0.45 * Math.pow(Math.sin(Math.PI * ((t + ch * 1.3) / 6)) ** 2, 1.5);
      d[i] = (b * 2.5 + b2 * 6) * swell * 0.5;
    }
    const f = Math.floor(SR * 0.3);
    for (let i = 0; i < f; i++) { const w = i / f; d[i] = d[i] * w + d[d.length - f + i] * (1 - w); }
  });
}

function makeSplash(ctx) {
  return buffer(ctx, 1.4, 2, (d) => {
    let lp = 0, hp = 0, prev = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      const n = Math.random() * 2 - 1;
      const cut = 0.05 + 0.5 * Math.exp(-t / 0.15);
      lp += cut * (n - lp);
      hp = lp - prev; prev = lp;
      const env = Math.min(1, t / 0.006) * (Math.exp(-t / 0.18) + 0.25 * Math.exp(-t / 0.6));
      const thump = Math.sin(2 * Math.PI * (55 + 40 * Math.exp(-t / 0.05)) * t) * Math.exp(-t / 0.09);
      // Droplets falling back.
      const drops = Math.random() < 0.0015 * Math.exp(-t / 0.5) ? (Math.random() * 2 - 1) * 1.5 : 0;
      d[i] = (lp * 1.2 + hp * 2.0) * env + thump * 0.8 + drops;
    }
  });
}

function makeCash(ctx) {
  return buffer(ctx, 0.9, 1, (d) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      const bell = (f, at) => (t > at ? Math.sin(2 * Math.PI * f * (t - at)) * Math.exp(-(t - at) / 0.18) : 0);
      const coin = t < 0.12 ? (Math.random() * 2 - 1) * Math.exp(-t / 0.03) * 0.4 : 0;
      d[i] = (bell(1568, 0.0) * 0.5 + bell(2093, 0.08) * 0.6 + bell(3136, 0.08) * 0.2) * 0.6 + coin;
    }
  });
}

async function tryLoad(ctx, url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await ctx.decodeAudioData(await r.arrayBuffer());
  } catch { return null; }
}

export class EngineSound {
  // dest: an AudioNode (a panner for Jane, the listener's input for the player)
  constructor(ctx, dest, buffers, volume = 1) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(dest);
    this.volume = volume;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.Q.value = 0.7;
    this.tone.connect(this.out);

    this.engine = ctx.createBufferSource(); this.engine.buffer = buffers.engine; this.engine.loop = true;
    this.engineGain = ctx.createGain();
    this.engine.connect(this.engineGain).connect(this.tone);

    this.whine = ctx.createOscillator(); this.whine.type = 'triangle';
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.out);

    this.rush = ctx.createBufferSource(); this.rush.buffer = buffers.noise; this.rush.loop = true;
    this.rushFilter = ctx.createBiquadFilter(); this.rushFilter.type = 'bandpass'; this.rushFilter.Q.value = 0.6;
    this.rushGain = ctx.createGain(); this.rushGain.gain.value = 0;
    this.rush.connect(this.rushFilter).connect(this.rushGain).connect(this.out);
    this.recorded = buffers.recorded;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.engine.start(); this.whine.start(); this.rush.start(Math.random());
  }

  // rpm 0..~1.1, speed m/s, wet 0..1, airborne bool
  set(rpm, speed, wet, airborne) {
    const t = this.ctx.currentTime;
    const r = Math.max(0, rpm);
    // 1300 rpm idle to ~7800 rpm: playback 0.43 to 2.6 of the 3000 rpm loop.
    const rate = this.recorded ? 0.7 + r * 0.9 : 0.43 + r * 2.0;
    this.engine.playbackRate.setTargetAtTime(rate, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.35 + r * 0.45, t, 0.05);
    this.tone.frequency.setTargetAtTime((airborne ? 2600 : 900) + r * 2400, t, 0.06);
    const fire = 43 + r * 217;
    this.whine.frequency.setTargetAtTime(fire * 6.5, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.012 + r * r * (airborne ? 0.07 : 0.04), t, 0.06);
    this.rushFilter.frequency.setTargetAtTime(400 + speed * 70, t, 0.1);
    this.rushGain.gain.setTargetAtTime(airborne ? 0 : Math.min(1, speed / 14) * 0.35 * (0.3 + 0.7 * wet), t, airborne ? 0.03 : 0.12);
    this.out.gain.setTargetAtTime(this.volume, t, 0.2);
  }
}

export class Sfx {
  constructor(listener) {
    this.listener = listener;
    this.ctx = listener.context;
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.connect(listener.getInput());
    this.buffers = {
      engine: makeEngineLoop(ctx),
      noise: makeNoiseLoop(ctx, 3, 1, 0.25),
      ocean: makeOcean(ctx),
      splash: makeSplash(ctx),
      cash: makeCash(ctx),
    };
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.55; this.musicGain.connect(this.master);
    this.music = null;
  }

  // audio/sounds.json lists which recorded files exist, e.g. ["engine", "splash"].
  async loadRecorded() {
    let names = [];
    try { names = await (await fetch('./audio/sounds.json')).json(); } catch { /* none */ }
    const get = (n) => (names.includes(n) ? tryLoad(this.ctx, `./audio/${n}.mp3`) : null);
    const [engine, ocean, splash] = await Promise.all(['engine', 'ocean', 'splash'].map(get));
    if (engine) { this.buffers.engine = engine; this.buffers.recorded = true; }
    if (ocean) this.buffers.ocean = ocean;
    if (splash) this.buffers.splash = splash;
  }

  engine(dest, volume) { return new EngineSound(this.ctx, dest || this.master, this.buffers, volume); }

  startAmbience() {
    if (this.oceanSrc) return;
    this.oceanSrc = this.ctx.createBufferSource();
    this.oceanSrc.buffer = this.buffers.ocean; this.oceanSrc.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = this.ctx.createGain(); g.gain.value = 0.28;
    this.oceanSrc.connect(f).connect(g).connect(this.master);
    this.oceanSrc.start();
  }

  // A panner at a world position (the listener follows the camera).
  pannerAt(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.2;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  play(name, gain = 1, rate = 1, pos = null) {
    if (this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(pos ? this.pannerAt(pos) : this.master);
    src.start();
  }

  splash(size, pos) { this.play('splash', Math.min(1.6, 0.25 + size * 0.3), 1.25 - Math.min(0.5, size * 0.07) + Math.random() * 0.1, pos); }
  cash() { this.play('cash', 0.7, 1 + Math.random() * 0.04); }

  // Background music: the playlist loops; Seagulls Love Too first.
  startMusic(tracks) {
    if (this.music) return;
    const el = new Audio();
    el.preload = 'auto';
    let i = 0;
    const next = () => { el.src = tracks[i % tracks.length]; i++; el.play().catch(() => {}); };
    el.addEventListener('ended', next);
    this.ctx.createMediaElementSource(el).connect(this.musicGain);
    this.music = el;
    next();
  }

  duckMusic(on) { this.musicGain.gain.setTargetAtTime(on ? 0.25 : 0.55, this.ctx.currentTime, 0.3); }
}

