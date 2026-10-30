// Public engine types: decoded audio, WAV metadata, track metrics, safety, targeting.

import type { ChainState } from '../dsp';
import type { AudioBufferLike, LoudnessResult, PeakInspection, ProgressOptions } from '../meter';

/** Decoded, planar float32 audio. Render outputs may carry peak-guard and processing stats. */
export interface AudioData extends AudioBufferLike {
  duration: number;
  channelMask: number;
  peakGuard?: PeakGuard;
  processingStats?: ProcessingStats;
}

export interface EngineOptions extends ProgressOptions {
  onProgress?: (fraction: number) => void;
  onStatus?: (message: string) => void;
  /** Called once per render with gain-reduction statistics. */
  onRenderStats?: (stats: ProcessingStats) => void;
  /** Working-memory budget in bytes; defaults from device memory (0.5-4 GiB). */
  budgetBytes?: number;
  /** navigator.deviceMemory override, GiB. */
  deviceMemory?: number;
}

export type WavFormat = 'float32' | 'pcm16' | 'pcm24';

export interface EncodeOptions extends ProgressOptions {
  /** TPDF dither at the final PCM quantization step. */
  dither?: boolean;
  /** uint32 seed for reproducible dither; Math.random when omitted. */
  ditherSeed?: number;
}

export interface WavInfo {
  /** 1 = integer PCM, 3 = IEEE float (extensible subformats resolved). */
  audioFormat: 1 | 3;
  channels: number;
  sampleRate: number;
  bitsPerSample: 16 | 24 | 32;
  blockAlign: number;
  channelMask: number;
  /** Byte offset and size of the data chunk payload. */
  offset: number;
  size: number;
  length: number;
  /** Only bounded genre/date INFO tags are read; identity tags are ignored. */
  tags: { genre?: string; recorded?: string };
}

export interface MemoryPlan {
  fileBytes: number;
  duration: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  decodedBytes: number;
  encodedBytes: number;
  workingBytes: number;
  renderBytes: number;
  estimatedBytes: number;
  budgetBytes: number;
}

export interface ProcessingStats {
  maxLimiterReductionDb: number;
  maxDynamicsReductionDb: number;
  meanDynamicsReductionDb: number;
  reductionHistogram: { upperBoundsDb: (number | null)[]; fractions: number[] };
}

export interface PeakGuard {
  beforeDbtp: number;
  afterDbtp: number;
  meterBeforeDbtp: number;
  meterAfterDbtp: number;
  attenuationDb: number;
  ceilingDbtp: number;
  validation: PeakInspection & { checkedPeakAfterDbtp: number };
}

export interface LevelSummary {
  windows: number;
  activeWindows: number;
  spreadDb: number | null;
  medianDb: number | null;
  confidence: 'low' | 'medium';
}

export interface SpectrumBand {
  lowHz: number;
  highHz: number;
  coverage: number;
  fraction: number | null;
  correlation: number | null;
  sideMidDb: number | null;
  monoLossDb: number | null;
}

export interface Spectrum {
  schemaVersion: 1;
  windows: number;
  fftSize: number;
  resolutionHz: number;
  sampledSeconds: number;
  channelsAnalyzed: number;
  bands: Record<string, SpectrumBand>;
  highFrequency: {
    densityFraction: number;
    sibilanceProminenceDb: number;
    sibilanceRisk: 'unavailable' | 'elevated' | 'not-detected';
    harshnessRisk: 'elevated' | 'not-detected';
    confidence: 'low';
    method: string;
  };
  confidence: 'low' | 'medium';
  method: string;
}

export interface DetailedAnalysis {
  schemaVersion: 1;
  dynamics: {
    micro: { windowMs: 10; crestMedianDb: number | null; crestP90Db: number | null; onsets: number; onsetsPerSecond: number; transientHeavy: boolean; method: string };
    meso: LevelSummary & { windowSeconds: 1 };
    macro: LevelSummary & { windowSeconds: 15 };
    monoTransientCrestDb: number | null;
  };
  integrity: { finite: true; subnormalSamples: number; pathologicalSamples: number; nearCeilingFraction: number; plateauFraction: number };
  dualMono: boolean;
  spectrum: Spectrum;
}

export interface SourceQuality {
  flags: string[];
  likelyAlreadyMastered: boolean;
  confidence: 'low' | 'medium';
  recommendation: 'transparent' | 'source-aware';
  note: string;
}

export interface TrackMetrics {
  peak: number;
  positivePeak: number;
  negativePeak: number;
  rms: number;
  peakDbfs: number;
  rmsDbfs: number;
  crestDb: number | null;
  dcOffset: number[];
  spectral: { lowFraction: number; highFraction: number; method: string };
  dynamics: { sectionSpreadDb: number | null; sectionCount: number; sectionLevelsDb: number[]; medianTransientCrestDb: number | null; transientMethod: string; method: string };
  stereo: { sideMidDb: number | null; monoLossDb: number | null; lowSideMidDb: number | null; correlationWindows: { seconds: number; value: number | null }[]; negativeWindowPercent: number | null };
  channelPeaks: number[];
  channelRms: number[];
  correlation: number | null;
  overFullScale: number;
  waveform: { min: Float32Array; max: Float32Array }[];
  analysis: DetailedAnalysis;
  loudness: LoudnessResult;
  sourceQuality: SourceQuality;
}

export type SafetyLimitKey =
  | 'peakToleranceDb' | 'sectionLossDb' | 'transientLossDb' | 'monoLossDb' | 'correlationDrop'
  | 'negativeWindowIncrease' | 'eqLowDb' | 'eqMidDb' | 'eqHighDb' | 'maximumAutoLufs';
export type SafetyLimits = Record<SafetyLimitKey, number>;

export interface SafetyWarning {
  severity: 'warning' | 'critical';
  code: string;
  recommendedAction: string;
  confidence: number;
  /** True when the processing introduced or worsened the issue (vs. inherited from the source). */
  introduced: boolean;
  [detail: string]: unknown;
}

export interface SafetyResult {
  schemaVersion: 1;
  decision: 'pass' | 'backoff' | 'fail';
  critical: boolean;
  warnings: SafetyWarning[];
  confidenceMethod: string;
  overrideAllowed: boolean;
}

export interface SafetyOptions {
  limits?: Partial<SafetyLimits>;
  format?: WavFormat;
  stats?: Partial<ProcessingStats>;
  /** Limiter gain-reduction budget in dB (default 4). */
  limiterBudget?: number;
}

export interface TargetDiagnostic {
  requested_target_lufs: number;
  candidate_lufs: number | null;
  correction_db: number;
  post_correction_lufs: number | null;
  error_lu: number;
  true_peak: number | null;
  safety_attenuation_db: number;
  iteration_count: number;
}

export interface TargetResult {
  requested: number;
  achieved: number | null;
  differenceLu: number | null;
  status: 'reached' | 'limited' | 'unavailable';
  targetReached: boolean;
  safetyLimited: boolean;
  passes: number;
  correctionDb: number;
  candidateLufs: number | null;
  toleranceLu: number;
  diagnostics: TargetDiagnostic[];
  reason: string;
}

export interface TargetOptions extends EngineOptions {
  /** Metrics of the untouched source, for the safety gate's "introduced" judgements. */
  sourceMetrics?: Partial<TrackMetrics>;
}

export interface TargetRender {
  state: ChainState;
  buffer: AudioData;
  metrics: TrackMetrics;
  targetResult: TargetResult | null;
}
