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
      const relay = new E.Relay();
      this.relay = relay;
      relay.on('hosted', (m) => { this.role = 'host'; this.room = m.room; this.roster.set(0, { name: this.name(), ready: true, host: true }); this.emit('hosted', m); this.emit('lobby', this._lobby()); });
      relay.on('joined', (m) => { this.role = 'guest'; this.room = m.room; this.roster.set(0, { name: m.hostName || 'Host', ready: true, host: true }); this.roster.set(m.id, { name: this.name(), ready: false }); this._selfId = m.id; this.emit('joined', m); this.emit('lobby', this._lobby()); });
      relay.on('peer', (m) => { if (m.open) { this.roster.set(m.id, { name: m.name, ready: false, rating: m.rating }); this.emit('lobby', this._lobby()); } });
      relay.on('left', (m) => { this.roster.delete(m.id); this.emit('lobby', this._lobby()); });
      relay.on('ready', (m) => { if (m.state) { for (const g of m.state.guests) this.roster.set(g.id, Object.assign(this.roster.get(g.id) || {}, { name: this.roster.get(g.id) && this.roster.get(g.id).name, ready: g.ready })); } this.emit('lobby', this._lobby()); });
      relay.on('ticket', (m) => { this.ticket = m.ticket; this.match = m.match; this.ranked = !!m.ranked; this.emit('ticket', m); });
      relay.on('closed', () => this.emit('closed'));
      relay.on('error', (m) => this.emit('error', m));
      relay.on('sigclose', () => this.emit('sigclose'));
      return relay.connect(this.baseUrl + '/ws').then(() => relay.auth(this.token, '0.1.0', 'web')).then(() => { this.user = relay.user || this.user; this.emit('signed', { user: relay.user, ice: relay.ice.length }); return this; });
    }
    host(mode) { if (this.relay) this.relay.host(this.name(), { mode: mode || 'team' }); }
    join(code, mode) { if (this.relay) this.relay.join(code, this.name(), { mode: mode || 'team' }); }
    quick(mode) { if (this.relay) this.relay.queue(mode || 'team'); }
    ready(on) { if (this.relay) this.relay.ready(on); }
    start(rated) { if (this.relay) this.relay.start(rated); }
    // post the match result for reconciliation + Elo (both players call this)
    claim(result, team) {
      if (!this.ticket) return Promise.reject(new Error('no ticket'));
      return api(this.baseUrl, '/api/match/claim', 'POST', { ticket: this.ticket, match: this.match, result: result || null, team: team || null }, this.token)
        .then((r) => { if (!r.ok) throw new Error((r.d && (r.d.message || r.d.error)) || 'claim failed'); return r.d; });
    }
    _lobby() {
      const guests = [...this.roster.entries()].filter(([id]) => id !== 0).map(([id, g]) => ({ id, name: g.name, ready: !!g.ready, rating: g.rating }));
      const host = this.roster.get(0) || { name: this.name() };
      return { role: this.role, room: this.room, host: host.name, guests, allReady: guests.length === 0 || guests.every((g) => g.ready) };
    }
    close() { if (this.relay) { try { this.relay.close(); } catch {} this.relay = null; } this.role = null; this.room = null; this.roster.clear(); this.ticket = null; }
  }

  E.Online = { OnlineClient, defaultServiceUrl };
})(window.E = window.E || {});
