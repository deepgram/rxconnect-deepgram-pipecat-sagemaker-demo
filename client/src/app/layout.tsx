import type { Metadata, Viewport } from 'next';
import { Work_Sans, Azeret_Mono } from 'next/font/google';
import '../deepgram-brand.css';
import './globals.css';

const workSans = Work_Sans({ subsets: ['latin'], variable: '--font-work-sans', display: 'swap' });
const azeretMono = Azeret_Mono({ subsets: ['latin'], variable: '--font-azeret-mono', display: 'swap' });

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
  themeColor: '#0a0a0a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`is-dark ${workSans.variable} ${azeretMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
