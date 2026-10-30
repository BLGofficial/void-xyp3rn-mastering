/**
 * Fixed per-frame alignment delay (lookahead / oversampler group delay).
 * @returns In-place frame delayer; a no-op when `latency` is 0.
 */
export function alignmentDelay(channels: number, latency: number): (frame: Float64Array) => void {
  if (!latency) return () => {};
  const lines = Array.from({ length: channels }, () => new Float64Array(latency));
  let cursor = 0;
  return frame => {
    for (let c = 0; c < frame.length; c++) {
      const line = lines[c]!, out = line[cursor]!;
      line[cursor] = frame[c]!;
      frame[c] = out;
    }
    cursor = (cursor + 1) % latency;
  };
}
