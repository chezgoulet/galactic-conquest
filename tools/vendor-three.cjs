#!/usr/bin/env node
// Rebuild the vendored three.js IIFE bundle so the game keeps running from
// file:// with no bundler. Run after bumping the three devDependency:
//   npm run vendor:three
// The bundle is the WebGPU build of three (WebGPURenderer with its WebGL2
// fallback backend), its node-material system, and the TSL post-processing
// nodes the render layer uses. The global is still `THREE`:
//   THREE.WebGPURenderer, THREE.RenderPipeline, THREE.MeshStandardNodeMaterial ...
//   THREE.TSL       the TSL library (three/tsl): Fn, vec3, uniform, mix ...
//   THREE.TSLX      post-processing / lighting nodes from examples/jsm/tsl/display
//   THREE.CSMShadowNode, THREE.mergeGeometries, THREE.mergeVertices
'use strict';
const esbuild = require('esbuild'), path = require('path'), fs = require('fs');
const out = path.join(__dirname, '..', 'vendor');
const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'three', 'package.json'), 'utf8')).version;
const banner = `/* three.js ${ver} WebGPU+TSL build (MIT) vendored by tools/vendor-three.cjs */`;
const D = 'three/examples/jsm/tsl/display/';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await esbuild.build({
    stdin: { contents: [
      "export * from 'three/webgpu';",
      "export { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';",
      "export { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';",
      `import { traa } from '${D}TRAANode.js';`,
      `import { taau } from '${D}TAAUNode.js';`,
      `import { ao } from '${D}GTAONode.js';`,
      `import { ssr } from '${D}SSRNode.js';`,
      `import { bloom } from '${D}BloomNode.js';`,
      `import { dof } from '${D}DepthOfFieldNode.js';`,
      `import { motionBlur } from '${D}MotionBlur.js';`,
      `import { film } from '${D}FilmNode.js';`,
      `import { chromaticAberration } from '${D}ChromaticAberrationNode.js';`,
      `import { denoise } from '${D}DenoiseNode.js';`,
      'export const TSLX = { traa, taau, ao, ssr, bloom, dof, motionBlur, film, chromaticAberration, denoise };',
    ].join('\n'), resolveDir: __dirname },
    bundle: true, minify: true, format: 'iife', globalName: 'THREE',
    outfile: path.join(out, 'three.min.js'), banner: { js: banner }, legalComments: 'none',
  });
  fs.writeFileSync(path.join(out, 'VERSION'), `three ${ver} (webgpu+tsl)\n`);
  fs.copyFileSync(path.join(__dirname, '..', 'node_modules', 'three', 'LICENSE'), path.join(out, 'THREE-LICENSE'));
  console.log('three.min.js', (fs.statSync(path.join(out, 'three.min.js')).size / 1024).toFixed(0) + ' KB', `(r${ver})`);
})();
