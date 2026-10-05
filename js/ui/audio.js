// The audio director. Reads the game each frame and (1) points the mixer's
// listener at the camera, (2) sets the environment (air density -> exterior
// muffling, cockpit vs open air), (3) drives the continuous voices for the unit
// the player is in (vehicle engine + hover + turret servo, jet thrust / wind /
// buffet, reactor rumble, deck drone, ground wind, footsteps), (4) ticks the
// cockpit alert tones (lock, missile warning, stall, core breach, out of
// bounds), (5) tells the score the domain and battle state, and (6) turns sim
// events into sounds, density-aware and rate-limited.
(function (E) {
  'use strict';
  const M = E.Mixer, clamp = E.clamp;
  // weapon key -> sound kind
  const WSFX = { blaster: 'rifle', carbine: 'rifle', engcarbine: 'rifle', repeater: 'repeater', longrifle: 'lance', rocket: 'rocket', grenade: 'launch', cannon: 'cannon', skiffgun: 'pulse', coax: 'repeater',
    aaflak: 'pd', aamissile: 'missile', turret: 'pulse', nestgun: 'repeater', ioncannon: 'ion', laser: 'laser', missile: 'missile', chin: 'chin', pod: 'pod', ptorp: 'torpedo', bomb: 'bombaway',
    turbo: 'capital', broadside: 'capital', flak: 'pd', torpedo: 'torpedo', orbital: null };
  const boomFor = (splash, big) => big ? 'boom2' : splash >= 20 ? 'boom3' : splash >= 12 ? 'boom2' : splash >= 6 ? 'boom1' : 'boom0';
  const DEATH_BOOM = { vehicle: 'boom2', fighter: 'boom1', capital: 'boom3', turret: 'boom2' };

  const D = {
    loops: {}, loopKind: '', gate: {}, t: 0, tFoot: 0, tLock: 0, tWarn: 0, tStall: 0, tCore: 0, tOob: 0, tAmb: 0, lastUid: -1, dom: 'ground',
    // plays a sound unless the same key fired within `gap` seconds
    ok(key, gap) { const t = D.t; if (t - (D.gate[key] || -9) < gap) return false; D.gate[key] = t; return true; },
    play(kind, vol, o) { return E.SFX.play(kind, null, vol, o); },
    stopLoops() { for (const k in D.loops) if (D.loops[k]) D.loops[k].stop(); D.loops = {}; D.loopKind = ''; },
    loop(name, opts) { return D.loops[name] || (D.loops[name] = E.SFX.loops[name](opts)); },

    // ── per frame ──
    frame(dt, g) {
      if (!M.ready || !E.Music.on) return;
      D.t += dt;
      const w = g.world, u = g.unit(), cam = g.renderer.scene.camera; if (!cam) return;
      M.setListener(cam); M.update(dt);
      const playing = g.state === 'play' && u, dens = E.SIM.density(M.listener.y), vac = dens < 0.08;
      const kind = playing ? (u.mode === 'boarding' ? 'boarding' : u.kind) : (g.state === 'commander' ? 'commander' : 'none');
      const interior = playing && (kind === 'fighter' || kind === 'capital' || kind === 'boarding');
      M.setEnv(dens, interior);
      // loop set follows the unit
      if (kind !== D.loopKind || (playing && u.id !== D.lastUid)) { D.stopLoops(); D.loopKind = kind; D.lastUid = playing ? u.id : -1; }
      const ground = D.loop('wind', {}); if (ground) ground.set({ gain: kind === 'fighter' || kind === 'capital' ? 0.0 : 0.55, dens });
      if (kind === 'vehicle') { const L = D.loop('vehicle', { heavy: u.type === 'tank' ? 1 : 0 }); if (L) { const sp = Math.abs(u.spd != null ? u.spd : Math.hypot(u.vel.x, u.vel.z)) / (u.def.speed || 20); L.set({ speed: sp, servo: u.aimLimited ? 1 : Math.min(1, Math.abs(u.turretRate || 0)), gain: 0.8 }); } }
      else if (kind === 'fighter') { const L = D.loop('jet', { interior: true }); if (L) L.set({ thr: u.thr || 0, boost: !!u.boosting, dens, speed: u.spd || 0, buffet: Math.max(u.stall || 0, clamp(((u.g || 1) - 4) / 5, 0, 1) * 0.6), gain: 0.85 }); }
      else if (kind === 'capital') { const L = D.loop('reactor', { interior: true }); if (L) L.set({ thr: Math.abs(u.throttle || 0), engines: u.power ? u.power[2] : 0.33, core: u.coreT > 0 ? 1 : 0, gain: 0.9 }); }
      else if (kind === 'boarding') { const L = D.loop('deck', { interior: true }); if (L) L.set({ gain: 0.7 }); }
      if (playing) D.cockpit(dt, g, w, u, kind);
      // score
      const T = w.teams[g.team], O = w.teams[E.opponent(g.team)], mr = T.tickets / Math.max(1, T.startTickets), orr = O.tickets / Math.max(1, O.startTickets);
      const sp = w.space && w.space[g.team];
      const st = { winning: mr > orr * 1.35 && mr > 0.4 || (sp && sp.won), losing: mr < orr * 0.65 || (sp && sp.lost), lastStand: T.tickets <= 25 && !w.winner && T.tickets < T.startTickets };
      E.Music.setState(st);
      const dom = playing ? (kind === 'capital' || (kind === 'fighter' && (u.band === 3 || u.band === 'space')) || kind === 'boarding' ? 'space' : kind === 'fighter' ? 'air' : 'ground') : (g.state === 'commander' ? D.dom : 'ground');
      D.dom = dom; E.Music.setDomain(dom);
      E.Music.setIntensity(g.state === 'attract' ? 0.3 : w.intensity);
    },

    // cockpit / bridge / infantry feedback tones that repeat while a condition holds
    cockpit(dt, g, w, u, kind) {
      const t = D.t;
      if (kind === 'infantry') {
        const sp = Math.hypot(u.vel.x, u.vel.z);
        if (sp > 1.5 && !u.vault && u.stance !== 2 && t > D.tFoot) { D.tFoot = t + clamp(2.7 / sp, 0.2, 0.7); D.play('footstep', clamp(sp / 9, 0.3, 0.9) * (u.stance === 1 ? 0.5 : 1), { interior: true, rate: 0.85 + Math.random() * 0.3 }); }
      }
      if (kind === 'fighter') {
        if (u.locked) { if (t > D.tLock) { D.tLock = t + 0.4; D.play('locked', 0.7, { interior: true }); } }
        else if (u.lockId && u.lockT > 0.02) { if (t > D.tLock) { D.tLock = t + 0.55 - 0.42 * u.lockT; D.play('lock', 0.7, { interior: true, rate: 0.9 + u.lockT * 0.3 }); } }
        if (u.warn >= 2 || (u.warn === 1 && u.mslD)) {
          const per = u.warn === 3 ? clamp(0.07 + (u.mslD || 600) / 1800, 0.08, 0.5) : u.warn === 2 ? 0.55 : 1.3;
          if (t > D.tWarn) { D.tWarn = t + per; D.play('msl', 0.75, { interior: true, rate: u.warn === 3 ? 1.12 : 1 }); }
        }
        if (u.stallWarn && t > D.tStall) { D.tStall = t + 0.55; D.play('stall', 0.7, { interior: true }); }
        if (u.oob > 0.05 && t > D.tOob) { D.tOob = t + 1.4; D.play('alarm', 0.5, { interior: true }); }
      }
      if (kind === 'capital' && u.coreT > 0 && t > D.tCore) { D.tCore = t + 1.7; D.play('klaxon', 0.9, { interior: true }); M.alert(1.2); }
    },

    // ── events ──
    events(g, events) {
      if (!M.ready || !E.Music.on) return;
      const u = g.unit(), uid = u ? u.id : -1, mine = g.team, me = g.pid, w = g.world;
      let n = 0;
      const sp = (p) => p; // positions are world space already
      for (const e of events) {
        if (n > 9) break;
        switch (e.type) {
          case 'fire': {
            const W = E.WEAPONS[e.wk]; if (!W) break; const k = WSFX[e.wk] !== undefined ? WSFX[e.wk] : (W.sfx || 'rifle'); if (!k) break;
            const own = e.uid === uid;
            if (own) { D.play(k, 0.85, { interior: true, rate: 0.97 + Math.random() * 0.06 }); n++; }
            else if (D.ok('f' + e.wk, 0.05) && D.play(k, 1, { pos: sp(e.pos) })) n++;
            break;
          }
          case 'impact': {
            if (e.splash > 0) { if (D.play(boomFor(e.splash, e.big), 1, { pos: e.pos })) n++; }
            else if (e.big) { if (D.ok('hh', 0.09) && D.play('hullhit', 0.8, { pos: e.pos })) n++; }
            else if (e.surf !== 'air' && D.ok('bh', 0.06) && D.play('bolthit', 0.7, { pos: e.pos })) n++;
            break;
          }
          case 'death': {
            const k = DEATH_BOOM[e.kind]; if (k) { if (D.play(k, 1, { pos: e.pos })) n++; }
            break;
          }
          case 'hit':
            if (e.by === me) D.play(e.kill ? 'kill' : 'hitmark', e.kill ? 0.7 : 0.4);
            else if (e.to === me) D.play(e.sh ? 'shield' : 'hurt', 0.6, { interior: true });
            break;
          case 'suppress': if (e.to === me && e.level > 0 && D.ok('whiz', 0.18)) D.play('whiz', 0.5 + e.level * 0.15); break;
          case 'capture': D.play(e.team === mine ? 'capture' : 'lost', 0.6); E.Music.sting('capture'); break;
          case 'neutral': D.play(e.prev === mine ? 'lost' : 'capture', 0.45); break;
          case 'shieldHit': {
            const own = e.uid === uid;
            if (own) { D.play('shieldhit', 0.8, { interior: true }); if (M.env.vac) D.play('thud', clamp(e.amt / 400, 0.2, 0.7), { interior: true }); }
            else if (D.ok('sh', 0.07)) D.play('shieldhit', 1, { pos: e.pos });
            break;
          }
          case 'shieldDown': D.play('shieldhit', e.team === mine ? 0.9 : 0.6, { pos: e.pos, rate: 0.6 }); if (e.team === mine) M.alert(0.5); break;
          case 'shieldCollapse': D.play('sysboom', 0.7, { pos: e.pos }); break;
          case 'sysDamaged': if (D.ok('sd', 0.12)) D.play('hullhit', 0.7, { pos: e.pos, interior: e.uid === uid }); break;
          case 'sysDestroyed': D.play('sysboom', 1, { pos: e.pos }); if (e.uid === uid) { D.play('thud', 0.9, { interior: true }); M.alert(0.8); } break;
          case 'hullBreach': D.play('breach', 1, { pos: e.pos }); if (e.uid === uid) D.play('creak', 0.8, { interior: true }); break;
          case 'coreBreach': if (e.team === mine) { D.play('klaxon', 1, { interior: true }); M.alert(2); } break;
          case 'brace': if (e.uid === uid) D.play('klaxon', 0.6, { interior: true }); break;
          case 'boardingAlarm': if (e.team === mine) { D.play('klaxon', 1, { interior: true }); M.alert(2); } break;
          case 'boardingLaunched': D.play('call', 0.7); break;
          case 'boardingStart': D.play('stinger', e.team === mine ? 0.6 : 0.8); break;
          case 'boardingResult': D.play(e.team === mine && e.result !== 'podsLost' && e.result !== 'shipLost' ? 'capture' : 'lost', 0.7); break;
          case 'boardNode': D.play('sysboom', 0.5, { interior: true }); break;
          case 'powerShift': if (e.to === me) D.play('tool', 0.7); break;
          case 'targetSelected': if (e.to === me) D.play('beep', 0.7); break;
          case 'shipDestroyed': D.play('boom3', 1, { pos: e.pos }); if (e.team === mine) { D.play('lost', 0.8); E.Music.sting('shipLost'); M.alert(1.2); } else D.play('capture', 0.5); break;
          case 'shipRetreating': if (e.team === mine) D.play('alarm', 0.6); break;
          case 'shipRetreated': D.play('boost', 0.7, { pos: e.pos }); break;
          case 'shipCaptured': D.play('stinger', 0.9); break;
          case 'stageChange': D.play('call', 0.8); break;
          case 'announce':
            if (e.key === 'capitalDown') { D.play('stinger', 1); if (e.team === mine) E.Music.sting('shipLost'); }
            else if (e.key === 'ticketsHalf' || e.key === 'ticketsLow') D.play('alarm', e.team === mine ? 0.7 : 0.35);
            else if (e.key === 'fleetVictory') D.play('capture', 0.8);
            else if (e.key === 'bridgeLost') { D.play('klaxon', 0.9); M.alert(1.5); }
            else if (e.key === 'spaceStage1' || e.key === 'spaceStage2' || e.key === 'spaceStage3') D.play('call', 0.8);
            else if (e.key === 'shieldgenDown') D.play('boom2', 0.9);
            else if (e.key === 'objectiveWon') D.play(e.team === mine ? 'capture' : 'lost', 0.7);
            else if (e.key === 'uplinkOnline') D.play('locked', 0.6);
            else D.play('beep', 0.4);
            break;
          case 'strikeWarn': D.play('orbital', 1, { pos: { x: e.pos.x, y: e.pos.y + 300, z: e.pos.z } }); if (e.team !== mine && u && E.distXZ2(u.pos, e.pos) < 90 * 90) { D.play('klaxon', 0.8, { interior: true }); M.alert(2); } break;
          case 'strikeBlocked': case 'strikeDenied': D.play('deny', 0.8); break;
          case 'ion': D.play('ion', 1, { pos: e.from || e.to }); break;
          case 'ionFlip': D.play(e.team === mine ? 'capture' : 'lost', 0.8); break;
          case 'structureDown': D.play('boom2', 1, { pos: e.pos }); break;
          case 'mineBlast': D.play('boom1', 1, { pos: e.pos }); break;
          case 'chargeBlast': D.play('boom2', 1, { pos: e.pos }); break;
          case 'mine': case 'charge': D.play('mine', 0.7, { pos: e.pos }); break;
          case 'mineSpotted': D.play('beep', 0.5); break;
          case 'defuse': D.play('tool', 0.6, { pos: e.pos }); break;
          case 'coverBreak': D.play('covbreak', 1, { pos: e.pos }); break;
          case 'flare': D.play('flare', e.uid === uid ? 0.8 : 1, e.uid === uid ? { interior: true } : { pos: e.pos }); break;
          case 'bombAway': D.play('bombaway', 0.9, e.uid === uid ? { interior: true } : { pos: e.pos }); D.play('whistle', 0.7, { pos: e.pos }); break;
          case 'warn': if (e.to === me && e.level === 3) { D.tWarn = 0; } break;
          case 'noLock': if (e.to === me) D.play('deny', 0.5); break;
          case 'lockLost': if (e.to === me) D.play('deny', 0.4); break;
          case 'boost': if (e.to === me && e.on) D.play('boost', 0.8, { interior: true }); break;
          case 'armor': if (e.to === me) D.play('hullhit', 0.9, { interior: true }); else if (D.ok('ar', 0.08)) D.play('hullhit', 0.8, { pos: e.pos }); break;
          case 'ram': case 'bump': D.play('hullhit', 0.9, { pos: e.pos }); break;
          case 'crash': D.play('boom2', 1, { pos: e.pos }); break;
          case 'vault': case 'slide': if (e.uid === uid) D.play('vault', 0.7, { interior: true }); break;
          case 'tool': if (e.to === me) D.play('tool', 0.7); break;
          case 'repair': if (e.to === me && D.ok('weld', 0.12)) D.play('weld', 0.8, { interior: true }); break;
          case 'heal': if (D.ok('heal', 0.4)) D.play('shield', 0.5, { pos: e.pos, rate: 1.4 }); break;
          case 'build': D.play('build', 0.7, e.uid === uid ? { interior: true } : { pos: e.pos }); break;
          case 'airAccepted': if (e.to === me || e.team === mine) D.play('call', 0.7); break;
          case 'airInbound': if (e.team === mine) D.play('beep', 0.6); break;
          case 'airWeaponsAway': if (e.team === mine) D.play('beep', 0.7, { rate: 1.3 }); break;
          case 'airUnavailable': if (e.to === me) D.play('deny', 0.8); break;
          case 'airDrop': case 'airLoad': D.play('tool', 0.6); break;
          case 'troopsLost': if (e.team === mine) D.play('lost', 0.7); break;
          case 'launch': case 'launchOrder': D.play('boost', 0.5, e.pos ? { pos: e.pos } : undefined); break;
          case 'objAdd': D.play('call', 0.6); break;
          case 'objDone': D.play(e.success ? 'capture' : 'lost', 0.7); break;
          case 'possess': if (e.to === me) D.play('select', 0.7); break;
          case 'loadout': if (e.to === me) D.play('confirm', 0.6); break;
          case 'overheat': if (e.to === me) D.play('deny', 0.6); break;
          case 'gameOver': break;   // the game controller starts the victory / defeat score
          default: break;
        }
      }
    },
  };
  E.AudioDir = D;
})(window.E = window.E || {});
