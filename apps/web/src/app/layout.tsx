import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Live Proctoring - WebRTC + mediasoup',
  description: 'Production-grade live exam proctoring system built with WebRTC and mediasoup SFU',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body className={`${inter.className} dark bg-gray-950 text-white min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
