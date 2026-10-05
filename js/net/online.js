// Online play: sign in to the play service, then host / join / quick-match a
// lobby over the service WebSocket. The match itself is host-authoritative P2P
// (same E.Relay + E.Net as LAN) — the service only introduces players, vouches
// for them with a signed match ticket, and reconciles the result for Elo.
//
// The service URL is configurable (defaults to the play subdomain or
// localhost:8787 in dev). Auth uses a Bearer token (returned in the login
// response) so the cross-origin game client does not depend on cookies.
(function (E) {
  'use strict';

  // browser globals, guarded so the client also loads in a Node test harness
  const _loc = (typeof location !== 'undefined') ? location : { protocol: 'file:', host: '', href: '' };
  const _ls = (typeof localStorage !== 'undefined') ? localStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const _fetch = (typeof fetch !== 'undefined') ? fetch : null;

  const LS_TOKEN = 'gc_online_token', LS_USER = 'gc_online_user', LS_URL = 'gc_online_url';

  function defaultServiceUrl() {
    const stored = _ls.getItem(LS_URL);
    if (stored) return stored.replace(/\/$/, '');
    if (_loc.protocol === 'https:') {
      // production: the game is on the apex domain, the API on play.<domain>
      return 'https://play.' + _loc.host;
    }
    if (_loc.protocol === 'http:') return 'http://' + _loc.host; // same-origin (play service serving the game)
    return 'http://localhost:8787'; // file://
  }

  function api(baseUrl, path, method, body, token) {
    if (!_fetch) return Promise.reject(new Error('no fetch'));
    return _fetch(baseUrl + path, {
      method: method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d })));
  }

  class OnlineClient {
    constructor() {
      this.baseUrl = defaultServiceUrl();
      this.token = _ls.getItem(LS_TOKEN) || null;
      try { this.user = JSON.parse(_ls.getItem(LS_USER) || 'null'); } catch { this.user = null; }
      this.relay = null;
      this.role = null; this.room = null;
      this.roster = new Map(); // id -> {name, ready, rating}
      this.ticket = null; this.match = null; this.ranked = false;
      this.mode = 'team';
      this._wantOpen = false; this._reconnectT = null; this._reconnects = 0;
      this._handlers = {};
    }
    on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); return this; }
    emit(ev, m) { (this._handlers[ev] || []).forEach((f) => { try { f(m); } catch (e) { console.error(e); } }); }
    setUrl(u) { this.baseUrl = String(u || '').replace(/\/$/, ''); _ls.setItem(LS_URL, this.baseUrl); }

    // ── account ────────────────────────────────────────────────
    login(email, password, name) {
      return api(this.baseUrl, '/api/auth/login', 'POST', { email, password, name: name || this.name() }, this.token)
        .then((r) => {
          if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'login failed');
          this._save(r.d);
          return r.d;
        });
    }
    signup(email, password, name) {
      return api(this.baseUrl, '/api/auth/signup', 'POST', { email, password, name: name || 'Commander' })
        .then((r) => {
          if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'signup failed');
          this._save(r.d);
          return r.d;
        });
    }
    name() { return (this.user && this.user.name) || 'Commander'; }
    _save(d) { this.token = d.token; this.user = d.user || this.user; _ls.setItem(LS_TOKEN, this.token); _ls.setItem(LS_USER, JSON.stringify(this.user)); }
    logout() { this.token = null; this.user = null; _ls.removeItem(LS_TOKEN); _ls.removeItem(LS_USER); }

    // ── connection ─────────────────────────────────────────────
    connect() {
      this._wantOpen = true;
      const relay = new E.Relay();
      this.relay = relay;
      relay.on('hosted', (m) => { this.role = 'host'; this.room = m.room; this.roster.set(0, { name: this.name(), ready: true, host: true }); this.emit('hosted', m); this.emit('lobby', this._lobby()); });
      relay.on('joined', (m) => { this.role = 'guest'; this.room = m.room; this.roster.set(0, { name: m.hostName || 'Host', ready: true, host: true }); this.roster.set(m.id, { name: this.name(), ready: false }); this._selfId = m.id; this.emit('joined', m); this.emit('lobby', this._lobby()); });
      relay.on('peer', (m) => { if (m.open) { this.roster.set(m.id, { name: m.name, ready: false, rating: m.rating }); this.emit('lobby', this._lobby()); } });
      relay.on('left', (m) => { this.roster.delete(m.id); this.emit('lobby', this._lobby()); });
      relay.on('ready', (m) => { if (m.state) { for (const g of m.state.guests) this.roster.set(g.id, Object.assign(this.roster.get(g.id) || {}, { name: this.roster.get(g.id) && this.roster.get(g.id).name, ready: g.ready })); } this.emit('lobby', this._lobby()); });
      relay.on('ticket', (m) => { this.ticket = m.ticket; this.match = m.match; this.ranked = !!m.ranked; this.emit('ticket', m); });
      relay.on('lobbies', (m) => this.emit('lobbies', m.rooms || []));
      relay.on('closed', () => this.emit('closed'));
      relay.on('error', (m) => this.emit('error', m));
      relay.on('sigclose', () => { this.emit('sigclose'); this._scheduleReconnect(); });
      return relay.connect(this.baseUrl + '/ws').then(() => relay.auth(this.token, '0.1.0', 'web')).then(() => { this.user = relay.user || this.user; this.emit('signed', { user: relay.user, ice: relay.ice.length }); return this; });
    }
    host(mode) { this.mode = mode || 'team'; if (this.relay) this.relay.host(this.name(), { mode: this.mode }); }
    join(code, mode) { this.mode = mode || 'team'; if (this.relay) this.relay.join(code, this.name(), { mode: this.mode }); }
    quick(mode) { this.mode = mode || 'team'; if (this.relay) this.relay.queue(this.mode); }
    browse() { if (this.relay) this.relay.browse(); }
    ready(on) { if (this.relay) this.relay.ready(on); }
    start(rated) { if (this.relay) this.relay.start(rated); }
    // post the match result for reconciliation + Elo (both players call this)
    claim(result, team) {
      if (!this.ticket) return Promise.reject(new Error('no ticket'));
      return api(this.baseUrl, '/api/match/claim', 'POST', { ticket: this.ticket, match: this.match, result: result || null, team: team || null }, this.token)
        .then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'claim failed'); return r.d; });
    }
    // ── cloud saves ────────────────────────────────────────────
    cloudList() { return api(this.baseUrl, '/api/cloud', 'GET', null, this.token).then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'cloud list failed'); return r.d; }); }
    cloudGet(key) { return api(this.baseUrl, '/api/cloud/' + encodeURIComponent(key), 'GET', null, this.token).then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'cloud get failed'); return r.d; }); }
    cloudPut(key, value, version) { return api(this.baseUrl, '/api/cloud/' + encodeURIComponent(key), 'PUT', version != null ? { value, version } : { value }, this.token).then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'cloud save failed'); return r.d; }); }
    cloudDelete(key) { return api(this.baseUrl, '/api/cloud/' + encodeURIComponent(key), 'DELETE', null, this.token).then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'cloud delete failed'); return r.d; }); }
    // upload the current settings/profile/campaign envelope as one slot
    cloudSave(key, version) { return this.cloudPut(key || 'save', E.Save.envelope(), version); }
    // download a slot and apply it to localStorage; returns the split data
    cloudLoad(key) { return this.cloudGet(key || 'save').then((r) => ({ data: E.Save.importString(JSON.stringify(r.value)), version: r.version })); }

    _lobby() {
      const guests = [...this.roster.entries()].filter(([id]) => id !== 0).map(([id, g]) => ({ id, name: g.name, ready: !!g.ready, rating: g.rating }));
      const host = this.roster.get(0) || { name: this.name() };
      return { role: this.role, room: this.room, host: host.name, guests, allReady: guests.length === 0 || guests.every((g) => g.ready) };
    }
    close() {
      this._wantOpen = false;
      if (this._reconnectT) { clearTimeout(this._reconnectT); this._reconnectT = null; }
      if (this.relay) { try { this.relay.close(); } catch {} this.relay = null; }
      this.role = null; this.room = null; this.roster.clear(); this.ticket = null;
    }
    // After an unexpected signaling drop, re-establish the socket with backoff and,
    // if we were a guest, rejoin the same room. The P2P match itself rides on the
    // WebRTC DataChannel and survives the signaling server going away.
    _scheduleReconnect() {
      if (!this._wantOpen || this._reconnectT) return;
      if (this._reconnects >= 5) { this.emit('reconnectFailed'); return; }
      const delay = Math.min(15000, 1000 * Math.pow(2, this._reconnects++));
      this.emit('reconnecting', { attempt: this._reconnects, delay });
      this._reconnectT = setTimeout(() => {
        this._reconnectT = null;
        this.connect().then(() => {
          this._reconnects = 0;
          this.emit('reconnected');
          if (this.role === 'guest' && this.room && this.relay) this.relay.join(this.room, this.name(), { mode: this.mode });
        }).catch(() => this._scheduleReconnect());
      }, delay);
    }
  }

  E.Online = { OnlineClient, defaultServiceUrl };
})(window.E = window.E || {});
