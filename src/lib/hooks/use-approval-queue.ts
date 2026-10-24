'use client';

/**
 * Phase 9.1 — Client hooks for the AgentDrawer Approval Queue.
 *
 *   useApprovalQueue()  — TanStack Query subscription. Adaptive polling
 *                         (60s when WS connected, 30s polled fallback)
 *                         per the project's existing data-hook convention.
 *   useApproveDraft()   — mutation with optimistic remove.
 *   useRejectDraft()    — mutation with optimistic remove + mandatory reason.
 *
 * The optimistic-remove pattern: on `onMutate` we snapshot the cached list
 * and synchronously filter out the targeted draft so the UI updates within
 * one frame. On success we keep the optimistic state. On failure we restore
 * the snapshot and the caller surfaces a toast/log.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DraftRow } from '@/lib/outbound/drafts';
import { useConnectionStore } from '@/lib/store/connection-store';

const QUEUE_KEY = ['approval-queue', 'pending'] as const;
export const OPEN_APPROVAL_QUEUE_EVENT = 'threatdeck:open-publication-review';

interface ApproveResponse {
  ok: boolean;
  draftId: number;
  status?: string;
  tweetIds?: string[];
  dryRun?: boolean;
  error?: string;
  detail?: string;
}

interface RejectResponse {
  ok: boolean;
  draftId: number;
  status?: string;
  error?: string;
  detail?: string;
}

interface EditResponse {
  ok: boolean;
  draftId: number;
  status?: string;
  error?: string;
  detail?: string;
}

/**
 * Read the pending approval queue. The TanStack cache key
 * `['approval-queue', 'pending']` is what the WS `outbound:draft_added`
 * event invalidates and what `outbound:draft_decided` mutates directly
 * (see `src/lib/ws/client.ts` dispatchAlerts).
 */
export function useApprovalQueue() {
  const wsConnected = useConnectionStore((s) => s.wsConnected);
  return useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async (): Promise<DraftRow[]> => {
      const res = await fetch('/api/outbound/drafts?status=pending&limit=20', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`approval-queue fetch failed: ${res.status}`);
      }
      const json = (await res.json()) as { ok: boolean; drafts?: DraftRow[] };
      if (!json.ok || !Array.isArray(json.drafts)) return [];
      return json.drafts;
    },
    refetchInterval: wsConnected ? 60_000 : 30_000,
    staleTime: 10_000,
  });
}

export function useApproveDraft() {
  const qc = useQueryClient();
  return useMutation<
    ApproveResponse,
    Error,
    { id: number; publish?: boolean; reviewedPayload: Record<string, unknown> }
  >({
    mutationFn: async ({ id, publish = true, reviewedPayload }) => {
      const res = await fetch(`/api/outbound/drafts/${id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publish, reviewedPayload }),
      });
      const json = (await res.json()) as ApproveResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? json.detail ?? `approve failed: ${res.status}`);
      }
      return json;
    },
    onMutate: async ({ id }) => {
      // Optimistic-remove pattern: cancel in-flight refetches, snapshot the
      // current cache, then drop the target draft from the list so the UI
      // updates within one frame.
      await qc.cancelQueries({ queryKey: QUEUE_KEY });
      const previous = qc.getQueryData<DraftRow[]>(QUEUE_KEY);
      qc.setQueryData<DraftRow[]>(QUEUE_KEY, (prev) =>
        prev ? prev.filter((d) => d.id !== id) : [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: DraftRow[] } | undefined;
      if (ctx?.previous) {
        qc.setQueryData(QUEUE_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      // Eventual consistency — re-fetch from server so any concurrent
      // updates (other reviewers approving / rejecting) are picked up.
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}

export function useRejectDraft() {
  const qc = useQueryClient();
  return useMutation<RejectResponse, Error, { id: number; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const trimmed = reason.trim();
      if (trimmed.length === 0) {
        throw new Error('rejection reason is required');
      }
      const res = await fetch(`/api/outbound/drafts/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: trimmed }),
      });
      const json = (await res.json()) as RejectResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? json.detail ?? `reject failed: ${res.status}`);
      }
      return json;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: QUEUE_KEY });
      const previous = qc.getQueryData<DraftRow[]>(QUEUE_KEY);
      qc.setQueryData<DraftRow[]>(QUEUE_KEY, (prev) =>
        prev ? prev.filter((d) => d.id !== id) : [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: DraftRow[] } | undefined;
      if (ctx?.previous) {
        qc.setQueryData(QUEUE_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}

/**
 * Inline-edit a pending draft's payload (per-tweet edits from the queue).
 * Unlike approve/reject this does NOT optimistic-remove — an edited draft
 * stays pending — it just invalidates so the row reflects the new preview.
 */
export function useEditDraft() {
  const qc = useQueryClient();
  return useMutation<EditResponse, Error, { id: number; draftPayload: unknown }>({
    mutationFn: async ({ id, draftPayload }) => {
      const res = await fetch(`/api/outbound/drafts/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftPayload }),
      });
      const json = (await res.json()) as EditResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.detail ?? json.error ?? `edit failed: ${res.status}`);
      }
      return json;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
    },
  });
}

/** Exported so the WS dispatcher in ws/client.ts can target the same key. */
export const APPROVAL_QUEUE_KEY = QUEUE_KEY;
