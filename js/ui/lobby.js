// Multiplayer lobby: two modes.
//   LAN    — zero-dep signaling server on the LAN; host-authoritative P2P.
//   Online — sign in to the play service, host/join/quick-match a lobby, ready
//            gate, then the SAME host-authoritative P2P match. The service signs
//            a match ticket and reconciles the result for Elo.
// Both share E.Relay (transport) and E.Net (host-authoritative session + the
// guest's RemoteWorld). In online the battle World is only built at the moment
// the host fires `start` (the `ticket` signal), so players wait in a lobby.
(function (E) {
  'use strict';

  function lanUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:')
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return 'ws://localhost:8080/ws';
  }
  function pageUrl() { return location.href.split('#')[0].replace(/\/$/, ''); }
  const BIOMES = ['desert', 'tundra', 'jungle', 'urban', 'volcanic', 'ocean', 'cratered', 'gas'];
  const biomeName = (b) => (E.biome(b) || {}).name || b;

  class Lobby {
    constructor(root, menu) { this.root = root; this.menu = menu; this.relay = null; this.session = null; this.game = null; this.oc = null; this.onlineRole = null; }
    _game() { this.game = window.GC.game; return this.game; }

    // ── LAN host ───────────────────────────────────────────────
    host(opts) {
      this._msg('Contacting the LAN server…');
      const relay = new E.Relay();
      this.relay = relay;
      const game = this._game();
      relay.connect(lanUrl()).then(() => { relay.host('Commander'); }).catch((e) => this._err('Could not reach the LAN server: ' + e.message));
      relay.on('hosted', (m) => {
        this.code = m.room;
        const g = this.root.querySelector('.mp-hostbox');
        g.hidden = false;
        g.querySelector('.mp-code').textContent = m.room;
        g.querySelector('.mp-url').textContent = pageUrl();
        this.menu.hide();
        game.start(Object.assign({ role: 'host', relay }, opts));
        this.session = new E.Net.NetSession();
        this.session.host(game);
        E.bus.emit('lan:hosted', { code: m.room });
      });
      relay.on('sigclose', () => this._err('Lost the LAN server'));
    }

    // ── LAN join ───────────────────────────────────────────────
    join(url, code, name) {
      this._msg('Contacting the server…');
      const relay = new E.Relay();
      this.relay = relay;
      const game = this._game();
      relay.connect(E.Relay.fromInput(url)).then(() => { relay.join(code, name); }).catch((e) => this._err('Could not reach server: ' + e.message));
      relay.on('joined', () => { this._msg('Connected. Waiting for the host to deploy…'); });
      relay.on('msg', (m) => { this._bootGuest(m, relay, name); });
      relay.on('error', (m) => this._err(m.msg || 'error'));
      relay.on('sigclose', () => this._err('Lost the LAN server'));
    }

    // boot the guest battle from a host `meta` (shared by LAN + online)
    _bootGuest(m, relay, name) {
      if (m.from !== 0) return;
      let s; try { s = JSON.parse(m.data); } catch { return; }
      if (s.t !== 'meta' || this.session) return;
      const game = this._game();
      const remote = new E.Net.RemoteWorld({ biome: s.biome, seed: s.seed, scale: s.scale, faction: s.faction, name });
      remote._pid = s.pid;
      const net = { send: (c) => relay.toHost(JSON.stringify(c)) };
      this.menu.hide();
      game.start({ role: 'guest', relay, net, replica: remote, pid: s.pid, human: s.faction, biome: s.biome, seed: s.seed, scale: s.scale });
      this.session = new E.Net.NetSession();
      this.session.guest(game);
      if (this.oc) {
        const oc = this.oc;
        game.onEnd = (r) => { oc.claim(r.winner, s.faction).catch(() => {}); E.bus.emit('online:ended', r); };
      }
      E.bus.emit('lan:joined', { faction: s.faction });
    }

    // ── Online ─────────────────────────────────────────────────
    // Builds the online panel into `pane` and wires the OnlineClient.
    online(pane) {
      const oc = new E.Online.OnlineClient();
      this.oc = oc;
      const el = (s) => pane.querySelector(s);
      const msg = (t, bad) => { const m = el('.mp-o-msg'); if (m) { m.textContent = t || ''; m.classList.toggle('bad', !!bad); } };

      // account pane
      el('.mp-o-url').value = oc.baseUrl;
      const doLogin = (signup) => {
        const email = el('.mp-o-email').value.trim();
        const pass = el('.mp-o-pass').value;
        const name = el('.mp-o-name').value.trim() || 'Commander';
        if (!email || !pass) return msg('Enter email and password.', true);
        el('.mp-o-url').value && oc.setUrl(el('.mp-o-url').value);
        msg(signup ? 'Creating account…' : 'Signing in…');
        (signup ? oc.signup(email, pass, name) : oc.login(email, pass, name))
          .then(() => oc.connect())
          .then(() => { oc.relay.on('msg', (m) => this._bootGuest(m, oc.relay, oc.name())); msg(''); showLobby(); })
          .catch((e) => msg(e.message || 'sign-in failed', true));
      };
      el('.mp-o-login').addEventListener('click', () => doLogin(false));
      el('.mp-o-signup').addEventListener('click', () => doLogin(true));

      // lobby pane
      const showLobby = () => { el('[data-opane="account"]').hidden = true; el('[data-opane="lobby"]').hidden = false; renderLobby(); };
      const showAccount = () => { el('[data-opane="lobby"]').hidden = true; el('[data-opane="account"]').hidden = false; };

      const renderLobby = () => {
        const lb = oc._lobby();
        el('.mp-o-room').textContent = lb.room || '—';
        el('.mp-o-host').textContent = lb.host;
        el('.mp-o-roster').innerHTML = lb.guests.length
          ? lb.guests.map((g) => `<div class="mp-o-guest"><span>${esc(g.name)}</span><i class="${g.ready ? 'rdy' : 'wait'}">${g.ready ? 'READY' : 'waiting'}</i></div>`).join('')
          : '<div class="mp-o-guest dim">no guests yet — share the code</div>';
        const isHost = lb.role === 'host';
        el('[data-host-ctl]').hidden = !isHost;
        el('[data-guest-ctl]').hidden = !!isHost;
        const start = el('.mp-o-start');
        start.disabled = !(isHost && lb.allReady);
        start.textContent = lb.allReady ? 'Start battle' : 'Waiting for ready…';
        // guest ready button reflects state
        const ready = el('.mp-o-ready');
        const selfReady = lb.guests.some((g) => g.ready);
        if (lb.role === 'guest') ready.textContent = selfReady ? 'Un-ready' : 'Ready';
      };

      oc.on('lobby', renderLobby);
      oc.on('error', (m) => msg(m.msg || 'error', true));
      oc.on('sigclose', () => msg('Lost the online service', true));

      el('.mp-o-do-host').addEventListener('click', () => { oc.host('team'); });
      el('.mp-o-join').addEventListener('click', () => {
        const code = el('.mp-o-jcode').value.trim().toUpperCase();
        if (!code) return msg('Enter a room code.', true);
        oc.join(code);
      });
      el('.mp-o-quick').addEventListener('click', () => oc.quick('team'));
      el('.mp-o-ready').addEventListener('click', () => {
        const selfReady = oc._lobby().guests.some((g) => g.ready);
        oc.ready(!selfReady);
      });
      el('.mp-o-start').addEventListener('click', () => {
        const biome = el('.mp-o-biome').value;
        oc._pending = { biome, seed: (Math.random() * 1e9) | 0 };
        oc.start(!!el('.mp-o-ranked').checked);
      });

      // GO: the host fires start -> everyone gets a ticket -> boot the battle
      oc.on('ticket', (m) => {
        if (oc._lobby().role === 'host') this._onlineHostGo(oc, m);
        // guest: the host's NetSession sends `meta`; _bootGuest boots the game
      });

      el('.mp-o-leave').addEventListener('click', () => { this.leave(); });

      // if already signed in, go straight to the lobby
      if (oc.token) showLobby(); else showAccount();
    }

    _onlineHostGo(oc, m) {
      const p = oc._pending || { biome: 'desert', seed: (Math.random() * 1e9) | 0 };
      const game = this._game();
      this.menu.hide();
      game.start({ role: 'host', relay: oc.relay, biome: p.biome, seed: p.seed, human: 'aegis' });
      this.session = new E.Net.NetSession();
      this.session.host(game);
      // reconcile the result for Elo when the match ends
      game.onEnd = (r) => {
        oc.claim(r.winner, 'aegis').then((d) => {
          const extra = d && d.status ? `<div class="r-xp">Match recorded · ${d.status}</div>` : '';
          if (game.hud && game.hud.resultsExtra) game.hud.resultsExtra(extra);
        }).catch(() => {});
        E.bus.emit('online:ended', r);
      };
    }

    _msg(text, bad) { const m = this.root.querySelector('.mp-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); } }
    _err(msg) { this._msg(msg, true); const b = this.root.querySelector('.mp-leave'); if (b) b.hidden = false; }
    leave() {
      if (this.session) { this.session.stop(); this.session = null; }
      if (this.oc) { try { this.oc.close(); } catch {} this.oc = null; }
      if (this.relay) { try { this.relay.close(); } catch {} this.relay = null; }
      if (this.game && this.game.stop) this.game.stop();
      if (this.menu && this.menu.show) this.menu.show();
      E.bus.emit('lan:leave');
    }
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // The menu's multiplayer screen: LAN and Online tabs.
  function mount(root, menu) {
    root.innerHTML = `
    <div class="mp-tabs">
      <button class="mp-tab mp-tab-lan" data-tab="lan">LAN</button>
      <button class="mp-tab mp-tab-online" data-tab="online">Online</button>
    </div>
    <div data-pane="lan">
      <div class="mp-col">
        <div class="m-sec">Host a battle</div>
        <p class="mp-msg">Anyone on your network can join with the room code. Your browser runs the battle; friends see it live.</p>
        <button class="gc-btn primary mp-host" style="width:100%">Host</button>
        <div class="mp-hostbox" hidden style="margin-top:12px">
          <div class="m-sec">Room code</div>
          <div class="mp-code"></div>
          <div class="m-sec">Address</div>
          <div class="mp-url"></div>
        </div>
      </div>
      <div class="mp-sep"><span>or join</span></div>
      <div class="mp-col">
        <div class="m-sec">Server address</div>
        <input class="mp-input mp-jurl" value="${pageUrl()}" placeholder="http://192.168.1.5:8080" />
        <div class="mp-row2">
          <input class="mp-input mp-jcode" placeholder="ROOM CODE" style="letter-spacing:4px" />
          <input class="mp-input mp-jname" placeholder="Callsign" />
        </div>
        <button class="gc-btn mp-join" style="width:100%;margin-top:12px">Join</button>
      </div>
      <div class="mp-col" style="margin-top:4px"><button class="gc-btn mp-leave" hidden>Leave battle</button></div>
    </div>
    <div data-pane="online" hidden>
      <div data-opane="account">
        <div class="m-sec">Sign in</div>
        <input class="mp-input mp-o-url" placeholder="https://play.example.com" />
        <div class="mp-row3">
          <input class="mp-input mp-o-email" placeholder="email" />
          <input class="mp-input mp-o-pass" type="password" placeholder="password" />
          <input class="mp-input mp-o-name" placeholder="callsign" />
        </div>
        <div class="mp-row2" style="margin-top:10px">
          <button class="gc-btn primary mp-o-login">Sign in</button>
          <button class="gc-btn mp-o-signup">Create account</button>
        </div>
        <p class="mp-msg mp-o-msg"></p>
      </div>
      <div data-opane="lobby" hidden>
        <div class="m-sec">Lobby · room <b class="mp-o-room">—</b></div>
        <div class="mp-o-hostname">Host: <b class="mp-o-host"></b></div>
        <div class="mp-o-roster"></div>
        <div class="mp-row2" data-host-ctl hidden style="margin-top:10px">
          <select class="mp-input mp-o-biome">${BIOMES.map((b) => `<option value="${b}">${biomeName(b)}</option>`).join('')}</select>
          <label class="mp-chk"><input type="checkbox" class="mp-o-ranked" /> ranked</label>
        </div>
        <div class="mp-row2" data-guest-ctl hidden style="margin-top:10px">
          <button class="gc-btn mp-o-ready">Ready</button>
        </div>
        <div class="mp-row2" style="margin-top:12px">
          <button class="gc-btn primary mp-o-do-host" style="flex:1">Host</button>
          <input class="mp-input mp-o-jcode" placeholder="CODE" style="letter-spacing:3px;flex:1" />
          <button class="gc-btn mp-o-join" style="flex:0 0 auto">Join</button>
        </div>
        <div class="mp-row2" style="margin-top:10px">
          <button class="gc-btn mp-o-quick" style="flex:1">Quick match</button>
          <button class="gc-btn primary mp-o-start" disabled style="flex:1">Start battle</button>
        </div>
        <div class="mp-col" style="margin-top:10px"><button class="gc-btn mp-leave" hidden>Leave battle</button></div>
      </div>
    </div>`;

    const lobby = new Lobby(root, menu);
    const opts = Object.assign({ biome: 'desert', seed: (E.RNG(1).i(1e9)), human: (menu && menu.profile && menu.profile.human) || 'aegis' }, (menu && menu.mpOpts) || {});

    // tabs
    const showTab = (t) => {
      root.querySelector('[data-pane="lan"]').hidden = t !== 'lan';
      root.querySelector('[data-pane="online"]').hidden = t !== 'online';
      root.querySelectorAll('.mp-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    };
    root.querySelector('.mp-tab-lan').addEventListener('click', () => showTab('lan'));
    root.querySelector('.mp-tab-online').addEventListener('click', () => showTab('online'));

    root.querySelector('.mp-host').addEventListener('click', () => lobby.host(opts));
    root.querySelector('.mp-join').addEventListener('click', () => {
      const url = root.querySelector('.mp-jurl').value.trim();
      const code = root.querySelector('.mp-jcode').value.trim().toUpperCase();
      const name = root.querySelector('.mp-jname').value.trim() || 'Commander';
      if (!code) { root.querySelector('.mp-jcode').style.borderColor = 'var(--danger)'; return; }
      lobby.join(url, code, name);
    });
    root.querySelectorAll('.mp-leave').forEach((b) => b.addEventListener('click', () => lobby.leave()));

    lobby.online(root.querySelector('[data-pane="online"]'));
    showTab('lan');
  }

  E.LAN = { Lobby, mount, lanUrl, pageUrl };
  E.Lobby = { mount }; // menu compatibility
})(window.E = window.E || {});
