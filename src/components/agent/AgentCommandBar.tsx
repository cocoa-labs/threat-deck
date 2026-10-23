'use client';

import { upload } from '@vercel/blob/client';
import {
  AlertTriangle,
  CheckCircle,
  ChevronUp,
  Command,
  FileText,
  ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Send,
  Table2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentStatusIndicator } from '@/components/agent/AgentStatusIndicator';
import {
  MAX_ACTIVE_ATTACHMENTS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  safeAttachmentPath,
  validateAttachmentInput,
} from '@/lib/agent/attachments/validation';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { AGENT_SUGGESTIONS } from '@/lib/constants/suggestions';
import { useAgentStream } from '@/lib/hooks/use-agent-stream';
import { type AgentAttachmentUiState, useAgentStore } from '@/lib/store/agent-store';
import { useCompanionStore } from '@/lib/store/companion-store';
import { useLayoutStore } from '@/lib/store/layout-store';
import { cn } from '@/lib/utils/cn';

/* ─── AgentCommandBar ─── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function attachmentIcon(kind: AgentAttachmentUiState['kind'], size = 14) {
  switch (kind) {
    case 'image':
      return <ImageIcon size={size} />;
    case 'spreadsheet':
      return <Table2 size={size} />;
    default:
      return <FileText size={size} />;
  }
}

function isAttachmentPending(attachment: AgentAttachmentUiState): boolean {
  return (
    attachment.status === 'uploading' ||
    attachment.status === 'uploaded' ||
    attachment.status === 'processing'
  );
}

function extensionLabel(filename: string, contentType: string): string {
  const ext = filename.split('.').pop()?.toUpperCase();
  if (ext && ext !== filename.toUpperCase() && ext.length <= 8) return ext;
  if (contentType.includes('spreadsheet')) return 'XLSX';
  if (contentType.includes('csv')) return 'CSV';
  if (contentType.includes('pdf')) return 'PDF';
  if (contentType.includes('wordprocessingml')) return 'DOCX';
  if (contentType.includes('markdown')) return 'MD';
  if (contentType.includes('json')) return 'JSON';
  if (contentType.startsWith('image/')) return contentType.replace('image/', '').toUpperCase();
  return 'FILE';
}

function attachmentStatusLabel(attachment: AgentAttachmentUiState): string {
  if (attachment.status === 'uploading') {
    const progress = Math.max(0, Math.min(100, Math.round(attachment.uploadProgress ?? 0)));
    return `Uploading ${progress}%`;
  }
  if (attachment.status === 'uploaded' || attachment.status === 'processing') return 'Processing';
  if (attachment.status === 'ready') return 'Ready';
  if (attachment.status === 'failed') return 'Failed';
  return attachment.uiStatusLabel ?? attachment.status;
}

function attachmentHelperText(attachments: AgentAttachmentUiState[]): string {
  const pendingCount = attachments.filter(isAttachmentPending).length;
  const failedCount = attachments.filter((attachment) => attachment.status === 'failed').length;
  const readyCount = attachments.filter((attachment) => attachment.status === 'ready').length;
  if (pendingCount > 0) {
    return `${AGENT_IDENTITY.name} is preparing ${pendingCount} file${pendingCount === 1 ? '' : 's'}...`;
  }
  if (readyCount > 0 && failedCount > 0) {
    return `${readyCount} ready, ${failedCount} failed. Failed files will not be sent.`;
  }
  if (readyCount > 0) return 'Ready to send';
  if (failedCount > 0) return 'Remove failed files or attach another file.';
  return 'Attach files for Max to analyze.';
}

function AttachmentShelf({
  attachments,
  uploadError,
  onRemove,
}: {
  attachments: AgentAttachmentUiState[];
  uploadError: string | null;
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0 && !uploadError) return null;

  const helperText = attachmentHelperText(attachments);

  return (
    <div
      className="border-t border-[var(--crt-glow)]/20 bg-[rgba(3,12,14,0.96)] px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]"
      style={{ borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.12)' }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 font-mono">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--crt-glow)]">
            Attachments {attachments.length}/{MAX_ATTACHMENTS_PER_MESSAGE}
          </span>
          <span className="truncate text-[9px] text-[var(--text-muted)]">{helperText}</span>
        </div>
        {attachments.some(isAttachmentPending) && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-wider text-[var(--color-warning)]">
            <Loader2 size={10} className="animate-spin" />
            Waiting
          </span>
        )}
      </div>

      <div className="flex max-h-28 flex-wrap items-stretch gap-2 overflow-y-auto pr-1">
        {attachments.map((attachment) => {
          const pending = isAttachmentPending(attachment);
          const failed = attachment.status === 'failed';
          const ready = attachment.status === 'ready';
          const progress = Math.max(0, Math.min(100, Math.round(attachment.uploadProgress ?? 0)));
          const typeLabel = extensionLabel(attachment.filename, attachment.contentType);

          return (
            <div
              key={attachment.id}
              className={cn(
                'flex min-w-[260px] max-w-[420px] flex-1 items-center gap-2 rounded border px-2.5 py-2 font-mono',
                failed
                  ? 'border-[var(--severity-critical)]/35 bg-[var(--severity-critical)]/10'
                  : ready
                    ? 'border-[var(--color-positive)]/35 bg-[var(--color-positive)]/8'
                    : 'border-[var(--color-warning)]/35 bg-[var(--color-warning)]/8',
              )}
              title={
                attachment.errorMessage ??
                `${attachment.filename} - ${formatBytes(attachment.sizeBytes)}`
              }
            >
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border',
                  failed
                    ? 'border-[var(--severity-critical)]/30 text-[var(--severity-critical)]'
                    : ready
                      ? 'border-[var(--color-positive)]/30 text-[var(--color-positive)]'
                      : 'border-[var(--color-warning)]/35 text-[var(--color-warning)]',
                )}
              >
                {attachment.localPreviewUrl ? (
                  <div
                    aria-hidden="true"
                    className="h-full w-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${attachment.localPreviewUrl})` }}
                  />
                ) : pending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : failed ? (
                  <AlertTriangle size={14} />
                ) : ready ? (
                  <CheckCircle size={14} />
                ) : (
                  attachmentIcon(attachment.kind, 14)
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-semibold text-[var(--text-primary)]">
                    {attachment.filename}
                  </span>
                  <span className="shrink-0 rounded border border-[var(--crt-glow)]/18 bg-black/30 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-[var(--crt-glow)]">
                    {typeLabel}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[8px] text-[var(--text-muted)]">
                  <span>{formatBytes(attachment.sizeBytes)}</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider',
                      failed
                        ? 'bg-[var(--severity-critical)]/15 text-[var(--severity-critical)]'
                        : ready
                          ? 'bg-[var(--color-positive)]/15 text-[var(--color-positive)]'
                          : 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
                    )}
                  >
                    {pending && <Loader2 size={8} className="animate-spin" />}
                    {attachmentStatusLabel(attachment)}
                  </span>
                </div>
                {attachment.status === 'uploading' && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-white/8">
                    <div
                      className="h-full bg-[var(--color-warning)]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                {failed && attachment.errorMessage && (
                  <div className="mt-1 truncate text-[8px] text-[var(--severity-critical)]">
                    {attachment.errorMessage}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                aria-label={`Remove ${attachment.filename}`}
                title={`Remove ${attachment.filename}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {uploadError && (
          <div className="inline-flex min-w-[260px] flex-1 items-center gap-2 rounded border border-[var(--severity-critical)]/35 bg-[var(--severity-critical)]/10 px-2.5 py-2 font-mono text-[9px] text-[var(--severity-critical)]">
            <AlertTriangle size={14} />
            <span className="truncate">{uploadError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function makeLocalPreviewUrl(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined;
  if (file.size > 5 * 1024 * 1024) return undefined;
  return URL.createObjectURL(file);
}

function releasePreviewUrl(attachment: AgentAttachmentUiState | undefined): void {
  if (attachment?.localPreviewUrl) URL.revokeObjectURL(attachment.localPreviewUrl);
}

function failedAttachmentFromFile(
  file: File,
  id: string,
  errorMessage: string,
): AgentAttachmentUiState {
  const now = new Date().toISOString();
  return {
    id,
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    kind: 'text',
    status: 'failed',
    uploadProgress: 0,
    uiStatusLabel: 'Failed',
    errorMessage,
    createdAt: now,
    updatedAt: now,
  };
}

export function AgentCommandBar() {
  const [input, setInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { invoke, abort } = useAgentStream();
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const status = useAgentStore((s) => s.status);
  const drawerOpen = useAgentStore((s) => s.drawerOpen);
  const setDrawerOpen = useAgentStore((s) => s.setDrawerOpen);
  const messageCount = useAgentStore((s) => s.messages.length);
  const prefillText = useAgentStore((s) => s.prefillText);
  const autoSend = useAgentStore((s) => s.autoSend);
  const clearPrefill = useAgentStore((s) => s.clearPrefill);
  const clearConversation = useAgentStore((s) => s.clearConversation);
  const activeAttachments = useAgentStore((s) => s.activeAttachments);
  const addActiveAttachment = useAgentStore((s) => s.addActiveAttachment);
  const updateActiveAttachment = useAgentStore((s) => s.updateActiveAttachment);
  const removeActiveAttachment = useAgentStore((s) => s.removeActiveAttachment);
  const heroScrolledAway = useLayoutStore((s) => s.heroScrolledAway);
  const scrollToHero = useLayoutStore((s) => s.scrollToHero);
  const hasPendingAttachments = activeAttachments.some(isAttachmentPending);
  const readyAttachments = activeAttachments.filter((attachment) => attachment.status === 'ready');

  const handleClearContext = useCallback(() => {
    useAgentStore.getState().activeAttachments.forEach(releasePreviewUrl);
    clearConversation();
    useCompanionStore.getState().clearCompanionMessages();
    // Fire-and-forget: clear server-side exchanges
    fetch('/api/agent/context?userId=anonymous', { method: 'DELETE' }).catch(() => {});
  }, [clearConversation]);

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      releasePreviewUrl(useAgentStore.getState().activeAttachments.find((item) => item.id === id));
      removeActiveAttachment(id);
      fetch(`/api/agent/attachments/${id}`, { method: 'DELETE' }).catch(() => {});
    },
    [removeActiveAttachment],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
      if (files.length === 0) return;
      setUploadError(null);

      const availableSlots =
        MAX_ACTIVE_ATTACHMENTS - useAgentStore.getState().activeAttachments.length;
      if (availableSlots <= 0) {
        setUploadError('Attachment cap reached.');
        return;
      }

      const uploadFiles = files.slice(0, availableSlots);
      if (files.length > uploadFiles.length) {
        setUploadError(`Only ${availableSlots} more attachment(s) can be added.`);
      }

      const uploads: { file: File; optimistic: AgentAttachmentUiState }[] = [];

      for (const file of uploadFiles) {
        const id = crypto.randomUUID();
        const validated = validateAttachmentInput({
          id,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });

        if (!validated.ok) {
          const message = validated.error.replace(/_/g, ' ');
          addActiveAttachment(failedAttachmentFromFile(file, id, message));
          setUploadError(`${file.name}: ${message}`);
          continue;
        }

        const now = new Date().toISOString();
        const optimistic: AgentAttachmentUiState = {
          id,
          filename: validated.filename,
          contentType: validated.contentType,
          sizeBytes: file.size,
          kind: validated.kind,
          status: 'uploading',
          uploadProgress: 0,
          localPreviewUrl: makeLocalPreviewUrl(file),
          uiStatusLabel: 'Uploading 0%',
          createdAt: now,
          updatedAt: now,
        };
        addActiveAttachment(optimistic);
        uploads.push({ file, optimistic });
      }

      await Promise.allSettled(
        uploads.map(async ({ file, optimistic }) => {
          const { id } = optimistic;
          try {
            const blob = await upload(safeAttachmentPath(id, file.name), file, {
              access: 'private',
              handleUploadUrl: '/api/agent/attachments/upload',
              contentType: optimistic.contentType,
              clientPayload: JSON.stringify({
                id,
                filename: file.name,
                contentType: optimistic.contentType,
                sizeBytes: file.size,
              }),
              multipart: file.size > 4_500_000,
              onUploadProgress: ({ percentage }) => {
                updateActiveAttachment({
                  id,
                  filename: optimistic.filename,
                  contentType: optimistic.contentType,
                  sizeBytes: optimistic.sizeBytes,
                  kind: optimistic.kind,
                  status: 'uploading',
                  uploadProgress: percentage,
                  uiStatusLabel: `Uploading ${Math.round(percentage)}%`,
                  updatedAt: new Date().toISOString(),
                });
              },
            });

            updateActiveAttachment({
              ...optimistic,
              status: 'processing',
              blobUrl: `/api/agent/attachments/${id}/content`,
              uploadProgress: 100,
              uiStatusLabel: 'Processing',
              updatedAt: new Date().toISOString(),
            });

            const response = await fetch(`/api/agent/attachments/${id}/process`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ blob: { ...blob, size: file.size } }),
            });
            const data = (await response.json()) as {
              ok?: boolean;
              attachment?: AgentAttachmentUiState;
              error?: string;
              detail?: string;
            };

            if (!response.ok || !data.ok || !data.attachment) {
              throw new Error(data.detail ?? data.error ?? 'attachment_processing_failed');
            }
            releasePreviewUrl(optimistic);
            updateActiveAttachment({
              ...data.attachment,
              uploadProgress: 100,
              localPreviewUrl: undefined,
              uiStatusLabel: 'Ready',
            });
          } catch (err) {
            updateActiveAttachment({
              ...optimistic,
              status: 'failed',
              uploadProgress: 0,
              uiStatusLabel: 'Failed',
              errorMessage: err instanceof Error ? err.message : 'Upload failed',
              updatedAt: new Date().toISOString(),
            });
          }
        }),
      );
    },
    [addActiveAttachment, updateActiveAttachment],
  );

  useEffect(() => {
    return () => {
      useAgentStore.getState().activeAttachments.forEach(releasePreviewUrl);
    };
  }, []);

  // Consume prefill text: auto-send (concise) or populate input (manual editing)
  useEffect(() => {
    if (!prefillText) return;

    if (autoSend) {
      // Debounce 300ms — rapid clicks only fire the last one
      const timer = setTimeout(() => {
        const text = prefillText;
        clearPrefill();
        invoke(text, 'concise');
      }, 300);
      return () => clearTimeout(timer);
    }

    // Manual mode: populate input for editing
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes a user action from the external dashboard store
    setInput(prefillText);
    clearPrefill();
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [prefillText, autoSend, clearPrefill, invoke]);

  const handleSubmit = useCallback(
    (text?: string) => {
      const query =
        (text ?? input).trim() ||
        (readyAttachments.length > 0 ? 'Analyze the attached file(s).' : '');
      if (hasPendingAttachments) return;
      if (!query) return;
      invoke(query);
      setInput('');
    },
    [hasPendingAttachments, input, invoke, readyAttachments.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInputFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (files) void handleFiles(files);
      event.currentTarget.value = '';
    },
    [handleFiles],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (event.dataTransfer.files.length > 0) {
        void handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  return (
    <section
      className="fixed right-0"
      aria-label={`${AGENT_IDENTITY.name} command bar and file drop zone`}
      style={{
        left: 'var(--sidebar-width)',
        bottom: 'var(--bottom-ticker-height)',
        zIndex: 'var(--z-command-bar)',
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {/* Suggestion chips (show when input is empty and idle) */}
      {!input.trim() && status === 'idle' && !drawerOpen && (
        <div className="relative">
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-10 w-6 bg-gradient-to-r from-[var(--bg-primary)] to-transparent" />
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 pb-2">
            {AGENT_SUGGESTIONS.map((s) => (
              <button
                type="button"
                key={s.label}
                onClick={() => handleSubmit(s.query)}
                className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)]/80 px-3 py-1 text-[10px] font-mono text-[var(--text-secondary)] backdrop-blur-md transition-colors hover:border-[var(--border-focus)] hover:text-[var(--text-primary)]"
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-6 bg-gradient-to-l from-[var(--bg-primary)] to-transparent" />
        </div>
      )}

      <AttachmentShelf
        attachments={activeAttachments}
        uploadError={uploadError}
        onRemove={handleRemoveAttachment}
      />

      {/* Command bar */}
      <div
        className={cn(
          'flex items-center gap-3 border-t bg-[var(--bg-surface)] px-4 shadow-[0_-2px_12px_rgba(0,170,255,0.08)]',
          dragActive ? 'border-[var(--crt-glow)]' : 'border-[var(--color-info)]/20',
        )}
        style={{ height: 'var(--command-bar-height)' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.xls,.csv,.tsv,.txt,.md,.markdown,.json,.ndjson,image/png,image/jpeg,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain,text/markdown,application/json"
          onChange={handleInputFiles}
        />

        {/* Scroll to top */}
        <button
          type="button"
          onClick={() => scrollToHero?.()}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md transition-all',
            'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--crt-glow)]',
            heroScrolledAway ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none',
          )}
          aria-label="Scroll to top"
        >
          <ChevronUp size={14} />
        </button>

        {/* Status indicator */}
        <AgentStatusIndicator size={10} />

        {/* Attach files */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || activeAttachments.length >= MAX_ACTIVE_ATTACHMENTS}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            isStreaming || activeAttachments.length >= MAX_ACTIVE_ATTACHMENTS
              ? 'cursor-not-allowed text-[var(--text-muted)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--crt-glow)]',
          )}
          aria-label="Attach files"
          title="Attach files"
        >
          <Paperclip size={14} />
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask ${AGENT_IDENTITY.name} anything - analyze markets, assess risks, generate briefs...`}
          className={cn(
            'flex-1 bg-transparent text-sm font-mono outline-none',
            'text-[var(--text-primary)] placeholder:text-[var(--text-dim)]',
          )}
        />

        {/* Cmd+K hint */}
        <kbd className="hidden items-center gap-0.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-mono text-[var(--text-dim)] sm:flex">
          <Command size={10} />K
        </kbd>

        {/* Clear context */}
        {messageCount > 0 && (
          <button
            type="button"
            onClick={handleClearContext}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition-colors hover:bg-[var(--color-warning)]/15 hover:text-[var(--color-warning)]"
            aria-label="Clear conversation context"
            title="Clear context"
          >
            <RotateCcw size={13} />
          </button>
        )}

        {/* Drawer toggle */}
        <button
          type="button"
          onClick={() => setDrawerOpen(!drawerOpen)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors relative',
            drawerOpen
              ? 'bg-[var(--color-info)]/15 text-[var(--color-info)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
          )}
          aria-label="Toggle conversation"
        >
          <MessageSquare size={14} />
          {messageCount > 0 && !drawerOpen && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--color-info)]" />
          )}
        </button>

        {/* Send / Abort button */}
        {isStreaming ? (
          <button
            type="button"
            onClick={abort}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-negative)]/15 text-[var(--color-negative)] transition-colors hover:bg-[var(--color-negative)]/25"
            aria-label={`Stop ${AGENT_IDENTITY.name}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={hasPendingAttachments || (!input.trim() && readyAttachments.length === 0)}
            title={hasPendingAttachments ? 'Waiting for attachments' : 'Send message'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              (input.trim() || readyAttachments.length > 0) && !hasPendingAttachments
                ? 'bg-[var(--color-positive)]/15 text-[var(--color-positive)] hover:bg-[var(--color-positive)]/25'
                : 'text-[var(--text-muted)] cursor-not-allowed',
            )}
            aria-label={hasPendingAttachments ? 'Waiting for attachments' : 'Send message'}
          >
            {hasPendingAttachments ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        )}
      </div>
    </section>
  );
}
