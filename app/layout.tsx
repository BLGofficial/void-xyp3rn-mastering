import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';
import { BootHandoff } from '@/components/boot/BootHandoff';
import { BOOT_SCRIPT, BootSplash } from '@/components/boot/BootSplash';
import { RegisterServiceWorker } from '@/components/pwa/RegisterServiceWorker';
import './globals.css';

// Four typefaces, one role each (Brand Guidelines ch. 02).
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas', display: 'swap' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne', display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

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
