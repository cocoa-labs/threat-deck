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
import { pickWireTakeaway } from '@/lib/voice';
import { absoluteUrl, emailTheme, severityColor } from './theme';

export type DigestCveItem = {
  cveId: string;
  summary: string | null;
  severity: string | null;
  cvssV3Score: number | null;
  isKev: boolean;
  exploitedInWild: boolean;
  vendor: string | null;
  product: string | null;
  publishedAt: string | null;
};

export type DigestKevItem = {
  cveId: string;
  vulnerabilityName: string | null;
  vendorProject: string | null;
  product: string | null;
  dueDate: string | null;
  addedToKevAt: string | null;
};

export type DigestBreachItem = {
  incidentId: number | string;
  organization: string | null;
  industry: string | null;
  incidentType: string | null;
  recordsCompromised: number | null;
  actorName: string | null;
  disclosedAt: string | null;
};

export type DailyDigestProps = {
  dateLabel: string;
  cves: DigestCveItem[];
  kevAdds: DigestKevItem[];
  breaches: DigestBreachItem[];
  /**
   * Voiced masthead prose from the shared voice layer. `hero` empty => keep the
   * static masthead; `takeaway` falls back to the deterministic shelf.
   */
  prose?: { hero: string; takeaway: string | null };
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
  hero: {
    padding: '28px 24px 8px',
  },
  heroTitle: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '22px',
    fontWeight: 700 as const,
    letterSpacing: '0.02em',
    margin: '0 0 6px',
  },
  heroSubtitle: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    letterSpacing: '0.06em',
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  sectionWrap: {
    padding: '0 24px',
  },
  sectionHeader: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '13px',
    fontWeight: 700 as const,
    letterSpacing: '0.12em',
    margin: '24px 0 12px',
    textTransform: 'uppercase' as const,
  },
  row: {
    backgroundColor: emailTheme.bgSubtle,
    border: `1px solid ${emailTheme.border}`,
    borderRadius: '3px',
    marginBottom: '8px',
    padding: '12px 14px',
  },
  rowTitle: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontMono,
    fontSize: '14px',
    fontWeight: 700 as const,
    margin: '0 0 4px',
  },
  rowMeta: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    margin: '4px 0',
  },
  rowSummary: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '13px',
    lineHeight: '1.5',
    margin: '6px 0 8px',
  },
  badge: {
    borderRadius: '2px',
    display: 'inline-block',
    fontFamily: emailTheme.fontMono,
    fontSize: '10px',
    fontWeight: 700 as const,
    letterSpacing: '0.08em',
    marginRight: '6px',
    padding: '2px 6px',
    textTransform: 'uppercase' as const,
  },
  link: {
    color: emailTheme.matrixGreen,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontWeight: 700 as const,
    letterSpacing: '0.08em',
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
  emptyText: {
    color: emailTheme.textMuted,
    fontFamily: emailTheme.fontMono,
    fontSize: '12px',
    fontStyle: 'italic' as const,
    margin: '8px 0 0',
  },
  // Voiced hero lede — the 1-2 sentence masthead intro in the house register.
  // Rendered only when the voice layer produced one; otherwise the static
  // subtitle carries the masthead.
  heroLede: {
    color: emailTheme.textPrimary,
    fontFamily: emailTheme.fontSans,
    fontSize: '14px',
    lineHeight: '1.5',
    margin: '10px 0 0',
  },
  // Wry single-line under the hero — the analyst's dry observation about
  // the day's shape. Italic, small, restrained — supplements the masthead
  // without competing with section scan.
  wireTakeaway: {
    color: emailTheme.textSecondary,
    fontFamily: emailTheme.fontMono,
    fontSize: '11px',
    fontStyle: 'italic' as const,
    letterSpacing: '0.04em',
    margin: '4px 0 0',
  },
};

function formatNumber(n: number | null | undefined): string {
  if (n == null) return 'unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function severityBadgeStyle(color: string): React.CSSProperties {
  return {
    ...styles.badge,
    backgroundColor: `${color}22`,
    border: `1px solid ${color}`,
    color,
  };
}

