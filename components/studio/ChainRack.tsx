'use client';

import { useId, useState } from 'react';
import { createState, DEFINITIONS, MAX_PROCESSORS, type ChainState, type ProcessorId, type ProcessorState, type Quality } from '@/lib/dsp';
import { paramKey } from '@/lib/guide';
import { Hint, useHint } from './hints';
import { Slider, Toggle } from './ui';

/** Integer 0/1 parameters are modes, not continuous controls. */
const MODE_LABELS: Record<string, [string, string]> = {
  adaptive: ['Peak', 'Hybrid'],
  truePeak: ['Sample', 'True peak'],
};
const SENDS: ProcessorId[] = ['reverb', 'echo'];

function nextInstanceId(state: ChainState) {
  let n = 1;
  while (state.processors.some(p => p.instanceId === `slot-${n}`)) n++;
  return `slot-${n}`;
}

/** Two-state parameter (detector modes) with its guide hint. */
function ModeSwitch({ label, names, value, hint, onChange }: { label: string; names: [string, string]; value: number | undefined; hint: string; onChange: (v: number) => void }) {
  const h = useHint(hint);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ash">{label}</span>
        <div className="flex gap-1">
          {names.map((name, v) => (
            <Toggle key={name} pressed={value === v} onClick={() => onChange(v)} describedBy={h.id}>{name}</Toggle>
          ))}
        </div>
      </div>
      <Hint hint={h} />
    </div>
  );
}

/** Bypass and Remove share one chain-level hint each; the card only points at them. */
interface ChainHints { bypass: string; remove: string }

function ModuleCard({ proc, onChange, onRemove, hints }: { proc: ProcessorState; onChange: (p: ProcessorState) => void; onRemove?: () => void; hints: ChainHints }) {
  const def = DEFINITIONS[proc.id];
  // Phones: collapsed to a header (name + On/Off), so the chain reads as a list. Desktop always shows controls.
  const [open, setOpen] = useState(false);
  const body = useId();
  const set = (key: string, value: number) => onChange({ ...proc, parameters: { ...proc.parameters, [key]: value } });
  return (
    <article className={`xr-module border p-4 ${proc.bypassed ? 'xr-off border-line' : 'border-gold-dim'}`} aria-label={def.name}>
      <header className={`flex items-center justify-between gap-2 lg:mb-3 ${open ? "mb-3" : ""}`}>
        <h3 className={`min-w-0 font-heading text-sm font-bold ${proc.bypassed ? 'text-ash' : 'text-cloud'}`}>
          <button
            type="button" aria-expanded={open} aria-controls={body} aria-label={`${def.name} controls`} onClick={() => setOpen(o => !o)}
            className="-my-1 flex min-h-11 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold lg:hidden"
          >
            <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-gold transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>
              <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {def.name}
          </button>
          <span className="hidden lg:inline">{def.name}</span>
        </h3>
        <div className="flex gap-1.5">
          {onRemove && <button type="button" onClick={onRemove} className="min-h-11 min-w-11 px-1.5 font-mono text-xs uppercase text-muted hover:text-gold sm:min-h-0 sm:min-w-0" aria-label={`Remove ${def.name}`} aria-describedby={hints.remove}>✕</button>}
          <Toggle pressed={!proc.bypassed} onClick={() => onChange({ ...proc, bypassed: !proc.bypassed })} label={`${def.name} on`} describedBy={hints.bypass}>
            {proc.bypassed ? 'Off' : 'On'}
          </Toggle>
        </div>
      </header>
      <div id={body} className={`space-y-2.5 lg:block ${open ? '' : 'hidden'}`}>
        {Object.entries(def.parameters).map(([key, p]) =>
          MODE_LABELS[key] ? (
            <ModeSwitch
              key={key} label={p.label.replace(/ \(.*\)$/, '')} names={MODE_LABELS[key]!} value={proc.parameters[key]}
              hint={paramKey(proc.id, key)} onChange={v => set(key, v)}
            />
          ) : (
            <Slider
              key={key} label={p.label} value={proc.parameters[key]!} min={p.min} max={p.max} step={p.step} unit={p.unit}
              hint={paramKey(proc.id, key)} onChange={v => set(key, v)}
            />
          ),
        )}
      </div>
    </article>
  );
}

/** The processing chain in signal order. Core modules are fixed; Space/Echo sends can be added. */
export function ChainRack({ state, onChange }: { state: ChainState; onChange: (s: ChainState) => void }) {
  const replace = (i: number, p: ProcessorState) => onChange({ ...state, processors: state.processors.map((q, j) => (j === i ? p : q)) });
  const remove = (i: number) => onChange({ ...state, processors: state.processors.filter((_, j) => j !== i) });
  const add = (id: ProcessorId) => {
    // Sends go before the clipper/limiter so their tails are peak-controlled too.
    const at = state.processors.findIndex(p => p.id === 'clip' || p.id === 'limit');
    const proc = createState(id, nextInstanceId(state), false);
    const processors = [...state.processors];
    processors.splice(at < 0 ? processors.length : at, 0, proc);
    onChange({ ...state, processors });
  };
  const quality = state.quality ?? 'standard';
  const setQuality = (q: Quality) => onChange({ ...state, quality: q });
  const hAdd = useHint('add'), hQuality = useHint('quality'), hBypass = useHint('bypass'), hRemove = useHint('remove');
  const addable = SENDS.filter(id => !state.processors.some(p => p.id === id));
  const removable = state.processors.some(p => SENDS.includes(p.id));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {addable.map(id => (
            <button key={id} type="button" className="xr-button" aria-describedby={hAdd.id} disabled={state.processors.length >= MAX_PROCESSORS} onClick={() => add(id)}>
              + {DEFINITIONS[id].name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="xr-label">Clip quality</span>
          <Toggle pressed={quality === 'standard'} onClick={() => setQuality('standard')} describedBy={hQuality.id}>Standard</Toggle>
          <Toggle pressed={quality === 'studio'} onClick={() => setQuality('studio')} describedBy={hQuality.id}>4x Studio</Toggle>
        </div>
      </div>
      <div className="mb-3 [&>p]:mt-0 [&>p+p]:mt-1">
        <Hint hint={hAdd} show={addable.length > 0} />
        <Hint hint={hQuality} />
        <Hint hint={hBypass} />
        <Hint hint={hRemove} show={removable} />
      </div>
      {/* Multi-column packs uneven cards; order still reads top-to-bottom per column. */}
      <div className="gap-3 sm:columns-2 2xl:columns-3 [&>article]:mb-3 [&>article]:break-inside-avoid">
        {state.processors.map((p, i) => (
          <ModuleCard
            key={p.instanceId} proc={p} onChange={next => replace(i, next)} onRemove={SENDS.includes(p.id) ? () => remove(i) : undefined}
            hints={{ bypass: hBypass.id, remove: hRemove.id }}
          />
        ))}
      </div>
    </div>
  );
}
