/// <reference lib="webworker" />
// Offline engine in a Web Worker: decoding, analysis, 5-pass target renders and
// encoding never block the UI thread. The source and last render stay here so
// export re-encodes exactly what was measured.

import { intent, renderProposal, suggest, tonalProfile, withLoudnessTarget, type TonalProfile } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import {
  analyzeTrack, assertIntegrity, createBuffer, decodeWav, encodeWav, evaluateSafety, preflightWav, renderToTarget, verifyPeak,
  type AudioData, type BlockTelemetry, type EnginePhase, type TrackMetrics,
} from '../lib/engine';
import type { SourceInfo } from '../lib/import';
import type {
  AutoResult, EngineInbound, EngineReply, EngineRequest, ExportResult, LoadResult, MasterProvenance, MasterResult, PlainAudio, RenderResult,
} from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let source: AudioData | null = null;
let sourceMetrics: TrackMetrics | null = null;
let rendered: { buffer: AudioData; metrics: TrackMetrics; state: ChainState } | null = null;
/** Tonal profile of the current source; computed on first Auto run. */
let spectrum: TonalProfile | null = null;

function fromPlain({ sampleRate, channels }: PlainAudio): AudioData {
  const buffer = createBuffer(sampleRate, channels.length, channels[0]?.length ?? 0);
  channels.forEach((c, i) => buffer.channels[i]!.set(c));
  return buffer;
}

const provenance = (b: AudioData): MasterProvenance => ({ duration: b.duration, processingStats: b.processingStats ?? null, peakGuard: b.peakGuard ?? null });

const reply = (message: EngineReply, transfer: Transferable[] = []) => self.postMessage(message, transfer);

/** Make decoded audio the current source: analyse it, reset renders, hand the UI a playback copy. */
async function adopt(id: number, buffer: AudioData, metadata: SourceInfo, onStatus: (m: string) => void) {
  onStatus('Analysing source...');
  const metrics = await analyzeTrack(buffer);
  source = buffer; sourceMetrics = metrics; rendered = null; spectrum = null;
  // The UI needs its own copy for playback; the worker keeps the original for rendering.
  const channels = buffer.channels.map(c => c.slice());
  const result: LoadResult = { metadata, sampleRate: buffer.sampleRate, channels, metrics };
  return reply({ id, kind: 'done', result }, channels.map(c => c.buffer));
}

