#!/usr/bin/env node
// Downloads the reference engine that parity tests compare against.
// Pinned by sha256: if upstream ships a new build, this fails loudly instead of
// silently moving the parity target. Output dir is gitignored (unlicensed code).
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://voidremastered.ca/wp-content/plugins/void-audio/assets/js';
const PLUGIN_VERSION = '0.22.0-alpha.11';
const FILES = {
  'void-dsp.js': '4154dd4ad1510eb340c7945c613be5410d7e0d4f5ba1e169253ac7866b9563c8',
  'void-meter.js': '4b127796828c6976866a5d9008843c08fe6d8b2e82b591e4969d1c546daa53f1',
  'void-peak.js': '097f4314da83c2b32d3b9467bd4e7a406ad01e389a41387a59d659541baf5173',
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'void-oracle');
await mkdir(out, { recursive: true });

for (const [name, expected] of Object.entries(FILES)) {
  const res = await fetch(`${BASE}/${name}?ver=${PLUGIN_VERSION}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== expected) {
    throw new Error(`${name}: sha256 ${actual} != pinned ${expected}. Upstream changed; re-pin deliberately.`);
  }
  await writeFile(join(out, name), body);
  console.log(`ok ${name} ${actual.slice(0, 12)}`);
}

// The repo is ESM; the oracle is UMD/CommonJS and require()s its siblings.
await writeFile(join(out, 'package.json'), '{ "type": "commonjs" }\n');
