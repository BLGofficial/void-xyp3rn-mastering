'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XyperMark } from '@/components/brand/XyperMark';
import type { OrbPhase, XYP3RNMasteringOrb } from '@/components/orb/XYP3RNMasteringOrb';
import type { BlockTelemetry, EnginePhase } from '@/lib/engine';

/** What fills the orb stage: the WebGL orb, the video fallback, or a still (reduced motion / loading). */
type Visual = 'loading' | 'webgl' | 'video' | 'still';

/** How long the sheet stays up after a successful render so the lock pulse reads as "done". */
const LOCK_HOLD_MS = 700;

const signed = (v: number) => v.toFixed(1).replace('-', '−');
const dbfs = (linear: number) => (linear > 0 ? 20 * Math.log10(linear) : null);

/** Block RMS -> 0..1 orb energy: -42 dBFS reads as silence, -6 dBFS as full punch. */
const energy = (rms: number) => (rms > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 42) / 36)) : 0);
/** Gain reduction -> 0..1 squeeze: 12 dB is full. */
const squeeze = (db: number) => Math.max(0, Math.min(1, db / 12));
/** Block peak -> 0..1 flash: from -6 dBFS up to full scale. */
const flash = (peak: number) => (peak > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(peak) + 6) / 6)) : 0);

function stageLabel(phase: OrbPhase | null, p: EnginePhase | null): string {
  if (phase === 'locked') return 'LOCKED';
  if (!p) return 'STARTING';
  if (p.phase === 'analyse') return 'ANALYSE';
  if (p.phase === 'render') return 'RENDER';
  if (p.phase === 'peak') return 'PEAK CHECK';
  return p.pass ? `MEASURE ${p.pass}/${p.passes}` : 'MEASURE';
}

/** What the engine is doing, in words, for the status line (the chain pass sends no status of its own). */
function stageStep(p: EnginePhase | null): string | null {
  if (!p) return null;
  if (p.phase === 'analyse') return 'Profiling the source';
  if (p.phase === 'render') return 'Rendering the chain';
  if (p.phase === 'peak') return 'Checking true peak';
  return p.pass ? `Loudness pass ${p.pass}/${p.passes}` : 'Measuring loudness';
}

/**
 * The render state: a compact glass sheet over the dimmed studio, with the orb
 * driven by what the engine is doing (stage, level, peaks, gain reduction).
 * Modal by design (the chain must not change under a running render), so it
 * always offers its way out: Cancel, focused on open, and Esc. Cancelling keeps
 * the previous master.
 */
