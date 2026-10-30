// Phase 1 contract. Every export below is a STUB that throws until the DSP core
// lands; test/dsp.parity.test.ts defines "done" (sample parity with the oracle).
// State shape matches the reference engine's chain JSON so presets interoperate.

export type ProcessorId = 'trim' | 'eq' | 'dynamics' | 'width' | 'clip' | 'reverb' | 'echo' | 'limit';
export type Quality = 'standard' | 'studio';
export type FilterType = 'low' | 'peak' | 'high';
/** Normalized biquad: [b0, b1, b2, a1, a2] with a0 divided out. */
export type Coefficients = [number, number, number, number, number];

export interface ParamDef {
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
}

export interface ProcessorDef {
  name: string;
  parameters: Record<string, ParamDef>;
}

export interface ProcessorState {
  id: ProcessorId;
  instanceId: string;
  moduleVersion?: string;
  version: 1;
  bypassed: boolean;
  parameters: Record<string, number>;
}

export interface LoudnessTarget {
  targetLufs: number;
  correctionDb: number;
}

export interface ChainState {
  schemaVersion: 1 | 2 | 3;
  engineVersion?: string;
  quality?: Quality;
  outputCeilingDbtp?: number | null;
  loudnessTarget?: LoudnessTarget;
  processors: ProcessorState[];
}

export interface ChainOptions {
  /** Offline renders have immutable settings; bypassed modules only keep alignment delay. */
  offline?: boolean;
}

const notImplemented = (what: string): never => {
  throw new Error(`lib/dsp: ${what} not implemented (phase 1 stub)`);
};

export const DEFINITIONS: Readonly<Record<ProcessorId, ProcessorDef>> = new Proxy({} as Record<ProcessorId, ProcessorDef>, {
  get: () => notImplemented('DEFINITIONS'),
  ownKeys: () => notImplemented('DEFINITIONS'),
});

/**
 * Default mastering chain: trim, eq, dynamics, width, clip, limit (dynamics/clip/limit bypassed).
 * @returns A fresh, validated schema-v3 chain state.
 */
export function defaultState(): ChainState {
  return notImplemented('defaultState');
}

/**
 * Build one processor state populated with parameter defaults.
 * @param id Processor kind.
 * @param instanceId Unique slot id within a chain (`[a-zA-Z0-9_-]{1,64}`).
 * @param bypassed Initial bypass flag.
 */
export function createState(id: ProcessorId, instanceId: string, bypassed = true): ProcessorState {
  return notImplemented(`createState(${id}, ${instanceId}, ${bypassed})`);
}

/**
 * Validate and normalize a chain state (migrates schema v1/v2 and legacy module versions).
 * @throws On unknown modules, out-of-range parameters, duplicate instances or unexpected fields.
 */
export function validateState(state: unknown): ChainState {
  return notImplemented(`validateState(${typeof state})`);
}

/**
 * RBJ audio-EQ-cookbook biquad coefficients. Shelves use slope S=1; frequency is clamped to 0.45·rate.
 * @returns Identity filter when `db === 0`.
 */
export function coefficients(type: FilterType, hz: number, db: number, q: number, rate: number): Coefficients {
  return notImplemented(`coefficients(${type}, ${hz}, ${db}, ${q}, ${rate})`);
}

/**
 * Seconds of reverb/delay tail to render after the source ends, capped at 8.
 */
export function tailSeconds(state: ChainState): number {
  return notImplemented(`tailSeconds(${state.processors.length})`);
}

/** Streaming processing graph used by both the AudioWorklet and offline export. */
export class Chain {
  /** Total alignment latency in samples (limiter lookahead, oversampler group delay). */
  readonly latency: number = 0;

  constructor(state: ChainState, sampleRate: number, channels: number, options: ChainOptions = {}) {
    notImplemented(`Chain(${state.processors.length}, ${sampleRate}, ${channels}, ${options.offline})`);
  }

  /** Apply new settings with 10 ms ramps. Graph topology must not change. */
  update(state: ChainState): void {
    notImplemented(`Chain.update(${state.processors.length})`);
  }

  /**
   * Process `length` frames. Missing input channels read as silence.
   * @throws On non-finite input or output beyond Float32 range.
   */
  processBlock(input: ArrayLike<number>[], output: Float32Array[] | Float64Array[], length: number): void {
    notImplemented(`Chain.processBlock(${input.length}, ${output.length}, ${length})`);
  }

  dispose(): void {
    notImplemented('Chain.dispose');
  }
}
