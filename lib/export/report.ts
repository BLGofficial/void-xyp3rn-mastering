import { DEFINITIONS, type ChainState, type ParamDef } from '../dsp';
import type { MeasurementRow, Report, ReportInput } from './types';

type Measured = ReportInput['source'];
const finite = (v: unknown): v is number => Number.isFinite(v);

/**
 * P90 - P10 of the 400 ms momentary readings above -70 LUFS: a short-term
 * dynamics proxy that works on clips too short for EBU LRA. Null under 4 readings.
 */
function momentarySpread(m: Measured): number | null {
  const v = (m.loudness?.history ?? []).map(p => p.momentaryLufs).filter((x): x is number => finite(x) && x > -70).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const at = (p: number) => {
    const x = (v.length - 1) * p, i = Math.floor(x);
    return v[i]! + (v[Math.ceil(x)]! - v[i]!) * (x - i);
  };
  return at(0.9) - at(0.1);
}

const ROWS: [label: string, unit: string, read: (m: Measured) => number | null | undefined, deltaUnit: string][] = [
  ['Integrated loudness', 'LUFS', m => m.loudness?.integratedLufs, 'LU'],
  ['Sample peak', 'dBFS', m => m.peakDbfs, 'dB'],
  ['Estimated true peak', 'dBTP', m => m.loudness?.truePeakDbtp, 'dB'],
  ['RMS', 'dBFS', m => m.rmsDbfs, 'dB'],
  ['Crest factor', 'dB', m => m.crestDb, 'dB'],
  ['Loudness range (LRA)', 'LU', m => m.loudness?.loudnessRangeLu, 'LU'],
  ['400 ms dynamic spread', 'LU', momentarySpread, 'LU'],
  ['50 ms transient crest', 'dB', m => m.dynamics?.medianTransientCrestDb, 'dB'],
  ['Stereo correlation', '', m => m.correlation, ''],
  ['Side / Mid', 'dB', m => m.stereo?.sideMidDb, 'dB'],
];

/** Source vs master, row by row. Missing values stay null (shown as N/A), never zero. */
export function measurements(source: Measured, master: Measured): MeasurementRow[] {
  return ROWS.map(([label, unit, read, deltaUnit]) => {
    const a = read(source) ?? null, b = read(master) ?? null;
    return { label, unit, source: a, master: b, delta: finite(a) && finite(b) ? b - a : null, deltaUnit };
  });
}

