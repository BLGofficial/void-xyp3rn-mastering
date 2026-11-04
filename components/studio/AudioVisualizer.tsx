'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { OrbAudioFrame, XYP3RNMasteringOrb } from '@/components/orb/XYP3RNMasteringOrb';
import styles from './AudioVisualizer.module.css';

type SourceMode = 'master' | 'file' | 'mic';
type VisualState = 'loading' | 'webgl' | 'fallback' | 'still';
type Bands = Pick<OrbAudioFrame, 'subBass' | 'bass' | 'mid' | 'treble' | 'energy'>;

const FFT_BINS = 64;
const MASTER_TITLE = 'XYP3RN_RENDERED_MASTER_24BIT.WAV';
const IDLE_BANDS: Bands = { subBass: 0, bass: 0, mid: 0, treble: 0, energy: 0 };

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function toDbString(value: number): string {
  const db = -60 + Math.max(0, Math.min(1, value)) * 60;
  return `${db.toFixed(1)} dB`;
}

function generateRenderedMasterWavUrl(): string {
  const sampleRate = 44100;
  const duration = 16;
  const channels = 2;
  const bytesPerSample = 3;
  const frames = sampleRate * duration;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  const bassScale = [55, 55, 65.41, 49, 55, 73.42, 61.74, 49];
  const arpScale = [440, 554.37, 659.25, 880, 659.25, 554.37, 739.99, 659.25];
  const stepDuration = 0.125;
  const write24 = (offset: number, sample: number) => {
    const signed = Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fffff);
    const value = signed < 0 ? 0x1000000 + signed : signed;
    view.setUint8(offset, value & 0xff);
    view.setUint8(offset + 1, (value >>> 8) & 0xff);
    view.setUint8(offset + 2, (value >>> 16) & 0xff);
  };
  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  };

  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    const step = Math.floor(time / stepDuration);
    const stepTime = time % stepDuration;

    let kick = 0;
    if (step % 4 === 0 || step % 16 === 14) {
      const envelope = Math.exp(-stepTime * 16);
      const frequency = 42 + 110 * Math.exp(-stepTime * 38);
      kick = Math.sin(2 * Math.PI * frequency * stepTime) * envelope * 0.72;
    }

    const bassFrequency = bassScale[Math.floor(step / 2) % bassScale.length]!;
    const bassEnvelope = Math.exp(-stepTime * 9);
    const saw = ((time * bassFrequency) % 1) * 2 - 1;
    const sub = Math.sin(2 * Math.PI * (bassFrequency * 0.5) * time);
    const bass = (saw * 0.25 + sub * 0.45) * bassEnvelope * 0.55;

    const arpFrequency = arpScale[step % arpScale.length]!;
    const arpEnvelope = Math.exp(-stepTime * 22);
    const arp = Math.sin(2 * Math.PI * arpFrequency * time) * arpEnvelope * 0.24;

    let hatLeft = 0;
    let hatRight = 0;
    if (step % 2 === 1) {
      const hatEnvelope = Math.exp(-stepTime * 48);
      hatLeft = noise(i) * hatEnvelope * 0.16;
      hatRight = noise(i + 53) * hatEnvelope * 0.16;
    }

    const left = Math.tanh((kick + bass + arp + hatLeft) * 1.25) * 0.92;
    const right = Math.tanh((kick + bass + arp * 0.96 + hatRight) * 1.25) * 0.92;
    const frameOffset = 44 + i * channels * bytesPerSample;
    write24(frameOffset, left);
    write24(frameOffset + bytesPerSample, right);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function bandAverage(data: Uint8Array, lowHz: number, highHz: number, binHz: number, scale: number): number {
  const first = Math.max(1, Math.floor(lowHz / binHz));
  const last = Math.min(data.length - 1, Math.max(first, Math.ceil(highHz / binHz)));
  if (first >= data.length || last < first) return 0;
  let total = 0;
  let count = 0;
  for (let i = first; i <= last; i++) {
    total += data[i]!;
    count++;
  }
  return Math.max(0, Math.min(1, (total / count / 255) * scale));
}

