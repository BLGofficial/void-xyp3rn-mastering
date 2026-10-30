import { describe, expect, it } from 'vitest';
import type { ChainState, ProcessorId } from '../lib/dsp';
import * as mine from '../lib/engine';
import type { AudioData, TrackMetrics } from '../lib/engine';
import { expectClose } from './compare';
import { loadEngineOracle, loadOracle, loadTargetOracle, ORACLE_ENGINE_VERSION } from './oracle';
import { program, sweep, tone, type Signal } from './signals';
import { buildWav, infoList, patchAscii, type WavSpec } from './wav-fixtures';

const engine = loadEngineOracle();
const target = loadTargetOracle();
const dsp = loadOracle();

const TOL = 1e-9;
// Rendered audio is stored as float32: a 1e-12 float64 difference can still round
// to a neighbouring float32 (1 ulp <= 1.2e-7 below full scale).
const TOL_RENDER = 1.2e-7;

/** Upstream codes carry a product prefix; ours are bare. Strings elsewhere are compared as-is. */
function stripPrefix<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/^VOID_/, '') as T;
  if (Array.isArray(value)) return value.map(stripPrefix) as T;
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPrefix(v)])) as T;
  }
  return value;
}

const codeOf = (e: unknown) => String((e as { code?: unknown })?.code ?? '').replace(/^VOID_/, '');
async function capture(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return undefined;
}
/** Both must fail with the same (prefix-stripped) code; a stub's error never counts. */
async function expectSameFailure(ref: () => unknown, got: () => unknown) {
  const r = await capture(ref), g = await capture(got);
  expect(r, 'must fail upstream').toBeInstanceOf(Error);
  expect(g, 'must fail').toBeInstanceOf(Error);
  expect((g as Error).message).not.toMatch(/\(phase \w+ stub\)/);
  expect(codeOf(g), `code (upstream: ${(r as Error).message})`).toBe(codeOf(r));
}

/** Planar float32 audio built by the oracle's own allocator so both engines see identical input. */
function audio(signal: Signal, rate: number, mask = 0): AudioData {
  const b = engine.createBuffer(rate, signal.length, signal[0]!.length, mask);
  signal.forEach((ch, c) => b.channels[c]!.set(ch));
  return b;
}
const cloneAudio = (b: AudioData): AudioData => ({ ...b, channels: b.channels.map(c => c.slice()) });
const silence = (rate: number, seconds: number, channels: number): Signal =>
  Array.from({ length: channels }, () => new Float64Array(Math.round(rate * seconds)));

type Mod = { id: ProcessorId; params?: Record<string, number>; bypassed?: boolean };
function chainOf(mods: Mod[], extra: Partial<ChainState> = {}): ChainState {
  return dsp.validateState({
    ...dsp.defaultState(),
    ...extra,
    processors: mods.map((m, i) => {
      const base = dsp.createState(m.id, `slot-${i + 1}`, m.bypassed ?? false);
      return { ...base, parameters: { ...base.parameters, ...m.params } };
    }),
  });
}
const MASTER: Mod[] = [
  { id: 'trim', params: { gainDb: -2 } },
  { id: 'eq', params: { lowDb: 1.5, lowHz: 90, midDb: -1, midHz: 400, highDb: 1.5 } },
  { id: 'dynamics', params: { thresholdDb: -20, ratio: 2.5, attackMs: 15, releaseMs: 180, makeupDb: 2, adaptive: 1, maxReductionDb: 8 } },
  { id: 'width', params: { amount: 1.1 } },
  { id: 'clip', params: { driveDb: 1.5, ceilingDb: -0.8 } },
  { id: 'limit', params: { ceilingDb: -1, releaseMs: 80 } },
];

describe('oracle pin', () => {
  it(`engine ${ORACLE_ENGINE_VERSION}`, () => {
    expect(engine.VERSION).toBe(ORACLE_ENGINE_VERSION);
    expect(mine.MAX_SAMPLES).toBe(engine.MAX_SAMPLES);
    expect(mine.TARGET_TOLERANCE_LU).toBe(target.TOLERANCE);
  });
});

