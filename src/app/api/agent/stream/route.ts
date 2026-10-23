import { buildAttachmentContentBlocks } from '@/lib/agent/attachments/context';
import {
  isUuid,
  MAX_ATTACHMENTS_PER_MESSAGE,
  toAttachmentSummary,
} from '@/lib/agent/attachments/validation';
import { streamAgent } from '@/lib/agent/client';
import { correlateClickContext } from '@/lib/agent/correlation';
import { type AgentMode, computeEffectiveMode, parseLockedMode } from '@/lib/agent/mode-config';
import { sanitizeSessionMedia } from '@/lib/agent/session-media';
import { registerAllTools } from '@/lib/agent/tools';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { getAttachmentsForOwner } from '@/lib/db/queries/attachments';
import { setViewportContext } from '@/lib/mapbox/viewport-context';
import { checkAnthropicDailySpend } from '@/lib/security/anthropic-spend';
import { budgetedAIFetch } from '@/lib/security/budget';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { withRoutePolicy } from '@/lib/security/route-policy';
import type {
  AgentContext,
  AlertHistoryItem,
  ApprovalRequest,
  BriefFormat,
  BriefSummary,
} from '@/lib/types';

registerAllTools();

/**
 * Extract PanelContext from the <context>JSON</context> tag in the task string.
 * Returns sourcePanel, dataType, and trendData if found, null otherwise.
 */
