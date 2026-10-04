// A minimal RFC 6455 WebSocket server for the /ws signalling endpoint.
// Zero dependencies (node:http + node:crypto), with correct client-frame
// unmasking, close-frame echo and ping/pong. Attaches to an existing http
// server for a single path and hands each connection to onConnection(ws),
// where ws exposes .send(str), .on('message'|'close'), .readyState and .close().
import crypto from 'node:crypto';

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 4 * 1024 * 1024;

export function createWsServer({ path: wsPath, onConnection }) {
  const conns = new Set();

  function finish(ws) {
    conns.delete(ws);
    if (ws.readyState !== 3) { ws.readyState = 3; ws._emit('close'); }
  }

  function accept(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + ACCEPT_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);

    const ws = {
      socket, buf: Buffer.concat([head || Buffer.alloc(0)]), readyState: 1, _handlers: {},
      on(ev, fn) { this._handlers[ev] = fn; return this; },
      _emit(ev, arg) { const h = this._handlers[ev]; if (h) { try { h(arg); } catch {} } },
      send(data) { if (this.readyState === 1) { const b = Buffer.from(String(data), 'utf8'); if (b.length > MAX_FRAME) return ws.close(); frame(socket, 0x1, b); } },
      close() { if (this.readyState === 1) { this.readyState = 3; try { frame(socket, 0x8, Buffer.alloc(0)); } catch {} try { socket.end(); } catch {} } },
    };
    conns.add(ws);
    socket.on('data', (d) => { ws.buf = Buffer.concat([ws.buf, d]); parse(ws); });
    socket.on('close', () => finish(ws));
    socket.on('error', () => finish(ws));
    onConnection(ws);
  }

  function parse(ws) {
    const socket = ws.socket;
    while (true) {
      const b = ws.buf;
      if (b.length < 2) return;
      const opcode = b[0] & 0x0f;
      const len1 = b[1] & 0x7f;
      const masked = (b[1] & 0x80) !== 0;
      let off = 2, len = len1;
      if (len1 === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len1 === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (masked) { if (b.length < off + 4) return; off += 4; }
      if (len > MAX_FRAME) { ws.close(); return; }
      if (b.length < off + len) return;
      let payload = b.slice(off, off + len);
      ws.buf = b.slice(off + len);
      if (masked) { const m = b.slice(off - 4, off); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      if (opcode === 0x8) { try { frame(socket, 0x8, payload.slice(0, 2)); } catch {} socket.end(); return; }
      else if (opcode === 0x9) { try { frame(socket, 0xa, payload); } catch {} continue; }
      if (opcode === 0x1) ws._emit('message', payload.toString('utf8'));
    }
  }

  function frame(socket, opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    socket.write(Buffer.concat([head, payload]));
  }

  return {
    // attach to an http server; returns the raw server handler so a test can also use it
    attach(server) {
      server.on('upgrade', (req, socket, head) => {
        try { if ((req.url || '').split('?')[0] === wsPath) accept(req, socket, head); else socket.destroy(); } catch { try { socket.destroy(); } catch {} }
      });
    },
    close() { for (const w of conns) { try { w.readyState = 3; w.socket.destroy(); } catch {} } conns.clear(); },
    get size() { return conns.size; },
  };
}
