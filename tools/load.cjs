// Loads the browser-style scripts (IIFE on a global `E`) into a Node vm context
// so the pure, browser-free parts (core, data, sim, net, audit) can be tested
// headless, exactly like ozymandosis does in test/load.cjs.
// The render/ui layers deliberately depend on window + THREE and are loaded
// only in the browser; tests must pass an explicit file list.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

module.exports = load;
// every script in the given js/ layers, in the same order tools/build.cjs bundles them
load.files = (layers) => layers.flatMap((d) => fs.readdirSync(path.join(ROOT, 'js', d)).filter((f) => f.endsWith('.js')).sort().map((f) => `js/${d}/${f}`));

function load(files, extra) {
  const ctx = {
    console, Math, JSON, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: globalThis.crypto, performance: globalThis.performance,
    Promise, Map, Set, WeakMap, WeakSet, TextEncoder, TextDecoder,
    Uint8Array, Float32Array, Int32Array, Uint16Array, Int16Array, DataView, ArrayBuffer,
    URL, URLSearchParams, structuredClone,
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 16);
  if (extra) Object.assign(ctx, extra);
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.E;
}
