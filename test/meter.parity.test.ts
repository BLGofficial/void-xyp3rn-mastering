import { describe, expect, it } from 'vitest';
import { truePeakDetector } from '../lib/dsp';
import * as mine from '../lib/meter';
import type { AudioBufferLike, MeterOptions, StreamMeter } from '../lib/meter';
import { expectClose, expectRejectsAsync } from './compare';
import { loadMeterOracle, loadPeakOracle, ORACLE_METER_VERSION, ORACLE_PEAK_VERSION } from './oracle';
import { program, prng, tone, toBuffer, type Signal } from './signals';

const meter = loadMeterOracle();
const peak = loadPeakOracle();

// Same float64 arithmetic in the same order: demand agreement far below display precision.
const TOL = 1e-9;

// Speaker-mask bits (WAVE_FORMAT_EXTENSIBLE).
const MASK_5_1 = 0x3f; // FL FR FC LFE BL BR
const MASK_7_1 = 0x63f; // + SL SR

const silence = (rate: number, seconds: number, channels: number): Signal =>
  Array.from({ length: channels }, () => new Float64Array(Math.round(rate * seconds)));

describe('oracle pin', () => {
  it(`meter ${ORACLE_METER_VERSION}, peak validator ${ORACLE_PEAK_VERSION}`, () => {
    expect(meter.VERSION).toBe(ORACLE_METER_VERSION);
    expect(peak.VERSION).toBe(ORACLE_PEAK_VERSION);
  });
});

describe('K-weighting', () => {
  it.each([8000, 11025, 22050, 32000, 44100, 48000, 88200, 96000, 192000, 384000])('coefficients @ %d Hz', rate => {
    expectClose(mine.kWeighting(rate), meter.kCoefficients(rate), 1e-12);
  });

  it('48 kHz matches the ITU-R BS.1770-4 published table', () => {
    const [shelf, hp] = mine.kWeighting(48000);
    const published = {
      shelf: [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
      hp: [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621],
    };
    shelf.forEach((v, i) => expect(v).toBeCloseTo(published.shelf[i]!, 12));
    hp.forEach((v, i) => expect(v).toBeCloseTo(published.hp[i]!, 12));
  });
});

describe('channel weights', () => {
  const cases: Array<[string, number, number]> = [
    ['mono, no mask', 1, 0], ['stereo, no mask', 2, 0], ['3 channels, no mask', 3, 0],
    ['stereo FL|FR', 2, 0x3], ['mono FC', 1, 0x4], ['5.1 (LFE excluded, surrounds +1.5 dB)', 6, MASK_5_1],
    ['7.1', 8, MASK_7_1], ['unsupported speaker bit', 2, 0x801], ['mask/channel count mismatch', 6, 0x3],
  ];
  it.each(cases)('%s', (_, channels, mask) => {
    expect(mine.channelWeights(channels, mask)).toEqual(meter.channelWeights(channels, mask));
  });
});

describe('gating', () => {
  const rnd = prng(42);
  // Mean-square powers spanning silence, the -70 LUFS absolute gate and the relative gate.
  const lufsToPower = (l: number) => 10 ** ((l + 0.691) / 10);
  const powerSets: Array<[string, number[]]> = [
    ['empty', []],
    ['all below absolute gate', [lufsToPower(-80), lufsToPower(-71), 0]],
    ['steady -23', Array(50).fill(lufsToPower(-23))],
    ['quiet passages under relative gate', [...Array(30).fill(lufsToPower(-14)), ...Array(30).fill(lufsToPower(-40))]],
    ['random dynamic programme', Array.from({ length: 400 }, () => lufsToPower(-60 + rnd() * 55))],
    ['exactly at the absolute gate', [10 ** ((-70 + 0.691) / 10), lufsToPower(-20)]],
  ];
  it.each(powerSets)('integrated: %s', (_, powers) => {
    expectClose(mine.gatedIntegrated(powers), meter.gatedIntegrated(powers), 1e-12);
  });
  it.each(powerSets)('loudness range: %s', (_, powers) => {
    expectClose(mine.loudnessRange([...powers]), meter.loudnessRange([...powers]), 1e-12);
  });
});

describe('true-peak detector', () => {
  it('push/peaks/finish/maximum match', () => {
    const sig = program(48000, 0.5, 2, 0.99);
    const ref = new meter.TruePeak(2), got = truePeakDetector(2), frame = new Float64Array(2);
    for (let i = 0; i < sig[0]!.length; i++) {
      frame[0] = sig[0]![i]!; frame[1] = sig[1]![i]!;
      expectClose(got.push(frame), ref.push(frame), 1e-12, `push[${i}]`);
    }
    ref.finish(); got.finish();
    expectClose(got.peaks, ref.peaks, 1e-12);
    expectClose(got.maximum(), ref.maximum(), 1e-12);
  });
});

type Make = () => StreamMeter;
function drive(make: Make, signal: Signal, tailFrames: number, snapshotEvery: number) {
  const m = make(), frame = new Float64Array(signal.length), frames = signal[0]!.length, snaps: unknown[] = [];
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < signal.length; c++) frame[c] = signal[c]![i]!;
    m.push(frame);
    if ((i + 1) % snapshotEvery === 0) snaps.push(m.readings());
  }
  frame.fill(0);
  for (let i = 0; i < tailFrames; i++) m.push(frame, true);
  return { supported: m.supported, reason: m.reason, snaps, result: m.result(frames) };
}

