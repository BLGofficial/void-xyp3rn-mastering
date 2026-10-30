#!/usr/bin/env node
// AudioWorklet modules must be standalone scripts loaded by URL, outside the
// Next bundle. Bundle the chain processor (and lib/dsp + lib/meter) into public/.
import { build } from 'esbuild';

await build({
  entryPoints: ['audio/worklet/chain-processor.ts'],
  outfile: 'public/worklets/chain-processor.js',
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});
