import { describe, expect, it } from 'vitest';
import * as mine from '../lib/dsp';
import type { ChainOptions, ChainState, FilterType, ProcessorId } from '../lib/dsp';
import { loadOracle, ORACLE_DSP_VERSION } from './oracle';
import { impulse, program, sweep, type Signal } from './signals';

const oracle = loadOracle();

// Both engines run in float64; an independent implementation may reorder
// arithmetic, so demand agreement far below audibility (−180 dBFS), not bit equality.
const TOL = 1e-9;
// AudioWorklet render quantum: settings changes land on block boundaries.
const BLOCK = 128;

type Mod = { id: ProcessorId; params?: Record<string, number>; bypassed?: boolean };
type RenderChain = { latency: number; update(s: ChainState): void; processBlock(i: ArrayLike<number>[], o: Float64Array[], n: number): void };
type ChainCtor = new (s: ChainState, rate: number, channels: number, o?: ChainOptions) => RenderChain;
type Automation = { atFrame: number; state: ChainState };

/** Build a chain via the oracle's own validator so every test case is known-valid upstream. */
function chainOf(mods: Mod[], extra: Partial<ChainState> = {}): ChainState {
  return oracle.validateState({
    ...oracle.defaultState(),
    ...extra,
    processors: mods.map((m, i) => {
      const base = oracle.createState(m.id, `slot-${i + 1}`, m.bypassed ?? false);
      return { ...base, parameters: { ...base.parameters, ...m.params } };
    }),
  });
}

function render(Ctor: ChainCtor, state: ChainState, input: Signal, rate: number, options: ChainOptions = {}, automation: Automation[] = []) {
  const frames = input[0]!.length;
  const chain = new Ctor(structuredClone(state), rate, input.length, options);
  const output = input.map(() => new Float64Array(frames));
  const pending = [...automation].sort((a, b) => a.atFrame - b.atFrame);
  for (let pos = 0; pos < frames; pos += BLOCK) {
    while (pending.length && pending[0]!.atFrame <= pos) chain.update(structuredClone(pending.shift()!.state));
    const n = Math.min(BLOCK, frames - pos);
    chain.processBlock(input.map(c => c.subarray(pos, pos + n)), output.map(c => c.subarray(pos, pos + n)), n);
  }
  return { latency: chain.latency, output };
}

function expectParity(actual: Signal, expected: Signal, tol = TOL) {
  expect(actual.length).toBe(expected.length);
  let worst = { diff: 0, c: 0, i: 0 }, energy = 0;
  expected.forEach((ref, c) => {
    const got = actual[c]!;
    expect(got.length).toBe(ref.length);
    for (let i = 0; i < ref.length; i++) {
      energy += ref[i]! * ref[i]!;
      const diff = Math.abs(got[i]! - ref[i]!);
      if (!(diff <= worst.diff)) worst = { diff, c, i };
    }
  });
  // A silent reference would make parity vacuous.
  expect(energy).toBeGreaterThan(0);
  const { c, i } = worst;
  expect(worst.diff, `max |Δ| ${worst.diff.toExponential(3)} at ch${c}[${i}]: mine ${actual[c]![i]} vs ref ${expected[c]![i]}`).toBeLessThanOrEqual(tol);
}

/** A rejection only counts if it is a real validation error, not an unimplemented stub. */
function expectRejects(action: () => unknown, label = 'must throw') {
  let error: unknown;
  try { action(); } catch (e) { error = e; }
  expect(error, label).toBeInstanceOf(Error);
  expect((error as Error).message).not.toMatch(/\(phase \w+ stub\)/);
}

function expectRenderParity(state: ChainState, input: Signal, rate: number, options: ChainOptions = {}, automation: Automation[] = []) {
  const ref = render(oracle.Chain, state, input, rate, options, automation);
  const got = render(mine.Chain as unknown as ChainCtor, state, input, rate, options, automation);
  expect(got.latency, 'latency (samples)').toBe(ref.latency);
  expectParity(got.output, ref.output);
}

describe('oracle pin', () => {
  it(`reference engine is ${ORACLE_DSP_VERSION}`, () => {
    expect(oracle.VERSION).toBe(ORACLE_DSP_VERSION);
  });
});

