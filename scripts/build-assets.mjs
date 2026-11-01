#!/usr/bin/env node
// Scripts the browser loads by URL, outside the Next bundle:
// - the AudioWorklet chain processor (bundles lib/dsp + lib/meter), ESM;
// - the MP3 encoder worker, a classic script because it importScripts() LAME;
// - LAME itself (lamejs, LGPL-3.0), copied unmodified as a separate,
//   user-replaceable file next to its licence.
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const common = { bundle: true, target: 'es2020', minify: true, sourcemap: false, logLevel: 'info' };
await build({ ...common, entryPoints: ['audio/worklet/chain-processor.ts'], outfile: 'public/worklets/chain-processor.js', format: 'esm' });
await build({ ...common, entryPoints: ['audio/mp3/encoder.worker.ts'], outfile: 'public/workers/mp3-encoder.js', format: 'iife' });

const lame = dirname(createRequire(import.meta.url).resolve('lamejs/package.json'));
const out = 'public/vendor/lamejs';
await mkdir(out, { recursive: true });
await copyFile(join(lame, 'lame.min.js'), join(out, 'lame.min.js'));
await copyFile(join(lame, 'LICENSE'), join(out, 'LICENSE'));
await writeFile(join(out, 'README.txt'),
  'lamejs 1.2.1 (https://github.com/zhuker/lamejs), a JavaScript port of LAME.\n' +
  'Licensed under the GNU LGPL v3.0 (https://www.gnu.org/licenses/lgpl-3.0.html; see LICENSE). LAME: https://lame.sourceforge.io.\n' +
  'Distributed unmodified as a separate file;\n' +
  'replace lame.min.js with any compatible build to relink the MP3 encoder worker.\n');
console.log(`copied lamejs -> ${out}`);
