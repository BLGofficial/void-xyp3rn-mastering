'use client';

import { useEffect } from 'react';

/**
 * Registers the offline service worker (written into the export by scripts/build-sw.mjs).
 * Production only: `next dev` has no sw.js, and a worker there would cache dev bundles.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is an enhancement: the studio works without it.
    });
  }, []);
  return null;
}