describe('parameter schema', () => {
  it('exposes the same processors in the same order', () => {
    expect(Object.keys(mine.DEFINITIONS)).toEqual(Object.keys(oracle.DEFINITIONS));
  });

  // Labels and module names are ours to brand; ranges/defaults/steps/units are the sound.
  it.each(Object.keys(oracle.DEFINITIONS) as ProcessorId[])('%s parameters match ranges, defaults, steps and units', id => {
    const strip = (defs: typeof oracle.DEFINITIONS) =>
      Object.entries(defs[id].parameters).map(([key, { min, max, default: d, step, unit }]) => ({ key, min, max, default: d, step, unit }));
    expect(strip(mine.DEFINITIONS)).toEqual(strip(oracle.DEFINITIONS));
  });
});

describe('state', () => {
  const comparable = (s: ChainState) => ({
    schemaVersion: s.schemaVersion, quality: s.quality, outputCeilingDbtp: s.outputCeilingDbtp,
    loudnessTarget: s.loudnessTarget, processors: s.processors,
  });

  it('defaultState matches', () => {
    expect(comparable(mine.defaultState())).toEqual(comparable(oracle.defaultState()));
  });

  it.each(Object.keys(oracle.DEFINITIONS) as ProcessorId[])('createState(%s) matches', id => {
    expect(mine.createState(id, 'slot-7', false)).toEqual(oracle.createState(id, 'slot-7', false));
    expect(mine.createState(id, 'slot-8')).toEqual(oracle.createState(id, 'slot-8'));
  });

  const accepted: Array<[string, unknown]> = [
    ['default v3', oracle.defaultState()],
    ['v1 legacy: no instanceIds, pre-adaptive dynamics, pre-true-peak limit', {
      schemaVersion: 1,
      processors: [
        { id: 'dynamics', version: 1, bypassed: false, parameters: { thresholdDb: -20, ratio: 3, kneeDb: 4, attackMs: 10, releaseMs: 120, makeupDb: 1 } },
        { id: 'limit', version: 1, bypassed: false, parameters: { ceilingDb: -1, releaseMs: 80 } },
      ],
    }],
    ['v3 studio + output ceiling + loudness target', chainOf([{ id: 'eq' }, { id: 'limit', params: { truePeak: 1 } }],
      { quality: 'studio', outputCeilingDbtp: -1, loudnessTarget: { targetLufs: -14, correctionDb: -3.2 } })],
  ];
  it.each(accepted)('validateState normalizes %s identically', (_, input) => {
    expect(comparable(mine.validateState(structuredClone(input)))).toEqual(comparable(oracle.validateState(structuredClone(input))));
  });

  const eq = () => oracle.createState('eq', 'slot-1', false);
  const v3 = (patch: Record<string, unknown>) => ({ ...oracle.defaultState(), ...patch });
  const rejected: Array<[string, unknown]> = [
    ['null', null],
    ['schemaVersion 4', v3({ schemaVersion: 4 })],
    ['unknown module', v3({ processors: [{ ...eq(), id: 'exciter' }] })],
    ['param above max', v3({ processors: [{ ...eq(), parameters: { ...eq().parameters, lowDb: 12.1 } }] })],
    ['param NaN', v3({ processors: [{ ...eq(), parameters: { ...eq().parameters, midQ: Number.NaN } }] })],
    ['missing param', v3({ processors: [{ ...eq(), parameters: { lowDb: 0 } }] })],
    ['extra param', v3({ processors: [{ ...eq(), parameters: { ...eq().parameters, tiltDb: 1 } }] })],
    ['extra module field', v3({ processors: [{ ...eq(), color: 'red' }] })],
    ['extra top-level field', v3({ tempo: 120 })],
    ['duplicate instanceId', v3({ processors: [eq(), eq()] })],
    ['bad instanceId chars', v3({ processors: [{ ...eq(), instanceId: 'slot 1' }] })],
    ['33 modules', v3({ processors: Array.from({ length: 33 }, (_, i) => oracle.createState('trim', `s${i}`)) })],
    ['fractional mode switch', v3({ processors: [{ ...oracle.createState('dynamics', 'd'), parameters: { ...oracle.createState('dynamics', 'd').parameters, adaptive: 0.5 } }] })],
    ['loudness target out of range', v3({ loudnessTarget: { targetLufs: -30, correctionDb: 0 } })],
    ['unknown quality', v3({ quality: 'ultra' })],
    ['output ceiling above -0.1', v3({ outputCeilingDbtp: 0 })],
    ['incompatible engine version', v3({ engineVersion: '1.0.0' })],
    ['incompatible module version', v3({ processors: [{ ...eq(), moduleVersion: '2.0.0' }] })],
  ];
  it.each(rejected)('validateState rejects %s', (_, input) => {
    expect(() => oracle.validateState(structuredClone(input)), 'case must be invalid upstream').toThrow();
    expectRejects(() => mine.validateState(structuredClone(input)));
  });
});

