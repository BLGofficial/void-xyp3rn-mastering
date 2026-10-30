// Linear parameter smoothing. Finite ramps land exactly on the target so
// neutral settings (0 dB, width 1, wet 0) become bit-exact again afterwards.

export interface Ramp {
  value: number;
  target: number;
  left: number;
  step: number;
}

/** @returns A ramp resting at `value`. */
export const ramp = (value: number): Ramp => ({ value, target: value, left: 0, step: 0 });

/**
 * Glide towards `value` over `samples` frames. Re-targeting to the current target is a no-op,
 * so repeated identical updates don't restart a glide.
 */
export function retarget(r: Ramp, value: number, samples: number): void {
  if (value === r.target) return;
  r.target = value;
  r.left = samples;
  r.step = (value - r.value) / Math.max(1, samples);
  if (!samples) r.value = value;
}

/** Advance one frame and return the smoothed value. */
export function advance(r: Ramp): number {
  if (r.left > 0) {
    r.value += r.step;
    if (--r.left === 0) r.value = r.target;
  }
  return r.value;
}
