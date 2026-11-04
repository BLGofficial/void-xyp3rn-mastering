'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngineClient, type EngineClient } from '@/audio/engine-client';
import { buildReportPdf, bundleReport, prepareAudio, type ExportFormat, type PreparedAudio } from '@/audio/export-flow';
import { createPlayer, type Player } from '@/audio/player';
import type { AutoResult, LiveMeters, LoadResult, RenderResult } from '@/audio/protocol';
import type { Intention, Style } from '@/lib/auto';
import { defaultState, type ChainState } from '@/lib/dsp';
import type { BlockTelemetry, EnginePhase } from '@/lib/engine';
import { AutoPanel } from './AutoPanel';
import { ChainRack } from './ChainRack';
import { ControlGuide } from './ControlGuide';
import { Header } from './Header';
import { HintsProvider } from './hints';
import { MobileActions } from './MobileActions';
import { OutputPanel, type RenderedFile } from './OutputPanel';
import { SourcePanel } from './SourcePanel';
import { Transport } from './Transport';
import { RenderOverlay } from './RenderOverlay';
import { Panel } from './ui';
import { Waveform } from './Waveform';

/** localStorage key for the inline-hints preference. */
const HINTS_KEY = 'xyp3rn.hints';

type Loaded = LoadResult & { fileName: string; fileSize: number };
/** A render is only current while the settings it was made from are unchanged. */
type Stored = RenderResult & { key: string; notes?: string[] };
type StoredFile = RenderedFile & { key: string; prepared: PreparedAudio };

/** State actually rendered: musical chain + output ceiling + optional loudness target. */
function renderState(chain: ChainState, target: string, ceiling: number): ChainState {
  const { loudnessTarget: _drop, ...rest } = chain;
  return target === 'off'
    ? { ...rest, outputCeilingDbtp: ceiling }
    : { ...rest, outputCeilingDbtp: ceiling, loudnessTarget: { targetLufs: Number(target), correctionDb: 0 } };
}