describe('biquad coefficients', () => {
  const types: FilterType[] = ['low', 'peak', 'high'];
  const rates = [22050, 44100, 48000, 96000];
  it.each(types.flatMap(t => rates.map(r => [t, r] as const)))('%s @ %d Hz', (type, rate) => {
    // 30 kHz exceeds 0.45·rate at every rate here: exercises the Nyquist clamp.
    for (const hz of [20, 30, 120, 1000, 8000, 18000, 30000])
      for (const db of [-12, -3.5, 0, 0.1, 12])
        for (const q of [0.3, 1, 6]) {
          const ref = oracle.coefficients(type, hz, db, q, rate), got = mine.coefficients(type, hz, db, q, rate);
          ref.forEach((r, k) => expect(Math.abs(got[k]! - r), `${type} ${hz}Hz ${db}dB Q${q} @${rate} coeff[${k}]`).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(r))));
        }
  });
});

describe('tailSeconds', () => {
  const cases: Array<[string, ChainState]> = [
    ['dry chain', oracle.defaultState()],
    ['reverb long', chainOf([{ id: 'reverb', params: { amount: 0.1, decay: 4, preDelayMs: 100 } }])],
    ['echo no feedback', chainOf([{ id: 'echo', params: { amount: 0.2, timeMs: 400, feedback: 0 } }])],
    ['echo max feedback hits 8 s cap', chainOf([{ id: 'echo', params: { amount: 0.2, timeMs: 1000, feedback: 0.65 } }])],
    ['reverb + echo', chainOf([{ id: 'reverb', params: { amount: 0.05 } }, { id: 'echo', params: { amount: 0.1 } }])],
    ['bypassed reverb', chainOf([{ id: 'reverb', params: { amount: 0.2 }, bypassed: true }])],
    ['zero-amount echo', chainOf([{ id: 'echo', params: { amount: 0 } }])],
  ];
  it.each(cases)('%s', (_, state) => {
    expect(mine.tailSeconds(state)).toBeCloseTo(oracle.tailSeconds(state), 12);
  });
});

