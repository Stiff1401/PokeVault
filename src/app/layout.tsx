import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import AppShell from '@/components/AppShell';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  title: 'PokéVault',
  description: 'Local-first vault for scanning, cataloging, trading, gifting and valuing your Pokémon TCG collection.',
  manifest: `${basePath}/manifest.json`,
  applicationName: 'PokéVault',
  appleWebApp: { capable: true, title: 'PokéVault', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: `${basePath}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${basePath}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
    apple: `${basePath}/icons/icon-192.png`,
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0c12',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" className="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
