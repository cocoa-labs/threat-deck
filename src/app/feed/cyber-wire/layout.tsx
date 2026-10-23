import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cocoa AI Cyber Wire — Daily Cybersecurity Brief',
  description:
    'Daily cyber intelligence brief from Cocoa AI Threat Deck. AEGIS-triaged CVEs, KEV alerts, breach disclosures, and threat actor activity, summarized for situation-aware technologists.',
  // Public surface — let search engines + LLMs index it
  robots: { index: true, follow: true },
  openGraph: {
    type: 'article',
    siteName: 'Cocoa AI Cyber Wire',
    title: 'Cocoa AI Cyber Wire — Daily Cybersecurity Brief',
    description:
      'AEGIS-triaged cyber intelligence brief. CVEs, KEV alerts, breach disclosures, threat actor activity.',
    images: [
      {
        url: '/apple-icon.png',
        width: 180,
        height: 180,
        alt: 'Cocoa AI Cyber Wire — daily cybersecurity intelligence brief',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Cocoa AI Cyber Wire',
    description: 'Daily AEGIS-triaged cyber intelligence brief.',
    images: ['/apple-icon.png'],
  },
};

export default function CyberWireLayout({ children }: { children: React.ReactNode }) {
  // No dashboard chrome — Cyber Wire is a standalone editorial page.
  // Fonts (VT323, Instrument Serif, Geist Mono) come from the root layout.
  return <>{children}</>;
}
