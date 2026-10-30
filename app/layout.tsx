import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, DM_Sans, JetBrains_Mono, Syne } from 'next/font/google';
import './globals.css';

// Four typefaces, one role each (Brand Guidelines ch. 02).
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas', display: 'swap' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne', display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'XYP3RN MASTERING — Local Audio Mastering',
  description: 'Master WAV files in your browser. EQ, dynamics, true-peak limiting and loudness targeting. Local processing. No audio leaves the machine.',
};

export const viewport: Viewport = { themeColor: '#080808', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bebas.variable} ${syne.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="bg-studio font-body text-ash antialiased">{children}</body>
    </html>
  );
}
