// Draws the mastering report onto A4 canvases (144 dpi) and returns JPEG pages
// for lib/export's assemblePdf. Brand: gold mark on Studio Black only.

import { MARK_PATH } from '@/components/brand/mark-path';
import { check } from '@/lib/engine/errors';
import { effectsSummary, PAGE_HEIGHT_PX as H, PAGE_WIDTH_PX as W, type Report } from '@/lib/export';

const C = { bg: '#080808', panel: '#0D0D0D', line: '#222222', gold: '#FACD68', cloud: '#E8E8E8', ash: '#888888', muted: '#444444' };
const MARGIN = 72, BODY_W = W - MARGIN * 2, BOTTOM = H - 130;
const MARK_W = 2860, MARK_H = 2741;

/** next/font hashes family names; resolve them from the CSS variables the app already sets. */
function families() {
  const css = getComputedStyle(document.documentElement);
  const read = (v: string, fallback: string) => css.getPropertyValue(v).trim() || fallback;
  return { display: read('--font-bebas', 'Impact, sans-serif'), body: read('--font-dm-sans', 'sans-serif'), mono: read('--font-jetbrains', 'monospace') };
}

const fmt = (v: number | null | undefined, digits = 2) => {
  if (v === -Infinity) return '−∞';
  if (!Number.isFinite(v)) return 'N/A';
  // Rounds to zero -> print 0.00, not -0.00.
  return (Math.abs(v as number) < 0.5 * 10 ** -digits ? 0 : (v as number)).toFixed(digits).replace('-', '−');
};
const signedFmt = (v: number | null | undefined, digits = 2) => (Number.isFinite(v) && (v as number) > 0 ? '+' : '') + fmt(v, digits);

