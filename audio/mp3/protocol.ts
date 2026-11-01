// UI thread <-> MP3 encoder worker. Chunks are bounded so a long master streams
// through the encoder without one giant structured clone.

export const MP3_WORKER_URL = '/workers/mp3-encoder.js';
export const MP3_CHUNK_FRAMES = 65536;

export type Mp3Request =
  | { type: 'init'; sampleRate: number; channels: number; bitrate: number }
  | { type: 'chunk'; channels: Float32Array[] }
  | { type: 'finish' };

export type Mp3Reply = { ready: true } | { bytes: ArrayBuffer; done: boolean } | { error: string };