describe('render parity: single module', () => {
  type Case = { name: string; mods: Mod[]; rate?: number; channels?: number; signal?: 'program' | 'sweep' | 'impulse'; seconds?: number; extra?: Partial<ChainState> };
  const cases: Case[] = [
    { name: 'trim -24 dB', mods: [{ id: 'trim', params: { gainDb: -24 } }] },
    { name: 'trim +6.5 dB mono', mods: [{ id: 'trim', params: { gainDb: 6.5 } }], channels: 1 },
    { name: 'eq mastering curve', mods: [{ id: 'eq', params: { lowDb: 3, lowHz: 80, midDb: -2.5, midHz: 2500, midQ: 1.4, highDb: 2, highHz: 10000 } }], signal: 'sweep' },
    { name: 'eq extremes', mods: [{ id: 'eq', params: { lowDb: -12, lowHz: 30, midDb: 12, midHz: 12000, midQ: 6, highDb: 12, highHz: 18000 } }], signal: 'sweep', rate: 96000 },
    { name: 'eq above Nyquist clamp @22.05k', mods: [{ id: 'eq', params: { midDb: 6, midHz: 12000, midQ: 0.3, highDb: -6, highHz: 18000 } }], signal: 'sweep', rate: 22050 },
    { name: 'dynamics gentle legacy detector', mods: [{ id: 'dynamics', params: { thresholdDb: -18, ratio: 2, kneeDb: 6, attackMs: 20, releaseMs: 150 } }] },
    { name: 'dynamics brickwall hard knee', mods: [{ id: 'dynamics', params: { thresholdDb: -30, ratio: 10, kneeDb: 0, attackMs: 0.1, releaseMs: 10, makeupDb: 6 } }] },
    { name: 'dynamics adaptive hybrid detector', mods: [{ id: 'dynamics', params: { adaptive: 1, maxReductionDb: 6, thresholdDb: -24, ratio: 4, kneeDb: 3, attackMs: 5, releaseMs: 300 } }], rate: 48000 },
    { name: 'width mono-sum', mods: [{ id: 'width', params: { amount: 0 } }] },
    { name: 'width 1.6', mods: [{ id: 'width', params: { amount: 1.6 } }] },
    { name: 'width on mono is a no-op', mods: [{ id: 'width', params: { amount: 2 } }], channels: 1 },
    { name: 'clip standard', mods: [{ id: 'clip', params: { driveDb: 6, ceilingDb: -1 } }] },
    { name: 'clip studio 4x oversampled', mods: [{ id: 'clip', params: { driveDb: 6, ceilingDb: -1 } }], extra: { quality: 'studio' }, seconds: 0.3 },
    { name: 'clip studio hard drive', mods: [{ id: 'clip', params: { driveDb: 18, ceilingDb: -6 } }], extra: { quality: 'studio' }, seconds: 0.3, rate: 48000 },
    { name: 'reverb long decay, no pre-delay', mods: [{ id: 'reverb', params: { amount: 0.2, decay: 4, preDelayMs: 0 } }], signal: 'impulse', seconds: 1.5 },
    { name: 'reverb short decay, max pre-delay', mods: [{ id: 'reverb', params: { amount: 0.1, decay: 0.2, preDelayMs: 100 } }] },
    { name: 'echo fastest, max feedback', mods: [{ id: 'echo', params: { amount: 0.25, timeMs: 50, feedback: 0.65 } }], signal: 'impulse', seconds: 1.5 },
    { name: 'echo fractional-sample delay', mods: [{ id: 'echo', params: { amount: 0.15, timeMs: 333, feedback: 0.4 } }], rate: 44100 },
    { name: 'limit sample peak', mods: [{ id: 'limit', params: { ceilingDb: -1, releaseMs: 100 } }] },
    { name: 'limit fast release near 0 dBFS', mods: [{ id: 'limit', params: { ceilingDb: -0.1, releaseMs: 10 } }], rate: 96000 },
    { name: 'limit true-peak 4x detector', mods: [{ id: 'limit', params: { ceilingDb: -1, releaseMs: 60, truePeak: 1 } }] },
    { name: 'limit deep, slow', mods: [{ id: 'limit', params: { ceilingDb: -12, releaseMs: 1000 } }], channels: 1 },
  ];

  it.each(cases)('$name', ({ mods, rate = 44100, channels = 2, signal = 'program', seconds = 0.6, extra }) => {
    const input = signal === 'sweep' ? sweep(rate, seconds, channels) : signal === 'impulse' ? impulse(rate, seconds, channels) : program(rate, seconds, channels);
    expectRenderParity(chainOf(mods, extra), input, rate);
  });
});

