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
  'void-analysis.js': '37c62334857853fa7233894349e5a1d827037add21ad1715f1d42e4f8aafc70e',
  'void-safety.js': '9378a357a2cd28764d578d0129e1819c92f9a45c236a6b05cdb25c51114ff5b9',
  'void-engine.js': '0cb67f00f5e8c88442f1080fa7b73cd0976c4719f5d2789e2239c7d223f68db4',
  'void-target.js': 'f6bdc6e33252ddaa91cd0bb6c2c6b29d9d32b18856cdab600acf404b93e59361',
  'void-auto.js': 'df5dcdb2a466717c22680093b19aa8a9d7644a033451bfa62c1b4898c609034e',
  // Only its local tonal profile() is used; its network request path is never called.
  'void-ai.js': '2625ae5ce387cc93cbf9cde839190b7e1f3bc4624db68f2e8908a6bad34485ce',
  // MP3 re-encode policy (its LAME worker is not fetched) and the local PDF/ZIP report.
  'void-export.js': '0aef2d8d5ceed1cf4018836df6e2b0ab1b28aa467fc381d0d80c4693d3d286af',
  'void-report.js': '175f459447b4f843451a31a82c9329eb351d880d17bd2a152de16f6134097ff3',
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'void-oracle');
await mkdir(out, { recursive: true });

// The host's CDN/WAF has served CI runners different bytes intermittently, so a
// mismatch is retried with backoff. A genuine upstream release fails every attempt.
const ATTEMPTS = 4;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPinned(name, expected) {
  const failures = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(2000 * 2 ** (attempt - 2));
    const res = await fetch(`${BASE}/${name}?ver=${PLUGIN_VERSION}`, { headers: { 'cache-control': 'no-cache' } });
    const body = Buffer.from(await res.arrayBuffer());
    const actual = createHash('sha256').update(body).digest('hex');
    if (res.ok && actual === expected) return { body, actual };
    // Enough to tell a challenge/error page from a real new build.
    const preview = body.subarray(0, 120).toString('utf8').replace(/\s+/g, ' ');
    failures.push(`#${attempt}: HTTP ${res.status} ${res.headers.get('content-type') ?? '?'} ${body.length} B sha256 ${actual.slice(0, 12)} "${preview}"`);
    console.warn(`retry ${name} ${failures.at(-1)}`);
  }
  throw new Error(`${name}: never matched pinned sha256 ${expected} after ${ATTEMPTS} attempts.\n  ${failures.join('\n  ')}\nIf upstream really changed, re-pin deliberately.`);
}

for (const [name, expected] of Object.entries(FILES)) {
  const { body, actual } = await fetchPinned(name, expected);
  await writeFile(join(out, name), body);
  console.log(`ok ${name} ${actual.slice(0, 12)}`);
}

// The repo is ESM; the oracle is UMD/CommonJS and require()s its siblings.
await writeFile(join(out, 'package.json'), '{ "type": "commonjs" }\n');
