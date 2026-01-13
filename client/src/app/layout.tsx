import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pipecat + Deepgram Voice Agent Demo',
  description: 'Real-time voice AI with Deepgram STT/TTS on AWS SageMaker',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

