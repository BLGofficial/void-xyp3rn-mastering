// Deterministic mastering proposals. Every number traces to a measurement or a
// stated taste choice; nothing is a hidden "genre target". Suggests, never decides.

import { DEFINITIONS, defaultState, validateState, type ProcessorState } from '../dsp';
import { EngineError, evaluateSafety, type AudioData, type TrackMetrics } from '../engine';
import type { EqBand, Intention, IntentOptions, Proposal, ProposalConfidence, Style, Tone, TonalProfile } from './types';

export const INTENTIONS: Readonly<Record<Intention, { intensity: number; tone: Tone }>> = Object.freeze({
  transparent: { intensity: 25, tone: 'neutral' },
  balanced: { intensity: 50, tone: 'neutral' },
  loud: { intensity: 75, tone: 'neutral' },
  warm: { intensity: 50, tone: 'warm' },
  bright: { intensity: 50, tone: 'bright' },
});
/** Shelf tilt in dB: low shelf −tilt, high shelf +tilt. */
export const TONES: Readonly<Record<Tone, number>> = Object.freeze({ warmer: -1.5, warm: -0.75, neutral: 0, bright: 0.75, brighter: 1.5 });
/** Loudness references per style (LUFS). A reference, never forced over dynamics. */
export const STYLE_REFERENCES: Readonly<Record<Style, number>> = Object.freeze({ natural: -16, warm: -15, punchy: -14 });

const BANDS: EqBand[] = ['lowDb', 'midDb', 'highDb'];
const AUTO_EQ_DEFAULT_DB = 2.5;
const AUTO_EQ_MAX_DB = 3;
const LIMIT_CEILING_DB = -1.5;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const rounded = (n: number) => Math.round(n * 10) / 10;
const find = (p: Proposal, id: ProcessorState['id']) => p.state.processors.find(m => m.id === id);
/** Dense = already compressed/limited: crest ≤ 8 dB or integrated ≥ −10 LUFS. */
const isDense = (m: TrackMetrics) => (m.crestDb as number) <= 8 || (m.loudness?.integratedLufs as number) >= -10;

/**
 * Style + intensity starting chain: trim toward the style reference within a limiter
 * budget, broad shelf EQ, gentle hybrid compression for dynamic sources, true-peak limiter.
 * @throws On >2 channels or unmeasurable (silent/too quiet) programme.
 */
export function suggest(buffer: AudioData, metrics: TrackMetrics, style: Style = 'natural', intensity = 50): Proposal {
  if (!Object.hasOwn(STYLE_REFERENCES, style) || !Number.isFinite(intensity) || intensity < 0 || intensity > 100) throw new Error('Invalid Auto style or intensity.');
  if (buffer.numberOfChannels !== 1 && buffer.numberOfChannels !== 2) throw new Error('Auto supports mono and stereo. The manual chain and WAV export still work.');
  const lufs = metrics?.loudness?.integratedLufs;
  if (!Number.isFinite(lufs) || !Number.isFinite(metrics.peakDbfs) || metrics.peakDbfs < -60 || (lufs as number) < -50) {
    throw new Error('Auto needs measurable programme audio. This track is silent, too quiet, too short, or its loudness is unavailable.');
  }
  const amount = intensity / 100, crest = metrics.crestDb as number;
  const state = defaultState();
  const [trim, eq, dynamics, , , limit] = state.processors as [ProcessorState, ProcessorState, ProcessorState, ProcessorState, ProcessorState, ProcessorState];
  const budget = (style === 'punchy' ? 4 : 2.5) * amount;
  const tp = metrics.loudness.truePeakDbtp;
  const peak = Math.max(metrics.peakDbfs, Number.isFinite(tp) ? (tp as number) : metrics.peakDbfs);
  if (style === 'warm') { eq.parameters.lowDb = rounded(1.4 * amount); eq.parameters.highDb = rounded(-amount); }
  if (style === 'punchy') { eq.parameters.lowDb = rounded(0.8 * amount); eq.parameters.midDb = rounded(-0.6 * amount); eq.parameters.midHz = 320; eq.parameters.highDb = rounded(amount); }
  if (crest > 8 && (lufs as number) < -10 && amount > 0) {
    dynamics.bypassed = false;
    const spread = metrics.dynamics?.sectionSpreadDb;
    // Wide section contrast is musical: cap reduction harder so the arrangement keeps its shape.
    const macro = Number.isFinite(spread) && (spread as number) > 6;
    Object.assign(dynamics.parameters, {
      adaptive: 1, maxReductionDb: rounded((macro ? 1.5 : 3) * amount),
      thresholdDb: clamp(rounded(metrics.peakDbfs - (4 + 5 * amount)), -60, 0),
      ratio: rounded(1 + (style === 'punchy' ? 1.5 : 1) * amount),
      attackMs: crest > 14 ? 40 : 30, releaseMs: 180, makeupDb: 0,
    });
  }
  // Count intentional shelf boost; never chase a loudness reference with unlimited limiting.
  const eqBoost = Math.max(0, eq.parameters.lowDb!) + Math.max(0, eq.parameters.highDb!);
  trim.parameters.gainDb = rounded(clamp(Math.min((STYLE_REFERENCES[style] - (lufs as number)) * amount, LIMIT_CEILING_DB - peak - eqBoost + budget), -18, 6 * amount));
  limit.bypassed = amount === 0;
  limit.parameters.ceilingDb = LIMIT_CEILING_DB;
  limit.parameters.truePeak = 1;
  if (amount === 0) trim.parameters.gainDb = 0;
  return { state: validateState(state), style, intensity, target: STYLE_REFERENCES[style], budget };
}

