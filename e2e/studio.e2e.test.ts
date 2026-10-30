// End-to-end: the exported app in real Chromium. Proves the browser paths the
// unit suites can't: worker decode/analyze/render, the AudioWorklet preview, and
// a downloaded master that independently decodes and measures on target.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeTrack, createBuffer, decodeWav, encodeWav } from '../lib/engine';
import { serve } from '../scripts/serve-static.mjs';
import { program } from '../test/signals';

const RATE = 44100;
let server: Server, browser: Browser, page: Page, url: string, wavPath: string;
const errors: string[] = [];

const numberIn = async (testId: string) => {
  const text = (await page.getByTestId(testId).textContent()) ?? '';
  const n = Number.parseFloat(text.replace('−', '-'));
  expect(Number.isFinite(n), `${testId} shows a number (got "${text}")`).toBe(true);
  return n;
};

beforeAll(async () => {
  if (!existsSync('out/index.html')) throw new Error('No static export: run `npm run build` first.');
  server = (await serve('out')) as Server;
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  // A realistic premaster: ~-20 LUFS programme with headroom, 6 s stereo.
  const src = createBuffer(RATE, 2, RATE * 6);
  program(RATE, 6, 2, 0.45).forEach((ch, c) => src.channels[c]!.set(ch));
  wavPath = join(mkdtempSync(join(tmpdir(), 'xyp3rn-e2e-')), 'premaster.wav');
  writeFileSync(wavPath, Buffer.from(await encodeWav(src, 'pcm24')));
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url);
});

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe('XYP3RN MASTERING studio', () => {
  it('shows the brand chrome and gold mark', async () => {
    await expect(page.title()).resolves.toMatch(/XYP3RN MASTERING/);
    const mark = page.getByRole('img', { name: 'XYP3RN' }).first();
    expect(await mark.isVisible()).toBe(true);
    expect(await mark.locator('path').getAttribute('fill')).toBe('#FACD68');
  });

  it('imports a WAV and analyses it locally', async () => {
    await page.getByTestId('file-input').setInputFiles(wavPath);
    await page.getByTestId('source-lufs').filter({ hasText: /\d/ }).waitFor({ timeout: 60_000 });
    const lufs = await numberIn('source-lufs');
    expect(lufs).toBeGreaterThan(-30);
    expect(lufs).toBeLessThan(-10);
    await numberIn('source-tp');
  });

  it('previews through the AudioWorklet chain with live metering', async () => {
    await page.getByTestId('play').click();
    await page.getByTestId('meter-momentary').filter({ hasText: /\d/ }).waitFor({ timeout: 20_000 });
    await numberIn('meter-momentary');
    // A/B to the untouched source at matched loudness, then back.
    await page.getByTestId('ab-toggle').click();
    await expect(page.getByTestId('ab-toggle').getAttribute('aria-pressed')).resolves.toBe('true');
    await page.getByTestId('ab-toggle').click();
    await page.getByTestId('play').click();
  });

  it('renders to -14 LUFS and exports a 24-bit master that measures on target', async () => {
    await page.getByTestId('target-select').selectOption('-14');
    await page.getByTestId('format-select').selectOption('pcm24');
    await page.getByTestId('dither').check();
    await page.getByTestId('render').click();
    await page.getByTestId('report-status').filter({ hasText: /reached|limited/i }).waitFor({ timeout: 180_000 });
    expect(await page.getByTestId('report-status').textContent()).toMatch(/reached/i);
    expect(Math.abs((await numberIn('report-lufs')) + 14)).toBeLessThanOrEqual(0.2);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toMatch(/\.wav$/);
    const bytes = readFileSync((await download.path())!);
    const { buffer, metadata } = await decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(metadata.bitsPerSample).toBe(24);
    expect(metadata.sampleRate).toBe(RATE);
    const metrics = await analyzeTrack(buffer);
    // Independent re-measure of the file as delivered (after 24-bit quantization + dither).
    expect(Math.abs(metrics.loudness.integratedLufs! + 14)).toBeLessThanOrEqual(0.25);
    expect(metrics.loudness.truePeakDbtp!).toBeLessThanOrEqual(-1 + 0.05);
  });

  it('suggests an automatic master, applies it to the chain and keeps the user in control', async () => {
    await page.getByTestId('target-select').selectOption('-14');
    await page.getByTestId('auto-intention').selectOption('balanced');
    await page.getByTestId('auto-run').click();
    // The previous manual render may still be current; wait for the auto result itself.
    await page.getByTestId('auto-notes').waitFor({ timeout: 180_000 });
    expect(await page.getByTestId('report-status').textContent()).toMatch(/reached/i);
    expect(Math.abs((await numberIn('report-lufs')) + 14)).toBeLessThanOrEqual(0.2);
    // The proposal is explained and lands in the editable chain: the limiter is now on.
    expect(await page.getByTestId('auto-notes').locator('li').count()).toBeGreaterThanOrEqual(5);
    const limiter = page.getByRole('article', { name: 'Brickwall Limiter' });
    await expect(limiter.getByRole('button', { name: 'Brickwall Limiter on' }).getAttribute('aria-pressed')).resolves.toBe('true');
    // Export ships exactly the measured auto render.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
    const bytes = readFileSync((await download.path())!);
    const { buffer } = await decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(Math.abs((await analyzeTrack(buffer)).loudness.integratedLufs! + 14)).toBeLessThanOrEqual(0.25);
    // Touching any control makes the result stale rather than silently exporting old audio.
    await limiter.getByRole('button', { name: 'Brickwall Limiter on' }).click();
    expect(await page.getByTestId('report-status').count()).toBe(0);
  });

  it('raised no page or console errors', () => {
    expect(errors).toEqual([]);
  });
});
