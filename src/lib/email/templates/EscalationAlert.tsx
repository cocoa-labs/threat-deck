import { safeLink } from '@/lib/security/safe-link';
/**
 * Phase 9.5 — EscalationAlert email template.
 *
 * Sent by the every-30-minute escalation cron when a CRITICAL draft sits
 * unreviewed in the Approval Queue for ≥2 hours. Mirrors the visual
 * register of KEVAddedAlert.tsx (brand masthead, severity stripe,
 * matrix-green accents, mono type pairing) so it sits naturally in the
 * Cocoa AI alert vernacular.
 *
 * Recipients: `ALERT_EMAIL_RECIPIENTS` (comma-separated). One email per
 * unreviewed critical draft per dedup window — see escalate/route.ts.
 */

import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Section,
  Text,
} from '@react-email/components';
import { absoluteUrl, emailTheme } from './theme';

export interface EscalationAlertProps {
  draftId: number;
  channel: string; // 'twitter' | 'email' | 'rss'
  draftType: string; // 'daily_brief' | 'breaking' | ...
  headline: string;
  previewText: string | null;
  ageHours: number;
  aiRelevance: number | null;
  /** Optional URL of the source alert / CVE behind the draft. */
  sourceUrl: string | null;
}

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
    maxWidth: '640px',
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
    backgroundColor: emailTheme.severity.critical,
    height: '4px',
    width: '100%',
  },
  hero: {
    padding: '24px 24px 4px',
  },
  alertLabel: {
    color: emailTheme.severity.critical,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.18em',
    margin: '0 0 6px',
    textTransform: 'uppercase' as const,
  },
  headline: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '18px',
    fontWeight: 700 as const,
    lineHeight: '1.3',
    margin: '0 0 10px',
  },
  meta: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    margin: '0 0 4px',
  },
  badge: {
    borderRadius: '2px',
    display: 'inline-block',
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    fontWeight: 700 as const,
    letterSpacing: '0.08em',
    marginRight: '6px',
    padding: '3px 7px',
    textTransform: 'uppercase' as const,
  },
  countdownBox: {
    backgroundColor: `${emailTheme.severity.critical}15`,
    border: `1px solid ${emailTheme.severity.critical}`,
    borderRadius: '3px',
    margin: '16px 24px 4px',
    padding: '20px 18px',
    textAlign: 'center' as const,
  },
  countdownLabel: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.14em',
    margin: '0 0 4px',
    textTransform: 'uppercase' as const,
  },
  countdownValue: {
    color: emailTheme.severity.critical,
    fontFamily: emailTheme.fontMono,
    fontSize: '28px',
    fontWeight: 700 as const,
    margin: '4px 0',
  },
  contentSection: {
    padding: '12px 24px',
  },
  contentLabel: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.12em',
    margin: '16px 0 6px',
    textTransform: 'uppercase' as const,
  },
  previewQuote: {
    backgroundColor: emailTheme.bgOuter,
    borderLeft: `2px solid ${emailTheme.brandAccent}`,
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '13px',
    fontStyle: 'italic' as const,
    lineHeight: '1.5',
    margin: '0 0 8px',
    padding: '10px 14px',
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
    margin: '20px 24px 4px',
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
    margin: '20px 24px',
    textAlign: 'center' as const,
    textTransform: 'uppercase' as const,
  },
};

export function EscalationAlert(props: EscalationAlertProps): React.ReactElement {
  const aiRelLabel =
    props.aiRelevance == null ? 'unscored' : `${(props.aiRelevance * 100).toFixed(0)}%`;
  const ageDisplay =
    props.ageHours < 1 ? `${Math.round(props.ageHours * 60)}m` : `${props.ageHours.toFixed(1)}h`;

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.mastheadText}>Cocoa AI / Threat Deck</Text>
          </Section>
          <Section style={styles.severityStripe} />

          <Section style={styles.hero}>
            <Text style={styles.alertLabel}>Escalation · Unreviewed Critical Draft</Text>
            <Heading as="h1" style={styles.headline}>
              {props.headline}
            </Heading>
            <Text style={styles.meta}>
              <span
                style={{
                  ...styles.badge,
                  backgroundColor: `${emailTheme.matrixGreen}22`,
                  border: `1px solid ${emailTheme.matrixGreen}`,
                  color: emailTheme.matrixGreen,
                }}
              >
                {props.channel}
              </span>
              <span
                style={{
                  ...styles.badge,
                  backgroundColor: 'transparent',
                  border: `1px solid ${emailTheme.textSecondary}`,
                  color: emailTheme.textSecondary,
                }}
              >
                {props.draftType}
              </span>
              <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                AI {aiRelLabel}
              </span>
            </Text>
          </Section>

          <Section style={styles.countdownBox}>
            <Text style={styles.countdownLabel}>Unreviewed for</Text>
            <Text style={styles.countdownValue}>{ageDisplay}</Text>
          </Section>

          {props.previewText && (
            <Section style={styles.contentSection}>
              <Text style={styles.contentLabel}>Preview</Text>
              <Text style={styles.previewQuote}>{props.previewText}</Text>
            </Section>
          )}

          <Section style={{ padding: '4px 24px' }}>
            <Link href={absoluteUrl('/?focus=approval-queue')} style={styles.cta}>
              Open approval queue &rarr;
            </Link>
          </Section>

          {props.sourceUrl && (
            <Section style={{ padding: '4px 24px' }}>
              <Text style={styles.meta}>
                Source:{' '}
                <Link
                  href={safeLink(props.sourceUrl)}
                  style={{ color: emailTheme.matrixGreen, textDecoration: 'underline' }}
                >
                  {props.sourceUrl}
                </Link>
              </Text>
            </Section>
          )}

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; Approval queue escalation &middot; Draft #{props.draftId}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: EscalationAlertProps): string {
  const ageDisplay =
    props.ageHours < 1 ? `${Math.round(props.ageHours * 60)}m` : `${props.ageHours.toFixed(1)}h`;
  return `[Cocoa AI] ESCALATION: critical draft awaiting review for ${ageDisplay}`;
}

export default EscalationAlert;
