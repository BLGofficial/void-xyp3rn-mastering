// Public meter types.

export type { Biquad5 } from './kweighting';

export interface MeterOptions {
  /** Keep gating blocks and the 100 ms history (needed for integrated LUFS / LRA). Default true. */
  collect?: boolean;
  /** Run the 4x true-peak detector. Default true. */
  truePeak?: boolean;
}

export interface MeterReadings {
  momentaryLufs: number | null;
  shortTermLufs: number | null;
  truePeakDbtp: number | null;
  /** Empty when measurable; otherwise why loudness is unavailable. */
  reason: string;
}

export interface HistoryPoint {
  time: number;
  momentaryLufs: number | null;
  shortTermLufs: number | null;
}

export interface LoudnessResult {
  status: 'measured' | 'unsupported';
  reason: string;
  integratedLufs: number | null;
  maxMomentaryLufs: number | null;
  maxShortTermLufs: number | null;
  loudnessRangeLu: number | null;
  /** EBU Tech 3342 LRA needs >= 60 s of programme to be stable. */
  lraStable: boolean;
  truePeakDbtp: number | null;
  channelTruePeakDbtp: number[];
  history: HistoryPoint[];
  method: string;
}

export interface StreamMeter {
  readonly supported: boolean;
  readonly reason: string;
  /** Push one frame. `tail` frames (appended silence) feed LRA only, never LUFS-I, maxima or true-peak. */
  push(frame: ArrayLike<number>, tail?: boolean): void;
  readings(): MeterReadings;
  result(sourceLength?: number): LoudnessResult;
}

export interface AudioBufferLike {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  channels: Float32Array[];
  /** WAVE_FORMAT_EXTENSIBLE speaker mask; 0 = default mono/stereo layout. */
  channelMask?: number;
}

export interface ProgressOptions {
  signal?: AbortSignal;
  onHeartbeat?: () => void;
  onStatus?: (message: string) => void;
}

export interface PeakInspection {
  maximumChecked: number;
  samplePeakDbfs: number;
  checkedPeakDbtp: number;
  verified: boolean;
  checkedBlocks: number;
  skippedBlocks: number;
  /** L1 norm bound used to skip blocks that provably cannot exceed the ceiling. */
  quietBlockBound: number;
  method: string;
}
