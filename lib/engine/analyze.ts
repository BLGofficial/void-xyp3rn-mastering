import { analyze as meterLoudness } from '../meter';
import { dynamicsAnalyzer, percentile, sourceQuality, spectral } from './analysis';
import { checkpoint, coded, requireValue } from './errors';
import { validateBuffer } from './wav';
import type { AudioData, EngineOptions, TrackMetrics } from './types';

const BLOCK = 32768;
const WAVEFORM_BINS = 2048;
/** Amplitude ratio in dB. */
export const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

async function analyzeImpl(buffer: AudioData, options: EngineOptions = {}): Promise<TrackMetrics> {
  validateBuffer(buffer);
  const { sampleRate: rate, numberOfChannels: n, channels: data, length } = buffer;
  const stereo = n === 2;
  const bins = Math.min(WAVEFORM_BINS, length);
  const waveform = data.map(() => ({ min: new Float32Array(bins).fill(Infinity), max: new Float32Array(bins).fill(-Infinity) }));
  const peaks = data.map(() => 0), squares = data.map(() => 0), sums = data.map(() => 0);
  const detailed = dynamicsAnalyzer(rate, n);
  const sections: number[] = [], transientCrests: number[] = [], correlationWindows: TrackMetrics['stereo']['correlationWindows'] = [];
  let positivePeak = 0, negativePeak = 0, cross = 0, overFullScale = 0;
  // 50 ms transient windows, 3 s sections, 400 ms stereo windows.
  const transientFrames = Math.round(rate * 0.05), sectionFrames = Math.max(1, Math.round(rate * 3)), stereoFrames = Math.max(1, Math.round(rate * 0.4));
  let transientPower = 0, transientPeak = 0, transientSamples = 0, sectionPower = 0, sectionSamples = 0;
  // First-order 120 Hz low-pass / 4 kHz high-pass split for coarse tonal balance and low-end stereo.
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * 120) / rate), highAlpha = 1 - Math.exp((-2 * Math.PI * Math.min(4000, rate * 0.4)) / rate);
  const spectralLow = new Float64Array(n), spectralHigh = new Float64Array(n);
  let lowPower = 0, highPower = 0, lowL = 0, lowR = 0, lowMid = 0, lowSide = 0;
  let windowL = 0, windowR = 0, windowCross = 0, stereoSamples = 0, negativeWindows = 0, activeWindows = 0;

  for (let base = 0; base < length; base += BLOCK) {
    await checkpoint(options);
    for (let i = base; i < Math.min(base + BLOCK, length); i++) {
      const bin = Math.min(bins - 1, Math.floor((i * bins) / length));
      for (let c = 0; c < n; c++) {
        const value = data[c]![i]!;
        requireValue(Number.isFinite(value), 'Audio contains a non-finite sample.');
        peaks[c] = Math.max(peaks[c]!, Math.abs(value));
        positivePeak = Math.max(positivePeak, value); negativePeak = Math.min(negativePeak, value);
        squares[c]! += value * value; sums[c]! += value; sectionPower += value * value;
        transientPower += value * value; transientPeak = Math.max(transientPeak, Math.abs(value));
        spectralLow[c]! += lowAlpha * (value - spectralLow[c]!); spectralHigh[c]! += highAlpha * (value - spectralHigh[c]!);
        lowPower += spectralLow[c]! ** 2; highPower += (value - spectralHigh[c]!) ** 2;
        if (Math.abs(value) > 1) overFullScale++;
        const w = waveform[c]!;
        w.min[bin] = Math.min(w.min[bin]!, value);
        w.max[bin] = Math.max(w.max[bin]!, value);
      }
      if (stereo) cross += data[0]![i]! * data[1]![i]!;
      detailed.push(data, i);
      if (++transientSamples === transientFrames) {
        const rms = Math.sqrt(transientPower / (transientSamples * n));
        if (rms > 1e-3) transientCrests.push(db(transientPeak / rms));
        transientPower = transientPeak = transientSamples = 0;
      }
      if (++sectionSamples === sectionFrames) {
        sections.push(db(Math.sqrt(sectionPower / (sectionSamples * n))));
        sectionPower = sectionSamples = 0;
      }
      if (stereo) {
        const l = data[0]![i]!, r = data[1]![i]!;
        windowL += l * l; windowR += r * r; windowCross += l * r;
        lowL += lowAlpha * (l - lowL); lowR += lowAlpha * (r - lowR);
        lowMid += ((lowL + lowR) / 2) ** 2; lowSide += ((lowL - lowR) / 2) ** 2;
        if (++stereoSamples === stereoFrames) {
          // Silent windows (~-57 dBFS mean power) carry no phase information.
          if ((windowL + windowR) / stereoSamples > 2e-6) {
            activeWindows++;
            if (windowCross < 0) negativeWindows++;
            correlationWindows.push({ seconds: (i + 1) / rate, value: windowL * windowR > 0 ? Math.max(-1, Math.min(1, windowCross / Math.sqrt(windowL * windowR))) : null });
          }
          windowL = windowR = windowCross = stereoSamples = 0;
        }
      }
    }
  }

  const peak = Math.max(...peaks);
  const rms = Math.sqrt(squares.reduce((a, b) => a + b, 0) / (length * n));
  const denominator = stereo ? Math.sqrt(squares[0]! * squares[1]!) : 0;
  // Sections within 20 dB of overall RMS and above -60 dBFS: musical contrast, not fades/silence.
  const activeSections = sections.filter(x => Number.isFinite(x) && x > -60 && x > db(rms) - 20).sort((a, b) => a - b);
  const mid = stereo ? Math.max(0, (squares[0]! + squares[1]! + 2 * cross) / 4) : null;
  const side = stereo ? Math.max(0, (squares[0]! + squares[1]! - 2 * cross) / 4) : null;
  transientCrests.sort((a, b) => a - b);
  const analysis = { ...detailed.result(), spectrum: await spectral(buffer, options) };
  const bandSpread = activeSections.length >= 4 ? percentile(activeSections, 0.9)! - percentile(activeSections, 0.1)! : null;

  const metrics: Omit<TrackMetrics, 'sourceQuality'> = {
    peak, positivePeak, negativePeak, rms, peakDbfs: db(peak), rmsDbfs: db(rms), crestDb: rms > 0 ? db(peak / rms) : null,
    dcOffset: sums.map(s => s / length),
    spectral: {
      lowFraction: rms > 0 ? lowPower / (rms * rms * length * n) : 0,
      highFraction: rms > 0 ? highPower / (rms * rms * length * n) : 0,
      method: 'First-order 120 Hz low-pass and 4 kHz high-pass power fractions; overlapping bands',
    },
    dynamics: {
      sectionSpreadDb: bandSpread, sectionCount: activeSections.length, sectionLevelsDb: sections,
      medianTransientCrestDb: transientCrests.length ? transientCrests[Math.floor(transientCrests.length / 2)]! : null,
      transientMethod: 'Median crest of active 50 ms windows; not musical onset detection',
      method: 'Non-overlapping 3 s RMS, gated P90-P10; not EBU LRA or musical intent detection',
    },
    stereo: {
      sideMidDb: mid! > 0 ? db(Math.sqrt(side! / mid!)) : null,
      monoLossDb: rms > 0 && mid !== null ? db(Math.sqrt(mid / (length * rms * rms))) : null,
      lowSideMidDb: lowMid > 0 ? db(Math.sqrt(lowSide / lowMid)) : lowSide > 0 ? Infinity : null,
      correlationWindows, negativeWindowPercent: activeWindows ? (100 * negativeWindows) / activeWindows : null,
    },
    channelPeaks: peaks, channelRms: squares.map(s => Math.sqrt(s / length)),
    correlation: denominator > 0 ? Math.max(-1, Math.min(1, cross / denominator)) : null,
    overFullScale, waveform, analysis,
    loudness: await meterLoudness(buffer, options),
  };
  // A peak guard that verified the render with the 16x check outranks the 4x meter estimate.
  if (buffer.peakGuard?.validation?.verified) metrics.loudness.truePeakDbtp = Math.max(metrics.loudness.truePeakDbtp as number, buffer.peakGuard.afterDbtp);
  return { ...metrics, sourceQuality: sourceQuality(metrics) };
}

/** Full track metrics: levels, dynamics, stereo, spectrum, loudness and source-quality flags. */
export const analyzeTrack = coded('ANALYSIS_FAILED', analyzeImpl);
