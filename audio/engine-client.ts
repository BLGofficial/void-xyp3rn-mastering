import type { Intention, Style } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import type { WavFormat } from '../lib/engine';
import type { AudioData, BlockTelemetry, EnginePhase, TrackMetrics } from '../lib/engine';
import { decodeCompressed, sniffFile } from './import';
import type { Measurer } from '../lib/export';
import type { PeakInspection } from '../lib/meter';
import type { AutoResult, EngineInbound, EngineReply, EngineRequest, ExportResult, LoadResult, MasterResult, PlainAudio, RenderResult } from './protocol';

export interface EngineCallbacks {
  onStatus?: (message: string) => void;
  onProgress?: (fraction: number) => void;
  /** Level, peak and gain reduction of the audio being rendered right now (renders, Auto, presets). */
  onBlock?: (block: BlockTelemetry) => void;
  /** Each engine stage as it starts. */
  onPhase?: (phase: EnginePhase) => void;
}

/** Error from the engine worker, carrying its machine-readable code. */
export class EngineFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface EngineClient {
  /** WAV is parsed in the worker; FLAC/MP3 are decoded by the platform first. */
  load(file: File, cb?: EngineCallbacks): Promise<LoadResult>;
  render(state: ChainState, cb?: EngineCallbacks): Promise<RenderResult>;
  /** Propose, render and safety-check an automatic master under the user's current output settings. */
  auto(intention: Intention, intensity: number | null, loudnessTarget: number | null, renderSettings: ChainState, cb?: EngineCallbacks): Promise<AutoResult>;
  /** Apply one of the reference engine's source-aware mastering styles. */
  preset(style: Style, intensity: number, loudnessTarget: number | null, renderSettings: ChainState, cb?: EngineCallbacks): Promise<AutoResult>;
  exportWav(format: WavFormat, dither: boolean, cb?: EngineCallbacks): Promise<ExportResult>;
  /** Float copy of the last render, for the MP3 encoder. */
  master(cb?: EngineCallbacks): Promise<MasterResult>;
  /** Peak/loudness re-measurement in the worker, so verifying a decoded MP3 never blocks the UI. */
  measurer: Measurer;
  /** Abort every in-flight request; each rejects with code CANCELLED. */
  cancel(): void;
  dispose(): void;
}

/** Copy (the caller keeps its audio) into a cloneable shape. */
const plain = (audio: AudioData): PlainAudio => ({ sampleRate: audio.sampleRate, channels: audio.channels.map(c => c.slice()) });

/** Promise RPC over the engine worker. One request at a time is the UI's contract. */
export function createEngineClient(): EngineClient {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void; cb?: EngineCallbacks }>();
  let nextId = 1;

  worker.onmessage = ({ data }: MessageEvent<EngineReply>) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.kind === 'status') p.cb?.onStatus?.(data.message);
    else if (data.kind === 'progress') p.cb?.onProgress?.(data.fraction);
    else if (data.kind === 'block') p.cb?.onBlock?.(data.block);
    else if (data.kind === 'phase') p.cb?.onPhase?.(data.phase);
    else {
      pending.delete(data.id);
      if (data.kind === 'done') p.resolve(data.result as never);
      else p.reject(new EngineFailure(data.code, data.message));
    }
  };
  worker.onerror = event => {
    for (const p of pending.values()) p.reject(new EngineFailure('WORKER_UNAVAILABLE', event.message || 'Engine worker failed to start.'));
    pending.clear();
  };

  const call = <T>(request: EngineRequest, cb?: EngineCallbacks) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: never) => void, reject, cb });
      worker.postMessage({ id, request } satisfies EngineInbound);
    });

  return {
    load: async (file, cb) => {
      cb?.onPhase?.({ phase: 'read' });
      if ((await sniffFile(file)) === 'wav') return call<LoadResult>({ type: 'load', file }, cb);
      cb?.onStatus?.('Decoding...');
      cb?.onPhase?.({ phase: 'decode' });
      const { audio, info } = await decodeCompressed(file);
      return call<LoadResult>({ type: 'load-pcm', audio, info }, cb);
    },
    render: (state, cb) => call<RenderResult>({ type: 'render', state }, cb),
    auto: (intention, intensity, loudnessTarget, renderSettings, cb) =>
      call<AutoResult>({ type: 'auto', intention, intensity, loudnessTarget, renderSettings }, cb),
    preset: (style, intensity, loudnessTarget, renderSettings, cb) =>
      call<AutoResult>({ type: 'preset', style, intensity, loudnessTarget, renderSettings }, cb),
    exportWav: (format, dither, cb) => call<ExportResult>({ type: 'export', format, dither }, cb),
    master: cb => call<MasterResult>({ type: 'master' }, cb),
    measurer: {
      verifyPeak: (audio, ceilingDbtp) => call<PeakInspection>({ type: 'verify-peak', audio: plain(audio), ceilingDbtp }),
      analyze: audio => call<TrackMetrics>({ type: 'analyze', audio: plain(audio) }),
    },
    cancel: () => { for (const id of pending.keys()) worker.postMessage({ cancel: id } satisfies EngineInbound); },
    dispose: () => worker.terminate(),
  };
}
