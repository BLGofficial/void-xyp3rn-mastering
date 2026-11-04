'use client';

import { useEffect } from 'react';

/** Never shorter than this, so the splash reads as an intro rather than a flicker. */
const MIN_MS = { first: 600, repeat: 300 };
/** Fonts that never settle must not hold the splash (the CSS cap lifts it anyway). */
const FONT_WAIT_MS = 800;

/**
 * Lifts the boot splash once the studio is interactive: this effect runs after the whole
 * page has hydrated, and waits for the brand fonts so nothing swaps under the reveal.
 */
export function BootHandoff() {
  useEffect(() => {
    const root = document.documentElement;
    const min = root.dataset.bootRepeat === '1' ? MIN_MS.repeat : MIN_MS.first;
    let timer = 0, live = true;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    Promise.race([fonts, new Promise(done => setTimeout(done, FONT_WAIT_MS))]).then(() => {
      if (!live) return;
      timer = window.setTimeout(() => { root.dataset.boot = 'ready'; }, Math.max(0, min - performance.now()));
    });
    try { localStorage.setItem('xyp3rn.booted', '1'); } catch { /* blocked storage: full splash next time */ }
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return null;
}
