import { notFound } from 'next/navigation';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
export const dynamic = 'force-dynamic';
export default function FeedLayout({ children }: { children: React.ReactNode }) {
  if (!isCapabilityEnabled('publicFeed')) notFound();
  return children;
}
