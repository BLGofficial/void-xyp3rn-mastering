// Public surface of the offline engine: WAV I/O, track analysis, rendering,
// peak protection, safety policy and loudness targeting. Behaviour is pinned by
// test/engine.parity.test.ts.

export { analyzeTrack } from './analyze';
export { BANDS, percentile } from './analysis';
export { EngineError } from './errors';
export { measureTruePeak, protectTruePeak, renderChain, verifyPeak } from './render';
export { assertIntegrity, evaluateSafety, SAFETY_DEFAULTS, safetyLimits } from './safety';
export { renderToTarget, TARGET_TOLERANCE_LU } from './target';
export type * from './types';
export { createBuffer, MAX_FILE_BYTES, MAX_SAMPLES, memoryPlan, preflightWav, parseWav, validateBuffer } from './wav';

import { coded } from './errors';
import { decodeWav as decodeImpl, encodeWav as encodeImpl } from './wav';

/** Decode 16/24/32-bit PCM or 32-bit float WAV to planar float32. Format errors keep their code. */
export const decodeWav = coded('DECODE_FAILED', decodeImpl, true);
/** Encode planar float32 to WAV. PCM formats refuse out-of-range samples rather than clip. */
export const encodeWav = coded('EXPORT_FAILED', encodeImpl);
