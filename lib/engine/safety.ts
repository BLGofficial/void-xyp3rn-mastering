// Central safety policy. Confidence values are heuristic evidence strength,
// never calibrated probabilities. "introduced" separates damage the chain
// caused from problems the source already had.

import type { ChainState } from '../dsp';
import { EngineError } from './errors';
import type { SafetyLimitKey, SafetyLimits, SafetyOptions, SafetyResult, SafetyWarning, TrackMetrics } from './types';

export const SAFETY_DEFAULTS: Readonly<SafetyLimits> = Object.freeze({
  peakToleranceDb: 0.001, sectionLossDb: 1.5, transientLossDb: 2, monoLossDb: 1, correlationDrop: 0.15,
  negativeWindowIncrease: 5, eqLowDb: 2.5, eqMidDb: 2.5, eqHighDb: 2.5, maximumAutoLufs: -8,
});

const finite = (v: unknown): v is number => Number.isFinite(v);

/**
 * Merge custom thresholds over defaults.
 * @throws On unknown keys or values outside each key's range.
 */
export function safetyLimits(custom: Partial<SafetyLimits> = {}): SafetyLimits {
  const out = { ...SAFETY_DEFAULTS };
  for (const [key, value] of Object.entries(custom)) {
    const invalid = !Object.hasOwn(out, key) || !finite(value) ||
      (key === 'maximumAutoLufs' ? value < -24 || value > -8 : key === 'peakToleranceDb' ? value < 0 || value > SAFETY_DEFAULTS.peakToleranceDb : value < 0 || value > 12);
    if (invalid) throw new Error('Invalid automatic safety limit.');
    out[key as SafetyLimitKey] = value;
  }
  return out;
}

type Metrics = Partial<TrackMetrics> | null | undefined;

