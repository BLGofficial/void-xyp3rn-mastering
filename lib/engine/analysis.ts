// Signal measurements that describe audio, not genre or intent: multi-scale
// dynamics, sampled band spectrum with per-band stereo, and source heuristics.

import { fail } from './errors';
import type { AudioData, DetailedAnalysis, LevelSummary, SourceQuality, Spectrum, SpectrumBand, TrackMetrics } from './types';
import type { ProgressOptions } from '../meter';

const ANALYSIS_VERSION = '1.0.0';
/** Power ratio in dB. */
const powerDb = (x: number) => (x > 0 ? 10 * Math.log10(x) : -Infinity);
const FLT_MIN_NORMAL = 1.1754943508222875e-38;

/** Linearly interpolated percentile; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), i = (a.length - 1) * p, k = Math.floor(i);
  return a[k]! + (a[Math.ceil(i)]! - a[k]!) * (i - k);
}

function summarize(levels: number[]): LevelSummary {
  const active = levels.filter(x => Number.isFinite(x) && x > -60);
  const spread = active.length >= 4 ? percentile(active, 0.9)! - percentile(active, 0.1)! : null;
  return { windows: levels.length, activeWindows: active.length, spreadDb: spread, medianDb: percentile(active, 0.5), confidence: active.length >= 4 ? 'medium' : 'low' };
}

export interface DynamicsAnalyzer {
  push(channels: Float32Array[], i: number): void;
  result(): Omit<DetailedAnalysis, 'spectrum'>;
}

/**
 * Streaming dynamics at three scales: 10 ms crest/onsets (micro), 1 s (meso), 15 s (macro),
 * plus integrity counters (near-ceiling, plateaus = likely clipping, denormals, >24 dBFS floats).
 */
export function dynamicsAnalyzer(rate: number, channels: number): DynamicsAnalyzer {
  const microFrames = Math.max(1, Math.round(rate * 0.01));
  const levels: number[] = [], crests: number[] = [], monoCrests: number[] = [], meso: number[] = [], macro: number[] = [];
  const last = new Float64Array(channels);
  let frames = 0, power = 0, peak = 0, monoPower = 0, monoPeak = 0, mesoPower = 0, mesoFrames = 0, macroPower = 0, macroFrames = 0;
  let onsets = 0, previous = -120, total = 0, nearCeiling = 0, plateaus = 0, subnormal = 0, pathological = 0, identicalPower = 0, totalPower = 0;

  const flush = () => {
    if (!frames) return;
    const level = powerDb(power / frames), crest = power > 0 ? powerDb((peak * peak * frames) / power) : null;
    levels.push(level);
    if (level > -60 && crest !== null) {
      crests.push(crest);
      if (monoPower > 0) monoCrests.push(powerDb((monoPeak * monoPeak * frames) / monoPower));
      // Energy-rise proxy for onsets, not instrument detection.
      if (level - previous > 6 && level > -45) onsets++;
    }
    previous = level;
    mesoPower += power; mesoFrames += frames; macroPower += power; macroFrames += frames;
    if (mesoFrames >= rate) { meso.push(powerDb(mesoPower / mesoFrames)); mesoPower = mesoFrames = 0; }
    if (macroFrames >= rate * 15) { macro.push(powerDb(macroPower / macroFrames)); macroPower = macroFrames = 0; }
    frames = power = peak = monoPower = monoPeak = 0;
  };

  return {
    push(data, i) {
      let energy = 0, mono = 0;
      for (let c = 0; c < channels; c++) {
        const x = data[c]![i]!, a = Math.abs(x);
        energy += x * x; mono += x;
        peak = Math.max(peak, a);
        if (a >= 0.999) nearCeiling++;
        if (a >= 0.98 && Math.abs(x - last[c]!) < 1e-7) plateaus++;
        if (a > 0 && a < FLT_MIN_NORMAL) subnormal++;
        if (a > 16) pathological++;
        last[c] = x;
      }
      mono /= channels; energy /= channels;
      power += energy; totalPower += energy; monoPower += mono * mono;
      monoPeak = Math.max(monoPeak, Math.abs(mono));
      if (channels === 2) identicalPower += (data[0]![i]! - data[1]![i]!) ** 2;
      frames++; total++;
      if (frames === microFrames) flush();
    },
    result() {
      flush();
      const duration = total / rate, crestP90 = percentile(crests, 0.9), onsetsPerSecond = duration ? onsets / duration : 0;
      return {
        schemaVersion: 1,
        dynamics: {
          micro: {
            windowMs: 10, crestMedianDb: percentile(crests, 0.5), crestP90Db: crestP90, onsets, onsetsPerSecond,
            transientHeavy: duration >= 1 && ((crestP90 ?? 0) > 9 || onsetsPerSecond > 1.5),
            method: '10 ms energy-rise (>6 dB) proxy; not instrument or onset classification',
          },
          meso: { windowSeconds: 1, ...summarize(meso) },
          macro: { windowSeconds: 15, ...summarize(macro) },
          monoTransientCrestDb: percentile(monoCrests, 0.5),
        },
        integrity: {
          finite: true, subnormalSamples: subnormal, pathologicalSamples: pathological,
          nearCeilingFraction: nearCeiling / (total * channels), plateauFraction: plateaus / (total * channels),
        },
        dualMono: channels === 2 && totalPower > 0 && identicalPower / totalPower < 1e-8,
      } as Omit<DetailedAnalysis, 'spectrum'>;
    },
  };
}

const twiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();
/** In-place iterative radix-2 FFT (n a power of two), cached twiddles per size. */
export function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  let table = twiddles.get(n);
  if (!table) {
    table = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) { table.cos[k] = Math.cos((-2 * Math.PI * k) / n); table.sin[k] = Math.sin((-2 * Math.PI * k) / n); }
    twiddles.set(n, table);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j]!, real[i]!]; [imag[i], imag[j]] = [imag[j]!, imag[i]!]; }
  }
  for (let span = 2; span <= n; span *= 2) {
    const half = span / 2, step = n / span;
    for (let k = 0; k < half; k++) {
      const co = table.cos[k * step]!, si = table.sin[k * step]!;
      for (let i = k; i < n; i += span) {
        const j = i + half, r = real[j]! * co - imag[j]! * si, im = real[j]! * si + imag[j]! * co;
        real[j] = real[i]! - r; imag[j] = imag[i]! - im; real[i]! += r; imag[i]! += im;
      }
    }
  }
}

/** Analysis bands in Hz; overlapping by design (tonal vs. per-band stereo views). */
export const BANDS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  sub20: [0, 20], bass20_40: [20, 40], bass40_80: [40, 80], bass80_150: [80, 150],
  presence2_4: [2000, 4000], presence4_6: [4000, 6000], sibilance6_9: [6000, 9000], air9_12: [9000, 12000],
  stereo20_120: [20, 120], stereo120_500: [120, 500], stereo500_2k: [500, 2000], stereo2_8k: [2000, 8000], stereo8_20k: [8000, 20000],
});

/**
 * Sampled spectrum: up to 96 deterministically spaced Hann windows (~6 Hz resolution),
 * first two channels, band power fractions plus per-band correlation and side/mid.
 */
