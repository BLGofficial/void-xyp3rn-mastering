import { DEFINITIONS, validateState } from '../dsp';
import { analyzeTrack, assertIntegrity, EngineError, evaluateSafety, renderChain, renderToTarget, SAFETY_DEFAULTS, type AudioData, type TrackMetrics } from '../engine';
import { adapt, rounded, suggest, toneProposal } from './proposals';
import type { AutoMaster, AutoTargetResult, Proposal, RenderProposalOptions, Style } from './types';

const MAX_CANDIDATES = 3;
/** Section-contrast loss (dB) that makes the compressor back off. */
const MACRO_LOSS_DB = 1.5;
const fixed = (v: number | null | undefined, d = 1) => (Number.isFinite(v) ? (v as number).toFixed(d) : 'n/a');

/**
 * Render a proposal and check it against the source. Introduced safety risks back the
 * treatment off and re-render (max 3 candidates); peak/limiter overshoot lowers the trim.
 * An explicit loudness target is applied last, on the checked musical render.
 * @throws EngineError `AUTO_SAFETY_FAILED` if the third candidate still introduces risks.
 */
export async function renderProposal(buffer: AudioData, metrics: TrackMetrics, candidate: Proposal, options: RenderProposalOptions = {}): Promise<AutoMaster> {
  const proposal = adapt(toneProposal(candidate, options.tone || 'neutral'), metrics, options);
  const state = proposal.state;
  if (options.renderSettings) {
    const settings = validateState(options.renderSettings);
    state.quality = settings.quality;
    state.outputCeilingDbtp = settings.outputCeilingDbtp;
  }
  const requestedTarget = proposal.requestedLoudnessTarget ?? state.loudnessTarget?.targetLufs;
  delete state.loudnessTarget;
  const { style, intensity } = proposal;
  if (intensity > 0) state.outputCeilingDbtp = Math.min(state.outputCeilingDbtp ?? -1, -1);
  const limits = proposal.eqLimits!;

  let output!: AudioData, measured!: TrackMetrics, reduction = 0;
  for (let pass = 0; pass < MAX_CANDIDATES; pass++) {
    if (options.signal?.aborted) throw new Error('Operation cancelled.');
    options.onStatus?.(`Auto: rendering candidate ${pass + 1}...`);
    output = await renderChain(buffer, state, { ...options, onRenderStats: stats => { reduction = stats.maxLimiterReductionDb; } });
    options.onStatus?.('Auto: checking loudness and peaks...');
    options.onPhase?.({ phase: 'measure' });
    measured = await analyzeTrack(output, options);
    const assessment = evaluateSafety(metrics, measured, state, {
      stats: output.processingStats, limiterBudget: proposal.budget,
      limits: { eqLowDb: limits.lowDb, eqMidDb: limits.midDb, eqHighDb: limits.highDb },
    });
    assertIntegrity(assessment);
    proposal.safety = assessment;
    const introduced = assessment.warnings.filter(w => w.introduced);
    if (introduced.length) {
      const codes = introduced.map(w => w.code);
      proposal.safetyWarnings = [...new Set([...(proposal.safetyWarnings || []), ...codes])];
      if (pass === MAX_CANDIDATES - 1) {
        throw Object.assign(new EngineError('AUTO_SAFETY_FAILED', 'The automatic candidate kept breaking source safety thresholds. Your previous checked audio is unchanged.'), { safety: assessment });
      }
      const actions = new Set(introduced.map(w => w.recommendedAction));
      for (const m of state.processors) {
        if (m.id === 'width' && actions.has('reduce_width')) m.parameters.amount = 1;
        if (m.id === 'eq' && (actions.has('reduce_eq') || actions.has('reduce_width'))) {
          for (const key of ['lowDb', 'midDb', 'highDb'] as const) {
            const requested = m.parameters[key]!;
            m.parameters[key]! *= 0.5;
            proposal.eqDecisions!.push({ module: DEFINITIONS.eq.name, parameter: key, requestedDb: requested, actualDb: m.parameters[key]!, reason: `Safety pass halved the move: ${codes.join(', ')}`, confidence: 0.8 });
          }
        }
        if (m.id === 'dynamics' && (actions.has('reduce_compression') || actions.has('reduce_dynamics'))) {
          m.parameters.maxReductionDb! *= 0.5;
          if (pass === 1) m.bypassed = true;
        }
        if (m.id === 'clip') m.bypassed = true;
        if (m.id === 'trim') {
          m.parameters.gainDb = Math.max(-24, actions.has('reduce_gain')
            ? m.parameters.gainDb! - Math.max(0.25, reduction - proposal.budget + 0.15, (measured.loudness.integratedLufs as number) - SAFETY_DEFAULTS.maximumAutoLufs + 0.1)
            : Math.min(m.parameters.gainDb!, 0));
        }
      }
      proposal.macroProtection = 'Safety thresholds triggered: treatment reduced and re-checked.';
      continue;
    }
    const sourceSpread = metrics.dynamics?.sectionSpreadDb, renderSpread = measured.dynamics?.sectionSpreadDb;
    const compressor = state.processors.find(p => p.id === 'dynamics');
    if (pass < MAX_CANDIDATES - 1 && compressor && !compressor.bypassed && Number.isFinite(sourceSpread) && sourceSpread! > 4 &&
      Number.isFinite(renderSpread) && sourceSpread! - renderSpread! > MACRO_LOSS_DB) {
      compressor.parameters.maxReductionDb = rounded(compressor.parameters.maxReductionDb! * 0.5);
      if (pass === 1) compressor.bypassed = true;
      proposal.macroProtection = 'Section contrast dropped more than 1.5 dB: compression reduced and re-checked.';
      continue;
    }
    if (intensity === 0) break;
    const peakCorrection = Math.max(0, (measured.loudness.truePeakDbtp as number) - (state.outputCeilingDbtp ?? -1.1));
    const correction = Math.max(peakCorrection, reduction - proposal.budget);
    if (correction <= 0.05) break;
    const trim = state.processors[0]!;
    if (pass === MAX_CANDIDATES - 1 || trim.parameters.gainDb! - correction < -24) {
      throw new Error('Auto could not stay inside its peak and limiter limits. Your previous chain is unchanged; use the manual chain.');
    }
    trim.parameters.gainDb = Math.floor((trim.parameters.gainDb! - correction - 0.1) * 10) / 10;
  }

  let targetResult: AutoTargetResult = { requested: null, achieved: measured.loudness.integratedLufs, status: 'reference', passes: 0 };
  if (Number.isFinite(requestedTarget)) {
    proposal.state.loudnessTarget = { targetLufs: requestedTarget!, correctionDb: 0 };
    const targeted = await renderToTarget(buffer, proposal.state, { ...options, sourceMetrics: metrics });
    proposal.state = targeted.state; output = targeted.buffer; measured = targeted.metrics; targetResult = targeted.targetResult!;
    proposal.safety = assertIntegrity(evaluateSafety(metrics, measured, proposal.state, { stats: output.processingStats, limiterBudget: proposal.budget }));
  }
  const [trim, eq, dynamics] = proposal.state.processors as [typeof proposal.state.processors[0], typeof proposal.state.processors[0], typeof proposal.state.processors[0]];
  const notes = [
    `${style[0]!.toUpperCase() + style.slice(1)} at ${intensity}%. Source ${fixed(metrics.loudness.integratedLufs)} LUFS, master ${fixed(measured.loudness.integratedLufs)} LUFS.`,
    `Trim ${fixed(trim.parameters.gainDb)} dB. ${dynamics.bypassed ? 'No extra compression.' : `Compression ${fixed(dynamics.parameters.ratio)}:1, ${dynamics.parameters.attackMs} ms attack, ${fixed(dynamics.parameters.makeupDb)} dB makeup.`}`,
    `Tone: low ${fixed(eq.parameters.lowDb)} dB, mid ${fixed(eq.parameters.midDb)} dB, high ${fixed(eq.parameters.highDb)} dB. Taste moves, not detected faults. Width untouched.`,
    intensity === 0
      ? output.peakGuard && output.peakGuard.attenuationDb > 0 ? 'Zero intensity: neutral chain; the output ceiling lowered the whole render.' : 'Zero intensity: neutral chain; source samples preserved.'
      : `Limiter peaked at ${reduction.toFixed(1)} dB reduction. Output true peak ${fixed(measured.loudness.truePeakDbtp)} dBTP.`,
    `The ${proposal.target} LUFS style reference is a guide. Dynamics come first.`,
  ];
  if (proposal.decision) notes.unshift(proposal.decision);
  if (proposal.macroProtection) notes.push(proposal.macroProtection);
  if (output.processingStats) {
    notes.push(`Compression: ${output.processingStats.maxDynamicsReductionDb.toFixed(1)} dB max, ${output.processingStats.meanDynamicsReductionDb.toFixed(1)} dB mean. Stereo linked; no auto widening.`);
  }
  if (output.peakGuard) notes.push(`Ceiling check: ${output.peakGuard.attenuationDb.toFixed(2)} dB whole-render attenuation, ${output.peakGuard.afterDbtp.toFixed(2)} dBTP. Level only, dynamics untouched.`);
  if (proposal.tone !== 'neutral') notes.push(`Tone: ${proposal.tone}. Shelves applied before the peak and loudness checks.`);

  const explanation: AutoMaster['explanation'] = {
    schemaVersion: 1,
    summary: `${proposal.preset || style} master, checked against source-aware safety limits.`,
    confidence: proposal.confidence,
    changes: [
      ...proposal.eqDecisions!,
      {
        module: DEFINITIONS.dynamics.name,
        reason: proposal.sourceQuality?.likelyAlreadyMastered ? 'Source looks already mastered' : proposal.transientProtection ? 'Transient-heavy source' : 'Measured crest and section contrast',
        action: dynamics.bypassed ? 'No extra compression' : { ratio: dynamics.parameters.ratio, attackMs: dynamics.parameters.attackMs, maxReductionDb: dynamics.parameters.maxReductionDb },
      },
      { module: DEFINITIONS.width.name, reason: 'No measured reason to widen', action: 'Width untouched' },
      { module: DEFINITIONS.limit.name, reason: 'Bounded gain-reduction budget', action: { maximumReductionDb: reduction, budgetDb: proposal.budget } },
    ],
    loudness: { requested: proposal.requestedLoudnessTarget ?? null, reference: proposal.target, achieved: measured.loudness.integratedLufs },
    warnings: proposal.safety!.warnings,
  };
  explanation.loudness = { ...explanation.loudness, ...targetResult };
  if (intensity === 0 && targetResult.requested !== null) notes[3] = 'Zero intensity: neutral chain. The explicit loudness target still applies.';
  if (targetResult.requested !== null) {
    notes.push(`Target ${targetResult.requested} LUFS; measured ${fixed(targetResult.achieved)} LUFS. ${(targetResult as { reason?: string }).reason ?? ''}`.trim());
  }
  return { ...proposal, targetResult, explanation, buffer: output, metrics: measured, notes };
}

/** suggest() then renderProposal(). */
export async function master(buffer: AudioData, metrics: TrackMetrics, style: Style, intensity: number, options: RenderProposalOptions = {}): Promise<AutoMaster> {
  return renderProposal(buffer, metrics, suggest(buffer, metrics, style, intensity), options);
}