describe('stream meter', () => {
  type Case = { name: string; rate: number; channels: number; seconds: number; mask?: number; options?: MeterOptions; signal?: 'program' | 'silence'; tail?: number };
  const cases: Case[] = [
    { name: '48k stereo programme + 1.5 s LRA tail', rate: 48000, channels: 2, seconds: 4, tail: 1.5 },
    { name: '44.1k mono', rate: 44100, channels: 1, seconds: 3.5 },
    { name: '96k stereo', rate: 96000, channels: 2, seconds: 3.2 },
    { name: '5.1 with speaker mask', rate: 48000, channels: 6, seconds: 3.2, mask: MASK_5_1 },
    { name: '7.1 with speaker mask', rate: 48000, channels: 8, seconds: 1 },
    { name: 'shorter than one 400 ms block', rate: 48000, channels: 2, seconds: 0.3 },
    { name: 'digital silence', rate: 48000, channels: 2, seconds: 3.5, signal: 'silence' },
    { name: 'true-peak disabled', rate: 48000, channels: 2, seconds: 3.2, options: { truePeak: false } },
    { name: 'collection disabled (live meter)', rate: 48000, channels: 2, seconds: 3.2, options: { collect: false } },
    { name: 'unsupported: non-integer 100 ms hop (44101 Hz)', rate: 44101, channels: 2, seconds: 1 },
    { name: 'unsupported: 11025 Hz', rate: 11025, channels: 2, seconds: 1 },
    { name: 'unsupported: unknown speaker bit', rate: 48000, channels: 2, seconds: 1, mask: 0x801 },
    { name: 'unsupported: 3 channels without mask', rate: 48000, channels: 3, seconds: 1 },
  ];
  it.each(cases)('$name', ({ rate, channels, seconds, mask = 0, options = {}, signal = 'program', tail = 0 }) => {
    // 7.1 needs its mask; others default to none.
    const m = channels === 8 ? MASK_7_1 : mask;
    const input = signal === 'silence' ? silence(rate, seconds, channels) : program(rate, seconds, channels, 0.9);
    const tailFrames = Math.round(rate * tail);
    const ref = drive(() => new meter.StreamMeter(rate, channels, m, options), input, tailFrames, 2400);
    const got = drive(() => mine.streamMeter(rate, channels, m, options), input, tailFrames, 2400);
    expectClose(got, ref, TOL);
  });

  it('rejects invalid context and non-finite input', () => {
    for (const [rate, ch] of [[7999, 2], [48000, 0], [48000, 9], [48000.5, 2]] as const) {
      expect(() => new meter.StreamMeter(rate, ch), 'must throw upstream').toThrow();
      expect(() => mine.streamMeter(rate, ch)).toThrow(/metering context/i);
    }
    expect(() => new meter.StreamMeter(48000, 1).push([Number.NaN]), 'must throw upstream').toThrow();
    expect(() => mine.streamMeter(48000, 1).push([Number.NaN])).toThrow(/non-finite/i);
  });
});

describe('analyze (whole file)', () => {
  const cases: Array<[string, AudioBufferLike, MeterOptions?]> = [
    ['48k stereo programme', toBuffer(program(48000, 5, 2, 0.95), 48000)],
    ['44.1k mono, 250 ms', toBuffer(program(44100, 0.25, 1, 0.5), 44100)],
    ['digital silence', toBuffer(silence(48000, 3.2, 2), 48000)],
    ['5.1 with speaker mask', toBuffer(program(48000, 3.2, 6, 0.8), 48000, MASK_5_1)],
    ['unsupported rate', toBuffer(program(44101, 1, 2), 44101)],
    ['true-peak disabled', toBuffer(program(48000, 3.2, 2), 48000), { truePeak: false }],
  ];
  it.each(cases)('%s', async (_, buffer, options = {}) => {
    expectClose(await mine.analyze(buffer, options), await meter.analyze(buffer, options), TOL);
  });

  const good = () => toBuffer(program(48000, 0.5, 2), 48000);
  const invalid: Array<[string, () => unknown]> = [
    ['empty', () => ({ ...good(), length: 0, channels: [new Float32Array(0), new Float32Array(0)] })],
    ['Float64 channels', () => ({ ...good(), channels: good().channels.map(c => Float64Array.from(c)) })],
    ['channel length mismatch', () => ({ ...good(), channels: [good().channels[0], new Float32Array(10)] })],
    ['channel count mismatch', () => ({ ...good(), numberOfChannels: 3 })],
    ['9 channels', () => ({ ...good(), numberOfChannels: 9, channels: Array.from({ length: 9 }, () => new Float32Array(good().length)) })],
  ];
  it.each(invalid)('rejects buffer: %s', async (_, make) => {
    await expect(meter.analyze(make() as AudioBufferLike), 'must reject upstream').rejects.toThrow();
    await expectRejectsAsync(() => mine.analyze(make() as AudioBufferLike));
  });

  it('honours an aborted signal', async () => {
    const signal = AbortSignal.abort();
    await expect(meter.analyze(good(), { signal }), 'must reject upstream').rejects.toThrow();
    await expectRejectsAsync(() => mine.analyze(good(), { signal }));
  });
});

