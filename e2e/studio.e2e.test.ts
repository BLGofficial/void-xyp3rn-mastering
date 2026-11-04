// End-to-end: the exported app in real Chromium. Proves the browser paths the
// unit suites can't: worker decode/analyze/render, the AudioWorklet preview, and
// a downloaded master that independently decodes and measures on target.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeTrack, createBuffer, decodeWav, encodeWav } from '../lib/engine';
import { serve } from '../scripts/serve-static.mjs';
import { encodeFlac, encodeMp3 } from '../test/codec-fixtures';
import { program } from '../test/signals';

const RATE = 44100;
let server: Server, browser: Browser, page: Page, url: string, wavPath: string, flacPath: string, mp3Path: string, junkPath: string;
/** The WAV import's readouts, for the lossless-FLAC comparison. */
const wavReadings: Record<string, string> = {};
const errors: string[] = [];

/** Minimal stored-ZIP reader via the central directory; checks every CRC. */
function unzip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const crc = bytes.readUInt32LE(at + 16), size = bytes.readUInt32LE(at + 24), nameLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'), local = bytes.readUInt32LE(at + 42);
    const data = bytes.subarray(local + 30 + bytes.readUInt16LE(local + 26), local + 30 + bytes.readUInt16LE(local + 26) + size);
    expect(crc32(data) >>> 0, `${name} CRC`).toBe(crc);
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}