describe('WAV parse + decode', () => {
  const valid: Array<[string, WavSpec]> = [
    ['16-bit PCM stereo 48k', {}],
    ['24-bit PCM mono 44.1k', { bits: 24, channels: 1, sampleRate: 44100 }],
    ['32-bit integer PCM stereo 96k', { bits: 32, sampleRate: 96000 }],
    ['32-bit float stereo', { audioFormat: 3, bits: 32 }],
    ['extensible 32-bit float 5.1', { audioFormat: 3, bits: 32, channels: 6, extensibleMask: 0x3f }],
    ['extensible 24-bit 7.1', { bits: 24, channels: 8, extensibleMask: 0x63f }],
    ['extensible stereo, zero mask', { bits: 24, extensibleMask: 0 }],
    ['INFO genre/date read, identity tags ignored', { extra: [infoList({ INAM: 'Track', IGNR: 'Drum & Bass', ICRD: '2026-10-30', IART: 'X3LIUS' })] }],
    ['data before fmt, odd-sized JUNK padded', { dataFirst: true, extra: [{ id: 'JUNK', payload: new Uint8Array(3) }] }],
    ['single frame 8 kHz', { channels: 1, sampleRate: 8000, frames: 1 }],
  ];
  it.each(valid)('%s', async (_, spec) => {
    const bytes = buildWav(spec);
    expectClose(mine.parseWav(bytes), engine.parseWav(bytes), 0);
    const ref = await engine.decodeWav(bytes), got = await mine.decodeWav(bytes);
    expectClose(got, ref, 0);
  });

  const invalid: Array<[string, () => ArrayBuffer]> = [
    ['shorter than a header', () => new ArrayBuffer(40)],
    ['RIFX signature', () => patchAscii(buildWav(), 0, 'RIFX')],
    ['RF64 container', () => patchAscii(buildWav(), 0, 'RF64')],
    ['not WAVE', () => patchAscii(buildWav(), 8, 'AVI ')],
    ['RIFF length mismatch', () => buildWav({ riffSizeDelta: 2 })],
    ['truncated chunk', () => buildWav({ dataSizeField: 0x7fffffff })],
    ['duplicate fmt', () => buildWav({ duplicateFmt: true })],
    ['missing data', () => buildWav({ omitData: true, extra: [{ id: 'JUNK', payload: new Uint8Array(64) }] })],
    ['empty data', () => buildWav({ frames: 0, extra: [{ id: 'JUNK', payload: new Uint8Array(64) }] })],
    ['8-bit PCM', () => buildWav({ bits: 8 })],
    ['64-bit float', () => buildWav({ audioFormat: 3, bits: 64 })],
    ['partial final frame', () => buildWav({ trimData: 1 })],
    ['wrong byte rate', () => buildWav({ byteRate: 1 })],
    ['wrong block align', () => buildWav({ blockAlign: 3 })],
    ['unknown extensible subformat', () => buildWav({ extensibleMask: 0x3, guidTail: Array(12).fill(1) })],
    ['valid bits below container', () => buildWav({ bits: 24, extensibleMask: 0x3, validBits: 20 })],
    ['mask/channel mismatch', () => buildWav({ extensibleMask: 0x3f })],
    ['9 channels', () => buildWav({ channels: 9 })],
    ['7999 Hz', () => buildWav({ sampleRate: 7999 })],
    ['384001 Hz', () => buildWav({ sampleRate: 384001, frames: 10 })],
  ];
  it.each(invalid)('rejects %s', async (_, make) => {
    await expectSameFailure(() => engine.parseWav(make()), () => mine.parseWav(make()));
    await expectSameFailure(() => engine.decodeWav(make()), () => mine.decodeWav(make()));
  });

  it('rejects a non-ArrayBuffer input', async () => {
    const view = new Uint8Array(buildWav()) as unknown as ArrayBuffer;
    await expectSameFailure(() => engine.parseWav(view), () => mine.parseWav(view));
  });

  it('decode rejects a non-finite float sample', async () => {
    const make = () => buildWav({ audioFormat: 3, bits: 32, poke: (i, c, v) => (i === 100 && c === 1 ? Number.NaN : v) });
    await expectSameFailure(() => engine.decodeWav(make()), () => mine.decodeWav(make()));
  });

  it('decode refuses files over the memory budget', async () => {
    const make = () => buildWav({ frames: 48000 });
    await expectSameFailure(() => engine.decodeWav(make(), { budgetBytes: 1024 }), () => mine.decodeWav(make(), { budgetBytes: 1024 }));
  });

  it('decode honours an aborted signal', async () => {
    const signal = AbortSignal.abort();
    await expectSameFailure(() => engine.decodeWav(buildWav(), { signal }), () => mine.decodeWav(buildWav(), { signal }));
  });
});

