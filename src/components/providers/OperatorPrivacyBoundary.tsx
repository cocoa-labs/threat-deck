'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { clearBrowserPrivateData } from '@/lib/security/browser-privacy';

const PrivacyContext = createContext<() => void>(() => {});
export function SignOutControl() {
  const exit = useContext(PrivacyContext);
  return (
    <button
      type="button"
      onClick={exit}
      className="px-2 text-[10px] text-[var(--text-secondary)]"
      title="Sign out and clear this device's saved Threat Deck data"
    >
      Sign out &amp; clear device
    </button>
  );
}

export function OperatorPrivacyBoundary({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const exiting = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const exit = useCallback(async () => {
    if (exiting.current) return;
    exiting.current = true;
    setReady(false);
    if (container.current) container.current.style.visibility = 'hidden';
    clearBrowserPrivateData();
    channel.current?.postMessage('signing-out');
    try {
      const csrf = await fetch('/api/auth/csrf', { cache: 'no-store' });
      if (!csrf.ok) throw new Error('signout_unavailable');
      const { csrfToken } = await csrf.json();
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
        },
        body: new URLSearchParams({ csrfToken, callbackUrl: '/login' }),
      });
      if (!response.ok) throw new Error('signout_unavailable');
      const session = await fetch('/api/auth/session', { cache: 'no-store' });
      if (!session.ok || (await session.json())?.user) throw new Error('signout_not_confirmed');
      clearBrowserPrivateData();
      channel.current?.postMessage('signed-out');
      window.location.replace('/login');
    } catch {
      setFailure(true);
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    // Legacy unscoped browser records are discarded before the dashboard mounts.
    clearBrowserPrivateData();
    const verify = async () => {
      try {
        const response = await fetch('/api/capabilities', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || (await response.json()).operator !== email) {
          if (!stopped) void exit();
          return;
        }
        if (!stopped && !exiting.current) {
          setReady(true);
          if (container.current) container.current.style.visibility = '';
        }
      } catch {
        if (!stopped) {
          setReady(false);
          setFailure(true);
        }
      }
    };
    const hide = () => {
      if (container.current) container.current.style.visibility = 'hidden';
    };
    const show = () => {
      void verify();
    };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('threatdeck-operator-privacy');
      channel.current.onmessage = (event) => {
        if (event.data === 'signing-out') {
          exiting.current = true;
          hide();
          setReady(false);
          clearBrowserPrivateData();
        }
        if (event.data === 'signed-out') {
          exiting.current = true;
          hide();
          clearBrowserPrivateData();
          window.location.replace('/login');
        }
      };
    }
    void verify();
    const timer = setInterval(show, 60_000);
    window.addEventListener('focus', show);
    window.addEventListener('pageshow', show);
    window.addEventListener('pagehide', hide);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', show);
      window.removeEventListener('pageshow', show);
      window.removeEventListener('pagehide', hide);
      channel.current?.close();
      channel.current = null;
    };
  }, [email, exit]);
  return (
    <PrivacyContext.Provider
      value={() => {
        void exit();
      }}
    >
      <div ref={container}>
        {ready ? (
          children
        ) : (
          <p role="status" className="p-4">
            {failure
              ? 'Session unavailable. Reload to sign in again.'
              : 'Checking operator session…'}
          </p>
        )}
      </div>
    </PrivacyContext.Provider>
  );
}
