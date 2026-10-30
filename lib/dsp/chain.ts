import { createProcessor, type Processor } from './processors';
import { advance, ramp, retarget } from './ramp';
import { validateState, type ChainState } from './schema';

export interface ChainOptions {
  /** Offline renders have immutable settings; bypassed modules only keep alignment delay. */
  offline?: boolean;
}

const FLOAT32_MAX = 3.4028234663852886e38;
const isSend = (p: Processor) => p.state.id === 'reverb' || p.state.id === 'echo';
const fail = (message: string): never => {
  throw new Error(message);
};

function assertContext(sampleRate: number, channels: number) {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 8) {
    fail('Invalid DSP context.');
  }
}

function assertWidthChannels(state: ChainState, channels: number) {
  if (channels > 2 && state.processors.some(p => p.id === 'width' && !p.bypassed && p.parameters.amount !== 1)) {
    fail('Stereo Width supports mono/stereo only. Bypass it for multichannel audio.');
  }
}

const assertFloat32 = (frame: Float64Array, message: string) => {
  for (let c = 0; c < frame.length; c++) if (!Number.isFinite(frame[c]) || Math.abs(frame[c]!) > FLOAT32_MAX) fail(message);
};

/** Streaming processing graph used by both the AudioWorklet and offline export. */
export class Chain {
  /** Total alignment latency in samples (limiter lookahead, oversampler group delay). */
  readonly latency: number;
  private current: ChainState;
  private readonly processors: Processor[];
  private readonly frame: Float64Array;
  private readonly sendInput: Float64Array;
  private readonly sendSum: Float64Array;
  private readonly targetGain;
  private disposed = false;

  constructor(state: ChainState, readonly sampleRate: number, readonly channels: number, private readonly options: ChainOptions = {}) {
    assertContext(sampleRate, channels);
    this.current = validateState(state);
    assertWidthChannels(this.current, channels);
    this.processors = this.current.processors.map(p => createProcessor(p, sampleRate, channels, this.current.quality ?? 'standard'));
    this.latency = this.processors.reduce((n, p) => n + p.latency, 0);
    this.frame = new Float64Array(channels);
    this.sendInput = new Float64Array(channels);
    this.sendSum = new Float64Array(channels);
    this.targetGain = ramp(10 ** ((this.current.loudnessTarget?.correctionDb ?? 0) / 20));
  }

  /** Apply new settings with 10 ms ramps. Graph topology, quality and limiter detector mode must not change. */
  update(state: ChainState): void {
    if (this.disposed) fail('Chain is disposed.');
    if (this.options.offline) fail('Offline chain settings are immutable. Create a new render for changed settings.');
    const next = validateState(state);
    assertWidthChannels(next, this.channels);
    if (next.quality !== this.current.quality) fail('Stop playback before changing processing quality.');
    const sameGraph = next.processors.length === this.processors.length &&
      next.processors.every((p, i) => p.id === this.processors[i]!.state.id && p.instanceId === this.processors[i]!.state.instanceId);
    if (!sameGraph) fail('Stop playback before changing graph order or modules.');
    // The true-peak detector changes latency, which can't be altered mid-stream.
    if (next.processors.some((p, i) => p.id === 'limit' && p.parameters.truePeak !== this.processors[i]!.state.parameters.truePeak)) {
      fail('Pause playback before changing limiter detection mode.');
    }
    this.current = next;
    next.processors.forEach((p, i) => this.processors[i]!.update(p));
    retarget(this.targetGain, 10 ** ((next.loudnessTarget?.correctionDb ?? 0) / 20), Math.max(1, Math.round(this.sampleRate * 0.01)));
  }

  /**
   * Process `length` frames. Missing input channels read as silence.
   * @throws On non-finite input or output beyond Float32 range.
   */
  processBlock(input: ArrayLike<number>[], output: Float32Array[] | Float64Array[], length: number): void {
    const frame = this.frame;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < this.channels; c++) frame[c] = input[c] ? input[c]![i]! : 0;
      this.processFrame(frame);
      for (let c = 0; c < this.channels; c++) output[c]![i] = frame[c]!;
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  /** Validated settings currently applied. */
  get state(): ChainState {
    return this.current;
  }

  /** Per-module view for metering (gain reduction of the last frame). */
  get modules(): ReadonlyArray<Pick<Processor, 'state' | 'reductionDb'>> {
    return this.processors;
  }

  /**
   * Process one interleaved frame in place (offline renderers drive frames directly).
   * @throws On non-finite input or output beyond Float32 range.
   */
  processFrame(frame: Float64Array): void {
    if (this.disposed) fail('Chain is disposed.');
    for (let c = 0; c < frame.length; c++) if (!Number.isFinite(frame[c])) fail('Non-finite DSP input.');
    const processors = this.processors, offline = this.options.offline === true;
    for (let i = 0; i < processors.length; i++) {
      if (isSend(processors[i]!)) {
        // Adjacent sends run in parallel off the same input; their returns are summed onto it.
        this.sendInput.set(frame);
        this.sendSum.set(frame);
        for (; i < processors.length && isSend(processors[i]!); i++) {
          frame.set(this.sendInput);
          processors[i]!.process(frame, offline);
          for (let c = 0; c < frame.length; c++) this.sendSum[c]! += frame[c]! - this.sendInput[c]!;
        }
        i--;
        frame.set(this.sendSum);
      } else processors[i]!.process(frame, offline);
      assertFloat32(frame, 'DSP output exceeds the Float32 range. Reduce input gain.');
    }
    const g = advance(this.targetGain);
    for (let c = 0; c < frame.length; c++) frame[c]! *= g;
    assertFloat32(frame, 'Final output gain exceeds Float32 range.');
  }
}
