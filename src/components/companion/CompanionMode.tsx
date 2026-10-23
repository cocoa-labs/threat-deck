'use client';

import { useCallback, useEffect, useRef } from 'react';
import { CompanionModeIndicator } from '@/components/companion/CompanionModeIndicator';
import { CompanionSidebar } from '@/components/companion/CompanionSidebar';
import { CompanionTicker } from '@/components/companion/CompanionTicker';
import { CompanionToast } from '@/components/companion/CompanionToast';
import { useCompanionStore } from '@/lib/store/companion-store';
import { useYouTubeStore } from '@/lib/store/youtube-store';
import type { PanelId } from '@/lib/types';

/**
 * Read the active livestream channel ID from localStorage.
 * This key is set by LivestreamPanel's useSyncExternalStore.
 */
function getActiveChannelId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      localStorage.getItem('klammer-active-channel') ??
      localStorage.getItem('klammer-livestream-channel') ??
      null
    );
  } catch {
    return null;
  }
}

interface CompanionModeProps {
  panelId?: PanelId;
}

export function CompanionMode({ panelId }: CompanionModeProps) {
  const isActive = useCompanionStore((s) => s.isActive);
  const activate = useCompanionStore((s) => s.activate);
  const deactivate = useCompanionStore((s) => s.deactivate);
  const addCompanionMessage = useCompanionStore((s) => s.addCompanionMessage);
  const activatedRef = useRef(false);

  const isYouTube = panelId === 'youtubeSearch';
  const currentVideo = useYouTubeStore((s) => s.currentVideo);

  // Auto-activate when mounted (fullscreen media panel) if not already active
  useEffect(() => {
    if (activatedRef.current) return;

    // Check window width — companion disabled at <1024px
    if (window.innerWidth < 1024) return;

    if (isYouTube) {
      // YouTube panel: use video ID from YouTube store
      if (currentVideo?.videoId && !isActive) {
        activate(`youtube:${currentVideo.videoId}`);
        activatedRef.current = true;
      }
    } else {
      // Livestream panel: use channel from localStorage
      const channelId = getActiveChannelId();
      if (channelId && !isActive) {
        activate(channelId);
        activatedRef.current = true;
      }
    }
  }, [isActive, activate, isYouTube, currentVideo?.videoId]);

  // Sync companion when YouTube video changes
  useEffect(() => {
    if (!isActive || !isYouTube) return;
    if (currentVideo?.videoId) {
      activate(`youtube:${currentVideo.videoId}`);
    }
  }, [isActive, isYouTube, currentVideo?.videoId, activate]);

  // Sync companion when user plays a video via agent (klammer-youtube-play event)
  useEffect(() => {
    if (!isActive || !isYouTube) return;

    function handleYouTubePlay() {
      // The YouTube store will have been updated by the time this fires;
      // the videoId effect above handles the actual sync
    }
    window.addEventListener('klammer-youtube-play', handleYouTubePlay);
    return () => window.removeEventListener('klammer-youtube-play', handleYouTubePlay);
  }, [isActive, isYouTube]);

  // Sync companion when user switches channels in any livestream panel (same-tab)
  useEffect(() => {
    if (!isActive || isYouTube) return;

    function handleChannelChange(e: Event) {
      const channelId = (e as CustomEvent<string>).detail;
      if (channelId) activate(channelId);
    }
    window.addEventListener('active-channel-change', handleChannelChange);
    return () => window.removeEventListener('active-channel-change', handleChannelChange);
  }, [isActive, isYouTube, activate]);

  // Sync companion when channel changes cross-tab (storage event)
  useEffect(() => {
    if (!isActive || isYouTube) return;

    function handleStorage(e: StorageEvent) {
      if (e.key === 'klammer-active-channel' && e.newValue) {
        activate(e.newValue);
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [isActive, isYouTube, activate]);

  // Deactivate on unmount (fullscreen exit)
  useEffect(() => {
    return () => {
      if (activatedRef.current) {
        deactivate();
        activatedRef.current = false;
      }
    };
  }, [deactivate]);

  const handleSendMessage = useCallback(
    (text: string) => {
      addCompanionMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      });

      // Companion stream hook will handle the actual API call
      // This is dispatched via a custom event that the hook listens for
      window.dispatchEvent(new CustomEvent('companion-chat-send', { detail: { text } }));
    },
    [addCompanionMessage],
  );

  if (!isActive) return null;

  return (
    <>
      <CompanionModeIndicator />
      <CompanionTicker />
      <CompanionToast />
      <CompanionSidebar onSendMessage={handleSendMessage} />
    </>
  );
}