/** Pick style and intensity from measured density, then broad corrective EQ hypotheses from the tonal profile. */
export function decide(buffer: AudioData, metrics: TrackMetrics, spectrum?: TonalProfile | null, intensity: number | null = null): Proposal {
  const dense = isDense(metrics), crest = metrics.crestDb as number;
  const style: Style = dense ? 'natural' : 'punchy';
  const amount = intensity ?? (dense ? 25 : crest > 14 ? 65 : 50);
  const proposal = suggest(buffer, metrics, style, amount);
  if (dense) find(proposal, 'dynamics')!.bypassed = true;
  const eq = find(proposal, 'eq')!, scale = amount / 100;
  // Listening hypotheses, not a universal spectral target or a mix diagnosis.
  const lowMid = spectrum?.lowMidPct, presence = spectrum?.presencePct;
  if (Number.isFinite(lowMid) && lowMid! > 45) {
    eq.parameters.midDb = rounded(-Math.min(2, (lowMid! - 45) / 15) * scale);
    eq.parameters.midHz = 320;
  }
  if (Number.isFinite(presence) && presence! > 35) eq.parameters.highDb = rounded(-Math.min(2, (presence! - 35) / 15) * scale);
  proposal.decision = `${dense ? 'Dense programme: lighter gain and no extra compression' : 'Transient headroom available: punch-first starting point'}. Crest ${crest.toFixed(1)} dB. EQ moves are listening hypotheses. Compare before accepting.`;
  return proposal;
}

/**
 * Apply a shelf tilt; any boost it adds is taken back off the input trim.
 * @throws On unknown tone or a chain without EQ and trim.
 */
export function toneProposal(candidate: Proposal, tone: Tone = 'neutral'): Proposal {
  if (!Object.hasOwn(TONES, tone)) throw new Error('Unknown mastering tone.');
  const state = validateState(candidate.state), tilt = TONES[tone];
  const eq = state.processors.find(p => p.id === 'eq'), trim = state.processors.find(p => p.id === 'trim');
  if (!eq || !trim) throw new Error('Automatic tone needs EQ and trim modules.');
  const boost = () => Math.max(0, eq.parameters.lowDb!) + Math.max(0, eq.parameters.highDb!);
  const before = boost();
  eq.parameters.lowDb = clamp(eq.parameters.lowDb! - tilt, -12, 12);
  eq.parameters.highDb = clamp(eq.parameters.highDb! + tilt, -12, 12);
  if (tilt) eq.bypassed = false;
  trim.parameters.gainDb = Math.max(-24, trim.parameters.gainDb! - Math.max(0, boost() - before));
  return { ...candidate, state: validateState(state), tone };
}

/**
 * Record an explicit final loudness goal. Intensity shapes the treatment, not the user's goal.
 * @throws EngineError `INVALID_TARGET` outside −24..−8 LUFS, `INVALID_STATE` without trim.
 */
