import type { MetadataRoute } from 'next';

// Installable web app. Static: the export writes /manifest.webmanifest at build time.
export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'XYP3RN MASTERING',
    short_name: 'XYP3RN',
    description: 'Master WAV, FLAC and MP3 in your browser. Local processing: no audio leaves the device, and it works offline.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#080808',
    theme_color: '#080808',
    categories: ['music', 'productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
