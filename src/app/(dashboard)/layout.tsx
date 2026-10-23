import { redirect } from 'next/navigation';
import { ConfigurationNotice } from '@/components/ConfigurationNotice';
import { auth, isEmailAllowed } from '@/lib/auth';
import DashboardShell from './DashboardShell';

/**
 * Dashboard route-group layout — server-side session gate.
 *
 * Reads the Auth.js session (JWT cookie) on the server BEFORE any client JS
 * runs. Unauthenticated requests are redirected to /login, where the magic-link
 * terminal handles re-authentication.
 *
 * Public routes that should remain accessible without a session live OUTSIDE
 * this route group:
 *   - /login                  (src/app/login)
 *   - /feed/cyber-wire        (src/app/feed/cyber-wire)
 *   - /feed/cyber-wire.rss    (src/app/feed/cyber-wire.rss)
 *
 * The actual shell (panel grid, hero visualization, agent drawer, etc.) is a
 * client component in `./DashboardShell.tsx`. Splitting it like this keeps the
 * `await auth()` call in a Server Component while preserving every Zustand
 * store and React hook that the existing dashboard relies on.
 *
 * No sign-out button is rendered yet — for v1 single-tenant, the redirect IS
 * the gate. Sign-out UI lands in Phase 7.2.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.email || !isEmailAllowed(session.user.email)) {
    redirect('/login');
  }

  return (
    <>
      <ConfigurationNotice />
      <DashboardShell>{children}</DashboardShell>
    </>
  );
}
