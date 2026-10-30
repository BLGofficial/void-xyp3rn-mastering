// 4x polyphase oversampling around a hard clipper, so clipping harmonics above
// Nyquist are filtered before decimation instead of aliasing back down.

const TAPS = 257;
const FACTOR = 4;
const PHASE_TAPS = Math.ceil(TAPS / FACTOR); // 65: phase 0 carries the extra tap

/** Blackman-windowed sinc, cutoff 0.45 of the source rate, unity DC gain. */
const KERNEL = (() => {
  const h = new Float64Array(TAPS), middle = (TAPS - 1) / 2, cutoff = 0.45 / FACTOR;
  let sum = 0;
  for (let i = 0; i < TAPS; i++) {
    const x = i - middle;
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (TAPS - 1));
    h[i] = (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) * w;
    sum += h[i]!;
  }
  return h.map(v => v / sum);
})();

export interface OversampledClipper {
  /** Group delay in source-rate samples. */
  latency: number;
  /** Clip one frame in place at `ceiling` (linear) after `drive` (linear gain). */
  process(frame: Float64Array, drive: number, ceiling: number): void;
}

/** @returns A streaming 4x oversampled hard clipper. */
export function oversampledClipper(channels: number): OversampledClipper {
  // Doubled rings so each FIR window is a contiguous slice.
  const up = Array.from({ length: channels }, () => new Float64Array(PHASE_TAPS * 2));
  const down = Array.from({ length: channels }, () => new Float64Array(TAPS * 2));
  const out = new Float64Array(channels);
  let upCursor = 0, downCursor = 0;
  return {
    latency: (TAPS - 1) / FACTOR,
    process(frame, drive, ceiling) {
      for (let c = 0; c < channels; c++) up[c]![upCursor] = up[c]![upCursor + PHASE_TAPS] = frame[c]!;
      for (let phase = 0; phase < FACTOR; phase++) {
        for (let c = 0; c < channels; c++) {
          const u = up[c]!, d = down[c]!;
          // Zero-stuffed interpolation: only every FACTOR-th tap meets a real sample; xFACTOR restores gain.
          let s = 0;
          for (let tap = phase, k = 0; tap < TAPS; tap += FACTOR, k++) s += u[upCursor + k]! * KERNEL[tap]! * FACTOR;
          s = Math.max(-ceiling, Math.min(ceiling, s * drive));
          d[downCursor] = d[downCursor + TAPS] = s;
          // Decimate: only the phase-aligned output sample is needed.
          if (phase === 0) {
            let y = 0;
            for (let k = 0; k < TAPS; k++) y += d[downCursor + k]! * KERNEL[k]!;
            out[c] = y;
          }
        }
        downCursor = (downCursor + TAPS - 1) % TAPS;
      }
      upCursor = (upCursor + PHASE_TAPS - 1) % PHASE_TAPS;
      frame.set(out);
    },
  };
}
