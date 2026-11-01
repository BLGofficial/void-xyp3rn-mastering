import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChainState } from '../lib/dsp';
import type { AudioData, TrackMetrics } from '../lib/engine';
import * as mine from '../lib/export';
import type { CheckedMp3Options, Mp3Codec, ReportInput } from '../lib/export';
import { codeOf, expectClose, expectSameFailure, stripPrefix } from './compare';
import { loadEngineOracle, loadExportOracle, loadOracle, loadReportOracle } from './oracle';
import { program, prng, type Signal } from './signals';

const engine = loadEngineOracle();
const exporter = loadExportOracle();
const report = loadReportOracle();
const dsp = loadOracle();

const RATE = 44100;
const bytesOf = async (b: Blob | Uint8Array) => (b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));
const expectSameBytes = (a: Uint8Array, b: Uint8Array, label = 'bytes') => {
  expect(a.length, `${label}.length`).toBe(b.length);
  expect(Buffer.compare(Buffer.from(a), Buffer.from(b)), label).toBe(0);
};

function audio(signal: Signal, rate = RATE): AudioData {
  const b = engine.createBuffer(rate, signal.length, signal[0]!.length);
  signal.forEach((ch, c) => b.channels[c]!.set(ch));
  return b;
}

/** A premaster normalised to a sample peak just under -1 dBFS: the realistic MP3 input. */
function master(seconds = 2, channels = 2, peakDb = -1.3, seed = 1): AudioData {
  const s = program(RATE, seconds, channels, 0.9, seed);
  const peak = Math.max(...s.map(c => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const k = 10 ** (peakDb / 20) / peak;
  return audio(s.map(c => c.map(v => v * k)));
}

// ---------------------------------------------------------------------------
// Deterministic stand-in codec: "encoded" bytes are the float32 input; decoding
// applies a level change, a first-difference "ringing" term (raises inter-sample
// peaks like codec pre-echo) and a decoder-delay tail. Both sides use it.
interface Transfer { gain: number; ring: number; rate?: number; offset?: number }
const DECODER_TAIL = 1152;

function serialize(channels: Float32Array[]): Uint8Array {
  const length = channels[0]?.length ?? 0;
  const out = new Uint8Array(8 + channels.length * length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, channels.length, true);
  view.setUint32(4, length, true);
  channels.forEach((c, ch) => new Float32Array(out.buffer, 8 + ch * length * 4, length).set(c));
  return out;
}

function decodeFake(bytes: Uint8Array, t: Transfer, sampleRate: number) {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const count = view.getUint32(0, true), length = view.getUint32(4, true);
  const channels = Array.from({ length: count }, (_, ch) => {
    const x = new Float32Array(copy.buffer, 8 + ch * length * 4, length);
    const y = new Float32Array(length + DECODER_TAIL);
    for (let i = 0; i < length; i++) y[i] = t.gain * x[i]! + t.ring * (x[i]! - (i ? x[i - 1]! : 0)) + (t.offset ?? 0);
    return y;
  });
  const rate = t.rate ?? sampleRate;
  return { sampleRate: rate, numberOfChannels: count, length: length + DECODER_TAIL, duration: (length + DECODER_TAIL) / rate, channels };
}

let transfer: Transfer = { gain: 1, ring: 0 };
let encodedLog: Uint8Array[] = [];

/** Worker double speaking the reference MP3 worker protocol (init / chunk / finish). */
class FakeMp3Worker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  private chunks: Float32Array[][] = [];
  constructor(readonly url: string) {}
  postMessage(data: { type: string; channels?: Float32Array[] }) {
    setTimeout(() => {
      if (data.type === 'init') return this.onmessage?.({ data: { ready: true } });
      if (data.type === 'chunk') { this.chunks.push(data.channels!.map(c => c.slice())); return this.onmessage?.({ data: {} }); }
      const channels = this.chunks[0]!.map((_, ch) => {
        const all = new Float32Array(this.chunks.reduce((n, c) => n + c[ch]!.length, 0));
        let o = 0;
        for (const c of this.chunks) { all.set(c[ch]!, o); o += c[ch]!.length; }
        return all;
      });
      const bytes = serialize(channels);
      encodedLog.push(bytes);
      this.onmessage?.({ data: { bytes: bytes.slice().buffer, done: true } });
    }, 0);
  }
  terminate() {}
}

class FakeOfflineAudioContext {
  constructor(readonly channels: number, readonly frames: number, readonly sampleRate: number) {}
  decodeAudioData(encoded: ArrayBuffer) {
    const d = decodeFake(new Uint8Array(encoded), transfer, this.sampleRate);
    return Promise.resolve({ ...d, getChannelData: (i: number) => d.channels[i]! });
  }
}

const codec: Mp3Codec = {
  encode: async buffer => {
    const bytes = serialize(buffer.channels);
    encodedLog.push(bytes);
    return bytes;
  },
  decode: async bytes => {
    const d = decodeFake(bytes, transfer, RATE);
    return { ...d, channelMask: 0 };
  },
};

async function runBoth(buffer: AudioData, t: Transfer, options: CheckedMp3Options) {
  transfer = t;
  encodedLog = [];
  const ref = await exporter.encodeCheckedMp3({ ...buffer, channels: buffer.channels.map(c => c.slice()) }, '/mp3-worker.js', { ...options });
  const refLog = encodedLog;
  encodedLog = [];
  const got = await mine.encodeCheckedMp3({ ...buffer, channels: buffer.channels.map(c => c.slice()) }, codec, { ...options });
  return { ref, got, refLog, gotLog: encodedLog };
}

describe('MP3 export (void-export.js)', () => {
  beforeAll(() => {
    vi.stubGlobal('VoidEngine', engine);
    vi.stubGlobal('Worker', FakeMp3Worker);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    vi.stubGlobal('location', { href: 'http://localhost/studio/', origin: 'http://localhost' });
  });
  afterAll(() => vi.unstubAllGlobals());

  it.each([
    ['44.1 kHz stereo', RATE, 2],
    ['48 kHz mono', 48000, 1],
    ['32 kHz stereo', 32000, 2],
  ])('accepts %s', (_, sampleRate, numberOfChannels) => {
    expect(() => exporter.validateMp3({ sampleRate, numberOfChannels })).not.toThrow();
    expect(() => mine.validateMp3({ sampleRate, numberOfChannels })).not.toThrow();
  });

  it.each([
    ['96 kHz', 96000, 2],
    ['22.05 kHz', 22050, 2],
    ['3 channels', RATE, 3],
    ['6 channels', 48000, 6],
  ])('rejects %s', (_, sampleRate, numberOfChannels) => {
    expect(() => exporter.validateMp3({ sampleRate, numberOfChannels })).toThrow();
    let error: unknown;
    try { mine.validateMp3({ sampleRate, numberOfChannels }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/\(phase \w+ stub\)/);
    expect(codeOf(error)).toBe('UNSUPPORTED_MP3');
  });

  it('rejects bitrates other than 192 and 320', async () => {
    // Upstream's bitrate error is uncoded; that both refuse is the behaviour.
    await expect(exporter.encodeCheckedMp3(master(), '/w.js', { bitrate: 128 })).rejects.toThrow();
    await expect(mine.encodeCheckedMp3(master(), codec, { bitrate: 128 as 192 })).rejects.toThrow(/192 or 320/);
  });

  const SCENARIOS: [string, Transfer, CheckedMp3Options | ((m: TrackMetrics) => CheckedMp3Options)][] = [
    ['transparent codec, no target', { gain: 1, ring: 0 }, { ceilingDbtp: -1 }],
    ['inter-sample overshoot is attenuated until the decoded peak holds', { gain: 1, ring: 0.35 }, { ceilingDbtp: -1 }],
    ['quiet codec is lifted toward the target within decoded headroom', { gain: 0.85, ring: 0 }, m => ({ ceilingDbtp: -1, targetLufs: m.loudness.integratedLufs })],
    ['loud codec is trimmed toward the target', { gain: 1.08, ring: 0 }, m => ({ ceilingDbtp: 0, targetLufs: m.loudness.integratedLufs })],
    ['overshoot and a target at once', { gain: 0.95, ring: 0.2 }, m => ({ ceilingDbtp: -1, targetLufs: m.loudness.integratedLufs! + 0.5 })],
    ['192 kbps with default ceiling', { gain: 1, ring: 0.1 }, { bitrate: 192 }],
  ];

  it.each(SCENARIOS)('%s', async (_, t, opts) => {
    const buffer = master();
    const options = typeof opts === 'function' ? opts(stripPrefix(await engine.analyze(buffer))) : opts;
    const { ref, got, refLog, gotLog } = await runBoth(buffer, t, options);
    // Same encode sequence: identical codec gain applied on every pass.
    expect(gotLog.length, 'passes').toBe(refLog.length);
    refLog.forEach((bytes, i) => expectSameBytes(gotLog[i]!, bytes, `pass ${i + 1} input`));
    expectSameBytes(got.bytes, await bytesOf(ref.bytes));
    const { bytes: _r, ...refRest } = ref;
    const { bytes: _g, ...gotRest } = got;
    expectClose(stripPrefix(gotRest), stripPrefix(refRest));
  });

  it('fails with ENCODED_PEAK_FAILED when no pass meets the ceiling', async () => {
    const buffer = master();
    // A level-independent artefact: no codec gain within -3 dB can rescue it.
    transfer = { gain: 1, ring: 0, offset: 0.8 };
    await expectSameFailure(
      () => exporter.encodeCheckedMp3(buffer, '/w.js', { ceilingDbtp: -1 }),
      () => mine.encodeCheckedMp3(buffer, codec, { ceilingDbtp: -1 }),
    );
    let error: unknown;
    try { await mine.encodeCheckedMp3(buffer, codec, { ceilingDbtp: -1 }); } catch (e) { error = e; }
    expect(codeOf(error)).toBe('ENCODED_PEAK_FAILED');
  });

  it('fails verification when the decoded dimensions differ', async () => {
    const buffer = master();
    transfer = { gain: 1, ring: 0, rate: 48000 };
    await expectSameFailure(
      () => exporter.encodeCheckedMp3(buffer, '/w.js', {}),
      () => mine.encodeCheckedMp3(buffer, codec, {}),
    );
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    transfer = { gain: 1, ring: 0 };
    await expectSameFailure(
      () => exporter.encodeCheckedMp3(master(), '/w.js', { signal: controller.signal }),
      () => mine.encodeCheckedMp3(master(), codec, { signal: controller.signal }),
    );
  });
});

// ---------------------------------------------------------------------------
// Report model, ZIP container, PDF container.

type Pair = { source: TrackMetrics; master: TrackMetrics; state: ChainState };
const pairs = new Map<string, Promise<Pair>>();
const PAIRS: Record<string, () => Promise<{ src: AudioData; state: ChainState }>> = {
  'stereo master': async () => {
    const state = dsp.defaultState();
    for (const p of state.processors) p.bypassed = false;
    return { src: audio(program(RATE, 3, 2, 0.45)), state: { ...state, outputCeilingDbtp: -1 } };
  },
  'mono passthrough': async () => ({ src: audio(program(RATE, 3, 1, 0.5)), state: dsp.defaultState() }),
  'near silence': async () => ({ src: audio([new Float64Array(RATE * 2), new Float64Array(RATE * 2)]), state: dsp.defaultState() }),
};
const pair = (name: string) => {
  if (!pairs.has(name)) {
    pairs.set(name, (async () => {
      const { src, state } = await PAIRS[name]!();
      const out = await engine.renderChain(src, state);
      return { source: stripPrefix(await engine.analyze(src)), master: stripPrefix(await engine.analyze(out)), state };
    })());
  }
  return pairs.get(name)!;
};

async function input(name: string, extra: Partial<ReportInput> = {}): Promise<ReportInput> {
  const { source, master: m, state } = await pair(name);
  return {
    track: 'Night Drive (premaster)',
    date: '2026-10-30T13:45:27.000Z',
    audioFilename: 'Night Drive_XYP3RN_-14LUFS_pcm24.wav',
    format: 'pcm24',
    dither: true,
    sampleRate: RATE,
    channels: 2,
    sourceDuration: 3,
    masterDuration: 3.25,
    versions: { engine: '0.22.0-alpha.8', dsp: '0.11.0-dev.1' },
    source,
    master: m,
    state,
    safety: stripPrefix(engine.Safety.evaluate(source, m, state)),
    explanation: { loudness: { requested: -14, achieved: -14.08, status: 'reached', reason: 'Within tolerance.' } },
    processingStats: { maxLimiterReductionDb: 2.4, maxDynamicsReductionDb: 3.1, meanDynamicsReductionDb: 0.8 },
    peakGuard: null,
    codecVerification: null,
    ...extra,
  };
}

/** Prose (notes, sign-off) is ours to word and brand; which notes fire is behaviour. */
const shape = ({ notes, signOff, ...rest }: { notes: string[]; signOff: string } & Record<string, unknown>) => ({ ...rest, notesCount: notes.length, hasSignOff: !!signOff });

describe('mastering report model (void-report.js)', () => {
  it.each(Object.keys(PAIRS))('measurements: %s', async name => {
    const { source, master: m } = await pair(name);
    expectClose(mine.measurements(source, m), report.measurements(source, m), 1e-12);
  });

  it('measurements tolerate missing analyses (N/A, not zero)', () => {
    expectClose(mine.measurements({}, {}), report.measurements({}, {}), 0);
  });

  it.each(Object.keys(PAIRS))('model: %s', async name => {
    const i = await input(name);
    expectClose(shape(mine.reportModel(i) as never), shape(report.model(i) as never), 1e-12);
  });

  it('model: short programme and MP3 verification', async () => {
    const i = await input('stereo master', {
      format: 'mp3',
      codecVerification: { checkedPeakDbtp: -1.04, ceilingDbtp: -1, codecGainDb: -0.35, codecAttenuationDb: 0.35, passes: 2, verified: true },
      peakGuard: { beforeDbtp: -0.6, afterDbtp: -1.01, attenuationDb: 0.41, ceilingDbtp: -1 },
      explanation: null,
    });
    expectClose(shape(mine.reportModel(i) as never), shape(report.model(i) as never), 1e-12);
  });

  it('model notes are local wording, one per upstream note', async () => {
    const m = mine.reportModel(await input('stereo master'));
    expect(m.notes.join(' ')).not.toMatch(/VOID/);
    expect(m.signOff).toMatch(/XYP3RN/);
  });
});

describe('ZIP container (void-report.js)', () => {
  const r = prng(7);
  const audioBytes = Uint8Array.from({ length: 300_000 }, () => Math.floor(r() * 256));
  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%fake\n');

  it.each([
    ['report bundle', '2026-10-30T13:45:27.000Z'],
    ['odd seconds round down (DOS time)', '2026-01-02T03:04:59.999Z'],
    ['pre-1980 dates clamp the year', '1975-06-15T12:00:00Z'],
  ])('%s is byte-identical', async (_, date) => {
    const entries = [{ name: 'Night Drive_XYP3RN_master.wav', data: audioBytes }, { name: 'XYP3RN-Mastering-Report.pdf', data: new Blob([pdfBytes]) }];
    const ref = await report.zip(entries.map(e => ({ name: e.name, blob: e.data })), date);
    const got = await mine.zip(entries, date);
    expectSameBytes(await bytesOf(got), await bytesOf(ref));
  });

  it('UTF-8 names set the language-encoding flag', async () => {
    const entries = [{ name: 'Тъмно — ночь.wav', data: new Uint8Array([1, 2, 3]) }];
    expectSameBytes(await bytesOf(await mine.zip(entries, '2026-10-30T00:00:00Z')), await bytesOf(await report.zip([{ name: entries[0]!.name, blob: entries[0]!.data }], '2026-10-30T00:00:00Z')));
  });

  it('empty archive', async () => {
    expectSameBytes(await bytesOf(await mine.zip([], '2026-10-30T00:00:00Z')), await bytesOf(await report.zip([], '2026-10-30T00:00:00Z')));
  });

  it.each(['dir/file.wav', 'dir\\file.wav'])('refuses path-like name %s', async name => {
    await expect(report.zip([{ name, blob: new Uint8Array(1) }], '2026-10-30T00:00:00Z')).rejects.toThrow();
    await expect(mine.zip([{ name, data: new Uint8Array(1) }], '2026-10-30T00:00:00Z')).rejects.toThrow(/filename/i);
  });

  it('honours cancellation', async () => {
    const c = new AbortController();
    c.abort();
    await expect(report.zip([{ name: 'a', blob: new Uint8Array(1) }], '2026-10-30T00:00:00Z', c.signal)).rejects.toThrow();
    await expect(mine.zip([{ name: 'a', data: new Uint8Array(1) }], '2026-10-30T00:00:00Z', c.signal)).rejects.toThrow(/cancel/i);
  });
});

describe('PDF container (void-report.js)', () => {
  /** Canvas double: no drawing, deterministic pseudo-JPEG pages; records what the reference embedded. */
  function canvasDouble(pages: Uint8Array[]) {
    const ctx = {
      font: '10px sans-serif', fillStyle: '', strokeStyle: '', textAlign: 'left', globalAlpha: 1,
      save() {}, restore() {}, translate() {}, scale() {}, fill() {}, beginPath() {}, arc() {}, fillRect() {}, fillText() {}, moveTo() {}, lineTo() {}, stroke() {},
      measureText(s: string) { return { width: s.length * Number.parseFloat(this.font) * 0.5 }; },
    };
    return {
      createElement: () => ({
        width: 0, height: 0, getContext: () => ctx,
        toBlob(cb: (b: Blob) => void) {
          const r = prng(pages.length + 1);
          const jpg = Uint8Array.from({ length: 5000 + pages.length * 37 }, (_, i) => (i < 2 ? [0xff, 0xd8][i]! : Math.floor(r() * 256)));
          pages.push(jpg);
          cb(new Blob([jpg]));
        },
      }),
    };
  }

  it('assembles the same PDF bytes around the same pages', async () => {
    const pages: Uint8Array[] = [];
    vi.stubGlobal('document', canvasDouble(pages));
    vi.stubGlobal('Path2D', class {});
    try {
      const model = report.model(await input('stereo master'));
      const ref = await bytesOf(await report.pdf(model));
      expect(pages.length).toBeGreaterThan(1);
      expectSameBytes(await bytesOf(mine.assemblePdf(pages, 'VOID report')), ref);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('our header keeps a valid cross-reference table', async () => {
    const pages = [new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]), new Uint8Array([0xff, 0xd8, 3, 0xff, 0xd9])];
    const bytes = await bytesOf(mine.assemblePdf(pages));
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4\n%XYP3RN report\n')).toBe(true);
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
    expect(offsets).toHaveLength(1 + 1 + pages.length * 3);
    offsets.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain(`/Count ${pages.length}`);
  });
});
