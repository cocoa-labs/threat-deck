'use client';

import { Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useCompanionStore } from '@/lib/store/companion-store';
import { cn } from '@/lib/utils/cn';

export function CompanionChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [input, setInput] = useState('');
  const isStreaming = useCompanionStore((s) => s.isCompanionStreaming);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setInput('');
  }, [input, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        borderTop: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
        background: 'var(--bg-surface)',
      }}
    >
      <input
        id="companion-chat-input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about the stream..."
        className={cn(
          'flex-1 bg-transparent text-[11px] font-mono outline-none',
          'text-[var(--text-primary)] placeholder:text-[var(--text-dim)]',
        )}
        disabled={isStreaming}
      />

      {/* Streaming indicator */}
      {isStreaming && (
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
      )}

      {/* Send button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!input.trim() || isStreaming}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded transition-colors',
          input.trim() && !isStreaming
            ? 'bg-[var(--color-positive)]/15 text-[var(--color-positive)] hover:bg-[var(--color-positive)]/25'
            : 'text-[var(--text-muted)] cursor-not-allowed',
        )}
        aria-label="Send message"
      >
        <Send size={12} />
      </button>
    </div>
  );
}
