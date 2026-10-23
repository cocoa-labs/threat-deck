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

export type BreachAlertProps = {
  incidentId: number | string;
  organization: string | null;
  industry: string | null;
  country: string | null;
  incidentType: string | null;
  initialAccessVector: string | null;
  recordsCompromised: number | null;
  estimatedLossUsd: number | null;
  summary: string | null;
  actorName: string | null;
  actorType: string | null;
  disclosedAt: string | null;
  /** Optional one-line voiced "wire take" from the shared voice layer (no LLM). */
  wireTake?: string | null;
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
    backgroundColor: emailTheme.severity.high,
    height: '4px',
    width: '100%',
  },
  hero: {
    padding: '24px 24px 4px',
  },
  alertLabel: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.18em',
    margin: '0 0 6px',
    textTransform: 'uppercase' as const,
  },
  org: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '22px',
    fontWeight: 700 as const,
    margin: '0 0 8px',
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
  statRow: {
    backgroundColor: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.border}`,
    borderRadius: '3px',
    margin: '8px 24px',
    padding: '14px 16px',
  },
  statLabel: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    fontWeight: 700 as const,
    letterSpacing: '0.1em',
    margin: '0 0 2px',
    textTransform: 'uppercase' as const,
  },
  statValue: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '18px',
    fontWeight: 700 as const,
    margin: 0,
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
  bodyText: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '14px',
    lineHeight: '1.6',
    margin: '0 0 8px',
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
  wireTake: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontStyle: 'italic' as const,
    letterSpacing: '0.04em',
    margin: '8px 0 0',
  },
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return 'unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUsd(n: number | null | undefined): string {
  if (n == null) return 'undisclosed';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

export function BreachAlert(props: BreachAlertProps): React.ReactElement {
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
            <Text style={styles.alertLabel}>Breach Disclosure</Text>
            <Heading as="h1" style={styles.org}>
              {props.organization ?? 'Undisclosed organization'}
            </Heading>
            <Text style={styles.meta}>
              {[props.industry, props.country].filter(Boolean).join(' · ')}
              {props.disclosedAt ? ` · Disclosed ${props.disclosedAt}` : ''}
            </Text>
            <Text style={styles.meta}>
              {props.incidentType && (
                <span
                  style={{
                    ...styles.badge,
                    backgroundColor: `${emailTheme.severity.high}22`,
                    border: `1px solid ${emailTheme.severity.high}`,
                    color: emailTheme.severity.high,
                  }}
                >
                  {props.incidentType.replace(/_/g, ' ')}
                </span>
              )}
              {props.initialAccessVector && (
                <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                  {props.initialAccessVector.replace(/_/g, ' ')}
                </span>
              )}
            </Text>
            {props.wireTake ? <Text style={styles.wireTake}>{props.wireTake}</Text> : null}
          </Section>

          <Section style={styles.statRow}>
            <Text style={styles.statLabel}>Records compromised</Text>
            <Text style={styles.statValue}>{formatNumber(props.recordsCompromised)}</Text>
          </Section>

          {props.estimatedLossUsd != null && (
            <Section style={styles.statRow}>
              <Text style={styles.statLabel}>Estimated loss</Text>
              <Text style={styles.statValue}>{formatUsd(props.estimatedLossUsd)}</Text>
            </Section>
          )}

          {props.actorName && (
            <Section style={styles.statRow}>
              <Text style={styles.statLabel}>Attribution</Text>
              <Text style={styles.statValue}>
                {props.actorName}
                {props.actorType ? ` (${props.actorType})` : ''}
              </Text>
            </Section>
          )}

          {props.summary && (
            <Section style={styles.contentSection}>
              <Text style={styles.contentLabel}>Summary</Text>
              <Text style={styles.bodyText}>{props.summary}</Text>
            </Section>
          )}

          <Section style={{ padding: '4px 24px' }}>
            <Link
              href={absoluteUrl(`/api/aegis/incidents/view?id=${props.incidentId}`)}
              style={styles.cta}
            >
              View incident &rarr;
            </Link>
          </Section>

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; Breach alert &middot; Auto-triggered
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: BreachAlertProps): string {
  const records =
    props.recordsCompromised != null ? ` · ${formatNumber(props.recordsCompromised)} records` : '';
  const org = props.organization ?? 'Undisclosed';
  return `[Cocoa AI] Breach: ${org}${records}`;
}

export default BreachAlert;
