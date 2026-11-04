'use client';

import { useEffect, useRef } from 'react';
import type { TrackMetrics } from '@/lib/engine';
import { Hint, useHint } from './hints';

type Wave = TrackMetrics['waveform'];

/** Min/max overview (source in Ash, master in Gold) with playhead; click or arrow keys to seek. */
export function Waveform({ source, master, position, duration, onSeek }: {
  source: Wave; master?: Wave; position: number; duration: number; onSeek: (seconds: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hSeek = useHint('seek');

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, w = el.clientWidth, h = el.clientHeight;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      const g = el.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0A0A0A'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1A1A1A'; g.fillRect(0, h / 2, w, 1);
      const plot = (wave: Wave, colour: string) => {
        // Mix channels down to one envelope for the overview.
        const bins = wave[0]!.min.length;
        g.fillStyle = colour;
        for (let x = 0; x < w; x++) {
          const b = Math.min(bins - 1, Math.floor((x / w) * bins));
          let lo = 0, hi = 0;
          for (const ch of wave) { lo = Math.min(lo, ch.min[b]!); hi = Math.max(hi, ch.max[b]!); }
          const y0 = h / 2 - Math.min(1, hi) * (h / 2 - 2), y1 = h / 2 - Math.max(-1, lo) * (h / 2 - 2);
          g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      };
      plot(source, '#444444');
      if (master) { g.globalAlpha = 0.85; plot(master, '#FACD68'); g.globalAlpha = 1; }
      const px = duration ? (position / duration) * w : 0;
      g.fillStyle = '#E8E8E8'; g.fillRect(Math.round(px), 0, 1, h);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [source, master, position, duration]);

  const seekFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };

  return (
    <div>
      <canvas
        ref={canvas} role="slider" tabIndex={0} aria-label="Playback position" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} aria-describedby={hSeek.id}
        className="block h-28 w-full cursor-pointer border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        onPointerDown={seekFromPointer}
        onKeyDown={e => {
          if (e.key === 'ArrowRight') onSeek(position + 5);
          else if (e.key === 'ArrowLeft') onSeek(position - 5);
          else if (e.key === 'Home') onSeek(0);
        }}
      />
      <Hint hint={hSeek} />
    </div>
  );
}
