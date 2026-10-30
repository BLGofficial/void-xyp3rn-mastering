import { biquad, coefficients, retargetBiquad, runBiquad, type Biquad, type Coefficients } from './biquad';
import { alignmentDelay } from './delay';
import { oversampledClipper } from './oversample';
import { advance, ramp, retarget, type Ramp } from './ramp';
import type { ProcessorId, ProcessorState, Quality } from './schema';
import { TRUE_PEAK_LATENCY, truePeakDetector } from './truepeak';

type Params = Record<string, number>;

/** DSP for one module. `run` sees ramped params; `dry` is the pre-module frame (kernels may realign it). */
interface Kernel {
  latency: number;
  run(frame: Float64Array, p: Params, dry: Float64Array): void;
  /** Called on settings changes, with target (not ramped) params. */
  retune?(p: Params, rampSamples: number): void;
  /** Offline + bypassed: keep only sample alignment. */
  align(frame: Float64Array): void;
}

interface Context {
  rate: number;
  channels: number;
  quality: Quality;
  initial: Params;
}

const dbToGain = (db: number) => 10 ** (db / 20);
const onePole = (seconds: number, rate: number) => 1 - Math.exp(-1 / (rate * seconds));
const NO_ALIGN = () => {};

const trim = (): Kernel => ({
  latency: 0,
  align: NO_ALIGN,
  run(frame, p) {
    const g = dbToGain(p.gainDb!);
    for (let c = 0; c < frame.length; c++) frame[c]! *= g;
  },
});

const eqCoefficients = (p: Params, rate: number): Coefficients[] => [
  coefficients('low', p.lowHz!, p.lowDb!, 1, rate),
  coefficients('peak', p.midHz!, p.midDb!, p.midQ!, rate),
  coefficients('high', p.highHz!, p.highDb!, 1, rate),
];

function eq({ rate, channels, initial }: Context): Kernel {
  // Coefficients (not params) are what glide, so the three bands stay stable mid-ramp.
  const filters: Biquad[] = eqCoefficients(initial, rate).map(c => biquad(channels, c));
  return {
    latency: 0,
    align: NO_ALIGN,
    run(frame) {
      for (const f of filters) runBiquad(f, frame);
    },
    retune(p, samples) {
      eqCoefficients(p, rate).forEach((c, i) => retargetBiquad(filters[i]!, c, samples));
    },
  };
}

const width = (): Kernel => ({
  latency: 0,
  align: NO_ALIGN,
  run(frame, p) {
    if (frame.length !== 2 || p.amount === 1) return;
    const mid = (frame[0]! + frame[1]!) * 0.5, side = (frame[0]! - frame[1]!) * 0.5 * p.amount!;
    frame[0] = mid + side;
    frame[1] = mid - side;
  },
});

function dynamics({ rate }: Context): Kernel {
  const rmsCoeff = onePole(0.005, rate), slowCoeff = onePole(0.2, rate);
  let power = 0, envelopeDb = 0, slowReductionDb = 0;
  return {
    latency: 0,
    align: NO_ALIGN,
    run(frame, p) {
      const hybrid = p.adaptive! >= 0.5;
      let peak = 0;
      for (let c = 0; c < frame.length; c++) peak = Math.max(peak, Math.abs(frame[c]!));
      power += rmsCoeff * (peak * peak - power);
      // Hybrid detector leans on 5 ms RMS so dense material isn't pumped by isolated peaks.
      const level = hybrid ? 0.35 * peak + 0.65 * Math.sqrt(power) : peak;
      const over = (level > 0 ? 20 * Math.log10(level) : -300) - p.thresholdDb!;
      const slope = 1 - 1 / p.ratio!, knee = p.kneeDb!;
      let reduction = 0;
      if (over > knee / 2) reduction = over * slope;
      else if (knee > 0 && over > -knee / 2) reduction = (slope * (over + knee / 2) ** 2) / (2 * knee);
      if (hybrid) reduction = Math.min(reduction, p.maxReductionDb!);
      // Sustained reduction lengthens release (up to 2x) to avoid audible pumping.
      slowReductionDb += slowCoeff * (envelopeDb - slowReductionDb);
      const releaseMs = hybrid ? p.releaseMs! * (0.6 + 1.4 * Math.min(1, slowReductionDb / Math.max(0.1, p.maxReductionDb!))) : p.releaseMs!;
      const k = Math.exp(-1 / ((rate * (reduction > envelopeDb ? p.attackMs! : releaseMs)) / 1000));
      envelopeDb = k * envelopeDb + (1 - k) * reduction;
      const g = dbToGain(p.makeupDb! - envelopeDb);
      for (let c = 0; c < frame.length; c++) frame[c]! *= g;
    },
  };
}

