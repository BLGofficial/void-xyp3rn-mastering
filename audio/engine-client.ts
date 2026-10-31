import type { Intention, Style } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import type { WavFormat } from '../lib/engine';
import type { AutoResult, EngineReply, EngineRequest, ExportResult, LoadResult, RenderResult } from './protocol';

export interface EngineCallbacks {
  onStatus?: (message: string) => void;
  onProgress?: (fraction: number) => void;
}

/** Error from the engine worker, carrying its machine-readable code. */
export class EngineFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface EngineClient {
  load(file: File, cb?: EngineCallbacks): Promise<LoadResult>;
  render(state: ChainState, cb?: EngineCallbacks): Promise<RenderResult>;
  /** Propose, render and safety-check an automatic master under the user's current output settings. */
  auto(intention: Intention, intensity: number | null, loudnessTarget: number | null, renderSettings: ChainState, cb?: EngineCallbacks): Promise<AutoResult>;
  /** Apply one of the reference engine's source-aware mastering styles. */
  preset(style: Style, intensity: number, loudnessTarget: number | null, renderSettings: ChainState, cb?: EngineCallbacks): Promise<AutoResult>;
  exportWav(format: WavFormat, dither: boolean, cb?: EngineCallbacks): Promise<ExportResult>;
  dispose(): void;
}

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
      worker.postMessage({ id, request });
    });

  return {
    load: (file, cb) => call<LoadResult>({ type: 'load', file }, cb),
    render: (state, cb) => call<RenderResult>({ type: 'render', state }, cb),
    auto: (intention, intensity, loudnessTarget, renderSettings, cb) =>
      call<AutoResult>({ type: 'auto', intention, intensity, loudnessTarget, renderSettings }, cb),
    preset: (style, intensity, loudnessTarget, renderSettings, cb) =>
      call<AutoResult>({ type: 'preset', style, intensity, loudnessTarget, renderSettings }, cb),
    exportWav: (format, dither, cb) => call<ExportResult>({ type: 'export', format, dither }, cb),
    dispose: () => worker.terminate(),
  };
}
