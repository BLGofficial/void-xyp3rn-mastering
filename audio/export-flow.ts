// Export on the UI thread. A render becomes one prepared audio file (WAV straight
// from the engine worker, or MP3 through LAME + a decoded-peak check); the report
// bundle zips that exact file with a PDF measured from it.

import { renderReportPages } from '../components/report/pages';
import { STATE_ENGINE_VERSION, type ChainState } from '../lib/dsp';
import { decodeWav, type AudioData, type SafetyResult, type TargetResult, type TrackMetrics, type WavFormat } from '../lib/engine';
import { assemblePdf, encodeCheckedMp3, reportModel, zip, type CodecVerification, type Mp3Bitrate } from '../lib/export';
import type { EngineCallbacks, EngineClient } from './engine-client';
import { browserMp3Codec } from './mp3/codec';
import type { MasterProvenance } from './protocol';

export type ExportFormat = WavFormat | 'mp3' | 'mp3-192';
export const isMp3 = (f: ExportFormat): f is 'mp3' | 'mp3-192' => f === 'mp3' || f === 'mp3-192';
const BITRATE: Record<'mp3' | 'mp3-192', Mp3Bitrate> = { mp3: 320, 'mp3-192': 192 };
export const REPORT_FILENAME = 'XYP3RN-Mastering-Report.pdf';
const APP_VERSION = '0.5.0';

const baseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '');
const targetTag = (targetLufs: number | null) => (targetLufs === null ? 'master' : `${targetLufs}LUFS`);

export interface PrepareRequest {
  format: ExportFormat;
  dither: boolean;
  sourceFileName: string;
  ceilingDbtp: number;
  targetLufs: number | null;
  signal?: AbortSignal;
}

/** The deliverable audio for the current render, plus what the report needs about it. */
export interface PreparedAudio {
  blob: Blob;
  filename: string;
  format: ExportFormat;
  provenance: MasterProvenance;
  /** Measured from the decoded MP3; WAV is measured on demand for the report. */
  metrics: TrackMetrics | null;
  codecVerification: CodecVerification | null;
}

export async function prepareAudio(engine: EngineClient, req: PrepareRequest, cb: EngineCallbacks = {}): Promise<PreparedAudio> {
  const stem = `${baseName(req.sourceFileName)}_XYP3RN_${targetTag(req.targetLufs)}`;
  if (!isMp3(req.format)) {
    const r = await engine.exportWav(req.format, req.dither, cb);
    return {
      blob: new Blob([r.bytes], { type: 'audio/wav' }), filename: `${stem}_${req.format}.wav`, format: req.format,
      provenance: r.provenance, metrics: null, codecVerification: null,
    };
  }
  const bitrate = BITRATE[req.format];
  cb.onStatus?.('Preparing MP3...');
  const m = await engine.master(cb);
  const buffer: AudioData = {
    sampleRate: m.sampleRate, numberOfChannels: m.channels.length, length: m.channels[0]?.length ?? 0,
    duration: m.duration, channels: m.channels, channelMask: 0,
  };
  cb.onStatus?.(`Encoding MP3 ${bitrate} kbps...`);
  const checked = await encodeCheckedMp3(buffer, browserMp3Codec, {
    bitrate, ceilingDbtp: req.ceilingDbtp, targetLufs: req.targetLufs, signal: req.signal,
    measure: engine.measurer, onStatus: cb.onStatus, onProgress: cb.onProgress,
  });
  return {
    blob: new Blob([checked.bytes as BlobPart], { type: 'audio/mpeg' }), filename: `${stem}_mp3-${bitrate}.mp3`, format: req.format,
    provenance: { duration: checked.decodedDuration, processingStats: m.processingStats, peakGuard: m.peakGuard },
    metrics: checked.metrics, codecVerification: checked.verification,
  };
}

export interface ReportRequest {
  dither: boolean;
  targetLufs: number | null;
  source: { fileName: string; metrics: TrackMetrics; sampleRate: number; channels: number; duration: number };
  /** The measured render the audio was made from. */
  render: { state: ChainState; safety: SafetyResult; targetResult: TargetResult | null };
  signal?: AbortSignal;
}

export interface ExportFile { blob: Blob; filename: string }

/** ZIP of the prepared audio and a PDF report measured from that same file. */
export async function bundleReport(engine: EngineClient, audio: PreparedAudio, req: ReportRequest, cb: EngineCallbacks = {}): Promise<ExportFile> {
  let master = audio.metrics;
  if (!master) {
    cb.onStatus?.('Measuring the exported file...');
    const { buffer } = await decodeWav(await audio.blob.arrayBuffer());
    master = await engine.measurer.analyze(buffer, {});
  }
  cb.onStatus?.('Writing report...');
  const mp3 = isMp3(audio.format);
  const date = new Date().toISOString();
  const report = reportModel({
    track: baseName(req.source.fileName),
    date,
    audioFilename: audio.filename,
    format: mp3 ? `mp3 ${BITRATE[audio.format as 'mp3' | 'mp3-192']} kbps` : audio.format,
    dither: req.dither && (audio.format === 'pcm16' || audio.format === 'pcm24'),
    sampleRate: req.source.sampleRate,
    channels: req.source.channels,
    sourceDuration: req.source.duration,
    masterDuration: audio.provenance.duration,
    versions: {
      'XYP3RN MASTERING': APP_VERSION,
      'chain schema': STATE_ENGINE_VERSION,
      ...(mp3 ? { 'MP3 encoder': 'LAME via lamejs 1.2.1 (LGPL-3.0)' } : {}),
    },
    source: req.source.metrics,
    master,
    state: req.render.state,
    safety: req.render.safety,
    explanation: { loudness: req.render.targetResult },
    processingStats: audio.provenance.processingStats,
    peakGuard: audio.provenance.peakGuard,
    codecVerification: audio.codecVerification,
  });
  const pdf = assemblePdf(await renderReportPages(report, req.signal));
  cb.onStatus?.('Bundling...');
  const bundle = await zip([{ name: audio.filename, data: audio.blob }, { name: REPORT_FILENAME, data: pdf }], date, req.signal);
  return { blob: bundle, filename: `${baseName(req.source.fileName)}_XYP3RN_${targetTag(req.targetLufs)}_report.zip` };
}
