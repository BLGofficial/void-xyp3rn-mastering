'use client';

import { INTENTIONS, type Intention, type Style } from '@/lib/auto';
import { Hint, useHint } from './hints';
import { Panel, Slider } from './ui';

const LABELS: Record<Intention, string> = {
  transparent: 'Transparent — touch it lightly',
  balanced: 'Balanced — even, controlled',
  loud: 'Loud — more density',
  warm: 'Warm — fuller low end',
  bright: 'Bright — more air',
};

/** Automatic proposal. It writes into the chain; every move stays editable. Suggests — never decides. */
export function AutoPanel({ intention, onIntention, intensity, onIntensity, canRun, busy, onRun, onPreset, canUndo, onUndo, notes }: {
  intention: Intention; onIntention: (v: Intention) => void; intensity: number | null; onIntensity: (v: number | null) => void;
  canRun: boolean; busy: boolean; onRun: () => void; onPreset: (style: Style) => void;
  /** Restore the chain the last Auto/preset replaced. */
  canUndo: boolean; onUndo: () => void; notes: string[] | null;
}) {
  const effective = intensity ?? INTENTIONS[intention].intensity;
  const hPreset = useHint('preset'), hIntention = useHint('intention'), hRun = useHint('auto-run'), hUndo = useHint('auto-undo');
  return (
    <Panel title="Auto" aside={<span className="font-mono text-xs text-muted">Local · deterministic</span>}>
      <div className="space-y-3">
        <div>
          <span className="xr-label">Mastering presets</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(['natural', 'warm', 'punchy'] as Style[]).map(style => (
              <button
                key={style} type="button" data-testid={`preset-${style}`} className="xr-button px-2 capitalize" aria-describedby={hPreset.id}
                disabled={!canRun || busy} onClick={() => onPreset(style)}
              >
                {style}
              </button>
            ))}
          </div>
          <Hint hint={hPreset} />
        </div>
        <label className="block">
          <span className="xr-label">Intention</span>
          <select
            data-testid="auto-intention" className="xr-select mt-1" value={intention} aria-describedby={hIntention.id}
            onChange={e => { onIntention(e.currentTarget.value as Intention); onIntensity(null); }}
          >
            {(Object.keys(INTENTIONS) as Intention[]).map(k => <option key={k} value={k}>{LABELS[k]}</option>)}
          </select>
          <Hint hint={hIntention} />
        </label>
        <Slider label="Intensity" value={effective} min={0} max={100} step={1} unit="%" onChange={onIntensity} hint="intensity" />
        <p className="text-xs text-ash">Dense sources cap at 35%. Uses the target and ceiling below.</p>
        <div>
          <button type="button" data-testid="auto-run" className="xr-button w-full" aria-describedby={hRun.id} disabled={!canRun || busy} onClick={onRun}>
            {busy ? 'Working…' : 'Suggest a master'}
          </button>
          <Hint hint={hRun} />
        </div>
        <div>
          <button type="button" data-testid="auto-undo" className="xr-button w-full" aria-describedby={hUndo.id} disabled={!canUndo || busy} onClick={onUndo}>
            Undo auto
          </button>
          <Hint hint={hUndo} />
        </div>
      </div>
      {notes && (
        <ol data-testid="auto-notes" className="xr-reveal mt-4 space-y-1.5 border-t border-line pt-3 text-xs text-ash">
          {notes.map((n, i) => (
            <li key={i} className="flex gap-2"><span aria-hidden className="font-mono text-gold">{String(i + 1).padStart(2, '0')}</span><span>{n}</span></li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