describe('preflight (headers only)', () => {
  const valid: Array<[string, WavSpec]> = [
    ['16-bit stereo', {}],
    ['data before fmt', { dataFirst: true }],
    ['extensible 5.1 float', { audioFormat: 3, bits: 32, channels: 6, extensibleMask: 0x3f }],
  ];
  it.each(valid)('%s', async (_, spec) => {
    const blob = () => new Blob([buildWav(spec)]);
    expectClose(await mine.preflightWav(blob()), await engine.preflightWav(blob()), 0);
  });
  const invalid: Array<[string, () => Blob]> = [
    ['empty', () => new Blob([])],
    ['bad signature', () => new Blob([patchAscii(buildWav(), 0, 'RIFX')])],
    ['RIFF length mismatch', () => new Blob([buildWav({ riffSizeDelta: 4 })])],
    ['missing data', () => new Blob([buildWav({ omitData: true, extra: [{ id: 'JUNK', payload: new Uint8Array(64) }] })])],
    ['over budget', () => new Blob([buildWav({ frames: 48000 })])],
  ];
  it.each(invalid)('rejects %s', async (name, make) => {
    const options = name === 'over budget' ? { budgetBytes: 1024 } : {};
    await expectSameFailure(() => engine.preflightWav(make(), options), () => mine.preflightWav(make(), options));
  });
});

describe('memory plan', () => {
  const base = { sampleRate: 48000, channels: 2, length: 48000 * 240, bitsPerSample: 24 };
  it.each([
    ['default budget', base, {}],
    ['8 GiB device', base, { deviceMemory: 8 }],
    ['explicit budget + file size', { ...base, length: 48000 * 30 }, { budgetBytes: 512 * 1024 ** 2, fileBytes: 48000 * 30 * 6 + 44 }],
  ] as const)('%s', (_, info, options) => {
    expectClose(mine.memoryPlan(info, options), engine.memoryPlan(info, options), 0);
  });
  it.each([
    ['budget exceeded', base, { budgetBytes: 1024 ** 2 }],
    ['too many samples', { ...base, length: 2 ** 27 }, { budgetBytes: 1024 ** 4 }],
    ['invalid bit depth', { ...base, bitsPerSample: 20 }, {}],
    ['negative budget', base, { budgetBytes: -1 }],
  ] as const)('rejects %s', async (_, info, options) => {
    await expectSameFailure(() => engine.memoryPlan(info, options), () => mine.memoryPlan(info, options));
  });
});

describe('createBuffer', () => {
  it('allocates the same shape', () => {
    expectClose(mine.createBuffer(44100, 2, 1000, 0x3), engine.createBuffer(44100, 2, 1000, 0x3), 0);
  });
  it.each([[7999, 2, 10], [48000, 0, 10], [48000, 9, 10], [48000, 2, 0], [48000, 2, 2 ** 26 + 1]])('rejects (%d Hz, %d ch, %d frames)', async (rate, ch, len) => {
    await expectSameFailure(() => engine.createBuffer(rate, ch, len), () => mine.createBuffer(rate, ch, len));
  });
});

