// Final export validation: 16x reconstruction with 64-tap Blackman-Harris-windowed
// sinc phases. Deliberately a different filter from the realtime BS.1770 detector,
// so a limiter tuned against one isn't graded by the same approximation.

import { assertNotAborted, codedError, yieldToEventLoop } from './progress';
import type { AudioBufferLike, PeakInspection, ProgressOptions } from './types';

const OVERSAMPLE = 16;
const TAPS = 64;
const BLOCK = 1024;
const METHOD = '16x / 64-tap Blackman-Harris reconstruction; quiet blocks bounded by filter L1 norm';

/** Fractional-delay phases 1..15 (phase 0 is the sample itself), each normalized to unity DC gain. */
const PHASES: Float64Array[] = [];
/** Worst-case gain of any phase: a block whose sample peak x this can't exceed the ceiling can be skipped. */
let L1_BOUND = 1;
for (let phase = 1; phase < OVERSAMPLE; phase++) {
  const taps: number[] = [];
  let sum = 0;
  for (let k = -31; k <= 32; k++) {
    const x = k - phase / OVERSAMPLE, theta = (Math.PI * x) / 32;
    const w = Math.abs(x) < 32 ? 0.35875 + 0.48829 * Math.cos(theta) + 0.14128 * Math.cos(2 * theta) + 0.01168 * Math.cos(3 * theta) : 0;
    const v = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w;
    taps.push(v);
    sum += v;
  }
  const normalized = Float64Array.from(taps, v => v / sum);
  L1_BOUND = Math.max(L1_BOUND, normalized.reduce((s, v) => s + Math.abs(v), 0));
  PHASES.push(normalized);
}

const toDb = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/**
 * Final export check: inter-sample peak reconstruction against `ceilingDbtp`.
 * @throws On non-finite samples or cancellation.
 */
export async function inspectPeaks(buffer: AudioBufferLike, ceilingDbtp: number, options: ProgressOptions = {}): Promise<PeakInspection> {
  const target = 10 ** (ceilingDbtp / 20);
  let maximum = 0, sampleMaximum = 0, skipped = 0, checked = 0, visited = 0;
  // Zero-padded scratch window so the FIR never bounds-checks at file edges.
  const tile = new Float32Array(BLOCK + TAPS - 1);
  for (const channel of buffer.channels) {
    // Blocks extend 32 samples past each end so edge reconstructions are covered.
    for (let start = -32; start < channel.length + 32; start += BLOCK) {
      assertNotAborted(options.signal);
      options.onHeartbeat?.();
      if ((visited++ & 15) === 0) await yieldToEventLoop();
      const end = Math.min(start + BLOCK, channel.length + 32);
      let local = 0;
      for (let i = Math.max(0, start - 31); i < Math.min(channel.length, end + 32); i++) {
        const x = Math.abs(channel[i]!);
        if (!Number.isFinite(x)) throw codedError('RENDER_INTEGRITY', 'Final peak validation found non-finite samples.');
        local = Math.max(local, x);
      }
      maximum = Math.max(maximum, local);
      sampleMaximum = Math.max(sampleMaximum, local);
      if (local * L1_BOUND <= target) { skipped++; continue; }
      checked++;
      tile.fill(0);
      const origin = start - 31, from = Math.max(0, origin), to = Math.min(channel.length, end + 32);
      tile.set(channel.subarray(from, to), from - origin);
      for (let i = 0; i < end - start; i++) {
        for (const taps of PHASES) {
          let v = 0;
          for (let k = 0; k < TAPS; k++) v += tile[i + k]! * taps[k]!;
          maximum = Math.max(maximum, Math.abs(v));
        }
      }
    }
    options.onStatus?.('Verifying reconstructed output peaks...');
  }
  return {
    maximumChecked: maximum,
    samplePeakDbfs: toDb(sampleMaximum),
    checkedPeakDbtp: toDb(maximum),
    verified: maximum <= target,
    checkedBlocks: checked,
    skippedBlocks: skipped,
    quietBlockBound: L1_BOUND,
    method: METHOD,
  };
}
