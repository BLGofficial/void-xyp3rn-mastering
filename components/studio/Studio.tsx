'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngineClient, type EngineClient } from '@/audio/engine-client';
import { createPlayer, type Player } from '@/audio/player';
import type { LiveMeters, LoadResult, RenderResult } from '@/audio/protocol';
import { defaultState, type ChainState } from '@/lib/dsp';
import type { WavFormat } from '@/lib/engine';
import { ChainRack } from './ChainRack';
import { Header } from './Header';
import { OutputPanel } from './OutputPanel';
import { SourcePanel } from './SourcePanel';
import { Transport } from './Transport';
import { Panel } from './ui';
import { Waveform } from './Waveform';

type Loaded = LoadResult & { fileName: string; fileSize: number };

/** State actually rendered: musical chain + output ceiling + optional loudness target. */
function renderState(chain: ChainState, target: string, ceiling: number): ChainState {
  const { loudnessTarget: _drop, ...rest } = chain;
  return target === 'off'
    ? { ...rest, outputCeilingDbtp: ceiling }
    : { ...rest, outputCeilingDbtp: ceiling, loudnessTarget: { targetLufs: Number(target), correctionDb: 0 } };
}

function download(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Studio() {
  const engine = useRef<EngineClient | null>(null);
  const player = useRef<Player | null>(null);
  const [status, setStatus] = useState('Engine: local');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [source, setSource] = useState<Loaded | null>(null);
  const [chain, setChain] = useState<ChainState>(() => defaultState());
  const [target, setTarget] = useState('off');
  const [ceiling, setCeiling] = useState(-1);
  const [format, setFormat] = useState<WavFormat>('pcm24');
  const [dither, setDither] = useState(true);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [listenSource, setListenSource] = useState(false);
  const [match, setMatch] = useState(true);
  const [meters, setMeters] = useState<LiveMeters | null>(null);

  useEffect(() => {
    engine.current = createEngineClient();
    return () => {
      engine.current?.dispose();
      player.current?.dispose();
    };
  }, []);

  // Playhead: poll the audio clock only while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { setPosition(player.current?.position() ?? 0); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Any settings change makes the last render stale: export must match what was measured.
  useEffect(() => {
    player.current?.setState(chain);
    setResult(null);
  }, [chain]);
  useEffect(() => setResult(null), [target, ceiling]);

  const fail = (e: unknown) => {
    setError((e as Error).message);
    setStatus('Engine: error');
  };

  const onFile = useCallback(async (file: File) => {
    if (!engine.current) return;
    setBusy(true); setError(null); setResult(null); setMeters(null);
    player.current?.dispose(); player.current = null; setPlaying(false); setPosition(0);
    try {
      const loaded = await engine.current.load(file, { onStatus: setStatus, onProgress: setProgress });
      setSource({ ...loaded, fileName: file.name, fileSize: file.size });
      player.current = await createPlayer(loaded.channels, loaded.sampleRate, chain, {
        meters: setMeters,
        error: message => setError(`Preview: ${message}`),
        ended: () => { setPlaying(false); setPosition(0); },
      });
      player.current.setMatch(match);
      player.current.setSource(listenSource);
      setStatus('Engine: ready');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false); setProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- player picks up chain/AB changes via their own effects
  }, []);

  const togglePlay = async () => {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); setPosition(p.position()); }
    else { await p.play(); setPlaying(true); }
  };

  const render = async () => {
    if (!engine.current) return;
    setBusy(true); setError(null);
    try {
      setResult(await engine.current.render(renderState(chain, target, ceiling), { onStatus: setStatus, onProgress: setProgress }));
      setStatus('Engine: rendered');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const exportWav = async () => {
    if (!engine.current || !source) return;
    setBusy(true); setError(null);
    try {
      const { bytes } = await engine.current.exportWav(format, dither, { onStatus: setStatus });
      const base = source.fileName.replace(/\.[^.]+$/, '');
      const tag = target === 'off' ? 'master' : `${target}LUFS`;
      download(bytes, `${base}_XYP3RN_${tag}_${format}.wav`);
      setStatus('Engine: exported');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const duration = source ? source.metadata.length / source.sampleRate : 0;
  return (
    <div className="min-h-screen">
      <Header status={status} />
      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 pb-10 pt-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {!source && (
            <p className="max-w-2xl text-sm text-ash">
              EQ, dynamics, width, clip and true-peak limiting, measured to BS.1770. Local processing. No audio leaves the machine.
            </p>
          )}
          {error && (
            <div role="alert" className="border border-gold-dim bg-gold-glow px-4 py-3 text-sm text-cloud">{error}</div>
          )}
          <SourcePanel fileName={source?.fileName} fileSize={source?.fileSize} metadata={source?.metadata} metrics={source?.metrics} busy={busy} onFile={onFile} />
          {source && (
            <Panel title="Monitor">
              <div className="space-y-4">
                <Waveform
                  source={source.metrics.waveform} master={result?.metrics.waveform} position={position} duration={duration}
                  onSeek={s => { player.current?.seek(s); setPosition(player.current?.position() ?? s); }}
                />
                <Transport
                  playing={playing} position={position} duration={duration} onPlay={togglePlay} disabled={!player.current}
                  source={listenSource} onSource={() => { const v = !listenSource; setListenSource(v); player.current?.setSource(v); }}
                  match={match} onMatch={() => { const v = !match; setMatch(v); player.current?.setMatch(v); }}
                  meters={meters}
                />
              </div>
            </Panel>
          )}
          <Panel title="Chain" aside={<span className="font-mono text-[11px] text-muted">In signal order</span>}>
            <ChainRack state={chain} onChange={setChain} />
          </Panel>
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <OutputPanel
            target={target} onTarget={setTarget} ceiling={ceiling} onCeiling={setCeiling} format={format} onFormat={setFormat}
            dither={dither} onDither={setDither} canRender={!!source} busy={busy} progress={progress} onRender={render} result={result} onExport={exportWav}
          />
          <p className="mt-3 font-mono text-[10px] uppercase tracking-label text-muted">Suggests — never decides. You keep the final call.</p>
        </aside>
      </main>
      <footer className="border-t border-line bg-chrome px-4 py-2 font-mono text-[10px] uppercase tracking-label text-muted md:px-8">
        XYP3RN Tech · Local processing · No audio leaves the machine
      </footer>
    </div>
  );
}
