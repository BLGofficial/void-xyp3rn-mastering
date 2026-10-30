// Public surface of the mastering DSP core. Behaviour is pinned by
// test/dsp.parity.test.ts (sample parity with the reference engine).

export { coefficients, type Coefficients, type FilterType } from './biquad';
export { Chain, type ChainOptions } from './chain';
export {
  createState,
  defaultState,
  DEFINITIONS,
  MAX_PROCESSORS,
  STATE_ENGINE_VERSION,
  tailSeconds,
  validateState,
  type ChainState,
  type LoudnessTarget,
  type ParamDef,
  type ProcessorDef,
  type ProcessorId,
  type ProcessorState,
  type Quality,
} from './schema';
export { TRUE_PEAK_LATENCY, truePeakDetector, type TruePeakDetector } from './truepeak';
