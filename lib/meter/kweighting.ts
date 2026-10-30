// BS.1770 K-weighting re-derived per sample rate. Analogue prototype parameters
// are the bilinear-transform fit that reproduces the published 48 kHz table
// (same constants as libebur128), so non-48k rates aren't approximated.

/** Normalized biquad: [b0, b1, b2, a1, a2]. */
export type Biquad5 = [number, number, number, number, number];

const SHELF_HZ = 1681.974450955533;
const SHELF_Q = 0.7071752369554196;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_VB_EXP = 0.4996667741545416;
const HP_HZ = 38.13547087602444;
const HP_Q = 0.5003270373238773;

/**
 * BS.1770 K-weighting: high-shelf pre-filter then RLB high-pass.
 * @returns [shelf, highpass] normalized biquads for `rate`.
 */
export function kWeighting(rate: number): [Biquad5, Biquad5] {
  const K = Math.tan((Math.PI * SHELF_HZ) / rate);
  const Vh = 10 ** (SHELF_GAIN_DB / 20), Vb = Vh ** SHELF_VB_EXP;
  const a0 = 1 + K / SHELF_Q + K * K;
  const shelf: Biquad5 = [
    (Vh + (Vb * K) / SHELF_Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / SHELF_Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / SHELF_Q + K * K) / a0,
  ];
  const H = Math.tan((Math.PI * HP_HZ) / rate), h0 = 1 + H / HP_Q + H * H;
  // Numerator left unnormalized (1, -2, 1): BS.1770 specifies it that way and absolute level is set by -0.691.
  return [shelf, [1, -2, 1, (2 * (H * H - 1)) / h0, (1 - H / HP_Q + H * H) / h0]];
}

/** Single-channel transposed direct form II section. */
export function section(c: Biquad5): (x: number) => number {
  const [b0, b1, b2, a1, a2] = c;
  let z1 = 0, z2 = 0;
  return x => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

// WAVE_FORMAT_EXTENSIBLE speaker bits -> BS.1770 weight. LFE is excluded;
// surrounds/sides/back-centre get +1.5 dB (1.41). Anything else is unknown.
const SPEAKER_WEIGHTS: Record<number, number> = {
  0x1: 1, 0x2: 1, 0x4: 1, 0x8: 0, 0x10: 1.41, 0x20: 1.41, 0x100: 1.41, 0x200: 1.41, 0x400: 1.41,
};

/**
 * BS.1770 channel weights from a speaker mask.
 * @returns Weights per channel, or null when the layout is unknown/unsupported
 * (we refuse to guess positions rather than report a wrong LUFS).
 */
export function channelWeights(channels: number, mask = 0): number[] | null {
  if (!mask) return channels <= 2 ? Array<number>(channels).fill(1) : null;
  const weights: number[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (!((mask >>> bit) & 1)) continue;
    const w = SPEAKER_WEIGHTS[2 ** bit];
    if (w === undefined) return null;
    weights.push(w);
  }
  return weights.length === channels ? weights : null;
}
