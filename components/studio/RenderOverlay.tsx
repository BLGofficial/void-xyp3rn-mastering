'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XyperMark } from '@/components/brand/XyperMark';
import type { XYP3RNMasteringOrb } from '@/components/orb/XYP3RNMasteringOrb';

/** What fills the background: the WebGL orb, the video fallback, or a still (reduced motion / loading). */
type Visual = 'loading' | 'webgl' | 'video' | 'still';

const lufs = (v: number) => v.toFixed(1).replace('-', '\u2212');

/** Block RMS -> 0..1 orb energy: -42 dBFS reads as silence, -6 dBFS as full punch. */
const energy = (rms: number) => (rms > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 42) / 36)) : 0);

/**
 * Full-screen render state: the orb fills the viewport while the engine works.
 * Modal by design (the chain must not change under a running render), so it
 * always offers its way out: Cancel, focused on open, and Esc. Cancelling keeps
 * the previous master.
 */
export function RenderOverlay({ open, status, progress, level, sourceLufs, targetLufs, onCancel }: {
  open: boolean; status: string; progress: number | null;
  /** RMS of the audio being rendered, for the orb's transient response and the LEVEL readout. */
  level: number;
  /** Measured integrated loudness of the source, and the render's target (null = off). */
  sourceLufs: number | null; targetLufs: number | null;
  onCancel: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const orb = useRef<XYP3RNMasteringOrb | null>(null);
  const locked = useRef(false);
  const [visual, setVisual] = useState<Visual>('loading');
  const cancel = useRef<HTMLButtonElement>(null);
  // Latest handler without re-running the open/close effect on every progress tick.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // The orb (three.js, ~150 kB gz) loads only when a render starts and is torn down
  // with its GPU context when it ends. No WebGL -> the looping video instead.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setVisual('still'); return; }
    let disposed = false;
    setVisual('loading');
    locked.current = false;
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
  }, [open]);

  useEffect(() => {
    orb.current?.setProgress(progress ?? 0);
    // Rendering done, final checks running: the master is locked in.
    if (progress !== null && progress >= 1 && !locked.current) {
      locked.current = true;
      orb.current?.triggerLockPulse();
    }
  }, [progress, visual]);

  useEffect(() => {
    orb.current?.setTransient(energy(level));
    // Exposed for diagnostics and e2e: proves the engine's level feed reaches the orb.
    if (stage.current) stage.current.dataset.energy = energy(level).toFixed(2);
  }, [level]);

  if (!open || typeof document === 'undefined') return null;
  const percent = progress === null ? null : Math.round(progress * 100);
  const step = status.replace(/^Engine:\s*/, '') || 'Rendering…';

  const locking = percent !== null && percent >= 100;
  // Every readout is measured: source loudness, the requested target, the live level of
  // the block being rendered, and the engine's own step. Nothing here is simulated.
  const levelDb = level > 0 ? 20 * Math.log10(level) : null;
  const metrics: [label: string, value: string, testId: string, accent?: boolean][] = [
    ['SYS', locking ? 'LOCKING' : 'RENDER', 'orb-sys', true],
    ['SOURCE', sourceLufs === null ? '—' : `${lufs(sourceLufs)} LUFS`, 'orb-source'],
    ['TARGET', targetLufs === null ? 'OFF' : `${lufs(targetLufs)} LUFS`, 'orb-target', true],
    ['LEVEL', levelDb === null ? '—' : `${lufs(levelDb)} dB`, 'orb-level'],
  ];

  return createPortal(
    <div
      data-testid="render-orb" data-orb={visual} role="dialog" aria-modal="true" aria-labelledby="render-title" aria-describedby="render-status"
      className="xr-overlay-in fixed inset-0 z-[100] overflow-hidden bg-[radial-gradient(circle_at_center,#16120a_0%,#080808_65%,#000_100%)]"
    >
      {(visual === 'loading' || visual === 'still') && (
        <img src="/media/render-orb-poster.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      )}
      {visual === 'video' && (
        <video autoPlay muted loop playsInline poster="/media/render-orb-poster.webp" aria-hidden className="absolute inset-0 h-full w-full object-cover">
          <source src="/media/render-orb.mp4" type="video/mp4" />
        </video>
      )}
      {/* Drag to orbit the orb: the layers above pass pointer events through. */}
      <div ref={stage} data-testid="orb-stage" aria-hidden className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />
      <h2 id="render-title" className="sr-only">Mastering</h2>

      <div className="pointer-events-none relative flex h-full flex-col items-center justify-between px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        {/* Telemetry bar */}
        <dl className="pointer-events-auto flex w-full max-w-[460px] justify-between gap-3 rounded-lg border border-line-card bg-panel/90 px-4 py-2.5 font-mono shadow-[0_10px_30px_rgba(0,0,0,0.8)] backdrop-blur-md">
          {metrics.map(([label, value, testId, accent]) => (
            <div key={label} className="flex min-w-0 flex-col items-center gap-0.5">
              <dt className="text-[9px] tracking-label text-ash">{label}</dt>
              <dd data-testid={testId} className={`whitespace-nowrap text-[11px] font-semibold tabular-nums ${accent ? 'text-gold [text-shadow:0_0_10px_rgba(250,205,104,0.3)]' : 'text-cloud'}`}>{value}</dd>
            </div>
          ))}
        </dl>

        {/* Render dock */}
        <div className="pointer-events-auto flex w-full max-w-[460px] flex-col gap-2.5 rounded-xl border border-line-card bg-surface/90 px-4 py-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-md">
          <div className="flex items-baseline justify-between gap-3 font-mono">
            <p id="render-status" aria-live="polite" className="min-w-0 truncate text-[11px] uppercase tracking-label text-gold">{step}</p>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-cloud">
              {percent === null ? '' : `${(progress! * 100).toFixed(1)}%`}
            </span>
          </div>
          <div role="progressbar" aria-label="Render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} className="h-[3px] w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold-dim via-gold to-cloud shadow-[0_0_12px_#FACD68] transition-[width] duration-75 ease-linear"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-mono text-[10px] tracking-label text-ash">
              <XyperMark size={24} /> <span><span className="hidden sm:inline">XYP3RN MASTERING · </span>LOCAL DSP</span>
            </span>
            <button ref={cancel} type="button" data-testid="cancel" className="xr-button min-h-11 shrink-0 px-5" onClick={onCancel}>
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-muted">Esc or Cancel stops the render; your previous master is kept. Drag to orbit.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
