import { budgetedAIFetch } from '@/lib/security/budget';
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { formatXPrimaryPostText } from '@/lib/twitter/formatting';
import {
  buildXPublishPackage,
  fitLongform,
  scrubLlmPrimaryText,
  type XPublishPackage,
} from '@/lib/twitter/publish-package';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';
import { SURFACE_CALIBRATION, VOICE_REGISTER } from '@/lib/voice/register';
import { X_LONGFORM_MAX_LENGTH } from './length';

const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
// max_tokens is a ceiling, not a target — short findings still generate short
// posts fast; only a rich, faithful recap runs long (X allows 25k chars).
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 8_000;
// How much of Max's response reaches the model — generous so a full multi-section
// SITREP is rendered faithfully rather than truncated mid-analysis.
const MAX_RESPONSE_CHARS = 24_000;

const X_PACKAGE_TOOL: Anthropic.Tool = {
  name: 'emit_x_package',
  description: "Return the two-post X package built from Max's response.",
  input_schema: {
    type: 'object',
    properties: {
      primaryText: {
        type: 'string',
        description: "Post 1 — the long-form story post, in Max's voice, mirroring his structure.",
      },
      replyText: {
        type: 'string',
        description: 'Reply — concise source-trail prose that pairs with the infographic.',
      },
    },
    required: ['primaryText', 'replyText'],
  },
};

interface BuildXPublishPackageLlmInput {
  messageContent: string;
  sourceContext?: VisualBriefSourceContext | null;
  fallbackSourceUrl?: string;
}

export type XPublishPackageDraftSource = 'llm' | 'fallback';

export interface XPublishPackageWithSource extends XPublishPackage {
  draftedBy: XPublishPackageDraftSource;
}

export async function buildXPublishPackageWithLlm(
  input: BuildXPublishPackageLlmInput,
): Promise<XPublishPackageWithSource> {
  const fallback = buildXPublishPackage(input);
  if (!process.env.ANTHROPIC_API_KEY) return { ...fallback, draftedBy: 'fallback' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        tools: [X_PACKAGE_TOOL],
        tool_choice: { type: 'tool', name: X_PACKAGE_TOOL.name },
        messages: [{ role: 'user', content: buildUserPrompt(input, fallback) }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const parsed = packageFromToolUse(response, fallback);
    return parsed ? { ...parsed, draftedBy: 'llm' } : { ...fallback, draftedBy: 'fallback' };
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[twitter/compose] falling back to deterministic X package:', err);
    return { ...fallback, draftedBy: 'fallback' };
  }
}

function buildSystemPrompt(): string {
  return `You write the editable default X post copy for the configured X account. ${AGENT_IDENTITY.name} is the writer.

${VOICE_REGISTER}

Surface calibration: ${SURFACE_CALIBRATION.twitter}

This is a SINGLE long-form X post, not a thread — apply the register's tone and diction to one cohesive post; ignore per-tweet/threading guidance.

Your job is to render ${AGENT_IDENTITY.name}'s supplied response into a publishable X post — faithfully, in his voice:
- MIRROR the structure and scope of his response. If he wrote 15 numbered points, write 15 points; if flowing prose, keep prose; if a single subject, a single subject. Do NOT impose a hook/BLUF/numbered/operator-take skeleton he didn't use.
- Preserve his SPECIFIC thesis and the so-what — the actual angle he took, not a generic "check your stack" line.
- Weave technical detail (CVSS, EPSS, MITRE techniques, version ranges, affected products) in as SUPPORTING evidence, not a data dump.
- Calibrate wit to the topic: wittier on markets and soft topics, sober and restrained on active or critical threats. Never flippant about a live vulnerability or a named victim.
- Keep every fact precise — CVE IDs, scores, vendor names, timestamps, numbers all stay exact.
- Strip internal process language entirely: no "MODE N" headers, "pulling"/"in parallel"/tool chatter, AEGIS notes, or conversational lead-ins ("Let me…", "Here's the full picture").
- No emojis, no "BREAKING", no all-caps urgency.
- Size to the material — X is long-form (up to ${X_LONGFORM_MAX_LENGTH} characters). Don't pad a thin input; don't compress a rich one. Never exceed ${X_LONGFORM_MAX_LENGTH} characters.

Reply (post 2): concise source-trail prose that pairs with an infographic. Use only the public source links provided; do not invent URLs.

Call emit_x_package with primaryText (post 1) and replyText (the reply).`;
}

function buildUserPrompt(input: BuildXPublishPackageLlmInput, fallback: XPublishPackage): string {
  return `Public source URLs allowed:
${fallback.sourceUrls.map((url, index) => `${index + 1}. ${url}`).join('\n') || 'none'}

Source context:
${JSON.stringify(input.sourceContext ?? null).slice(0, 3_000)}

${AGENT_IDENTITY.name} response (render THIS faithfully into the post):
${input.messageContent.slice(0, MAX_RESPONSE_CHARS)}`;
}

function packageFromToolUse(
  response: Anthropic.Message,
  fallback: XPublishPackage,
): XPublishPackage | null {
  const block = response.content.find((b) => b.type === 'tool_use');
  if (block?.type !== 'tool_use') return null;
  const out = block.input as { primaryText?: unknown; replyText?: unknown };
  if (typeof out.primaryText !== 'string' || typeof out.replyText !== 'string') return null;

  // Scrub internal/process tokens (MODE N, BREAKING…) without discarding the
  // draft, then mirror-format. Fall back only if nothing usable survives.
  const primaryText = formatXPrimaryPostText(scrubLlmPrimaryText(out.primaryText));
  const replyText = fitLongform(out.replyText);
  if (!primaryText || !replyText) return null;
  if (primaryText.length > X_LONGFORM_MAX_LENGTH || replyText.length > X_LONGFORM_MAX_LENGTH) {
    return null;
  }

  return {
    primaryText,
    replyText: ensureSourceTrail(replyText, fallback.sourceUrls),
    sourceUrl: fallback.sourceUrl,
    sourceUrls: fallback.sourceUrls,
  };
}

function ensureSourceTrail(replyText: string, sourceUrls: string[]): string {
  let out = replyText.trim();
  for (const url of sourceUrls.slice(0, 3)) {
    if (!out.includes(url)) out = `${out}\n${url}`;
  }
  return fitLongform(out);
}