/** Compare source and rendered metrics against the safety policy. */
export function evaluateSafety(source: Metrics, output: Metrics, state: Partial<ChainState> | null, options: SafetyOptions = {}): SafetyResult {
  const policy = safetyLimits(options.limits), warnings: SafetyWarning[] = [];
  // Untyped views: the policy must also judge partial or corrupted metric objects.
  const s = (source || {}) as any, o = (output || {}) as any;
  const add = (code: string, recommendedAction: string, confidence: number, introduced = true, severity: SafetyWarning['severity'] = 'warning', detail: Record<string, unknown> = {}) =>
    warnings.push({ severity, code, recommendedAction, confidence, introduced, ...detail });
  // Loss of a measured quantity beyond `limit` (silence counts as a measurement).
  const loss = (a: unknown, b: unknown, limit: number) => finite(a) && (finite(b) || b === -Infinity) && a - (b as number) > limit;

  if (!output || !finite(o.peak) || o.peak < 0 || o.analysis?.integrity?.finite === false || o.channelPeaks?.some((x: number) => !finite(x))) add('RENDER_INTEGRITY', 'stop', 1, true, 'critical');
  if (o.peak > 1e6) add('PATHOLOGICAL_LEVEL', 'stop', 1, true, 'critical');
  const ceiling = state?.outputCeilingDbtp, tp = o.loudness?.truePeakDbtp;
  if (finite(ceiling) && (!(finite(tp) || tp === -Infinity) || tp > ceiling + policy.peakToleranceDb)) {
    add('TRUE_PEAK_FAILED', 'reduce_gain', 0.99, true, 'critical', { targetDbtp: ceiling, measuredDbtp: tp ?? null });
  }
  const pcm = options.format === 'pcm16' ? 16 : options.format === 'pcm24' ? 24 : 0;
  if (pcm && ((o.positivePeak ?? o.peak) > 1 - 2 ** -(pcm - 1) || (o.negativePeak ?? -o.peak) < -1)) add('CLIPPED_EXPORT', 'stop', 1, true, 'critical');

  const stats = (options.stats || {}) as Record<string, number>, budget = options.limiterBudget ?? 4;
  if (stats.maxLimiterReductionDb! > budget + 0.05) add('EXCESSIVE_LIMITING', 'reduce_gain', 0.9, true, 'warning', { reductionDb: stats.maxLimiterReductionDb, budgetDb: budget });
  if (stats.maxDynamicsReductionDb! > 6) add('EXCESSIVE_COMPRESSION', 'reduce_compression', 0.8);
  if (loss(s.dynamics?.sectionSpreadDb, o.dynamics?.sectionSpreadDb, policy.sectionLossDb)) add('MACRO_CONTRAST', 'reduce_compression', 0.8);
  for (const scale of ['meso', 'macro'] as const) {
    if (loss(s.analysis?.dynamics?.[scale]?.spreadDb, o.analysis?.dynamics?.[scale]?.spreadDb, policy.sectionLossDb)) add(`${scale.toUpperCase()}_CONTRAST`, 'reduce_compression', 0.75);
  }
  if (loss(s.dynamics?.medianTransientCrestDb, o.dynamics?.medianTransientCrestDb, policy.transientLossDb) ||
    loss(s.analysis?.dynamics?.micro?.crestP90Db, o.analysis?.dynamics?.micro?.crestP90Db, policy.transientLossDb)) add('TRANSIENT_DAMAGE', 'reduce_dynamics', 0.7);

  const stereoWorse = loss(s.correlation, o.correlation, policy.correlationDrop) ||
    (o.stereo?.negativeWindowPercent ?? 0) > (s.stereo?.negativeWindowPercent ?? 0) + policy.negativeWindowIncrease;
  if (stereoWorse || o.correlation < -0.1) add('STEREO_PHASE_RISK', 'reduce_width', 0.9, stereoWorse);
  if (loss(s.stereo?.monoLossDb, o.stereo?.monoLossDb, policy.monoLossDb)) add('MONO_CANCELLATION', 'reduce_width', 0.9);
  if (finite(o.stereo?.sideMidDb) && o.stereo.sideMidDb > 6) add('EXCESSIVE_SIDE', 'reduce_width', 0.75, o.stereo.sideMidDb > (s.stereo?.sideMidDb ?? -Infinity) + 1);

  const bands: Record<string, any> = o.analysis?.spectrum?.bands || {};
  for (const [name, band] of Object.entries(bands)) {
    if (!name.startsWith('stereo') || !(band.fraction > 0.01)) continue;
    const original = s.analysis?.spectrum?.bands?.[name];
    if (band.correlation < -0.1 || band.monoLossDb < -6) {
      const introduced = original && ((band.correlation ?? 1) < (original.correlation ?? 1) - 0.15 || loss(original.monoLossDb, band.monoLossDb, 1));
      add('BAND_MONO_CANCELLATION', 'reduce_width', 0.8, !!introduced, 'warning', { band: name, monoLossDb: finite(band.monoLossDb) ? band.monoLossDb : null, completeCancellation: band.monoLossDb === -Infinity });
    }
  }
  if (loss(s.analysis?.dynamics?.monoTransientCrestDb, o.analysis?.dynamics?.monoTransientCrestDb, 2)) add('MONO_TRANSIENT_DAMAGE', 'reduce_width', 0.6);
  for (const band of ['lowFraction', 'highFraction'] as const) {
    if (s.spectral?.[band] > 0.001 && o.spectral?.[band] > s.spectral[band] * 2) add('SPECTRAL_EXTREME', 'reduce_eq', 0.6);
  }
  const lufs = o.loudness?.integratedLufs;
  if (finite(lufs) && lufs > policy.maximumAutoLufs) add('EXCESSIVE_LOUDNESS', 'reduce_gain', 0.65, lufs > (s.loudness?.integratedLufs ?? -Infinity) + 0.5);
  if (!finite(lufs)) add('LOUDNESS_UNAVAILABLE', 'use_conservative_settings', 0.9, false);
  if (o.dcOffset?.some((x: number) => Math.abs(x) > 0.01)) {
    add('DC_OFFSET', 'inspect_source', 0.95, o.dcOffset.some((x: number, i: number) => Math.abs(x) > Math.abs(s.dcOffset?.[i] ?? 0) + 0.005));
  }
  if (o.analysis?.integrity?.subnormalSamples > 0) add('DENORMAL_SAMPLES', 'inspect_source', 0.99, false);
  if (o.analysis?.integrity?.pathologicalSamples > 0) add('EXTREME_FLOAT_LEVEL', 'reduce_gain', 0.9, (o.peak ?? 0) > (s.peak ?? 0));
  const sub = bands.sub20?.fraction ?? 0;
  if (sub > 0.25) add('SUBSONIC_CONTENT', 'inspect_source', 0.65, sub > (s.analysis?.spectrum?.bands?.sub20?.fraction ?? 0) * 1.5 + 0.05);
  for (const p of state?.processors || []) {
    if (p.id !== 'eq' || p.bypassed) continue;
    for (const [key, limit] of [['lowDb', policy.eqLowDb], ['midDb', policy.eqMidDb], ['highDb', policy.eqHighDb]] as const) {
      if (Math.abs(p.parameters[key]!) > limit) add('EXTREME_EQ', 'reduce_eq', 0.8, true, 'warning', { instanceId: p.instanceId, parameter: key, gainDb: p.parameters[key], limitDb: limit });
    }
  }
  const critical = warnings.some(w => w.severity === 'critical'), backoff = warnings.some(w => w.introduced && w.severity !== 'critical');
  return {
    schemaVersion: 1, decision: critical ? 'fail' : backoff ? 'backoff' : 'pass', critical, warnings,
    confidenceMethod: 'Heuristic evidence strength, not calibrated probability', overrideAllowed: !critical,
  };
}

/** @throws EngineError carrying the first critical warning's code when the result is critical. */
export function assertIntegrity(result: SafetyResult): SafetyResult {
  if (result.critical) {
    const first = result.warnings.find(w => w.severity === 'critical')!;
    throw Object.assign(new EngineError(first.code, `Render integrity failed: ${first.code}. No export was created.`), { safety: result });
  }
  return result;
}
