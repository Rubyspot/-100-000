// Procedural seagull sounds: wing-flap whooshes and calls, synthesized into
// AudioBuffers at startup and played through a positional (HRTF) source on
// the gull so they come from where the bird is.
import * as THREE from 'three';

const SR = 44100;

function makeBuffer(ctx, seconds, fill) {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  fill(buf.getChannelData(0));
  return buf;
}

// A downstroke: a soft low thump plus a short band-limited noise whoosh.
function makeFlap(ctx) {
  return makeBuffer(ctx, 0.22, (d) => {
    let lp = 0, lp2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.055);
      const n = Math.random() * 2 - 1;
      // Cutoff sweeps up through the stroke: "fwup".
      const a = 0.08 + 0.25 * Math.min(1, t / 0.08);
      lp += a * (n - lp);
      lp2 += 0.02 * (lp - lp2);
      const band = lp - lp2;
      const thump = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t / 0.03) * 0.5;
      d[i] = (band * 2.2 + thump) * env;
    }
  });
}

// Herring-gull style call. Pitch glides up into a raspy, vibrato-laden
// "kyeow", or a few clipped "ha" notes for the laughing call.
function makeCall(ctx, notes) {
  const total = notes.reduce((s, n) => Math.max(s, n.at + n.dur), 0) + 0.05;
  return makeBuffer(ctx, total, (d) => {
    for (const n of notes) {
      let phase = 0;
      const start = Math.floor(n.at * SR), len = Math.floor(n.dur * SR);
      for (let i = 0; i < len; i++) {
        const t = i / SR, u = t / n.dur;
        let f = n.f0 + (n.f1 - n.f0) * Math.min(1, u / 0.18);
        f += (n.f2 - n.f1) * Math.max(0, (u - 0.5) / 0.5);
        f *= 1 + 0.025 * Math.sin(2 * Math.PI * 9 * t);
        phase += (2 * Math.PI * f) / SR;
        let s = Math.sin(phase) + 0.55 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase) + 0.15 * Math.sin(4 * phase);
        s *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 68 * t); // rasp
        s += (Math.random() * 2 - 1) * 0.12;
        const env = Math.min(1, t / 0.015) * Math.min(1, (n.dur - t) / 0.06);
        d[start + i] += s * env * 0.32;
      }
    }
  });
}

export class GullVoice {
  constructor(listener, object) {
    this.ctx = listener.context;
    this.audio = new THREE.PositionalAudio(listener);
    this.audio.panner.panningModel = 'HRTF';
    this.audio.setRefDistance(0.5);
    this.audio.setRolloffFactor(1.1);
    object.add(this.audio);
    this.flapBuf = makeFlap(this.ctx);
    this.calls = [
      makeCall(this.ctx, [{ at: 0, dur: 0.55, f0: 950, f1: 2100, f2: 1250 }]),
      makeCall(this.ctx, [
        { at: 0, dur: 0.15, f0: 1500, f1: 1900, f2: 1500 },
        { at: 0.2, dur: 0.14, f0: 1450, f1: 1850, f2: 1400 },
        { at: 0.39, dur: 0.14, f0: 1400, f1: 1750, f2: 1300 },
        { at: 0.6, dur: 0.38, f0: 1100, f1: 2000, f2: 1150 },
      ]),
    ];
  }

  play(buffer, gain, rate = 1) {
    if (this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.audio.panner);
    src.start();
  }

  flap(strength = 1) { this.play(this.flapBuf, 0.55 * strength, 0.9 + Math.random() * 0.25); }
  call(i) { this.play(this.calls[i % this.calls.length], 0.9, 0.97 + Math.random() * 0.06); }
}
