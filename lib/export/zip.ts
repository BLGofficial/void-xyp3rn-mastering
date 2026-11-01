import type { ZipEntry } from './types';

export async function zip(_entries: ZipEntry[], _date: string, _signal?: AbortSignal): Promise<Blob> {
  throw new Error('not yet (phase 5 stub)');
}
