import { analyzeTrack, verifyPeak, type AudioData } from '../engine';
import { check, fail } from '../engine/errors';
import type { CheckedMp3, CheckedMp3Options, Mp3Codec } from './types';

export const MP3_BITRATES = [320, 192] as const;
const RATES = [32000, 44100, 48000];
/** MP3 encoders pad and delay; a larger length difference means the decode is not this file. */
const MAX_DECODED_LENGTH_DRIFT = 4096;
const PASSES = 4;
const TARGET_TOLERANCE_LU = 0.2;
const MAX_CODEC_GAIN_DB = 3;

/** MPEG-1 Layer III as shipped: mono/stereo at 32, 44.1 or 48 kHz, CBR 192 or 320 kbps. */
export function validateMp3(buffer: Pick<AudioData, 'numberOfChannels' | 'sampleRate'>, bitrate: number = 320): void {
  if (![1, 2].includes(buffer.numberOfChannels) || !RATES.includes(buffer.sampleRate)) {
    fail('UNSUPPORTED_MP3', 'MP3 export supports mono or stereo at 32, 44.1 or 48 kHz. Export WAV to keep this source format.');
  }
  if (!(MP3_BITRATES as readonly number[]).includes(bitrate)) fail('UNSUPPORTED_MP3', 'Choose 192 or 320 kbps MP3.');
}

const scaled = (buffer: AudioData, gainDb: number): AudioData => {
  const gain = 10 ** (gainDb / 20);
  return { ...buffer, channels: buffer.channels.map(c => Float32Array.from(c, x => x * gain)) };
};

/**
 * Encode, decode and re-measure until the *decoded* MP3 holds the ceiling and,
 * when a target is set, lands within 0.2 LU of it. Corrections are codec-only
 * gain (±1 dB per pass, ±3 dB total) and never spend checked peak headroom.
 * Returns the closest verified pass; fails if no pass held the ceiling.
 */
export async function encodeCheckedMp3(buffer: AudioData, codec: Mp3Codec, options: CheckedMp3Options = {}): Promise<CheckedMp3> {
  const bitrate = options.bitrate ?? 320;
  validateMp3(buffer, bitrate);
  const { signal } = options;
  const ceiling = options.ceilingDbtp ?? 0;
  let gainDb = 0, candidate = buffer;
  let best: { result: CheckedMp3; error: number } | null = null;

  for (let pass = 0; pass < PASSES; pass++) {
    check(signal);
    const bytes = await codec.encode(candidate, bitrate, { signal, onProgress: options.onProgress });
    options.onStatus?.('Checking decoded MP3...');
    const decoded = await codec.decode(bytes, { signal });
    check(signal);
    if (decoded.sampleRate !== buffer.sampleRate || decoded.numberOfChannels !== buffer.numberOfChannels
      || Math.abs(decoded.length - buffer.length) > MAX_DECODED_LENGTH_DRIFT) {
      fail('EXPORT_VERIFICATION_FAILED', 'The decoded MP3 does not match the master\'s format. Export WAV instead.');
    }
    const verification = await verifyPeak(decoded, ceiling, { signal });
    const last = pass === PASSES - 1;

    if (verification.verified) {
      const metrics = await analyzeTrack(decoded, { signal });
      const measured = metrics.loudness.integratedLufs;
      const error = Number.isFinite(options.targetLufs) && Number.isFinite(measured) ? options.targetLufs! - measured! : 0;
      const result: CheckedMp3 = {
        bytes, metrics, decodedDuration: decoded.duration,
        verification: { ...verification, codecGainDb: gainDb, codecAttenuationDb: Math.max(0, -gainDb), passes: pass + 1, ceilingDbtp: ceiling },
      };
      if (!best || Math.abs(error) < best.error) best = { result, error: Math.abs(error) };
      if (Math.abs(error) <= TARGET_TOLERANCE_LU || last) return best.result;
      let adjustment = Math.max(-1, Math.min(1, error));
      // Lifting is bounded by the decoded peak's measured headroom (0.1 dB margin).
      if (adjustment > 0) adjustment = Math.min(adjustment, Math.max(0, ceiling - verification.checkedPeakDbtp - 0.1));
      const next = Math.max(-MAX_CODEC_GAIN_DB, Math.min(MAX_CODEC_GAIN_DB, gainDb + adjustment));
      if (Math.abs(next - gainDb) < 0.01) return best.result;
      gainDb = next;
    } else {
      gainDb -= Math.max(0.1, verification.checkedPeakDbtp - ceiling + 0.1);
      if (last || gainDb < -MAX_CODEC_GAIN_DB) {
        if (best) return best.result;
        fail('ENCODED_PEAK_FAILED', 'The decoded MP3 exceeds the selected ceiling. Export WAV to keep the checked master.');
      }
    }
    options.onStatus?.(`Re-encoding MP3 with ${gainDb.toFixed(2)} dB codec gain...`);
    candidate = scaled(buffer, gainDb);
  }
  return fail('ENCODED_PEAK_FAILED', 'MP3 verification did not converge.');
}
