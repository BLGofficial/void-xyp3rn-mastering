import { MARK_PATH, MARK_VIEWBOX } from '@/components/brand/mark-path';

/**
 * App-start splash, server-rendered into the static HTML so it paints before any JavaScript.
 * Pure CSS: the mark draws in gold, fills, takes one light sweep, the wordmark tracks in.
 * It lifts when BootHandoff marks the studio ready, or on its own at the CSS cap, so it can
 * never hold the app hostage. Reduced motion skips it entirely.
 */
export function BootSplash() {
  return (
    <div id="xr-splash" data-testid="boot-splash" aria-hidden="true">
      <div className="xr-splash-glow" />
      <div className="xr-splash-stage">
        <svg className="xr-splash-mark" viewBox={MARK_VIEWBOX} role="presentation">
          <defs>
            <linearGradient id="xr-splash-sheen" gradientUnits="objectBoundingBox" x1="-1" y1="0" x2="0" y2="0.35">
              <stop offset="0" stopColor="#FACD68" stopOpacity="0" />
              <stop offset="0.5" stopColor="#E8E8E8" stopOpacity="0.85" />
              <stop offset="1" stopColor="#FACD68" stopOpacity="0" />
              <animate attributeName="x1" values="-1;1" dur="0.9s" begin="0.55s" fill="freeze" />
              <animate attributeName="x2" values="0;2" dur="0.9s" begin="0.55s" fill="freeze" />
            </linearGradient>
          </defs>
          <path className="xr-splash-stroke" d={MARK_PATH} pathLength={1} vectorEffect="non-scaling-stroke" />
          <path className="xr-splash-fill" d={MARK_PATH} fillRule="evenodd" />
          <path className="xr-splash-sweep" d={MARK_PATH} fillRule="evenodd" fill="url(#xr-splash-sheen)" />
        </svg>
        <p className="xr-splash-word">
          <span className="xr-splash-xyp">XYP3RN</span>
          <span className="xr-splash-mastering">MASTERING</span>
        </p>
        <div className="xr-splash-line"><span /></div>
      </div>
    </div>
  );
}

/** Runs before first paint: repeat visits get the short splash. */
export const BOOT_SCRIPT = `try{if(localStorage.getItem('xyp3rn.booted'))document.documentElement.dataset.bootRepeat='1'}catch(e){}`;
