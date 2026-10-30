import { fft } from '../engine/analysis';
import type { AudioData } from '../engine';
import type { ProgressOptions } from '../meter';
import type { TonalProfile } from './types';

const SIZE = 4096;
const MAX_WINDOWS = 256;
/** Band edges (Hz): bass, low-mid, mid, presence, high. */
const EDGES = [20, 120, 500, 2000, 6000, 20000];

/**
 * Sampled 5-band tonal energy profile: up to 256 evenly spaced Hann windows.
 * Channel powers are summed separately so anti-phase stereo can't cancel out.
 * Descriptive only: not a genre target or a diagnosis of mix faults.
 */
export async function tonalProfile(buffer: AudioData, options: ProgressOptions = {}): Promise<TonalProfile> {
  const count = Math.min(MAX_WINDOWS, Math.max(1, Math.ceil(buffer.length / SIZE)));
  const real = new Float64Array(SIZE), imag = new Float64Array(SIZE);
  const hann = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1)));
  const powers = [0, 0, 0, 0, 0];
  const bandOf = Array.from({ length: SIZE / 2 + 1 }, (_, bin) => {
    const hz = (bin * buffer.sampleRate) / SIZE;
    return EDGES.findIndex((edge, i) => i < 5 && hz >= edge && hz < EDGES[i + 1]!);
  });
  for (let w = 0; w < count; w++) {
    if (w % 8 === 0) {
      const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
      await (scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0)));
      if (options.signal?.aborted) throw new Error('Operation cancelled.');
    }
    const start = count === 1 ? 0 : Math.round((w * Math.max(0, buffer.length - SIZE)) / (count - 1));
    for (const channel of buffer.channels) {
      imag.fill(0);
      for (let i = 0; i < SIZE; i++) {
        const sample = start + i < buffer.length ? channel[start + i]! : 0;
        if (!Number.isFinite(sample)) throw new Error('Audio contains a non-finite sample.');
        real[i] = sample * hann[i]!;
      }
      fft(real, imag);
      for (let bin = 1; bin <= SIZE / 2; bin++) {
        const band = bandOf[bin]!;
        // One-sided spectrum: interior bins stand for both halves.
        if (band >= 0) powers[band]! += (real[bin]! ** 2 + imag[bin]! ** 2) * (bin === SIZE / 2 ? 1 : 2);
      }
    }
  }
  if (options.signal?.aborted) throw new Error('Operation cancelled.');
  const total = powers.reduce((s, v) => s + v, 0);
  const pct = (i: number) => (total > 0 ? (powers[i]! * 100) / total : null);
  return { windows: count, bassPct: pct(0), lowMidPct: pct(1), midPct: pct(2), presencePct: pct(3), highPct: pct(4) };
}
