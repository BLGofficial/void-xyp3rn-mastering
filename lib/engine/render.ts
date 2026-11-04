import { Chain, tailSeconds, truePeakDetector, type ChainState } from '../dsp';
import { inspectPeaks, type PeakInspection, type ProgressOptions } from '../meter';
import { db } from './analyze';
import { check, checkpoint, coded, fail, requireValue } from './errors';
import { createBuffer, validateBuffer } from './wav';
import type { AudioData, EngineOptions, PeakGuard, ProcessingStats } from './types';

const BLOCK = 32768;
// DSP is far heavier than copying; yield more often while rendering.
const RENDER_BLOCK = 8192;
const REDUCTION_BOUNDS_DB = [0.1, 1, 2, 3, 6];

/** 4x BS.1770 true peak of a whole buffer (interpolator flushed), dBTP. */
export async function measureTruePeak(buffer: AudioData, options: ProgressOptions = {}): Promise<number> {
  validateBuffer(buffer);
  const detector = truePeakDetector(buffer.numberOfChannels), frame = new Float64Array(buffer.numberOfChannels);
  for (let base = 0; base < buffer.length; base += BLOCK) {
    await checkpoint(options);
    for (let i = base; i < Math.min(base + BLOCK, buffer.length); i++) {
      for (let c = 0; c < frame.length; c++) {
        frame[c] = buffer.channels[c]![i]!;
        requireValue(Number.isFinite(frame[c]), 'Cannot measure non-finite audio samples.');
      }
      detector.push(frame);
    }
  }
  detector.finish();
  return db(detector.maximum());
}

/**
 * Whole-buffer attenuation (in place) so both the 4x meter and the 16x reconstruction sit
 * under `ceilingDbtp` with 0.05 dB margin. A static gain, not a dynamic limiter.
 * @throws EngineError `TRUE_PEAK_FAILED` if the result still exceeds the ceiling.
 */
export async function protectTruePeak(buffer: AudioData, ceilingDbtp: number, options: ProgressOptions & Pick<EngineOptions, 'onPhase'> = {}): Promise<PeakGuard> {
  requireValue(Number.isFinite(ceilingDbtp) && ceilingDbtp >= -12 && ceilingDbtp <= -0.1, 'Invalid output true-peak ceiling.');
  options.onPhase?.({ phase: 'peak' });
  const before = await measureTruePeak(buffer, options);
  const validation = await inspectPeaks(buffer, ceilingDbtp, options);
  const attenuationDb = Math.max(0, Math.max(before, validation.checkedPeakDbtp) - ceilingDbtp + 0.05);
  if (attenuationDb > 0) {
    const gain = 10 ** (-attenuationDb / 20);
    for (let base = 0; base < buffer.length; base += BLOCK) {
      await checkpoint(options);
      for (const channel of buffer.channels) for (let i = base; i < Math.min(base + BLOCK, buffer.length); i++) channel[i]! *= gain;
    }
  }
  const after = attenuationDb > 0 ? await measureTruePeak(buffer, options) : before;
  if (!(after <= ceilingDbtp + 0.001 || after === -Infinity)) fail('TRUE_PEAK_FAILED', 'Rendered true-peak check failed. Export was stopped.');
  // Linear gain scales reconstructed peaks and the skipped-block bounds alike,
  // so the 16x result is shifted rather than recomputed.
  return {
    beforeDbtp: Math.max(before, validation.checkedPeakDbtp),
    afterDbtp: Math.max(after, validation.checkedPeakDbtp - attenuationDb),
    meterBeforeDbtp: before, meterAfterDbtp: after, attenuationDb, ceilingDbtp,
    validation: { ...validation, verified: true, checkedPeakAfterDbtp: validation.checkedPeakDbtp - attenuationDb },
  };
}

async function verifyImpl(buffer: AudioData, ceilingDbtp = 0, options: ProgressOptions = {}): Promise<PeakInspection> {
  validateBuffer(buffer);
  if (!Number.isFinite(ceilingDbtp) || ceilingDbtp < -24 || ceilingDbtp > 0) fail('INVALID_TARGET', 'Peak verification target must be -24 to 0 dBTP.');
  return inspectPeaks(buffer, ceilingDbtp, options);
}
/** 16x reconstruction check against a -24..0 dBTP ceiling. */
export const verifyPeak = coded('EXPORT_VERIFICATION_FAILED', verifyImpl);

