// Realtime preview: the same lib/dsp Chain as the offline render, running on the
// audio thread. Carries a latency-aligned copy of the source so A/B switches land
// on the same musical moment, and meters both paths for a loudness-matched compare.

import { alignmentDelay } from '../../lib/dsp/delay';
import { Chain, type ChainState } from '../../lib/dsp';
import { streamMeter, type StreamMeter } from '../../lib/meter';
import { WORKLET_NAME, type WorkletEvent, type WorkletMessage } from '../protocol';

// AudioWorkletGlobalScope (not in TypeScript's DOM lib).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions: ProcessorOptions }) => AudioWorkletProcessor): void;

interface ProcessorOptions {
  channels: number;
  state: ChainState;
}

const METER_INTERVAL_S = 0.1;
// ~0.5 s glide: fast enough to follow sections, slow enough not to pump.
const MATCH_TIME_S = 0.5;
const MATCH_LIMIT_DB = 24;
/** Below this, loudness is noise floor, not programme; don't chase it. */
const MATCH_FLOOR_LUFS = -70;

/** Graph changes that a running Chain can't absorb with ramps. */
const topologyKey = (s: ChainState) =>
  JSON.stringify([s.quality, s.processors.map(p => [p.id, p.instanceId, p.id === 'limit' ? p.parameters.truePeak : 0])]);

class ChainProcessor extends AudioWorkletProcessor {
  private readonly channels: number;
  private chain: Chain | null = null;
  private topology = '';
  private alignDry: (frame: Float64Array) => void = () => {};
  private readonly wet: Float64Array;
  private readonly dry: Float64Array;
  private masterMeter!: StreamMeter;
  private sourceMeter!: StreamMeter;
  private listenToSource = false;
  private matchLoudness = true;
  private matchDb = 0;
  private sinceMeters = 0;

  constructor(options: { processorOptions: ProcessorOptions }) {
    super();
    this.channels = options.processorOptions.channels;
    this.wet = new Float64Array(this.channels);
    this.dry = new Float64Array(this.channels);
    this.resetMeters();
    this.applyState(options.processorOptions.state);
    this.port.onmessage = ({ data }: MessageEvent<WorkletMessage>) => {
      if (data.type === 'state') this.applyState(data.state);
      else if (data.type === 'source') this.listenToSource = data.enabled;
      else if (data.type === 'match') this.matchLoudness = data.enabled;
      else this.resetMeters();
    };
  }

  private post(event: WorkletEvent) {
    this.port.postMessage(event);
  }

  private resetMeters() {
    const mask = 0;
    this.masterMeter = streamMeter(sampleRate, this.channels, mask, { collect: false });
    this.sourceMeter = streamMeter(sampleRate, this.channels, mask, { collect: false });
  }

  private applyState(state: ChainState) {
    try {
      const key = topologyKey(state);
      if (this.chain && key === this.topology) {
        this.chain.update(state);
        return;
      }
      this.chain = new Chain(state, sampleRate, this.channels);
      this.topology = key;
      this.alignDry = alignmentDelay(this.channels, this.chain.latency);
    } catch (error) {
      this.post({ type: 'error', message: (error as Error).message });
    }
  }

  private updateMatch(frames: number) {
    const m = this.masterMeter.readings(), s = this.sourceMeter.readings();
    const pick = (r: typeof m) => r.shortTermLufs ?? r.momentaryLufs;
    const a = pick(m), b = pick(s);
    if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a < MATCH_FLOOR_LUFS || b < MATCH_FLOOR_LUFS) return;
    const target = Math.max(-MATCH_LIMIT_DB, Math.min(MATCH_LIMIT_DB, a - b));
    this.matchDb += (target - this.matchDb) * (1 - Math.exp(-frames / (sampleRate * MATCH_TIME_S)));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0], output = outputs[0]!;
    const frames = output[0]?.length ?? 128;
    if (!input || input.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    const sourceGain = this.matchLoudness ? 10 ** (this.matchDb / 20) : 1;
    let reduction = 0;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < this.channels; c++) this.wet[c] = this.dry[c] = input[c]?.[i] ?? 0;
      if (this.chain) {
        try {
          this.chain.processFrame(this.wet);
        } catch (error) {
          // Runaway gain: drop to the source rather than emit garbage.
          this.chain = null;
          this.post({ type: 'error', message: (error as Error).message });
          this.wet.set(this.dry);
        }
      }
      this.alignDry(this.dry);
      this.masterMeter.push(this.wet);
      this.sourceMeter.push(this.dry);
      for (let c = 0; c < output.length; c++) {
        output[c]![i] = this.listenToSource ? this.dry[c % this.channels]! * sourceGain : this.wet[c % this.channels]!;
      }
    }
    if (this.chain) {
      for (const m of this.chain.modules) if (m.state.id === 'dynamics' || m.state.id === 'limit') reduction += m.reductionDb;
    }
    this.updateMatch(frames);
    this.sinceMeters += frames;
    if (this.sinceMeters >= sampleRate * METER_INTERVAL_S) {
      this.sinceMeters = 0;
      this.post({ type: 'meters', meters: { master: this.masterMeter.readings(), source: this.sourceMeter.readings(), reductionDb: reduction, matchGainDb: this.matchLoudness ? this.matchDb : 0 } });
    }
    return true;
  }
}

registerProcessor(WORKLET_NAME, ChainProcessor as never);
