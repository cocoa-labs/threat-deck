import { safeLink } from '@/lib/security/safe-link';
/**
 * Phase 13 Tier 5 — AgentResponseEmail template. Wraps a live agent SITREP
 * response in the CRT-aesthetic chrome (brand masthead, severity
 * stripe, matrix-green accents) and ships it to the operator's inbox via
 * the EMAIL ME button in the AgentDrawer footer.
 *
 * Three jobs:
 *   1. Carry the cyber-thriller voice register (from agent/SOUL.md) all the
 *      way to inbox — header chrome + Markdown-faithful body + footer.
 *   2. Show the Twitter distillation alongside the full response, so the
 *      operator can validate both the long-form and the compressed-for-X
 *      versions of the same content in one inbox visit.
 *   3. Give the operator a one-click back-link to the dashboard for context.
 *
 * Structurally mirrors KEVAddedAlert.tsx (brand masthead + severity
 * stripe + content sections) but the body is rendered by the
 * agent-response-renderer rather than data-driven from a CVE row.
 */

import { Body, Container, Head, Hr, Html, Link, Section, Text } from '@react-email/components';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { renderAgentMarkdown } from '../agent-response-renderer';
import { absoluteUrl, emailTheme, severityColor } from './theme';

export type AgentResponseEmailProps = {
  /** Full Markdown agent response — rendered faithfully into the body. */
  responseText: string;
  /**
   * Optional Twitter-distilled version (~250 chars after Markdown stripped).
   * Shown in a secondary panel so the operator can compare both forms.
   */
  twitterDistillation?: string | null;
  /** 'critical' / 'high' / 'medium' / 'low' — colors the stripe. */
  severity?: string | null;
  /** 'cve' / 'agent_message' / 'kev' / etc. — informs the back-link. */
  alertEntityKind?: string | null;
  /** e.g. 'CVE-2024-1708' — used to deep-link the dashboard back-link. */
  alertEntityId?: string | null;
  /** ISO timestamp when this email was sent. */
  sentAt: string;
};

const styles = {
  body: {
    backgroundColor: emailTheme.bgOuter,
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    margin: 0,
    padding: '24px 0',
  },
  container: {
    backgroundColor: emailTheme.bgCard,
    border: `1px solid ${emailTheme.border}`,
    borderRadius: '4px',
    margin: '0 auto',
    maxWidth: '680px',
    overflow: 'hidden',
  },
  masthead: {
    backgroundColor: emailTheme.brandAccent,
    padding: '12px 24px',
  },
  mastheadText: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.16em',
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  severityStripe: {
    height: '4px',
    width: '100%',
  },
  preamble: {
    padding: '20px 24px 4px',
  },
  preambleLabel: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.18em',
    margin: '0 0 6px',
    textTransform: 'uppercase' as const,
  },
  preambleMeta: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    letterSpacing: '0.04em',
    margin: '0 0 4px',
  },
  body_section: {
    padding: '8px 24px 12px',
  },
  distillationWrap: {
    padding: '8px 24px 4px',
  },
  distillationHeader: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    fontWeight: 700 as const,
    letterSpacing: '0.16em',
    margin: '14px 0 6px',
    textTransform: 'uppercase' as const,
  },
  distillationBox: {
    background: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.matrixGreen}33`,
    borderLeft: `2px solid ${emailTheme.matrixGreen}`,
    borderRadius: '3px',
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    lineHeight: '1.55',
    margin: '0 0 10px',
    padding: '10px 14px',
  },
  distillationFooter: {
    color: emailTheme.textMuted,
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    letterSpacing: '0.06em',
    margin: '4px 0 0',
  },
  cta: {
    backgroundColor: emailTheme.matrixGreen,
    borderRadius: '3px',
    color: emailTheme.bgOuter,
    display: 'inline-block',
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    fontWeight: 700 as const,
    letterSpacing: '0.1em',
    margin: '12px 24px 4px',
    padding: '10px 18px',
    textDecoration: 'none',
    textTransform: 'uppercase' as const,
  },
  hr: {
    border: 'none',
    borderTop: `1px solid ${emailTheme.border}`,
    margin: '20px 0 0',
  },
  footer: {
    color: emailTheme.textMuted,
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    letterSpacing: '0.08em',
    margin: '16px 24px',
    textAlign: 'center' as const,
    textTransform: 'uppercase' as const,
  },
};

/**
 * Resolve the dashboard back-link for the entity referenced in the response.
 * Falls back to the bare dashboard when no entity ID is present.
 */
function backLinkUrl(kind: string | null | undefined, id: string | null | undefined): string {
  if (!id || !kind) return absoluteUrl('/');
  switch (kind.toLowerCase()) {
    case 'cve':
      return absoluteUrl(`/api/aegis/cves/view?id=${encodeURIComponent(id)}`);
    case 'kev':
      return absoluteUrl(`/api/aegis/kev/view?id=${encodeURIComponent(id)}`);
    case 'threat_actor':
      return absoluteUrl(`/api/aegis/threat-actors/view?id=${encodeURIComponent(id)}`);
    case 'incident':
      return absoluteUrl(`/api/aegis/incidents/view?id=${encodeURIComponent(id)}`);
    default:
      return absoluteUrl('/');
  }
}

function formatSentAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Mirror the AgentDrawer's footer timestamp format (locale 24h).
    return d.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function AgentResponseEmail(props: AgentResponseEmailProps): React.ReactElement {
  const stripeColor = severityColor(props.severity ?? null);
  const sentAtDisplay = formatSentAt(props.sentAt);
  const rendered = renderAgentMarkdown(props.responseText);
  const backLink = backLinkUrl(props.alertEntityKind ?? null, props.alertEntityId ?? null);
  const entityChip = props.alertEntityId
    ? `${props.alertEntityKind ?? 'entity'}: ${props.alertEntityId}`
    : 'no entity attached';

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.mastheadText}>Cocoa AI / Threat Deck / {AGENT_IDENTITY.name}</Text>
          </Section>
          <Section style={{ ...styles.severityStripe, backgroundColor: stripeColor }} />

          <Section style={styles.preamble}>
            <Text style={styles.preambleLabel}>{AGENT_IDENTITY.sitrepLabel}</Text>
            <Text style={styles.preambleMeta}>{entityChip}</Text>
            <Text style={styles.preambleMeta}>sent {sentAtDisplay}</Text>
          </Section>

          <Section style={styles.body_section}>{rendered}</Section>

          {props.twitterDistillation && props.twitterDistillation.trim().length > 0 && (
            <Section style={styles.distillationWrap}>
              <Text style={styles.distillationHeader}>Twitter distillation (preview)</Text>
              <Section style={styles.distillationBox}>{props.twitterDistillation}</Section>
              <Text style={styles.distillationFooter}>
                What the Post to X button would have sent — for voice comparison only; no tweet was
                posted.
              </Text>
            </Section>
          )}

          <Section style={{ padding: '4px 0' }}>
            <Link href={safeLink(backLink)} style={styles.cta}>
              View in dashboard &rarr;
            </Link>
          </Section>

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; EMAIL ME &middot; operator-initiated
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: AgentResponseEmailProps): string {
  const sev = (props.severity ?? '').toUpperCase();
  const sevTag = sev ? `[${sev}] ` : '';
  const entity = props.alertEntityId ? props.alertEntityId : AGENT_IDENTITY.sitrepLabel;
  return `[Cocoa AI] ${sevTag}${entity}`;
}

export default AgentResponseEmail;