export function withLoudnessTarget(candidate: Proposal, target: number): Proposal {
  if (!Number.isFinite(target) || target < -24 || target > -8) throw new EngineError('INVALID_TARGET', 'Automatic loudness target must be -24 to -8 LUFS. It is a preference, not a guarantee.');
  const proposal: Proposal = { ...candidate, state: validateState(candidate.state) };
  const trim = proposal.state.processors.find(p => p.id === 'trim');
  if (!trim) throw new EngineError('INVALID_STATE', 'Automatic loudness targeting needs a trim module.');
  const amount = Math.max(0, Math.min(100, Number(proposal.intensity) || 0)) / 100;
  // Zero intensity starts from the safe proposal; the target loop measures before adding gain.
  if (amount === 0) trim.parameters.gainDb = 0;
  proposal.target = target;
  proposal.requestedLoudnessTarget = target;
  return proposal;
}

/**
 * Bound a proposal by evidence: EQ limits (tighter when tonal confidence is low), HF density /
 * sibilance and sub-20 Hz risk, transient protection, already-mastered caution. Width stays 1.
 * @throws EngineError `INVALID_POLICY` on EQ limits outside 0..3 dB or unknown keys.
 */
export function adapt(candidate: Proposal, metrics: TrackMetrics, options: IntentOptions = {}): Proposal {
  const proposal: Proposal = { ...candidate, state: validateState(candidate.state) };
  const spectrum = metrics.analysis?.spectrum, transients = metrics.analysis?.dynamics?.micro;
  const toneMedium = spectrum?.confidence === 'medium';
  const confidence: ProposalConfidence = {
    loudness: Number.isFinite(metrics.loudness?.integratedLufs) ? { level: 'high', score: 0.9 } : { level: 'low', score: 0.2 },
    stereo: metrics.correlation === null ? { level: 'low', score: 0.2 } : { level: 'high', score: 0.85 },
    tone: toneMedium ? { level: 'medium', score: 0.55 } : { level: 'low', score: 0.25 },
    harshness: { level: 'low', score: 0.35 },
    method: 'Heuristic evidence strength; not calibrated probability',
  };
  const eqLimits = { lowDb: AUTO_EQ_DEFAULT_DB, midDb: AUTO_EQ_DEFAULT_DB, highDb: AUTO_EQ_DEFAULT_DB, ...(candidate.eqLimits || {}), ...(options.eqLimits || {}) };
  const badLimit = Object.entries(eqLimits).some(([k, v]) => !BANDS.includes(k as EqBand) || !Number.isFinite(v) || v < 0 || v > AUTO_EQ_MAX_DB);
  if (badLimit) throw new EngineError('INVALID_POLICY', 'Automatic broad-band EQ limits must be 0-3 dB.');
  proposal.eqLimits = eqLimits as Record<EqBand, number>;
  proposal.confidence = confidence;
  proposal.eqDecisions = [...(candidate.eqDecisions || [])];
  const heavy = !!transients?.transientHeavy, already = !!metrics.sourceQuality?.likelyAlreadyMastered;
  const hfDensity = spectrum?.highFrequency.densityFraction;
  for (const p of proposal.state.processors) {
    if (p.id === 'eq') {
      for (const key of BANDS) {
        const requested = p.parameters[key]!;
        const limit = Math.min(eqLimits[key], confidence.tone.level === 'low' ? 1 : eqLimits[key]);
        let actual = clamp(requested, -limit, limit), reason = 'Broad tonal move, bounded by analysis confidence';
        if (key === 'highDb' && actual > 0) {
          if (spectrum?.highFrequency.harshnessRisk === 'elevated' || spectrum?.highFrequency.sibilanceRisk === 'elevated') {
            actual = 0;
            reason = 'High-frequency density or sibilance already elevated: brightness boost removed';
          } else if (Number.isFinite(hfDensity)) {
            const scale = hfDensity! > 0.35 ? 0.35 : hfDensity! > 0.25 ? 0.6 : hfDensity! > 0.18 ? 0.8 : 1;
            if (scale < 1) actual = Math.min(actual, rounded(Math.min(limit, 0.75) * scale));
            reason = scale < 1 ? 'Measured high-frequency energy scaled the brightness boost down' : 'Measured high-frequency energy left room for the brightness lift';
          }
        }
        if (key === 'lowDb' && actual > 0 && (spectrum?.bands.sub20!.fraction ?? 0) > 0.25) {
          actual = 0;
          reason = 'Strong sub-20 Hz energy: no low-shelf boost until it is cleaned up';
        }
        p.parameters[key] = actual;
        proposal.eqDecisions.push({ module: DEFINITIONS.eq.name, parameter: key, requestedDb: requested, actualDb: actual, reason, confidence: confidence.tone.score });
      }
    }
    if (p.id === 'dynamics' && heavy && !p.bypassed) {
      // Transient-heavy sources: slow attack and a hard reduction cap keep the hits intact.
      p.parameters.attackMs = Math.max(40, p.parameters.attackMs!);
      p.parameters.maxReductionDb = Math.min(1.5, p.parameters.maxReductionDb!);
    }
    if (p.id === 'clip' && (heavy || already)) p.bypassed = true;
    if (p.id === 'width') p.parameters.amount = 1;
    if (p.id === 'dynamics' && already) p.bypassed = true;
    if (p.id === 'trim' && already) p.parameters.gainDb = Math.min(0, p.parameters.gainDb!);
  }
  if (heavy) proposal.budget = Math.min(proposal.budget, 1.5);
  if (already) proposal.budget = Math.min(proposal.budget, 0.75);
  proposal.sourceQuality = metrics.sourceQuality || null;
  proposal.transientProtection = heavy;
  return proposal;
}

