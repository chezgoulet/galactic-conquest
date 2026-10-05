// Commander view: what is selected and what you can tell it, the call-ins
// (bomber / gunship / any strike, orbital strike, fleet verbs) and a three-domain
// overview: ground posts and troops, aircraft, fleets and the orbital stage.
// A call-in that needs a position "arms" and the next map click fires it (game.js).
(function (E) {
  'use strict';
  const P = E.HUD.prototype;
  const KN = { infantry: 'Infantry', vehicle: 'Armor', fighter: 'Aircraft' };

  P.cmdBegin = function () {
    const calls = this.$.cmd.querySelector('.cm-calls');
    calls.innerHTML = `
      <div class="cm-h">CALL-INS <span class="cm-tog">▾</span> <span class="cm-arm"></span></div>
      <div class="cm-grp"><label>AIR SUPPORT</label>
        <button class="cbtn" data-c="cas:bomber"><b>Bomber run</b><em></em></button>
        <button class="cbtn" data-c="cas:gunship"><b>Gunship strike</b><em></em></button>
        <button class="cbtn" data-c="cas:any"><b>Any aircraft</b><em></em></button></div>
      <div class="cm-grp"><label>FLEET</label>
        <button class="cbtn" data-c="strike"><b>Orbital strike</b><em></em></button>
        <button class="cbtn" data-c="wing"><b>Launch wing</b><em></em></button>
        <button class="cbtn" data-c="brace"><b>Brace</b><em></em></button>
        <button class="cbtn" data-c="board"><b>Board target</b><em></em></button>
        <button class="cbtn" data-c="retreat"><b>Retreat</b><em></em></button>
        <div class="cb-pw"><span>POWER</span>${['balanced', 'shields', 'weapons', 'engines'].map((n, i) => `<button class="pwb" data-p="${i}">${n}</button>`).join('')}</div></div>`;
    // the call-in panel starts folded so it does not cover the tactical view; the header toggles it
    const ch = calls.querySelector('.cm-h');
    ch.style.cursor = 'pointer'; ch.title = 'Show / hide call-ins';
    ch.addEventListener('click', () => { calls.classList.toggle('collapsed'); if (E.SFX) E.SFX.play('ui'); });
    calls.classList.add('collapsed');
    if (!calls._wired) {
      calls._wired = true;
      calls.addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return; const g = this.game;
        if (b.dataset.p !== undefined) { g.cmd('verb', 'power', +b.dataset.p); if (E.SFX) E.SFX.play('select'); return; }
        const c = b.dataset.c; if (!c) return;
        if (c.startsWith('cas:') || c === 'strike') { this.armed = this.armed && this.armed.id === c ? null : { id: c, kind: c === 'strike' ? 'strike' : 'cas', role: c.split(':')[1] }; this.toast(this.armed ? 'CLICK THE MAP TO MARK THE TARGET' : 'CANCELLED'); if (E.SFX) E.SFX.play('select'); return; }
        this.armed = null;
        if (c === 'wing') g.cmd('verb', 'launch'); else if (c === 'brace') g.cmd('verb', 'brace'); else if (c === 'retreat') g.cmd('verb', 'retreat'); else if (c === 'board') { const S = E.SIM.spaceState(g.world, g.team); g.cmd('verb', 'board', S && S.targetId); }
        if (E.SFX) E.SFX.play('confirm');
      });
      this.$.cmd.querySelector('.cm-sel').addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return; const g = this.game; if (!g.selected.length && b.dataset.o !== 'take') { this.toast('SELECT UNITS FIRST'); return; }
        if (b.dataset.o === 'hold') { g.cmd('order', g.selected, 'hold'); this.toast('ORDER: HOLD POSITION'); } else if (b.dataset.o === 'free') { g.cmd('order', g.selected, 'free'); this.toast('ORDER: FREE FIRE'); } else if (b.dataset.o === 'take') g.takeControl();
        if (E.SFX) E.SFX.play('confirm');
      });
    }
  };

  P.cmdUpdate = function (dt, w) {
    if (this.frameN % 5) return;
    const g = this.game, el = this.$.cmd, team = g.team, en = E.opponent(team);
    // selection
    const sel = g.selected.map(id => w.byId(id)).filter(u => u && u.alive), by = {}; let hp = 0, mx = 0;
    for (const u of sel) { by[u.kind] = (by[u.kind] || 0) + 1; hp += u.hp; mx += u.maxHp; }
    const body = sel.length ? `<div class="cm-n">${sel.length}</div><div class="cm-k">${Object.keys(by).map(k => `${by[k]} ${KN[k] || k}`).join(' · ')}</div><div class="cm-hp"><i style="width:${Math.round(hp / Math.max(1, mx) * 100)}%"></i></div>` : '<div class="cm-none">Nothing selected.<br>Click a unit, drag a box, or press 1 / 2 / 3.</div>';
    const sb = el.querySelector('.cm-body'); if (sb._v !== body) { sb._v = body; sb.innerHTML = body; }
    const ord = `<button data-o="hold">Hold <kbd>H</kbd></button><button data-o="free">Free fire <kbd>V</kbd></button><button data-o="take">Take control <kbd>F</kbd></button><div class="cm-hint"><kbd>RMB</kbd> move order</div>`;
    const so = el.querySelector('.cm-orders'); if (!so._v) { so._v = 1; so.innerHTML = ord; }
    // overview
    const cnt = (t, k) => w.units.filter(u => u.alive && u.team === t && u.kind === k).length;
    const posts = (t) => w.cps.filter(c => c.owner === t).length;
    const T = w.teams[team], O = w.teams[en];
    const dom = (name, rows) => `<div class="dh">${name}</div>` + rows.map(([l, a, b]) => `<div class="dr"><span>${l}</span><b>${a}</b><i>vs</i><b class="e">${b}</b></div>`).join('');
    const S = w.space && E.SIM.spaceState ? E.SIM.spaceState(w, team) : null;
    const casN = (t) => w.units.filter(u => u.alive && u.team === t && u.kind === 'fighter' && u.air && u.air.cas).length;
    const set = (cls, html) => { const d = el.querySelector('.cm-dom.' + cls); if (d._v !== html) { d._v = html; d.innerHTML = html; } };
    set('ground', dom('GROUND', [['Posts', posts(team), posts(en)], ['Infantry', cnt(team, 'infantry'), cnt(en, 'infantry')], ['Armor', cnt(team, 'vehicle'), cnt(en, 'vehicle')], ['Tickets', T.tickets, O.tickets]]));
    set('air', dom('AIR', [['Aircraft', cnt(team, 'fighter'), cnt(en, 'fighter')], ['On strike', casN(team), casN(en)]]));
    set('space', S ? dom('SPACE · ' + S.stageName.toUpperCase(), [['Ships', S.own.ships, S.enemy.ships], ['Hull', Math.round(S.own.hull * 100) + '%', Math.round(S.enemy.hull * 100) + '%'], ['Shields', Math.round(S.own.shield * 100) + '%', Math.round(S.enemy.shield * 100) + '%']]) + `<div class="dsup"><i style="width:${Math.round((0.5 + 0.5 * (S.superiority || 0)) * 100)}%"></i></div>` + (S.boarding ? '<div class="dnote">Boarding action underway</div>' : '') : dom('SPACE', []));
    // call-in readiness
    const callT = w.air && w.air.callT && w.air.callT[team], wait = callT === undefined ? 0 : Math.max(0, Math.ceil(callT + E.AIR.callCooldown - w.t));
    const bt = (c) => el.querySelector(`.cbtn[data-c="${c}"]`);
    const cas = ['cas:bomber', 'cas:gunship', 'cas:any'];
    for (const c of cas) { const b = bt(c), role = c.split(':')[1], avail = w.units.some(u => u.alive && u.team === team && u.kind === 'fighter' && !u.pid && u.air && !u.air.cas && u.ord > 0 && (role === 'any' ? ['bomber', 'gunship', 'strike'].includes(u.def.role) : u.def.role === role)); b.disabled = wait > 0 || !avail; this.tx(b.querySelector('em'), wait > 0 ? 'Ready in ' + wait + 's' : avail ? 'Ready' : 'None available'); this.cl(b, 'armed', !!(this.armed && this.armed.id === c)); }
    const flag = S && w.units.find(u => u.alive && u.kind === 'capital' && u.team === team && u.flag) || w.units.find(u => u.alive && u.kind === 'capital' && u.team === team);
    const sb2 = bt('strike'); sb2.disabled = !(S && S.strikeReady); this.tx(sb2.querySelector('em'), S && S.strikeReady ? 'Ready — click the map' : T.strikeT > 0 ? Math.ceil(T.strikeT) + 's' : 'No battery'); this.cl(sb2, 'armed', !!(this.armed && this.armed.id === 'strike'));
    const fb = (c, ok, note) => { const b = bt(c); b.disabled = !ok; this.tx(b.querySelector('em'), note); };
    fb('wing', flag && flag.def.wing && flag.sys.hangar.alive && flag.launchCd <= 0, !flag ? 'No flagship' : flag.launchCd > 0 ? Math.ceil(flag.launchCd) + 's' : 'Ready');
    fb('brace', flag && flag.braceCd <= 0 && flag.braceT <= 0, !flag ? 'No flagship' : flag.braceCd > 0 ? Math.ceil(flag.braceCd) + 's' : 'Ready');
    fb('board', flag && S && S.targetId && E.SIM.boardingReady(w, flag, w.byId(S.targetId)), S && S.targetId ? (flag && E.SIM.boardingReady(w, flag, w.byId(S.targetId)) ? 'Ready' : 'Shields up / busy') : 'No fleet target');
    fb('retreat', !!flag, flag && flag.retreat ? 'Cancel retreat' : 'Order withdrawal');
    this.tx(el.querySelector('.cm-arm'), this.armed ? '· ARMED: click the map (Esc cancels)' : '');
    el.querySelectorAll('.pwb').forEach(b => this.cl(b, 'on', !!flag && flag.powerMode === +b.dataset.p));
  };
})(window.E = window.E || {});
