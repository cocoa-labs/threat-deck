import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Cocoa AI Threat Deck — Access Terminal',
  description:
    'Authorization required. Cocoa AI Threat Deck is a single-tenant cybersecurity intelligence command center.',
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