export async function spectral(buffer: AudioData, options: ProgressOptions = {}): Promise<Spectrum> {
  const rate = buffer.sampleRate;
  const n = Math.max(4096, Math.min(32768, 2 ** Math.ceil(Math.log2(rate / 6))));
  const windows = Math.min(96, Math.max(1, Math.ceil(buffer.length / n))), channels = Math.min(2, buffer.numberOfChannels);
  const real = Array.from({ length: channels }, () => new Float64Array(n)), imag = real.map(() => new Float64Array(n));
  const hann = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const acc = Object.fromEntries(Object.entries(BANDS).map(([name, [low, high]]) => [name, {
    lowHz: low, highHz: Math.min(high, rate / 2), coverage: Math.max(0, Math.min(1, (rate / 2 - low) / (high - low))), left: 0, right: 0, cross: 0,
  }]));
  const names = Object.keys(acc);
  const memberships = Array.from({ length: n / 2 + 1 }, (_, k) => names.filter(name => (k * rate) / n >= acc[name]!.lowHz && (k * rate) / n < acc[name]!.highHz));
  let total = 0;
  for (let w = 0; w < windows; w++) {
    options.onHeartbeat?.();
    if (w % 4 === 0) {
      const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
      await (scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0)));
      if (options.signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
    }
    const start = windows === 1 ? 0 : Math.round((w * Math.max(0, buffer.length - n)) / (windows - 1));
    for (let c = 0; c < channels; c++) {
      imag[c]!.fill(0);
      for (let i = 0; i < n; i++) {
        const sample = buffer.channels[c]![start + i] ?? 0;
        if (!Number.isFinite(sample)) throw new Error('Non-finite spectral input.');
        real[c]![i] = sample * hann[i]!;
      }
      fft(real[c]!, imag[c]!);
    }
    for (let k = 0; k <= n / 2; k++) {
      // One-sided spectrum: interior bins carry both halves.
      const weight = k === 0 || k === n / 2 ? 1 : 2;
      const re0 = real[0]![k]!, im0 = imag[0]![k]!;
      const l = (re0 ** 2 + im0 ** 2) * weight;
      const r = channels === 2 ? (real[1]![k]! ** 2 + imag[1]![k]! ** 2) * weight : l;
      const cross = channels === 2 ? (re0 * real[1]![k]! + im0 * imag[1]![k]!) * weight : l;
      total += (l + r) / 2;
      for (const name of memberships[k]!) { const b = acc[name]!; b.left += l; b.right += r; b.cross += cross; }
    }
  }
  const bands: Record<string, SpectrumBand> = {};
  for (const [name, b] of Object.entries(acc)) {
    const power = (b.left + b.right) / 2, mid = Math.max(0, (b.left + b.right + 2 * b.cross) / 4), side = Math.max(0, (b.left + b.right - 2 * b.cross) / 4);
    const audible = total > 0 && power / total > 1e-6;
    bands[name] = {
      lowHz: b.lowHz, highHz: b.highHz, coverage: b.coverage,
      fraction: total && b.coverage > 0 ? power / total : null,
      correlation: audible && b.left * b.right > 0 ? Math.max(-1, Math.min(1, b.cross / Math.sqrt(b.left * b.right))) : null,
      sideMidDb: audible ? (mid > 0 ? powerDb(side / mid) : side > 0 ? Infinity : null) : null,
      monoLossDb: audible ? powerDb(mid / power) : null,
    };
  }
  const fraction = (name: string) => bands[name]!.fraction ?? 0;
  const density = (name: string) => fraction(name) / Math.max(1, bands[name]!.highHz - bands[name]!.lowHz);
  const neighbour = Math.sqrt(density('presence4_6') * density('air9_12'));
  // Sibilance band density relative to its neighbours; not vocal detection.
  const prominence = neighbour > 1e-12 ? powerDb(density('sibilance6_9') / neighbour) : fraction('sibilance6_9') > 0.1 ? 30 : 0;
  const hf = fraction('presence2_4') + fraction('presence4_6') + fraction('sibilance6_9') + fraction('air9_12');
  return {
    schemaVersion: 1, windows, fftSize: n, resolutionHz: rate / n, sampledSeconds: Math.min(buffer.duration, (windows * n) / rate), channelsAnalyzed: channels, bands,
    highFrequency: {
      densityFraction: hf, sibilanceProminenceDb: prominence,
      sibilanceRisk: bands.air9_12!.coverage < 1 ? 'unavailable' : prominence > 6 && fraction('sibilance6_9') > 0.12 ? 'elevated' : 'not-detected',
      harshnessRisk: hf > 0.5 ? 'elevated' : 'not-detected', confidence: 'low',
      method: 'Sampled band prominence and density; not vocal detection or a perceptual diagnosis',
    },
    confidence: windows >= 8 && buffer.duration >= 3 ? 'medium' : 'low',
    method: 'Deterministically spaced Hann FFT windows; first two channels; bands above Nyquist unavailable',
  };
}

/** Heuristic source flags. Says what the signal looks like, never what it is. */
export function sourceQuality(m: Omit<TrackMetrics, 'sourceQuality'>): SourceQuality {
  const integrity = m.analysis?.integrity, lufs = m.loudness?.integratedLufs as number, flags: string[] = [];
  if ((integrity?.plateauFraction || 0) > 0.001) flags.push('possible-clipping');
  if (m.peakDbfs > -0.2) flags.push('little-sample-headroom');
  if (lufs < -40) flags.push('very-quiet');
  if (m.analysis?.dualMono) flags.push('dual-mono');
  if ((m.correlation as number) < -0.1) flags.push('negative-correlation');
  if (m.dcOffset?.some(x => Math.abs(x) > 0.01)) flags.push('dc-offset');
  // Null comparisons coerce to false-y like the measurements' absence: no evidence either way.
  const evidence = [lufs >= -10, (m.crestDb as number) < 8, (integrity?.nearCeilingFraction || 0) > 0.005, (m.dynamics?.sectionSpreadDb ?? Infinity) < 3].filter(Boolean).length;
  const likelyAlreadyMastered = evidence >= 3;
  if (likelyAlreadyMastered) flags.push('possibly-already-mastered');
  return {
    flags, likelyAlreadyMastered, confidence: likelyAlreadyMastered ? 'medium' : 'low', recommendation: likelyAlreadyMastered ? 'transparent' : 'source-aware',
    note: 'Heuristics cannot establish whether a track was mastered, clipped or intentionally distorted.',
  };
}

export { ANALYSIS_VERSION };
