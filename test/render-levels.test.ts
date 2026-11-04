import { describe, expect, it } from 'vitest';
import { defaultState } from '../lib/dsp';
import { createBuffer, renderChain } from '../lib/engine';
import { program } from './signals';

const RATE = 44100;

function source(seconds = 2) {
  const b = createBuffer(RATE, 2, RATE * seconds);
  program(RATE, seconds, 2, 0.45).forEach((ch, c) => b.channels[c]!.set(ch));
  return b;
}

describe('render level feed (drives the render overlay)', () => {
  it('reports one finite, non-negative RMS per block without changing the audio', async () => {
    const state = defaultState();
    for (const p of state.processors) p.bypassed = false;
    const plain = await renderChain(source(), state);
    const levels: number[] = [], ticks: number[] = [];
    const fed = await renderChain(source(), state, { onLevel: (rms: number) => levels.push(rms), onProgress: (f: number) => ticks.push(f) });
    // Bit-identical output: the feed only observes.
    fed.channels.forEach((ch, c) => expect(Buffer.compare(Buffer.from(ch.buffer), Buffer.from(plain.channels[c]!.buffer))).toBe(0));
    // One reading per rendered block, alongside its progress tick.
    expect(levels.length).toBe(ticks.length);
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.every(v => Number.isFinite(v) && v >= 0 && v <= 2)).toBe(true);
    expect(Math.max(...levels)).toBeGreaterThan(0.01);
  });

  it('reads silence as zero', async () => {
    const levels: number[] = [];
    await renderChain(createBuffer(RATE, 2, RATE), defaultState(), { onLevel: (rms: number) => levels.push(rms) });
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every(v => v === 0)).toBe(true);
  });
});
