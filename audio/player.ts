import type { ChainState } from '../lib/dsp';
import { WORKLET_NAME, WORKLET_URL, type LiveMeters, type WorkletEvent, type WorkletMessage } from './protocol';

export interface Player {
  readonly duration: number;
  /** Seconds into the track. */
  position(): number;
  isPlaying(): boolean;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setState(state: ChainState): void;
  /** true = hear the untouched source (A/B). */
  setSource(enabled: boolean): void;
  setMatch(enabled: boolean): void;
  dispose(): void;
}

/**
 * Realtime preview graph: AudioBufferSource -> chain worklet -> destination.
 * The context runs at the file's own rate so preview and offline render see identical samples.
 */
export async function createPlayer(
  channels: Float32Array[], sampleRate: number, state: ChainState,
  on: { meters?: (m: LiveMeters) => void; error?: (message: string) => void; ended?: () => void } = {},
): Promise<Player> {
  const ctx = new AudioContext({ sampleRate, latencyHint: 'playback' });
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const buffer = ctx.createBuffer(channels.length, channels[0]!.length, sampleRate);
  // Worker-transferred channels are plain ArrayBuffer-backed; TS can't know that.
  channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels.length],
    channelCount: channels.length, channelCountMode: 'explicit', channelInterpretation: 'discrete',
    processorOptions: { channels: channels.length, state },
  });
  node.connect(ctx.destination);
  const send = (m: WorkletMessage) => node.port.postMessage(m);
  node.port.onmessage = ({ data }: MessageEvent<WorkletEvent>) => {
    if (data.type === 'meters') on.meters?.(data.meters);
    else on.error?.(data.message);
  };

  let source: AudioBufferSourceNode | null = null;
  let offset = 0, startedAt = 0;
  const position = () => (source ? Math.min(buffer.duration, offset + ctx.currentTime - startedAt) : offset);
  const stopSource = () => {
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  };

  const player: Player = {
    duration: buffer.duration,
    position,
    isPlaying: () => source !== null,
    async play() {
      if (source) return;
      await ctx.resume();
      if (offset >= buffer.duration - 0.01) offset = 0;
      send({ type: 'reset' });
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(node);
      source.onended = () => {
        offset = 0;
        source = null;
        on.ended?.();
      };
      startedAt = ctx.currentTime;
      source.start(0, offset);
    },
    pause() {
      offset = position();
      stopSource();
    },
    seek(seconds) {
      const wasPlaying = source !== null;
      stopSource();
      offset = Math.max(0, Math.min(buffer.duration, seconds));
      if (wasPlaying) void player.play();
    },
    setState: state => send({ type: 'state', state }),
    setSource: enabled => send({ type: 'source', enabled }),
    setMatch: enabled => send({ type: 'match', enabled }),
    dispose() {
      stopSource();
      node.disconnect();
      void ctx.close();
    },
  };
  return player;
}
