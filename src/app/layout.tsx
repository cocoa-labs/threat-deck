import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from 'next-themes';
import { AccentThemeProvider } from '@/components/layout/AccentThemeProvider';
import './globals.css';

const geistMono = localFont({
  src: '../../public/fonts/GeistMono-Regular.ttf',
  variable: '--font-geist-mono',
  display: 'swap',
});
const vt323 = localFont({
  src: '../../public/fonts/VT323-Regular.ttf',
  variable: '--font-vt323',
  display: 'swap',
});
const instrumentSerif = localFont({
  src: '../../public/fonts/InstrumentSerif-Italic.ttf',
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  // metadataBase lets Next.js resolve relative image URLs (e.g. /og/cyber-wire.png)
  // into absolute URLs for the OpenGraph/Twitter Card crawlers. Override via env
  // for production (will be set in Phase 7 deploy).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002'),
  title: 'Cocoa AI Threat Deck | Cybersecurity Command Center',
  description:
    'Real-time cybersecurity intelligence command center. CVE pipeline, KEV alerts, threat-actor scoring, breach disclosure tracking, and a three-mode AI agent (news anchor → senior analyst → fix architect).',
  // Icons auto-discovered from src/app/icon.png + src/app/apple-icon.png.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistMono.variable} ${vt323.variable} ${instrumentSerif.variable} antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <AccentThemeProvider>{children}</AccentThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
