import { describe, expect, it } from 'vitest';
import * as mine from '../lib/auto';
import type { AutoMaster, Intention, IntentOptions, Proposal, Style, Tone } from '../lib/auto';
import type { ChainState } from '../lib/dsp';
import type { AudioData, TrackMetrics } from '../lib/engine';
import { codeOf, expectClose, expectSameFailure, stripPrefix } from './compare';
import { loadAiOracle, loadAutoOracle, loadEngineOracle, loadOracle, ORACLE_AUTO_VERSION } from './oracle';
import { program, prng, sweep, tone, type Signal } from './signals';

const auto = loadAutoOracle();
const ai = loadAiOracle();
const engine = loadEngineOracle();
const dsp = loadOracle();

const TOL = 1e-9;
// Rendered audio is float32: one ulp below full scale.
const TOL_RENDER = 1.2e-7;
const RATE = 44100;

function audio(signal: Signal, rate = RATE): AudioData {
  const b = engine.createBuffer(rate, signal.length, signal[0]!.length);
  signal.forEach((ch, c) => b.channels[c]!.set(ch));
  return b;
}

/** Fixture audio with metrics measured once by the oracle, so both sides decide from identical evidence. */
type Fixture = { buffer: AudioData; metrics: TrackMetrics };
const cache = new Map<string, Promise<Fixture>>();
const SOURCES: Record<string, () => Signal> = {
  dynamic: () => program(RATE, 3, 2, 0.45),
  dense: () => program(RATE, 3, 2, 1.8).map(c => c.map(v => Math.max(-0.98, Math.min(0.98, v)))),
  mono: () => program(RATE, 3, 1, 0.5),
  bright: () => { const r = prng(9); return [0, 1].map(() => Float64Array.from({ length: RATE * 3 }, () => (r() * 2 - 1) * 0.3)); },
  subby: () => { const p = program(RATE, 3, 2, 0.3), s = tone(RATE, 3, 2, 15, -4); return p.map((c, i) => c.map((v, j) => v + s[i]![j]!)); },
  quiet: () => program(RATE, 3, 2, 0.003),
  quad: () => program(RATE, 3, 4, 0.45),
};
const fixture = (name: string) => {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const buffer = audio(SOURCES[name]!());
      return { buffer, metrics: stripPrefix(await engine.analyze(buffer)) };
    })());
  }
  return cache.get(name)!;
};
const cloneAudio = (b: AudioData): AudioData => ({ ...b, channels: b.channels.map(c => c.slice()) });

/**
 * Comparable projection: free-text explanations are ours to word (and brand),
 * so compare decisions, numbers, codes and enums, and only the presence of prose.
 */
function shape(p: Partial<AutoMaster>) {
  const { notes, decision, macroProtection, eqDecisions, explanation, buffer: _b, metrics: _m, ...rest } = stripPrefix(p) as Partial<AutoMaster>;
  return {
    ...rest,
    notesCount: notes?.length ?? null,
    hasDecision: !!decision,
    hasMacroProtection: !!macroProtection,
    eqDecisions: eqDecisions?.map(({ parameter, requestedDb, actualDb, confidence }) => ({ parameter, requestedDb, actualDb, confidence })),
    explanation: explanation && {
      confidence: explanation.confidence,
      loudness: explanation.loudness,
      warnings: explanation.warnings,
      changes: (explanation.changes as Array<Record<string, unknown>>).map(c => ({
        parameter: c.parameter, requestedDb: c.requestedDb, actualDb: c.actualDb,
        action: typeof c.action === 'object' ? c.action : typeof c.action,
      })),
    },
  };
}

describe('oracle pin', () => {
  it(`auto ${ORACLE_AUTO_VERSION}`, () => {
    expect((auto as unknown as { VERSION: string }).VERSION).toBe(ORACLE_AUTO_VERSION);
  });
  it('intentions and tones', () => {
    expect(mine.INTENTIONS).toEqual(auto.intentions);
    expect(mine.TONES).toEqual(auto.tones);
  });
});

describe('tonal profile', () => {
  it.each([
    ['stereo programme', () => audio(program(RATE, 3, 2, 0.5))],
    ['mono', () => audio(program(RATE, 2, 1, 0.5))],
    ['white noise', () => audio(SOURCES.bright!())],
    ['96k sweep', () => audio(sweep(96000, 2, 2, 0.5), 96000)],
    ['100 frames', () => audio(program(RATE, 100 / RATE, 2, 0.5))],
  ])('%s', async (_, make) => {
    expectClose(await mine.tonalProfile(make()), await ai.profile(make()), TOL);
  });
});

const PROGRAMMES = ['dynamic', 'dense', 'mono', 'bright', 'subby'] as const;

