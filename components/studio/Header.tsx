import { XyperMark } from '../brand/XyperMark';

/** Chrome bar + mark/wordmark lockup (gold on black only, brand rule 01), with the guide controls. */
export function Header({ status, hints, onHints, onGuide }: {
  status: string;
  /** Inline hints printed under every control. */
  hints: boolean; onHints: () => void;
  /** Open the control guide drawer. */
  onGuide: () => void;
}) {
  return (
    <header className="relative z-20">
      <div className="xr-glass flex items-center justify-between gap-4 border-b border-gold px-4 py-2 font-mono text-xs uppercase tracking-label text-muted md:px-8">
        <span>XYP3RN TECH · MASTERING</span>
        <span className="flex items-center gap-2 text-gold" role="status" aria-live="polite">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
          {status}
        </span>
        <span className="hidden md:inline">Where Music Shapes Technology</span>
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-end gap-x-5 gap-y-3 px-4 pb-3 pt-6 md:px-8">
        <div className="flex items-end gap-5">
          <XyperMark size={44} />
          <h1 className="flex items-end gap-5 leading-none">
            <span className="block font-display text-[44px] tracking-wide text-gold">XYP3RN</span>
            <span className="mb-1 font-display text-[28px] tracking-wide text-cloud">MASTERING</span>
          </h1>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <button type="button" data-testid="hints-toggle" aria-pressed={hints} className={`xr-button min-h-11 px-4 ${hints ? 'border-gold text-gold' : ''}`} onClick={onHints}>
            {/* Fixed name with aria-pressed; the on/off word is visual only. */}
            Hints <span aria-hidden className={hints ? 'text-gold' : 'text-muted'}>{hints ? 'On' : 'Off'}</span>
          </button>
          <button type="button" data-testid="guide-open" aria-haspopup="dialog" className="xr-button min-h-11 px-4" onClick={onGuide}>
            Control guide
          </button>
        </div>
      </div>
    </header>
  );
}