const settingsKey = (chain: ChainState, target: string, ceiling: number) => JSON.stringify(renderState(chain, target, ceiling));
const artifactKey = (chain: ChainState, target: string, ceiling: number, format: ExportFormat, dither: boolean) =>
  `${settingsKey(chain, target, ceiling)}|${format}|${dither}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
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
  const studio = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState('Engine: local');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [source, setSource] = useState<Loaded | null>(null);
  const [chain, setChain] = useState<ChainState>(() => defaultState());
  const [target, setTarget] = useState('off');
  const [ceiling, setCeiling] = useState(-1);
  const [format, setFormat] = useState<ExportFormat>('pcm24');
  const [dither, setDither] = useState(true);
  const [stored, setStored] = useState<Stored | null>(null);
  const [renderedFile, setRenderedFile] = useState<StoredFile | null>(null);
  const [intention, setIntention] = useState<Intention>('balanced');
  const [autoIntensity, setAutoIntensity] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [listenSource, setListenSource] = useState(false);
  const [match, setMatch] = useState(true);
  const [meters, setMeters] = useState<LiveMeters | null>(null);
  const [introReady, setIntroReady] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  // Live render telemetry for the overlay orb, and how the last rendering operation ended.
  const [block, setBlock] = useState<BlockTelemetry | null>(null);
  const [phase, setPhase] = useState<EnginePhase | null>(null);
  const [completed, setCompleted] = useState(false);
  // File import in progress: which file and the engine stage it is in.
  const [loading, setLoading] = useState<{ fileName: string; phase: EnginePhase | null } | null>(null);
  const [autoUndo, setAutoUndo] = useState<{ chain: ChainState; ceiling: number } | null>(null);
  const [hints, setHints] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Hints are a per-viewer preference. Read after mount (the static export has no
  // storage); storage can be blocked, in which case hints simply start off.
  useEffect(() => {
    try { setHints(localStorage.getItem(HINTS_KEY) === '1'); } catch { /* blocked storage */ }
  }, []);
  const toggleHints = () => {
    const next = !hints;
    setHints(next);
    try { localStorage.setItem(HINTS_KEY, next ? '1' : '0'); } catch { /* blocked storage */ }
  };

  useEffect(() => {
    engine.current = createEngineClient();
    return () => {
      engine.current?.dispose();
      player.current?.dispose();
    };
  }, []);

  useEffect(() => () => {
    if (renderedFile) URL.revokeObjectURL(renderedFile.url);
  }, [renderedFile]);

  useEffect(() => {
    const node = studio.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setIntroReady(true);
      observer.disconnect();
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Playhead: poll the audio clock only while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { setPosition(player.current?.position() ?? 0); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    player.current?.setState(chain);
  }, [chain]);

  // Derived, not reset by effects: export must always match what was measured.
  const result = stored && stored.key === settingsKey(chain, target, ceiling) ? stored : null;
  const currentRenderedFile = renderedFile?.key === artifactKey(chain, target, ceiling, format, dither) ? renderedFile : null;

  const fail = (e: unknown) => {
    setError((e as Error).message);
    setStatus('Engine: error');
  };

  const onFile = useCallback(async (file: File) => {
    if (!engine.current) return;
    setBusy(true); setError(null); setStored(null); setRenderedFile(null); setMeters(null); setAutoUndo(null);
    player.current?.dispose(); player.current = null; setPlaying(false); setPosition(0);
    setLoading({ fileName: file.name, phase: null });
    try {
      const loaded = await engine.current.load(file, {
        onStatus: setStatus, onProgress: setProgress, onPhase: phase => setLoading(l => l && { ...l, phase }),
      });
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
      setBusy(false); setProgress(null); setLoading(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- player picks up chain/AB changes via their own effects
  }, []);

  const togglePlay = async () => {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setPlaying(false); setPosition(p.position()); }
    else { await p.play(); setPlaying(true); }
  };

  /**
   * One engine operation at a time. Cancelling aborts it at the engine's next
   * checkpoint and leaves whatever result and file were current before.
   */
  const operation = async (rendersAudio: boolean, body: (signal: AbortSignal) => Promise<void>) => {
    // One at a time: an overlapping operation would clear `busy` under the first and race its result.
    if (!engine.current || !source || abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setCancellable(true); setRendering(rendersAudio); setError(null); setCompleted(false);
    try {
      await body(controller.signal);
      setCompleted(true);
    } catch (e) {
      if (controller.signal.aborted || (e as { code?: string }).code === 'CANCELLED') setStatus('Engine: cancelled');
      else fail(e);
    } finally {
      abort.current = null;
      setBusy(false); setCancellable(false); setRendering(false); setProgress(null); setBlock(null); setPhase(null);
    }
  };

  const cancel = () => {
    abort.current?.abort();
    engine.current?.cancel();
  };

  const render = () => operation(true, async signal => {
    // A manual render commits to the current chain; Undo no longer applies.
    setAutoUndo(null);
    const r = await engine.current!.render(renderState(chain, target, ceiling), { onStatus: setStatus, onProgress: setProgress, onBlock: setBlock, onPhase: setPhase });
    setStored({ ...r, key: settingsKey(chain, target, ceiling) });
    await prepareRenderedFile(chain, ceiling, signal);
    setStatus('Engine: rendered file ready');
  });

  const prepareRenderedFile = async (nextChain: ChainState, nextCeiling: number, signal: AbortSignal) => {
    if (!engine.current || !source) return;
    const prepared = await prepareAudio(engine.current, {
      format, dither, sourceFileName: source.fileName, ceilingDbtp: nextCeiling, targetLufs: target === 'off' ? null : Number(target), signal,
    }, { onStatus: setStatus, onProgress: setProgress });
    setRenderedFile({
      key: artifactKey(nextChain, target, nextCeiling, format, dither),
      name: prepared.filename,
      url: URL.createObjectURL(prepared.blob),
      size: prepared.blob.size,
      prepared,
    });
  };

  /** Re-encode the current render for a changed format/dither, without re-rendering. */
  const prepareCurrent = () => operation(false, async signal => {
    if (!result) return;
    await prepareRenderedFile(chain, ceiling, signal);
    setStatus('Engine: rendered file ready');
  });

  const reportRequest = (signal: AbortSignal) => ({
    dither, targetLufs: target === 'off' ? null : Number(target), signal,
    source: { fileName: source!.fileName, metrics: source!.metrics, sampleRate: source!.sampleRate, channels: source!.metadata.channels, duration: source!.metadata.length / source!.sampleRate },
    render: { state: result!.state, safety: result!.safety, targetResult: result!.targetResult },
  });

  const downloadReport = () => operation(false, async signal => {
    if (!result || !currentRenderedFile) return;
    const file = await bundleReport(engine.current!, currentRenderedFile.prepared, reportRequest(signal), { onStatus: setStatus });
    download(file.blob, file.filename);
    setStatus('Engine: report bundled');
  });

  /** The audio link downloads natively; its PDF report follows as a second file. */
  const downloadEffectsPdf = () => operation(false, async signal => {
    if (!result || !currentRenderedFile) return;
    const file = await buildReportPdf(engine.current!, currentRenderedFile.prepared, reportRequest(signal), { onStatus: setStatus });
    download(file.blob, file.filename);
    setStatus('Engine: exported with PDF report');
  });

  const acceptAutomaticResult = async (r: AutoResult, readyStatus: string, signal: AbortSignal) => {
    const { loudnessTarget: _t, ...musical } = r.state;
    const nextChain: ChainState = { ...musical, outputCeilingDbtp: null };
    const nextCeiling = r.state.outputCeilingDbtp ?? ceiling;
    // What Undo puts back: the user's own chain and ceiling from before this proposal.
    setAutoUndo({ chain, ceiling });
    setChain(nextChain);
    setCeiling(nextCeiling);
    setStored({ ...r, key: settingsKey(nextChain, target, nextCeiling) });
    await prepareRenderedFile(nextChain, nextCeiling, signal);
    setStatus(readyStatus);
  };

  const runAuto = () => operation(true, async signal => {
    const r = await engine.current!.auto(intention, autoIntensity, target === 'off' ? null : Number(target), renderState(chain, target, ceiling), { onStatus: setStatus, onProgress: setProgress, onBlock: setBlock, onPhase: setPhase });
    await acceptAutomaticResult(r, 'Engine: auto master ready', signal);
  });

  const runPreset = (style: Style) => operation(true, async signal => {
    const r = await engine.current!.preset(style, 50, target === 'off' ? null : Number(target), renderState(chain, target, ceiling), { onStatus: setStatus, onProgress: setProgress, onBlock: setBlock, onPhase: setPhase });
    await acceptAutomaticResult(r, `Engine: ${style} preset ready`, signal);
  });

  /**
   * Restore the chain the last Auto/preset replaced. Its render stays in the
   * engine but no longer matches the chain, so it is hidden until re-rendered.
   */
  const undoAuto = () => {
    if (!autoUndo) return;
    setChain(autoUndo.chain);
    setCeiling(autoUndo.ceiling);
    setAutoUndo(null);
    setStatus('Engine: auto undone. Render to hear the restored chain');
  };

  const duration = source ? source.metadata.length / source.sampleRate : 0;
  return (
    <HintsProvider value={hints}>
      {/* Phones: room at the bottom for the fixed action bar (and the home indicator). */}
      <div className="min-h-screen pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <Header status={status} hints={hints} onHints={toggleHints} onGuide={() => setGuideOpen(true)} />
        <ControlGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
        <RenderOverlay
          open={rendering} completed={completed} status={status} progress={progress} block={block} phase={phase} onCancel={cancel}
          sourceLufs={source?.metrics.loudness.integratedLufs ?? null} targetLufs={target === 'off' ? null : Number(target)}
        />
        <main ref={studio} className={`mx-auto grid max-w-[1440px] gap-4 px-4 pb-10 pt-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px] ${introReady ? 'xr-studio-intro' : ''}`}>
          {/* Phones show one column in work order (source, monitor, auto, output, chain); the two
              desktop columns dissolve into the grid there and their panels take an explicit order. */}
          <div className="contents lg:block lg:min-w-0 lg:space-y-4">
            {!source && (
              <p className="max-w-2xl text-sm text-ash">
                EQ, dynamics, width, clip and true-peak limiting, measured to BS.1770. Local processing. No audio leaves the machine.
              </p>
            )}
            {error && (
              <div role="alert" data-testid="engine-error" className="border border-gold-dim bg-gold-glow px-4 py-3 text-sm text-cloud">{error}</div>
            )}
            <div className="order-1 min-w-0 lg:order-none"><SourcePanel fileName={source?.fileName} fileSize={source?.fileSize} metadata={source?.metadata} metrics={source?.metrics} busy={busy} onFile={onFile} loading={loading} progress={progress} /></div>
            {source && (
              <Panel title="Monitor" className="order-2 min-w-0 lg:order-none">
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
            <Panel title="Chain" className="order-5 min-w-0 lg:order-none" aside={<span className="font-mono text-xs text-muted">In signal order</span>}>
              <ChainRack state={chain} onChange={setChain} />
            </Panel>
          </div>
          <aside className="contents lg:sticky lg:top-4 lg:block lg:space-y-4 lg:self-start">
            <div className="order-3 min-w-0 lg:order-none"><AutoPanel
              intention={intention} onIntention={setIntention} intensity={autoIntensity} onIntensity={setAutoIntensity}
              canRun={!!source} busy={busy} onRun={runAuto} onPreset={runPreset} canUndo={!!autoUndo} onUndo={undoAuto} notes={result?.notes ?? null}
            /></div>
            <div className="order-4 min-w-0 lg:order-none"><OutputPanel
              target={target} onTarget={setTarget} ceiling={ceiling} onCeiling={setCeiling} format={format} onFormat={setFormat}
              dither={dither} onDither={setDither} canRender={!!source} busy={busy} rendering={rendering} progress={progress}
              onRender={render} result={result} renderedFile={currentRenderedFile}
              onPrepare={prepareCurrent} onReport={downloadReport} onAudioDownload={downloadEffectsPdf} cancellable={cancellable} onCancel={cancel}
            /></div>
            <p className="order-6 font-mono lg:order-none text-xs uppercase tracking-label text-muted">Suggests — never decides. You keep the final call.</p>
          </aside>
        </main>
        <footer className="xr-glass border-t border-line px-4 py-2 font-mono text-xs uppercase tracking-label text-muted md:px-8">
          XYP3RN Tech · Local processing · No audio leaves the machine · MP3 encoding by{' '}
          <a className="inline-flex min-h-11 min-w-11 items-center justify-center text-ash underline-offset-2 hover:underline lg:min-h-0 lg:min-w-0" href="https://lame.sourceforge.io" target="_blank" rel="noreferrer">LAME</a> (LGPL)
        </footer>
        <MobileActions
          playing={playing} canPlay={!!player.current} onPlay={togglePlay}
          canRender={!!source} busy={busy} onRender={render}
        />
      </div>
    </HintsProvider>
  );
}