describe('WAV encode (byte-identical)', () => {
  const stereo = () => audio(program(48000, 0.2, 2, 0.9), 48000);
  const cases: Array<[string, () => AudioData, 'float32' | 'pcm16' | 'pcm24', { dither?: boolean; ditherSeed?: number }]> = [
    ['float32 stereo', stereo, 'float32', {}],
    ['pcm16 stereo, no dither', stereo, 'pcm16', {}],
    ['pcm16 stereo, seeded TPDF dither', stereo, 'pcm16', { dither: true, ditherSeed: 12345 }],
    ['pcm24 stereo, seeded TPDF dither', stereo, 'pcm24', { dither: true, ditherSeed: 0xffffffff }],
    ['pcm24 mono', () => audio(program(44100, 0.2, 1, 0.9), 44100), 'pcm24', {}],
    ['float32 5.1 extensible', () => audio(program(48000, 0.1, 6, 0.9), 48000, 0x3f), 'float32', {}],
    ['pcm24 stereo with mask -> extensible', () => audio(program(48000, 0.1, 2, 0.9), 48000, 0x3), 'pcm24', {}],
    ['full-scale edges', () => audio([Float64Array.from([-1, 1 - 2 ** -15, 0, -0.5]), Float64Array.from([1 - 2 ** -15, -1, 2 ** -16, 0.5])], 48000), 'pcm16', {}],
  ];
  it.each(cases)('%s', async (_, make, format, options) => {
    const ref = new Uint8Array(await engine.encodeWav(make(), format, options));
    const got = new Uint8Array(await mine.encodeWav(make(), format, options));
    expect(got.length).toBe(ref.length);
    expect(Buffer.compare(Buffer.from(got), Buffer.from(ref))).toBe(0);
  });

  it('defaults to float32', async () => {
    const ref = new Uint8Array(await engine.encodeWav(stereo()));
    expect(Buffer.from(new Uint8Array(await mine.encodeWav(stereo()))).equals(Buffer.from(ref))).toBe(true);
  });

  it('round-trips pcm24 within half an LSB', async () => {
    const src = stereo();
    const { buffer } = await mine.decodeWav(await mine.encodeWav(src, 'pcm24'));
    src.channels.forEach((ch, c) => ch.forEach((v, i) => expect(Math.abs(buffer.channels[c]![i]! - v)).toBeLessThanOrEqual(2 ** -24 + 1e-12)));
  });

  const invalid: Array<[string, () => AudioData, string, object]> = [
    ['PCM over full scale (no silent clipping)', () => audio(program(48000, 0.1, 2, 1.2), 48000), 'pcm16', {}],
    ['unknown format', stereo, 'pcm8', {}],
    ['negative dither seed', stereo, 'pcm16', { dither: true, ditherSeed: -1 }],
    ['fractional dither seed', stereo, 'pcm16', { dither: true, ditherSeed: 1.5 }],
    ['non-finite sample', () => { const b = stereo(); b.channels[0]![5] = Number.NaN; return b; }, 'float32', {}],
    ['Float64 channels', () => ({ ...stereo(), channels: stereo().channels.map(c => Float64Array.from(c)) as unknown as Float32Array[] }), 'float32', {}],
  ];
  it.each(invalid)('rejects %s', async (_, make, format, options) => {
    await expectSameFailure(
      () => engine.encodeWav(make(), format as 'pcm16', options),
      () => mine.encodeWav(make(), format as 'pcm16', options),
    );
  });
});

