'use client';

/**
 * Phone action bar: Play and Render stay one tap away at the bottom edge (thumb reach),
 * clear of the home indicator. Desktop has both in view already, so the bar is hidden there.
 */
export function MobileActions({ playing, canPlay, onPlay, canRender, busy, onRender }: {
  playing: boolean; canPlay: boolean; onPlay: () => void;
  canRender: boolean; busy: boolean; onRender: () => void;
}) {
  return (
    <div
      data-testid="mobile-actions"
      className="xr-glass fixed inset-x-0 bottom-0 z-40 flex gap-3 border-t border-[rgb(250_205_104_/_22%)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden"
    >
      <button type="button" data-testid="bar-play" className="xr-button min-h-12 min-w-24" disabled={!canPlay} onClick={onPlay}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" data-testid="bar-render" className="xr-button-primary min-h-12 flex-1" disabled={!canRender || busy} onClick={onRender}>
        {busy ? 'Working…' : 'Render master'}
      </button>
    </div>
  );
}
