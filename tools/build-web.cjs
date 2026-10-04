#!/usr/bin/env node
// Produces a self-contained dist/ (game + server assets) for static hosting.
// The game itself needs no build step (it is plain scripts loaded from a
// static loader); this just copies them plus the vendor bundle and a manifest.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'dist');

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
};
const skip = new Set(['node_modules', 'dist', 'www', '.git', 'data', 'test', 'tools', 'apps', 'deploy', 'docs']);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.name.startsWith('.') || skip.has(e.name)) continue;
  if (e.isDirectory()) copyDir(path.join(ROOT, e.name), path.join(OUT, e.name));
  else if (e.name.endsWith('.html') || e.name.endsWith('.js') || e.name.endsWith('.css') || e.name.endsWith('.webmanifest')) fs.copyFileSync(path.join(ROOT, e.name), path.join(OUT, e.name));
}
console.log('built dist/ for static hosting');
