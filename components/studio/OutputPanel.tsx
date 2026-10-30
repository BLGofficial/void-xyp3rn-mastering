'use client';

import type { RenderResult } from '@/audio/protocol';
import type { WavFormat } from '@/lib/engine';
import { num } from './format';
import { Panel, Readout } from './ui';

export const TARGETS = [
  { value: 'off', label: 'Off — ceiling only' },
  { value: '-14', label: '−14 LUFS · streaming' },
  { value: '-11', label: '−11 LUFS · loud' },
  { value: '-9', label: '−9 LUFS · club' },
  { value: '-16', label: '−16 LUFS · podcast' },
  { value: '-23', label: '−23 LUFS · broadcast (R128)' },
] as const;
export const CEILINGS = [-0.5, -1, -2] as const;
const FORMATS: { value: WavFormat; label: string }[] = [
  { value: 'pcm24', label: '24-bit PCM' },
  { value: 'pcm16', label: '16-bit PCM' },
  { value: 'float32', label: '32-bit float' },
];

const WARNING_TEXT: Record<string, string> = {
  EXCESSIVE_LIMITING: 'Limiter working past 4 dB. Back off input or target.',
  EXCESSIVE_COMPRESSION: 'Compressor past 6 dB reduction.',
  MACRO_CONTRAST: 'Section-to-section dynamics flattened.',
  MESO_CONTRAST: 'Phrase-level dynamics flattened.',
  TRANSIENT_DAMAGE: 'Transients softened.',
  STEREO_PHASE_RISK: 'Stereo phase risk. Check mono.',
  MONO_CANCELLATION: 'Mono fold-down loses level.',
  EXCESSIVE_SIDE: 'Side channel louder than mid +6 dB.',
  BAND_MONO_CANCELLATION: 'A band cancels in mono.',
  MONO_TRANSIENT_DAMAGE: 'Mono transients softened.',
  SPECTRAL_EXTREME: 'Tonal balance moved hard.',
  EXCESSIVE_LOUDNESS: 'Louder than −8 LUFS.',
  LOUDNESS_UNAVAILABLE: 'Loudness unmeasurable for this layout or rate.',
  DC_OFFSET: 'DC offset present.',
  DENORMAL_SAMPLES: 'Denormal samples present.',
  EXTREME_FLOAT_LEVEL: 'Float samples beyond +24 dBFS.',
  SUBSONIC_CONTENT: 'Heavy sub-20 Hz energy.',
  EXTREME_EQ: 'EQ move beyond ±2.5 dB.',
};

/** Loudness target, ceiling, render report and export. Suggests — never decides. */
export function OutputPanel(props: {
  target: string; onTarget: (v: string) => void; ceiling: number; onCeiling: (v: number) => void;
  format: WavFormat; onFormat: (v: WavFormat) => void; dither: boolean; onDither: (v: boolean) => void;
  canRender: boolean; busy: boolean; progress: number | null; onRender: () => void; result: RenderResult | null; onExport: () => void;
}) {
  const { result } = props;
  const status = result?.targetResult?.status ?? (result ? 'rendered' : null);
  const lufs = result?.metrics.loudness.integratedLufs;
  return (
    <Panel title="Output">
      <div className="space-y-3">
        <label className="block">
          <span className="xr-label">Loudness target</span>
          <select data-testid="target-select" className="xr-select mt-1" value={props.target} onChange={e => props.onTarget(e.currentTarget.value)}>
            {TARGETS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="xr-label">True-peak ceiling</span>
            <select className="xr-select mt-1" value={props.ceiling} onChange={e => props.onCeiling(Number(e.currentTarget.value))}>
              {CEILINGS.map(c => <option key={c} value={c}>{num(c)} dBTP</option>)}
            </select>
          </label>
          <label className="block">
            <span className="xr-label">Format</span>
            <select data-testid="format-select" className="xr-select mt-1" value={props.format} onChange={e => props.onFormat(e.currentTarget.value as WavFormat)}>
              {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-ash">
          <input data-testid="dither" type="checkbox" className="h-4 w-4" checked={props.dither && props.format !== 'float32'} disabled={props.format === 'float32'} onChange={e => props.onDither(e.currentTarget.checked)} />
          TPDF dither on PCM export
        </label>
        <button type="button" data-testid="render" className="xr-button-primary w-full" disabled={!props.canRender || props.busy} onClick={props.onRender}>
          {props.busy ? 'Rendering…' : 'Render master'}
        </button>
        {props.progress !== null && (
          <progress className="block h-1 w-full" max={1} value={props.progress} aria-label="Render progress" />
        )}
      </div>

      {result && (
        <div className="mt-5 space-y-4 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <span className="xr-label">Result</span>
            <span data-testid="report-status" className={`font-mono text-xs uppercase tracking-label ${status === 'limited' ? 'text-ash' : 'text-gold'}`}>{status}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Readout label="Integrated" value={num(lufs)} unit="LUFS" testId="report-lufs" emphasis />
            <Readout label="True peak" value={num(result.metrics.loudness.truePeakDbtp)} unit="dBTP" emphasis />
            <Readout label="Range" value={num(result.metrics.loudness.loudnessRangeLu)} unit="LU" />
            <Readout label="Output gain" value={num(result.state.loudnessTarget?.correctionDb ?? 0)} unit="dB" />
          </div>
          {result.targetResult && <p className="text-xs text-ash">{result.targetResult.reason}</p>}
          {result.safety.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-ash" aria-label="Warnings">
              {result.safety.warnings.map((w, i) => (
                <li key={`${w.code}-${i}`} className="flex gap-2">
                  <span aria-hidden className="text-gold">▸</span>
                  <span>{WARNING_TEXT[w.code] ?? w.code}{w.introduced ? '' : ' (in source)'}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" data-testid="export" className="xr-button w-full" disabled={props.busy} onClick={props.onExport}>
            Export WAV
          </button>
        </div>
      )}
    </Panel>
  );
}
