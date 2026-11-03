// Jetski dynamics, modelled on a 3 m, ~350 kg (with rider) sit-down
// personal watercraft like the Kawasaki STX-15F:
// - Four hull probes float on the water (springs + damping), with planing
//   lift that raises the hull as speed builds. Their imbalance pitches the
//   hull, so it climbs swells, leaves the water over sharp crests and off
//   trampolines, and noses down in the air.
// - The jet pump only pushes while the intake (under the stern) is wet. In
//   the air the engine unloads and revs up, and there is no steering.
// - Steering turns the jet nozzle, so turning needs thrust (a little
//   off-throttle steering is kept, like modern skis). A deep keel resists
//   sliding sideways, so the hull carves with a small drift.

const G = 9.81;
const MASS = 350;
const I_PITCH = 320;
const DRAFT = 0.22;                       // static draft at rest
const K = (MASS * G) / (4 * DRAFT);       // per-probe spring
const C = 900;                            // per-probe damping
const PROBES = [ // local x (right), z (back), lever for pitch
  { x: 0, z: -1.15 }, { x: 0, z: 1.15 }, { x: -0.42, z: 0.1 }, { x: 0.42, z: 0.1 },
];
export const TOP_SPEED = 19.5;
const THRUST = MASS * 6.2;                // full-throttle jet thrust, N
const LIN_DRAG = 55;
const QUAD_DRAG = (THRUST - LIN_DRAG * TOP_SPEED) / (TOP_SPEED * TOP_SPEED);
const TURN = 1.05;                        // rad/s at full lock and throttle

export class Craft {
  constructor() {
    this.thrustScale = 1;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    Object.assign(this, {
      x, z, y: 0, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0, pitch: 0, pitchRate: 0, roll: 0,
      rpm: 0, throttle: 0, steer: 0, airborne: false, airTime: 0, wet: 1, intakeWet: true,
      speed: 0, fwdSpeed: 0, landing: 0, spray: 0, lean: 0,
    });
  }

  // controls: { throttle 0..1, steer -1..1 (left positive) }
  // env: { surface(x, z) -> height, rampHeight(x, z) }
  step(dt, controls, env) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    this.landing = 0;
    for (let i = 0; i < n; i++) this.substep(h, controls, env);
    this.speed = Math.hypot(this.vx, this.vz);
  }

  substep(h, ctl, env) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    const sp = Math.sin(this.pitch);
    const vf = this.vx * fx + this.vz * fz;
    const vr = this.vx * rx + this.vz * rz;

    // Hull probes.
    let fy = -MASS * G, torque = 0, wetCount = 0, onRamp = false;
    let intake = -1;
    for (let i = 0; i < PROBES.length; i++) {
      const p = PROBES[i];
      const px = this.x + rx * p.x - fx * p.z, pz = this.z + rz * p.x - fz * p.z;
      const bottom = this.y - p.z * sp;
      let surf = env.surface(px, pz);
      const ramp = env.rampHeight(px, pz);
      let stiff = 1;
      if (ramp > surf) { surf = ramp; stiff = 5; onRamp = true; }
      const depth = surf - bottom;
      if (i === 1) intake = depth;
      if (depth <= 0) continue;
      wetCount++;
      const vpt = this.vy - p.z * Math.cos(this.pitch) * this.pitchRate;
      let f = K * stiff * Math.min(depth, 0.8) - C * stiff * vpt;
      // Planing lift grows with speed (only while the hull is in the water).
      f += 0.17 * MASS * G * Math.min(1, (vf / TOP_SPEED) ** 2) * Math.min(1, depth / 0.08);
      if (f < 0) f = 0;
      fy += f;
      torque += f * -p.z;
    }
    const wet = wetCount / PROBES.length;
    this.wet = wet;
    this.intakeWet = intake > -0.06;

    // Airborne bookkeeping and landing impact.
    if (wetCount === 0) { this.airTime += h; if (this.airTime > 0.12) this.airborne = true; }
    else {
      if (this.airborne) this.landing = Math.max(this.landing, Math.max(0, -this.vy));
      this.airborne = false; this.airTime = 0;
    }

    // Engine: revs follow the throttle; unloaded (intake dry) they spin up.
    const target = this.intakeWet ? ctl.throttle : Math.min(1.12, ctl.throttle * 1.15 + 0.08);
    const tau = this.intakeWet ? 0.35 : 0.12;
    this.rpm += (target - this.rpm) * Math.min(1, h / tau);
    this.throttle = ctl.throttle;
    const thrust = this.intakeWet ? THRUST * this.thrustScale * Math.min(1, this.rpm) ** 2 : 0;

    // Forces along the hull.
    let ff = thrust;
    if (wet > 0) ff -= (LIN_DRAG * vf + QUAD_DRAG * vf * Math.abs(vf)) * (0.35 + 0.65 * wet) * (onRamp ? 0.3 : 1);
    ff -= 0.4 * vf * Math.abs(vf); // air
    // Sideways: the keel kills slip quickly in the water.
    const fr = -vr * MASS * (wet > 0 ? 3.2 * (0.4 + 0.6 * wet) : 0.05);
    // Thrust lifts the bow a little.
    torque += thrust * 0.06;

    // Pitch: water torque from the probes, damping; in the air a gentle nose-down.
    if (wetCount === 0) torque += -MASS * 1.1 * (this.pitch + 0.08) - 60 * this.pitchRate;
    else torque += -200 * this.pitchRate;
    this.pitchRate += (torque / I_PITCH) * h;
    this.pitch += this.pitchRate * h;
    if (this.pitch > 0.75) { this.pitch = 0.75; this.pitchRate = Math.min(0, this.pitchRate); }
    if (this.pitch < -0.55) { this.pitch = -0.55; this.pitchRate = Math.max(0, this.pitchRate); }

    // Steering through the nozzle (plus a little off-throttle steering).
    this.steer += (ctl.steer - this.steer) * Math.min(1, h / 0.12);
    let targetYaw = 0;
    if (this.intakeWet) {
      const authority = 0.28 + 0.72 * Math.min(1, this.rpm);
      targetYaw = this.steer * TURN * authority * Math.min(1, Math.max(0.25, Math.abs(vf) / 6));
      this.yawRate += (targetYaw - this.yawRate) * Math.min(1, h / 0.22);
    } else {
      this.yawRate *= 1 - Math.min(1, h * 0.6);
    }
    this.yaw += this.yawRate * h;

    // Integrate.
    this.vx += ((ff * fx + fr * rx) / MASS) * h;
    this.vz += ((ff * fz + fr * rz) / MASS) * h;
    this.vy += (fy / MASS) * h;
    this.x += this.vx * h;
    this.z += this.vz * h;
    this.y += this.vy * h;

    this.fwdSpeed = vf;
    // Lean into turns (visual), and spray strength for effects.
    const leanTarget = Math.max(-0.5, Math.min(0.5, -this.yawRate * Math.max(0, vf) * 0.045));
    this.lean += (leanTarget - this.lean) * Math.min(1, h * 5);
    this.spray = wet > 0 ? Math.min(1, Math.abs(vf) / 12) : 0;
  }
}
