'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XyperMark } from '@/components/brand/XyperMark';

/**
 * Full-screen render state: the orb fills the viewport while the engine works.
 * Modal by design (the chain must not change under a running render), so it
 * always offers its way out: Cancel, focused on open, and Esc. Cancelling keeps
 * the previous master.
 */
export function RenderOverlay({ open, status, progress, onCancel }: {
  open: boolean; status: string; progress: number | null; onCancel: () => void;
}) {
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

  if (!open || typeof document === 'undefined') return null;
  const percent = progress === null ? null : Math.round(progress * 100);
  const step = status.replace(/^Engine:\s*/, '') || 'Rendering…';

  return createPortal(
    <div
      data-testid="render-orb" role="dialog" aria-modal="true" aria-labelledby="render-title" aria-describedby="render-status"
      className="xr-overlay-in fixed inset-0 z-[100] overflow-hidden bg-studio"
    >
      <video autoPlay muted loop playsInline poster="/media/render-orb-poster.webp" aria-hidden className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden">
        <source src="/media/render-orb.mp4" type="video/mp4" />
      </video>
      <img src="/media/render-orb-poster.webp" alt="" aria-hidden className="absolute inset-0 hidden h-full w-full object-cover motion-reduce:block" />
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
