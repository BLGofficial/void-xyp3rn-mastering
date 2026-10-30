// BS.1770-4 / EBU Tech 3342 gating over block mean-square powers.

/** Absolute gate (-70 LUFS) expressed as mean-square power. */
export const ABSOLUTE_GATE = 10 ** ((-70 + 0.691) / 10);

export const powerToLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);
export const amplitudeToDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);

/**
 * Two-stage gated integrated loudness (absolute -70 LUFS, relative -10 LU).
 * @param blockPowers Mean-square power of each 400 ms block (75 % overlap).
 * @returns LUFS, or -Infinity when nothing passes the gates.
 */
export function gatedIntegrated(blockPowers: ArrayLike<number>): number {
  const meanAbove = (gate: number) => {
    let sum = 0, count = 0;
    for (let i = 0; i < blockPowers.length; i++) {
      const p = blockPowers[i]!;
      if (p > gate) { sum += p; count++; }
    }
    return { sum, count };
  };
  const first = meanAbove(ABSOLUTE_GATE);
  if (!first.count) return -Infinity;
  const second = meanAbove(Math.max(ABSOLUTE_GATE, (first.sum / first.count) * 0.1));
  return second.count ? powerToLufs(second.sum / second.count) : -Infinity;
}

/**
 * EBU Tech 3342 loudness range: 95th minus 10th percentile of gated short-term loudness
 * (absolute -70 LUFS, relative -20 LU). Percentiles are linearly interpolated.
 * @returns LU, or null when no block passes the gates.
 */
export function loudnessRange(shortTermPowers: ArrayLike<number>): number | null {
  const absolute = Array.from(shortTermPowers).filter(p => p >= ABSOLUTE_GATE);
  if (!absolute.length) return null;
  const gate = Math.max(ABSOLUTE_GATE, (absolute.reduce((s, v) => s + v, 0) / absolute.length) * 0.01);
  const sorted = absolute.filter(p => p >= gate).map(powerToLufs).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const quantile = (q: number) => {
    const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
  };
  return quantile(0.95) - quantile(0.1);
}
