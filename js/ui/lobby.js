// Local multiplayer lobby: host a battle on this machine (LAN) or join by room
// code. Uses the zero-dep signaling server (ws://host/ws) to introduce players,
// then the match runs peer to peer over WebRTC (E.Relay). Host-authoritative:
// the host runs the only World; guests send commands and render snapshots.
(function (E) {
  'use strict';

  function lanUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:')
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return 'ws://localhost:8080/ws';
  }
  function pageUrl() {
    return location.href.split('#')[0].replace(/\/$/, '');
  }

  class Lobby {
    constructor(root, menu) { this.root = root; this.menu = menu; this.relay = null; this.session = null; this.game = null; }
    _game() { this.game = window.GC.game; return this.game; }

    // ── host ───────────────────────────────────────────────────
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

    // ── join ───────────────────────────────────────────────────
    join(url, code, name) {
      this._msg('Contacting the server…');
      const relay = new E.Relay();
      this.relay = relay;
      const game = this._game();
      relay.connect(E.Relay.fromInput(url)).then(() => { relay.join(code, name); }).catch((e) => this._err('Could not reach server: ' + e.message));
      relay.on('joined', () => { this._msg('Connected. Waiting for the host to deploy…'); });
      relay.on('msg', (m) => {
        if (m.from !== 0) return;
        let s; try { s = JSON.parse(m.data); } catch { return; }
        if (s.t === 'meta' && !this.session) {
          // Rebuild the world locally from the host's seed; the session streams the rest.
          const remote = new E.Net.RemoteWorld({ biome: s.biome, seed: s.seed, scale: s.scale, faction: s.faction, name });
          remote._pid = s.pid;
          const net = { send: (c) => relay.toHost(JSON.stringify(c)) };
          this.menu.hide();
          game.start({ role: 'guest', relay, net, replica: remote, pid: s.pid, human: s.faction, biome: s.biome, seed: s.seed, scale: s.scale });
          this.session = new E.Net.NetSession();
          this.session.guest(game);
          this._msg('In battle! You command the ' + (s.faction === 'aegis' ? 'Concord' : 'Pact') + '.');
          E.bus.emit('lan:joined', { faction: s.faction });
        }
      });
      relay.on('error', (m) => this._err(m.msg || 'error'));
      relay.on('sigclose', () => this._err('Lost the LAN server'));
    }

    _msg(text, bad) {
      const m = this.root.querySelector('.mp-msg');
      if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); }
    }
    _err(msg) {
      this._msg(msg, true);
      const b = this.root.querySelector('.mp-leave'); if (b) b.hidden = false;
    }
    leave() {
      if (this.session) { this.session.stop(); this.session = null; }
      if (this.relay) { try { this.relay.close(); } catch {} this.relay = null; }
      if (this.game && this.game.stop) this.game.stop();
      if (this.menu && this.menu.show) this.menu.show();
      E.bus.emit('lan:leave');
    }
  }

  // The menu's multiplayer screen: choose Host or Join.
  function mount(root, menu) {
    root.innerHTML = `
    <div class="mp-lan">
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
      <div class="mp-col" style="margin-top:4px">
        <button class="gc-btn mp-leave" hidden>Leave battle</button>
      </div>
    </div>`;
    const lobby = new Lobby(root, menu);
    const opts = Object.assign({ biome: 'desert', seed: (E.RNG(1).i(1e9)), human: (menu && menu.profile && menu.profile.human) || 'aegis' }, (menu && menu.mpOpts) || {});
    root.querySelector('.mp-host').addEventListener('click', () => lobby.host(opts));
    root.querySelector('.mp-join').addEventListener('click', () => {
      const url = root.querySelector('.mp-jurl').value.trim();
      const code = root.querySelector('.mp-jcode').value.trim().toUpperCase();
      const name = root.querySelector('.mp-jname').value.trim() || 'Commander';
      if (!code) { root.querySelector('.mp-jcode').style.borderColor = 'var(--danger)'; return; }
      lobby.join(url, code, name);
    });
    root.querySelector('.mp-leave').addEventListener('click', () => lobby.leave());
  }

  E.LAN = { Lobby, mount, lanUrl, pageUrl };
  E.Lobby = { mount }; // menu compatibility
})(window.E = window.E || {});