function clip({ channels, quality }: Context): Kernel {
  if (quality !== 'studio') {
    return {
      latency: 0,
      align: NO_ALIGN,
      run(frame, p) {
        const drive = dbToGain(p.driveDb!), ceiling = dbToGain(p.ceilingDb!);
        for (let c = 0; c < frame.length; c++) frame[c] = Math.max(-ceiling, Math.min(ceiling, frame[c]! * drive));
      },
    };
  }
  const os = oversampledClipper(channels), align = alignmentDelay(channels, os.latency);
  return {
    latency: os.latency,
    align,
    run(frame, p, dry) {
      os.process(frame, dbToGain(p.driveDb!), dbToGain(p.ceilingDb!));
      align(dry); // keep the bypass crossfade phase-aligned with the oversampler's group delay
    },
  };
}

/** Parallel send: Schroeder reverb (4 damped combs + 2 allpasses) or damped feedback delay. */
function effect(kind: 'reverb' | 'echo', { rate, channels }: Context): Kernel {
  const echoDamp = 1 - Math.exp((-2 * Math.PI * 6000) / rate);
  const combDamp = 1 - Math.exp((-2 * Math.PI * 5000) / rate);
  // Per-channel offsets decorrelate L/R.
  const lines = Array.from({ length: channels }, (_, c) => ({
    delay: new Float64Array(Math.ceil(rate * 1.01)),
    low: 0,
    combs: [0.0297, 0.0371, 0.0411, 0.0437].map(t => ({ data: new Float64Array(Math.round(rate * (t + c * 0.0013))), index: 0, low: 0 })),
    allpasses: [0.005, 0.0017].map(t => ({ data: new Float64Array(Math.max(1, Math.round(rate * (t + c * 0.0002)))), index: 0 })),
  }));
  let clock = 0;
  return {
    latency: 0,
    align: NO_ALIGN,
    run(frame, p) {
      const distance = (rate * (kind === 'echo' ? p.timeMs! : p.preDelayMs!)) / 1000;
      for (let c = 0; c < frame.length; c++) {
        const line = lines[c]!, size = line.delay.length, write = clock % size;
        const pos = (write - distance + size) % size, a = Math.floor(pos), f = pos - a;
        const delayed = distance < 1 ? frame[c]! : line.delay[a]! * (1 - f) + line.delay[(a + 1) % size]! * f;
        let wet = delayed;
        if (kind === 'echo') {
          line.low += echoDamp * (delayed - line.low);
          line.delay[write] = frame[c]! + line.low * p.feedback!;
        } else {
          line.delay[write] = frame[c]!;
          wet = 0;
          for (const comb of line.combs) {
            const v = comb.data[comb.index]!;
            comb.low += combDamp * (v - comb.low);
            // Feedback for a -60 dB decay over `decay` seconds.
            comb.data[comb.index] = delayed + comb.low * 0.001 ** (comb.data.length / (rate * p.decay!));
            comb.index = (comb.index + 1) % comb.data.length;
            wet += v * 0.25;
          }
          for (const ap of line.allpasses) {
            const v = ap.data[ap.index]!, out = v - 0.5 * wet;
            ap.data[ap.index] = wet + 0.5 * out;
            ap.index = (ap.index + 1) % ap.data.length;
            wet = out;
          }
        }
        frame[c]! += wet * p.amount!;
      }
      clock++;
    },
  };
}

