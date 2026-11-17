// Seagull sounds, synthesized into AudioBuffers at startup and played through
// a positional (HRTF) source on the gull so they come from where the bird is,
// with a little room around them.
//
// Calls are modelled on the herring gull's: each note a bright, nasal
// harmonic yelp whose pitch jumps up at the start and sags away, made harsh
// by period doubling (a gull's voice breaks into subharmonics when it yells),
// shaped by three moving resonances ("ky" opening to "ow") and started with
// a dry click. Call 0 is the long "kyow" yelp; call 1 the laughing series
// "kyow-ha-ha-ha". Wing beats are a soft feathery rustle, used only on the
// hard beats of landing and taking off.
import * as THREE from 'three';

const SR = 44100;

function makeBuffer(ctx, seconds, fill) {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  fill(buf.getChannelData(0));
  return buf;
}

// Seeded noise, so every page load sounds the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
}

// Band-pass biquad (RBJ cookbook, constant peak gain), retuned per sample.
function bandPass() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q) => {
    const w = (2 * Math.PI * f) / SR, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// One note. f0, peak, f1: pitch at the start, at the top (reached at `rise`
// of the way through) and at the end. harsh: how strongly the voice breaks.
// open: 0 keeps "ky"'s high resonance, 1 opens fully to "ow".
function addNote(d, at, { dur, f0, peak, f1, rise = 0.22, harsh = 0.45, open = 1, level = 1 }, rand) {
  const start = Math.floor(at * SR), n = Math.floor(dur * SR);
  const r1 = bandPass(), r2 = bandPass(), r3 = bandPass(), hiss = bandPass();
  let phase = 0, jitter = 0;
  for (let i = 0; i < n && start + i < d.length; i++) {
    const t = i / SR, u = t / dur;
    // Pitch: a fast swoop up, then an easing fall; a little wobble and jitter.
    let f = u < rise ? f0 + (peak - f0) * Math.sin((Math.PI / 2) * (u / rise))
      : peak + (f1 - peak) * Math.pow((u - rise) / (1 - rise), 0.8);
    jitter += (rand() * 0.004 - jitter * 0.02);
    f *= 1 + jitter + 0.012 * Math.sin(2 * Math.PI * 23 * t);
    phase += f / SR;
    // Bright source: harmonics falling off gently, up to about 9 kHz.
    let src = 0;
    const top = Math.min(12, Math.floor(9000 / f));
    for (let h = 1; h <= top; h++) src += Math.sin(2 * Math.PI * h * phase) / Math.pow(h, 0.75);
    // The break: every other cycle louder, which puts in the half-pitch rasp.
    const brk = harsh * Math.sin(Math.PI * Math.min(1, u * 1.6));
    src *= 1 + brk * Math.sin(Math.PI * phase + 0.6);
    src += rand() * 0.18;
    // Resonances: "ky" (high second one) opening into "ow".
    const o = Math.min(1, u / 0.35) * open;
    let s = r1.call(null, src, 1150 + 250 * o, 2.2) * 1.0
      + r2.call(null, src, 3100 - 900 * o, 3.2) * 0.9
      + r3.call(null, src, 4300, 4.5) * 0.35;
    // Dry click at the start of the note ("k").
    if (t < 0.012) s += hiss(rand(), 3500, 1.2) * 2.2 * (1 - t / 0.012);
    s = Math.tanh(s * 1.4) * 0.8;
    const env = Math.min(1, t / 0.014) * Math.min(1, (dur - t) / 0.05) * (0.85 + 0.15 * Math.sin(Math.PI * u));
    d[start + i] += s * env * level * 0.5;
  }
}

// The saturation leaves a little offset behind, which would thump at the
// note's edges; a gentle high-pass (~100 Hz) takes it out.
function highPass(d, hz = 100) {
  const r = Math.exp((-2 * Math.PI * hz) / SR);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < d.length; i++) { const x = d[i]; y1 = x - x1 + r * y1; x1 = x; d[i] = y1; }
}

