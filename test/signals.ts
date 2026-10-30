// Deterministic test material. Seeded so a parity failure reproduces bit-for-bit.

/** mulberry32: tiny, well-distributed 32-bit PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Signal = Float64Array[];

const channelsOf = (n: number, frames: number): Signal => Array.from({ length: n }, () => new Float64Array(frames));

/**
 * Mix-like material: decaying 55 Hz kicks every 0.5 s, Paul Kellet pink noise,
 * a harmonic 220 Hz tone, decorrelated per channel. Peaks above 0 dBFS so the
 * clipper/limiter/compressor all engage.
 */
export function program(rate: number, seconds: number, channels: number, peak = 1.25, seed = 1): Signal {
  const frames = Math.round(rate * seconds), out = channelsOf(channels, frames);
  for (let c = 0; c < channels; c++) {
    const rnd = prng(seed + c * 7919), x = out[c]!;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / rate, beat = t % 0.5;
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      const kick = Math.sin(2 * Math.PI * 55 * beat * (1 + 2 * Math.exp(-beat * 40))) * Math.exp(-beat * 9);
      const tone = Math.sin(2 * Math.PI * 220 * t + c * 0.3) + 0.4 * Math.sin(2 * Math.PI * 660 * t) + 0.2 * Math.sin(2 * Math.PI * 1100 * t);
      x[i] = kick * 0.7 + pink * 0.35 + tone * 0.15;
    }
  }
  return normalize(out, peak);
}

/** Exponential sine sweep 20 Hz → 0.45·rate at the given peak (linear). */
export function sweep(rate: number, seconds: number, channels: number, peak = 0.5): Signal {
  const frames = Math.round(rate * seconds), out = channelsOf(channels, frames);
  const f0 = 20, f1 = rate * 0.45, k = Math.log(f1 / f0);
  for (let i = 0; i < frames; i++) {
    const v = peak * Math.sin(((2 * Math.PI * f0 * seconds) / k) * (Math.exp((k * i) / frames) - 1));
    for (let c = 0; c < channels; c++) out[c]![i] = c === 1 ? -v * 0.8 : v;
  }
  return out;
}

/** Unit impulse at frame 0 followed by silence: exposes reverb/delay tails exactly. */
export function impulse(rate: number, seconds: number, channels: number): Signal {
  const out = channelsOf(channels, Math.round(rate * seconds));
  for (let c = 0; c < channels; c++) out[c]![0] = c === 0 ? 1 : 0.5;
  return out;
}

/** Steady sine on every channel at `dbfs` peak, starting at `phase` radians. */
export function tone(rate: number, seconds: number, channels: number, hz: number, dbfs: number, phase = 0): Signal {
  const frames = Math.round(rate * seconds), out = channelsOf(channels, frames), a = 10 ** (dbfs / 20);
  for (let i = 0; i < frames; i++) {
    const v = a * Math.sin((2 * Math.PI * hz * i) / rate + phase);
    for (let c = 0; c < channels; c++) out[c]![i] = v;
  }
  return out;
}

/** Wrap a signal as a decoded-file buffer (Float32, as a WAV decoder would deliver). */
export function toBuffer(signal: Signal, sampleRate: number, channelMask = 0) {
  return {
    sampleRate, channelMask, length: signal[0]!.length, numberOfChannels: signal.length,
    channels: signal.map(c => Float32Array.from(c)),
  };
}

function normalize(signal: Signal, peak: number): Signal {
  let max = 0;
  for (const ch of signal) for (const v of ch) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  for (const ch of signal) for (let i = 0; i < ch.length; i++) ch[i]! *= g;
  return signal;
}
