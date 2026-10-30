import { XyperMark } from '../brand/XyperMark';

/** Chrome bar + mark/wordmark lockup. Gold on black only (brand rule 01). */
export function Header({ status }: { status: string }) {
  return (
    <header>
      <div className="flex items-center justify-between gap-4 border-b border-gold bg-chrome px-4 py-2 font-mono text-[10px] uppercase tracking-label text-muted md:px-8">
        <span>XYP3RN TECH · MASTERING</span>
        <span className="flex items-center gap-2 text-gold" role="status" aria-live="polite">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold" />
          {status}
        </span>
        <span className="hidden md:inline">Where Music Shapes Technology</span>
      </div>
      <div className="mx-auto flex max-w-[1440px] items-end gap-5 px-4 pb-2 pt-6 md:px-8">
        <XyperMark size={44} />
        <div className="leading-none">
          <span className="block font-display text-[44px] tracking-wide text-gold">XYP3RN</span>
        </div>
        <span className="mb-1 font-display text-[28px] tracking-wide text-cloud">MASTERING</span>
      </div>
    </header>
  );
}
