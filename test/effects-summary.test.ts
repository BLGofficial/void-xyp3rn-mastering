import { describe, expect, it } from 'vitest';
import { defaultState, type ChainState } from '../lib/dsp';
import { effectsSummary } from '../lib/export';

const chainWith = (edit: (s: ChainState) => void) => {
  const s = defaultState();
  edit(s);
  return s;
};

describe('effects summary for the report', () => {
  it('lists applied effects in signal order with labels and units; bypassed ones separately', () => {
    const s = chainWith(s => {
      for (const p of s.processors) p.bypassed = !['trim', 'dynamics', 'limit'].includes(p.id);
      s.processors.find(p => p.id === 'trim')!.parameters.gainDb = 2.8;
      Object.assign(s.processors.find(p => p.id === 'dynamics')!.parameters, { thresholdDb: -13.4, ratio: 1.8, adaptive: 1 });
      Object.assign(s.processors.find(p => p.id === 'limit')!.parameters, { ceilingDb: -1.5, truePeak: 1 });
    });
    const sum = effectsSummary(s);
    expect(sum.applied.map(e => e.name)).toEqual(['Input Trim', 'Glue Compressor', 'Brickwall Limiter']);
    expect(sum.applied[0]!.settings).toEqual(['Gain +2.8 dB']);
    expect(sum.applied[1]!.settings).toContain('Threshold −13.4 dBFS');
    expect(sum.applied[1]!.settings).toContain('Ratio 1.8');
    expect(sum.applied[1]!.settings).toContain('Detector: hybrid program-dependent');
    expect(sum.applied[2]!.settings).toEqual(['Ceiling −1.5 dB', 'Release 100 ms', 'Detector: true-peak 4x']);
    // Space and Echo are only in the chain once added (+ SPACE / + ECHO).
    expect(sum.bypassed).toEqual(['Tone EQ', 'Stereo Width', 'Soft Ceiling Clip']);
  });

  it('describes the output stage: loudness target, ceiling, oversampling', () => {
    const s = chainWith(s => {
      s.quality = 'studio';
      s.outputCeilingDbtp = -1;
      s.loudnessTarget = { targetLufs: -14, correctionDb: 3.031 };
    });
    expect(effectsSummary(s).output).toEqual([
      'Loudness target −14 LUFS (output gain +3.03 dB, applied once after the effects)',
      'True-peak ceiling −1 dBTP',
      'Clip quality: 4x oversampled (studio)',
    ]);
  });

  it('says so when nothing was applied', () => {
    const s = chainWith(s => { for (const p of s.processors) p.bypassed = true; s.outputCeilingDbtp = null; });
    const sum = effectsSummary(s);
    expect(sum.applied).toEqual([]);
    expect(sum.output).toEqual(['No loudness target', 'No output ceiling', 'Clip quality: standard']);
  });
});
