// Bridge HUD (capital ships) and boarding HUD (marines inside an enemy ship).
//   Own ship: four shield arcs drawn around a hull silhouette, six subsystems with bars.
//   Target:   hull / shields, six subsystems with the selected one highlighted, boarding readiness.
//   Control:  power distribution (shield / weapons / engines) and preset, throttle, and
//             brace / wing / strike / board / retreat chips with readiness and cooldowns.
//   Core breach: a full-width countdown. Stage banner is in hud.js (stageBanner).
(function (E) {
  'use strict';
  const P = E.HUD.prototype, SP = E.SPACE, ORDER = SP.order;
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ARC_NAMES = ['FORE', 'AFT', 'PORT', 'STBD'];
  const arcColor = (f) => f > 0.6 ? '#5ac8ff' : f > 0.25 ? '#ffc24a' : f > 0.02 ? '#ff7a3a' : '#5b6575';

  P.spaceBegin = function () {
    const br = this.$.br;
    // own shield arcs: a hull glyph with four arcs around it
    br.querySelector('.br-arcs').innerHTML = `<svg viewBox="-50 -50 100 100"><path class="hull" d="M0 -26 L9 -8 L11 22 L4 28 L-4 28 L-11 22 L-9 -8 Z"/>` +
      ['M-22 -32 A38 38 0 0 1 22 -32', 'M-22 32 A38 38 0 0 0 22 32', 'M-36 -22 A38 38 0 0 0 -36 22', 'M36 -22 A38 38 0 0 1 36 22'].map((d, i) => `<path class="arc a${i}" d="${d}"/>`).join('') +
      ARC_NAMES.map((n, i) => `<text class="al" x="${[0, 0, -44, 44][i]}" y="${[-41, 45, 2, 2][i]}" text-anchor="middle">${n}</text>`).join('') + '</svg><div class="arc-note"></div>';
    const mkSys = (ul, own) => { ul.innerHTML = ORDER.map(n => `<li data-s="${n}"><span>${esc(SP.sys[n].label)}</span><div class="sbar"><i></i></div><b></b></li>`).join(''); };
    mkSys(br.querySelector('.br-own .br-sys'), true); mkSys(br.querySelector('.br-tgt .br-sys'), false);
    br.querySelector('.br-pow').innerHTML = `<div class="pw-h"><span>POWER</span><b class="pw-mode"></b></div><div class="pw-bars">${['SHIELDS', 'WEAPONS', 'ENGINES'].map(n => `<div class="pw"><label>${n}</label><div class="pbar"><i></i></div><b></b></div>`).join('')}</div><div class="pw-thr"><label>THROTTLE</label><div class="pbar"><i></i></div><b></b></div>`;
    br.querySelector('.br-btns').innerHTML = [['brace', 'C', 'BRACE'], ['wing', 'SPACE', 'LAUNCH WING'], ['strike', 'G', 'ORBITAL'], ['board', 'B', 'BOARD'], ['retreat', 'N N', 'RETREAT']].map(([id, k, n]) => `<div class="bt" data-b="${id}"><kbd>${k}</kbd><span>${n}</span><i></i><em></em></div>`).join('');
    // boarding
    this.$.board.querySelector('.bd-nodes').innerHTML = [['shield', 'SHIELD GENERATOR'], ['reactor', 'REACTOR'], ['bridge', 'BRIDGE']].map(([id, n]) => `<div class="nd" data-n="${id}"><span>${n}</span><div class="sbar"><i></i></div><b></b></div>`).join('');
  };

  const sysRows = (ul, ship, sel, hi) => {
    ul.querySelectorAll('li').forEach(li => {
      const n = li.dataset.s, s = ship && ship.sys && ship.sys[n]; if (!s) return;
      const f = s.maxHp ? s.hp / s.maxHp : 0, bar = li.querySelector('i');
      const w = (Math.round(f * 100)) + '%'; if (li._w !== w) { li._w = w; bar.style.width = w; li.querySelector('b').textContent = s.alive ? w : 'DOWN'; }
      const cls = (s.alive ? '' : 'dead ') + (f < 0.35 && s.alive ? 'low ' : '') + (sel === n ? 'sel' : ''); if (li._k !== cls) { li._k = cls; li.className = cls; }
    });
  };

  P.bridgeUpdate = function (u, w, dt) {
    const br = this.$.br, g = this.game;
    if (!u.sys) return;
    // own ship
    this.tx(br.querySelector('.br-own .br-h b'), E.unitName('capital', u.type).toUpperCase()); this.tx(br.querySelector('.br-own .br-h span'), `HULL ${Math.round(u.hp / u.maxHp * 100)}%`);
    u.arcs.forEach((a, i) => { const p = br.querySelector('.arc.a' + i), f = a.max ? a.v / a.max : 0; p.style.stroke = arcColor(f); p.style.opacity = String(0.35 + 0.65 * f); this.cl(p, 'hit', a.hitT < 0.6); });
    this.tx(br.querySelector('.arc-note'), u.arcs.map((a, i) => ARC_NAMES[i][0] + Math.round(a.v / (a.max || 1) * 100)).join('  '));
    sysRows(br.querySelector('.br-own .br-sys'), u, '');
    // target
    const tg = u.tgtId ? w.byId(u.tgtId) : null, T = br.querySelector('.br-tgt');
    this.show(T, true); this.cl(T, 'none', !(tg && tg.alive));
    if (tg && tg.alive && tg.sys) {
      this.tx(T.querySelector('.br-h b'), (tg.team === g.team ? 'ALLIED ' : 'ENEMY ') + E.unitName('capital', tg.type).toUpperCase());
      this.tx(T.querySelector('.br-h span'), `${Math.round(Math.hypot(tg.pos.x - u.pos.x, tg.pos.z - u.pos.z))} m${tg.retreat ? ' · RETREATING' : ''}${tg.captured ? ' · CAPTURED' : ''}`);
      this.wd(T.querySelector('.sh'), tg.maxShield ? tg.shield / tg.maxShield : 0); this.wd(T.querySelector('.hl'), tg.hp / tg.maxHp);
      sysRows(T.querySelector('.br-sys'), tg, u.tgtSys);
      const ready = E.SIM.boardingReady && E.SIM.boardingReady(w, u, tg), shUp = tg.arcs && tg.arcs.every(a => a.v > a.max * 0.05);
      this.tx(T.querySelector('.br-note'), u.tgtSys ? 'AIMING AT ' + SP.sys[u.tgtSys].label.toUpperCase() : 'AIMING AT THE HULL — T TO PICK A SUBSYSTEM');
      this.cl(T, 'boardable', !!ready); void shUp;
    } else { this.tx(T.querySelector('.br-h b'), 'NO TARGET'); this.tx(T.querySelector('.br-h span'), 'PRESS T'); this.wd(T.querySelector('.sh'), 0); this.wd(T.querySelector('.hl'), 0); this.tx(T.querySelector('.br-note'), 'T cycles enemy ships, then their subsystems'); T.querySelectorAll('li').forEach(li => { li.className = ''; li._k = ''; li.querySelector('b').textContent = ''; li.querySelector('i').style.width = '0'; li._w = ''; }); }
    // power
    const names = ['SHIELDS', 'WEAPONS', 'ENGINES'], pw = br.querySelectorAll('.pw');
    u.power.forEach((v, i) => { this.wd(pw[i].querySelector('i'), v / 0.6); this.tx(pw[i].querySelector('b'), Math.round(v * 100) + '%'); });
    this.tx(br.querySelector('.pw-mode'), (SP.powerNames[u.powerMode] || 'balanced').toUpperCase() + (u.retreat ? ' · RETREAT' : '')); void names;
    this.wd(br.querySelector('.pw-thr i'), Math.abs(u.throttle || 0)); this.tx(br.querySelector('.pw-thr b'), Math.round((u.throttle || 0) * 100) + '%');
    // verbs
    const S = E.SIM.spaceState(w, g.team), T2 = w.teams[u.team], btn = (id) => br.querySelector(`.bt[data-b="${id}"]`);
    const set = (id, state, note, frac) => { const b = btn(id); this.cl(b, 'ready', state === 'ready'); this.cl(b, 'busy', state === 'busy'); this.cl(b, 'off', state === 'off'); this.tx(b.querySelector('em'), note); b.querySelector('i').style.width = ((frac == null ? 1 : frac) * 100) + '%'; };
    set('brace', u.braceT > 0 ? 'busy' : u.braceCd > 0 ? 'off' : 'ready', u.braceT > 0 ? 'BRACED ' + u.braceT.toFixed(1) + 's' : u.braceCd > 0 ? Math.ceil(u.braceCd) + 's' : 'READY', u.braceT > 0 ? u.braceT / SP.braceTime : u.braceCd > 0 ? 1 - u.braceCd / SP.braceCd : 1);
    set('wing', !u.def.wing ? 'off' : !u.sys.hangar.alive ? 'off' : u.launchCd > 0 ? 'off' : 'ready', !u.def.wing ? 'NO HANGAR' : !u.sys.hangar.alive ? 'HANGAR DOWN' : u.launchCd > 0 ? Math.ceil(u.launchCd) + 's' : 'READY', u.launchCd > 0 ? 0.3 : 1);
    set('strike', S.strikeReady ? 'ready' : 'off', S.strikeReady ? 'READY' : T2.strikeT > 0 ? Math.ceil(T2.strikeT) + 's' : 'NO BATTERY', T2.strikeT > 0 ? 1 - T2.strikeT / E.WEAPONS.orbital.cd : 1);
    const br2 = S.boarding; const tgt = tg && tg.alive ? tg : null; const rd = tgt && E.SIM.boardingReady && E.SIM.boardingReady(w, u, tgt);
    set('board', br2 ? 'busy' : rd ? 'ready' : 'off', br2 ? (br2.status === 'pods' ? 'PODS ' + Math.round(br2.eta) + 's' : 'ACTIVE') : rd ? 'READY' : tgt ? (u.sys.hangar.alive ? 'SHIELDS UP' : 'HANGAR DOWN') : 'NO TARGET');
    set('retreat', u.retreat ? 'busy' : 'ready', u.retreat ? 'WITHDRAWING' : 'N N');
    // core breach
    const core = br.querySelector('.br-core'); this.show(core, u.coreT > 0); if (u.coreT > 0) { core.innerHTML = `<b>REACTOR CORE BREACH</b><span>${u.coreT.toFixed(0)}s</span><i style="width:${E.clamp01(u.coreT / SP.coreTime) * 100}%"></i>`; }
    this.cl(this.$.vig, 'core', u.coreT > 0);
  };

  P.bridgeOverlay = function (ctx, u, w, cam, o, W, H, R) {
    const tg = u.tgtId ? w.byId(u.tgtId) : null; if (!tg || !tg.alive || !tg.sys) return;
    const gold = '#ffd04a';
    cam.project(tg.pos, o);
    if (o.vis) { const s = R * 3; ctx.strokeStyle = gold; ctx.lineWidth = 2; ctx.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(o.x + sx * s, o.y + sy * s * 0.5); ctx.lineTo(o.x + sx * s, o.y + sy * s); ctx.lineTo(o.x + sx * s * 0.5, o.y + sy * s); } ctx.stroke(); }
    // subsystem markers on the target (selected one bright)
    for (const n of ORDER) {
      const s = tg.sys[n]; E.SIM.sysPos(tg, n, this._sp || (this._sp = {})); cam.project(this._sp, o); if (!o.vis) continue;
      const sel = u.tgtSys === n; const r = sel ? R * 0.9 : R * 0.4;
      ctx.strokeStyle = !s.alive ? 'rgba(130,140,155,.7)' : sel ? gold : 'rgba(255,255,255,.45)'; ctx.lineWidth = sel ? 2.5 : 1.2; ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, E.TAU); ctx.stroke();
      if (sel) { ctx.fillStyle = gold; ctx.font = `700 ${R * 0.68}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(SP.sys[n].label.toUpperCase() + ' ' + (s.alive ? Math.round(s.hp / s.maxHp * 100) + '%' : 'DOWN'), o.x, o.y - r - R * 0.7); ctx.beginPath(); ctx.moveTo(o.x - r - 6, o.y); ctx.lineTo(o.x - r - 14, o.y); ctx.moveTo(o.x + r + 6, o.y); ctx.lineTo(o.x + r + 14, o.y); ctx.stroke(); }
    }
  };

  P.boardUpdate = function (u, w, dt) {
    const bd = this.$.board, g = this.game, S = E.SIM.boardingState(w, g.team) || E.SIM.boardingState(w, E.opponent(g.team));
    if (!S) { this.tx(bd.querySelector('.bd-h'), 'BOARDING ACTION'); return; }
    const ship = w.byId(S.shipId), att = S.attackers === g.team;
    this.tx(bd.querySelector('.bd-h'), `${att ? 'BOARDING' : 'REPELLING BOARDERS ON'} · ${ship ? E.unitName('capital', ship.type).toUpperCase() : 'SHIP'} · ${Math.ceil(S.tLeft)}s`);
    bd.querySelectorAll('.nd').forEach(nd => { const p = S.nodes[nd.dataset.n]; this.wd(nd.querySelector('i'), p); this.tx(nd.querySelector('b'), Math.round(p * 100) + '%'); this.cl(nd, 'done', p >= 0.999); });
    this.tx(bd.querySelector('.bd-f'), `MARINES ${S.marines}  ·  DEFENDERS ${S.defenders}  ·  ${att ? 'Hold a glowing node to sabotage it; hold the bridge to capture the ship' : 'Kill the marines before they hold the nodes'}`);
  };
})(window.E = window.E || {});
