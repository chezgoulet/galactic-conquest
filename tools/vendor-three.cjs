#!/usr/bin/env node
// Rebuild the vendored three.js IIFE bundle so the game keeps running from
// file:// with no bundler. Run after bumping the three devDependency:
//   npm run vendor:three
'use strict';
const esbuild = require('esbuild'), path = require('path'), fs = require('fs');
const out = path.join(__dirname, '..', 'vendor');
const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'three', 'package.json'), 'utf8')).version;
const banner = `/* three.js ${ver} (MIT) vendored by tools/vendor-three.cjs */`;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    stdin: { contents: [
      "export * from 'three';",
      "export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';",
      "export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';",
      "export { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';",
      "export { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';",
      "export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';",
      "export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';",
      "export { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';",
    ].join('\n'), resolveDir: __dirname },
    bundle: true, minify: true, format: 'iife', globalName: 'THREE',
    outfile: path.join(out, 'three.min.js'), banner: { js: banner }, legalComments: 'none',
  });
  fs.writeFileSync(path.join(out, 'VERSION'), `three ${ver}\n`);
  fs.copyFileSync(path.join(__dirname, '..', 'node_modules', 'three', 'LICENSE'), path.join(out, 'THREE-LICENSE'));
  console.log('three.min.js', (fs.statSync(path.join(out, 'three.min.js')).size / 1024).toFixed(0) + ' KB', `(r${ver})`);
})();
