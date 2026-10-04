// LAN signaling: introduces players on one network so their browsers can open a
// WebRTC connection straight to each other. It brokers offers, answers and ICE
// candidates only; the match runs peer to peer (encrypted, DTLS) and never
// passes through here. Zero dependencies.
//
// Protocol (JSON text frames over the /ws upgrade):
//   -> host {name}              <- hosted {room, id: 0, ice: []}
//   -> join {room, name}        <- joined {room, id, ice: [], hostName}; host <- peer {id, name}
//   -> signal {to, data}        <- signal {from, data}        (host <-> guest only)
//   -> kick {id}  (host only)
//   <- left {id}  (peer dropped)  ·  closed (room empty)  ·  error {msg}
'use strict';
const crypto = require('crypto');

const MAX_FRAME = 4 * 1024 * 1024, MAX_PEERS = 8;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function createSignal(opts) {
  opts = opts || {};
  const ICE = opts.ice || [];
  const log = opts.log || (() => {});
  const rooms = new Map();
  const socks = new Set();

  // ── minimal RFC 6455 WebSocket ──────────────────────────────────
  function accept(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
    const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
    socket.setNoDelay(true);
    const conn = { socket, buf: Buffer.alloc(0), frag: [], alive: true, id: 0, room: null, name: '' };
    socks.add(conn);
    socket.on('data', d => { conn.buf = Buffer.concat([conn.buf, d]); parse(conn); });
    socket.on('close', () => { socks.delete(conn); if (conn.alive) onClose(conn); });
    socket.on('end', () => { socks.delete(conn); if (conn.alive) onClose(conn); });
    socket.on('error', () => { if (conn.alive) onClose(conn); socket.destroy(); });
    return conn;
  }
  function parse(conn) {
    while (true) {
      const b = conn.buf;
      if (b.length < 2) return;
      const opcode = b[0] & 0x0f;
      const len1 = b[1] & 0x7f;
      const masked = (b[1] & 0x80) !== 0;   // clients MUST mask their frames
      let off = 2, len = len1;
      if (len1 === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len1 === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (masked) { if (b.length < off + 4) return; off += 4; }
      if (b.length < off + len) return;
      let payload = b.slice(off, off + len);
      conn.buf = b.slice(off + len);
      if (masked) {
        const m = b.slice(off - 4, off);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
      }
      if (opcode === 0x8) { // close: echo it, then drop
        try { rawFrame(conn.socket, 0x8, payload.slice(0, 2)); } catch {}
        onClose(conn); socket_destroy(conn);
        return;
      } else if (opcode === 0x9) { // ping: reply pong (best-effort, no state)
        try { rawFrame(conn.socket, 0xa, payload); } catch {}
        continue;
      }
      if (opcode !== 0x1) continue;   // ignore non-text frames
      let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
      try { onMessage(conn, msg); } catch (e) { log('onMessage: ' + e.message); }
    }
  }
  function rawFrame(socket, opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    socket.write(Buffer.concat([head, payload]));
  }
  function socket_destroy(conn) { if (conn && conn.socket) { try { conn.socket.destroy(); } catch {} } }
  function send(conn, o) {
    if (!conn.alive) return;
    const data = Buffer.from(JSON.stringify(o), 'utf8');
    let head;
    if (data.length < 126) head = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    try { conn.socket.write(Buffer.concat([head, data])); } catch { /* */ }
  }
  function onMessage(conn, m) {
    const room = m && m.op === 'join' ? rooms.get(m.room) : conn.room ? rooms.get(conn.room) : null;
    switch (m && m.op) {
      case 'host': {
        if (conn.room) return err(conn, 'already in a room');
        let code; do { code = letter(4); } while (rooms.has(code));
        const r = { code, host: conn, guests: new Map(), next: 1 };
        rooms.set(code, r); conn.room = r; conn.id = 0; conn.name = m.name || 'Host';
        send(conn, { op: 'hosted', room: code, id: 0, ice: ICE });
        log('host ' + code);
        break;
      }
      case 'join': {
        const r = rooms.get(m.room);
        if (!r) return err(conn, 'no such room');
        if (conn.room) return err(conn, 'already in a room');
        if (r.guests.size + 1 > MAX_PEERS) return err(conn, 'room full');
        r.guests.set(r.next, conn); conn.room = r; conn.id = r.next++; conn.name = m.name || 'Guest';
        send(conn, { op: 'joined', room: r.code, id: conn.id, ice: ICE, hostName: conn.name = r.host.name });
        send(r.host, { op: 'peer', id: conn.id, name: m.name || 'Guest' });
        break;
      }
      case 'signal': {
        const r = conn.room; if (!r) return;
        const to = (conn.id === 0) ? r.guests.get(m.to) : r.host;
        if (!to || !to.alive) return;
        send(to, { op: 'signal', from: conn.id, data: m.data });
        break;
      }
      case 'kick': {
        const r = conn.room; if (!r || r.host !== conn) return;
        const g = r.guests.get(m.id); if (g) { g.socket.destroy(); }
        break;
      }
      case 'leave': case 'close': { onClose(conn); break; }
    }
  }
  function onClose(conn) {
    if (!conn.room) { conn.alive = false; return; }
    const r = conn.room;
    if (conn.id === 0) {
      for (const g of r.guests.values()) send(g, { op: 'closed' });
      r.guests.clear();
    } else {
      r.guests.delete(conn.id);
      if (r.host && r.host.alive) send(r.host, { op: 'left', id: conn.id });
    }
    conn.room = null; conn.alive = false;
    if (r.host === conn && r.guests.size === 0) rooms.delete(r.code);
  }
  function err(conn, msg) { if (conn.alive) send(conn, { op: 'error', msg }); }
  function letter(n) { let s = ''; for (let i = 0; i < n; i++) s += LETTERS[crypto.randomInt(LETTERS.length)]; return s; }

  return {
    rooms,
    upgrade(req, socket) { if (!req.headers.upgrade) return; accept(req, socket); },
    close() { for (const s of socks) { try { s.socket.destroy(); } catch {} } socks.clear(); for (const r of rooms.values()) { for (const g of r.guests.values()) { try { g.socket.destroy(); } catch {} } } rooms.clear(); },
  };
}

module.exports = { createSignal };
