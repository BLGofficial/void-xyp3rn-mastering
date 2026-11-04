'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XyperMark } from '@/components/brand/XyperMark';
import type { XYP3RNMasteringOrb } from '@/components/orb/XYP3RNMasteringOrb';

/** What fills the background: the WebGL orb, the video fallback, or a still (reduced motion / loading). */
type Visual = 'loading' | 'webgl' | 'video' | 'still';

/** Block RMS -> 0..1 orb energy: -42 dBFS reads as silence, -6 dBFS as full punch. */
const energy = (rms: number) => (rms > 0 ? Math.max(0, Math.min(1, (20 * Math.log10(rms) + 42) / 36)) : 0);

/**
 * Full-screen render state: the orb fills the viewport while the engine works.
 * Modal by design (the chain must not change under a running render), so it
 * always offers its way out: Cancel, focused on open, and Esc. Cancelling keeps
 * the previous master.
 */
export function RenderOverlay({ open, status, progress, level, onCancel }: {
  open: boolean; status: string; progress: number | null;
  /** RMS of the audio being rendered, for the orb's transient response. */
  level: number; onCancel: () => void;
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

  return createPortal(
    <div
      data-testid="render-orb" data-orb={visual} role="dialog" aria-modal="true" aria-labelledby="render-title" aria-describedby="render-status"
      className="xr-overlay-in fixed inset-0 z-[100] overflow-hidden bg-studio"
    >
      {(visual === 'loading' || visual === 'still') && (
        <img src="/media/render-orb-poster.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      )}
      {visual === 'video' && (
        <video autoPlay muted loop playsInline poster="/media/render-orb-poster.webp" aria-hidden className="absolute inset-0 h-full w-full object-cover">
          <source src="/media/render-orb.mp4" type="video/mp4" />
        </video>
      )}
      <div ref={stage} data-testid="orb-stage" aria-hidden className="absolute inset-0" />
      {/* Scrim: keeps the readout legible over the brightest frames of the orb. */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/50" />

      <div className="relative flex h-full flex-col justify-between px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] md:px-10">
        <div className="flex items-center gap-3">
          <XyperMark size={28} />
          <span className="font-display text-2xl tracking-wide text-cloud">XYP3RN MASTERING</span>
        </div>

        {/* Glass panel: the readout keeps its contrast over the brightest frames of the orb. */}
        <div className="xr-glass mx-auto w-full max-w-2xl space-y-4 border border-line p-5 backdrop-blur-md md:p-7">
          <h2 id="render-title" className="font-display text-5xl leading-none text-cloud md:text-6xl">Mastering</h2>
          <p id="render-status" aria-live="polite" className="min-h-[1.5em] font-mono text-sm uppercase tracking-label text-gold">{step}</p>
          <div className="flex items-center gap-3">
            <progress className="block h-1.5 w-full" max={1} value={progress ?? undefined} aria-label="Render progress" />
            <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-cloud">
              {percent === null ? '' : percent < 100 ? `${percent}%` : 'finishing'}
            </span>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ash">Esc or Cancel stops the render. Your previous master is kept.</p>
            <button ref={cancel} type="button" data-testid="cancel" className="xr-button min-h-11 px-8" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