async function handle(id: number, request: EngineRequest, signal: AbortSignal) {
  const onStatus = (message: string) => reply({ id, kind: 'status', message });
  const onProgress = (fraction: number) => reply({ id, kind: 'progress', fraction });
  // Renders run far faster than real time; ~30 messages/s is plenty for visuals. Peaks and
  // gain reduction are held across skipped blocks so a short hit is never dropped.
  let lastBlock = 0, heldPeak = 0, heldReduction = 0;
  const onBlock = (b: BlockTelemetry) => {
    heldPeak = Math.max(heldPeak, b.peak);
    heldReduction = Math.max(heldReduction, b.reductionDb);
    const now = performance.now();
    if (now - lastBlock < 33) return;
    lastBlock = now;
    reply({ id, kind: 'block', block: { rms: b.rms, peak: heldPeak, reductionDb: heldReduction } });
    heldPeak = 0; heldReduction = 0;
  };
  const onPhase = (phase: EnginePhase) => reply({ id, kind: 'phase', phase });

  if (request.type === 'load') {
    onStatus('Checking file...');
    await preflightWav(request.file);
    onStatus('Decoding...');
    const { buffer, metadata } = await decodeWav(await request.file.arrayBuffer(), { onProgress });
    return adopt(id, buffer, {
      container: 'wav', sampleRate: metadata.sampleRate, channels: metadata.channels, length: metadata.length, bitsPerSample: metadata.bitsPerSample,
      float: metadata.audioFormat === 3, lossy: false, bitrateKbps: null, channelMask: metadata.channelMask,
    }, onStatus);
  }
  if (request.type === 'load-pcm') return adopt(id, fromPlain(request.audio), request.info, onStatus);

  // Stateless measurements of audio the UI thread decoded (MP3 verification).
  if (request.type === 'verify-peak') return reply({ id, kind: 'done', result: await verifyPeak(fromPlain(request.audio), request.ceilingDbtp) });
  if (request.type === 'analyze') return reply({ id, kind: 'done', result: await analyzeTrack(fromPlain(request.audio)) });

  if (!source || !sourceMetrics) throw Object.assign(new Error('Load a WAV first.'), { code: 'NO_SOURCE' });

  if (request.type === 'render') {
    const out = await renderToTarget(source, request.state, { sourceMetrics, onStatus, onProgress, onBlock, onPhase, signal });
    rendered = { buffer: out.buffer, metrics: out.metrics, state: out.state };
    const safety = evaluateSafety(sourceMetrics, out.metrics, out.state, { stats: out.buffer.processingStats });
    const result: RenderResult = { state: out.state, metrics: out.metrics, targetResult: out.targetResult, safety };
    return reply({ id, kind: 'done', result });
  }

  if (request.type === 'auto') {
    onStatus('Auto: profiling tone...');
    onPhase({ phase: 'analyse' });
    spectrum ??= await tonalProfile(source, { signal });
    const options = request.loudnessTarget === null ? {} : { loudnessTarget: request.loudnessTarget };
    const proposal = intent(source, sourceMetrics, request.intention, spectrum, request.intensity, options);
    const out = await renderProposal(source, sourceMetrics, proposal, { renderSettings: request.renderSettings, onStatus, onProgress, onBlock, onPhase, signal });
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
    const out = await renderProposal(source, sourceMetrics, proposal, { renderSettings: request.renderSettings, onStatus, onProgress, onBlock, onPhase, signal });
    rendered = { buffer: out.buffer, metrics: out.metrics, state: out.state };
    const result: AutoResult = {
      state: out.state, metrics: out.metrics, safety: out.safety!, notes: out.notes,
      targetResult: out.targetResult.requested === null ? null : (out.targetResult as RenderResult['targetResult']),
    };
    return reply({ id, kind: 'done', result });
  }

  if (!rendered) throw Object.assign(new Error('Render before exporting.'), { code: 'NO_RENDER' });
  if (request.type === 'master') {
    const channels = rendered.buffer.channels.map(c => c.slice());
    const result: MasterResult = { sampleRate: rendered.buffer.sampleRate, channels, ...provenance(rendered.buffer) };
    return reply({ id, kind: 'done', result }, channels.map(c => c.buffer));
  }
  // PCM formats add a clipping check the float render didn't need.
  const safety = assertIntegrity(evaluateSafety(sourceMetrics, rendered.metrics, rendered.state, { format: request.format, stats: rendered.buffer.processingStats }));
  onStatus('Encoding...');
  const bytes = await encodeWav(rendered.buffer, request.format, { dither: request.dither && request.format !== 'float32', signal });
  const result: ExportResult = { bytes, safety, provenance: provenance(rendered.buffer) };
  reply({ id, kind: 'done', result }, [bytes]);
}

/** One controller per in-flight request; engine checkpoints yield, so a cancel lands mid-render. */
const inFlight = new Map<number, AbortController>();

self.onmessage = async ({ data }: MessageEvent<EngineInbound>) => {
  if ('cancel' in data) return inFlight.get(data.cancel)?.abort();
  const controller = new AbortController();
  inFlight.set(data.id, controller);
  try {
    await handle(data.id, data.request, controller.signal);
  } catch (error) {
    const e = error as Error & { code?: string };
    // lib/auto mirrors the reference's uncoded cancellation error; give the UI one code for it.
    const code = controller.signal.aborted ? 'CANCELLED' : e.code ?? 'ENGINE_FAILED';
    reply({ id: data.id, kind: 'error', code, message: code === 'CANCELLED' ? 'Operation cancelled.' : e.message });
  } finally {
    inFlight.delete(data.id);
  }
};
