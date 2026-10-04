// The realtime hub: one WebSocket per client at /ws. It is a signalling +
// matchmaking service only — it introduces players and vouches for them with
// signed match tickets; it never carries game traffic (that runs peer to peer
// over WebRTC).
//
//   auth {token, version, platform} -> hello {user, ice, ticketKeys, config, announcements}
//   host/join/lobbies/kick/leave/start/end/queue/unqueue/ping
//   guest `ready {on}` -> `ready {state}` broadcast to the lobby
//   host<->guest `signal {to,data}` relayed (16 KB cap, flood-limited)
//   host `start` (all guests ready) -> ticket (signed) pushed to every roster member
//   end -> results posted to /api/matches (see results.js)
import crypto from 'node:crypto';
import { turnCredentials } from '../lib/crypto.js';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = () => { let s = ''; for (let i = 0; i < 5; i++) s += LETTERS[crypto.randomInt(LETTERS.length)]; return s; };
const MODES = new Set(['team', 'duel', 'ffa', 'ranked:team', 'ranked:duel']);
const MAX_LOBBY = 6, SIG_CAP = 16384, FLOOD = 12, BURST = 60;

export function buildHub(app) {
  const lobbies = new Map();   // code -> { code, host, guests:Map, mode, started }
  const queue = new Map();     // 'mode' -> Set<client>
  const clients = new Set();

  function makeClient(socket) {
    return {
      socket, user: null, lobby: null, id: 0, role: null, version: '', platform: '',
      tokens: FLOOD, last: 0, closed: false,
    };
  }

  function send(c, o) { if (c && !c.closed && c.socket.readyState === 1) c.socket.send(JSON.stringify(o)); }
  function roster(lobby) { return [lobby.host, ...lobby.guests.values()].filter(Boolean); }
  function broadcast(lobby, o, except) { for (const c of roster(lobby)) if (c !== except) send(c, o); }
  function allReady(lobby) {
    if (!lobby.guests.size) return true;
    for (const [id, c] of lobby.guests) if (!lobby.ready.get(id)) return false;
    return true;
  }
  function readySnapshot(lobby) {
    return { host: true, guests: [...lobby.guests.keys()].map((id) => ({ id, ready: !!lobby.ready.get(id) })) };
  }

  function joinLobby(c, lobby, id, name) {
    c.lobby = lobby; c.id = id; c.role = id === 0 ? 'host' : 'guest';
    if (id === 0) lobby.host = c; else lobby.guests.set(id, c);
    if (!lobby.ready) lobby.ready = new Map();
  }
  function leaveLobby(c) {
    const l = c.lobby; if (!l) return;
    c.lobby = null; c.role = null;
    if (l.host === c) {
      // host left: room closes, everyone is told
      for (const g of l.guests.values()) send(g, { op: 'closed' });
      l.guests.clear();
      if (l.ready) l.ready.clear();
      lobbies.delete(l.code);
    } else {
      l.guests.delete(c.id);
      if (l.ready) l.ready.delete(c.id);
      if (l.host) { send(l.host, { op: 'left', id: c.id }); broadcast(l, { op: 'ready', state: readySnapshot(l) }, c); }
      if (l.guests.size === 0 && l.host === c) { send(c, { op: 'closed' }); lobbies.delete(l.code); }
    }
  }

  function iceServers() {
    const out = [];
    if (app.cfg.TURN_SECRET && app.cfg.TURN_URLS) {
      const t = turnCredentials(app.cfg.TURN_SECRET, 12 * 3600);
      out.push({ urls: app.cfg.TURN_URLS.split(','), username: t.username, credential: t.credential });
    }
    out.push({ urls: 'stun:stun.l.google.com:19302' });
    return out;
  }

  async function hello(c) {
    const user = c.user;
    const cfg = await app.configStore.get('config', {});
    const keys = app.keys.publicKeys();
    const ann = await app.db.query('SELECT title, severity FROM announcements WHERE starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) ORDER BY created_at DESC LIMIT 5');
    send(c, { op: 'hello', user: { id: user.id, name: user.display_name, rating: user.rating, role: user.role }, ice: iceServers(), ticketKeys: keys, config: cfg, maintenance: app.cfg.MEMBERSHIP_ENABLED === '1', announcements: ann.rows });
  }

  function queueMode(mode) { return (mode && MODES.has(mode) ? mode : 'team'); }
  async function startMatch(lobby, rated) {
    const roster = [lobby.host, ...lobby.guests.values()].filter(Boolean);
    const users = await Promise.all(roster.map((c) => c.user));
    const mid = crypto.randomUUID();
    const myCode = code();
    await app.db.query('INSERT INTO matches (id, code, mode, host_id, started_at, rated) VALUES ($1,$2,$3,$4, now(), $5)', [mid, myCode, queueMode(lobby.mode), lobby.host.user.id, rated ? true : false]);
    await Promise.all(users.map((u, i) => app.db.query('INSERT INTO match_players (match_id, user_id, slot) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [mid, u.id, i])));
    const { token } = await app.keys.ticket({ v: 2, mid, room: myCode, iat: Date.now(), exp: Date.now() + 12 * 3600e3, host: lobby.host.user.id, ranked: !!rated, players: users.map((u, i) => ({ id: i, uid: u.id, name: u.display_name, sub: false, free: null })) });
    for (const c of roster) send(c, { op: 'ticket', match: myCode, mode: queueMode(lobby.mode), ranked: !!rated, ticket: token });
    for (const c of roster) { c.lobby.started = true; }
    if (lobby.ready) lobby.ready.clear(); // reset for a potential rematch
    return myCode;
  }

  function onMessage(c, m) {
    if (!m || typeof m !== 'object') return;
    // flood control (token bucket)
    const now = Date.now();
    if (now - c.last > 1000) { c.tokens = BURST; c.last = now; }
    c.tokens -= 1;
    if (c.tokens < 0) return;

    switch (m.op) {
      case 'auth': {
        if (c.user) return send(c, { op: 'error', msg: 'already authed' });
        app.auth.validateSession(m.token).then((v) => {
          if (!v) return send(c, { op: 'error', msg: 'bad token' });
          c.user = v.user; c.version = m.version || ''; c.platform = m.platform || '';
          hello(c).catch((e) => send(c, { op: 'error', msg: e.message }));
        }).catch(() => send(c, { op: 'error', msg: 'bad token' }));
        break;
      }
      case 'host': {
        if (!c.user) return send(c, { op: 'error', msg: 'auth first' });
        if (c.lobby) return send(c, { op: 'error', msg: 'already in a room' });
        let myCode; do { myCode = code(); } while (lobbies.has(myCode));
        const lobby = { code: myCode, host: null, guests: new Map(), mode: m.mode || 'team', started: false, ready: new Map() };
        lobbies.set(myCode, lobby);
        joinLobby(c, lobby, 0, c.user.display_name);
        send(c, { op: 'hosted', room: myCode, id: 0, ice: iceServers(), ready: readySnapshot(lobby) });
        break;
      }
      case 'join': {
        if (!c.user) return send(c, { op: 'error', msg: 'auth first' });
        if (c.lobby) return send(c, { op: 'error', msg: 'already in a room' });
        const lobby = lobbies.get(String(m.room || '').toUpperCase());
        if (!lobby) return send(c, { op: 'error', msg: 'no such room' });
        if (lobby.guests.size + 1 > MAX_LOBBY) return send(c, { op: 'error', msg: 'room full' });
        const id = lobby.guests.size + 1;
        joinLobby(c, lobby, id, c.user.display_name);
        send(c, { op: 'joined', room: lobby.code, id, ice: iceServers(), hostName: lobby.host.user.display_name, ready: readySnapshot(lobby) });
        if (lobby.host) { send(lobby.host, { op: 'peer', id, name: c.user.display_name, rating: c.user.rating }); broadcast(lobby, { op: 'ready', state: readySnapshot(lobby) }, c); }
        break;
      }
      case 'lobbies': {
        const rows = [];
        for (const l of lobbies.values()) if (!l.started) rows.push({ code: l.code, mode: l.mode, players: 1 + l.guests.size, max: MAX_LOBBY, host: l.host && l.host.user.display_name });
        send(c, { op: 'lobbies', rooms: rows });
        break;
      }
      case 'signal': {
        if (!c.lobby) return;
        const l = c.lobby;
        const to = c.id === 0 ? l.guests.get(m.to) : l.host;
        if (!to || c.closed) return;
        const data = m.data;
        const size = JSON.stringify(data).length;
        if (size > SIG_CAP) return;
        send(to, { op: 'signal', from: c.id, data });
        break;
      }
      case 'kick': {
        if (!c.lobby || c.lobby.host !== c) return;
        const g = c.lobby.guests.get(m.id);
        if (g) { send(g, { op: 'kicked' }); g.socket.close(); }
        break;
      }
      case 'ready': {
        if (!c.lobby) return;
        const l = c.lobby;
        if (c.id === 0) return; // host is always ready
        if (!l.ready) l.ready = new Map();
        l.ready.set(c.id, !!m.on);
        broadcast(l, { op: 'ready', state: readySnapshot(l) });
        break;
      }
      case 'start': {
        if (!c.lobby || c.lobby.host !== c) return;
        if (c.lobby.started) return send(c, { op: 'error', msg: 'match already started' });
        if (!allReady(c.lobby)) return send(c, { op: 'error', msg: 'players not ready' });
        startMatch(c.lobby, !!m.rated).catch((e) => send(c, { op: 'error', msg: e.message }));
        break;
      }
      case 'queue': {
        if (!c.user) return;
        const mode = queueMode(m.mode);
        if (!queue.has(mode)) queue.set(mode, new Set());
        queue.get(mode).add(c);
        tryMatch(mode);
        break;
      }
      case 'unqueue': {
        const set = queue.get(queueMode(m.mode)); if (set) set.delete(c);
        break;
      }
      case 'ping': send(c, { op: 'pong', t: m.t });
      case 'leave': case 'close': {
        if (c.lobby) { leaveLobby(c); send(c, { op: 'left', self: true }); }
        break;
      }
    }
  }

  // quick match: pair players by mode; the matched guest auto-readies so the
  // host can start immediately
  function tryMatch(mode) {
    const set = queue.get(mode); if (!set) return;
    const list = [...set];
    if (list.length < 2) return;
    const host = list[0], guest = list[1];
    set.delete(host); set.delete(guest);
    let myCode; do { myCode = code(); } while (lobbies.has(myCode));
    const lobby = { code: myCode, host: null, guests: new Map(), mode, started: false, ready: new Map() };
    lobbies.set(myCode, lobby);
    joinLobby(host, lobby, 0, host.user.display_name);
    joinLobby(guest, lobby, 1, guest.user.display_name);
    lobby.ready.set(1, true); // guest auto-readies
    send(host, { op: 'hosted', room: myCode, id: 0, ice: iceServers(), matched: true, ready: readySnapshot(lobby) });
    send(guest, { op: 'joined', room: myCode, id: 1, ice: iceServers(), hostName: host.user.display_name, matched: true, ready: readySnapshot(lobby) });
    send(host, { op: 'peer', id: 1, name: guest.user.display_name, rating: guest.user.rating });
    broadcast(lobby, { op: 'ready', state: readySnapshot(lobby) });
  }

  function attach(socket) {
    // socket is the ws object from our own RFC 6455 server (.send/.on/.close).
    const c = makeClient(socket);
    clients.add(c);
    socket.on('message', (d) => { try { onMessage(c, JSON.parse(d.toString())); } catch {} });
    socket.on('close', () => {
      c.closed = true;
      clients.delete(c);
      const l = c.lobby;
      if (l) {
        leaveLobby(c);
        if (l.guests.size === 0 && l.host === c) lobbies.delete(l.code);
      }
      for (const set of queue.values()) set.delete(c);
    });
  }

  return { attach, lobbies, queue, clients };
}
