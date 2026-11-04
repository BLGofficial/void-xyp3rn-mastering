import { describe, expect, it } from 'vitest';
import { defaultState, type ChainState } from '../lib/dsp';
import { createBuffer, renderChain, renderToTarget, type BlockTelemetry, type EnginePhase } from '../lib/engine';
import { program } from './signals';

const RATE = 44100;

function source(seconds = 2) {
  const b = createBuffer(RATE, 2, RATE * seconds);
  program(RATE, seconds, 2, 0.45).forEach((ch, c) => b.channels[c]!.set(ch));
  return b;
}

/** Every module on; optionally drive the trim so the compressor and limiter work hard. */
function chain(driveDb = 0): ChainState {
  const state = defaultState();
  for (const p of state.processors) {
    p.bypassed = false;
    if (p.id === 'trim') p.parameters.gainDb = driveDb;
  }
  return state;
}

const collect = () => {
  const blocks: BlockTelemetry[] = [], phases: EnginePhase[] = [], ticks: number[] = [];
  return {
    blocks, phases, ticks,
    options: { onBlock: (b: BlockTelemetry) => blocks.push(b), onPhase: (p: EnginePhase) => phases.push(p), onProgress: (f: number) => ticks.push(f) },
  };
};

describe('render telemetry (drives the render overlay orb)', () => {
  it('reports level, peak and gain reduction per block without changing the audio', async () => {
    const state = chain();
    const plain = await renderChain(source(), state);
    const t = collect();
    const fed = await renderChain(source(), state, t.options);
    // Bit-identical output: telemetry only observes.
    fed.channels.forEach((ch, c) => expect(Buffer.compare(Buffer.from(ch.buffer), Buffer.from(plain.channels[c]!.buffer))).toBe(0));
    // One reading per rendered block, alongside its progress tick.
    expect(t.blocks.length).toBe(t.ticks.length);
    expect(t.blocks.length).toBeGreaterThan(5);
    for (const b of t.blocks) {
      expect(Number.isFinite(b.rms) && b.rms >= 0 && b.rms <= 2).toBe(true);
      expect(b.peak).toBeGreaterThanOrEqual(b.rms);
      expect(Number.isFinite(b.reductionDb) && b.reductionDb >= 0).toBe(true);
    }
    expect(Math.max(...t.blocks.map(b => b.rms))).toBeGreaterThan(0.01);
    expect(t.phases).toEqual([{ phase: 'render' }]);
  });

  it('measures the gain reduction the dynamics actually apply', async () => {
    const gentle = collect(), driven = collect();
    await renderChain(source(), defaultState(), gentle.options); // compressor, clipper and limiter bypassed
    await renderChain(source(), chain(12), driven.options);
    expect(gentle.blocks.every(b => b.reductionDb === 0)).toBe(true);
    // +12 dB into a -1 dB limiter and a -18 dB threshold compressor: several dB of real reduction.
    expect(Math.max(...driven.blocks.map(b => b.reductionDb))).toBeGreaterThan(3);
  });

  it('names each stage of a loudness-targeted render in order', async () => {
    const state = chain();
    state.loudnessTarget = { targetLufs: -14, correctionDb: 0 };
    state.outputCeilingDbtp = -1;
    const t = collect();
    await renderToTarget(source(), state, t.options);
    expect(t.phases[0]).toEqual({ phase: 'render' });
    const measures = t.phases.filter(p => p.phase === 'measure');
    expect(measures[0]).toEqual({ phase: 'measure', pass: 0, passes: 4 });
    // Every loudness pass checks true peak before it measures again.
    t.phases.forEach((p, i) => { if (p.phase === 'measure' && p.pass !== undefined) expect(t.phases[i + 1]).toEqual({ phase: 'peak' }); });
    expect(measures.map(p => p.pass)).toEqual(measures.map((_, i) => i));
  });

  it('reads silence as zero', async () => {
    const t = collect();
    await renderChain(createBuffer(RATE, 2, RATE), defaultState(), t.options);
    expect(t.blocks.length).toBeGreaterThan(0);
    expect(t.blocks.every(b => b.rms === 0 && b.peak === 0 && b.reductionDb === 0)).toBe(true);
  });
});
