import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build script, no type declarations
import { cacheVersion, precacheList, serviceWorker } from '../scripts/build-sw.mjs';

function exportDir(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'xyp3rn-sw-'));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return root;
}

describe('offline service worker (scripts/build-sw.mjs)', () => {
  const files = {
    'index.html': '<html>', 'manifest.webmanifest': '{}', '_next/static/chunks/main-abc.js': 'x', 'worklets/chain-processor.js': 'w',
    'sw.js': 'old', '_next/static/chunks/main-abc.js.map': '{}', 'media/render-orb.mp4': 'video', 'media/render-orb-poster.webp': 'p',
  };

  it('precaches the app, serves index.html as /, and skips itself, maps and the optional video', () => {
    expect(precacheList(exportDir(files))).toEqual([
      '/', '/_next/static/chunks/main-abc.js', '/manifest.webmanifest', '/media/render-orb-poster.webp', '/worklets/chain-processor.js',
    ]);
  });

  it('versions the cache by content, so a deploy with any changed file installs fresh', () => {
    const a = exportDir(files), b = exportDir({ ...files, 'worklets/chain-processor.js': 'w2' });
    expect(cacheVersion(a, precacheList(a))).toBe(cacheVersion(exportDir(files), precacheList(exportDir(files))));
    expect(cacheVersion(a, precacheList(a))).not.toBe(cacheVersion(b, precacheList(b)));
  });

  it('writes a worker that caches same-origin GETs only and drops old versions', () => {
    const src = serviceWorker('abc123', ['/']) as string;
    expect(src).toContain("const CACHE = 'xyp3rn-abc123';");
    expect(src).toContain("if (request.method !== 'GET') return;");
    expect(src).toContain('if (url.origin !== self.location.origin) return;');
    expect(src).toContain("key.startsWith('xyp3rn-') && key !== CACHE");
    expect(() => new Function(src)).not.toThrow();
  });
});
