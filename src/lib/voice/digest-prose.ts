import { budgetedAIFetch } from '@/lib/security/budget';
/**
 * One LLM call per daily digest that voices the masthead prose slots (hero +
 * takeaway) in the shared register. Amortized across all recipients (the
 * digest builder calls this ONCE, before the per-recipient send loop) and
 * entirely off the time-sensitive per-alert path.
 *
 * Fail-soft is the contract: no API key, a timeout, an SDK error, or
 * unparseable output all return the deterministic fallback (empty hero so the
 * template keeps its static masthead + `pickWireTakeaway`). The digest must
 * never block on this.
 */

import Anthropic from '@anthropic-ai/sdk';
import { extractJsonObject } from '@/lib/utils/tolerant-json';
import { pickWireTakeaway } from './index';
import { SURFACE_CALIBRATION, VOICE_REGISTER } from './register';

const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
const TIMEOUT_MS = 20_000;
const MAX_TOKENS = 300;

export interface DigestProseInput {
  dateLabel: string;
  cves: Array<{ cveId: string; severity: string | null; vendor?: string | null; isKev?: boolean }>;
  kevAdds: Array<{ cveId: string; vulnerabilityName?: string | null }>;
  breaches: Array<{ organization?: string | null; recordsCompromised?: number | null }>;
}

export interface DigestProse {
  /** 1-2 sentence voiced intro. '' => the template keeps its static masthead. */
  hero: string;
  /** One wry takeaway line, or null on a quiet day. */
  takeaway: string | null;
}

export async function generateDigestProse(input: DigestProseInput): Promise<DigestProse> {
  const fallback: DigestProse = {
    hero: '',
    takeaway: pickWireTakeaway({
      cveCount: input.cves.length,
      kevCount: input.kevAdds.length,
      breachCount: input.breaches.length,
    }),
  };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const system = [
      VOICE_REGISTER,
      '',
      `SURFACE: email digest. ${SURFACE_CALIBRATION.email}`,
      '',
      'Write ONLY two things for the daily digest masthead: a 1-2 sentence hero intro that names what actually happened today (not its category), and one wry takeaway line aimed at the industry pattern (never a named victim). No CVSS dumps — the data rows below the masthead carry the numbers. No emoji, no exclamation marks, no "BREAKING".',
      'Output STRICT JSON only — the first character of your response must be "{": {"hero":"…","takeaway":"…"}.',
    ].join('\n');

    const user = [
      `Date: ${input.dateLabel}`,
      `Critical CVEs (${input.cves.length}): ${
        input.cves
          .map((c) => `${c.cveId}${c.vendor ? ` (${c.vendor})` : ''}${c.isKev ? ' [KEV]' : ''}`)
          .join(', ') || 'none'
      }`,
      `New KEV adds (${input.kevAdds.length}): ${input.kevAdds.map((k) => k.cveId).join(', ') || 'none'}`,
      `Breaches (${input.breaches.length}): ${
        input.breaches
          .map(
            (b) =>
              `${b.organization ?? 'undisclosed'}${b.recordsCompromised ? ` (${b.recordsCompromised} records)` : ''}`,
          )
          .join(', ') || 'none'
      }`,
    ].join('\n');

    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const response = await client.messages.create(
      { model: MODEL, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: user }] },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const textBlock = response.content.find((b) => b.type === 'text');
    const obj = extractJsonObject(textBlock?.text ?? '') as Record<string, unknown> | null;
    if (!obj) return fallback;

    const hero = typeof obj.hero === 'string' ? obj.hero.trim() : '';
    const takeaway =
      typeof obj.takeaway === 'string' && obj.takeaway.trim()
        ? obj.takeaway.trim()
        : fallback.takeaway;
    return { hero, takeaway };
  } catch {
    clearTimeout(timeout);
    return fallback;
  }
}
