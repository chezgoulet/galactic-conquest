// Career commendations: medals earned after a battle, folded into the local
// profile so a player has a record of how they fight beyond raw XP. Pure — each
// medal is a predicate over the battle result (Game.result()), so this evaluates
// identically in the browser and in tests.
(function (E) {
  'use strict';
  const LIST = [
    { id: 'veteran', name: 'Veteran', desc: 'Win a battle', test: (r) => !!r.won },
    { id: 'sharpshooter', name: 'Sharpshooter', desc: '20 kills in one battle', test: (r) => (r.kills || 0) >= 20 },
    { id: 'standard', name: 'Standard Bearer', desc: '4 captures in one battle', test: (r) => (r.captures || 0) >= 4 },
    { id: 'unstoppable', name: 'Unstoppable', desc: 'A kill streak of 10', test: (r) => (r.best || 0) >= 10 },
    { id: 'flawless', name: 'Flawless', desc: 'Win without dying', test: (r) => !!r.won && (r.deaths || 0) === 0 },
    { id: 'blitz', name: 'Blitz', desc: 'Win in under six minutes', test: (r) => !!r.won && (r.time || 1e9) < 360 },
    { id: 'martyr', name: 'Hold the Line', desc: 'Win after dying 10 times', test: (r) => !!r.won && (r.deaths || 0) >= 10 },
  ];
  function evaluate(r) {
    if (!r) return [];
    return LIST.filter((m) => { try { return m.test(r); } catch (e) { return false; } }).map((m) => ({ id: m.id, name: m.name, desc: m.desc }));
  }
  function count(profile) { const m = (profile && profile.medals) || {}; let n = 0; for (const k in m) n += m[k]; return n; }
  E.Commendations = { LIST, evaluate, count };
})(window.E = window.E || {});