export async function renderReportPages(report: Report, signal?: AbortSignal): Promise<Uint8Array[]> {
  const f = families();
  const pages: Uint8Array[] = [];
  const mark = new Path2D(MARK_PATH);
  let ctx!: CanvasRenderingContext2D, canvas!: HTMLCanvasElement, y = 0;

  const drawMark = (x: number, top: number, height: number) => {
    const s = height / MARK_H;
    ctx.save();
    ctx.translate(x, top);
    ctx.scale(s, s);
    ctx.fillStyle = C.gold;
    ctx.fill(mark, 'evenodd');
    ctx.restore();
  };
  const newPage = () => {
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d')!;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    drawMark(MARGIN, 56, 52);
    ctx.fillStyle = C.cloud;
    ctx.font = `44px ${f.display}`;
    ctx.fillText('XYP3RN MASTERING', MARGIN + 52 * (MARK_W / MARK_H) + 22, 100);
    ctx.fillStyle = C.gold;
    ctx.font = `16px ${f.mono}`;
    ctx.textAlign = 'right';
    ctx.fillText('SESSION REPORT', W - MARGIN, 98);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.line;
    ctx.fillRect(MARGIN, 136, BODY_W, 2);
    y = 196;
  };
  const endPage = async () => {
    ctx.fillStyle = C.line;
    ctx.fillRect(MARGIN, H - 96, BODY_W, 2);
    ctx.font = `15px ${f.mono}`;
    ctx.fillStyle = C.ash;
    ctx.fillText('XYP3RN TECH · LOCAL PROCESSING · NO AUDIO LEFT THE MACHINE', MARGIN, H - 60);
    ctx.textAlign = 'right';
    ctx.fillText(`${report.date.slice(0, 10)} · ${pages.length + 1}`, W - MARGIN, H - 60);
    ctx.textAlign = 'left';
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('A report page could not be rasterised.');
    pages.push(new Uint8Array(await blob.arrayBuffer()));
    check(signal);
  };
  const room = async (height: number) => {
    if (y + height > BOTTOM) { await endPage(); newPage(); }
  };

  /** Greedy word wrap; words wider than the column are split by character. */
  const wrap = (value: string, width: number) => {
    const lines: string[] = [];
    let line = '';
    for (let word of String(value).replace(/[\u0000-\u001f]/g, ' ').split(/\s+/).filter(Boolean)) {
      while (ctx.measureText(word).width > width) {
        if (line) { lines.push(line); line = ''; }
        let cut = 1;
        while (cut < word.length && ctx.measureText(word.slice(0, cut + 1)).width <= width) cut++;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = async (value: string, size = 21, color = C.cloud, font = f.body) => {
    ctx.font = `${size}px ${font}`;
    for (const row of wrap(value, BODY_W)) {
      await room(size * 1.5);
      ctx.font = `${size}px ${font}`;
      ctx.fillStyle = color;
      ctx.fillText(row, MARGIN, y);
      y += size * 1.5;
    }
    y += 6;
  };
  const section = async (index: string, title: string) => {
    await room(110);
    y += 24;
    ctx.font = `34px ${f.display}`;
    ctx.fillStyle = C.gold;
    ctx.fillText(index, MARGIN, y);
    ctx.fillStyle = C.cloud;
    ctx.fillText(title, MARGIN + 56, y);
    y += 40;
  };

  newPage();
  await text('Your sound. Documented.', 50, C.cloud, f.display);
  await text(report.track, 28);
  await text(`${report.format.toUpperCase()} · ${report.sampleRate} Hz · ${report.channels} ch · source ${fmt(report.sourceDuration)} s · master ${fmt(report.masterDuration)} s · exported ${report.date}`, 17, C.ash, f.mono);

  await section('01', 'SOURCE → MASTER');
  const cols = [MARGIN, 560, 760, 960];
  ctx.font = `15px ${f.mono}`;
  ctx.fillStyle = C.gold;
  ['MEASUREMENT', 'SOURCE', 'MASTER', 'CHANGE'].forEach((h, i) => ctx.fillText(h, cols[i]!, y));
  y += 34;
  for (const [i, row] of report.measurements.entries()) {
    await room(56);
    if (i % 2 === 0) { ctx.fillStyle = C.panel; ctx.fillRect(MARGIN - 12, y - 30, BODY_W + 24, 50); }
    const digits = row.label === 'Stereo correlation' ? 3 : 2;
    ctx.font = `20px ${f.body}`;
    ctx.fillStyle = C.cloud;
    ctx.fillText(row.label, cols[0]!, y);
    ctx.font = `20px ${f.mono}`;
    ctx.fillText(fmt(row.source, digits), cols[1]!, y);
    ctx.fillText(fmt(row.master, digits), cols[2]!, y);
    ctx.fillStyle = C.gold;
    ctx.fillText(`${signedFmt(row.delta, digits)} ${row.deltaUnit}`.trim(), cols[3]!, y);
    ctx.font = `14px ${f.mono}`;
    ctx.fillStyle = C.ash;
    ctx.fillText(row.unit, 470, y);
    y += 50;
  }
  y += 8;
  await text('Change is master minus source: dB for levels, LU for loudness; correlation is unitless.', 17, C.ash);
  const t = report.target;
  if (t?.requested != null) await text(`Target ${t.requested} LUFS · measured ${fmt(t.achieved)} LUFS · ${t.status ?? 'checked'}. ${t.reason ?? ''}`, 20, C.gold);

  await section('02', 'READING THE NUMBERS');
  for (const note of report.notes) await text(note, 20);
  for (const w of report.safety.warnings) await text(`Check: ${String(w.code).toLowerCase().replace(/_/g, ' ')}${w.introduced ? '' : ' (present in the source)'}`, 20, C.gold);

  await section('03', 'EFFECTS APPLIED');
  const effects = effectsSummary(report.chain);
  await text('What this master went through, in signal order. The source file is unchanged.', 20);
  if (!effects.applied.length) await text('No effects were applied: the master is the source at the output stage below.', 20, C.ash);
  for (const [i, e] of effects.applied.entries()) {
    await room(96);
    y += 8;
    await text(`${String(i + 1).padStart(2, '0')}  ${e.name.toUpperCase()}`, 22, C.gold, f.mono);
    await text(e.settings.join('  ·  '), 18, C.cloud, f.mono);
  }
  y += 8;
  await text('Output stage', 22, C.gold, f.mono);
  for (const line of effects.output) await text(line, 18, C.cloud, f.mono);
  await text(`Dither: ${report.dither ? 'TPDF at the final PCM quantisation' : 'off'}.`, 18, C.cloud, f.mono);
  if (effects.bypassed.length) await text(`In the chain but bypassed (did not touch the audio): ${effects.bypassed.join(', ')}.`, 18, C.ash);

  await section('04', 'VERIFICATION');
  const stats = report.processingStats, guard = report.peakGuard, codec = report.codecVerification;
  if (stats) await text(`Gain reduction — limiter max ${fmt(stats.maxLimiterReductionDb)} dB; dynamics max ${fmt(stats.maxDynamicsReductionDb)} dB, mean ${fmt(stats.meanDynamicsReductionDb)} dB.`, 20);
  if (guard) await text(`Final peak guard — ${fmt(guard.beforeDbtp)} → ${fmt(guard.afterDbtp)} dBTP, whole-track attenuation ${fmt(guard.attenuationDb)} dB, ceiling ${fmt(guard.ceilingDbtp)} dBTP.`, 20);
  if (codec) {
    await text(`MP3 decode check — decoded peak ${fmt(codec.checkedPeakDbtp)} dBTP against ${fmt(codec.ceilingDbtp)} dBTP; codec gain ${signedFmt(codec.codecGainDb)} dB over ${codec.passes} pass${codec.passes === 1 ? '' : 'es'}; ${codec.verified ? 'verified' : 'unverified'}.`, 20);
  }
  for (const [k, v] of Object.entries(report.versions)) await text(`${k}: ${v}`, 17, C.ash, f.mono);
  await text(`Audio file: ${report.audioFilename}`, 17, C.ash, f.mono);
  await text('Settings describe the processing applied. Measurements neither reconstruct the original mix nor establish perceived quality. Values are rounded.', 18);
  await text(report.signOff, 20, C.gold);
  await endPage();
  return pages;
}
