import { checkpoint, assertNotAborted } from './progress';
import { createMeter } from './stream';
import type { AudioBufferLike, LoudnessResult, MeterOptions, ProgressOptions } from './types';

const CHUNK = 16384;

function assertBuffer(b: AudioBufferLike): void {
  const ok = !!b && Number.isInteger(b.length) && b.length > 0 && Number.isInteger(b.numberOfChannels) &&
    b.numberOfChannels >= 1 && b.numberOfChannels <= 8 && Array.isArray(b.channels) && b.channels.length === b.numberOfChannels &&
    b.channels.every(c => c instanceof Float32Array && c.length === b.length);
  if (!ok) throw new Error('Invalid metering buffer.');
}

/** Run `step` for `frames` frames, with a cancellation point every CHUNK frames. */
async function pushChunked(frames: number, options: ProgressOptions, step: (i: number) => void) {
  for (let base = 0; base < frames; base += CHUNK) {
    await checkpoint(options);
    const end = Math.min(base + CHUNK, frames);
    for (let i = base; i < end; i++) step(i);
  }
}

/**
 * Meter a whole decoded file, yielding to the event loop every 16384 frames.
 * Appends 1.5 s of silence for LRA only (EBU Tech 3342 file-based measurement).
 */
export async function analyze(buffer: AudioBufferLike, options: MeterOptions & ProgressOptions = {}): Promise<LoudnessResult> {
  assertNotAborted(options.signal);
  assertBuffer(buffer);
  const { meter, truePeak, shortFrames } = createMeter(buffer.sampleRate, buffer.numberOfChannels, buffer.channelMask, options);
  const frame = new Float64Array(buffer.numberOfChannels);
  await pushChunked(buffer.length, options, i => {
    for (let c = 0; c < frame.length; c++) frame[c] = buffer.channels[c]![i]!;
    meter.push(frame);
  });
  truePeak?.finish();
  if (meter.supported && buffer.length >= shortFrames) {
    frame.fill(0);
    await pushChunked(Math.round(buffer.sampleRate * 1.5), options, () => meter.push(frame, true));
  }
  return meter.result(buffer.length);
}
