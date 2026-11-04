// Messages between the UI thread, the engine Web Worker and the AudioWorklet.
// Plain data only: everything here must survive structured cloning.

import type { Intention, Style } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import type { PeakGuard, ProcessingStats, SafetyResult, TargetResult, TrackMetrics, WavFormat } from '../lib/engine';
import type { SourceInfo } from '../lib/import';
import type { MeterReadings, PeakInspection } from '../lib/meter';

export type EngineRequest =
  | { type: 'load'; file: File }
  /** A FLAC/MP3 source the UI thread already decoded. */
  | { type: 'load-pcm'; audio: PlainAudio; info: SourceInfo }
  | { type: 'render'; state: ChainState }
  | { type: 'auto'; intention: Intention; intensity: number | null; loudnessTarget: number | null; renderSettings: ChainState }
  | { type: 'preset'; style: Style; intensity: number; loudnessTarget: number | null; renderSettings: ChainState }
  | { type: 'export'; format: WavFormat; dither: boolean }
  /** The last render as float audio, for encoders that live outside the worker (MP3). */
  | { type: 'master' }
  | { type: 'verify-peak'; audio: PlainAudio; ceilingDbtp: number }
  | { type: 'analyze'; audio: PlainAudio };

/** UI -> engine worker: a request, or a cancel for one still running. */
export type EngineInbound = { id: number; request: EngineRequest } | { cancel: number };

/** Audio that crosses the worker boundary. */
export interface PlainAudio {
  sampleRate: number;
  channels: Float32Array[];
}

/** What the report needs about how the rendered master was made. */
export interface MasterProvenance {
  duration: number;
  processingStats: ProcessingStats | null;
  peakGuard: PeakGuard | null;
}

export interface MasterResult extends PlainAudio, MasterProvenance {}

export interface LoadResult {
  metadata: SourceInfo;
  sampleRate: number;
  channels: Float32Array[];
  metrics: TrackMetrics;
}

export interface RenderResult {
  state: ChainState;
  metrics: TrackMetrics;
  targetResult: TargetResult | null;
  safety: SafetyResult;
}

/** An automatic master: rendered and measured like a manual render, plus its reasoning. */
export interface AutoResult extends RenderResult {
  notes: string[];
}

export interface ExportResult {
  bytes: ArrayBuffer;
  /** Safety re-checked for the chosen PCM format (overs would clip). */
  safety: SafetyResult;
  provenance: MasterProvenance;
}

export type EngineReply =
  | { id: number; kind: 'status'; message: string }
  | { id: number; kind: 'progress'; fraction: number }
  /** RMS of recently rendered audio, throttled; drives the render overlay. */
  | { id: number; kind: 'level'; rms: number }
  | { id: number; kind: 'done'; result: LoadResult | RenderResult | AutoResult | ExportResult | MasterResult | PeakInspection | TrackMetrics }
  | { id: number; kind: 'error'; code: string; message: string };

/** UI -> worklet. */
export type WorkletMessage =
  | { type: 'state'; state: ChainState }
  | { type: 'source'; enabled: boolean }
  | { type: 'match'; enabled: boolean }
  | { type: 'reset' };

export interface LiveMeters {
  master: MeterReadings;
  source: MeterReadings;
  /** Total compressor + limiter gain reduction on the last block, dB. */
  reductionDb: number;
  /** Gain currently applied to the source path for a loudness-matched comparison, dB. */
  matchGainDb: number;
}

/** worklet -> UI. */
export type WorkletEvent = { type: 'meters'; meters: LiveMeters } | { type: 'error'; message: string };

export const WORKLET_NAME = 'xyp3rn-chain';
export const WORKLET_URL = '/worklets/chain-processor.js';
