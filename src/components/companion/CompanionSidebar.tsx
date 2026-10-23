'use client';

import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo, useRef } from 'react';
import { ChannelSwitchCard } from '@/components/companion/ChannelSwitchCard';
import { CompanionChatInput } from '@/components/companion/CompanionChatInput';
import { CompanionContextCard } from '@/components/companion/CompanionContextCard';
import { YouTubeSearchResultCard } from '@/components/companion/YouTubeSearchResultCard';
import { useStickToBottom } from '@/lib/hooks/use-stick-to-bottom';
import { useCompanionStore } from '@/lib/store/companion-store';
import { cn } from '@/lib/utils/cn';
import { renderMarkdown } from '@/lib/utils/markdown-renderer';

const CompanionAssistantMessage = React.memo(function CompanionAssistantMessage({
  content,
}: {
  content: string;
}) {
  const rendered = useMemo(() => renderMarkdown(content), [content]);
  return <>{rendered}</>;
});

export function CompanionSidebar({ onSendMessage }: { onSendMessage: (text: string) => void }) {
  const sidebarOpen = useCompanionStore((s) => s.sidebarOpen);
  const toggleSidebar = useCompanionStore((s) => s.toggleSidebar);
  const contextUpdates = useCompanionStore((s) => s.contextUpdates);
  const companionMessages = useCompanionStore((s) => s.companionMessages);
  const streamingText = useCompanionStore((s) => s.companionStreamingText);
  const isStreaming = useCompanionStore((s) => s.isCompanionStreaming);
  const clearMessages = useCompanionStore((s) => s.clearCompanionMessages);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom only while the user is already there (shared with the
  // agent drawer) so background updates never yank a scrolled-up reader.
  const handleScroll = useStickToBottom(scrollRef, companionMessages, streamingText);

  const handleClear = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  // Collapsed tab handle
  if (!sidebarOpen) {
    return (
      <button
        type="button"
        onClick={toggleSidebar}
        className="fixed flex items-center gap-1 rounded-l px-1.5 py-3 font-mono"
        style={{
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 52,
          background: 'var(--crt-panel-bg)',
          border: '1px solid rgba(var(--crt-glow-rgb), 0.2)',
          borderRight: 'none',
          writingMode: 'vertical-rl',
        }}
        aria-label="Open companion sidebar"
      >
        <ChevronLeft size={10} style={{ color: 'var(--crt-glow)' }} />
        <span
          className="text-[8px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--crt-glow)' }}
        >
          Companion
        </span>
      </button>
    );
  }

  return (
    <div
      className="fixed top-0 bottom-0 right-0 flex flex-col"
      style={{
        width: 'var(--companion-sidebar-width, 380px)',
        zIndex: 52,
        background: 'var(--crt-panel-bg)',
        borderLeft: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-3 py-2.5"
        style={{ borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.15)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: 'var(--color-positive)',
              boxShadow: 'var(--shadow-glow-positive)',
            }}
          />
          <span
            className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em]"
            style={{
              color: 'var(--crt-glow)',
              textShadow: '0 0 8px rgba(var(--crt-glow-rgb), 0.25)',
            }}
          >
            Companion
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-dim)] hover:text-[var(--crt-glow)]"
            aria-label="Clear messages"
            title="Clear messages"
          >
            <Trash2 size={12} />
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-6 w-6 items-center justify-center text-[var(--text-dim)] hover:text-[var(--crt-glow)]"
            aria-label="Close companion sidebar"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2"
      >
        {/* Context update cards */}
        {contextUpdates.length > 0 && (
          <div className="space-y-1.5">
            <div
              className="text-[8px] font-mono font-semibold uppercase tracking-[0.2em] px-1"
              style={{ color: 'var(--text-dim)' }}
            >
              Context
            </div>
            {contextUpdates.slice(0, 10).map((u) => (
              <CompanionContextCard key={u.id} update={u} />
            ))}
          </div>
        )}

        {/* Chat messages */}
        {companionMessages.length > 0 && (
          <div
            className="space-y-2 pt-2"
            style={{ borderTop: '1px solid rgba(var(--crt-glow-rgb), 0.08)' }}
          >
            <div
              className="text-[8px] font-mono font-semibold uppercase tracking-[0.2em] px-1"
              style={{ color: 'var(--text-dim)' }}
            >
              Chat
            </div>
            {companionMessages.map((msg) => {
              // Channel switch messages get a presentation card wrapping the content
              if (msg.role === 'assistant' && msg.channelSwitch) {
                return (
                  <div key={msg.id} className="mr-6">
                    <ChannelSwitchCard data={msg.channelSwitch}>
                      <CompanionAssistantMessage content={msg.content} />
                    </ChannelSwitchCard>
                  </div>
                );
              }

              // YouTube search results get rich thumbnail cards
              if (msg.role === 'assistant' && msg.youtubeResults?.autoPlay) {
                return (
                  <div
                    key={msg.id}
                    className="px-2.5 py-2 text-[10px] font-mono leading-relaxed rounded mr-6"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                    }}
                  >
                    <CompanionAssistantMessage content={msg.content} />
                    <YouTubeSearchResultCard
                      autoPlay={msg.youtubeResults.autoPlay}
                      alternatives={msg.youtubeResults.alternatives}
                      query={msg.youtubeResults.query}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={cn(
                    'px-2.5 py-2 text-[10px] font-mono leading-relaxed rounded',
                    msg.role === 'user'
                      ? 'bg-[var(--color-info)]/8 text-[var(--text-primary)] border border-[var(--color-info)]/20 ml-6'
                      : 'text-[var(--text-secondary)] mr-6',
                  )}
                  style={
                    msg.role === 'assistant'
                      ? {
                          background: 'var(--bg-surface)',
                          border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
                        }
                      : undefined
                  }
                >
                  {msg.role === 'assistant' ? (
                    <CompanionAssistantMessage content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Streaming text */}
        {isStreaming && (
          <div
            className="px-2.5 py-2 text-[10px] font-mono leading-relaxed rounded mr-6"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid rgba(var(--crt-glow-rgb), 0.12)',
            }}
          >
            {streamingText ? (
              <div className="text-[var(--text-secondary)] break-words">
                {renderMarkdown(streamingText)}
                <span
                  className="inline-block h-2.5 w-1 animate-pulse ml-0.5"
                  style={{ background: 'var(--crt-glow)' }}
                />
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[var(--text-dim)]">
                <span className="flex gap-0.5">
                  <span
                    className="h-1 w-1 rounded-full bg-[var(--crt-glow)] animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="h-1 w-1 rounded-full bg-[var(--crt-glow)] animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="h-1 w-1 rounded-full bg-[var(--crt-glow)] animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </span>
                Thinking...
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chat input (sticky bottom) */}
      <div className="shrink-0">
        <CompanionChatInput onSend={onSendMessage} />
      </div>
    </div>
  );
}
