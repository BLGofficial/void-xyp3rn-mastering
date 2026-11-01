// Export orchestration on the UI thread: WAV straight from the engine worker,
// MP3 through LAME + a decoded-peak check, optionally bundled with the PDF report.

import { renderReportPages } from '../components/report/pages';
import { STATE_ENGINE_VERSION, type ChainState } from '../lib/dsp';
import type { AudioData, SafetyResult, TargetResult, TrackMetrics, WavFormat } from '../lib/engine';
import { assemblePdf, encodeCheckedMp3, reportModel, zip, type CodecVerification, type Mp3Bitrate } from '../lib/export';
import type { EngineCallbacks, EngineClient } from './engine-client';
import { browserMp3Codec } from './mp3/codec';
import type { MasterProvenance } from './protocol';

export type ExportFormat = WavFormat | 'mp3' | 'mp3-192';
export const isMp3 = (f: ExportFormat): f is 'mp3' | 'mp3-192' => f === 'mp3' || f === 'mp3-192';
const BITRATE: Record<'mp3' | 'mp3-192', Mp3Bitrate> = { mp3: 320, 'mp3-192': 192 };
export const REPORT_FILENAME = 'XYP3RN-Mastering-Report.pdf';
const APP_VERSION = '0.5.0';

export interface ExportRequest {
  format: ExportFormat;
  dither: boolean;
  /** Bundle the audio with the PDF report in a ZIP. */
  withReport: boolean;
  source: { fileName: string; metrics: TrackMetrics; sampleRate: number; channels: number; duration: number };
  /** The measured render being exported. */
  render: { state: ChainState; safety: SafetyResult; targetResult: TargetResult | null };
  ceilingDbtp: number;
  targetLufs: number | null;
}

export interface ExportFile { blob: Blob; filename: string }

export async function exportMaster(engine: EngineClient, req: ExportRequest, cb: EngineCallbacks = {}): Promise<ExportFile> {
  const base = req.source.fileName.replace(/\.[^.]+$/, '');
  const tag = req.targetLufs === null ? 'master' : `${req.targetLufs}LUFS`;
  const audioName = `${base}_XYP3RN_${tag}_${isMp3(req.format) ? `mp3-${BITRATE[req.format]}` : req.format}.${isMp3(req.format) ? 'mp3' : 'wav'}`;

  let audio: Blob, masterMetrics: TrackMetrics | null, provenance: MasterProvenance, codec: CodecVerification | null = null;
  if (isMp3(req.format)) {
    cb.onStatus?.('Preparing MP3...');
    const m = await engine.master(cb);
    const buffer: AudioData = { sampleRate: m.sampleRate, numberOfChannels: m.channels.length, length: m.channels[0]?.length ?? 0, duration: m.duration, channels: m.channels, channelMask: 0 };
    cb.onStatus?.(`Encoding MP3 ${BITRATE[req.format]} kbps...`);
    const checked = await encodeCheckedMp3(buffer, browserMp3Codec, {
      bitrate: BITRATE[req.format], ceilingDbtp: req.ceilingDbtp, targetLufs: req.targetLufs,
      measure: engine.measurer, onStatus: cb.onStatus, onProgress: cb.onProgress,
    });
    audio = new Blob([checked.bytes as BlobPart], { type: 'audio/mpeg' });
    masterMetrics = checked.metrics;
    provenance = { duration: checked.decodedDuration, processingStats: m.processingStats, peakGuard: m.peakGuard };
    codec = checked.verification;
  } else {
    const r = await engine.exportWav(req.format, req.dither, req.withReport, cb);
    audio = new Blob([r.bytes], { type: 'audio/wav' });
    masterMetrics = r.masterMetrics;
    provenance = r.provenance;
  }
  if (!req.withReport) return { blob: audio, filename: audioName };

  cb.onStatus?.('Writing report...');
  const date = new Date().toISOString();
  const report = reportModel({
    track: base,
    date,
    audioFilename: audioName,
    format: isMp3(req.format) ? `mp3 ${BITRATE[req.format]} kbps` : req.format,
    dither: req.dither && !isMp3(req.format) && req.format !== 'float32',
    sampleRate: req.source.sampleRate,
    channels: req.source.channels,
    sourceDuration: req.source.duration,
    masterDuration: masterMetrics ? provenance.duration : req.source.duration,
    versions: {
      'XYP3RN MASTERING': APP_VERSION,
      'chain schema': STATE_ENGINE_VERSION,
      ...(isMp3(req.format) ? { 'MP3 encoder': 'LAME via lamejs 1.2.1 (LGPL-3.0)' } : {}),
    },
    source: req.source.metrics,
    master: masterMetrics ?? {},
    state: req.render.state,
    safety: req.render.safety,
    explanation: { loudness: req.render.targetResult },
    processingStats: provenance.processingStats,
    peakGuard: provenance.peakGuard,
    codecVerification: codec,
  });
  const pdf = assemblePdf(await renderReportPages(report));
  cb.onStatus?.('Bundling...');
  const bundle = await zip([{ name: audioName, data: audio }, { name: REPORT_FILENAME, data: pdf }], date);
  return { blob: bundle, filename: `${base}_XYP3RN_${tag}_report.zip` };
}
