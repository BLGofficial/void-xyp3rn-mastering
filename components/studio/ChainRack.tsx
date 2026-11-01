'use client';

import { createState, DEFINITIONS, MAX_PROCESSORS, type ChainState, type ProcessorId, type ProcessorState, type Quality } from '@/lib/dsp';
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

function ModuleCard({ proc, onChange, onRemove }: { proc: ProcessorState; onChange: (p: ProcessorState) => void; onRemove?: () => void }) {
  const def = DEFINITIONS[proc.id];
  const set = (key: string, value: number) => onChange({ ...proc, parameters: { ...proc.parameters, [key]: value } });
  return (
    <article className={`xr-module border p-4 ${proc.bypassed ? 'xr-off border-line' : 'border-gold-dim'}`} aria-label={def.name}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className={`font-heading text-sm font-bold ${proc.bypassed ? 'text-ash' : 'text-cloud'}`}>{def.name}</h3>
        <div className="flex gap-1.5">
          {onRemove && <button type="button" onClick={onRemove} className="min-h-11 min-w-11 px-1.5 font-mono text-xs uppercase text-muted hover:text-gold sm:min-h-0 sm:min-w-0" aria-label={`Remove ${def.name}`}>✕</button>}
          <Toggle pressed={!proc.bypassed} onClick={() => onChange({ ...proc, bypassed: !proc.bypassed })} label={`${def.name} on`}>
            {proc.bypassed ? 'Off' : 'On'}
          </Toggle>
        </div>
      </header>
      <div className="space-y-2.5">
        {Object.entries(def.parameters).map(([key, p]) =>
          MODE_LABELS[key] ? (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs text-ash">{p.label.replace(/ \(.*\)$/, '')}</span>
              <div className="flex gap-1">
                {MODE_LABELS[key]!.map((name, v) => (
                  <Toggle key={name} pressed={proc.parameters[key] === v} onClick={() => set(key, v)}>{name}</Toggle>
                ))}
              </div>
            </div>
          ) : (
            <Slider key={key} label={p.label} value={proc.parameters[key]!} min={p.min} max={p.max} step={p.step} unit={p.unit} onChange={v => set(key, v)} />
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
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {SENDS.filter(id => !state.processors.some(p => p.id === id)).map(id => (
            <button key={id} type="button" className="xr-button" disabled={state.processors.length >= MAX_PROCESSORS} onClick={() => add(id)}>
              + {DEFINITIONS[id].name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="xr-label">Clip quality</span>
          <Toggle pressed={quality === 'standard'} onClick={() => setQuality('standard')}>Standard</Toggle>
          <Toggle pressed={quality === 'studio'} onClick={() => setQuality('studio')}>4x Studio</Toggle>
        </div>
      </div>
      {/* Multi-column packs uneven cards; order still reads top-to-bottom per column. */}
      <div className="gap-3 sm:columns-2 2xl:columns-3 [&>article]:mb-3 [&>article]:break-inside-avoid">
        {state.processors.map((p, i) => (
          <ModuleCard key={p.instanceId} proc={p} onChange={next => replace(i, next)} onRemove={SENDS.includes(p.id) ? () => remove(i) : undefined} />
        ))}
      </div>
    </div>
  );
}