describe('track analysis', () => {
  const cases: Array<[string, () => AudioData]> = [
    ['48k stereo programme', () => audio(program(48000, 5, 2, 0.95), 48000)],
    ['44.1k mono', () => audio(program(44100, 3.5, 1, 0.8), 44100)],
    ['5.1 with mask (spectrum uses first two channels)', () => audio(program(48000, 3.2, 6, 0.8), 48000, 0x3f)],
    ['digital silence', () => audio(silence(48000, 3.2, 2), 48000)],
    ['100 ms', () => audio(program(48000, 0.1, 2), 48000)],
    ['dual mono', () => { const s = program(48000, 3.2, 1, 0.7); return audio([s[0]!, s[0]!.slice()], 48000); }],
    ['polarity-inverted right channel', () => { const s = program(48000, 3.2, 1, 0.7); return audio([s[0]!, s[0]!.map(v => -v)], 48000); }],
    ['clipped hot master', () => audio(program(48000, 4, 2, 1.3).map(c => c.map(v => Math.max(-1, Math.min(1, v)))), 48000)],
    ['sweep at 96k', () => audio(sweep(96000, 3.2, 2, 0.5), 96000)],
  ];
  it.each(cases)('%s', async (_, make) => {
    expectClose(await mine.analyzeTrack(make()), stripPrefix(await engine.analyze(make())), TOL);
  });

  it('rejects invalid buffers and non-finite samples', async () => {
    const nan = () => { const b = audio(program(48000, 0.5, 2), 48000); b.channels[1]![10] = Number.POSITIVE_INFINITY; return b; };
    await expectSameFailure(() => engine.analyze(nan()), () => mine.analyzeTrack(nan()));
    const bad = () => ({ ...audio(program(48000, 0.5, 2), 48000), sampleRate: 1000 });
    await expectSameFailure(() => engine.analyze(bad()), () => mine.analyzeTrack(bad()));
  });
});

describe('offline render', () => {
  const src = (seconds = 2, channels = 2, rate = 48000) => audio(program(rate, seconds, channels, 0.9), rate);
  const cases: Array<[string, () => AudioData, ChainState]> = [
    ['default chain (dynamics/clip/limit bypassed)', () => src(), dsp.defaultState()],
    ['full mastering chain', () => src(), chainOf(MASTER)],
    ['reverb + echo: tail rendered and faded', () => src(1.5), chainOf([...MASTER.slice(0, 2), { id: 'reverb', params: { amount: 0.1, decay: 1.2 } }, { id: 'echo', params: { amount: 0.1, timeMs: 300, feedback: 0.4 } }, { id: 'limit' }])],
    ['output ceiling: whole-render peak guard', () => src(), chainOf(MASTER.map(m => (m.id === 'limit' ? { ...m, bypassed: true } : m)), { outputCeilingDbtp: -1 })],
    ['studio quality, true-peak limiter, loudness correction', () => src(1.5), chainOf(MASTER.map(m => (m.id === 'limit' ? { ...m, params: { ...m.params, truePeak: 1 } } : m)), { quality: 'studio', loudnessTarget: { targetLufs: -12, correctionDb: 1.5 } })],
    ['mono, limiter only', () => src(2, 1, 44100), chainOf([{ id: 'limit', params: { ceilingDb: -3 } }])],
  ];
  it.each(cases)('%s', async (_, make, state) => {
    expectClose(await mine.renderChain(make(), structuredClone(state)), await engine.renderChain(make(), structuredClone(state)), TOL_RENDER);
  });

  it.each([
    ['invalid chain state', () => src(0.2), { ...dsp.defaultState(), processors: [{ id: 'nope' }] } as unknown as ChainState, {}],
    ['width on 4 channels', () => src(0.2, 4), chainOf([{ id: 'width', params: { amount: 1.5 } }]), {}],
    ['aborted', () => src(0.2), dsp.defaultState(), { signal: AbortSignal.abort() }],
  ] as const)('rejects %s', async (_, make, state, options) => {
    await expectSameFailure(() => engine.renderChain(make(), state, options), () => mine.renderChain(make(), state, options));
  });
});

