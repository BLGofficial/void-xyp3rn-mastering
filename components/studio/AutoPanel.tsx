'use client';

import { INTENTIONS, type Intention } from '@/lib/auto';
import { Panel, Slider } from './ui';

const LABELS: Record<Intention, string> = {
  transparent: 'Transparent — touch it lightly',
  balanced: 'Balanced — even, controlled',
  loud: 'Loud — more density',
  warm: 'Warm — fuller low end',
  bright: 'Bright — more air',
};

/** Automatic proposal. It writes into the chain; every move stays editable. Suggests — never decides. */
export function AutoPanel({ intention, onIntention, intensity, onIntensity, canRun, busy, onRun, notes }: {
  intention: Intention; onIntention: (v: Intention) => void; intensity: number | null; onIntensity: (v: number | null) => void;
  canRun: boolean; busy: boolean; onRun: () => void; notes: string[] | null;
}) {
  const effective = intensity ?? INTENTIONS[intention].intensity;
  return (
    <Panel title="Auto" aside={<span className="font-mono text-[11px] text-muted">Local · deterministic</span>}>
      <div className="space-y-3">
        <label className="block">
          <span className="xr-label">Intention</span>
          <select
            data-testid="auto-intention" className="xr-select mt-1" value={intention}
            onChange={e => { onIntention(e.currentTarget.value as Intention); onIntensity(null); }}
          >
            {(Object.keys(INTENTIONS) as Intention[]).map(k => <option key={k} value={k}>{LABELS[k]}</option>)}
          </select>
        </label>
        <Slider label="Intensity" value={effective} min={0} max={100} step={1} unit="%" onChange={onIntensity} />
        <p className="text-xs text-muted">Dense sources cap at 35%. Uses the target and ceiling below.</p>
        <button type="button" data-testid="auto-run" className="xr-button w-full" disabled={!canRun || busy} onClick={onRun}>
          {busy ? 'Working…' : 'Suggest a master'}
        </button>
      </div>
      {notes && (
        <ol data-testid="auto-notes" className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-ash">
          {notes.map((n, i) => (
            <li key={i} className="flex gap-2"><span aria-hidden className="font-mono text-gold">{String(i + 1).padStart(2, '0')}</span><span>{n}</span></li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
