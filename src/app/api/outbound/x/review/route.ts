import { auth } from '@/lib/auth';
import { query } from '@/lib/db/client';
import { ownedMediaUrl } from '@/lib/security/media-ownership';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { appendCanonicalHashtag, validateThreadDraft } from '@/lib/twitter/content/format';
import { stageDraft } from '@/lib/twitter/content/staging';
import type { ThreadDraft } from '@/lib/twitter/content/types';

/** The composer creates a reviewable draft. Only the approval route publishes it. */
export const POST = withRoutePolicy('/api/outbound/x/review', async (request: Request) => {
  const owner = (await auth())?.user?.email;
  if (!owner) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  if (body.replyMode === 'generate_image')
    return Response.json(
      { ok: false, error: 'Generate and review the image before attaching it.' },
      { status: 400 },
    );
  if (typeof body.text !== 'string' || !body.text.trim())
    return Response.json({ ok: false, error: 'empty_text' }, { status: 400 });
  const draft: ThreadDraft = {
    canonicalHashtag: '#AICyber',
    tweets: [{ text: appendCanonicalHashtag(body.text.trim()) }],
  };
  if (
    body.publishMode === 'two_post' &&
    typeof body.replyText === 'string' &&
    body.replyText.trim()
  )
    draft.tweets.push({ text: body.replyText.trim() });
  const reference = body.videoBlobUrl ?? body.imageBlobUrl;
  if (reference) {
    if (typeof reference !== 'string')
      return Response.json({ ok: false, error: 'invalid_media' }, { status: 400 });
    const url = await ownedMediaUrl(reference, owner);
    const result = await query<{ id: string; media_kind: 'image' | 'video' }>(
      'SELECT id::text, media_kind FROM aegis_generated_media WHERE blob_url = $1 AND owner_email = $2',
      [url, owner],
    );
    const media = result.rows[0];
    if (!media) return Response.json({ ok: false, error: 'media_not_owned' }, { status: 403 });
    draft.mediaId = media.id;
    draft.mediaKind = media.media_kind;
  }
  const violation = validateThreadDraft(draft);
  if (violation) return Response.json({ ok: false, error: violation }, { status: 400 });
  const result = await stageDraft({
    channel: 'twitter',
    draftType: 'agent_post',
    agentMode: 'anchor',
    headline: body.text.slice(0, 240),
    previewText: body.text.slice(0, 240),
    draftPayload: draft,
    createdBy: owner,
  });
  return Response.json(result, { status: result.ok ? 201 : 400 });
});
