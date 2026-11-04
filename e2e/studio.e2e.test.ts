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
import { GUIDE_KEYS, guideEntry } from '../lib/guide';
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

/**
 * Record every stage the render overlay shows, in order, from the next render on.
 * A MutationObserver sees each change even when stages pass faster than polling.
 */
const recordPhases = (target: Page = page) => target.evaluate(() => {
  const log: string[] = [];
  (window as unknown as { __phases: string[] }).__phases = log;
  const push = (v: string | null | undefined) => { if (v && log[log.length - 1] !== v) log.push(v); };
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') push((r.target as HTMLElement).dataset.phase);
      r.addedNodes.forEach(n => { if (n instanceof HTMLElement) push(n.dataset.phase ?? n.querySelector<HTMLElement>('[data-phase]')?.dataset.phase); });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
});
const recordedPhases = (target: Page = page) => target.evaluate(() => (window as unknown as { __phases: string[] }).__phases);

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
    await recordPhases();
    await page.getByTestId('render').click();
    // Overlay structure is checked in the cancel test, where the render's end is under the test's control.
    await page.getByTestId('render-orb').waitFor();
    await page.getByTestId('report-status').filter({ hasText: /reached|limited/i }).waitFor({ timeout: 180_000 });
    await page.getByTestId('rendered-file-name').waitFor({ timeout: 60_000 });
    await page.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 10_000 });
    // The orb followed the engine's real stages: the chain pass, loudness passes with their
    // true-peak checks, then the lock once the master was final (not at the chain's 100%).
    const phases = await recordedPhases();
    expect(phases[0]).toBe('render');
    expect(phases).toContain('measure');
    expect(phases).toContain('peak');
    expect(phases[phases.length - 1]).toBe('locked');
    expect(phases.indexOf('measure')).toBeGreaterThan(phases.indexOf('render'));
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
    // The sheet holds briefly on the lock pulse after success, then closes.
    await page.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 10_000 });
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

  it('documents every control: inline hints bound to the control, and the guide drawer', async () => {
    // Which guide hints are in the DOM, and which a present control points at via aria-describedby.
    const snapshot = () => page.evaluate(() => {
      const referenced = new Set<string>();
      document.querySelectorAll('[aria-describedby]').forEach(el => el.getAttribute('aria-describedby')!.split(/\s+/).forEach(id => referenced.add(id)));
      return [...document.querySelectorAll<HTMLElement>('[data-guide]')].map(h => ({ key: h.dataset.guide!, referenced: referenced.has(h.id) }));
    });
    const present = new Set<string>(), referenced = new Set<string>();
    const take = async () => {
      const hints = await snapshot();
      // One hint per control: a duplicated key would mean two controls share a description by mistake.
      expect(hints.length).toBe(new Set(hints.map(h => h.key)).size);
      for (const h of hints) { present.add(h.key); if (h.referenced) referenced.add(h.key); }
    };
    await take(); // rendered file on screen: downloads
    await page.getByTestId('format-select').selectOption('mp3-192');
    await page.getByTestId('prepare-file').waitFor();
    await take(); // render without a file for this format: prepare
    await page.getByTestId('format-select').selectOption('pcm24');
    await page.getByTestId('rendered-file-name').waitFor();
    await page.getByRole('button', { name: '+ Space' }).click();
    await page.getByRole('button', { name: '+ Echo' }).click();
    await take(); // sends added: their parameters and Remove
    expect([...present].sort()).toEqual([...GUIDE_KEYS].sort());
    // Cancel exists only while a non-render operation runs; its button is covered by the cancel test.
    expect([...referenced].sort()).toEqual(GUIDE_KEYS.filter(k => k !== 'cancel').sort());

    // Hints are screen-reader descriptions until switched on, then print under each control.
    const renderHint = page.locator('[data-guide="render"]');
    expect(await renderHint.isVisible()).toBe(false);
    await page.getByTestId('hints-toggle').click();
    await expect(page.getByTestId('hints-toggle').getAttribute('aria-pressed')).resolves.toBe('true');
    expect(await renderHint.isVisible()).toBe(true);
    expect(await renderHint.textContent()).toBe(guideEntry('render').text);
    expect(await page.locator('[data-guide="eq.lowDb"]').isVisible()).toBe(true);
    await page.getByTestId('hints-toggle').click();
    expect(await renderHint.isVisible()).toBe(false);

    // The drawer lists every entry, traps focus as a modal, closes on Esc and returns focus.
    await page.getByTestId('guide-open').click();
    const drawer = page.getByRole('dialog', { name: 'Control guide' });
    await drawer.waitFor();
    expect(await drawer.locator('[data-guide-entry]').count()).toBe(GUIDE_KEYS.length);
    expect(await drawer.getByText(guideEntry('limit.truePeak').text).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true);
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('guide-open');

    // Back to the chain the rendered file was made from.
    await page.getByRole('button', { name: 'Remove Space' }).click();
    await page.getByRole('button', { name: 'Remove Echo' }).click();
    await page.getByTestId('rendered-file-name').waitFor();
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
    // The render is a modal dialog over the whole viewport, with Cancel focused as its way out...
    const viewport = page.viewportSize()!;
    expect(await page.getByTestId('render-orb').boundingBox()).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    // ...shown as a compact glass sheet over the dimmed, blurred studio: the orb stays small and square.
    const sheet = (await page.getByTestId('orb-sheet').boundingBox())!, stage = (await page.getByTestId('orb-stage').boundingBox())!;
    expect(sheet.width).toBeLessThanOrEqual(460);
    expect(stage.width).toBeLessThanOrEqual(380);
    expect(Math.abs(stage.width - stage.height)).toBeLessThanOrEqual(1);
    expect(await page.getByTestId('orb-sheet').evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/blur/);
    expect(await page.getByTestId('render-orb').getAttribute('role')).toBe('dialog');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('cancel');
    await expect.poll(() => page.getByTestId('render-orb').getAttribute('data-orb')).toBe('still');
    // Telemetry is measured, not simulated: the source's loudness as the Source panel shows it, and the target.
    expect(await page.getByTestId('orb-target').textContent()).toBe('−14.0 LUFS');
    const sourceLufs = (await page.getByTestId('source-lufs').textContent())!.match(/[−-]?\d+\.\d/)![0];
    expect(await page.getByTestId('orb-source').textContent()).toContain(sourceLufs);
    expect(await page.getByTestId('orb-stage').locator('canvas').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.getByText('Engine: cancelled').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('render-orb').count()).toBe(0);
    // ...and so is its Cancel button. With motion on, the orb is fed live render levels; on this
    // software-GL runner the performance guard swaps in the video so the page stays responsive.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Drive the limiter so the chain really reduces gain.
    const trim = page.getByRole('article', { name: 'Input Trim' }).getByRole('slider', { name: 'Gain' });
    const limiterOn = page.getByRole('article', { name: 'Brickwall Limiter' }).getByRole('button', { name: 'Brickwall Limiter on' });
    await trim.fill('12');
    if ((await limiterOn.getAttribute('aria-pressed')) !== 'true') await limiterOn.click();
    await page.getByTestId('render').click();
    await page.getByTestId('render-orb').waitFor();
    await expect.poll(() => page.getByTestId('render-orb').getAttribute('data-orb'), { timeout: 15_000 }).toMatch(/^(webgl|video)$/);
    await expect.poll(async () => Number(await page.getByTestId('orb-stage').getAttribute('data-energy')), { timeout: 15_000 }).toBeGreaterThan(0);
    // Live telemetry from the chain pass: stage and measured gain reduction (the limiter is on here).
    expect(await page.getByTestId('render-orb').getAttribute('data-phase')).toBe('render');
    expect(await page.getByTestId('orb-sys').textContent()).toBe('RENDER');
    await expect.poll(async () => Number(await page.getByTestId('orb-stage').getAttribute('data-reduction')), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await page.getByTestId('orb-gr').textContent()).toMatch(/^[−-]\d+\.\d dB$/);
    await page.getByTestId('cancel').click();
    // The status already read 'cancelled' from the Esc round: wait for the overlay itself to close.
    await page.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 30_000 });
    expect(await page.getByRole('banner').textContent()).toMatch(/Engine: cancelled/);
    expect(await page.getByTestId('engine-error').count()).toBe(0);
    expect(await page.getByTestId('cancel').count()).toBe(0);
    expect(await page.getByTestId('render').isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Standard' }).click();
    await trim.fill('0');
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

  it('is mobile-first on a 390 px phone: fits, 44 px targets, frosted panels, Play and Render one tap away', async () => {
    // Desktop keeps its own layout: no phone action bar.
    expect(await page.getByTestId('mobile-actions').isVisible()).toBe(false);

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phoneErrors: string[] = [];
    phone.on('pageerror', e => phoneErrors.push(e.message));
    phone.on('console', m => { if (m.type() === 'error') phoneErrors.push(m.text()); });
    await phone.goto(url);
    await phone.getByTestId('file-input').setInputFiles(wavPath);
    await phone.getByTestId('source-lufs').filter({ hasText: /\d/ }).waitFor({ timeout: 60_000 });

    // Nothing scrolls sideways.
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Work order on a phone: load, listen, suggest, output; the detailed chain last.
    const tops = await Promise.all(['Source', 'Monitor', 'Auto', 'Output', 'Chain'].map(async name => (await phone.getByRole('region', { name, exact: true }).boundingBox())!.y));
    expect(tops).toEqual([...tops].sort((x, y) => x - y));

    // Chain modules start collapsed on a phone; the header discloses their controls.
    const eq = phone.getByRole('article', { name: 'Tone EQ' });
    const disclose = eq.getByRole('button', { name: 'Tone EQ controls' });
    expect(await disclose.getAttribute('aria-expanded')).toBe('false');
    expect(await eq.getByRole('slider', { name: 'Low shelf', exact: true }).isVisible()).toBe(false);
    await disclose.click();
    expect(await disclose.getAttribute('aria-expanded')).toBe('true');
    expect(await eq.getByRole('slider', { name: 'Low shelf', exact: true }).isVisible()).toBe(true);

    // Every visible control is at least 44 x 44 px (a checkbox counts by its label).
    const small = await phone.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href], select, input[type=range], input[type=checkbox], [role=slider]')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden'; })
      .map(el => {
        const target = el.matches('input[type=checkbox]') ? el.closest('label') ?? el : el;
        const r = target.getBoundingClientRect();
        return { control: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, width: Math.round(r.width), height: Math.round(r.height) };
      })
      .filter(r => r.width < 44 || r.height < 44));
    expect(small).toEqual([]);

    // Form text is 16 px or more, so focusing a field never zooms the page on iOS.
    const fontSizes = await phone.locator('select').evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(16);

    // Glass: panels are frosted over the ambient light behind them.
    expect(await phone.getByRole('region', { name: 'Source', exact: true }).evaluate(el => getComputedStyle(el).backdropFilter)).toMatch(/blur/);

    // The action bar sits at the bottom edge with Play and Render, and never hides content.
    const bar = phone.getByTestId('mobile-actions');
    const barBox = (await bar.boundingBox())!;
    expect(Math.round(barBox.y + barBox.height)).toBe(844);
    expect(await bar.getByTestId('bar-play').isEnabled()).toBe(true);
    await phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await phone.getByRole('contentinfo').boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(barBox.y + 1);

    // Render from the bar: the sheet opens; Esc cancels and the bar comes back.
    await bar.getByTestId('bar-render').click();
    await phone.getByTestId('render-orb').waitFor();
    await phone.keyboard.press('Escape');
    await phone.getByTestId('render-orb').waitFor({ state: 'detached', timeout: 30_000 });
    expect(await bar.getByTestId('bar-render').isEnabled()).toBe(true);
    expect(phoneErrors).toEqual([]);
    await phone.close();
  });

  it('installs as a PWA: manifest, brand icons, and a theme for the browser chrome', async () => {
    const res = await fetch(new URL('manifest.webmanifest', url));
    expect(res.status).toBe(200);
    const manifest = await res.json() as { name: string; short_name: string; start_url: string; scope: string; display: string; theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
    expect(manifest).toMatchObject({ name: 'XYP3RN MASTERING', short_name: 'XYP3RN', start_url: '/', scope: '/', display: 'standalone', theme_color: '#080808', background_color: '#080808' });
    // Real PNGs at their declared sizes, including the maskable shape Android crops to.
    for (const want of ['192x192', '512x512']) expect(manifest.icons.some(i => i.sizes === want && (i.purpose ?? 'any').includes('any'))).toBe(true);
    expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const png = Buffer.from(await (await fetch(new URL(icon.src, url))).arrayBuffer());
      expect(png.subarray(1, 4).toString('latin1'), icon.src).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
    expect(await page.locator('link[rel="manifest"]').getAttribute('href')).toMatch(/manifest\.webmanifest/);
    expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBeGreaterThan(0);
    expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#080808');
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toMatch(/viewport-fit=cover/);
  });

  it('works offline once installed: reloads and masters a file with the server gone', async () => {
    // Own origin and server, so the service worker and its cache are isolated, and so going
    // offline can be made real by shutting the server down (not only emulated).
    const offlineServer = (await serve('out')) as Server;
    const origin = `http://127.0.0.1:${(offlineServer.address() as { port: number }).port}/`;
    const context = await browser.newContext();
    const app = await context.newPage();
    const appErrors: string[] = [];
    app.on('pageerror', e => appErrors.push(e.message));
    await app.goto(origin);
    // Installed and in control of the page (it claims clients on activation).
    expect(await app.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise(done => setTimeout(() => done(false), 20_000))]))).toBe(true);
    await expect.poll(() => app.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => app.evaluate(async () => (await caches.keys()).length), { timeout: 20_000 }).toBeGreaterThan(0);

    offlineServer.closeAllConnections();
    await new Promise(done => offlineServer.close(done));
    await context.setOffline(true);

    await app.reload();
    await app.getByTestId('file-input').waitFor({ state: 'attached', timeout: 20_000 });
    expect(await app.title()).toMatch(/XYP3RN MASTERING/);
    // Says so, and that nothing needs the network.
    expect(await app.getByTestId('offline').textContent()).toMatch(/offline/i);
    await app.getByTestId('file-input').setInputFiles(wavPath);
    await app.getByTestId('source-lufs').filter({ hasText: /\d/ }).waitFor({ timeout: 60_000 });
    await app.getByTestId('target-select').selectOption('-14');
    await app.getByTestId('render').click();
    await app.getByTestId('rendered-file-name').waitFor({ timeout: 180_000 });
    expect(await app.getByTestId('report-status').textContent()).toMatch(/reached|limited/i);

    // The cache holds the app only: no audio, nothing from another origin.
    const cached = await app.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
      return urls;
    });
    expect(cached.length).toBeGreaterThan(10);
    expect(cached.every(u => u.startsWith(origin))).toBe(true);
    expect(cached.filter(u => /\.(wav|flac|mp3|aiff?)$/i.test(u) || u.startsWith('blob:'))).toEqual([]);
    expect(appErrors).toEqual([]);
    await context.close();
  });

  it('raised no page or console errors', () => {
    expect(errors).toEqual([]);
  });
});
