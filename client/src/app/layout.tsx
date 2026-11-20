import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import { Work_Sans, Azeret_Mono } from 'next/font/google';
import './globals.css';

const workSans = Work_Sans({ subsets: ['latin', 'latin-ext'], display: 'swap' });
const azeretMono = Azeret_Mono({ subsets: ['latin', 'latin-ext'], display: 'swap' });

// The kit's theme.css reads these: --font-sans: var(--font-brand-sans, "Work Sans", ...)
const FONT_STACKS = {
  '--font-brand-sans': `${workSans.style.fontFamily}, ui-sans-serif, system-ui, sans-serif`,
  '--font-brand-mono': `${azeretMono.style.fontFamily}, ui-monospace, monospace`,
} as CSSProperties;

export const metadata: Metadata = {
  title: 'RxConnect - Voice Assistant',
  description: 'Real-time voice assistant for prescription management',
  icons: {
    icon: [
      { url: '/favicon/favicon-2026.svg', type: 'image/svg+xml' },
      { url: '/favicon/favicon-2026-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon/favicon-2026-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon/favicon-2026.ico' },
    ],
    apple: '/favicon/apple-touch-icon-2026.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1d1d1d',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={FONT_STACKS}>
      <body>{children}</body>
    </html>
  );
}
