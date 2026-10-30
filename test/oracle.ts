import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ChainOptions, ChainState, Coefficients, FilterType, ProcessorDef, ProcessorId, ProcessorState } from '../lib/dsp';
import type { AudioBufferLike, Biquad5, LoudnessResult, MeterOptions, PeakInspection, ProgressOptions, StreamMeter } from '../lib/meter';

// Typed view of the reference engine. Only what parity tests touch.
export interface OracleChain {
  latency: number;
  update(state: ChainState): void;
  processBlock(input: ArrayLike<number>[], output: Float64Array[], length: number): void;
}
export interface OracleDsp {
  VERSION: string;
  DEFINITIONS: Record<ProcessorId, ProcessorDef>;
  createState(id: ProcessorId, instanceId: string, bypassed?: boolean): ProcessorState;
  defaultState(): ChainState;
  validateState(state: unknown): ChainState;
  coefficients(type: FilterType, hz: number, db: number, q: number, rate: number): Coefficients;
  tailSeconds(state: ChainState): number;
  Chain: new (state: ChainState, sampleRate: number, channels: number, options?: ChainOptions) => OracleChain;
}

export interface OracleTruePeak {
  peaks: Float64Array;
  push(frame: ArrayLike<number>): number;
  finish(): void;
  maximum(): number;
}
export interface OracleMeter {
  VERSION: string;
  kCoefficients(rate: number): [Biquad5, Biquad5];
  channelWeights(channels: number, mask?: number): number[] | null;
  gatedIntegrated(blocks: ArrayLike<number>): number;
  loudnessRange(shortTermPowers: number[]): number | null;
  TruePeak: new (channels: number) => OracleTruePeak;
  StreamMeter: new (rate: number, channels: number, mask?: number, options?: MeterOptions) => StreamMeter;
  analyze(buffer: AudioBufferLike, options?: MeterOptions & ProgressOptions): Promise<LoudnessResult>;
}
export interface OraclePeak {
  VERSION: string;
  inspect(buffer: AudioBufferLike, ceilingDbtp: number, options?: ProgressOptions): Promise<PeakInspection>;
}

export const ORACLE_DSP_VERSION = '0.11.0-dev.1';
export const ORACLE_METER_VERSION = '0.5.0-dev.1';
export const ORACLE_PEAK_VERSION = '1.0.0-alpha.1';

const dir = fileURLToPath(new URL('../vendor/void-oracle/', import.meta.url));

/**
 * Load one pinned reference module. Fails (never skips) when absent so a green
 * run always means parity was actually checked.
 */
function load<T>(file: string): T {
  if (!existsSync(`${dir}${file}`)) {
    throw new Error(`Parity oracle missing ${file}: run \`npm run oracle:fetch\` first.`);
  }
  return createRequire(import.meta.url)(`${dir}${file}`) as T;
}

export const loadOracle = () => load<OracleDsp>('void-dsp.js');
export const loadMeterOracle = () => load<OracleMeter>('void-meter.js');
export const loadPeakOracle = () => load<OraclePeak>('void-peak.js');