describe('true-peak tools', () => {
  const hot = () => audio(program(48000, 1, 2, 0.99), 48000);
  const fs4 = () => audio(tone(48000, 0.5, 2, 12000, -0.5, Math.PI / 4), 48000);
  const quiet = () => audio(program(48000, 1, 2, 0.1), 48000);

  it.each([['programme', hot], ['fs/4 at 45 deg', fs4], ['silence', () => audio(silence(48000, 0.2, 2), 48000)]])('measure: %s', async (_, make) => {
    expectClose(await mine.measureTruePeak(make()), await engine.measureTruePeak(make()), TOL);
  });

  it.each([['needs attenuation', hot, -1], ['inter-sample overs', fs4, -1], ['already safe', quiet, -1], ['tight ceiling', hot, -6]] as const)('protect: %s', async (_, make, ceiling) => {
    const a = make(), b = make();
    const ref = await engine.protectTruePeak(a, ceiling), got = await mine.protectTruePeak(b, ceiling);
    expectClose(got, ref, TOL_RENDER);
    expectClose(b.channels, a.channels, TOL_RENDER);
  });

  it.each([[0], [-12.5], [Number.NaN]])('protect rejects ceiling %d', async ceiling => {
    await expectSameFailure(() => engine.protectTruePeak(hot(), ceiling), () => mine.protectTruePeak(hot(), ceiling));
  });

  it.each([[-1], [0], [-24]])('verify at %d dBTP', async ceiling => {
    expectClose(await mine.verifyPeak(fs4(), ceiling), await engine.verifyPeak(fs4(), ceiling), TOL);
  });
  it('verify defaults to 0 dBTP', async () => {
    expectClose(await mine.verifyPeak(fs4()), await engine.verifyPeak(fs4()), TOL);
  });
  it.each([[0.1], [-24.1]])('verify rejects %d dBTP', async ceiling => {
    await expectSameFailure(() => engine.verifyPeak(hot(), ceiling), () => mine.verifyPeak(hot(), ceiling));
  });
});