/** Decode an MP3 with the browser's own decoder at the given rate; planar float back to Node. */
async function decodeInPage(bytes: Buffer, rate: number) {
  const planes = await page.evaluate(async ([b64, sampleRate]) => {
    const raw = Uint8Array.from(atob(b64 as string), c => c.charCodeAt(0));
    const decoded = await new OfflineAudioContext(1, 1, sampleRate as number).decodeAudioData(raw.buffer);
    return Array.from({ length: decoded.numberOfChannels }, (_, c) => {
      const f = decoded.getChannelData(c), u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    });
  }, [bytes.toString('base64'), rate] as const);
  const channels = planes.map(p => { const b = Buffer.from(p, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); });
  const buffer = createBuffer(rate, channels.length, channels[0]!.length);
  channels.forEach((c, i) => buffer.channels[i]!.set(c));
  return buffer;
}

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
  const dir = mkdtempSync(join(tmpdir(), 'xyp3rn-e2e-'));
  wavPath = join(dir, 'premaster.wav');
  writeFileSync(wavPath, Buffer.from(await encodeWav(src, 'pcm24')));
  // Same 24-bit PCM as the WAV, losslessly in FLAC; and a 48 kHz MP3 behind an ID3 tag.
  flacPath = join(dir, 'premaster.flac');
  writeFileSync(flacPath, encodeFlac(src.channels, RATE, 24));
  mp3Path = join(dir, 'premaster-48k.mp3');
  writeFileSync(mp3Path, encodeMp3(program(48000, 6, 2, 0.45), 48000, 320, 1024));
  junkPath = join(dir, 'not-audio.mp3');
  writeFileSync(junkPath, 'This is a text file renamed to .mp3, not audio.');
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
    expect(await page.getByTestId('source-format').textContent()).toBe('44.1 kHz · 24-bit WAV · 2 ch');
    for (const id of ['source-lufs', 'source-tp']) wavReadings[id] = (await page.getByTestId(id).textContent())!;
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
    // Overlay structure is checked in the cancel test, where the render's end is under the test's control.
    await page.getByTestId('render-orb').waitFor();
    await page.getByTestId('report-status').filter({ hasText: /reached|limited/i }).waitFor({ timeout: 180_000 });
    await page.getByTestId('rendered-file-name').waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('render-orb').count()).toBe(0);
    expect(await page.getByTestId('rendered-audio').getAttribute('src')).toMatch(/^blob:/);
    expect(await page.getByTestId('report-status').textContent()).toMatch(/reached/i);
    expect(Math.abs((await numberIn('report-lufs')) + 14)).toBeLessThanOrEqual(0.2);

    // One click delivers the master and, right after it, a PDF of the effects that made it.
    const downloads: import('playwright').Download[] = [];
    const collect = (d: import('playwright').Download) => downloads.push(d);
    page.on('download', collect);
    await page.getByTestId('export').click();
    await expect.poll(() => downloads.length, { timeout: 60_000 }).toBe(2);
    page.off('download', collect);
    const [download, pdfDownload] = downloads as [import('playwright').Download, import('playwright').Download];
    expect(download.suggestedFilename()).toMatch(/_pcm24\.wav$/);
    expect(pdfDownload.suggestedFilename()).toBe(download.suggestedFilename().replace(/\.wav$/, '_report.pdf'));
    const pdf = readFileSync((await pdfDownload.path())!).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n%XYP3RN report\n')).toBe(true);
    expect(Number(/\/Type \/Pages \/Count (\d+)/.exec(pdf)![1])).toBeGreaterThanOrEqual(1);
    const bytes = readFileSync((await download.path())!);
    const { buffer, metadata } = await decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(metadata.bitsPerSample).toBe(24);
    expect(metadata.sampleRate).toBe(RATE);
    const metrics = await analyzeTrack(buffer);
    // Independent re-measure of the file as delivered (after 24-bit quantization + dither).
    expect(Math.abs(metrics.loudness.integratedLufs! + 14)).toBeLessThanOrEqual(0.25);
    expect(metrics.loudness.truePeakDbtp!).toBeLessThanOrEqual(-1 + 0.05);
  });

  it('renders the reference-backed mastering presets into playable files', async () => {
    await page.getByTestId('preset-warm').click();
    await page.getByTestId('render-orb').waitFor();
    await page.getByText('Engine: warm preset ready').waitFor({ timeout: 180_000 });
    await page.getByTestId('rendered-file-name').waitFor();
    expect(await page.getByTestId('render-orb').count()).toBe(0);
    expect(await page.getByTestId('auto-notes').locator('li').count()).toBeGreaterThanOrEqual(5);
  });

  it('suggests an automatic master, applies it to the chain and keeps the user in control', async () => {
    await page.getByTestId('target-select').selectOption('-14');
    await page.getByTestId('auto-intention').selectOption('balanced');
    await page.getByTestId('auto-run').click();
    // Notes from the preset test may still be showing; wait for the auto result itself.
    await page.getByText('Engine: auto master ready').waitFor({ timeout: 180_000 });
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

  it('exports a 320 kbps MP3 whose decoded audio holds the ceiling and the target', async () => {
    await page.getByTestId('target-select').selectOption('-14');
    await page.getByTestId('render').click();
    await page.getByTestId('report-status').filter({ hasText: /reached|limited/i }).waitFor({ timeout: 180_000 });
    await page.getByTestId('rendered-file-name').waitFor({ timeout: 60_000 });
    // Changing format stales the WAV; re-encode the same render as MP3 without re-rendering.
    await page.getByTestId('format-select').selectOption('mp3');
    expect(await page.getByTestId('dither').isDisabled()).toBe(true);
    expect(await page.getByTestId('rendered-file-name').count()).toBe(0);
    await page.getByTestId('prepare-file').click();
    await page.getByTestId('rendered-file-name').filter({ hasText: /_mp3-320\.mp3$/ }).waitFor({ timeout: 180_000 });
    expect(await page.getByTestId('export').textContent()).toMatch(/Download MP3/);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('export').click()]);
    expect(download.suggestedFilename()).toMatch(/_mp3-320\.mp3$/);
    const bytes = readFileSync((await download.path())!);
    // First frame: MPEG-1 Layer III sync, bitrate index 14 = 320 kbps.
    const frame = bytes[0] === 0x49 ? bytes.indexOf(0xff, 10) : 0;
    expect(bytes[frame]).toBe(0xff);
    expect(bytes[frame + 1]! & 0xfe).toBe(0xfa);
    expect(bytes[frame + 2]! >> 4).toBe(14);
    const metrics = await analyzeTrack(await decodeInPage(bytes, RATE));
    expect(Math.abs(metrics.loudness.integratedLufs! + 14)).toBeLessThanOrEqual(0.25);
    expect(metrics.loudness.truePeakDbtp!).toBeLessThanOrEqual(-1 + 0.05);
  });

  it('bundles the master and a PDF mastering report in one ZIP', async () => {
    await page.getByTestId('format-select').selectOption('pcm24');
    await page.getByTestId('prepare-file').click();
    await page.getByTestId('rendered-file-name').filter({ hasText: /_pcm24\.wav$/ }).waitFor({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.getByTestId('report-bundle').click()]);
    expect(download.suggestedFilename()).toMatch(/_report\.zip$/);
    const files = unzip(readFileSync((await download.path())!));
    expect([...files.keys()]).toEqual([expect.stringMatching(/_pcm24\.wav$/), 'XYP3RN-Mastering-Report.pdf']);
    const wav = files.get([...files.keys()][0]!)!;
    const { buffer } = await decodeWav(new Uint8Array(wav).buffer);
    expect(Math.abs((await analyzeTrack(buffer)).loudness.integratedLufs! + 14)).toBeLessThanOrEqual(0.25);
    const pdf = files.get('XYP3RN-Mastering-Report.pdf')!.toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n%XYP3RN report\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    const pages = Number(/\/Type \/Pages \/Count (\d+)/.exec(pdf)![1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pdf.match(/\/Filter \/DCTDecode/g)).toHaveLength(pages);
  });

  it('undoes an automatic master back to the chain it replaced', async () => {
    const limiterOn = page.getByRole('article', { name: 'Brickwall Limiter' }).getByRole('button', { name: 'Brickwall Limiter on' });
    if ((await limiterOn.getAttribute('aria-pressed')) === 'true') await limiterOn.click();
    // The previous test's manual render committed its chain: nothing to undo yet.
    expect(await page.getByTestId('auto-undo').isDisabled()).toBe(true);
    await page.getByTestId('auto-run').click();
    await page.getByText('Engine: auto master ready').waitFor({ timeout: 180_000 });
    await expect(limiterOn.getAttribute('aria-pressed')).resolves.toBe('true');
    await page.getByTestId('auto-undo').click();
    // Previous chain back; the auto result no longer matches it, so it is not offered for export.
    await expect(limiterOn.getAttribute('aria-pressed')).resolves.toBe('false');
    expect(await page.getByTestId('report-status').count()).toBe(0);
    expect(await page.getByTestId('auto-undo').isDisabled()).toBe(true);
  });

  it('cancels a running render and keeps the studio usable', async () => {
    await page.getByRole('button', { name: '4x Studio' }).click();
    await page.getByTestId('target-select').selectOption('-14');
    // Esc is the overlay's escape route... (reduced motion: a still frame, no WebGL)
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('render').click();
    await page.getByTestId('render-orb').waitFor();
    // The render takes over the whole viewport, as a dialog, with Cancel focused as its way out.
    const viewport = page.viewportSize()!;
    expect(await page.getByTestId('render-orb').boundingBox()).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    expect(await page.getByTestId('render-orb').getAttribute('role')).toBe('dialog');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('cancel');
    await expect.poll(() => page.getByTestId('render-orb').getAttribute('data-orb')).toBe('still');
    expect(await page.getByTestId('orb-stage').locator('canvas').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByText('Engine: cancelled').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('render-orb').count()).toBe(0);
    // ...and so is its Cancel button. With motion on, the orb is fed live render levels; on this
    // software-GL runner the performance guard swaps in the video so the page stays responsive.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByTestId('render').click();
    await page.getByTestId('render-orb').waitFor();
    await expect.poll(() => page.getByTestId('render-orb').getAttribute('data-orb'), { timeout: 15_000 }).toMatch(/^(webgl|video)$/);
    await expect.poll(async () => Number(await page.getByTestId('orb-stage').getAttribute('data-energy')), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByTestId('cancel').click();
    // The status already read 'cancelled' from the Esc round: wait for the overlay itself to close.
    await page.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 30_000 });
    expect(await page.getByRole('banner').textContent()).toMatch(/Engine: cancelled/);
    expect(await page.getByTestId('engine-error').count()).toBe(0);
    expect(await page.getByTestId('cancel').count()).toBe(0);
    expect(await page.getByTestId('render').isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Standard' }).click();
  });

  it('runs the WebGL mastering orb when forced, and releases it when the render ends', async () => {
    // Own small page: software WebGL is slow, and ?orb=webgl bypasses the fallback guards.
    const orbPage = await browser.newPage({ viewport: { width: 480, height: 360 } });
    const orbErrors: string[] = [];
    orbPage.on('pageerror', e => orbErrors.push(e.message));
    orbPage.on('console', m => { if (m.type() === 'error') orbErrors.push(m.text()); });
    await orbPage.goto(`${url}?orb=webgl`);
    await orbPage.getByTestId('file-input').setInputFiles(wavPath);
    await orbPage.getByTestId('source-lufs').filter({ hasText: /\d/ }).waitFor({ timeout: 60_000 });
    await orbPage.getByRole('button', { name: '4x Studio' }).click();
    await orbPage.getByTestId('target-select').selectOption('-14');
    const canvasesBefore = await orbPage.locator('canvas').count(); // e.g. the waveform
    await orbPage.getByTestId('render').click();
    await expect.poll(() => orbPage.getByTestId('render-orb').getAttribute('data-orb'), { timeout: 30_000 }).toBe('webgl');
    expect(await orbPage.getByTestId('orb-stage').locator('canvas').count()).toBe(1);
    await expect.poll(async () => Number(await orbPage.getByTestId('orb-stage').getAttribute('data-energy')), { timeout: 30_000 }).toBeGreaterThan(0);
    await orbPage.keyboard.press('Escape');
    await orbPage.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 30_000 });
    // The orb's canvas (and its WebGL context) is gone with the overlay.
    expect(await orbPage.locator('canvas').count()).toBe(canvasesBefore);
    expect(orbErrors).toEqual([]);
    await orbPage.close();
  });

  it('imports FLAC losslessly: same readings as the WAV of the same PCM', async () => {
    await page.getByTestId('file-input').setInputFiles(flacPath);
    await page.getByTestId('source-format').filter({ hasText: 'FLAC' }).waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('source-format').textContent()).toBe('44.1 kHz · 24-bit FLAC · 2 ch');
    for (const id of ['source-lufs', 'source-tp']) expect(await page.getByTestId(id).textContent(), id).toBe(wavReadings[id]);
    expect(await page.getByTestId('lossy-note').count()).toBe(0);
  });

  it('imports MP3 at its native rate, flags it as lossy and masters it', async () => {
    await page.getByTestId('file-input').setInputFiles(mp3Path);
    await page.getByTestId('source-format').filter({ hasText: 'MP3' }).waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('source-format').textContent()).toBe('48 kHz · MP3 320 kbps · 2 ch');
    expect(await page.getByTestId('lossy-note').isVisible()).toBe(true);
    // 320 kbps keeps programme loudness within a fraction of a LU of the PCM it came from.
    const pcm = createBuffer(48000, 2, 48000 * 6);
    program(48000, 6, 2, 0.45).forEach((ch, c) => pcm.channels[c]!.set(ch));
    const expected = (await analyzeTrack(pcm)).loudness.integratedLufs!;
    expect(Math.abs((await numberIn('source-lufs')) - expected)).toBeLessThanOrEqual(0.3);
    await page.getByTestId('target-select').selectOption('-14');
    await page.getByTestId('render').click();
    await page.getByTestId('report-status').filter({ hasText: /reached|limited/i }).waitFor({ timeout: 180_000 });
    expect(await page.getByTestId('report-status').textContent()).toMatch(/reached/i);
  });

  it('refuses a file that is not WAV, FLAC or MP3, keeping the studio usable', async () => {
    await page.getByTestId('file-input').setInputFiles(junkPath);
    await page.getByRole('alert').filter({ hasText: /Unsupported file/ }).waitFor({ timeout: 20_000 });
    expect(await page.getByTestId('file-input').isEnabled()).toBe(true);
  });

  it('raised no page or console errors', () => {
    expect(errors).toEqual([]);
  });
});