export function RenderOverlay({ open, completed, status, progress, block, phase, sourceLufs, targetLufs, onCancel }: {
  open: boolean;
  /** The operation finished successfully: hold briefly on the lock pulse before closing. */
  completed: boolean;
  status: string; progress: number | null;
  /** Latest rendered block: level, peak, gain reduction. */
  block: BlockTelemetry | null;
  /** The engine stage in progress. */
  phase: EnginePhase | null;
  /** Measured integrated loudness of the source, and the render's target (null = off). */
  sourceLufs: number | null; targetLufs: number | null;
  onCancel: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const orb = useRef<XYP3RNMasteringOrb | null>(null);
  const [visual, setVisual] = useState<Visual>('loading');
  // Shown while open, then for the lock hold after a successful render.
  const [locked, setLocked] = useState(false);
  const shown = open || locked;
  const cancel = useRef<HTMLButtonElement>(null);
  // Latest handler without re-running the open/close effect on every progress tick.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const orbPhase: OrbPhase | null = locked ? 'locked' : phase?.phase ?? null;

  // Success: keep the sheet up just long enough for the lock pulse; cancel/error close at once.
  // Decided during render, on the open -> closed edge itself, so no commit ever has the sheet
  // closed between the render and the hold (that would tear the orb down and rebuild it).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLocked(!open && completed && !reduced);
  }
  useEffect(() => {
    if (!locked) return;
    const timer = setTimeout(() => setLocked(false), LOCK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [locked]);

  useEffect(() => {
    if (!shown) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancelRef.current(); }
      // Cancel is the only control: keep keyboard focus inside the dialog.
      if (e.key === 'Tab') { e.preventDefault(); cancel.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [shown]);

  // The orb (three.js, ~150 kB gz) loads only when a render starts and is torn down
  // with its GPU context when the sheet closes. No WebGL -> the looping video instead.
  useEffect(() => {
    if (!shown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisual('still'); return; }
    let disposed = false;
    setVisual('loading');
    // ?orb=webgl skips the performance guards (also how e2e exercises WebGL on software GL).
    const forced = new URLSearchParams(window.location.search).get('orb') === 'webgl';
    let watch = 0;
    const fallBack = () => {
      orb.current?.destroy();
      orb.current = null;
      if (!disposed) setVisual('video');
    };
    import('@/components/orb/XYP3RNMasteringOrb')
      .then(({ XYP3RNMasteringOrb }) => {
        if (disposed || !stage.current) return;
        const instance = new XYP3RNMasteringOrb(stage.current);
        orb.current = instance;
        if (instance.software && !forced) return fallBack();
        setVisual('webgl');
        if (forced) return;
        // Weak GPU guard: three frames over 50 ms in a row (after shader warm-up) -> video.
        let last = performance.now(), slow = 0, seen = 0;
        const sample = (now: number) => {
          const dt = now - last;
          last = now;
          if (++seen > 3) slow = dt > 50 ? slow + 1 : 0;
          if (slow >= 3) return fallBack();
          if (seen < 90 && !disposed) watch = requestAnimationFrame(sample);
        };
        watch = requestAnimationFrame(sample);
      })
      .catch(fallBack);
    return () => {
      disposed = true;
      cancelAnimationFrame(watch);
      orb.current?.destroy();
      orb.current = null;
      // The component stays mounted between renders: start the next one clean.
      setVisual('loading');
    };
  }, [shown]);

  // Stage: the chain pass fills progress; measuring and peak checks run on a finished render.
  useEffect(() => {
    const o = orb.current;
    if (!o || !orbPhase) return;
    o.setPhase(orbPhase);
    if (orbPhase === 'locked') o.triggerLockPulse();
  }, [orbPhase, visual]);

  useEffect(() => {
    orb.current?.setProgress(orbPhase === 'render' || orbPhase === 'analyse' || !orbPhase ? progress ?? 0 : 1);
  }, [progress, orbPhase, visual]);

  useEffect(() => {
    const o = orb.current;
    const e = block ? energy(block.rms) : 0, r = block ? squeeze(block.reductionDb) : 0;
    o?.setTransient(e);
    o?.setReduction(r);
    o?.setPeak(block ? flash(block.peak) : 0);
    // Exposed for diagnostics and e2e: proves the engine's telemetry reaches the orb.
    if (stage.current) {
      stage.current.dataset.energy = e.toFixed(2);
      stage.current.dataset.reduction = (block?.reductionDb ?? 0).toFixed(2);
    }
  }, [block, visual]);

  if (!shown || typeof document === 'undefined') return null;
  const percent = locked ? 100 : progress === null ? null : Math.round(progress * 100);
  const step = locked ? 'Master locked' : stageStep(phase) ?? (status.replace(/^Engine:\s*/, '') || 'Rendering…');

  // Every readout is measured: source loudness, the requested target, and the live
  // level and gain reduction of the block being rendered. Nothing here is simulated.
  // Level and GR describe the chain pass; outside it the last block would be stale.
  const live = orbPhase === 'render' ? block : null;
  const levelDb = live ? dbfs(live.rms) : null;
  const metrics: [label: string, value: string, testId: string, accent?: boolean][] = [
    ['SOURCE', sourceLufs === null ? '—' : `${signed(sourceLufs)} LUFS`, 'orb-source'],
    ['TARGET', targetLufs === null ? 'OFF' : `${signed(targetLufs)} LUFS`, 'orb-target', true],
    ['LEVEL', levelDb === null ? '—' : `${signed(levelDb)} dB`, 'orb-level'],
    ['GR', live ? `${signed(-live.reductionDb)} dB` : '—', 'orb-gr', true],
  ];

  return createPortal(
    <div
      data-testid="render-orb" data-orb={visual} data-phase={orbPhase ?? undefined}
      role="dialog" aria-modal="true" aria-labelledby="render-title" aria-describedby="render-status"
      // The studio stays visible behind, dimmed and blurred: the render belongs to it.
      className="xr-overlay-in fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-studio/70 px-4 py-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md"
    >
      <h2 id="render-title" className="sr-only">Mastering</h2>
      <section
        data-testid="orb-sheet"
        className="xr-sheet-in relative flex w-full max-w-[420px] flex-col gap-3 rounded-2xl border border-[rgb(250_205_104_/_22%)] bg-panel/60 p-4 shadow-[0_30px_80px_rgb(0_0_0_/_65%),inset_0_1px_0_rgb(255_255_255_/_6%)] backdrop-blur-xl backdrop-saturate-150 sm:p-5"
      >
        <header className="flex items-center justify-between gap-3 font-mono">
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-label text-ash">
            <XyperMark size={24} /> Mastering
          </span>
          <span
            data-testid="orb-sys"
            className="rounded-full border border-[rgb(250_205_104_/_32%)] bg-gold-glow/60 px-2.5 py-1 text-[11px] font-semibold tracking-label text-gold [text-shadow:0_0_10px_rgba(250,205,104,0.3)]"
          >
            {stageLabel(orbPhase, phase)}
          </span>
        </header>

        {/* The orb: square, centred, small enough to leave the studio in view. Drag to orbit. */}
        <div className="relative mx-auto aspect-square w-full max-w-[300px] sm:max-w-[340px]">
          <div aria-hidden className="pointer-events-none absolute inset-[8%] rounded-full bg-[radial-gradient(circle,rgb(250_205_104_/_10%)_0%,transparent_70%)]" />
          {(visual === 'loading' || visual === 'still') && (
            <img src="/media/render-orb-poster.webp" alt="" aria-hidden className="xr-orb-mask absolute inset-0 h-full w-full object-cover" />
          )}
          {visual === 'video' && (
            <video autoPlay muted loop playsInline poster="/media/render-orb-poster.webp" aria-hidden className="xr-orb-mask absolute inset-0 h-full w-full object-cover">
              <source src="/media/render-orb.mp4" type="video/mp4" />
            </video>
          )}
          <div ref={stage} data-testid="orb-stage" aria-hidden className="xr-orb-mask absolute inset-0 cursor-grab active:cursor-grabbing" />
        </div>

        <dl className="grid grid-cols-2 gap-2 font-mono min-[400px]:grid-cols-4">
          {metrics.map(([label, value, testId, accent]) => (
            <div key={label} className="flex min-w-0 flex-col items-center gap-0.5 rounded-lg border border-line/80 bg-chrome/30 px-1.5 py-2">
              <dt className="text-[10px] tracking-label text-ash">{label}</dt>
              <dd data-testid={testId} className={`whitespace-nowrap text-[11px] font-semibold tabular-nums ${accent ? 'text-gold' : 'text-cloud'}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-baseline justify-between gap-3 font-mono">
          <p id="render-status" aria-live="polite" className="min-w-0 truncate text-[11px] uppercase tracking-label text-gold">{step}</p>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-cloud">
            {percent === null ? '' : locked ? '100.0%' : `${(progress! * 100).toFixed(1)}%`}
          </span>
        </div>
        <div role="progressbar" aria-label="Render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="h-[3px] w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-dim via-gold to-cloud shadow-[0_0_12px_#FACD68] transition-[width] duration-75 ease-linear"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] tracking-label text-ash">LOCAL DSP · NO UPLOAD</span>
          <button ref={cancel} type="button" data-testid="cancel" className="xr-button min-h-11 shrink-0 px-5" disabled={locked} onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="text-[11px] text-ash">Esc or Cancel stops the render; your previous master is kept. Drag the orb to orbit.</p>
      </section>
    </div>,
    document.body,
  );
}
