import { describe, expect, it } from 'vitest';
import { buildVisualBriefSync, resolveVisualStyleTag } from './visual-brief';

describe('buildVisualBriefSync', () => {
  it('extracts CVE/KEV metrics, severity, sources, and sections', () => {
    const brief = buildVisualBriefSync({
      messageContent: `## BLUF
**[CRITICAL]** CVE-2026-33000 was added to KEV. CVSS: 9.8 EPSS: 0.92. Patch deadline is 14 days.

## KEY FINDINGS
- Exploitation is active against edge devices.
- Vendor patch is available and should be prioritized.

## RISK ASSESSMENT
Internet-facing appliances create high blast radius.

**Sources:**
- [VERIFIED] [CISA KEV](/api/aegis/kev/view?id=CVE-2026-33000)
- [VERIFIED] [NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-33000)`,
      sourceContext: {
        sourcePanel: 'kevAlerts',
        dataType: 'kev',
        trendData: { sourceUrl: '/api/aegis/kev/view?id=CVE-2026-33000' },
      },
    });

    expect(brief.schemaVersion).toBe('visual-v2');
    expect(brief.severity).toBe('critical');
    expect(brief.entityKind).toBe('kev');
    expect(brief.entityId).toBe('CVE-2026-33000');
    expect(brief.metrics.map((m) => m.label)).toContain('CVSS');
    expect(brief.metrics.map((m) => m.value)).toContain('9.8');
    expect(brief.sections.length).toBeGreaterThanOrEqual(2);
    expect(brief.sources.some((source) => source.name.includes('CISA'))).toBe(true);
    expect(resolveVisualStyleTag(brief)).toBe('kev_pressure');
  });

  it('extracts threat actor dossiers into noir style', () => {
    const brief = buildVisualBriefSync({
      messageContent: `## BLUF
APT29 activity is rising across diplomatic targets.

## DATA SUMMARY
| Metric | Value |
| Aliases | 3 |
| Campaigns | 14 |
| TTPs | 47 |

## KEY FINDINGS
- Initial access clusters around phishing and token theft.
- Campaigns overlap with cloud identity abuse.`,
      sourceContext: {
        sourcePanel: 'threatActorScores',
        dataType: 'threat_actor',
        trendData: { name: 'APT29', sourceUrl: '/api/aegis/threat-actors/view?id=APT29' },
      },
    });

    expect(brief.entityKind).toBe('threat_actor');
    expect(brief.entityId).toBe('APT29');
    expect(brief.table?.rows.length).toBeGreaterThan(0);
    expect(brief.metrics.some((metric) => metric.label === 'Aliases')).toBe(true);
    expect(resolveVisualStyleTag(brief)).toBe('identity_intrusion');
  });

  it('extracts forecast tables into editorial chart style', () => {
    const brief = buildVisualBriefSync({
      messageContent: `## BLUF
Exploit-likelihood forecast expects mass exploitation within 21 days.

## MARKET IMPACT
| Ticker | Price | Change | Signal |
| PLTR | $152.12 | +0.4% | demand |
| LMT | $513.20 | flat | neutral |

## RISK ASSESSMENT
Probability: 0.74. Confidence: 82%.`,
      sourceContext: { sourcePanel: 'predictions-cve', dataType: 'forecast' },
    });

    expect(brief.entityKind).toBe('forecast');
    expect(brief.table?.headers).toEqual(['Ticker', 'Price', 'Change', 'Signal']);
    expect(brief.metrics.some((metric) => metric.value === '0.74')).toBe(true);
    expect(resolveVisualStyleTag(brief)).toBe('market_signal_board');
  });

  it('turns free-form news into a non-empty visual brief', () => {
    const brief = buildVisualBriefSync({
      messageContent:
        'NASA outlined a seven-year Moon base buildout today with three missions this year, a Lunar South Pole target, and a public/private industrial stack forming around launch, landing, communications, and defense-adjacent infrastructure. The Verge report is the editorial readout.',
      sourceContext: {
        sourcePanel: 'news',
        dataType: 'article',
        trendData: {
          title: 'NASA permanent Moon base plans start with three missions this year',
          source: 'The Verge',
          sourceUrl: 'https://www.theverge.com/nasa-moon-base',
        },
      },
    });

    expect(brief.title).toContain('NASA');
    expect(brief.bluf).toContain('Moon base');
    expect(brief.sections.length).toBeGreaterThanOrEqual(1);
    expect(brief.sources[0]?.name).toBe('The Verge');
    expect(brief.themeHints).toContain('nasa');
  });

  it('maps package registry botnet stories to supply-chain visuals', () => {
    const brief = buildVisualBriefSync({
      messageContent:
        'The GlassWorm botnet abused the Open VSX package registry and developer environments through malicious extensions. The campaign behaved like a self-propagating worm across repository tooling.',
      sourceContext: {
        sourcePanel: 'news',
        dataType: 'article',
        trendData: {
          title: 'GlassWorm botnet takedown disrupts Open VSX package abuse',
          sourceUrl: 'https://www.securityweek.com/glassworm-botnet-disrupted',
        },
      },
    });

    expect(resolveVisualStyleTag(brief)).toBe('supply_chain_map');
  });

  it('maps shadow AI research stories to research-gap visuals', () => {
    const brief = buildVisualBriefSync({
      messageContent:
        'The Register reports new research showing a perception gap between executive confidence and actual worker use of shadow AI tools.',
      sourceContext: {
        sourcePanel: 'news',
        dataType: 'article',
        trendData: {
          title: 'The Register calls it shadow AI',
          source: 'The Register',
          sourceUrl: 'https://www.theregister.com/security/shadow-ai-study',
        },
      },
    });

    expect(resolveVisualStyleTag(brief)).toBe('research_gap_card');
  });

  it('maps breach and exposure stories to ledger visuals', () => {
    const brief = buildVisualBriefSync({
      messageContent:
        'A third-party breach exposed customer records and created vendor blast-radius questions for downstream teams.',
      sourceContext: {
        sourcePanel: 'breachDisclosure',
        dataType: 'breach',
        trendData: {
          title: 'Vendor breach exposes customer records',
          sourceUrl: 'https://example.com/vendor-breach',
        },
      },
    });

    expect(resolveVisualStyleTag(brief)).toBe('exposure_ledger');
  });

  it('uses the research-gap card for ambiguous briefs', () => {
    const brief = buildVisualBriefSync({
      messageContent:
        'A short operator note with no specific source, entity, incident type, metric, or research angle.',
    });

    expect(resolveVisualStyleTag(brief)).toBe('research_gap_card');
  });
});