describe('suggest', () => {
  const styles: Style[] = ['natural', 'warm', 'punchy'];
  const cases = PROGRAMMES.flatMap(f => styles.flatMap(s => [0, 35, 100].map(i => [f, s, i] as const)));
  it.each(cases)('%s / %s / %d%%', async (name, style, intensity) => {
    const { buffer, metrics } = await fixture(name);
    expectClose(shape(mine.suggest(buffer, metrics, style, intensity)), shape(auto.suggest(buffer, metrics, style, intensity)), TOL);
  });
  it.each([
    ['silent/too quiet', 'quiet', 'natural', 50],
    ['more than two channels', 'quad', 'natural', 50],
    ['unknown style', 'dynamic', 'loudest', 50],
    ['intensity above 100', 'dynamic', 'natural', 101],
  ] as const)('rejects %s', async (_, name, style, intensity) => {
    const { buffer, metrics } = await fixture(name);
    await expectSameFailure(() => auto.suggest(buffer, metrics, style as Style, intensity), () => mine.suggest(buffer, metrics, style as Style, intensity));
  });
});

describe('decide', () => {
  const cases = PROGRAMMES.flatMap(f => [null, 60].map(i => [f, i] as const));
  it.each(cases)('%s / intensity %s', async (name, intensity) => {
    const { buffer, metrics } = await fixture(name);
    const spectrum = await ai.profile(buffer);
    expectClose(shape(mine.decide(buffer, metrics, spectrum, intensity)), shape(auto.decide(buffer, metrics, spectrum, intensity)), TOL);
  });
  it('works without a tonal profile', async () => {
    const { buffer, metrics } = await fixture('dynamic');
    expectClose(shape(mine.decide(buffer, metrics)), shape(auto.decide(buffer, metrics)), TOL);
  });
});

describe('intent (with adaptation)', () => {
  const names: Intention[] = ['transparent', 'balanced', 'loud', 'warm', 'bright'];
  const cases = PROGRAMMES.flatMap(f => names.flatMap(n => [null, 80].map(i => [f, n, i] as const)));
  it.each(cases)('%s / %s / intensity %s', async (name, intention, intensity) => {
    const { buffer, metrics } = await fixture(name);
    const spectrum = await ai.profile(buffer);
    expectClose(shape(mine.intent(buffer, metrics, intention, spectrum, intensity)), shape(auto.intent(buffer, metrics, intention, spectrum, intensity)), TOL);
  });

  const options: Array<[string, IntentOptions]> = [
    ['brighter tone', { tone: 'brighter' }],
    ['warmer tone', { tone: 'warmer' }],
    ['explicit loudness target', { loudnessTarget: -14 }],
    ['tight EQ limits', { eqLimits: { highDb: 1, lowDb: 0 } }],
  ];
  it.each(options)('balanced with %s', async (_, opts) => {
    const { buffer, metrics } = await fixture('dynamic');
    expectClose(shape(mine.intent(buffer, metrics, 'balanced', null, null, opts)), shape(auto.intent(buffer, metrics, 'balanced', null, null, opts)), TOL);
  });

  it.each([
    ['unknown intention', 'loudest', null, {}],
    ['intensity below 0', 'balanced', -1, {}],
    ['EQ limit above 3 dB', 'balanced', null, { eqLimits: { highDb: 4 } }],
    ['unknown EQ limit key', 'balanced', null, { eqLimits: { tiltDb: 1 } }],
    ['loudness target below -24', 'balanced', null, { loudnessTarget: -30 }],
  ] as const)('rejects %s', async (_, intention, intensity, opts) => {
    const { buffer, metrics } = await fixture('dynamic');
    await expectSameFailure(
      () => auto.intent(buffer, metrics, intention as Intention, null, intensity, opts as IntentOptions),
      () => mine.intent(buffer, metrics, intention as Intention, null, intensity, opts as IntentOptions),
    );
  });
});

describe('tone and target helpers', () => {
  const base = async () => { const { buffer, metrics } = await fixture('dynamic'); return auto.suggest(buffer, metrics, 'punchy', 60); };
  it.each(['warmer', 'warm', 'neutral', 'bright', 'brighter'] as Tone[])('tone %s', async t => {
    const p = await base();
    expectClose(shape(mine.toneProposal(structuredClone(p), t)), shape(auto.toneProposal(structuredClone(p), t)), TOL);
  });
  it('rejects an unknown tone and a chain without EQ', async () => {
    const p = await base();
    await expectSameFailure(() => auto.toneProposal(p, 'dark' as Tone), () => mine.toneProposal(p, 'dark' as Tone));
    const noEq = { ...p, state: { ...p.state, processors: p.state.processors.filter(m => m.id !== 'eq') } };
    await expectSameFailure(() => auto.toneProposal(noEq, 'warm'), () => mine.toneProposal(noEq, 'warm'));
  });

  it.each([[-14, 60], [-9, 0], [-24, 100]] as const)('loudness target %d at %d%%', async (target, intensity) => {
    const { buffer, metrics } = await fixture('dynamic');
    const p = auto.suggest(buffer, metrics, 'natural', intensity);
    expectClose(shape(mine.withLoudnessTarget(structuredClone(p), target)), shape(auto.loudnessTarget(structuredClone(p), target)), TOL);
  });
  it('loudness target rejects out-of-range values and chains without trim', async () => {
    const p = await base();
    await expectSameFailure(() => auto.loudnessTarget(p, -7), () => mine.withLoudnessTarget(p, -7));
    const noTrim = { ...p, state: { ...p.state, processors: p.state.processors.filter(m => m.id !== 'trim') } };
    await expectSameFailure(() => auto.loudnessTarget(noTrim, -14), () => mine.withLoudnessTarget(noTrim, -14));
  });
});

