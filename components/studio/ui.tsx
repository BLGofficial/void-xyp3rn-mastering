'use client';

import { useId, type ReactNode } from 'react';
import { param } from './format';

/** Panel with a mono label header (brand: Panel #0D0D0D, Card Border #222222). */
export function Panel({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`xr-panel ${className}`} aria-label={title}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[11px] uppercase tracking-label text-gold">{title}</h2>
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Label/value pair. Value in mono so digits don't jitter. */
export function Readout({ label, value, unit, testId, emphasis = false }: { label: string; value: string; unit?: string; testId?: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="xr-label">{label}</div>
      <div className={`font-mono tabular-nums ${emphasis ? 'text-2xl text-cloud' : 'text-base text-cloud'}`}>
        <span data-testid={testId}>{value}</span>
        {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
      </div>
    </div>
  );
}

/** Native range input with brand styling and a spoken value. */
export function Slider({ label, value, min, max, step, unit, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  const id = useId();
  const text = param(value, step, unit);
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="truncate text-xs text-ash">{label}</label>
        <output htmlFor={id} className="shrink-0 font-mono text-xs tabular-nums text-cloud">{text}</output>
      </div>
      <input
        id={id} type="range" className="xr-range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-valuetext={text} style={{ ['--slider-progress' as string]: `${progress}%` }}
        onChange={e => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

/** Two-state button (bypass, A/B, modes). */
export function Toggle({ pressed, onClick, children, testId, label, disabled }: { pressed: boolean; onClick: () => void; children: ReactNode; testId?: string; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button" aria-pressed={pressed} aria-label={label} data-testid={testId} disabled={disabled} onClick={onClick}
      className={`min-h-11 border px-2.5 py-1 font-mono text-[11px] uppercase tracking-label transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 ${
        pressed ? 'border-gold bg-gold text-studio' : 'border-line-card bg-surface text-ash hover:border-gold-dim hover:text-gold'
      }`}
    >
      {children}
    </button>
  );
}
