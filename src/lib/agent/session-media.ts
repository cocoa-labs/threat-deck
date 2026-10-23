/**
 * Session-media manifest builder.
 *
 * The agent's turn-to-turn history is text-only, so generated media (and the
 * fact that any image/video exists) never reaches its context — especially for
 * media created via the IMG/VID operator buttons, which bypass the agent loop
 * entirely (no tool call to remember). This projects the client store's
 * per-message media attachments into a compact, deduped, newest-first manifest
 * that the route folds onto `AgentContext.sessionMedia` and `prompts.ts` renders
 * into the dynamic system-prompt block.
 *
 * Generic over the message shape so the same helper serves both the main drawer
 * (`ConversationMessage`) and the companion (`CompanionMessage`) — both reuse the
 * `GeneratedImageAttachment` / `GeneratedVideoAttachment` types from agent-store.
 */
import type { GeneratedImageAttachment, GeneratedVideoAttachment } from '@/lib/store/agent-store';
import type { SessionMediaItem } from '@/lib/types';

/** Cap on manifest size, enforced here AND again at the route (defense in depth). */
export const SESSION_MEDIA_LIMIT = 12;

interface MessageWithMedia {
  generatedImages?: GeneratedImageAttachment[];
  generatedVideos?: GeneratedVideoAttachment[];
}

/**
 * Flatten messages → media items, drop failed, dedup by id (freshest wins),
 * sort newest-first, cap at {@link SESSION_MEDIA_LIMIT}.
 */
export function buildSessionMediaManifest(messages: MessageWithMedia[]): SessionMediaItem[] {
  const byId = new Map<string, SessionMediaItem & { sortKey: number }>();

  const consider = (
    attachment: GeneratedImageAttachment | GeneratedVideoAttachment,
    kind: 'image' | 'video',
  ): void => {
    if (!attachment.generatedMediaId || attachment.status === 'failed') return;
    const sortKey = attachment.updatedAt ?? attachment.createdAt ?? 0;
    const existing = byId.get(attachment.generatedMediaId);
    // Pending→ready updates the same id across re-renders — keep the freshest.
    if (existing && existing.sortKey >= sortKey) return;
    byId.set(attachment.generatedMediaId, {
      generatedMediaId: attachment.generatedMediaId,
      kind,
      styleTag: attachment.styleTag,
      status: attachment.status,
      createdAt: attachment.createdAt,
      sortKey,
    });
  };

  for (const message of messages) {
    for (const img of message.generatedImages ?? []) consider(img, 'image');
    for (const vid of message.generatedVideos ?? []) consider(vid, 'video');
  }

  return [...byId.values()]
    .sort((a, b) => b.sortKey - a.sortKey) // newest-first
    .slice(0, SESSION_MEDIA_LIMIT)
    .map(({ sortKey: _sortKey, ...item }) => item);
}

const SESSION_MEDIA_STATUSES = new Set(['pending', 'ready', 'failed', 'published']);

/**
 * Validate/coerce a client-supplied session-media manifest at the route boundary.
 * It feeds an authoritative system-prompt section, so harden it: digits-only ids
 * (matching resolveMediaItems' `/^\d+$/`, so the agent never cites an id that
 * silently resolves to nothing), known kinds/statuses only, finite timestamps,
 * capped. Returns a clean array; never throws.
 */
export function sanitizeSessionMedia(raw: unknown): SessionMediaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionMediaItem[] = [];
  for (const entry of raw) {
    if (out.length >= SESSION_MEDIA_LIMIT) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.generatedMediaId === 'string' ? e.generatedMediaId.trim() : '';
    if (!/^\d+$/.test(id)) continue;
    if (e.kind !== 'image' && e.kind !== 'video') continue;
    const status =
      typeof e.status === 'string' && SESSION_MEDIA_STATUSES.has(e.status) ? e.status : undefined;
    const createdAt =
      typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : undefined;
    out.push({
      generatedMediaId: id,
      kind: e.kind,
      styleTag: typeof e.styleTag === 'string' ? e.styleTag : undefined,
      status,
      createdAt,
    });
  }
  return out;
}