describe('render parity: graph', () => {
  const master: Mod[] = [
    { id: 'trim', params: { gainDb: -3 } },
    { id: 'eq', params: { lowDb: 1.5, lowHz: 90, midDb: -1.2, midHz: 350, midQ: 0.8, highDb: 2, highHz: 9000 } },
    { id: 'dynamics', params: { thresholdDb: -20, ratio: 2.5, kneeDb: 6, attackMs: 15, releaseMs: 180, makeupDb: 2, adaptive: 1, maxReductionDb: 8 } },
    { id: 'width', params: { amount: 1.15 } },
    { id: 'clip', params: { driveDb: 2, ceilingDb: -0.8 } },
    { id: 'limit', params: { ceilingDb: -1, releaseMs: 80 } },
  ];

  it('adjacent reverb + echo run in parallel on the same input', () => {
    const state = chainOf([{ id: 'eq', params: { highDb: 3 } }, { id: 'reverb', params: { amount: 0.15, decay: 2 } }, { id: 'echo', params: { amount: 0.2, timeMs: 180, feedback: 0.5 } }, { id: 'limit' }]);
    expectRenderParity(state, impulse(44100, 1.2, 2), 44100);
    expectRenderParity(state, program(44100, 0.6, 2), 44100);
  });

  it('non-adjacent effects stay in series', () => {
    const state = chainOf([{ id: 'reverb', params: { amount: 0.1 } }, { id: 'eq', params: { midDb: 4, midHz: 1500 } }, { id: 'echo', params: { amount: 0.2, timeMs: 120 } }]);
    expectRenderParity(state, program(48000, 0.6, 2), 48000);
  });

  it('full mastering chain + loudness target correction', () => {
    expectRenderParity(chainOf(master, { loudnessTarget: { targetLufs: -14, correctionDb: -2.3 } }), program(44100, 0.8, 2), 44100);
  });

  it('full chain, studio quality, true-peak limiter', () => {
    const mods = master.map(m => (m.id === 'limit' ? { ...m, params: { ...m.params, truePeak: 1 } } : m));
    expectRenderParity(chainOf(mods, { quality: 'studio', outputCeilingDbtp: -1 }), program(48000, 0.3, 2), 48000);
  });

  it('offline render: bypassed modules keep only their alignment delay', () => {
    const mods = master.map(m => (['clip', 'limit', 'dynamics'].includes(m.id) ? { ...m, bypassed: true } : m));
    expectRenderParity(chainOf(mods, { quality: 'studio' }), program(44100, 0.4, 2), 44100, { offline: true });
  });

  it('offline render with everything active matches', () => {
    expectRenderParity(chainOf(master), program(44100, 0.6, 2), 44100, { offline: true });
  });
});

describe('render parity: realtime automation (10 ms ramps)', () => {
  const rate = 44100;

  it('eq switched on mid-stream ramps in', () => {
    const off = chainOf([{ id: 'eq', bypassed: true, params: { lowDb: 6, highDb: -4 } }]);
    const on = chainOf([{ id: 'eq', params: { lowDb: 6, highDb: -4 } }]);
    expectRenderParity(off, program(rate, 0.6, 2), rate, {}, [{ atFrame: 4800, state: on }]);
  });

  it('eq coefficients glide between settings', () => {
    const a = chainOf([{ id: 'eq', params: { midDb: -6, midHz: 300, midQ: 2 } }]);
    const b = chainOf([{ id: 'eq', params: { midDb: 9, midHz: 4000, midQ: 0.5 } }]);
    expectRenderParity(a, sweep(rate, 0.6, 2), rate, {}, [{ atFrame: 6400, state: b }, { atFrame: 12800, state: a }]);
  });

  it('dynamics threshold sweep every 1024 frames', () => {
    const steps = Array.from({ length: 20 }, (_, k) => ({
      atFrame: k * 1024,
      state: chainOf([{ id: 'dynamics', params: { thresholdDb: -6 - k * 1.5, ratio: 1 + k * 0.4, adaptive: 1 } }]),
    }));
    expectRenderParity(steps[0]!.state, program(rate, 0.6, 2), rate, {}, steps.slice(1));
  });

  it('trim jump + width change + loudness target change', () => {
    const a = chainOf([{ id: 'trim' }, { id: 'width' }], { loudnessTarget: { targetLufs: -14, correctionDb: 0 } });
    const b = chainOf([{ id: 'trim', params: { gainDb: -9 } }, { id: 'width', params: { amount: 0.3 } }], { loudnessTarget: { targetLufs: -9, correctionDb: 4 } });
    expectRenderParity(a, program(rate, 0.6, 2), rate, {}, [{ atFrame: 5000, state: b }]);
  });

  it('limiter bypass toggles crossfade with lookahead delay', () => {
    const on = chainOf([{ id: 'limit', params: { ceilingDb: -3 } }]);
    const off = chainOf([{ id: 'limit', params: { ceilingDb: -3 }, bypassed: true }]);
    expectRenderParity(on, program(rate, 0.6, 2), rate, {}, [{ atFrame: 6000, state: off }, { atFrame: 14000, state: on }]);
  });
});

