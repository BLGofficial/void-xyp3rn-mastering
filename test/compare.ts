import { expect } from 'vitest';

// UI/provenance strings are ours to word; only whether a reason exists is behaviour.
const SKIP_KEYS = new Set(['method', 'version', 'transientMethod', 'note', 'confidenceMethod']);
const PRESENCE_KEYS = new Set(['reason']);

/**
 * Structural deep comparison with relative numeric tolerance. Non-finite numbers
 * (±Infinity for silence) must match exactly; `null` is distinct from -Infinity.
 */
export function expectClose(actual: unknown, expected: unknown, tol = 1e-9, path = '$'): void {
  if (typeof expected === 'number') {
    expect(typeof actual, `${path} type`).toBe('number');
    const a = actual as number;
    if (!Number.isFinite(expected) || !Number.isFinite(a)) {
      expect(Object.is(a, expected) || (Number.isNaN(a) && Number.isNaN(expected)), `${path}: ${a} vs ${expected}`).toBe(true);
      return;
    }
    expect(Math.abs(a - expected), `${path}: ${a} vs ${expected}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(expected)));
    return;
  }
  if (Array.isArray(expected) || ArrayBuffer.isView(expected)) {
    const e = Array.from(expected as ArrayLike<unknown>);
    expect(Array.isArray(actual) || ArrayBuffer.isView(actual), `${path} is array`).toBe(true);
    const a = Array.from(actual as ArrayLike<unknown>);
    expect(a.length, `${path}.length`).toBe(e.length);
    e.forEach((v, i) => expectClose(a[i], v, tol, `${path}[${i}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    expect(actual && typeof actual === 'object', `${path} is object`).toBe(true);
    const a = actual as Record<string, unknown>, e = expected as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
    for (const k of keys) {
      if (SKIP_KEYS.has(k)) continue;
      if (PRESENCE_KEYS.has(k)) expect(Boolean(a[k]), `${path}.${k} presence`).toBe(Boolean(e[k]));
      else expectClose(a[k], e[k], tol, `${path}.${k}`);
    }
    return;
  }
  expect(actual, path).toEqual(expected);
}

/** A rejection only counts if it is a real error, not an unimplemented stub. */
export async function expectRejectsAsync(action: () => Promise<unknown>, label = 'must reject') {
  let error: unknown;
  try {
    await action();
  } catch (e) {
    error = e;
  }
  expect(error, label).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/\(phase \w+ stub\)/);
}

/** Upstream codes carry a product prefix; ours are bare. Strings elsewhere are compared as-is. */
export function stripPrefix<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/^VOID_/, '') as T;
  if (Array.isArray(value)) return value.map(stripPrefix) as T;
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPrefix(v)])) as T;
  }
  return value;
}

export const codeOf = (e: unknown) => String((e as { code?: unknown })?.code ?? '').replace(/^VOID_/, '');
async function capture(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}
/** Both must fail with the same (prefix-stripped) code; a stub's error never counts. */
export async function expectSameFailure(ref: () => unknown, got: () => unknown) {
  const r = await capture(ref), g = await capture(got);
  expect(r, 'must fail upstream').toBeInstanceOf(Error);
  expect(g, 'must fail').toBeInstanceOf(Error);
  expect((g as Error).message).not.toMatch(/\(phase \w+ stub\)/);
  expect(codeOf(g), `code (upstream: ${(r as Error).message})`).toBe(codeOf(r));
}
