'use client';

import type { EnginePhase } from '@/lib/engine';

type Stage = 'read' | 'decode' | 'analyse';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'decode', label: 'Decode' },
  { id: 'analyse', label: 'Analyse' },
];
const BARS = 32;

/**
 * Import in progress, driven by the engine's real stages. The bars do what the engine does:
 * they fill left to right with the decode's progress, then a scan sweeps them while the
 * analysis measures the file. No step is shown done before the engine reports the next.
 */
export function LoadProgress({ fileName, phase, progress }: { fileName: string; phase: EnginePhase | null; progress: number | null }) {
  const stage: Stage = phase?.phase === 'decode' || phase?.phase === 'analyse' ? phase.phase : 'read';
  const at = STAGES.findIndex(s => s.id === stage);
  // Decode fills to its progress; analysis has all bars lit and scanning.
  const fill = stage === 'analyse' ? 1 : stage === 'decode' ? progress ?? 0 : 0;
  return (
    <div data-testid="load-progress" data-load-stage={stage} role="status" aria-live="polite" className="xr-reveal flex w-full max-w-md flex-col items-center gap-3">
      <div aria-hidden className={`xr-load-bars ${stage === 'analyse' ? 'xr-load-scan' : ''}`} style={{ ['--fill' as string]: fill }}>
        {Array.from({ length: BARS }, (_, i) => (
          <span key={i} data-lit={i / BARS < fill || undefined} style={{ ['--i' as string]: i, ['--h' as string]: barHeight(i) }} />
        ))}
      </div>
      <span className="max-w-full truncate font-heading text-sm font-bold text-cloud">{fileName}</span>
      <ol className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-label">
        {STAGES.map((s, i) => {
          const state = i < at ? 'done' : i === at ? 'active' : 'pending';
          return (
            <li key={s.id} data-state={state} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={`h-px w-5 ${i <= at ? 'bg-gold' : 'bg-line-card'} transition-colors duration-300`} />}
              <span className={`flex items-center gap-1.5 ${state === 'pending' ? 'text-muted' : 'text-gold'}`}>
                <span aria-hidden className={`xr-load-dot ${state === 'active' ? 'xr-load-dot-active' : ''} ${state === 'pending' ? 'bg-line-card' : 'bg-gold'}`} />
                {s.label}
                <span className="sr-only">{state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A fixed, waveform-like profile so the bars read as audio, the same every time. */
function barHeight(i: number) {
  const x = i / (BARS - 1);
  return (0.35 + 0.65 * Math.abs(Math.sin(x * Math.PI * 2.6) * Math.cos(x * Math.PI * 0.9))).toFixed(3);
}

/** Readout placeholders while the source is measured: the panel keeps its shape. */
export function SourceSkeleton() {
  return (
    <div data-testid="source-skeleton" aria-hidden className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="xr-skeleton h-3 w-16" />
          <div className={`xr-skeleton ${i < 2 ? 'h-7 w-24' : 'h-5 w-14'}`} />
        </div>
      ))}
    </div>
  );
}
