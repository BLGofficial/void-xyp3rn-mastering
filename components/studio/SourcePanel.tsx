'use client';

import { useState } from 'react';
import type { TrackMetrics } from '@/lib/engine';
import type { SourceInfo } from '@/lib/import';
import { bytes, num, time } from './format';
import { Panel, Readout } from './ui';

const FLAG_TEXT: Record<string, string> = {
  'possible-clipping': 'Flat-topped peaks. Possible clipping.',
  'little-sample-headroom': 'Peaks within 0.2 dB of full scale.',
  'very-quiet': 'Very quiet source (below −40 LUFS).',
  'dual-mono': 'Left and right are identical.',
  'negative-correlation': 'Channels partly out of phase.',
  'dc-offset': 'DC offset present.',
  'possibly-already-mastered': 'Looks already mastered. Go light.',
};

const ACCEPT = '.wav,.flac,.mp3,audio/wav,audio/x-wav,audio/wave,audio/flac,audio/x-flac,audio/mpeg';

/** "24-bit WAV", "32-bit float WAV", "16-bit FLAC", "MP3 320 kbps". */
export function formatLabel(m: SourceInfo): string {
  if (m.container === 'mp3') return `MP3${m.bitrateKbps ? ` ${m.bitrateKbps} kbps` : ''}`;
  return `${m.bitsPerSample}-bit${m.float ? ' float' : ''} ${m.container.toUpperCase()}`;
}

/** File intake (drop or browse) plus the source's measured profile. */
export function SourcePanel({ fileName, fileSize, metadata, metrics, busy, onFile }: {
  fileName?: string; fileSize?: number; metadata?: SourceInfo; metrics?: TrackMetrics; busy: boolean; onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  return (
    <Panel title="Source" aside={metadata && <span className="font-mono text-xs text-muted"><span data-testid="source-format">{metadata.sampleRate / 1000} kHz · {formatLabel(metadata)} · {metadata.channels} ch</span></span>}>
      <label
        className={`xr-dropzone flex cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-4 py-6 text-center ${
          over ? 'border-gold bg-gold-glow' : 'border-line-card bg-surface hover:border-gold-dim'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      >
        <span className="font-heading text-sm font-bold text-cloud">{fileName ?? 'Drop a WAV, FLAC or MP3, or browse'}</span>
        <span className="font-mono text-xs text-ash">
          {fileSize ? bytes(fileSize) : 'WAV 16/24/32-bit or float · FLAC · MP3 · up to 8 channels'}
        </span>
        <input
          data-testid="file-input" type="file" accept={ACCEPT} className="sr-only" disabled={busy}
          onChange={e => { pick(e.currentTarget.files); e.currentTarget.value = ''; }}
        />
      </label>

      {metrics && (
        <>
          <div className="xr-reveal mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Readout label="Integrated" value={num(metrics.loudness.integratedLufs)} unit="LUFS" testId="source-lufs" emphasis />
            <Readout label="True peak" value={num(metrics.loudness.truePeakDbtp)} unit="dBTP" testId="source-tp" emphasis />
            <Readout label="Range" value={num(metrics.loudness.loudnessRangeLu)} unit="LU" />
            <Readout label="Crest" value={num(metrics.crestDb)} unit="dB" />
            <Readout label="Correlation" value={num(metrics.correlation, 2)} />
            <Readout label="Length" value={time(metadata ? metadata.length / metadata.sampleRate : 0)} />
          </div>
          {metadata?.lossy && (
            <p data-testid="lossy-note" className="mt-4 border-t border-line pt-3 text-xs text-ash">
              <span aria-hidden className="text-gold">▸ </span>Lossy MP3 source. Mastering can&apos;t restore what the codec removed; master from the WAV or FLAC if you have it.
            </p>
          )}
          {metrics.sourceQuality.flags.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-ash">
              {metrics.sourceQuality.flags.map(f => (
                <li key={f} className="flex gap-2"><span aria-hidden className="text-gold">▸</span>{FLAG_TEXT[f] ?? f}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