const signed = (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

/** Everything the PDF prints, as data. Notes say what the numbers can and cannot claim. */
export function reportModel(input: ReportInput): Report {
  const rows = measurements(input.source, input.master);
  const [loudness, , , , crest, , , , , sideMid] = rows;
  const notes: string[] = [];
  if (finite(loudness!.delta)) {
    notes.push(`Integrated loudness moved ${signed(loudness!.delta)} LU. Louder reads as "better" in a quick comparison; judge the master against the source at matched loudness.`);
  }
  if (finite(crest!.delta)) {
    notes.push(`Crest factor moved ${signed(crest!.delta)} dB. ${crest!.delta < 0 ? 'Less peak-to-average contrast: denser, at some cost to transient punch.' : 'More peak-to-average contrast is preserved.'}`);
  }
  if (finite(sideMid!.delta) && Math.abs(sideMid!.delta) > 0.05) {
    notes.push(`Side/Mid moved ${signed(sideMid!.delta)} dB: ${sideMid!.delta < 0 ? 'a narrower image' : 'a wider image; check it in mono'}. Correlation alone does not rate a stereo image.`);
  }
  if (!input.source.loudness?.lraStable || !input.master.loudness?.lraStable) {
    notes.push('LRA needs at least 60 s of programme; treat it as provisional here.');
  }
  notes.push('400 ms spread is P90 minus P10 of momentary loudness above -70 LUFS, a dynamics proxy rather than EBU LRA. 50 ms crest is the median over active windows, not onset detection.');
  notes.push('Both measurements span the whole file, so reverb and echo tails count. True peak is an oversampled estimate. N/A means not measurable, not zero.');
  notes.push('The master is measured from the decoded exported file, after PCM quantisation or MP3 encoding, including any MP3 safety gain. The source is measured as imported.');
  return {
    schemaVersion: 1,
    track: input.track,
    date: input.date,
    audioFilename: input.audioFilename,
    format: input.format,
    dither: input.dither,
    sampleRate: input.sampleRate,
    channels: input.channels,
    sourceDuration: input.sourceDuration,
    masterDuration: input.masterDuration,
    versions: input.versions,
    measurements: rows,
    target: input.explanation?.loudness ?? null,
    chain: input.state,
    processingStats: input.processingStats ?? null,
    peakGuard: input.peakGuard ?? null,
    codecVerification: input.codecVerification ?? null,
    safety: input.safety,
    explanation: input.explanation ?? null,
    notes,
    signOff: 'Generated locally by XYP3RN MASTERING. An automated measurement record, not a human approval or a digital signature.',
  };
}

export interface EffectLine { name: string; settings: string[] }
export interface EffectsSummary {
  /** Processors that touched the audio, in signal order. */
  applied: EffectLine[];
  /** Present in the chain but bypassed: did not process audio. */
  bypassed: string[];
  /** Loudness target, ceiling and oversampling applied after the effects. */
  output: string[];
}

const minus = (text: string) => text.replace(/^-/, '\u2212');
const trimmed = (v: number, digits: number) => minus(String(Number(v.toFixed(digits))));

/** "Detector (0 peak, 1 hybrid ...)" -> base "Detector" plus per-value names; other parentheticals are hints. */
function parseLabel(label: string): { base: string; options: Map<number, string> | null } {
  const m = /^(.*?)\s*\((.*)\)$/.exec(label);
  if (!m) return { base: label, options: null };
  const pairs = m[2]!.split(/,\s*/).map(part => /^(\d+)\s+([^=].*)$/.exec(part));
  if (pairs.length < 2 || pairs.some(x => !x)) return { base: m[1]!, options: null };
  return { base: m[1]!, options: new Map(pairs.map(x => [Number(x![1]), x![2]!])) };
}

function setting(def: ParamDef, value: number): string {
  const { base, options } = parseLabel(def.label);
  if (options?.has(value)) return `${base}: ${options.get(value)}`;
  const digits = def.step < 1 ? Math.min(3, String(def.step).split('.')[1]?.length ?? 0) : 0;
  // Bipolar controls (gains) read as moves: +2.8 dB, −0.3 dB.
  const sign = def.min < 0 && def.max > 0 && value > 0 ? '+' : '';
  return `${base} ${sign}${trimmed(value, digits)}${def.unit ? ` ${def.unit}` : ''}`;
}

/** The chain as a reader would describe it: what was applied, with what settings, then the output stage. */
export function effectsSummary(chain: ChainState): EffectsSummary {
  const applied: EffectLine[] = [], bypassed: string[] = [];
  for (const p of chain.processors) {
    const def = DEFINITIONS[p.id];
    if (p.bypassed) { bypassed.push(def.name); continue; }
    applied.push({
      name: def.name,
      settings: Object.entries(def.parameters).map(([key, d]) => setting(d, p.parameters[key] ?? d.default)),
    });
  }
  const t = chain.loudnessTarget;
  const output = [
    t ? `Loudness target ${trimmed(t.targetLufs, 1)} LUFS (output gain ${t.correctionDb > 0 ? '+' : ''}${trimmed(t.correctionDb, 2)} dB, applied once after the effects)` : 'No loudness target',
    chain.outputCeilingDbtp === null || chain.outputCeilingDbtp === undefined ? 'No output ceiling' : `True-peak ceiling ${trimmed(chain.outputCeilingDbtp, 1)} dBTP`,
    chain.quality === 'studio' ? 'Clip quality: 4x oversampled (studio)' : 'Clip quality: standard',
  ];
  return { applied, bypassed, output };
}