describe('safety policy', () => {
  it('defaults and overrides', () => {
    expectClose(mine.safetyLimits(), engine.Safety.limits(), 0);
    expectClose(mine.safetyLimits({ monoLossDb: 2, maximumAutoLufs: -12 }), engine.Safety.limits({ monoLossDb: 2, maximumAutoLufs: -12 }), 0);
  });
  it.each([
    ['unknown key', { loudness: 1 }],
    ['negative', { monoLossDb: -1 }],
    ['above 12', { eqLowDb: 13 }],
    ['auto loudness below -24', { maximumAutoLufs: -30 }],
    ['peak tolerance above default', { peakToleranceDb: 0.01 }],
    ['NaN', { sectionLossDb: Number.NaN }],
  ])('limits reject %s', async (_, custom) => {
    await expectSameFailure(() => engine.Safety.limits(custom as never), () => mine.safetyLimits(custom as never));
  });

  // Real metrics as a baseline; each case perturbs one dimension of the output.
  let baseline: TrackMetrics | undefined;
  const base = async () => (baseline ??= stripPrefix(await engine.analyze(audio(program(48000, 4, 2, 0.8), 48000))));
  type Patch = (o: TrackMetrics) => void;
  const cases: Array<[string, Patch, Partial<ChainState>?, object?]> = [
    ['identical: pass', () => {}],
    ['true peak over ceiling', o => { o.loudness.truePeakDbtp = -0.5; }, { outputCeilingDbtp: -1 }],
    ['true peak unmeasurable with ceiling', o => { o.loudness.truePeakDbtp = null; }, { outputCeilingDbtp: -1 }],
    ['pathological level', o => { o.peak = 2e6; }],
    ['negative peak (integrity)', o => { o.peak = -1; }],
    ['PCM16 export would clip', o => { o.positivePeak = 1; }, undefined, { format: 'pcm16' }],
    ['PCM24 negative overs', o => { o.negativePeak = -1.01; }, undefined, { format: 'pcm24' }],
    ['limiter over budget', () => {}, undefined, { stats: { maxLimiterReductionDb: 6 } }],
    ['custom limiter budget', () => {}, undefined, { stats: { maxLimiterReductionDb: 6 }, limiterBudget: 8 }],
    ['heavy compression', () => {}, undefined, { stats: { maxDynamicsReductionDb: 7 } }],
    ['macro contrast loss', o => { o.dynamics.sectionSpreadDb = (o.dynamics.sectionSpreadDb ?? 6) - 3; o.analysis.dynamics.meso.spreadDb! -= 3; }],
    ['transient damage', o => { o.analysis.dynamics.micro.crestP90Db! -= 3; }],
    ['negative correlation', o => { o.correlation = -0.3; }],
    ['mono cancellation', o => { o.stereo.monoLossDb! -= 2; }],
    ['excessive side', o => { o.stereo.sideMidDb = 8; }],
    ['band mono cancellation', o => { const b = o.analysis.spectrum.bands.stereo120_500!; b.fraction = 0.2; b.correlation = -0.5; b.monoLossDb = -8; }],
    ['spectral extreme', o => { o.spectral.lowFraction *= 3; }],
    ['excessive loudness', o => { o.loudness.integratedLufs = -6; }],
    ['loudness unavailable', o => { o.loudness.integratedLufs = null; }],
    ['DC offset', o => { o.dcOffset = [0.02, 0]; }],
    ['denormals and extreme floats', o => { o.analysis.integrity.subnormalSamples = 3; o.analysis.integrity.pathologicalSamples = 1; o.peak = 20; }],
    ['subsonic content', o => { o.analysis.spectrum.bands.sub20!.fraction = 0.4; }],
    ['extreme EQ in state', () => {}, { processors: [dsp.createState('eq', 'slot-1', false)].map(p => ({ ...p, parameters: { ...p.parameters, lowDb: 6, highDb: -4 } })) }],
    ['tighter custom limits', o => { o.stereo.monoLossDb! -= 0.6; }, undefined, { limits: { monoLossDb: 0.5 } }],
  ];
  it.each(cases)('%s', async (_, patch, statePatch = {}, options = {}) => {
    const source = await base(), output = structuredClone(source);
    patch(output);
    const state = { ...dsp.defaultState(), ...statePatch } as ChainState;
    const ref = stripPrefix(engine.Safety.evaluate(source, output, state, options as never));
    expectClose(mine.evaluateSafety(source, output, state, options as never), ref, TOL);
  });

  it('null output is a critical integrity failure', () => {
    expectClose(mine.evaluateSafety(null, null, null), stripPrefix(engine.Safety.evaluate(null, null, null)), TOL);
  });

  it('assertIntegrity throws on critical with the first critical code', async () => {
    const make = async () => { const s = await base(), o = structuredClone(s); o.loudness.truePeakDbtp = 0; return { s, o }; };
    const { s, o } = await make();
    const state = { ...dsp.defaultState(), outputCeilingDbtp: -1 };
    await expectSameFailure(
      () => engine.Safety.assertIntegrity(engine.Safety.evaluate(s, o, state)),
      () => mine.assertIntegrity(mine.evaluateSafety(s, o, state)),
    );
    const pass = mine.evaluateSafety(s, s, dsp.defaultState());
    expect(mine.assertIntegrity(pass)).toBe(pass);
  });
});

describe('loudness target', () => {
  const src = (peak: number) => audio(program(44100, 2.2, 2, peak), 44100);
  const limited = (t: number | null) => chainOf(MASTER, t === null ? {} : { loudnessTarget: { targetLufs: t, correctionDb: 0 } });
  const cases: Array<[string, number, ChainState]> = [
    ['-14 LUFS streaming target', 0.6, limited(-14)],
    ['-9 LUFS: peak protection limits it', 0.9, limited(-9)],
    ['-23 LUFS broadcast, quiet source', 0.2, limited(-23)],
    ['custom output ceiling -2 dBTP', 0.6, { ...limited(-12), outputCeilingDbtp: -2 }],
    ['no target: plain render + metrics', 0.6, limited(null)],
  ];
  it.each(cases)('%s', async (_, peak, state) => {
    const sourceMetrics = stripPrefix(await engine.analyze(src(peak)));
    const ref = stripPrefix(await target.render(src(peak), structuredClone(state), { sourceMetrics }));
    const got = await mine.renderToTarget(src(peak), structuredClone(state), { sourceMetrics });
    expectClose(got, ref, TOL_RENDER);
  });
});