// Independent of the oracle: the meter must read standard test signals correctly.
describe('standards conformance', () => {
  it('BS.1770: 997 Hz sine at 0 dBFS on one channel reads -3.01 LKFS', async () => {
    const r = await mine.analyze(toBuffer(tone(48000, 5, 1, 997, 0), 48000), { truePeak: false });
    expect(r.integratedLufs).toBeCloseTo(-3.01, 1);
  });

  it.each([[-23], [-33]])('EBU Tech 3341 cases 1-2: stereo 1 kHz at %d dBFS reads the same LUFS (M, S, I)', async dbfs => {
    const r = await mine.analyze(toBuffer(tone(48000, 10, 2, 1000, dbfs), 48000), { truePeak: false });
    for (const v of [r.integratedLufs, r.maxMomentaryLufs, r.maxShortTermLufs]) expect(Math.abs(v! - dbfs)).toBeLessThanOrEqual(0.1);
  });

  it('EBU Tech 3342 case 1: 20 s at -20 then 20 s at -30 dBFS reads LRA 10 ±1 LU', async () => {
    const a = tone(48000, 20, 2, 1000, -20), b = tone(48000, 20, 2, 1000, -30);
    const sig = a.map((ch, c) => Float64Array.from([...ch, ...b[c]!]));
    const r = await mine.analyze(toBuffer(sig, 48000), { truePeak: false });
    expect(Math.abs(r.loudnessRangeLu! - 10)).toBeLessThanOrEqual(1);
    expect(r.lraStable).toBe(false);
  });

  it('EBU Tech 3341 true-peak: fs/4 sine at 45° (samples at -3.01 dBFS) reads 0 dBTP within +0.2/-0.4 dB', async () => {
    const r = await mine.analyze(toBuffer(tone(48000, 1, 2, 12000, 0, Math.PI / 4), 48000));
    expect(r.truePeakDbtp!).toBeGreaterThanOrEqual(-0.4);
    expect(r.truePeakDbtp!).toBeLessThanOrEqual(0.2);
  });
});

describe('final peak validation (16x reconstruction)', () => {
  const cases: Array<[string, AudioBufferLike, number]> = [
    ['hot programme vs -1 dBTP', toBuffer(program(48000, 2.3, 2, 0.98), 48000), -1],
    ['quiet programme: every block provably safe', toBuffer(program(48000, 2.3, 2, 0.05), 48000), -1],
    ['fs/4 at 45°: inter-sample overs', toBuffer(tone(48000, 0.5, 2, 12000, -0.9, Math.PI / 4), 48000), -0.5],
    ['10 samples', toBuffer(program(44100, 10 / 44100, 2, 0.99), 44100), -1],
    ['mono, length not a block multiple', toBuffer(program(44100, 3000 / 44100, 1, 0.99), 44100), 0],
    ['digital silence', toBuffer(silence(48000, 0.5, 2), 48000), -1],
  ];
  it.each(cases)('%s', async (_, buffer, ceiling) => {
    expectClose(await mine.inspectPeaks(buffer, ceiling), await peak.inspect(buffer, ceiling), TOL);
  });

  it('rejects non-finite samples', async () => {
    const make = () => { const b = toBuffer(program(48000, 0.1, 1), 48000); b.channels[0]![100] = Number.POSITIVE_INFINITY; return b; };
    await expect(peak.inspect(make(), -1), 'must reject upstream').rejects.toThrow();
    await expectRejectsAsync(() => mine.inspectPeaks(make(), -1));
  });

  it('honours an aborted signal', async () => {
    const make = () => toBuffer(program(48000, 0.1, 1), 48000), signal = AbortSignal.abort();
    await expect(peak.inspect(make(), -1, { signal }), 'must reject upstream').rejects.toThrow();
    await expectRejectsAsync(() => mine.inspectPeaks(make(), -1, { signal }));
  });
});
