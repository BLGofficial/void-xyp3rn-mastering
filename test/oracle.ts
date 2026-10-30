import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { ChainOptions, ChainState, Coefficients, FilterType, ProcessorDef, ProcessorId, ProcessorState } from '../lib/dsp';

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

export const ORACLE_DSP_VERSION = '0.11.0-dev.1';

const dir = fileURLToPath(new URL('../vendor/void-oracle/', import.meta.url));

/**
 * Load the pinned reference engine. Fails (never skips) when absent so a green
 * run always means parity was actually checked.
 */
export function loadOracle(): OracleDsp {
  if (!existsSync(`${dir}void-dsp.js`)) {
    throw new Error('Parity oracle missing: run `npm run oracle:fetch` first.');
  }
  return createRequire(import.meta.url)(`${dir}void-dsp.js`) as OracleDsp;
}
