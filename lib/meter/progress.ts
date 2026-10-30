import type { ProgressOptions } from './types';

/** Error carrying a stable code the engine passes through unchanged. */
export const codedError = (code: string, message: string) => Object.assign(new Error(message), { code });

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw codedError('CANCELLED', 'Operation cancelled.');
}

/** Hand the main thread back so long analyses keep the UI responsive. */
export const yieldToEventLoop = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
};

/** Cancellation point: check, heartbeat, yield, re-check (abort may land while yielded). */
export async function checkpoint(options: ProgressOptions): Promise<void> {
  assertNotAborted(options.signal);
  options.onHeartbeat?.();
  await yieldToEventLoop();
  assertNotAborted(options.signal);
}