export function AudioVisualizer() {
  const stage = useRef<HTMLDivElement>(null);
  const fallbackCanvas = useRef<HTMLCanvasElement>(null);
  const orb = useRef<XYP3RNMasteringOrb | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const gain = useRef<GainNode | null>(null);
  const micSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const masterUrl = useRef<string | null>(null);
  const customUrl = useRef<string | null>(null);
  const rawFrequency = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const rawTime = useRef<Float32Array<ArrayBuffer> | null>(null);
  const modeRef = useRef<SourceMode>('master');
  const volumeRef = useRef(0.85);
  const seeking = useRef(false);
  const frame = useRef<OrbAudioFrame>({ spectrum: new Uint8Array(FFT_BINS), ...IDLE_BANDS });
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<SourceMode>('master');
  const [visual, setVisual] = useState<VisualState>('loading');
  const [playing, setPlaying] = useState(false);
  const [sourceName, setSourceName] = useState('STANDBY');
  const [status, setStatus] = useState('RENDERED MASTER READY');
  const [trackTitle, setTrackTitle] = useState(MASTER_TITLE);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(16);
  const [seekPercent, setSeekPercent] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [bands, setBands] = useState<Bands>(IDLE_BANDS);

  const selectMode = (next: SourceMode) => {
    modeRef.current = next;
    setMode(next);
  };

  const stopMicrophone = () => {
    micStream.current?.getTracks().forEach(track => track.stop());
    micStream.current = null;
    if (micSource.current) {
      try { micSource.current.disconnect(); } catch { /* already disconnected */ }
      micSource.current = null;
    }
  };

  const connectMediaOutput = () => {
    const node = analyser.current;
    const output = gain.current;
    if (!node || !output) return;
    try { node.disconnect(); } catch { /* no existing route */ }
    node.connect(output);
  };

  const releaseCustomUrl = () => {
    if (customUrl.current) URL.revokeObjectURL(customUrl.current);
    customUrl.current = null;
  };

  const setMasterTrack = (audio: HTMLAudioElement) => {
    const sourceUrl = masterUrl.current;
    if (!sourceUrl) return;
    audio.pause();
    audio.src = sourceUrl;
    audio.loop = true;
    audio.load();
    releaseCustomUrl();
    setTrackTitle(MASTER_TITLE);
    selectMode('master');
    setPosition(0);
    setSeekPercent(0);
    seeking.current = false;
  };

  const ensureAudioGraph = async (): Promise<AudioContext> => {
    let context = audioContext.current;
    if (!context) {
      const audio = audioElement.current;
      if (!audio) throw new Error('The audio player is still initializing. Try again in a moment.');
      const AudioContextConstructor = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('Web Audio is not available in this browser.');
      context = new AudioContextConstructor({ latencyHint: 'playback' });
      const meter = context.createAnalyser();
      meter.fftSize = 2048;
      meter.smoothingTimeConstant = 0.76;
      const output = context.createGain();
      output.gain.value = volumeRef.current;
      const media = context.createMediaElementSource(audio);
      media.connect(meter);
      meter.connect(output);
      output.connect(context.destination);
      audioContext.current = context;
      analyser.current = meter;
      gain.current = output;
      rawFrequency.current = new Uint8Array(meter.frequencyBinCount);
      rawTime.current = new Float32Array(meter.fftSize);
    }
    if (context.state === 'suspended') await context.resume();
    return context;
  };

  const switchToMaster = async () => {
    const audio = audioElement.current;
    if (!audio) return;
    try {
      await ensureAudioGraph();
      stopMicrophone();
      connectMediaOutput();
      setMasterTrack(audio);
      await audio.play();
      setPlaying(true);
      setSourceName('MASTER WAV');
      setStatus('PLAYING RENDERED MASTER AUDIO');
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'AUDIO PLAYBACK FAILED');
      setSourceName('STANDBY');
      setPlaying(false);
    }
  };

  const togglePlayPause = async () => {
    const audio = audioElement.current;
    if (!audio) return;
    if (modeRef.current === 'mic') {
      await switchToMaster();
      return;
    }
    try {
      await ensureAudioGraph();
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
        setSourceName(modeRef.current === 'master' ? 'MASTER WAV' : 'CUSTOM AUDIO');
        setStatus('PLAYING — ORB SYNCED TO AUDIO STREAM');
      } else {
        audio.pause();
        setPlaying(false);
        setSourceName('PAUSED');
        setStatus('PLAYBACK PAUSED');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'AUDIO PLAYBACK FAILED');
      setPlaying(false);
    }
  };

  const stopPlayback = () => {
    const audio = audioElement.current;
    if (!audio) return;
    if (modeRef.current === 'mic') {
      stopMicrophone();
      connectMediaOutput();
      setMasterTrack(audio);
    }
    audio.pause();
    if (Number.isFinite(audio.duration)) audio.currentTime = 0;
    setPlaying(false);
    setPosition(0);
    setSeekPercent(0);
    seeking.current = false;
    setSourceName('STOPPED');
    setStatus('PLAYBACK STOPPED & RESET');
  };

  const startMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('LIVE MICROPHONE IS NOT AVAILABLE IN THIS BROWSER');
      return;
    }
    try {
      const context = await ensureAudioGraph();
      const audio = audioElement.current;
      const meter = analyser.current;
      if (!audio || !meter) return;
      audio.pause();
      setPlaying(false);
      stopMicrophone();
      if (gain.current) {
        try { meter.disconnect(gain.current); } catch { /* no active speaker route */ }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (!stage.current?.isConnected) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      micStream.current = stream;
      micSource.current = context.createMediaStreamSource(stream);
      micSource.current.connect(meter);
      selectMode('mic');
      setSourceName('LIVE MIC');
      setStatus('LISTENING TO LIVE MICROPHONE');
    } catch {
      setStatus('MIC DENIED — PLAYING RENDERED MASTER');
      await switchToMaster();
    }
  };

  const handleAudioFile = async (file: File) => {
    const audio = audioElement.current;
    if (!audio) return;
    try {
      await ensureAudioGraph();
      stopMicrophone();
      connectMediaOutput();
      audio.pause();
      const previous = customUrl.current;
      const url = URL.createObjectURL(file);
      customUrl.current = url;
      audio.src = url;
      audio.loop = false;
      audio.load();
      if (previous) URL.revokeObjectURL(previous);
      selectMode('file');
      setTrackTitle(file.name.toUpperCase());
      setPosition(0);
      setSeekPercent(0);
      setSourceName('CUSTOM FILE');
      setStatus(`PLAYING: ${file.name.toUpperCase()}`);
      await audio.play();
      setPlaying(true);
    } catch (error) {
      setPlaying(false);
      setStatus(error instanceof Error ? error.message.toUpperCase() : 'COULD NOT PLAY THIS AUDIO FILE');
    }
  };

  const changeSeek = (value: number) => {
    setSeekPercent(value);
    const audio = audioElement.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      setPosition((value / 100) * audio.duration);
      seeking.current = true;
    }
  };

  const commitSeek = (value: number) => {
    const audio = audioElement.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (value / 100) * audio.duration;
      setPosition(audio.currentTime);
    }
    seeking.current = false;
  };

  const changeVolume = (value: number) => {
    volumeRef.current = value;
    setVolume(value);
    if (gain.current && audioContext.current) {
      gain.current.gain.setTargetAtTime(value, audioContext.current.currentTime, 0.015);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void handleAudioFile(file);
  };

  useEffect(() => {
    const audio = new Audio();
    const url = generateRenderedMasterWavUrl();
    masterUrl.current = url;
    audioElement.current = audio;
    audio.crossOrigin = 'anonymous';
    audio.preload = 'metadata';
    audio.loop = true;
    audio.src = url;

    const onMetadata = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onTime = () => {
      if (seeking.current || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
      setPosition(audio.currentTime);
      setSeekPercent((audio.currentTime / audio.duration) * 100);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
      setSeekPercent(0);
      setSourceName('FINISHED');
      setStatus('PLAYBACK COMPLETE');
    };
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onMetadata);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.load();

    return () => {
      audio.pause();
      stopMicrophone();
      try { analyser.current?.disconnect(); } catch { /* already disconnected */ }
      try { gain.current?.disconnect(); } catch { /* already disconnected */ }
      if (audioContext.current) void audioContext.current.close();
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', onMetadata);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      if (customUrl.current) URL.revokeObjectURL(customUrl.current);
      masterUrl.current = null;
      customUrl.current = null;
      audioElement.current = null;
      audioContext.current = null;
      analyser.current = null;
      gain.current = null;
    };
    // Lifecycle setup is intentionally once per mounted player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const idle = frame.current;
    let lastUiUpdate = 0;

    const sample = () => {
      const activeMeter = analyser.current;
      const raw = rawFrequency.current;
      const timeSamples = rawTime.current;
      const audio = audioElement.current;
      const active = modeRef.current === 'mic' ? micStream.current !== null : !!audio && !audio.paused;
      idle.spectrum.fill(0);
      let nextBands = IDLE_BANDS;

      if (activeMeter && raw && timeSamples && active) {
        activeMeter.getByteFrequencyData(raw);
        activeMeter.getFloatTimeDomainData(timeSamples);
        const binHz = activeMeter.context.sampleRate / activeMeter.fftSize;
        const nyquist = activeMeter.context.sampleRate / 2;
        for (let i = 0; i < FFT_BINS; i++) {
          const ratio = i / (FFT_BINS - 1);
          const frequencyHz = 30 * Math.pow(nyquist / 30, ratio);
          const index = Math.max(0, Math.min(raw.length - 1, Math.round(frequencyHz / binHz)));
          idle.spectrum[i] = raw[index]!;
        }
        let sumSquares = 0;
        for (let i = 0; i < timeSamples.length; i++) sumSquares += timeSamples[i]! * timeSamples[i]!;
        const rms = Math.sqrt(sumSquares / timeSamples.length);
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -60;
        nextBands = {
          subBass: bandAverage(raw, 20, 80, binHz, 1.45),
          bass: bandAverage(raw, 80, 250, binHz, 1.55),
          mid: bandAverage(raw, 250, 2500, binHz, 1.65),
          treble: bandAverage(raw, 2500, nyquist, binHz, 1.95),
          energy: Math.max(0, Math.min(1, (rmsDb + 54) / 48)),
        };
      }

      idle.subBass = nextBands.subBass;
      idle.bass = nextBands.bass;
      idle.mid = nextBands.mid;
      idle.treble = nextBands.treble;
      idle.energy = nextBands.energy;
      orb.current?.setAudioFrame(idle);

      const now = performance.now();
      if (now - lastUiUpdate >= 90) {
        lastUiUpdate = now;
        setBands({ ...nextBands });
      }
    };

    // Keep the FFT fresh without tying audio analysis to React's render cadence.
    const timer = window.setInterval(sample, 32);
    sample();
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisual('still');
      return;
    }
    let disposed = false;
    let watch = 0;
    let instance: XYP3RNMasteringOrb | null = null;
    const forced = new URLSearchParams(window.location.search).get('orb') === 'webgl';
    const fallback = () => {
      const current = instance;
      instance = null;
      if (orb.current === current) orb.current = null;
      current?.destroy();
      if (!disposed) setVisual('fallback');
    };

    import('@/components/orb/XYP3RNMasteringOrb')
      .then(({ XYP3RNMasteringOrb: Orb }) => {
        if (disposed || !stage.current) return;
        instance = new Orb(stage.current, { zoom: true });
        orb.current = instance;
        instance.setAudioReactive(true);
        instance.setAudioFrame(frame.current);
        if (instance.software && !forced) return fallback();
        setVisual('webgl');
        if (forced) return;

        // If a discrete GPU cannot sustain the orb, drop to the lightweight 2D fallback.
        let previous = performance.now();
        let slowFrames = 0;
        let frames = 0;
        const guard = (now: number) => {
          const delta = now - previous;
          previous = now;
          if (++frames > 3) slowFrames = delta > 50 ? slowFrames + 1 : 0;
          if (slowFrames >= 3) return fallback();
          if (frames < 90 && !disposed) watch = requestAnimationFrame(guard);
        };
        watch = requestAnimationFrame(guard);
      })
      .catch(() => { if (!disposed) setVisual('fallback'); });

    return () => {
      disposed = true;
      cancelAnimationFrame(watch);
      if (instance) {
        instance.destroy();
        if (orb.current === instance) orb.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (visual !== 'fallback') return;
    const canvas = fallbackCanvas.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let animation = 0;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const x = width / 2;
      const y = height / 2;
      const radius = Math.min(width, height) * (0.18 + frame.current.energy * 0.02);
      const haze = context.createRadialGradient(x, y, radius * 0.15, x, y, radius * 2.2);
      haze.addColorStop(0, 'rgba(250,205,104,0.12)');
      haze.addColorStop(0.52, 'rgba(201,160,62,0.045)');
      haze.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = haze;
      context.fillRect(0, 0, width, height);

      context.save();
      context.globalCompositeOperation = 'lighter';
      for (let i = 0; i < FFT_BINS; i++) {
        const angle = (i / FFT_BINS) * Math.PI * 2 - Math.PI / 2;
        const level = frame.current.spectrum[i]! / 255;
        const inner = radius * 0.8;
        const outer = radius + level * radius * 0.6 + frame.current.energy * radius * 0.08;
        context.beginPath();
        context.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
        context.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
        context.strokeStyle = `rgba(250,205,104,${0.28 + level * 0.65})`;
        context.lineWidth = 1.2 + level * 2.1;
        context.shadowBlur = 6 + level * 12;
        context.shadowColor = 'rgba(250,205,104,0.85)';
        context.stroke();
      }
      context.beginPath();
      context.arc(x, y, radius * (0.72 + frame.current.energy * 0.08), 0, Math.PI * 2);
      context.strokeStyle = 'rgba(250,205,104,0.55)';
      context.lineWidth = 1.2;
      context.shadowBlur = 22;
      context.stroke();
      context.restore();
      animation = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animation);
  }, [visual]);

  const handleSeekRelease = (event: React.SyntheticEvent<HTMLInputElement>) => {
    commitSeek(Number(event.currentTarget.value));
  };

  return (
    <main className={styles.visualizer} data-testid="audio-visualizer" data-visual={visual}>
      <div ref={stage} className={styles.stage} aria-hidden="true">
        <canvas ref={fallbackCanvas} className={`${styles.fallbackCanvas} ${visual === 'webgl' ? styles.fallbackHidden : ''}`} />
        {(visual === 'loading' || visual === 'still') && (
          <div className={`${styles.loadingOrb} ${visual === 'still' ? styles.stillOrb : ''}`} />
        )}
      </div>

      <nav className={styles.topNav} aria-label="Visualizer navigation">
        <Link className={styles.backLink} href="/" aria-label="Back to mastering studio">
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          <span className={styles.backText}>Mastering Studio</span>
        </Link>
      </nav>

      <section className={styles.telemetry} aria-label="Live audio telemetry">
        <div className={styles.metric}>
          <span className={styles.metricLabel}>SOURCE</span>
          <span className={`${styles.metricValue} ${styles.metricAccent}`} data-testid="visualizer-source">{sourceName}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>SUB / BASS</span>
          <span className={styles.metricValue} data-testid="visualizer-bass">{toDbString(Math.max(bands.subBass, bands.bass))}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>MIDS</span>
          <span className={styles.metricValue} data-testid="visualizer-mids">{toDbString(bands.mid)}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>HIGHS</span>
          <span className={`${styles.metricValue} ${styles.metricAccent}`} data-testid="visualizer-highs">{toDbString(bands.treble)}</span>
        </div>
      </section>

      <section className={styles.dock} aria-label="Audio visualizer controls">
        <div className={styles.dockHeader}>
          <span className={styles.stageName} role="status" aria-live="polite" data-testid="visualizer-status">{status}</span>
          <div className={styles.levelMeter} aria-label={`RMS level ${Math.round(bands.energy * 100)} percent`}>
            <span className={`${styles.pulseDot} ${bands.energy > 0.25 || bands.bass > 0.4 ? styles.pulseActive : ''}`} aria-hidden="true" />
            <span data-testid="visualizer-rms">{Math.round(bands.energy * 100)}%</span>
          </div>
        </div>
        <div className={styles.spectrumStrip} role="meter" aria-label="Audio energy" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bands.energy * 100)}>
          <div className={styles.spectrumFill} style={{ width: `${Math.round(bands.energy * 100)}%` }} />
        </div>

        <div className={styles.playerDeck}>
          <div className={styles.playerTop}>
            <span className={styles.trackTitle} title={trackTitle}>{trackTitle}</span>
            <span className={styles.timeReadout}>
              <span data-testid="visualizer-current-time">{formatTime(position)}</span> / <span>{formatTime(duration)}</span>
            </span>
          </div>
          <div className={styles.playerControls}>
            <button
              className={`${styles.transportButton} ${playing ? styles.transportPlaying : ''}`}
              type="button"
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause audio' : 'Play audio'}
              data-testid="visualizer-play"
              onClick={() => void togglePlayPause()}
            >
              {playing
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <button
              className={styles.transportButton}
              type="button"
              title="Stop and reset"
              aria-label="Stop and reset audio"
              data-testid="visualizer-stop"
              onClick={stopPlayback}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z" /></svg>
            </button>
            <input
              className={styles.range}
              type="range"
              aria-label="Playback position"
              min="0"
              max="100"
              step="0.1"
              value={seekPercent}
              onChange={event => changeSeek(Number(event.currentTarget.value))}
              onPointerUp={handleSeekRelease}
              onKeyUp={handleSeekRelease}
              onBlur={handleSeekRelease}
            />
            <div className={styles.volumeWrap}>
              <label className={styles.volumeLabel} htmlFor="visualizer-volume">VOL</label>
              <input
                id="visualizer-volume"
                className={styles.range}
                type="range"
                aria-label="Volume"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={event => changeVolume(Number(event.currentTarget.value))}
              />
            </div>
          </div>
        </div>

        <div className={styles.buttonRow}>
          <button
            className={`${styles.actionButton} ${mode === 'master' ? styles.actionButtonActive : ''}`}
            type="button"
            data-testid="visualizer-master"
            aria-pressed={mode === 'master'}
            onClick={() => void switchToMaster()}
          >Rendered Master</button>
          <button
            className={`${styles.actionButton} ${mode === 'file' ? styles.actionButtonActive : ''}`}
            type="button"
            data-testid="visualizer-load-file"
            aria-pressed={mode === 'file'}
            onClick={() => fileInput.current?.click()}
          >Load Custom</button>
          <button
            className={`${styles.actionButton} ${mode === 'mic' ? styles.actionButtonActive : ''}`}
            type="button"
            data-testid="visualizer-mic"
            aria-pressed={mode === 'mic'}
            onClick={() => void startMicrophone()}
          >Live Mic</button>
        </div>
        <input
          ref={fileInput}
          className={styles.hiddenInput}
          type="file"
          accept="audio/*"
          aria-label="Choose an audio file"
          data-testid="visualizer-file-input"
          onChange={onFileChange}
        />
        <p className={styles.helpText}>
          {visual === 'webgl' ? 'Drag the orb to rotate · Audio stays in this browser'
            : visual === 'still' ? 'Reduced motion · Audio stays in this browser'
              : 'Audio stays in this browser · 2D visual fallback active'}
        </p>
      </section>
    </main>
  );
}
