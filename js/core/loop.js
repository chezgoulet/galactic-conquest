// Fixed-timestep accumulator. The simulation advances in fixed HZ increments
// (deterministic), while the renderer interpolates with the returned alpha.
// The accumulator is clamped so a long frame (tab restore, GC pause) never
// spirals into a burst of catch-up steps.
(function (E) {
  'use strict';
  class Accumulator {
    constructor(hz) { this.hz = hz; this.h = 1 / hz; this.acc = 0; this.max = Math.max(0.25, this.h * 8); }
    add(delta) { this.acc += Math.min(delta, this.max); }
    // runs the fixed steps, returns the fractional alpha (0..1) to interpolate.
    pump(step) {
      // Cap catch-up at 4 fixed steps: after a long frame (a GPU compile, a GC
      // pause, a tab restore) the sim resynchronises instead of running a burst
      // of steps that prolongs the stall. Time is dropped, not queued.
      let n = 0;
      while (this.acc >= this.h - 1e-9) { this.acc -= this.h; step(this.h); if (++n >= 4) { this.acc = 0; break; } }
      return this.acc / this.h;
    }
    reset() { this.acc = 0; }
  }
  E.Accumulator = Accumulator;
})(window.E = window.E || {});
