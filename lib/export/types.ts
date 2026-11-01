import type { ChainState } from '../dsp';
import type { AudioData, PeakGuard, ProcessingStats, SafetyResult, TargetResult, TrackMetrics } from '../engine';
import type { PeakInspection } from '../meter';

export type Mp3Bitrate = 192 | 320;

/**
 * An MP3 encoder/decoder pair. In the browser: LAME in a Worker and the
 * platform decoder; in tests: a deterministic stand-in.
 */
export interface Mp3Codec {
  encode(buffer: AudioData, bitrate: Mp3Bitrate, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void }): Promise<Uint8Array>;
  /** `sampleRate` is the master's: platform decoders resample to their context rate. */
  decode(bytes: Uint8Array, options: { signal?: AbortSignal; sampleRate: number }): Promise<AudioData>;
}

/** Peak and loudness re-measurement of decoded audio; defaults to lib/engine in-thread. */
export interface Measurer {
  verifyPeak(audio: AudioData, ceilingDbtp: number, options: { signal?: AbortSignal }): Promise<PeakInspection>;
  analyze(audio: AudioData, options: { signal?: AbortSignal }): Promise<TrackMetrics>;
}

export interface CheckedMp3Options {
  bitrate?: Mp3Bitrate;
  /** Ceiling the decoded MP3 must hold (default 0 dBTP). */
  ceilingDbtp?: number;
  /** Loudness the decoded MP3 should land on; codec-only correction is at most ±1 dB per pass, ±3 dB total. */
  targetLufs?: number | null;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onProgress?: (fraction: number) => void;
  /** Where to measure decoded passes (e.g. the engine worker from the UI thread). */
  measure?: Measurer;
}

export interface CodecVerification extends PeakInspection {
  /** Gain applied to the master before the accepted encode, dB. */
  codecGainDb: number;
  codecAttenuationDb: number;
  passes: number;
  ceilingDbtp: number;
}

export interface CheckedMp3 {
  bytes: Uint8Array;
  /** Measured from the decoded MP3, not the PCM master. */
  metrics: TrackMetrics;
  decodedDuration: number;
  verification: CodecVerification;
}

export interface ZipEntry {
  /** Flat file name: no directories. */
  name: string;
  data: Blob | Uint8Array;
}

export interface MeasurementRow {
  label: string;
  unit: string;
  source: number | null;
  master: number | null;
  /** Master minus source; null unless both are finite. */
  delta: number | null;
  deltaUnit: string;
}

type Measured = Partial<Pick<TrackMetrics, 'peakDbfs' | 'rmsDbfs' | 'crestDb' | 'correlation'>> & {
  loudness?: Partial<TrackMetrics['loudness']>;
  dynamics?: Partial<TrackMetrics['dynamics']>;
  stereo?: Partial<TrackMetrics['stereo']>;
};

export interface ReportInput {
  track: string;
  /** ISO 8601. Also the ZIP entry timestamp. */
  date: string;
  audioFilename: string;
  format: string;
  dither: boolean;
  sampleRate: number;
  channels: number;
  sourceDuration: number;
  masterDuration: number;
  versions: Record<string, string>;
  source: Measured;
  /** Measured from the decoded exported file. */
  master: Measured;
  state: ChainState;
  safety: SafetyResult;
  explanation?: { loudness?: Partial<TargetResult> | null } | null;
  processingStats?: Partial<ProcessingStats> | null;
  peakGuard?: Partial<PeakGuard> | null;
  codecVerification?: Partial<CodecVerification> | null;
}

export interface Report {
  schemaVersion: 1;
  track: string;
  date: string;
  audioFilename: string;
  format: string;
  dither: boolean;
  sampleRate: number;
  channels: number;
  sourceDuration: number;
  masterDuration: number;
  versions: Record<string, string>;
  measurements: MeasurementRow[];
  target: Partial<TargetResult> | null;
  chain: ChainState;
  processingStats: Partial<ProcessingStats> | null;
  peakGuard: Partial<PeakGuard> | null;
  codecVerification: Partial<CodecVerification> | null;
  safety: SafetyResult;
  explanation: ReportInput['explanation'] | null;
  notes: string[];
  signOff: string;
}
