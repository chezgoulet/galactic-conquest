// Tiny typed event emitter used for the game's decoupled systems (input ->
// controller, sim -> fx, music -> game, etc.). Namespaced events like 'fx.hit'.
(function (E) {
  'use strict';
  class Emitter {
    constructor() { this._m = new Map(); }
    on(type, fn) { let a = this._m.get(type); if (!a) { a = []; this._m.set(type, a); } a.push(fn); return this; }
    once(type, fn) { const w = (...a) => { this.off(type, w); fn(...a); }; return this.on(type, w); }
    off(type, fn) { const a = this._m.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } return this; }
    emit(type, payload) { const a = this._m.get(type); if (a) for (let i = 0; i < a.length; i++) a[i](payload); return this; }
    clear() { this._m.clear(); return this; }
  }
  E.Emitter = Emitter;
  // one shared bus for cross-cutting signals that aren't sim state
  E.bus = new Emitter();
})(window.E = window.E || {});
