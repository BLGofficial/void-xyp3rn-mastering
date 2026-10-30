// Public surface of the loudness / peak metering layer. Behaviour is pinned by
// test/meter.parity.test.ts (oracle parity plus BS.1770 / EBU conformance).

export { analyze } from './analyze';
export { ABSOLUTE_GATE, gatedIntegrated, loudnessRange, powerToLufs } from './gating';
export { channelWeights, kWeighting } from './kweighting';
export { inspectPeaks } from './peak';
export { streamMeter } from './stream';
export type * from './types';
