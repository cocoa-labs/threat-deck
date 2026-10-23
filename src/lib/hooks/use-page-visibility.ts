'use client';

import { type RefObject, useEffect, useRef } from 'react';

/**
 * Returns a ref that tracks whether the current tab is hidden (background
 * tab) OR the window has lost focus. Used by long-running animation loops
 * (auto-rotation, etc.) to pause work while the user isn't looking.
 *
 * The value updates synchronously on the underlying DOM events so callers
 * reading `pageHiddenRef.current` from inside a requestAnimationFrame loop
 * see the latest state without re-rendering.
 *
 * SSR-safe — refs are initialized to `false` on the server and the listeners
 * are attached in `useEffect` (client-only).
 */
export function usePageHiddenRef(): RefObject<boolean> {
  const hiddenRef = useRef(false);

  useEffect(() => {
    const compute = (): boolean => document.visibilityState !== 'visible' || !document.hasFocus();

    hiddenRef.current = compute();

    const handler = () => {
      hiddenRef.current = compute();
    };

    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', handler);
    window.addEventListener('blur', handler);

    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', handler);
      window.removeEventListener('blur', handler);
    };
  }, []);

  return hiddenRef;
}
