'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Clock, CornerDownLeft, Search, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { AGENT_SUGGESTIONS } from '@/lib/constants/suggestions';
import { useAgentStream } from '@/lib/hooks/use-agent-stream';
import { useAgentStore } from '@/lib/store/agent-store';

/* ─── CommandPalette ─── */

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const commandHistory = useAgentStore((s) => s.commandHistory);
  const { invoke } = useAgentStream();

  // Cmd+K / Ctrl+K keybinding
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset query on close
      setQuery('');
    }
  }, [open]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      invoke(text.trim());
      setOpen(false);
      setQuery('');
    },
    [invoke],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit(query);
      }
    },
    [query, handleSubmit],
  );

  // Filter suggestions by query
  const filteredSuggestions = query.trim()
    ? AGENT_SUGGESTIONS.filter(
        (s) =>
          s.label.toLowerCase().includes(query.toLowerCase()) ||
          s.query.toLowerCase().includes(query.toLowerCase()),
      )
    : AGENT_SUGGESTIONS;

  // Filter history by query
  const filteredHistory = query.trim()
    ? commandHistory.filter((h) => h.toLowerCase().includes(query.toLowerCase()))
    : commandHistory.slice(0, 5);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          style={{ zIndex: 'var(--z-command-palette)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl"
          style={{ zIndex: 'var(--z-command-palette)' }}
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Dialog.Description className="sr-only">Search and execute commands</Dialog.Description>

          {/* Search input */}
          <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
            <Search size={16} className="shrink-0 text-[var(--text-dim)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask ${AGENT_IDENTITY.name} anything...`}
              className="flex-1 bg-transparent text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
            <kbd className="flex items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-dim)]">
              <CornerDownLeft size={10} />
            </kbd>
          </div>

          {/* Results area */}
          <div className="max-h-[320px] overflow-y-auto p-2">
            {/* Recent commands */}
            {filteredHistory.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <Clock size={10} className="text-[var(--text-muted)]" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Recent
                  </span>
                </div>
                {filteredHistory.map((cmd) => (
                  <button
                    type="button"
                    key={cmd}
                    onClick={() => handleSubmit(cmd)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-mono text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  >
                    <span className="truncate">{cmd}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Suggestions */}
            {filteredSuggestions.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <Zap size={10} className="text-[var(--text-muted)]" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Suggestions
                  </span>
                </div>
                {filteredSuggestions.map((s) => (
                  <button
                    type="button"
                    key={s.label}
                    onClick={() => handleSubmit(s.query)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <span className="text-xs font-mono text-[var(--text-secondary)]">
                      {s.label}
                    </span>
                    <span className="max-w-[200px] truncate text-[10px] font-mono text-[var(--text-dim)]">
                      {s.query}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {filteredHistory.length === 0 && filteredSuggestions.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="text-xs font-mono text-[var(--text-dim)]">
                  No matching commands
                </span>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  Press Enter to ask {AGENT_IDENTITY.name} directly
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2">
            <span className="text-[9px] font-mono text-[var(--text-muted)]">
              Powered by {AGENT_IDENTITY.name} / AEGIS
            </span>
            <div className="flex items-center gap-2">
              <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-dim)]">
                ESC
              </kbd>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">to close</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
