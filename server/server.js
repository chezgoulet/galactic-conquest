#!/usr/bin/env node
// LAN server: serves the game files and introduces players on a local network.
// It only brokers WebRTC signaling (offers, answers, ICE); the match itself runs
// peer to peer, encrypted (DTLS), and never passes through here. Zero deps.
//   node server/server.js            (PORT=8080 by default)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSignal } = require('./signal.cjs');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: signal.rooms.size })); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || /[\\/]\.(git|env)/.test(file) || file.includes('node_modules')) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

const signal = createSignal({ ice: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [], log: s => log(s) });
server.on('upgrade', (req, socket) => signal.upgrade(req, socket));
server.on('close', () => signal.close());
function log(s) { if (!process.env.QUIET) console.log(new Date().toISOString().slice(11, 19), s); }

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Galactic Conquest server on http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  LAN: http://${ip}:${PORT}`);
});
module.exports = server;
