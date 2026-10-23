import { query } from '@/lib/db/client';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
import { composeRssBlurb } from '@/lib/voice';

/**
 * GET /feed/cyber-wire.rss
 *
 * Public RSS 2.0 feed of AEGIS-triaged AI-cyber alerts. Pairs with the
 * editorial HTML landing at /feed/cyber-wire (same data, different
 * serialization).
 *
 * Phase 9.6 narrowing: default query filters to
 * `(ai_relevance >= 0.5 OR severity = 'critical')` so the public surface
 * commits to AI-cyber. The `?include=all` query parameter restores the
 * pre-Phase-9 broad-cyber view for archive use (not indexed — RSS
 * subscribers picking up the canonical feed never see the broader stream
 * unless they explicitly request it).
 */
export const dynamic = 'force-dynamic';

type AlertRow = {
  id: number;
  alert_type: string;
  entity_kind: string | null;
  entity_id: string | null;
  severity: string;
  headline: string;
  summary: string | null;
  published_at: string;
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3002';

export async function GET(request: Request) {
  if (!isCapabilityEnabled('publicFeed')) return new Response('Not found', { status: 404 });
  const includeAll = new URL(request.url).searchParams.get('include') === 'all';

  let items: AlertRow[] = [];
  try {
    const result = includeAll
      ? await query<AlertRow>(
          // Archive view — broad cyber, pre-Phase-9 behavior. Available via
          // ?include=all for subscribers who want the full critical+high stream.
          `SELECT id, alert_type, entity_kind, entity_id, severity, headline,
                  summary, published_at::text
           FROM aegis_pipeline_alerts
           WHERE severity IN ('critical', 'high')
           ORDER BY published_at DESC NULLS LAST, id DESC
           LIMIT 50`,
        )
      : await query<AlertRow>(
          // Canonical AI-cyber narrowing — what subscribers get by default.
          // Reads ai_relevance directly off the alert row (Phase 9.0 ALTER).
          // COALESCE so unscored rows (NULL) don't sneak through; only
          // ai_relevance>=0.5 OR severity=critical reach the public feed.
          `SELECT id, alert_type, entity_kind, entity_id, severity, headline,
                  summary, published_at::text
           FROM aegis_pipeline_alerts
           WHERE (COALESCE(ai_relevance, 0) >= 0.5 OR severity = 'critical')
           ORDER BY published_at DESC NULLS LAST, id DESC
           LIMIT 50`,
        );
    items = result.rows;
  } catch {
    // Fail soft — return an empty feed rather than 500
  }

  // De-dupe by headline (seed re-apply leaves duplicates)
  const seen = new Set<string>();
  items = items.filter((a) => {
    if (seen.has(a.headline)) return false;
    seen.add(a.headline);
    return true;
  });

  const xml = renderRss(items);

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=600',
    },
  });
}

function renderRss(items: AlertRow[]): string {
  const now = new Date().toUTCString();
  const feedUrl = `${SITE_URL}/feed/cyber-wire.rss`;
  const siteUrl = `${SITE_URL}/feed/cyber-wire`;

  const itemsXml = items
    .map((item, idx) => {
      const link = buildItemLink(item);
      const pubDate = new Date(item.published_at).toUTCString();
      const guid = `cocoa-cw:${item.id}`;
      // Voice the description from the shared spec (no LLM). The lead item gets
      // an atmospheric frame; later items stay closer to the bare summary, per
      // the SOUL.md Cyber Wire calibration (full register on the masthead/lead).
      const description = composeRssBlurb(
        {
          severity: item.severity,
          alertType: item.alert_type,
          summary: item.summary,
          headline: item.headline,
        },
        { lead: idx === 0 },
      );
      return `    <item>
      <title>${escapeXml(item.headline)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${escapeXml(item.severity.toUpperCase())}</category>
      <category>${escapeXml(item.alert_type)}</category>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Cocoa AI · AI Cyber Wire</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>AEGIS-triaged AI-cyber intelligence brief. Prompt injection, LLM jailbreaks, model-weight exfiltration, agentic-system safety, AI-vendor incidents, autonomous offensive AI. Plus critical general-cyber surfacing as context.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>Cocoa AI Threat Deck (AEGIS)</generator>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${itemsXml}
  </channel>
</rss>
`;
}

function buildItemLink(item: AlertRow): string {
  const base = `${SITE_URL}/feed/cyber-wire`;
  if (!item.entity_kind || !item.entity_id) return base;
  // Deep-link to the AEGIS HTML viewer for this entity
  if (item.entity_kind === 'cve')
    return `${SITE_URL}/api/aegis/cves/view?id=${encodeURIComponent(item.entity_id)}`;
  if (item.entity_kind === 'kev')
    return `${SITE_URL}/api/aegis/kev/view?id=${encodeURIComponent(item.entity_id)}`;
  if (item.entity_kind === 'incident')
    return `${SITE_URL}/api/aegis/incidents/view?id=${encodeURIComponent(item.entity_id)}`;
  return base;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