/**
 * A named intention, adapted to the source. Dense sources are capped at 35 % intensity.
 * @throws EngineError `INVALID_PRESET` / `INVALID_PARAMETER` on bad name or intensity.
 */
export function intent(buffer: AudioData, metrics: TrackMetrics, name: Intention = 'balanced', spectrum?: TonalProfile | null, intensity: number | null = null, options: IntentOptions = {}): Proposal {
  if (!Object.hasOwn(INTENTIONS, name)) throw new EngineError('INVALID_PRESET', 'Unknown mastering intention.');
  const choice = INTENTIONS[name], requested = intensity ?? choice.intensity;
  if (!Number.isFinite(requested) || requested < 0 || requested > 100) throw new EngineError('INVALID_PARAMETER', 'Invalid intention intensity.');
  let proposal = decide(buffer, metrics, spectrum, isDense(metrics) ? Math.min(requested, 35) : requested);
  if (name === 'transparent') {
    const eq = find(proposal, 'eq')!;
    for (const key of BANDS) eq.parameters[key]! *= 0.25;
    find(proposal, 'dynamics')!.bypassed = true;
    proposal.budget = 0.75;
  }
  proposal = toneProposal(proposal, options.tone ?? choice.tone);
  proposal.state.outputCeilingDbtp = -1;
  proposal.preset = name;
  if (options.loudnessTarget !== undefined) proposal = withLoudnessTarget(proposal, options.loudnessTarget);
  return adapt(proposal, metrics, options);
}

const SAFETY_CODES: Record<string, string> = {
  MACRO_CONTRAST: 'MACRO_CONTRAST', TRANSIENT_DAMAGE: 'TRANSIENT_CONTRAST', STEREO_PHASE_RISK: 'STEREO_RISK',
  MONO_CANCELLATION: 'STEREO_RISK', SPECTRAL_EXTREME: 'SPECTRAL_EXTREME', LOUDNESS_UNAVAILABLE: 'LOUDNESS_UNAVAILABLE',
};

/** Introduced, user-relevant safety codes for an automatic result (deduplicated). */
export function safetyCodes(source: Partial<TrackMetrics> | null, output: Partial<TrackMetrics> | null): string[] {
  const relevant = evaluateSafety(source, output, null).warnings.filter(w => w.introduced || w.code === 'LOUDNESS_UNAVAILABLE');
  return [...new Set(relevant.map(w => SAFETY_CODES[w.code]).filter((c): c is string => !!c))];
}

/**
 * Gains that play source and master at the same loudness, both under −1 dBTP, for a fair A/B.
 * @returns null when either loudness is unmeasurable.
 */
export function comparisonGains(sourceLufs: number | null, masterLufs: number | null, sourcePeak: number | null = null, masterPeak: number | null = null) {
  if (!Number.isFinite(sourceLufs) || !Number.isFinite(masterLufs)) return null;
  const s = sourceLufs as number, m = masterLufs as number;
  let target = Math.min(s, m);
  if (Number.isFinite(sourcePeak)) target = Math.min(target, s - (sourcePeak as number) - 1);
  if (Number.isFinite(masterPeak)) target = Math.min(target, m - (masterPeak as number) - 1);
  return { original: 10 ** ((target - s) / 20), rendered: 10 ** ((target - m) / 20) };
}