/** Lookahead brickwall: running max over the lookahead window, instant attack, exponential release. */
function limit({ rate, channels, initial }: Context): Kernel {
  const tp = initial.truePeak === 1 ? truePeakDetector(channels) : null;
  const latency = Math.max(1, Math.round(rate * 0.005)) + (tp ? TRUE_PEAK_LATENCY : 0);
  const align = alignmentDelay(channels, latency);
  // Monotonic deque of (peak, time) over the last `latency` frames.
  const size = latency + 2, peaks = new Float64Array(size), times = new Float64Array(size);
  let head = 0, tail = 0, now = 0, gain = 1;
  return {
    latency,
    align,
    run(frame, p, dry) {
      let peak = 0;
      for (let c = 0; c < frame.length; c++) peak = Math.max(peak, Math.abs(frame[c]!));
      if (tp) peak = Math.max(peak, tp.push(frame));
      const oldest = now - latency;
      while (head !== tail && times[head]! < oldest) head = (head + 1) % size;
      while (head !== tail && peaks[(tail + size - 1) % size]! <= peak) tail = (tail + size - 1) % size;
      peaks[tail] = peak;
      times[tail] = now++;
      tail = (tail + 1) % size;
      const max = peaks[head]!;
      // True-peak mode keeps 0.15 dB extra margin for interpolator error.
      const target = max > 0 ? Math.min(1, dbToGain(p.ceilingDb! - (tp ? 0.15 : 0)) / max) : 1;
      const release = Math.exp(-1 / ((rate * p.releaseMs!) / 1000));
      gain = target < gain ? target : target + release * (gain - target);
      align(frame);
      dry.set(frame);
      for (let c = 0; c < frame.length; c++) frame[c]! *= gain;
    },
  };
}

const KERNELS: Record<ProcessorId, (ctx: Context) => Kernel> = {
  trim, eq, width, dynamics, clip, limit,
  reverb: ctx => effect('reverb', ctx),
  echo: ctx => effect('echo', ctx),
};

export interface Processor {
  readonly state: ProcessorState;
  readonly latency: number;
  update(state: ProcessorState): void;
  process(frame: Float64Array, offline: boolean): void;
}

/**
 * Wrap a kernel with parameter/bypass smoothing (10 ms) and an exact wet/dry crossfade.
 * @param state Validated processor state.
 */
export function createProcessor(state: ProcessorState, rate: number, channels: number, quality: Quality): Processor {
  const rampSamples = Math.max(1, Math.round(rate * 0.01));
  const kernel = KERNELS[state.id]({ rate, channels, quality, initial: state.parameters });
  const keys = Object.keys(state.parameters);
  const ramps: Record<string, Ramp> = Object.fromEntries(keys.map(k => [k, ramp(state.parameters[k]!)]));
  const values: Params = { ...state.parameters };
  const wet = ramp(state.bypassed ? 0 : 1);
  const dry = new Float64Array(channels);
  let current = state;

  return {
    get state() {
      return current;
    },
    latency: kernel.latency,
    update(next) {
      current = next;
      retarget(wet, next.bypassed ? 0 : 1, rampSamples);
      for (const k of keys) retarget(ramps[k]!, next.parameters[k]!, rampSamples);
      kernel.retune?.(next.parameters, rampSamples);
    },
    process(frame, offline) {
      // Offline settings can't change, so a bypassed module's DSP is unreachable; realtime keeps it warm.
      if (offline && current.bypassed) return kernel.align(frame);
      for (const k of keys) values[k] = advance(ramps[k]!);
      const w = advance(wet);
      dry.set(frame);
      kernel.run(frame, values, dry);
      // Exact endpoints matter: wet/dry arithmetic at 0 or 1 would leave cancellation error.
      if (w === 0) frame.set(dry);
      else if (w !== 1) for (let c = 0; c < frame.length; c++) frame[c] = dry[c]! + w * (frame[c]! - dry[c]!);
    },
  };
}