async function renderImpl(input: AudioData, state: ChainState, options: EngineOptions = {}): Promise<AudioData> {
  validateBuffer(input);
  check(options.signal);
  const channels = input.numberOfChannels;
  const chain = new Chain(state, input.sampleRate, channels, { offline: true });
  try {
    const tail = Math.ceil(tailSeconds(chain.state) * input.sampleRate);
    const output = createBuffer(input.sampleRate, channels, input.length + tail, input.channelMask);
    const frame = new Float64Array(channels);
    const limiters = chain.modules.filter(m => m.state.id === 'limit'), compressors = chain.modules.filter(m => m.state.id === 'dynamics');
    let maxLimiterReductionDb = 0, maxDynamicsReductionDb = 0, reductionSum = 0, reductionSamples = 0;
    const histogram = [0, 0, 0, 0, 0, 0];
    // Run `latency` extra frames so the lookahead flushes and output is time-aligned with input.
    const total = output.length + chain.latency;
    const telemetry = options.onBlock;
    options.onPhase?.({ phase: 'render' });
    for (let base = 0; base < total; base += RENDER_BLOCK) {
      await checkpoint(options);
      let energy = 0, counted = 0, peak = 0, blockReductionDb = 0;
      for (let i = base; i < Math.min(base + RENDER_BLOCK, total); i++) {
        for (let c = 0; c < channels; c++) frame[c] = i < input.length ? input.channels[c]![i]! : 0;
        chain.processFrame(frame);
        for (const l of limiters) maxLimiterReductionDb = Math.max(maxLimiterReductionDb, l.reductionDb);
        if (telemetry) {
          // Compressor and limiter reduce in series, so their dB add up.
          let frameReduction = 0;
          for (const m of limiters) frameReduction += m.reductionDb;
          for (const m of compressors) frameReduction += m.reductionDb;
          if (frameReduction > blockReductionDb) blockReductionDb = frameReduction;
        }
        if (i < input.length) {
          let totalReduction = 0;
          for (const comp of compressors) { maxDynamicsReductionDb = Math.max(maxDynamicsReductionDb, comp.reductionDb); totalReduction += comp.reductionDb; }
          reductionSum += totalReduction; reductionSamples++;
          const bin = REDUCTION_BOUNDS_DB.findIndex(x => totalReduction < x);
          histogram[bin < 0 ? 5 : bin]!++;
        }
        if (i >= chain.latency) {
          for (let c = 0; c < channels; c++) {
            output.channels[c]![i - chain.latency] = frame[c]!;
            if (telemetry) {
              energy += frame[c]! * frame[c]!;
              const a = Math.abs(frame[c]!);
              if (a > peak) peak = a;
            }
          }
          counted += channels;
        }
      }
      options.onProgress?.(Math.min(1, (base + RENDER_BLOCK) / total));
      telemetry?.({ rms: counted ? Math.sqrt(energy / counted) : 0, peak, reductionDb: blockReductionDb });
    }
    if (tail) {
      // 50 ms linear fade so a truncated effect tail never ends on a click.
      const fade = Math.min(tail, Math.round(input.sampleRate * 0.05));
      for (const ch of output.channels) for (let i = 0; i < fade; i++) ch[output.length - fade + i]! *= (fade - 1 - i) / fade;
    }
    if (chain.state.outputCeilingDbtp !== null && chain.state.outputCeilingDbtp !== undefined) {
      options.onStatus?.('Checking rendered true peak...');
      output.peakGuard = await protectTruePeak(output, chain.state.outputCeilingDbtp, options);
    }
    const stats: ProcessingStats = {
      maxLimiterReductionDb, maxDynamicsReductionDb,
      meanDynamicsReductionDb: reductionSamples ? reductionSum / reductionSamples : 0,
      reductionHistogram: { upperBoundsDb: [...REDUCTION_BOUNDS_DB, null], fractions: histogram.map(k => (reductionSamples ? k / reductionSamples : 0)) },
    };
    output.processingStats = stats;
    options.onRenderStats?.(stats);
    return output;
  } finally {
    chain.dispose();
  }
}

/** Offline render through a chain: latency-compensated, tail-flushed, peak-guarded when a ceiling is set. */
export const renderChain = coded('RENDER_FAILED', renderImpl);
