// Explicit final loudness targeting. The musical chain is rendered once; only a
// single output gain is iterated, then folded into the saved state.

import { validateState, type ChainState } from '../dsp';
import { analyzeTrack } from './analyze';
import { check } from './errors';
import { protectTruePeak, renderChain } from './render';
import { assertIntegrity, evaluateSafety } from './safety';
import type { AudioData, TargetDiagnostic, TargetOptions, TargetRender, TargetResult } from './types';

/** Loudness-target success tolerance in LU. */
export const TARGET_TOLERANCE_LU = 0.2;
const MAX_PASSES = 4;
const COPY_BLOCK = 65536;
/** Default safety ceiling when a target is set without one: loudness never buys overs. */
const DEFAULT_TARGET_CEILING_DBTP = -1;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Render, then iterate a single output gain (max 4 corrections, ±12 dB steps) until
 * integrated loudness is within 0.2 LU of `state.loudnessTarget.targetLufs`, under a true-peak ceiling.
 * @throws EngineError when the final render fails the safety integrity gate.
 */
export async function renderToTarget(source: AudioData, state: ChainState, options: TargetOptions = {}): Promise<TargetRender> {
  const final = validateState(state), requested = final.loudnessTarget?.targetLufs;
  if (!Number.isFinite(requested)) {
    const buffer = await renderChain(source, final, options);
    return { state: final, buffer, metrics: await analyzeTrack(buffer, options), targetResult: null };
  }
  const targetLufs = requested!;
  // Always start from the source and an uncorrected render: never stack a previous
  // candidate's or a saved correction's gain onto a new baseline.
  const baseState = validateState(final);
  delete baseState.loudnessTarget;
  baseState.outputCeilingDbtp = null;
  const base = await renderChain(source, baseState, options);
  const candidateLufs = (await analyzeTrack(base, options)).loudness.integratedLufs;
  final.outputCeilingDbtp = final.outputCeilingDbtp ?? DEFAULT_TARGET_CEILING_DBTP;

  let correction = 0, buffer!: AudioData, metrics!: TargetRender['metrics'];
  const diagnostics: TargetDiagnostic[] = [];
  for (let pass = 0; pass <= MAX_PASSES; pass++) {
    check(options.signal);
    options.onStatus?.(`Checking final loudness${pass ? ` (${pass}/${MAX_PASSES})` : ''}...`);
    buffer = { ...base, channels: base.channels.map(c => new Float32Array(c.length)) };
    const gain = 10 ** (correction / 20);
    for (let start = 0; start < base.length; start += COPY_BLOCK) {
      check(options.signal);
      for (let c = 0; c < base.numberOfChannels; c++) {
        const from = base.channels[c]!, to = buffer.channels[c]!;
        for (let i = start; i < Math.min(start + COPY_BLOCK, base.length); i++) to[i] = from[i]! * gain;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    buffer.peakGuard = await protectTruePeak(buffer, final.outputCeilingDbtp!, options);
    metrics = await analyzeTrack(buffer, options);
    const actual = metrics.loudness.integratedLufs, error = targetLufs - (actual as number);
    diagnostics.push({
      requested_target_lufs: targetLufs, candidate_lufs: candidateLufs, correction_db: correction, post_correction_lufs: actual,
      error_lu: error, true_peak: metrics.loudness.truePeakDbtp, safety_attenuation_db: buffer.peakGuard.attenuationDb, iteration_count: pass,
    });
    if (!Number.isFinite(error) || Math.abs(error) <= TARGET_TOLERANCE_LU || pass === MAX_PASSES) break;
    // The peak guard only attenuates: more upstream gain can't get past it.
    if (error > 0 && buffer.peakGuard.attenuationDb > 0.001) break;
    const next = clamp(correction + clamp(error, -12, 12), -60, 24);
    if (Math.abs(next - correction) < 0.001) break;
    correction = next;
  }
  // Fold the guard's attenuation into the one saved gain, so a repeat render replays
  // the exact effective level (and re-checks peaks) without stacking corrections.
  final.loudnessTarget = { targetLufs, correctionDb: clamp(correction - buffer.peakGuard!.attenuationDb, -60, 24) };
  const achieved = metrics.loudness.integratedLufs;
  const differenceLu = Number.isFinite(achieved) ? (achieved as number) - targetLufs : null;
  const reached = differenceLu !== null && Number.isFinite(differenceLu) && Math.abs(differenceLu) <= TARGET_TOLERANCE_LU;
  const safetyLimited = !reached && buffer.peakGuard!.attenuationDb > 0.001;
  const targetResult: TargetResult = {
    requested: targetLufs, achieved, differenceLu,
    status: reached ? 'reached' : Number.isFinite(achieved) ? 'limited' : 'unavailable',
    targetReached: reached, safetyLimited, passes: diagnostics.length - 1, correctionDb: final.loudnessTarget.correctionDb,
    candidateLufs, toleranceLu: TARGET_TOLERANCE_LU, diagnostics,
    reason: reached ? 'Within 0.2 LU of the requested target.'
      : !Number.isFinite(achieved) ? 'Integrated loudness is unavailable; no target claim is made.'
        : safetyLimited ? 'Peak protection limited additional loudness.' : 'Bounded output-gain correction could not reach this target.',
  };
  assertIntegrity(evaluateSafety(options.sourceMetrics || {}, metrics, final, { stats: buffer.processingStats }));
  return { state: final, buffer, metrics, targetResult };
}
