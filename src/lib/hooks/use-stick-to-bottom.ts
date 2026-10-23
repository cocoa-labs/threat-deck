import { type RefObject, useCallback, useEffect, useRef } from 'react';

const NEAR_BOTTOM_PX = 80;

/**
 * Chat-style auto-scroll for a message list.
 *
 * Keeps the container pinned to the bottom as content grows — but ONLY while the
 * user is already near the bottom. If they scroll up, background updates
 * (streaming growth, video-render polling every ~2s, autonomous messages) must
 * NOT yank them back down. A brand-new *user* message always forces a jump to
 * the bottom (a deliberate "show me what I just sent").
 *
 * Returns an `onScroll` handler to attach to the same element as `scrollRef`.
 * All bookkeeping lives in refs, so it triggers no extra renders.
 */
export function useStickToBottom(
  scrollRef: RefObject<HTMLDivElement | null>,
  messages: ReadonlyArray<{ role?: string }>,
  streamingText: string,
): () => void {
  const rafRef = useRef(0);
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, [scrollRef]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on content changes (messages/streamingText), not on the stable ref
  useEffect(() => {
    const last = messages.at(-1);
    const userJustSent = messages.length > prevCountRef.current && last?.role === 'user';
    prevCountRef.current = messages.length;

    // Respect a scrolled-up reader unless they just sent something.
    if (!userJustSent && !atBottomRef.current) return;

    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      rafRef.current = 0;
    });
  }, [messages, streamingText, scrollRef]);

  return onScroll;
}