describe('Float32 output buffers (AudioWorklet path)', () => {
  it('rounds the same float64 result', () => {
    const state = chainOf([{ id: 'eq', params: { lowDb: 2 } }, { id: 'limit' }]);
    const input = program(48000, 0.4, 2), frames = input[0]!.length;
    const ref = render(oracle.Chain, state, input, 48000).output;
    const chain = new mine.Chain(structuredClone(state), 48000, 2);
    const out = [new Float32Array(frames), new Float32Array(frames)];
    for (let pos = 0; pos < frames; pos += BLOCK) {
      const n = Math.min(BLOCK, frames - pos);
      chain.processBlock(input.map(c => c.subarray(pos, pos + n)), out.map(c => c.subarray(pos, pos + n)), n);
    }
    // One float32 ULP near full scale is ~6e-8.
    expectParity(out.map(c => Float64Array.from(c)), ref.map(c => Float64Array.from(c, Math.fround)), 1.2e-7);
  });
});

describe('guards', () => {
  const engines: Array<[string, ChainCtor]> = [['oracle', oracle.Chain], ['mine', mine.Chain as unknown as ChainCtor]];
  /** Construction must reject. */
  const rejectsConstruct = (...args: [ChainState, number, number, ChainOptions?]) => {
    for (const [name, Chain] of engines) expectRejects(() => new Chain(...args), `${name} must reject`);
  };
  /** Construction must succeed; only `act` may reject — otherwise the guard is untested. */
  const rejectsAct = (args: [ChainState, number, number, ChainOptions?], act: (chain: RenderChain) => unknown) => {
    for (const [name, Chain] of engines) {
      let chain: RenderChain | undefined;
      expect(() => { chain = new Chain(...args); }, `${name} setup`).not.toThrow();
      expectRejects(() => act(chain!), `${name} must reject`);
    }
  };

  it('rejects non-finite input', () => {
    rejectsAct([oracle.defaultState(), 44100, 2], c => c.processBlock([new Float64Array([0, Number.NaN]), new Float64Array(2)], [new Float64Array(2), new Float64Array(2)], 2));
  });
  it('rejects output beyond Float32 range', () => {
    rejectsAct([chainOf([{ id: 'trim', params: { gainDb: 24 } }]), 44100, 1], c => c.processBlock([new Float64Array([1e38])], [new Float64Array(1)], 1));
  });
  it('rejects active width on >2 channels', () => {
    rejectsConstruct(chainOf([{ id: 'width', params: { amount: 1.5 } }]), 48000, 4);
  });
  it('rejects sample rate and channel count out of range', () => {
    rejectsConstruct(oracle.defaultState(), 7999, 2);
    rejectsConstruct(oracle.defaultState(), 44100, 9);
  });
  it('rejects topology changes during playback', () => {
    rejectsAct([chainOf([{ id: 'eq' }]), 44100, 2], c => c.update(chainOf([{ id: 'eq' }, { id: 'trim' }])));
  });
  it('rejects switching limiter detector mode during playback', () => {
    rejectsAct([chainOf([{ id: 'limit' }]), 44100, 2], c => c.update(chainOf([{ id: 'limit', params: { truePeak: 1 } }])));
  });
  it('rejects quality changes during playback', () => {
    rejectsAct([chainOf([{ id: 'clip' }]), 44100, 2], c => c.update(chainOf([{ id: 'clip' }], { quality: 'studio' })));
  });
  it('rejects any update to an offline chain', () => {
    rejectsAct([chainOf([{ id: 'trim' }]), 44100, 2, { offline: true }], c => c.update(chainOf([{ id: 'trim', params: { gainDb: 1 } }])));
  });
});