function extractPanelContext(
  task: string,
): { sourcePanel: string; dataType: string; trendData: Record<string, unknown> } | null {
  const match = task.match(/<context>([\s\S]*?)<\/context>/);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (!parsed.sourcePanel) return null;
    return {
      sourcePanel: parsed.sourcePanel as string,
      dataType: (parsed.dataType as string) ?? '',
      trendData: (parsed.trendData as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

async function loadRecentBriefs(): Promise<BriefSummary[]> {
  try {
    const { getRecentBriefs } = await import('@/lib/db/queries/agent');
    const rows = await getRecentBriefs({ limit: 5 });
    return rows.map((r) => ({
      id: r.id,
      headline: r.headline,
      confidence: r.confidence ?? undefined,
      format: r.format as BriefFormat,
      timestamp: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * The agent's view of the live alert board, injected into the dynamic prompt
 * block. This read `alert_history` — a table whose only INSERT helper had zero
 * callers — so `activeAlerts` was permanently `[]` and Max was structurally
 * blind to the deck's own alerts. It now reads the alert spine.
 */
async function loadActiveAlerts(): Promise<AlertHistoryItem[]> {
  try {
    const { listPipelineAlerts } = await import('@/lib/db/queries/pipeline-alerts');
    const { toAlertHistoryItem } = await import('@/lib/aegis/alert-mapper');
    const rows = await listPipelineAlerts({ statuses: ['new'], limit: 10 });
    return rows.map((row) => toAlertHistoryItem(row));
  } catch {
    return [];
  }
}

async function loadPendingApprovals(): Promise<ApprovalRequest[]> {
  try {
    const { getPendingApprovals } = await import('@/lib/db/queries/agent');
    const rows = await getPendingApprovals();
    return rows.map((r) => ({
      id: r.id,
      agentEventId: r.agent_event_id ?? '',
      actionType: r.action_type,
      actionInput: r.action_input,
      agentReasoning: r.agent_reasoning ?? undefined,
      urgency: r.urgency as ApprovalRequest['urgency'],
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      status: r.status as ApprovalRequest['status'],
    }));
  } catch {
    return [];
  }
}

/**
 * Compute current US market status based on ET hours.
 * Pre-market 4-9:30 AM, Open 9:30 AM-4 PM, After-hours 4-8 PM, Overnight otherwise.
 */
function getMarketStatus(): string {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const etDate = new Date(etStr);
  const hours = etDate.getHours();
  const minutes = etDate.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  const day = etDate.getDay();

  // Weekend
  if (day === 0 || day === 6) return 'closed';

  if (totalMinutes >= 240 && totalMinutes < 570) return 'pre-market'; // 4:00-9:30
  if (totalMinutes >= 570 && totalMinutes < 960) return 'open'; // 9:30-16:00
  if (totalMinutes >= 960 && totalMinutes < 1200) return 'after-hours'; // 16:00-20:00
  return 'overnight';
}

async function handleStream(request: Request): Promise<Response> {
  // Phase 13 Tier 1 — auth gate. Pre-Tier-1 this SSE route was unauth
  // and would stream the full agent response (with embedded tool-call
  // markers and citation chains) to any caller. Now require session.
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Phase 13 Tier 3 — Anthropic daily-spend hard cap. Same guardrail as
  // /api/agent/invoke; stream is even more expensive per call (Sonnet
  // multi-turn tool-use), so this is the higher-leverage block point.
  const spend = await checkAnthropicDailySpend();
  if (!spend.allowed && spend.reason === 'cap_exceeded') {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'daily_spend_cap_exceeded',
        estimatedSpend24hUsd: spend.estimatedSpend24hUsd,
        capUsd: spend.capUsd,
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // Best-effort audit before opening the stream. The SSE machinery
  // below logs the failed/completed event separately; this row gives
  // us a "stream opened" anchor for incident review.
  void recordAudit({
    action: AUDIT_ACTIONS.AGENT_STREAM_OPENED,
    outcome: 'success',
    actorId: actorEmail,
    actorIp: getClientIp(request),
    targetKind: 'agent_event',
  });

  try {
    const body = await request.json();
    const {
      task: rawTask,
      userId,
      recentMessages,
      responseMode,
      focusAreas,
      channelId,
      engagementLevel,
      companionMode,
      captionText,
      switchIntent,
      geoIntent,
      sourcePanel: bodySourcePanel,
      dataType: bodyDataType,
      mapContext: bodyMapContext,
      youtubeVideoId,
      attachmentIds,
      lockedMode: bodyLockedMode,
      sessionMedia: bodySessionMedia,
    } = body as {
      task: string;
      userId?: string;
      recentMessages?: { role: string; content: string }[];
      responseMode?: 'concise' | 'standard';
      focusAreas?: string[];
      channelId?: string;
      engagementLevel?: 'focused' | 'active' | 'idle';
      companionMode?: boolean;
      captionText?: string;
      switchIntent?: boolean;
      geoIntent?: boolean;
      sourcePanel?: string;
      dataType?: string;
      mapContext?: Record<string, unknown>;
      youtubeVideoId?: string;
      attachmentIds?: string[];
      lockedMode?: AgentMode | null;
      sessionMedia?: unknown;
    };

    // Companion mode: inject conversational co-watching prompt
    // TV-focused hint: when engagement is focused, give agent permission to answer from context first
    // Switch intent: inject a direct instruction to call tv_switch_channel
    const switchHint =
      "\n\n[System: The user wants to switch channels. Call tv_switch_channel with the requested channel name. Do NOT just describe the channel — you must call the tool to actually change it. After the switch succeeds, briefly describe what is currently airing on the new channel based on the tool result's nowPlaying context.]";
    const geoHint =
      '\n\n[System: The user is asking about a specific geographic location. You MUST call map_fly_to with the location name to navigate the map there FIRST, then answer their question. Do NOT skip the map navigation.]';
    const task = switchIntent
      ? `${rawTask}${switchHint}`
      : geoIntent && bodyDataType !== 'map_location'
        ? `${rawTask}${geoHint}`
        : companionMode && youtubeVideoId
          ? `${rawTask}\n\n[System: You are co-watching a YouTube video with the user. Be conversational and brief — 2-4 sentences. No SITREP format or headers. Focus on the video content based on the ACTIVE YOUTUBE VIDEO context in your system prompt. If the user asks "what's on", describe the YouTube video they're watching — not a livestream channel. After answering, invite follow-up — e.g., "Want me to dig into that topic?" or "Want to find similar videos?" Keep the conversation flowing naturally.]`
          : companionMode
            ? `${rawTask}\n\n[System: You are co-watching a livestream with the user. Be conversational and brief — 2-4 sentences. No SITREP format or headers. Focus on what the channel is currently covering based on the ACTIVE LIVESTREAM context in your system prompt. Prioritize the freshest signals (live page updates, recent headlines). If the user asks to switch channels, use the tv_switch_channel tool immediately. After answering, invite follow-up — e.g., "Want me to look into that story?" or "Anything specific on screen you want to explore?" Keep the conversation flowing naturally.]`
            : engagementLevel === 'focused' && channelId
              ? `${rawTask}\n\n[System: This is a TV-focused question. Answer from the ACTIVE LIVESTREAM context first. You may use 1-2 tools for enrichment if relevant, but prioritize speed and the channel's current coverage. If the user asks to switch/change/tune channels, use tv_switch_channel immediately — do not just describe the channel.]`
              : rawTask;

    if (!task) {
      return new Response(JSON.stringify({ error: 'Task is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requestedAttachmentIds = Array.isArray(attachmentIds)
      ? [...new Set(attachmentIds)].filter((id): id is string => typeof id === 'string')
      : [];
    if (requestedAttachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      return new Response(JSON.stringify({ error: 'too_many_attachments' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (requestedAttachmentIds.some((id) => !isUuid(id))) {
      return new Response(JSON.stringify({ error: 'invalid_attachment_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const attachmentRows =
      requestedAttachmentIds.length > 0
        ? await getAttachmentsForOwner({ ids: requestedAttachmentIds, ownerEmail: actorEmail })
        : [];
    if (attachmentRows.length !== requestedAttachmentIds.length) {
      return new Response(JSON.stringify({ error: 'attachment_not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const notReadyAttachments = attachmentRows.filter(
      (attachment) => attachment.status !== 'ready',
    );
    if (notReadyAttachments.length > 0) {
      return new Response(
        JSON.stringify({
          error: 'attachments_not_ready',
          attachments: notReadyAttachments.map(toAttachmentSummary),
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Extract panel context from <context> tag or from top-level body fields
    const panelCtx =
      extractPanelContext(task) ??
      (bodySourcePanel
        ? { sourcePanel: bodySourcePanel, dataType: bodyDataType ?? '', trendData: {} }
        : null);

    // Reverse geocode map click coordinates (best-effort, in parallel with other loads)
    const reverseGeoPromise: Promise<string | null> =
      panelCtx && (panelCtx.dataType === 'map_location' || panelCtx.dataType === 'map_poi')
        ? (async () => {
            const clickLat = panelCtx.trendData.lat as number | undefined;
            const clickLon = panelCtx.trendData.lon as number | undefined;
            if (clickLat == null || clickLon == null) return null;
            try {
              const { geocodeReverse } = await import('@/lib/mapbox/geocode-api');
              const geo = await geocodeReverse(clickLat, clickLon);
              return geo?.name ?? null;
            } catch {
              return null;
            }
          })()
        : Promise.resolve(null);

    const [recentBriefs, activeAlerts, pendingApprovals, clickCorrelation, reverseGeoAddress] =
      await Promise.all([
        loadRecentBriefs(),
        loadActiveAlerts(),
        loadPendingApprovals(),
        panelCtx?.sourcePanel
          ? correlateClickContext(panelCtx.sourcePanel, panelCtx.dataType, panelCtx.trendData)
          : Promise.resolve(''),
        reverseGeoPromise,
      ]);

    // Resolve YouTube video context when youtubeVideoId is provided (best-effort)
    let tvContext: AgentContext['tvContext'] | undefined;
    if (youtubeVideoId) {
      try {
        const { assembleTvContext } = await import('@/lib/data/collectors/tv-context');
        const tv = await assembleTvContext('youtube-search', { videoId: youtubeVideoId });
        if (tv) {
          tvContext = {
            channelId: 'youtube-search',
            channelLabel: tv.channelLabel,
            category: tv.category,
            description: tv.description,
            videoMeta: tv.videoMeta,
            recentHeadlines: [],
            isLive: false,
            channelHeadlines: [],
            livePage: null,
            videoMetaChange: null,
            ccSummary: null,
            previousChannelSummary: null,
            rawCaptionTail: null,
          };
        }
      } catch {
        // YouTube video context is best-effort
      }
    }

    // Resolve TV context when channelId is provided (best-effort, never blocks)
    // Skip TV context for switch queries — the agent doesn't need captions/headlines to switch
    if (!tvContext && channelId && !switchIntent) {
      try {
        const { assembleTvContext } = await import('@/lib/data/collectors/tv-context');
        const { scrapeNetworkPage } = await import('@/lib/data/collectors/network-scraper');
        const { resolveChannelConfig } = await import('@/lib/data/livestream-channels');
        const channel = resolveChannelConfig().find((c) => c.id === channelId);

        // Run TV context assembly, on-demand caption summarization, and fresh scrape in parallel
        const [tv, freshCcSummary, freshLivePage] = await Promise.all([
          assembleTvContext(channelId, engagementLevel),
          captionText ? summarizeCaptionsOnDemand(channelId, captionText) : Promise.resolve(null),
          // Fresh network scrape when focused — bypasses 180s cache for latest content
          engagementLevel === 'focused' && channel?.livePageUrl
            ? scrapeNetworkPage(channelId, channel.livePageUrl, true)
            : Promise.resolve(null),
        ]);

        if (tv) {
          tvContext = {
            channelId: tv.channelId,
            channelLabel: tv.channelLabel,
            category: tv.category,
            description: tv.description,
            videoMeta: tv.videoMeta,
            recentHeadlines: tv.recentHeadlines.map((h) => ({
              title: h.title,
              source: h.source,
              publishedAt: h.publishedAt,
            })),
            isLive: tv.isLive,
            channelHeadlines: tv.channelHeadlines,
            // Override livePage with fresh scrape if available
            livePage: freshLivePage ?? tv.livePage,
            videoMetaChange: tv.videoMetaChange,
            // Override ccSummary with fresh on-demand summary if available
            ccSummary: freshCcSummary ?? tv.ccSummary,
            previousChannelSummary: tv.previousChannelSummary,
            // Include raw caption tail for exact wording
            rawCaptionTail: captionText?.slice(-2000) ?? null,
          };
        }
      } catch {
        // TV context is best-effort
      }
    }

    // Inject correlation data and reverse geocode address into the task
    const addressHint = reverseGeoAddress
      ? `\n\n[System: Reverse geocode for clicked point: "${reverseGeoAddress}". Use this as the primary location identifier for your analysis.]`
      : '';
    const enrichedTask = `${clickCorrelation ? `${task}${clickCorrelation}` : task}${addressHint}`;
    const messageContent =
      attachmentRows.length > 0
        ? await buildAttachmentContentBlocks({ task: enrichedTask, attachments: attachmentRows })
        : undefined;

    const sessionMedia = sanitizeSessionMedia(bodySessionMedia);

    const context: AgentContext = {
      marketStatus: getMarketStatus(),
      activeAlerts,
      pendingApprovals,
      recentBriefs,
      user: {
        id: userId ?? 'anonymous',
        focusAreas: focusAreas ?? [],
        preferences: {},
      },
      tvContext,
      ...(sessionMedia.length > 0 ? { sessionMedia } : {}),
    };

    // Set viewport context for spatial intelligence tools
    if (bodyMapContext?.features) {
      setViewportContext(
        bodyMapContext as unknown as import('@/lib/mapbox/viewport-features').ViewportSnapshot,
      );
    }

    // Phase 14 — resolve the effective posture mode for this turn. AUTO when
    // no lock; honors the user-locked floor with single-turn upward escalation
    // on Mode 3 keywords / Mode 2 keywords / panel-clicks / critical+KEV signals.
    // See computeEffectiveMode for the full priority order.
    //
    // Phase 14.5 (code-review fixes #2, #3):
    //   - parseLockedMode validates the wire-format `lockedMode` so bogus input
    //     (typo, stale client, attacker) cannot reach MODE_TOOL_BUDGET as an
    //     invalid key and produce a NaN turn cap.
    //   - The keyword sniff runs against the user message with any embedded
    //     <context>{...}</context> JSON stripped — KEV/CVE trendData routinely
    //     contains the words "patch" / "mitigation" / "Sigma" / etc., which
    //     would false-escalate Mode 3 on every panel click otherwise.
    const userMessageForSniff = (rawTask ?? '').replace(/<context>[\s\S]*?<\/context>/g, '');
    const effectiveMode = computeEffectiveMode({
      lockedMode: parseLockedMode(bodyLockedMode),
      userMessage: userMessageForSniff,
      panelContext: typeof bodySourcePanel === 'string' && bodySourcePanel.length > 0,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const generator = streamAgent({
            trigger: 'user',
            context,
            task: enrichedTask,
            messageContent,
            userId: userId ?? 'anonymous',
            operatorEmail: actorEmail,
            stream: true,
            responseMode: responseMode ?? 'standard',
            signal: request.signal,
            origin: companionMode ? 'companion' : 'agent',
            recentMessages,
            effectiveMode,
            ...(switchIntent
              ? { toolChoice: { type: 'tool' as const, name: 'tv_switch_channel' } }
              : geoIntent && bodyDataType !== 'map_location'
                ? { toolChoice: { type: 'tool' as const, name: 'map_fly_to' } }
                : {}),
          });

          for await (const chunk of generator) {
            if (request.signal.aborted) {
              controller.close();
              return;
            }
            const data = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch {
          const errorData = `data: ${JSON.stringify({ type: 'error', data: 'Stream failed; check private server logs.' })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        } finally {
          setViewportContext(null);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Stream failed; check private server logs.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Phase 13 Tier 3 — Per-user rate-limit on SSE stream. Keyed off email.
// 20 calls/min lets a focused analyst ask roughly one question every 3
// seconds sustained; well above normal interactive cadence + below
// runaway-loop range. Async-key wrapper pattern matches /api/twitter/post.
async function streamBucketKey(req: Request): Promise<string> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) return `agent-stream:user:${email.toLowerCase()}`;
  } catch {
    // fall through
  }
  return `agent-stream:ip:${getClientIp(req)}`;
}

async function POST_handler(request: Request): Promise<Response> {
  const key = await streamBucketKey(request);
  const limited = withRateLimit(handleStream, {
    key,
    limit: 20,
    windowMs: 60_000,
  });
  return limited(request);
}

async function summarizeCaptionsOnDemand(
  channelId: string,
  captionText: string,
): Promise<{ text: string; windowStart: string; windowEnd: string; captionCount: number } | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { resolveChannelConfig } = await import('@/lib/data/livestream-channels');
    const channel = resolveChannelConfig().find((c) => c.id === channelId);
    if (!channel) return null;

    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const now = new Date().toISOString();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:
        'Summarize closed caption text from a live broadcast into a <200 word digest. Focus on: the specific story/segment being discussed RIGHT NOW, named entities (people, companies, countries), key claims or statements being made, and any breaking developments. Use present tense. Be specific about what is currently being said on air.',
      messages: [
        {
          role: 'user',
          content: `Channel: ${channel.label} (${channel.category})\nCaption window: last ~30 seconds (on-demand flush)\nRaw captions:\n\n${captionText.slice(0, 5000)}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      text: textBlock?.text ?? '',
      windowStart: now,
      windowEnd: now,
      captionCount: captionText.split(/\s+/).length,
    };
  } catch {
    return null;
  }
}

export const POST = withRoutePolicy('/api/agent/stream', POST_handler);
