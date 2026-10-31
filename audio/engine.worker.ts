/// <reference lib="webworker" />
// Offline engine in a Web Worker: decoding, analysis, 5-pass target renders and
// encoding never block the UI thread. The source and last render stay here so
// export re-encodes exactly what was measured.

import { intent, renderProposal, suggest, tonalProfile, withLoudnessTarget, type TonalProfile } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import {
  analyzeTrack, assertIntegrity, decodeWav, encodeWav, evaluateSafety, preflightWav, renderToTarget,
  type AudioData, type TrackMetrics,
} from '../lib/engine';
import type { AutoResult, EngineReply, EngineRequest, ExportResult, LoadResult, RenderResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let source: AudioData | null = null;
let sourceMetrics: TrackMetrics | null = null;
let rendered: { buffer: AudioData; metrics: TrackMetrics; state: ChainState } | null = null;
/** Tonal profile of the current source; computed on first Auto run. */
let spectrum: TonalProfile | null = null;

const reply = (message: EngineReply, transfer: Transferable[] = []) => self.postMessage(message, transfer);

async function handle(id: number, request: EngineRequest) {
  const onStatus = (message: string) => reply({ id, kind: 'status', message });
  const onProgress = (fraction: number) => reply({ id, kind: 'progress', fraction });

  if (request.type === 'load') {
    onStatus('Checking file...');
    await preflightWav(request.file);
    onStatus('Decoding...');
    const { buffer, metadata } = await decodeWav(await request.file.arrayBuffer(), { onProgress });
    onStatus('Analysing source...');
    const metrics = await analyzeTrack(buffer);
    source = buffer; sourceMetrics = metrics; rendered = null; spectrum = null;
    // The UI needs its own copy for playback; the worker keeps the original for rendering.
    const channels = buffer.channels.map(c => c.slice());
    const result: LoadResult = { metadata, sampleRate: buffer.sampleRate, channels, metrics };
    return reply({ id, kind: 'done', result }, channels.map(c => c.buffer));
  }

  if (!source || !sourceMetrics) throw Object.assign(new Error('Load a WAV first.'), { code: 'NO_SOURCE' });

  if (request.type === 'render') {
    const out = await renderToTarget(source, request.state, { sourceMetrics, onStatus, onProgress });
    rendered = { buffer: out.buffer, metrics: out.metrics, state: out.state };
    const safety = evaluateSafety(sourceMetrics, out.metrics, out.state, { stats: out.buffer.processingStats });
    const result: RenderResult = { state: out.state, metrics: out.metrics, targetResult: out.targetResult, safety };
    return reply({ id, kind: 'done', result });
  }

  if (request.type === 'auto') {
    onStatus('Auto: profiling tone...');
    spectrum ??= await tonalProfile(source);
    const options = request.loudnessTarget === null ? {} : { loudnessTarget: request.loudnessTarget };
    const proposal = intent(source, sourceMetrics, request.intention, spectrum, request.intensity, options);
    const out = await renderProposal(source, sourceMetrics, proposal, { renderSettings: request.renderSettings, onStatus, onProgress });
    rendered = { buffer: out.buffer, metrics: out.metrics, state: out.state };
    const result: AutoResult = {
      state: out.state, metrics: out.metrics, safety: out.safety!, notes: out.notes,
      targetResult: out.targetResult.requested === null ? null : (out.targetResult as RenderResult['targetResult']),
    };
    return reply({ id, kind: 'done', result });
  }

  if (request.type === 'preset') {
    onStatus(`Preset: ${request.style}...`);
    let proposal = suggest(source, sourceMetrics, request.style, request.intensity);
    if (request.loudnessTarget !== null) proposal = withLoudnessTarget(proposal, request.loudnessTarget);
    const out = await renderProposal(source, sourceMetrics, proposal, { renderSettings: request.renderSettings, onStatus, onProgress });
    rendered = { buffer: out.buffer, metrics: out.metrics, state: out.state };
    const result: AutoResult = {
      state: out.state, metrics: out.metrics, safety: out.safety!, notes: out.notes,
      targetResult: out.targetResult.requested === null ? null : (out.targetResult as RenderResult['targetResult']),
    };
    return reply({ id, kind: 'done', result });
  }

  if (!rendered) throw Object.assign(new Error('Render before exporting.'), { code: 'NO_RENDER' });
  // PCM formats add a clipping check the float render didn't need.
  const safety = assertIntegrity(evaluateSafety(sourceMetrics, rendered.metrics, rendered.state, { format: request.format, stats: rendered.buffer.processingStats }));
  onStatus('Encoding...');
  const bytes = await encodeWav(rendered.buffer, request.format, { dither: request.dither && request.format !== 'float32' });
  const result: ExportResult = { bytes, safety };
  reply({ id, kind: 'done', result }, [bytes]);
}

self.onmessage = async ({ data }: MessageEvent<{ id: number; request: EngineRequest }>) => {
  try {
    await handle(data.id, data.request);
  } catch (error) {
    const e = error as Error & { code?: string };
    reply({ id: data.id, kind: 'error', code: e.code ?? 'ENGINE_FAILED', message: e.message });
  }
};
