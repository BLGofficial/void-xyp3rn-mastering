import type { ProgressOptions } from '../meter';

/** Engine failure with a stable machine-readable code (e.g. `CANCELLED`, `UNSUPPORTED_WAV`). */
export class EngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export const fail = (code: string, message: string): never => {
  throw new EngineError(code, message);
};

/** Structural/format violations of audio input. */
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) fail('UNSUPPORTED_WAV', message);
}

export function check(signal?: AbortSignal): void {
  if (signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
}

/** Cancellation point: check, heartbeat, yield to the event loop, re-check. */
export async function checkpoint(options: ProgressOptions = {}): Promise<void> {
  check(options.signal);
  options.onHeartbeat?.();
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  await (scheduler?.yield ? scheduler.yield() : new Promise<void>(resolve => setTimeout(resolve, 0)));
  check(options.signal);
}

/**
 * Give every failure of a top-level operation a code the UI can act on:
 * allocation failures become MEMORY_WARNING, uncoded errors (and, except for
 * decoding, input-format errors) become the operation's own failure code.
 */
export function coded<A extends unknown[], R>(failureCode: string, fn: (...args: A) => Promise<R>, keepFormatErrors = false) {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof RangeError) fail('MEMORY_WARNING', 'Audio allocation exceeded available memory. Try a shorter file or lower sample rate.');
      const code = (error as { code?: string }).code;
      if (!code || (code === 'UNSUPPORTED_WAV' && !keepFormatErrors)) fail(failureCode, (error as Error).message);
      throw error;
    }
  };
}
