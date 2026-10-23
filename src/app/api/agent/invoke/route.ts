import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 13 Tier 1 — admin-only auth on an orphan route.
 *
 * /api/agent/invoke is the non-streaming agent invocation entry point.
 * `grep -rn '/api/agent/invoke'` returns zero in-app callers — the
 * dashboard's agent surface uses /api/agent/stream (SSE) exclusively.
 *
 * The route stays for back-compat / scripted operator use, but we gate it
 * to ADMIN-only (subset of ALLOWED_EMAILS via a new ADMIN_EMAILS env var)
 * because the cost-per-call is high (Sonnet invocation) and the route
 * accepts arbitrary task strings.
 *
 * If ADMIN_EMAILS is unset, the route falls back to "any authenticated
 * user is admin" — sane single-tenant default.
 *
 * Tier 4 may remove this route entirely after 2 weeks of zero usage.
 */

import { NextResponse } from 'next/server';
import { buildAttachmentContentBlocks } from '@/lib/agent/attachments/context';
import {
  isUuid,
  MAX_ATTACHMENTS_PER_MESSAGE,
  toAttachmentSummary,
} from '@/lib/agent/attachments/validation';
import { invokeAgent } from '@/lib/agent/client';
import { registerAllTools } from '@/lib/agent/tools';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { completeAgentEvent, insertAgentEvent } from '@/lib/db/queries/agent';
import { getAttachmentsForOwner } from '@/lib/db/queries/attachments';
import { checkAnthropicDailySpend } from '@/lib/security/anthropic-spend';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import type { AgentContext } from '@/lib/types';

// Register tools on first import
registerAllTools();

function isAdmin(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw || raw.trim().length === 0) {
    // Single-tenant fallback: every authenticated user is an admin.
    return true;
  }
  const allowed = new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(email.toLowerCase());
}

async function handleInvoke(request: Request): Promise<NextResponse> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdmin(actorEmail)) {
    return NextResponse.json({ ok: false, error: 'admin_only' }, { status: 403 });
  }

  // Phase 13 Tier 3 — Anthropic daily-spend hard cap. Fails closed if
  // we've already burned the configured budget in the trailing 24h.
  const spend = await checkAnthropicDailySpend();
  if (!spend.allowed && spend.reason === 'cap_exceeded') {
    return NextResponse.json(
      {
        ok: false,
        error: 'daily_spend_cap_exceeded',
        estimatedSpend24hUsd: spend.estimatedSpend24hUsd,
        capUsd: spend.capUsd,
      },
      { status: 429 },
    );
  }

  let body: {
    task?: string;
    userId?: string;
    trigger?: 'event' | 'schedule' | 'user';
    attachmentIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { task, trigger = 'user' } = body;
  // Override caller-supplied userId with the authenticated email — no
  // body field can attribute the call to a different identity.
  const callerUserId = actorEmail;

  if (!task || task.length === 0) {
    return NextResponse.json({ error: 'Task is required' }, { status: 400 });
  }
  if (task.length > 10_000) {
    return NextResponse.json({ error: 'task exceeds 10K characters' }, { status: 400 });
  }

  const requestedAttachmentIds = Array.isArray(body.attachmentIds)
    ? [...new Set(body.attachmentIds)].filter((id): id is string => typeof id === 'string')
    : [];
  if (requestedAttachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json({ error: 'too_many_attachments' }, { status: 400 });
  }
  if (requestedAttachmentIds.some((id) => !isUuid(id))) {
    return NextResponse.json({ error: 'invalid_attachment_id' }, { status: 400 });
  }

  const attachmentRows =
    requestedAttachmentIds.length > 0
      ? await getAttachmentsForOwner({ ids: requestedAttachmentIds, ownerEmail: actorEmail })
      : [];
  if (attachmentRows.length !== requestedAttachmentIds.length) {
    return NextResponse.json({ error: 'attachment_not_found' }, { status: 404 });
  }
  const notReadyAttachments = attachmentRows.filter((attachment) => attachment.status !== 'ready');
  if (notReadyAttachments.length > 0) {
    return NextResponse.json(
      {
        error: 'attachments_not_ready',
        attachments: notReadyAttachments.map(toAttachmentSummary),
      },
      { status: 409 },
    );
  }

  try {
    const context: AgentContext = {
      marketStatus: getMarketStatus(),
      activeAlerts: [],
      pendingApprovals: [],
      recentBriefs: [],
      user: {
        id: callerUserId,
        focusAreas: [],
        preferences: {},
      },
    };

    let eventId: string | undefined;
    try {
      eventId = await insertAgentEvent({
        triggerType: trigger,
        task,
        model: process.env.AGENT_MODEL ?? 'claude-sonnet-4-6',
        userId: callerUserId,
      });
    } catch {
      // DB may not be available
    }

    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_INVOKE_REQUESTED,
      outcome: 'success',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_event',
      targetId: eventId ?? 'unknown',
      details: { trigger, taskLength: task.length },
    });

    const result = await invokeAgent({
      trigger,
      context,
      task,
      messageContent:
        attachmentRows.length > 0
          ? await buildAttachmentContentBlocks({ task, attachments: attachmentRows })
          : undefined,
      userId: callerUserId,
      operatorEmail: actorEmail,
    });

    if (eventId) {
      try {
        await completeAgentEvent({
          id: eventId,
          toolCalls: result.toolCalls,
          responseText: result.text,
          tokensInput: result.tokensInput ?? 0,
          tokensOutput: result.tokensOutput ?? 0,
          durationMs: result.durationMs ?? 0,
        });
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({
      text: result.text,
      toolCalls: result.toolCalls,
      model: result.model,
      eventId,
      durationMs: result.durationMs,
    });
  } catch (err) {
    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_INVOKE_FAILED,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_event',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error('[Agent Invoke Error]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Agent invocation failed' },
      { status: 500 },
    );
  }
}

// Phase 13 Tier 3 — Per-user rate-limit. Keyed off authenticated email
// (admin-only route, so we have a session). 5 calls per minute per user
// caps the Sonnet-burn worst case at ~$16/hr per user.
//
// withRateLimit's `key` is sync (`string | (req) => string`). Because we
// need to await auth() to resolve the user identity, we use the async-
// key-via-wrapper pattern from /api/twitter/post: resolve the bucket key
// up-front, then construct + invoke a rate-limited handler.
async function bucketKey(req: Request): Promise<string> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) return `agent-invoke:user:${email.toLowerCase()}`;
  } catch {
    // Session lookup failed — fall through to IP key.
  }
  return `agent-invoke:ip:${getClientIp(req)}`;
}

async function POST_handler(request: Request): Promise<Response> {
  const key = await bucketKey(request);
  const limited = withRateLimit(handleInvoke, {
    key,
    limit: 5,
    windowMs: 60_000,
  });
  return limited(request);
}

function getMarketStatus(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = et.getHours();
  const minute = et.getMinutes();
  const day = et.getDay();

  if (day === 0 || day === 6) return 'closed (weekend)';
  if (hour < 4) return 'closed (overnight)';
  if (hour < 9 || (hour === 9 && minute < 30)) return 'pre-market';
  if (hour < 16) return 'open';
  if (hour < 20) return 'after-hours';
  return 'closed';
}

export const POST = withRoutePolicy('/api/agent/invoke', POST_handler);
