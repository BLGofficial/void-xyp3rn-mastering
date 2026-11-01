import type { AudioData } from '../engine';
import type { CheckedMp3, CheckedMp3Options, Mp3Codec } from './types';

export const MP3_BITRATES = [320, 192] as const;

export function validateMp3(_buffer: Pick<AudioData, 'numberOfChannels' | 'sampleRate'>, _bitrate?: number): void {
  throw new Error('not yet (phase 5 stub)');
}

export async function encodeCheckedMp3(_buffer: AudioData, _codec: Mp3Codec, _options: CheckedMp3Options = {}): Promise<CheckedMp3> {
  throw new Error('not yet (phase 5 stub)');
}
