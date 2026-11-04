'use client';

import type { LiveMeters } from '@/audio/protocol';
import { num, time } from './format';
import { Hint, useHint } from './hints';
import { Readout, Toggle } from './ui';

/** Play/pause, A/B against the source at matched loudness, and live meters. */
export function Transport({ playing, position, duration, onPlay, source, onSource, match, onMatch, meters, disabled }: {
  playing: boolean; position: number; duration: number; onPlay: () => void;
  source: boolean; onSource: () => void; match: boolean; onMatch: () => void; meters: LiveMeters | null; disabled: boolean;
}) {
  const path = source ? meters?.source : meters?.master;
  const hPlay = useHint('play'), hAb = useHint('ab'), hMatch = useHint('match');
  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" data-testid="play" className="xr-button-primary min-w-24" aria-describedby={hPlay.id} onClick={onPlay} disabled={disabled}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <span className="font-mono text-xs tabular-nums text-ash">{time(position)} / {time(duration)}</span>
          <Toggle pressed={source} onClick={onSource} testId="ab-toggle" label="Listen to source" disabled={disabled} describedBy={hAb.id}>
            {source ? 'Source' : 'Master'}
          </Toggle>
          <Toggle pressed={match} onClick={onMatch} label="Match source loudness to master" disabled={disabled} describedBy={hMatch.id}>Match LUFS</Toggle>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          <Readout label="Momentary" value={num(path?.momentaryLufs)} unit="LUFS" testId="meter-momentary" />
          <Readout label="Short-term" value={num(path?.shortTermLufs)} unit="LUFS" />
          <Readout label="True peak" value={num(path?.truePeakDbtp)} unit="dBTP" />
          <Readout label={source && match ? 'Match' : 'Reduction'} value={num(source && match ? meters?.matchGainDb : meters ? -meters.reductionDb : null)} unit="dB" />
        </div>
      </div>
      <Hint hint={hPlay} className="mt-3" />
      <Hint hint={hAb} />
      <Hint hint={hMatch} />
    </div>
  );
}
