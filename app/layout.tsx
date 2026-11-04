import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { BootHandoff } from '@/components/boot/BootHandoff';
import { BOOT_SCRIPT, BootSplash } from '@/components/boot/BootSplash';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';
import './globals.css';

// Four typefaces, one role each (Brand Guidelines ch. 02). Fonts are self-hosted so
// builds and the static PWA never need a Google Fonts request at runtime or build time.
const bebas = localFont({
  src: '../node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2',
  weight: '400', style: 'normal', variable: '--font-bebas', display: 'swap',
});
const syne = localFont({
  src: '../node_modules/@fontsource-variable/syne/files/syne-latin-wght-normal.woff2',
  weight: '400 800', style: 'normal', variable: '--font-syne', display: 'swap',
});
const dmSans = localFont({
  src: '../node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
  weight: '100 1000', style: 'normal', variable: '--font-dm-sans', display: 'swap',
});
const jetbrains = localFont({
  src: '../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800', style: 'normal', variable: '--font-jetbrains', display: 'swap',
});

export const metadata: Metadata = {
  title: 'XYP3RN MASTERING — Local Audio Mastering',
  description: 'Master WAV, FLAC and MP3 files in your browser. EQ, dynamics, true-peak limiting and loudness targeting. Local processing. No audio leaves the machine.',
  applicationName: 'XYP3RN MASTERING',
  // Home-screen app on iOS: full screen, black status bar over the studio's own chrome.
  appleWebApp: { capable: true, title: 'XYP3RN', statusBarStyle: 'black-translucent' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

// viewport-fit=cover lets the layout use the safe areas (notch, home indicator) via env().
export const viewport: Viewport = { themeColor: '#080808', colorScheme: 'dark', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script tags <html> before hydration (repeat visit); React must not flag that.
    <html lang="en" suppressHydrationWarning className={`${bebas.variable} ${syne.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="bg-studio font-body text-ash antialiased">
        <BootSplash />
        {children}
        <BootHandoff />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
