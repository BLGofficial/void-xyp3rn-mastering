// ITU-R BS.1770-4 Annex 2: 4x oversampling interpolator, 4 phases x 12 taps.
// Phases 3 and 4 are the time-reversed 2 and 1 (the filter is symmetric).
const P0 = [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625,
  0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125];
const P1 = [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
  0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375];
const PHASES = [P0, P1, [...P1].reverse(), [...P0].reverse()];
const TAPS = 12;

export interface TruePeakDetector {
  /** Push one frame; returns the largest |sample or inter-sample estimate| across channels. */
  push(frame: ArrayLike<number>): number;
  /** Running maximum per channel since creation. */
  peaks: Float64Array;
  /** Flush the interpolator with silence so the final samples' inter-sample peaks are seen. */
  finish(): void;
  /** Largest peak across all channels so far (linear). */
  maximum(): number;
}

/** Latency of the interpolator as seen by a lookahead limiter (one full FIR span). */
export const TRUE_PEAK_LATENCY = TAPS;

/** @returns A streaming 4x true-peak detector for `channels` channels. */
export function truePeakDetector(channels: number): TruePeakDetector {
  // Doubled ring: history[cursor .. cursor+11] is always contiguous, newest first.
  const history = Array.from({ length: channels }, () => new Float64Array(TAPS * 2));
  const peaks = new Float64Array(channels);
  let cursor = 0;
  const push = (frame: ArrayLike<number>): number => {
    let framePeak = 0;
    for (let c = 0; c < channels; c++) {
      const ring = history[c]!, x = frame[c]!;
      if (!Number.isFinite(x)) throw new Error('Non-finite metering input.');
      ring[cursor] = ring[cursor + TAPS] = x;
      let peak = Math.abs(x);
      for (const phase of PHASES) {
        let v = 0;
        for (let k = 0; k < TAPS; k++) v += ring[cursor + k]! * phase[k]!;
        peak = Math.max(peak, Math.abs(v));
      }
      peaks[c] = Math.max(peaks[c]!, peak);
      framePeak = Math.max(framePeak, peak);
    }
    cursor = (cursor + TAPS - 1) % TAPS;
    return framePeak;
  };
  return {
    peaks,
    push,
    finish() {
      const zero = new Float64Array(channels);
      for (let i = 0; i < TAPS; i++) push(zero);
    },
    maximum: () => Math.max(...peaks),
  };
}
