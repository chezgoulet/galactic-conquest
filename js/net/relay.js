// Peer-to-peer transport. A signaling server (the LAN host or the online
// service) introduces the players; every game message then travels over WebRTC
// DataChannels between host and guest, encrypted end to end (DTLS): directly on
// a LAN, through a TURN relay online. The server never sees game traffic, and a
// match survives the signaling server going away.
//
// API: host(name), join(room, name), send(to, data), toHost(data), kick(id),
// close(); events: hosted, joined, peer, left, msg, closed, sigclose, error.
(function (E) {
  'use strict';

  const CHUNK = 15000, HELLO_WAIT = 6000, RECOVER_MS = 15000, SOFT_WAIT = 2500;
  const FRAME = '\u0001', MAX_CHUNKS = 1024;   // fragment framing (see sendRaw/onMsg)
  E.PROTOCOL = 1; // bump when snapshots/commands/game data change incompatibly

  class Relay {
    constructor(opts) {
      this.opts = opts || {};
      this.ws = null;
      this.handlers = {};
      this.id = -1; this.room = ''; this.role = null;
      this.peers = new Map();
      this.ice = [];
      this.seq = 0;
      this.user = null; this.ticketKeys = {}; this.config = {}; this._auth = null;
    }
    static defaultUrl() {
      if (location.protocol === 'http:' || location.protocol === 'https:')
        return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      return 'ws://localhost:8080/ws';
    }
    static fromInput(raw) {
      const s = (raw || '').trim();
      if (!s) return '';
      if (/^wss?:\/\//i.test(s)) return s;
      return 'ws://' + s.replace(/\/+$/, '') + '/ws';
    }
    on(op, fn) { this.handlers[op] = fn; return this; }
    emit(op, m) { const h = this.handlers[op]; if (h) try { h(m); } catch (e) { console.error(e); } }
    raw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

    connect(url) {
      return new Promise((res, rej) => {
        let ws;
        try { ws = new WebSocket(url); } catch (e) { return rej(new Error('bad url')); }
        this.ws = ws;
        const to = setTimeout(() => { rej(new Error('timeout')); try { ws.close(); } catch {} }, 8000);
        ws.onopen = () => { clearTimeout(to); res(this); };
        ws.onerror = () => { clearTimeout(to); rej(new Error('could not reach ' + url)); };
        ws.onclose = () => { this.ws = null; this.emit('sigclose'); if (this.role !== 'host') { if (!this.peers.size || !this.hostOpen()) this.emit('close'); } };
        ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onSignal(m); };
      });
    }
    host(name, extra) { this.raw(Object.assign({ op: 'host', name }, extra || {})); }
    join(room, name, extra) { this.raw(Object.assign({ op: 'join', room, name }, extra || {})); }
    // online-only ops (the online service also handles these; the LAN server ignores unknown ops)
    auth(token, version, platform) {
      // returns a promise that resolves with the `hello` (user, ice, ticketKeys)
      return new Promise((res, rej) => {
        this._auth = { res, rej, to: setTimeout(() => { if (this._auth) { this._auth = null; rej(new Error('auth timeout')); } }, 8000) };
        this.raw({ op: 'auth', token, version: version || '', platform: platform || (typeof navigator !== 'undefined' && navigator.platform) || 'web' });
      });
    }
    ready(on) { this.raw({ op: 'ready', on: !!on }); }
    start(rated) { this.raw({ op: 'start', rated: !!rated }); }
    queue(mode) { this.raw({ op: 'queue', mode: mode || 'team' }); }
    unqueue(mode) { this.raw({ op: 'unqueue', mode: mode || 'team' }); }
    hostOpen() { const p = this.peers.get(0); return !!(p && p.dc && p.dc.readyState === 'open'); }

    onSignal(m) {
      switch (m.op) {
        case 'hello': // online service: authenticated (user, ice, ticketKeys)
          this.user = m.user || null; this.ice = m.ice || []; this.ticketKeys = m.ticketKeys || {};
          this.config = m.config || {}; this.maintenance = !!m.maintenance;
          if (this._auth) { const a = this._auth; this._auth = null; clearTimeout(a.to); a.res(m); }
          this.emit('signed', m); break;
        case 'hosted': this.role = 'host'; this.id = 0; this.room = m.room; if (m.ice) this.ice = m.ice; this.emit('hosted', m); break;
        case 'joined': this.role = 'guest'; this.id = m.id; this.room = m.room; if (m.ice) this.ice = m.ice; this.makePeer(0, m.hostName || 'Host', false); this.emit('joined', m); break;
        case 'peer': if (this.role === 'host') this.makePeer(m.id, m.name, true); break;
        case 'ready': this.emit('ready', m); break;
        case 'ticket': this.emit('ticket', m); break;
        case 'signal': this.onPeerSignal(m.from, m.data); break;
        case 'left': this.dropPeer(m.id); break;
        case 'closed': this.emit('closed', m); break;
        case 'error': this.emit('error', m); break;
      }
    }
    makePeer(id, name, isGuest) {
      const pc = new RTCPeerConnection({ iceServers: this.ice });
      const p = { id, name, isGuest, pc, dc: null, hello: false };
      this.peers.set(id, p);
      const sendCand = (e) => { if (e.candidate) this.raw({ op: 'signal', to: isGuest ? id : 0, data: { sdp: { type: 'cand', c: e.candidate } } }); };
      pc.onicecandidate = sendCand;
      pc.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(pc.connectionState)) this.recover(p); };
      if (isGuest) {
        // Host side: create the DataChannel and the offer.
        const dc = pc.createDataChannel('gc', { ordered: true });
        p.dc = dc;
        dc.onopen = () => { this._sendHello(p); this.emit('peer', { id, name, open: true }); };
        dc.onmessage = (ev) => { this.onMsg(p, ev.data); };
        dc.onclose = () => { p.dc = null; this.maybeClosed(); };
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
          this.raw({ op: 'signal', to: id, data: { sdp: { type: 'offer', sdp: pc.localDescription } } });
        }).catch(e => console.error('offer', e));
      } else {
        // Guest side: await the incoming DataChannel from the host.
        pc.ondatachannel = (e) => {
          const dc = e.channel; p.dc = dc;
          dc.onopen = () => { this._sendHello(p); this.emit('peer', { id, name, open: true }); };
          dc.onmessage = (ev) => { this.onMsg(p, ev.data); };
          dc.onclose = () => { p.dc = null; this.maybeClosed(); };
        };
      }
    }
    _sendHello(p) { p.helloAt = Date.now(); this.sendRaw(p, JSON.stringify({ k: 'hi', p: E.PROTOCOL })); }
    onPeerSignal(from, data) {
      const p = this.peers.get(from);
      if (!p || !p.pc) return;
      if (data.sdp) {
        const s = data.sdp;
        if (s.type === 'offer') {
          p.pc.setRemoteDescription(s.sdp).then(() => p.pc.createAnswer()).then(a => p.pc.setLocalDescription(a))
            .then(() => this.raw({ op: 'signal', to: from, data: { sdp: { type: 'answer', sdp: p.pc.localDescription } } }))
            .catch(e => console.error('answer', e));
        } else if (s.type === 'answer') { p.pc.setRemoteDescription(s.sdp).catch(e => console.error('set answer', e)); }
        else if (s.type === 'cand') { try { p.pc.addIceCandidate(s.c); } catch (e) {} }
      } else if (data.msg) { this.onMsg(p, data.msg); }
    }
    sendRaw(p, str) {
      if (!p.dc || p.dc.readyState !== 'open') return;
      if (str.length <= CHUNK) { p.dc.send(str); return; }
      // Fragment a payload that exceeds one DataChannel message. Each part is
      // prefixed with a frame header (STX id:part:total:) so the receiver can
      // reassemble it; DataChannels are ordered, and sendRaw is synchronous, so
      // the parts of one payload are never interleaved with another send.
      const id = (p._fid = (p._fid || 0) + 1), n = Math.ceil(str.length / CHUNK);
      for (let i = 0; i < n; i++) p.dc.send(FRAME + id + ':' + i + ':' + n + ':' + str.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    // host -> all, host -> one, guest -> host
    send(to, data) {
      const p = this.peers.get(to);
      if (p) this.sendRaw(p, typeof data === 'string' ? data : JSON.stringify(data));
    }
    toHost(data) { this.send(0, data); }
    toAll(data) { for (const p of this.peers.values()) this.send(p.id, data); }
    kick(id) { this.raw({ op: 'kick', id }); }
    // onMsg: reassemble framed fragments, then run the hello gate on whole messages
    onMsg(p, data) {
      if (typeof data === 'string' && data.charCodeAt(0) === 1) { this._reassemble(p, data); return; }
      this._deliver(p, data);
    }
    _deliver(p, data) {
      if (!p.hello && data && data.startsWith && data.startsWith('{"k":"hi"')) {
        let h; try { h = JSON.parse(data); } catch { return; }
        if (h.k === 'hi') { p.hello = true; if (h.p !== E.PROTOCOL) { this.dropPeer(p.id); this.emit('error', { msg: 'version mismatch' }); return; } this.emit('hello', { id: p.id, open: true }); return; }
      }
      this.emit('msg', { from: p.id, data });
    }
    // header: STX id:part:total:<payload>; parts of one id accumulate in order
    _reassemble(p, data) {
      const a = data.indexOf(':', 1), b = data.indexOf(':', a + 1), c = data.indexOf(':', b + 1);
      if (a < 0 || b < 0 || c < 0) return;
      const id = +data.slice(1, a), part = +data.slice(a + 1, b), total = +data.slice(b + 1, c);
      if (!(id > 0) || !(part >= 0) || !(total > 0) || total > MAX_CHUNKS || part >= total) return;
      let rx = p._rx;
      if (!rx || rx.id !== id) { rx = p._rx = { id, total, parts: new Array(total), got: 0 }; }
      if (rx.parts[part] === undefined) { rx.parts[part] = data.slice(c + 1); rx.got++; }
      if (rx.got === rx.total) { p._rx = null; this._deliver(p, rx.parts.join('')); }
    }
    recover(p) {
      if (p._rec) return; p._rec = true;
      this.emit('recover', { id: p.id });
      // ICE restart after a moment
      setTimeout(() => { p.pc.restartIce(); p._rec = false; }, RECOVER_MS);
    }
    maybeClosed() { if (!this.peers.size && this.role !== 'host') this.emit('close'); }
    dropPeer(id) { const p = this.peers.get(id); if (p) { try { p.pc.close(); } catch {} this.peers.delete(id); } this.emit('left', { id }); }
    close() { if (this._auth) { const a = this._auth; this._auth = null; clearTimeout(a.to); a.rej(new Error('closed')); } for (const p of this.peers.values()) { try { p.pc.close(); } catch {} } this.peers.clear(); if (this.ws) this.ws.close(); }
  }

  E.Relay = Relay;
})(window.E = window.E || {});
