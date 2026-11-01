/// <reference lib="webworker" />
// MP3 encoder worker. LAME (lamejs, LGPL-3.0) stays a separate, unmodified
// script loaded at runtime; this file only adapts float audio to it.

import type { Mp3Reply, Mp3Request } from './protocol';
import { MP3_CHUNK_FRAMES } from './protocol';

interface Lame {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  };
}
declare const self: DedicatedWorkerGlobalScope & { lamejs: Lame };

self.importScripts('/vendor/lamejs/lame.min.js');

let encoder: InstanceType<Lame['Mp3Encoder']> | null = null;
let channelCount = 0;

/** LAME takes 16-bit PCM. The policy above re-measures the decode, so clamping +1.0 to 32767 is safe. */
function toPcm16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const v = channel[i]!;
    if (!Number.isFinite(v)) throw new Error('Cannot encode non-finite audio samples.');
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32768)));
  }
  return out;
}

const post = (reply: Mp3Reply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);
const send = (bytes: Int8Array, done: boolean) => {
  const copy = new Uint8Array(bytes.length);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
  post({ bytes: copy.buffer, done }, [copy.buffer]);
};

self.onmessage = ({ data }: MessageEvent<Mp3Request>) => {
  try {
    if (data.type === 'init') {
      if (![1, 2].includes(data.channels) || ![32000, 44100, 48000].includes(data.sampleRate)) throw new Error('Unsupported MP3 format.');
      if (![192, 320].includes(data.bitrate)) throw new Error('Unsupported MP3 bitrate.');
      channelCount = data.channels;
      encoder = new self.lamejs.Mp3Encoder(channelCount, data.sampleRate, data.bitrate);
      return post({ ready: true });
    }
    if (!encoder) throw new Error('MP3 encoder is not initialised.');
    if (data.type === 'chunk') {
      const frames = data.channels[0]?.length ?? 0;
      if (data.channels.length !== channelCount || frames < 1 || frames > MP3_CHUNK_FRAMES || data.channels.some(c => c.length !== frames)) {
        throw new Error('Invalid MP3 chunk.');
      }
      const [left, right] = data.channels.map(toPcm16);
      return send(encoder.encodeBuffer(left!, right), false);
    }
    if (data.type === 'finish') return send(encoder.flush(), true);
    throw new Error('Unknown MP3 operation.');
  } catch (error) {
    post({ error: (error as Error).message });
  }
};
