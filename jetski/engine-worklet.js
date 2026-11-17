// The jetski's engine, made sample by sample on the audio thread: an inline
// three-cylinder four-stroke, the engine in most jetskis, with the parts of
// its sound a rider hears.
//   - Exhaust: each cylinder fires a short pressure pulse (a little stronger
//     or weaker every cycle, as in a real engine) into an exhaust pipe and a
//     muffler box of fixed length. Their resonances stay where they are while
//     the firing rate sweeps through them, which is what makes an engine
//     growl instead of buzz.
//   - The wet exhaust: at low speed the outlet sits in the water and the gas
//     leaves in bursts, so it blubbers, with bubbles popping. Planing, it
//     clears.
//   - Intake roar under the seat that opens up with the throttle, and the
//     jet pump's whine. Out of the water the pump sucks air: the engine hits
//     its limiter (which cuts the odd firing) and hisses.
//   - Off the throttle at high revs the odd cylinder misfires or pops.
// Parameters: rpm (crank), load (throttle 0..1), wet (how far the outlet is
// under water, 0..1), air (pump out of the water, 0..1).

const TAU = Math.PI * 2;

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  // RBJ cookbook filters.
  set(type, f, q) {
    const w = TAU * Math.min(f, sampleRate * 0.45) / sampleRate, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'band') { b0 = al; b1 = 0; b2 = -al; } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * cw / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// A pipe as a delay line with a lossy, inverting reflection at the open end:
// resonances at odd multiples of c / 4L.
class Pipe {
  constructor(length, gain, cutoff) {
    this.n = Math.max(2, Math.round(sampleRate * 2 * length / 343));
    this.buf = new Float32Array(this.n);
    this.i = 0; this.g = gain; this.lp = 0;
    this.a = 1 - Math.exp(-TAU * cutoff / sampleRate);
  }
  run(x) {
    const back = this.buf[this.i];
    this.lp += this.a * (back - this.lp);
    const y = x + this.g * this.lp;
    this.buf[this.i] = y;
    this.i = this.i + 1 === this.n ? 0 : this.i + 1;
    return y;
  }
}

class JetskiEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 1650, minValue: 300, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wet', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'air', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.seed = (o.seed | 0) || 0x2545f491;
    this.phase = Math.random();
    this.amp = [1, 1, 1];
    // The three cylinders aren't quite alike, nor quite evenly timed: that
    // gives the triple its warble.
    this.base = [1.0, 0.84, 0.94];
    this.offset = [0, 1 / 3 + 0.012, 2 / 3 - 0.008];
    this.prevU = [1, 1, 1];
    this.jit = 0; this.wander = 0;     // fast and slow wobble of the revs
    // Lengths picked so their resonances don't pile up on one note and whistle.
    this.header = new Pipe(0.45, -0.5, 4200);
    this.pipe = new Pipe(1.12, -0.64, 2600);
    this.box = new Pipe(0.24, -0.45, 3000);
    this.waterLp = new Biquad();
    this.intakeBp = new Biquad();
    this.hissHp = 0;
    this.gas = 0;           // the exhaust's gas flow, smoothed: drives the intake and the burble
    this.choke = 0;         // how much the water is holding the exhaust back right now
    this.chokeTo = 0; this.chokeT = 0;
    this.bubbles = Array.from({ length: 6 }, () => ({ a: 0, f: 0, ph: 0, d: 0, chirp: 0 }));
    this.whine = 0; this.whine2 = 0;
    this.dc1 = 0; this.dcY = 0;
    this.lpOut = 0;
  }

  rand() {
    // xorshift32
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const rpm = params.rpm[0], load = params.load[0], wet = params.wet[0], air = params.air[0];
    const LIMIT = 8400;
    const rn = Math.min(1.2, Math.max(0, (rpm - 1650) / 6200)); // 0 idle .. 1 flat out
    const fc = rpm / 120;                     // engine cycles per second (two turns each)
    const width = 0.075;                      // blowdown pulse, as a part of the cycle
    const rough = 0.13 - 0.08 * Math.min(1, rn); // cycle-to-cycle spread: a lumpy idle, smooth at speed
    const overrun = (1 - load) * Math.max(0, rn - 0.25); // off the throttle at high revs: pops
    this.waterLp.set('low', 650 + 2400 * (1 - wet) * (0.4 + 0.6 * Math.min(1, rn + load * 0.3)), 0.6);
    this.intakeBp.set('band', 260 + 300 * Math.min(1, rn), 1.3);
    const pulseGain = 0.32 + 0.68 * load;
    const intakeGain = (0.05 + 0.5 * load) * (0.25 + 0.75 * Math.min(1, rn));
    const whineGain = 0.0015 + 0.022 * load * rn * rn + 0.02 * air;
    const fw = (rpm / 60) * 9, fw2 = (rpm / 60) * 23;
    const bubbleRate = (5 + 28 * (0.4 + 0.6 * load)) * wet;
    const hissGain = 0.05 * air + 0.02 * load * rn;
    const jitter = (0.022 - 0.014 * Math.min(1, rn)) / 0.018;
    for (let n = 0; n < out.length; n++) {
      // The revs never sit perfectly still: combustion varies from firing to
      // firing, and the pump's load with the water.
      this.jit += 0.002 * ((this.rand() * 2 - 1) - this.jit);
      this.wander += 0.00005 * ((this.rand() * 2 - 1) - this.wander);
      this.phase += fc * (1 + this.jit * jitter + this.wander * 3.4) / sr;
      if (this.phase >= 1) this.phase -= 1;
      // Three cylinders, evenly spaced over the cycle.
      let x = 0;
      for (let k = 0; k < 3; k++) {
        let u = this.phase - this.offset[k];
        if (u < 0) u += 1;
        if (u < this.prevU[k]) {
          // This cylinder fires: how hard, this time.
          const g = (this.rand() + this.rand() + this.rand() - 1.5) * 2 * rough;
          let a = this.base[k] * (1 + g) * pulseGain;
          if (rpm > LIMIT && this.rand() < 0.45) a = 0;          // the limiter cuts it
          else if (overrun > 0 && this.rand() < 0.12 * overrun) a *= this.rand() < 0.5 ? 0.1 : 2.2; // a miss, or a pop
          this.amp[k] = a;
        }
        this.prevU[k] = u;
        if (u < width) {
          const s = Math.sin(Math.PI * u / width);
          x += this.amp[k] * s * s;
        }
      }
      // Gas through the valves is noisy.
      const nz = this.rand() * 2 - 1;
      x += x * nz * 0.6;
      this.gas += 0.004 * (x - this.gas);
      // Header, pipe and muffler box.
      let y = this.box.run(this.pipe.run(this.header.run(x)));
      // The outlet in the water: the gas goes out in bursts.
      this.chokeT -= 1 / sr;
      if (this.chokeT <= 0) { this.chokeT = 0.02 + 0.06 * this.rand(); this.chokeTo = this.rand(); }
      this.choke += 0.004 * (this.chokeTo - this.choke);
      y *= 1 - 0.55 * wet * this.choke;
      y = this.waterLp.run(y);
      // Bubbles.
      if (this.rand() < bubbleRate / sr) {
        const b = this.bubbles.find((v) => v.a < 0.002) || this.bubbles[0];
        const r = this.rand();
        b.f = 110 + 340 * r * r; b.ph = 0; b.a = (0.12 + 0.25 * this.rand()) * (0.5 + load) * wet;
        const tau = 0.008 + 0.014 * this.rand();
        b.d = Math.exp(-1 / (sr * tau));
        b.chirp = Math.exp(Math.log(1.3) / (sr * tau * 5)); // up 30% as it rises and shrinks
      }
      let bub = 0;
      for (const b of this.bubbles) {
        if (b.a < 0.002) continue;
        b.ph += TAU * b.f / sr; b.f *= b.chirp; b.a *= b.d;
        bub += Math.sin(b.ph) * b.a;
      }
      // Intake roar, pulsing with the firings.
      const roar = this.intakeBp.run(nz) * intakeGain * (0.4 + Math.min(2, this.gas * 3));
      // Pump whine, and air through the pump.
      this.whine += fw / sr; if (this.whine >= 1) this.whine -= 1;
      this.whine2 += fw2 / sr; if (this.whine2 >= 1) this.whine2 -= 1;
      const wh = (Math.sin(TAU * this.whine) + 0.4 * Math.sin(TAU * this.whine2)) * whineGain;
      this.hissHp += 0.2 * (nz - this.hissHp);
      const hiss = (nz - this.hissHp) * hissGain;
      let s = y * 0.55 + roar + bub + wh + hiss;
      // No DC, and a soft limit.
      const d = s - this.dc1 + 0.9975 * this.dcY; this.dc1 = s; this.dcY = d;
      out[n] = Math.tanh(d * 1.6) * 0.62;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('jetski-engine', JetskiEngine);
