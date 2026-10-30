// Readout formatting. Typographic minus so columns of negative dB values align.

const MINUS = '−';

/** Fixed-decimal number with a typographic minus; em dash for missing/non-finite. */
export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === -Infinity) return `${MINUS}∞`;
  if (value === Infinity) return '∞';
  const s = value.toFixed(digits);
  return s.startsWith('-') ? MINUS + s.slice(1) : s;
}

/** m:ss.t */
export function time(seconds: number): string {
  const s = Math.max(0, seconds), m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Human file size. */
export function bytes(n: number): string {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** Parameter value with its unit for slider readouts. */
export function param(value: number, step: number, unit: string): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return unit ? `${num(value, digits)} ${unit}` : num(value, digits);
}
