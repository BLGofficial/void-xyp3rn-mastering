import { advance, ramp, retarget, type Ramp } from './ramp';

export type FilterType = 'low' | 'peak' | 'high';
/** Normalized biquad: [b0, b1, b2, a1, a2] with a0 divided out. */
export type Coefficients = [number, number, number, number, number];

const IDENTITY: Coefficients = [1, 0, 0, 0, 0];

/**
 * RBJ audio-EQ-cookbook biquad coefficients (https://www.w3.org/TR/audio-eq-cookbook/).
 * Shelves use slope S=1. Frequency is clamped to 0.45·rate so low-rate files stay stable.
 * @returns Identity filter when `db === 0`.
 */
export function coefficients(type: FilterType, hz: number, db: number, q: number, rate: number): Coefficients {
  if (db === 0) return [...IDENTITY];
  const w = (2 * Math.PI * Math.min(hz, rate * 0.45)) / rate;
  const cos = Math.cos(w), sin = Math.sin(w), A = 10 ** (db / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'peak') {
    const alpha = sin / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else {
    // S=1 shelf: 2·sqrt(A)·alpha with alpha = sin/2·sqrt(2).
    const beta = (2 * Math.sqrt(A) * sin) / Math.sqrt(2);
    if (type === 'low') {
      b0 = A * (A + 1 - (A - 1) * cos + beta); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - beta);
      a0 = A + 1 + (A - 1) * cos + beta; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - beta;
    } else {
      b0 = A * (A + 1 + (A - 1) * cos + beta); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - beta);
      a0 = A + 1 - (A - 1) * cos + beta; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - beta;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Transposed direct form II, one state pair per channel, coefficients individually smoothed. */
export interface Biquad {
  coeffs: Ramp[];
  z1: Float64Array;
  z2: Float64Array;
}

export const biquad = (channels: number, c: Coefficients): Biquad => ({
  coeffs: c.map(ramp),
  z1: new Float64Array(channels),
  z2: new Float64Array(channels),
});

/** Glide every coefficient linearly to `c` over `samples` frames. */
export const retargetBiquad = (f: Biquad, c: Coefficients, samples: number): void =>
  c.forEach((v, i) => retarget(f.coeffs[i]!, v, samples));

/** Filter one interleaved frame in place. */
export function runBiquad(f: Biquad, frame: Float64Array): void {
  const [r0, r1, r2, r3, r4] = f.coeffs as [Ramp, Ramp, Ramp, Ramp, Ramp];
  const b0 = advance(r0), b1 = advance(r1), b2 = advance(r2), a1 = advance(r3), a2 = advance(r4);
  const { z1, z2 } = f;
  for (let c = 0; c < frame.length; c++) {
    const x = frame[c]!, y = b0 * x + z1[c]!;
    z1[c] = b1 * x - a1 * y + z2[c]!;
    z2[c] = b2 * x - a2 * y;
    frame[c] = y;
  }
}
