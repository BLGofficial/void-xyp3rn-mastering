import { truePeakDetector, type TruePeakDetector } from '../dsp/truepeak';
import { amplitudeToDb, gatedIntegrated, loudnessRange, powerToLufs } from './gating';
import { channelWeights, kWeighting, section } from './kweighting';
import type { HistoryPoint, LoudnessResult, MeterOptions, MeterReadings, StreamMeter } from './types';

const METHOD = 'BS.1770-4 K-weighting and gating; EBU Tech 3341 M/S, Tech 3342 LRA; 4x Annex 2 true-peak estimate';

/** Meter plus the internal handle `analyze` needs to flush the true-peak interpolator. */
export interface MeterHandle {
  meter: StreamMeter;
  truePeak: TruePeakDetector | null;
  shortFrames: number;
}

/** @internal Build a meter and expose its true-peak detector to the file analyzer. */
export function createMeter(rate: number, channels: number, mask = 0, options: MeterOptions = {}): MeterHandle {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new Error('Invalid metering context.');
  }
  const weights = channelWeights(channels, mask);
  // Gating needs exact 100 ms hops; an unusual rate is reported, never approximated.
  const supported = !!weights && rate % 10 === 0;
  const reason = !weights
    ? 'Loudness unavailable: speaker layout unknown or unsupported.'
    : rate % 10 !== 0 ? 'Loudness unavailable at this sample rate (no whole 100 ms hop).' : '';
  const [shelf, hp] = kWeighting(rate);
  const filters = Array.from({ length: channels }, () => [section(shelf), section(hp)] as const);
  const shortFrames = Math.round(3 * rate), momentFrames = Math.round(0.4 * rate), hop = rate / 10;
  const collect = options.collect !== false;
  const truePeak = options.truePeak === false ? null : truePeakDetector(channels);

  // Ring of per-frame weighted power; 3 s (short-term) and 0.4 s (momentary) windows are running sums over it.
  const energy = new Float64Array(shortFrames);
  let position = 0, samples = 0, shortSum = 0, momentSum = 0, maxMomentPower = 0, maxShortPower = 0;
  let momentaryLufs: number | null = null, shortTermLufs: number | null = null;
  const blocks: number[] = [], shortBlocks: number[] = [], history: HistoryPoint[] = [];
  const tpDb = () => (truePeak ? amplitudeToDb(truePeak.maximum()) : null);

  const meter: StreamMeter = {
    supported,
    reason,
    push(frame, tail = false) {
      if (truePeak && !tail) truePeak.push(frame);
      if (!supported) { samples++; return; }
      let power = 0;
      for (let c = 0; c < channels; c++) {
        const x = frame[c]!;
        if (!Number.isFinite(x)) throw new Error('Non-finite metering input.');
        const [pre, rlb] = filters[c]!;
        const y = rlb(pre(x));
        power += y * y * weights![c]!;
      }
      const oldMoment = (position + shortFrames - momentFrames) % shortFrames;
      momentSum += power - energy[oldMoment]!;
      shortSum += power - energy[position]!;
      energy[position] = power;
      position = (position + 1) % shortFrames;
      samples++;
      // Maxima scan every frame so a window peaking between 100 ms ticks isn't missed.
      if (!tail && samples >= momentFrames) maxMomentPower = Math.max(maxMomentPower, momentSum / momentFrames);
      if (!tail && samples >= shortFrames) maxShortPower = Math.max(maxShortPower, shortSum / shortFrames);
      if (samples % hop !== 0) return;
      // Running sums can dip fractionally below 0 from cancellation; clamp before log.
      momentaryLufs = samples >= momentFrames ? powerToLufs(Math.max(0, momentSum / momentFrames)) : null;
      shortTermLufs = samples >= shortFrames ? powerToLufs(Math.max(0, shortSum / shortFrames)) : null;
      if (!collect) return;
      if (!tail && samples >= momentFrames) blocks.push(Math.max(0, momentSum / momentFrames));
      if (samples >= shortFrames) shortBlocks.push(Math.max(0, shortSum / shortFrames));
      if (!tail) history.push({ time: samples / rate, momentaryLufs, shortTermLufs });
    },
    readings(): MeterReadings {
      return { momentaryLufs, shortTermLufs, truePeakDbtp: tpDb(), reason };
    },
    result(sourceLength = samples): LoudnessResult {
      const enoughM = supported && sourceLength >= momentFrames, enoughS = supported && sourceLength >= shortFrames;
      return {
        status: supported ? 'measured' : 'unsupported',
        reason,
        integratedLufs: enoughM ? gatedIntegrated(blocks) : null,
        maxMomentaryLufs: enoughM ? powerToLufs(maxMomentPower) : null,
        maxShortTermLufs: enoughS ? powerToLufs(maxShortPower) : null,
        loudnessRangeLu: enoughS ? loudnessRange(shortBlocks) : null,
        lraStable: sourceLength / rate >= 60,
        truePeakDbtp: tpDb(),
        channelTruePeakDbtp: truePeak ? Array.from(truePeak.peaks, amplitudeToDb) : [],
        history,
        method: METHOD,
      };
    },
  };
  return { meter, truePeak, shortFrames };
}

/** @returns A streaming momentary/short-term/integrated/LRA/true-peak meter. */
export const streamMeter = (rate: number, channels: number, mask = 0, options: MeterOptions = {}): StreamMeter =>
  createMeter(rate, channels, mask, options).meter;
