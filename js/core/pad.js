// Gamepad input. `mapPad` is pure (axes/buttons -> a normalised state plus
// one-shot button edges) so it can be unit-tested; the `Pad` wrapper just finds
// the first connected controller via navigator.getGamepads and remembers the
// previous frame's buttons for edge detection. The game merges this with the
// keyboard and mouse, so a controller works alongside them, and the simulation
// never sees the difference (it still receives the same command shape).
(function (E) {
  'use strict';
  const DEAD = 0.18;                       // stick dead zone
  const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, start: 9, dup: 12, ddown: 13, dleft: 14, dright: 15 };

  function dz(v) { v = v || 0; const a = Math.abs(v); if (a < DEAD) return 0; return (a - DEAD) / (1 - DEAD) * Math.sign(v); }
  function dv(b) { if (!b) return 0; if (typeof b.value === 'number') return b.value; return b.pressed ? 1 : 0; }

  // prevButtons: array of booleans from the previous frame (or omitted).
  function mapPad(axes, buttons, prevButtons) {
    axes = axes || []; buttons = buttons || [];
    const prev = (i) => !!(prevButtons && prevButtons[i]);
    const down = (i) => dv(buttons[i]) > 0.5;
    const pressed = {};
    for (const k in BTN) pressed[k] = down(BTN[k]) && !prev(BTN[k]);
    return {
      moveX: dz(axes[0]) || 0, moveY: -dz(axes[1]) || 0,
      lookX: dz(axes[2]) || 0, lookY: dz(axes[3]) || 0,
      fire: dv(buttons[BTN.rt]) > 0.4, abil: dv(buttons[BTN.lt]) > 0.4,
      abil2: down(BTN.x), jump: down(BTN.a), crouch: down(BTN.b), sprint: down(BTN.rb),
      pressed,
    };
  }

  class Pad {
    constructor() { this.prev = []; this.connected = false; this.index = -1; }
    state() {
      if (typeof navigator === 'undefined' || !navigator.getGamepads) { this.connected = false; return null; }
      let gp = null;
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; this.index = i; break; }
      if (!gp) { this.connected = false; this.prev = []; return null; }
      this.connected = true;
      const s = mapPad(gp.axes || [], gp.buttons || [], this.prev);
      const now = [];
      for (let i = 0; i < (gp.buttons ? gp.buttons.length : 0); i++) now[i] = dv(gp.buttons[i]) > 0.5;
      this.prev = now;
      return s;
    }
  }

  E.Pad = { mapPad, Pad, BTN, DEAD };
})(window.E = window.E || {});