function makeCall(ctx, notes, seed) {
  const total = notes.reduce((s, n) => Math.max(s, n.at + n.dur), 0) + 0.05;
  const rand = rng(seed);
  return makeBuffer(ctx, total, (d) => { for (const n of notes) addNote(d, n.at, n, rand); highPass(d); });
}

// A downstroke heard up close: a short airy rustle, no thump.
function makeFlap(ctx) {
  const rand = rng(7);
  const f = bandPass();
  return makeBuffer(ctx, 0.16, (d) => {
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.045);
      d[i] = f(rand(), 900 + 1600 * Math.min(1, t / 0.06), 0.9) * env * 0.9;
    }
  });
}

// A small room's reverb tail: decaying noise, a little darker as it fades.
function makeRoom(ctx) {
  const rand = rng(11);
  const buf = ctx.createBuffer(2, Math.ceil(0.5 * SR), SR);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      lp += (0.55 - 0.4 * Math.min(1, t / 0.5)) * (rand() - lp);
      d[i] = lp * Math.exp(-t / 0.11) * (t < 0.008 ? t / 0.008 : 1);
    }
  }
  return buf;
}

export class GullVoice {
  constructor(listener, object) {
    this.ctx = listener.context;
    this.audio = new THREE.PositionalAudio(listener);
    this.audio.panner.panningModel = 'HRTF';
    this.audio.setRefDistance(0.6);
    this.audio.setRolloffFactor(1.1);
    object.add(this.audio);
    // Everything goes through one gain, so the bird can fade out as it flies
    // off: straight from where it is, and a little of it through the room.
    this.master = this.ctx.createGain();
    this.master.connect(this.audio.panner);
    const room = this.ctx.createConvolver();
    room.buffer = makeRoom(this.ctx);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.22;
    this.master.connect(room).connect(wet).connect(listener.getInput());
    this.level = 1;
    this.flapBuf = makeFlap(this.ctx);
    this.calls = [
      // "kyow": one long yelp.
      makeCall(this.ctx, [
        { at: 0, dur: 0.42, f0: 720, peak: 1420, f1: 880, rise: 0.2, harsh: 0.5 },
      ], 3),
      // "kyow-kyow-ha-ha-ha": two yelps and a falling laugh.
      makeCall(this.ctx, [
        { at: 0, dur: 0.3, f0: 760, peak: 1500, f1: 960, rise: 0.22, harsh: 0.45 },
        { at: 0.36, dur: 0.28, f0: 760, peak: 1460, f1: 940, rise: 0.22, harsh: 0.5 },
        { at: 0.72, dur: 0.12, f0: 980, peak: 1260, f1: 1040, rise: 0.3, harsh: 0.6, open: 0.7, level: 0.85 },
        { at: 0.9, dur: 0.12, f0: 960, peak: 1220, f1: 1000, rise: 0.3, harsh: 0.6, open: 0.7, level: 0.8 },
        { at: 1.08, dur: 0.12, f0: 930, peak: 1180, f1: 960, rise: 0.3, harsh: 0.65, open: 0.7, level: 0.72 },
        { at: 1.27, dur: 0.14, f0: 900, peak: 1120, f1: 900, rise: 0.3, harsh: 0.65, open: 0.7, level: 0.6 },
      ], 5),
    ];
  }

  // 0..1; ramps over `seconds` so a fade never clicks.
  setLevel(level, seconds = 0.05) {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    const g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(level, now + Math.max(0.01, seconds));
  }

  play(buffer, gain, rate = 1) {
    if (this.ctx.state !== 'running' || this.level < 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
  }

  flap(strength = 1) { this.play(this.flapBuf, 0.22 * strength, 0.85 + Math.random() * 0.3); }
  call(i) { this.play(this.calls[i % this.calls.length], 0.85, 0.96 + Math.random() * 0.08); }
}
