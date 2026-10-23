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
import { safeLink } from '@/lib/security/safe-link';
import { absoluteUrl, emailTheme, severityColor } from './theme';

export type CVEAlertProps = {
  cveId: string;
  summary: string | null;
  severity: string | null;
  cvssV3Score: number | null;
  epssScore: number | null;
  isKev: boolean;
  exploitedInWild: boolean;
  pocPublic: boolean;
  vendor: string | null;
  product: string | null;
  publishedAt: string | null;
  kevDueDate: string | null;
  kevRequiredAction: string | null;
  nvdSourceUrl: string | null;
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
    fontSize: '24px',
    fontWeight: 700 as const,
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
  kevBox: {
    backgroundColor: `${emailTheme.severity.critical}15`,
    border: `1px solid ${emailTheme.severity.critical}`,
    borderRadius: '3px',
    margin: '16px 24px 4px',
    padding: '14px',
  },
  kevHeader: {
    color: emailTheme.severity.critical,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    fontWeight: 700 as const,
    letterSpacing: '0.12em',
    margin: '0 0 8px',
    textTransform: 'uppercase' as const,
  },
  kevBody: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '13px',
    lineHeight: '1.5',
    margin: 0,
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
  sourceLink: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    textDecoration: 'underline',
  },
  // One dry voiced line under the hero — the analyst's take, not a data field.
  wireTake: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontStyle: 'italic' as const,
    letterSpacing: '0.04em',
    margin: '8px 0 0',
  },
};

function severityBadgeStyle(color: string): React.CSSProperties {
  return {
    ...styles.badge,
    backgroundColor: `${color}22`,
    border: `1px solid ${color}`,
    color,
  };
}

export function CVEAlert(props: CVEAlertProps): React.ReactElement {
  const sc = severityColor(props.severity);
  const vendorProduct = [props.vendor, props.product].filter(Boolean).join(' ') || 'Vendor unknown';

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.mastheadText}>Cocoa AI / Threat Deck</Text>
          </Section>
          <Section style={{ ...styles.severityStripe, backgroundColor: sc }} />

          <Section style={styles.hero}>
            <Text style={styles.alertLabel}>Critical CVE Alert</Text>
            <Heading as="h1" style={styles.cveId}>
              {props.cveId}
            </Heading>
            <Text style={styles.meta}>
              <span style={severityBadgeStyle(sc)}>{props.severity ?? 'unknown'}</span>
              {props.cvssV3Score != null && (
                <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                  CVSS {Number(props.cvssV3Score).toFixed(1)}
                </span>
              )}
              {props.epssScore != null && (
                <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                  EPSS {(Number(props.epssScore) * 100).toFixed(1)}%
                </span>
              )}
              {props.isKev && (
                <span style={severityBadgeStyle(emailTheme.severity.critical)}>KEV</span>
              )}
              {props.exploitedInWild && (
                <span style={severityBadgeStyle(emailTheme.severity.high)}>Exploited</span>
              )}
              {props.pocPublic && (
                <span style={severityBadgeStyle(emailTheme.severity.medium)}>PoC Public</span>
              )}
            </Text>
            <Text style={styles.meta}>
              {vendorProduct}
              {props.publishedAt ? ` · Published ${props.publishedAt}` : ''}
            </Text>
            {props.wireTake ? <Text style={styles.wireTake}>{props.wireTake}</Text> : null}
          </Section>

          {props.summary && (
            <Section style={styles.contentSection}>
              <Text style={styles.contentLabel}>Summary</Text>
              <Text style={styles.bodyText}>{props.summary}</Text>
            </Section>
          )}

          {props.isKev && (props.kevDueDate || props.kevRequiredAction) && (
            <Section style={styles.kevBox}>
              <Text style={styles.kevHeader}>CISA KEV — Mandatory Action Required</Text>
              {props.kevDueDate && (
                <Text style={styles.kevBody}>
                  <strong>Remediation deadline:</strong> {props.kevDueDate}
                </Text>
              )}
              {props.kevRequiredAction && (
                <Text style={styles.kevBody}>
                  <strong>Required action:</strong> {props.kevRequiredAction}
                </Text>
              )}
            </Section>
          )}

          <Section style={{ padding: '4px 24px' }}>
            <Link href={absoluteUrl(`/api/aegis/cves/view?id=${props.cveId}`)} style={styles.cta}>
              View full brief &rarr;
            </Link>
          </Section>

          {props.nvdSourceUrl && (
            <Section style={styles.contentSection}>
              <Text style={styles.meta}>
                Source:{' '}
                <Link href={safeLink(props.nvdSourceUrl)} style={styles.sourceLink}>
                  NVD
                </Link>
              </Text>
            </Section>
          )}

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; Critical alert &middot; Auto-triggered
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: CVEAlertProps): string {
  const kev = props.isKev ? ' [KEV]' : '';
  const cvss = props.cvssV3Score != null ? ` CVSS ${Number(props.cvssV3Score).toFixed(1)}` : '';
  return `[Cocoa AI] CRITICAL${kev} ${props.cveId}${cvss}`;
}

export default CVEAlert;
