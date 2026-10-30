import type { ChainState } from '../dsp';
import type { AudioData, EngineOptions, SafetyResult, SourceQuality, TargetResult, TrackMetrics } from '../engine';

/** User-facing mastering intentions (a starting point, never a verdict). */
export type Intention = 'transparent' | 'balanced' | 'loud' | 'warm' | 'bright';
/** Internal treatment styles; each has a loudness reference it never forces. */
export type Style = 'natural' | 'warm' | 'punchy';
/** Shelf tilt in dB applied as low −tilt / high +tilt. */
export type Tone = 'warmer' | 'warm' | 'neutral' | 'bright' | 'brighter';
export type EqBand = 'lowDb' | 'midDb' | 'highDb';

/** Sampled tonal energy split (percent of total), first-pass descriptive only. */
export interface TonalProfile {
  windows: number;
  bassPct: number | null;
  lowMidPct: number | null;
  midPct: number | null;
  presencePct: number | null;
  highPct: number | null;
}

export interface EqDecision {
  module: string;
  parameter: EqBand;
  requestedDb: number;
  actualDb: number;
  reason: string;
  confidence: number;
}

export interface ConfidenceLevel {
  level: 'low' | 'medium' | 'high';
  score: number;
}

export interface ProposalConfidence {
  loudness: ConfidenceLevel;
  stereo: ConfidenceLevel;
  tone: ConfidenceLevel;
  harshness: ConfidenceLevel;
  method: string;
}

export interface Proposal {
  state: ChainState;
  style: Style;
  intensity: number;
  /** Style loudness reference in LUFS (not forced). */
  target: number;
  /** Limiter gain-reduction budget in dB. */
  budget: number;
  decision?: string;
  preset?: Intention;
  tone?: Tone;
  requestedLoudnessTarget?: number;
  eqLimits?: Record<EqBand, number>;
  confidence?: ProposalConfidence;
  eqDecisions?: EqDecision[];
  sourceQuality?: SourceQuality | null;
  transientProtection?: boolean;
  safety?: SafetyResult;
  safetyWarnings?: string[];
  macroProtection?: string;
}

export interface IntentOptions {
  tone?: Tone;
  /** Explicit final loudness goal, -24..-8 LUFS. */
  loudnessTarget?: number;
  /** Per-band ceilings for automatic broad EQ, 0..3 dB. */
  eqLimits?: Partial<Record<EqBand, number>>;
}

export interface RenderProposalOptions extends EngineOptions {
  tone?: Tone;
  eqLimits?: Partial<Record<EqBand, number>>;
  /** Take quality and output ceiling from the user's current settings. */
  renderSettings?: ChainState;
}

export type AutoTargetResult = (TargetResult | { requested: null; achieved: number | null; status: 'reference'; passes: 0 });

export interface AutoMaster extends Proposal {
  targetResult: AutoTargetResult;
  explanation: {
    schemaVersion: 1;
    summary: string;
    confidence?: ProposalConfidence;
    changes: unknown[];
    loudness: Record<string, unknown>;
    warnings: SafetyResult['warnings'];
  };
  buffer: AudioData;
  metrics: TrackMetrics;
  /** Plain-language account of every decision, for the user to accept or override. */
  notes: string[];
}

export interface ComparisonGains {
  original: number;
  rendered: number;
}
