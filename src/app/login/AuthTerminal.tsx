'use client';

import { signIn as signInClient } from 'next-auth/react';
import { type FormEvent, useState } from 'react';
import { CocoaSigil } from '@/components/brand/CocoaSigil';
import styles from './login.module.css';

type AuthState = 'idle' | 'dispatching' | 'accepting' | 'sent' | 'rejected';

const SUBMIT_COPY: Record<AuthState, string> = {
  idle: 'REQUEST ACCESS',
  dispatching: 'DISPATCHING MAGIC LINK…',
  accepting: 'REQUEST ACCESS',
  sent: 'CHECK YOUR INBOX',
  rejected: 'ACCESS DENIED — RETRY',
};

/**
 * AuthTerminal — masthead + VT323 heading + magic-link request form.
 *
 * Backend is stubbed (Phase 7 wires real NextAuth). For now POSTs to
 * /api/auth/magic-link which just returns 200 — UX-functional so the
 * full state machine demos.
 */
export function AuthTerminal({
  lastBriefMinutes,
  criticalCveCount,
  devBypassEmail,
}: {
  /** Minutes since last AEGIS brief was generated. */
  lastBriefMinutes: number;
  /** Active critical CVE count (KEV or exploited-in-wild). */
  criticalCveCount: number;
  /** Dev-only local bypass identity. Null/undefined means no shortcut. */
  devBypassEmail?: string | null;
}) {
  const [email, setEmail] = useState(devBypassEmail ?? '');
  const [state, setState] = useState<AuthState>('idle');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || state === 'dispatching' || state === 'sent') return;

    setState('dispatching');

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        // Brief settle so the morph isn't jarring
        setTimeout(() => setState('sent'), 450);
      } else {
        setState('rejected');
      }
    } catch {
      setState('rejected');
    }
  }

  async function onLocalAccept() {
    if (!devBypassEmail || state === 'dispatching' || state === 'accepting') return;

    setState('accepting');

    try {
      const result = await signInClient('local-dev', {
        email: devBypassEmail,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.ok) {
        window.location.assign(result.url ?? '/');
      } else {
        setState('rejected');
      }
    } catch {
      setState('rejected');
    }
  }

  const isBusy = state === 'dispatching' || state === 'accepting';
  const isSent = state === 'sent';
  const hasDevBypass = Boolean(devBypassEmail);

  return (
    <div className={styles.terminal}>
      <div className={styles.masthead}>
        <span className={styles.sigilHolder}>
          <CocoaSigil size={20} />
        </span>
        <span className={styles.wordmark}>Cocoa AI</span>
        <span className={styles.systemTag}>{'// Threat Deck'}</span>
      </div>

      <h1 className={styles.heading} aria-label="Authorization required">
        AUTHORIZATION&nbsp;REQUIRED
      </h1>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <div className={styles.fieldRow}>
          <label className={styles.label} htmlFor="login-email">
            Operator&nbsp;identity
          </label>
          <div className={styles.inputWrap}>
            <input
              id="login-email"
              type="email"
              className={styles.input}
              placeholder="operator@example.org"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === 'rejected') setState('idle');
              }}
              autoComplete="email"
              autoCapitalize="off"
              spellCheck={false}
              required
              disabled={isSent}
              aria-describedby="login-status"
            />
          </div>
        </div>

        <div className={styles.submitRow}>
          <button
            type="submit"
            className={`${styles.submit} ${isSent ? styles.submitSent : ''}`}
            disabled={isBusy || isSent || email.length === 0}
            aria-busy={isBusy}
          >
            {state === 'dispatching' ? (
              <span className={styles.submitDot} aria-hidden="true" />
            ) : null}
            {SUBMIT_COPY[state]}
          </button>
          {hasDevBypass ? (
            <button
              type="button"
              className={styles.devAccept}
              onClick={onLocalAccept}
              disabled={isBusy || isSent}
              aria-busy={state === 'accepting'}
            >
              {state === 'accepting' ? (
                <span className={styles.submitDot} aria-hidden="true" />
              ) : null}
              {state === 'accepting' ? 'ACCEPTING LOCAL SESSION…' : 'ACCEPT LOCAL SESSION'}
            </button>
          ) : null}
        </div>
      </form>

      <div className={styles.statusLine} id="login-status" role="status">
        <span className={styles.statusDot} aria-hidden="true" />
        AEGIS network active
        <span className={styles.statusSep}>{'//'}</span>
        Last brief {lastBriefMinutes}m ago
        <span className={styles.statusSep}>{'//'}</span>
        {criticalCveCount} critical CVE{criticalCveCount === 1 ? '' : 's'} tracked
      </div>
    </div>
  );
}
