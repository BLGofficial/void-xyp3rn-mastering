// Public surface of automatic mastering: deterministic, local, explainable
// proposals checked against source-aware safety. Pinned by test/auto.parity.test.ts.

export { tonalProfile } from './profile';
export {
  adapt, comparisonGains, decide, intent, INTENTIONS, safetyCodes, STYLE_REFERENCES, suggest, TONES, toneProposal, withLoudnessTarget,
} from './proposals';
export { master, renderProposal } from './render';
export type * from './types';
