import { MARK_PATH, MARK_VIEWBOX } from './mark-path';

/** Brand rule: gold #FACD68 on Studio Black only, never recoloured, never below 24 px. */
const GOLD = '#FACD68';
const MIN_SIZE = 24;

/**
 * The XYP3RN interlocking-X mark.
 * @param size Rendered height in px (clamped to the 24 px brand minimum).
 */
export function XyperMark({ size = 32, className }: { size?: number; className?: string }) {
  const height = Math.max(MIN_SIZE, size);
  return (
    <svg role="img" aria-label="XYP3RN" viewBox={MARK_VIEWBOX} height={height} className={className} style={{ width: 'auto' }}>
      <path fill={GOLD} fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
