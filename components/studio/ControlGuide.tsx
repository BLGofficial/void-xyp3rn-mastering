'use client';

import { useEffect, useRef } from 'react';
import { GUIDE } from '@/lib/guide';

/**
 * The full control guide as a side drawer. Native modal <dialog>: the browser
 * provides the focus trap, Esc, an inert page behind it and focus return on close.
 */
export function ControlGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog} aria-labelledby="guide-title" onClose={onClose}
      // The content fills the dialog box, so a click that lands on the dialog itself is on the backdrop.
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="xr-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-[440px] overflow-hidden border-0 border-l border-line-card bg-panel p-0 text-cloud backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-gold px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div>
            <h2 id="guide-title" className="font-display text-[28px] leading-none tracking-wide text-gold">Control guide</h2>
            <p className="mt-1.5 text-xs text-ash">What each control does, and why. Nothing here changes the sound.</p>
          </div>
          <button type="button" autoFocus className="xr-button min-h-11 shrink-0 px-4" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
          {GUIDE.map(section => (
            <section key={section.title} aria-labelledby={`guide-${slug(section.title)}`} className="border-b border-line py-4 last:border-b-0">
              <h3 id={`guide-${slug(section.title)}`} className="font-mono text-xs uppercase tracking-label text-gold">{section.title}</h3>
              {section.intro && <p className="mt-1.5 text-xs text-ash">{section.intro}</p>}
              <dl className="mt-3 space-y-3">
                {section.entries.map(entry => (
                  <div key={entry.key} data-guide-entry={entry.key}>
                    <dt className="font-heading text-sm font-bold text-cloud">{entry.label}</dt>
                    <dd className="mt-0.5 text-[13px] leading-relaxed text-ash">{entry.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
