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

export type KEVAddedAlertProps = {
  cveId: string;
  vulnerabilityName: string | null;
  vendorProject: string | null;
  product: string | null;
  addedToKevAt: string | null;
  dueDate: string | null;
  requiredAction: string | null;
  shortDescription: string | null;
  knownRansomwareUse: string | null;
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
    backgroundColor: emailTheme.severity.critical,
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
  cveId: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '22px',
    fontWeight: 700 as const,
    margin: '0 0 6px',
  },
  vulnName: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontSans,
    fontSize: '15px',
    fontStyle: 'italic' as const,
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
    fontFamily: emailTheme.fontMono,
    fontSize: '32px',
    fontWeight: 700 as const,
    margin: '4px 0',
  },
  countdownDate: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    margin: '4px 0 0',
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

function daysUntil(dateStr: string | null): { days: number | null; label: string; color: string } {
  if (!dateStr) {
    return { days: null, label: 'No deadline set', color: emailTheme.textMuted };
  }
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) {
    return { days: null, label: 'Invalid date', color: emailTheme.textMuted };
  }
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return { days, label: `${Math.abs(days)} days overdue`, color: emailTheme.severity.critical };
  }
  if (days === 0) {
    return { days, label: 'Due today', color: emailTheme.severity.critical };
  }
  if (days <= 7) {
    return { days, label: `Due in ${days} days`, color: emailTheme.severity.high };
  }
  if (days <= 30) {
    return { days, label: `Due in ${days} days`, color: emailTheme.severity.medium };
  }
  return { days, label: `Due in ${days} days`, color: emailTheme.severity.low };
}

export function KEVAddedAlert(props: KEVAddedAlertProps): React.ReactElement {
  const countdown = daysUntil(props.dueDate);
  const vendorProduct =
    [props.vendorProject, props.product].filter(Boolean).join(' / ') || 'Vendor unknown';

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
            <Text style={styles.alertLabel}>New CISA KEV Entry</Text>
            <Heading as="h1" style={styles.cveId}>
              {props.cveId}
            </Heading>
            {props.vulnerabilityName && (
              <Text style={styles.vulnName}>{props.vulnerabilityName}</Text>
            )}
            <Text style={styles.meta}>{vendorProduct}</Text>
            <Text style={styles.meta}>
              {props.knownRansomwareUse && props.knownRansomwareUse.toLowerCase() === 'known' && (
                <span
                  style={{
                    ...styles.badge,
                    backgroundColor: `${emailTheme.severity.critical}22`,
                    border: `1px solid ${emailTheme.severity.critical}`,
                    color: emailTheme.severity.critical,
                  }}
                >
                  Ransomware
                </span>
              )}
              {props.addedToKevAt && (
                <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                  Added {props.addedToKevAt}
                </span>
              )}
            </Text>
            {props.wireTake ? <Text style={styles.wireTake}>{props.wireTake}</Text> : null}
          </Section>

          <Section
            style={{
              ...styles.countdownBox,
              backgroundColor: `${countdown.color}15`,
              border: `1px solid ${countdown.color}`,
            }}
          >
            <Text style={styles.countdownLabel}>Remediation Deadline</Text>
            <Text style={{ ...styles.countdownValue, color: countdown.color }}>
              {countdown.label}
            </Text>
            {props.dueDate && <Text style={styles.countdownDate}>{props.dueDate}</Text>}
          </Section>

          {props.requiredAction && (
            <Section style={styles.contentSection}>
              <Text style={styles.contentLabel}>Required Action</Text>
              <Text style={styles.bodyText}>{props.requiredAction}</Text>
            </Section>
          )}

          {props.shortDescription && (
            <Section style={styles.contentSection}>
              <Text style={styles.contentLabel}>Vulnerability</Text>
              <Text style={styles.bodyText}>{props.shortDescription}</Text>
            </Section>
          )}

          <Section style={{ padding: '4px 24px' }}>
            <Link href={absoluteUrl(`/api/aegis/kev/view?id=${props.cveId}`)} style={styles.cta}>
              View full brief &rarr;
            </Link>
          </Section>

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; KEV alert &middot; Auto-triggered
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: KEVAddedAlertProps): string {
  const countdown = daysUntil(props.dueDate);
  const suffix = countdown.label !== 'No deadline set' ? ` · ${countdown.label}` : '';
  return `[Cocoa AI] KEV Added: ${props.cveId}${suffix}`;
}

export default KEVAddedAlert;
