'use client';

import { useState } from 'react';
import type { TrackMetrics, WavInfo } from '@/lib/engine';
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

/** File intake (drop or browse) plus the source's measured profile. */
export function SourcePanel({ fileName, fileSize, metadata, metrics, busy, onFile }: {
  fileName?: string; fileSize?: number; metadata?: WavInfo; metrics?: TrackMetrics; busy: boolean; onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  return (
    <Panel title="Source" aside={metadata && <span className="font-mono text-xs text-muted">{metadata.sampleRate / 1000} kHz · {metadata.bitsPerSample}-bit · {metadata.channels} ch</span>}>
      <label
        className={`xr-dropzone flex cursor-pointer flex-col items-center justify-center gap-1 border border-dashed px-4 py-6 text-center ${
          over ? 'border-gold bg-gold-glow' : 'border-line-card bg-surface hover:border-gold-dim'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      >
        <span className="font-heading text-sm font-bold text-cloud">{fileName ?? 'Drop a WAV or browse'}</span>
        <span className="font-mono text-xs text-ash">
          {fileSize ? bytes(fileSize) : '16/24/32-bit PCM or 32-bit float · up to 8 channels'}
        </span>
        <input
          data-testid="file-input" type="file" accept=".wav,audio/wav,audio/x-wav,audio/wave" className="sr-only" disabled={busy}
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