export function DailyDigest(props: DailyDigestProps): React.ReactElement {
  const { dateLabel, cves, kevAdds, breaches, prose } = props;
  const totalItems = cves.length + kevAdds.length + breaches.length;
  const takeaway =
    prose?.takeaway ??
    pickWireTakeaway({
      cveCount: cves.length,
      kevCount: kevAdds.length,
      breachCount: breaches.length,
    });

  return (
    <Html>
      <Head />
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.masthead}>
            <Text style={styles.mastheadText}>Cocoa AI / Threat Deck</Text>
          </Section>

          <Section style={styles.hero}>
            <Heading as="h1" style={styles.heroTitle}>
              The Wire
            </Heading>
            <Text style={styles.heroSubtitle}>
              {dateLabel} &middot;{' '}
              {totalItems === 0 ? 'wire holds steady' : `${totalItems} stories overnight`}
            </Text>
            {prose?.hero ? <Text style={styles.heroLede}>{prose.hero}</Text> : null}
            {takeaway ? <Text style={styles.wireTakeaway}>{takeaway}</Text> : null}
          </Section>

          <Section style={styles.sectionWrap}>
            <Heading as="h2" style={styles.sectionHeader}>
              Top Critical CVEs
            </Heading>
            {cves.length === 0 ? (
              <Text style={styles.emptyText}>
                The wire holds steady — no critical CVEs in the last 24h.
              </Text>
            ) : (
              cves.map((cve) => {
                const sc = severityColor(cve.severity);
                const vendor =
                  cve.vendor || cve.product
                    ? ` · ${[cve.vendor, cve.product].filter(Boolean).join(' ')}`
                    : '';
                return (
                  <Section key={cve.cveId} style={styles.row}>
                    <Text style={styles.rowTitle}>{cve.cveId}</Text>
                    <Text style={styles.rowMeta}>
                      <span style={severityBadgeStyle(sc)}>{cve.severity ?? 'unknown'}</span>
                      {cve.cvssV3Score != null && (
                        <span style={{ ...styles.badge, color: emailTheme.textSecondary }}>
                          CVSS {Number(cve.cvssV3Score).toFixed(1)}
                        </span>
                      )}
                      {cve.isKev && (
                        <span style={severityBadgeStyle(emailTheme.severity.critical)}>KEV</span>
                      )}
                      {cve.exploitedInWild && (
                        <span style={severityBadgeStyle(emailTheme.severity.high)}>Exploited</span>
                      )}
                      {vendor}
                    </Text>
                    {cve.summary && <Text style={styles.rowSummary}>{cve.summary}</Text>}
                    <Link
                      href={absoluteUrl(`/api/aegis/cves/view?id=${cve.cveId}`)}
                      style={styles.link}
                    >
                      View brief &rarr;
                    </Link>
                  </Section>
                );
              })
            )}
          </Section>

          <Section style={styles.sectionWrap}>
            <Heading as="h2" style={styles.sectionHeader}>
              New KEV Additions
            </Heading>
            {kevAdds.length === 0 ? (
              <Text style={styles.emptyText}>The catalog rests — no new KEV adds today.</Text>
            ) : (
              kevAdds.map((kev) => (
                <Section key={kev.cveId} style={styles.row}>
                  <Text style={styles.rowTitle}>
                    {kev.cveId} {kev.vulnerabilityName ? `· ${kev.vulnerabilityName}` : ''}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {[kev.vendorProject, kev.product].filter(Boolean).join(' / ') ||
                      'Vendor unknown'}
                    {kev.dueDate ? ` · Due ${kev.dueDate}` : ''}
                  </Text>
                  <Link
                    href={absoluteUrl(`/api/aegis/kev/view?id=${kev.cveId}`)}
                    style={styles.link}
                  >
                    View brief &rarr;
                  </Link>
                </Section>
              ))
            )}
          </Section>

          <Section style={styles.sectionWrap}>
            <Heading as="h2" style={styles.sectionHeader}>
              Recent Breaches
            </Heading>
            {breaches.length === 0 ? (
              <Text style={styles.emptyText}>No disclosures surfaced overnight.</Text>
            ) : (
              breaches.map((b) => (
                <Section key={String(b.incidentId)} style={styles.row}>
                  <Text style={styles.rowTitle}>{b.organization ?? 'Undisclosed org'}</Text>
                  <Text style={styles.rowMeta}>
                    {[b.industry, b.incidentType].filter(Boolean).join(' · ')}
                    {b.recordsCompromised != null
                      ? ` · ${formatNumber(b.recordsCompromised)} records`
                      : ''}
                    {b.actorName ? ` · Attributed: ${b.actorName}` : ''}
                  </Text>
                  <Link
                    href={absoluteUrl(`/api/aegis/incidents/view?id=${b.incidentId}`)}
                    style={styles.link}
                  >
                    View brief &rarr;
                  </Link>
                </Section>
              ))
            )}
          </Section>

          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            Cocoa AI Threat Deck &middot; The wire never sleeps &middot; 09:00 ET daily
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function subject(props: DailyDigestProps): string {
  const kev = props.kevAdds.length;
  const cves = props.cves.length;
  const breach = props.breaches.length;
  if (kev === 0 && cves === 0 && breach === 0) {
    return `[Cocoa AI] Wire · ${props.dateLabel} · holds steady overnight`;
  }
  const fragments: string[] = [];
  if (cves > 0) fragments.push(`${cves} crit CVE${cves > 1 ? 's' : ''} surface`);
  if (kev > 0) fragments.push(`${kev} KEV add${kev > 1 ? 's' : ''}`);
  if (breach > 0) fragments.push(`${breach} breach${breach > 1 ? 'es' : ''}`);
  return `[Cocoa AI] Wire · ${fragments.join(' · ')}`;
}

export default DailyDigest;