describe('comparison gains', () => {
  it.each([
    [-20, -14, null, null], [-20, -14, -3, -1], [-9, -14, -0.2, -1], [-14, -14, 2, 2],
    [null, -14, null, null], [-Infinity, -14, null, null],
  ] as const)('source %s / master %s / peaks %s, %s', (s, m, sp, mp) => {
    expectClose(mine.comparisonGains(s, m, sp, mp), auto.comparisonGains(s, m, sp, mp), TOL);
  });
});

describe('safety codes', () => {
  it.each([
    ['identical', () => {}],
    ['phase risk', (o: TrackMetrics) => { o.correlation = -0.4; }],
    ['mono cancellation', (o: TrackMetrics) => { o.stereo.monoLossDb! -= 3; }],
    ['loudness unavailable', (o: TrackMetrics) => { o.loudness.integratedLufs = null; }],
    ['macro contrast + transient damage', (o: TrackMetrics) => { o.dynamics.sectionSpreadDb = -10; o.analysis.dynamics.micro.crestP90Db! -= 5; }],
  ] as const)('%s', async (_, patch) => {
    const { metrics } = await fixture('dynamic');
    const out = structuredClone(metrics);
    patch(out);
    expect(mine.safetyCodes(metrics, out)).toEqual(stripPrefix(auto.safety(metrics, out)));
  });
});

describe('rendered automatic masters', () => {
  type Make = (api: { intent: typeof mine.intent; suggest: typeof mine.suggest }, f: Fixture) => Proposal;
  const cases: Array<[string, string, Make, object?]> = [
    ['balanced', 'dynamic', (a, f) => a.intent(f.buffer, f.metrics, 'balanced')],
    ['loud + -14 LUFS target', 'dynamic', (a, f) => a.intent(f.buffer, f.metrics, 'loud', null, null, { loudnessTarget: -14 })],
    ['transparent on a dense master', 'dense', (a, f) => a.intent(f.buffer, f.metrics, 'transparent')],
    ['zero intensity + -16 target', 'dynamic', (a, f) => a.suggest(f.buffer, f.metrics, 'warm', 0)],
    ['bright on HF-heavy material', 'bright', (a, f) => a.intent(f.buffer, f.metrics, 'bright')],
    ['user render settings: studio, -2 dBTP', 'dynamic', (a, f) => a.intent(f.buffer, f.metrics, 'balanced'),
      { renderSettings: { ...dsp.defaultState(), quality: 'studio', outputCeilingDbtp: -2 } as ChainState }],
    ['warm tone option', 'mono', (a, f) => a.intent(f.buffer, f.metrics, 'balanced'), { tone: 'warm' }],
  ];
  it.each(cases)('%s', async (name, fx, make, options = {}) => {
    const f = await fixture(fx);
    const refProposal = make({ intent: auto.intent, suggest: auto.suggest }, f);
    const gotProposal = make({ intent: mine.intent, suggest: mine.suggest }, f);
    if (name.startsWith('zero')) { refProposal.requestedLoudnessTarget = -16; gotProposal.requestedLoudnessTarget = -16; }
    const ref = stripPrefix(await auto.renderProposal(cloneAudio(f.buffer), f.metrics, refProposal, structuredClone(options)));
    const got = await mine.renderProposal(cloneAudio(f.buffer), f.metrics, gotProposal, structuredClone(options));
    expectClose(shape(got), shape(ref), TOL_RENDER);
    expectClose(got.buffer.channels, ref.buffer.channels, TOL_RENDER);
    expectClose(got.metrics, ref.metrics, TOL_RENDER);
  });

  it('master() = suggest + renderProposal', async () => {
    const f = await fixture('dynamic');
    const ref = stripPrefix(await auto.master(cloneAudio(f.buffer), f.metrics, 'punchy', 60));
    const got = await mine.master(cloneAudio(f.buffer), f.metrics, 'punchy', 60);
    expectClose(shape(got), shape(ref), TOL_RENDER);
    expectClose(got.buffer.channels, ref.buffer.channels, TOL_RENDER);
  });

  it('honours an aborted signal', async () => {
    const f = await fixture('dynamic');
    const signal = AbortSignal.abort();
    const make = (a: typeof mine.intent) => a(f.buffer, f.metrics, 'balanced');
    await expectSameFailure(
      () => auto.renderProposal(f.buffer, f.metrics, make(auto.intent), { signal }),
      () => mine.renderProposal(f.buffer, f.metrics, make(mine.intent), { signal }),
    );
    expect(codeOf(new Error())).toBe('');
  });
});
