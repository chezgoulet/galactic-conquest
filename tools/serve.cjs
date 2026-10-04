// Minimal static file server for the UI smoke test and local dev. Zero deps.
//   node tools/serve.cjs [port]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const start = (port) => {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  });
  if (port !== undefined) { server.listen(port); return server; }
  const P = +process.env.PORT || 8080;
  server.listen(P, () => console.log(`serving ${ROOT} on http://localhost:${P}`));
  return server;
};
module.exports = start;
if (require.main === module) start(process.argv[2] ? +process.argv[2] : undefined);
