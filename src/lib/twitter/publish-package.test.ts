import { describe, expect, it } from 'vitest';
import { formatXPrimaryPostText, normalizeAgentMarkdownForX } from './formatting';
import { X_LONGFORM_MAX_LENGTH } from './length';
import {
  buildXPublishPackage,
  resolvePublicTweetSourceUrl,
  resolvePublicTweetSourceUrls,
  sanitizeAgentTextForPublicPost,
  scrubLlmPrimaryText,
} from './publish-package';

describe('X publish package composer', () => {
  it('prefers public source URLs from context', () => {
    const sourceUrl = resolvePublicTweetSourceUrl({
      sourcePanel: 'patchTracker',
      dataType: 'patch',
      trendData: {
        sourceUrl: 'https://ubuntu.com/security/notices/USN-8303-1',
        url: '/api/aegis/kev/view?id=CVE-2026-35616',
      },
    });

    expect(sourceUrl).toBe('https://ubuntu.com/security/notices/USN-8303-1');
  });

  it('rejects internal AEGIS viewer links and uses NVD for CVE context', () => {
    const sourceUrl = resolvePublicTweetSourceUrl({
      sourcePanel: 'kevAlerts',
      dataType: 'kev',
      trendData: {
        cveId: 'CVE-2026-35616',
        url: '/api/aegis/kev/view?id=CVE-2026-35616',
      },
    });

    expect(sourceUrl).toBe('https://nvd.nist.gov/vuln/detail/CVE-2026-35616');
  });

  it('rejects localhost links without inventing a public installation', () => {
    const sourceUrl = resolvePublicTweetSourceUrl(
      {
        sourcePanel: 'agent',
        dataType: 'brief',
        trendData: { sourceUrl: 'http://localhost:3002/feed/cyber-wire' },
      },
      'No CVE in this one.',
    );

    expect(sourceUrl).toBe('');
  });

  it('carries multiple public source links into the source trail', () => {
    const sourceUrls = resolvePublicTweetSourceUrls(
      {
        sourcePanel: 'agent',
        dataType: 'cve',
        trendData: {
          sourceUrl: 'https://www.cisa.gov/news-events/alerts/example',
          url: '/api/aegis/cves/view?id=CVE-2026-35616',
        },
      },
      'Vendor advisory: https://fortinet.com/support/advisory/FG-IR-26-001',
    );

    expect(sourceUrls).toEqual([
      'https://www.cisa.gov/news-events/alerts/example',
      'https://fortinet.com/support/advisory/FG-IR-26-001',
      'https://nvd.nist.gov/vuln/detail/CVE-2026-35616',
    ]);
  });

  it('strips internal agent process language from fallback copy', () => {
    const sanitized = sanitizeAgentTextForPublicPost(
      'Pulling the full CVE package and exploit forecast in parallel - this warrants MODE 2 depth. AEGIS does not have specific incident comps. Fortinet EMS exposure is the thing to verify today.',
    );

    expect(sanitized).not.toMatch(/Pulling|MODE 2|parallel|AEGIS/i);
    expect(sanitized).toContain('Fortinet EMS exposure');
    expect(sanitized.length).toBeLessThanOrEqual(X_LONGFORM_MAX_LENGTH);
  });

  it('builds the CVE post from Max’s own words, not a generic template', () => {
    const pkg = buildXPublishPackage({
      messageContent:
        'Pulling the full CVE package now. Fortinet FortiClient EMS carries CVE-2026-35616, a CVSS 9.8 SQL injection that landed on the KEV list this morning. The exposure window is open: unauthenticated RCE against internet-facing EMS consoles. Patch to 7.2.3 today and hunt for the IOCs before the ransomware crews finish their sweep.',
      sourceContext: {
        sourcePanel: 'kevAlerts',
        dataType: 'kev',
        trendData: {
          cveId: 'CVE-2026-35616',
          url: '/api/aegis/kev/view?id=CVE-2026-35616',
        },
      },
    });

    // The generic CVE template is retired — the post is Max's actual analysis.
    expect(pkg.primaryText).not.toMatch(/Not backlog|Blast radius/);
    expect(pkg.primaryText).toContain('Fortinet FortiClient EMS carries CVE-2026-35616');
    expect(pkg.primaryText).toContain('CVSS 9.8'); // decimal stays intact
    expect(pkg.primaryText).toContain('7.2.3');
    // Process chatter ("Pulling the full CVE package now.") is stripped.
    expect(pkg.primaryText).not.toMatch(/Pulling|MODE 2|in parallel|AEGIS/i);
    // Source resolution is unchanged — CVE id still yields the NVD link.
    expect(pkg.replyText).toContain('Source trail and visual brief');
    expect(pkg.replyText).toContain('https://nvd.nist.gov/vuln/detail/CVE-2026-35616');
    expect(pkg.sourceUrls).toEqual(['https://nvd.nist.gov/vuln/detail/CVE-2026-35616']);
    expect(pkg.primaryText.length).toBeLessThanOrEqual(X_LONGFORM_MAX_LENGTH);
    expect(pkg.replyText.length).toBeLessThanOrEqual(X_LONGFORM_MAX_LENGTH);
  });

  it('preserves Max’s own structure instead of synthesizing a skeleton', () => {
    const formatted = formatXPrimaryPostText(`
Six interlocking geopolitical risks dominate the current landscape — with the US-Iran conflict as the sharpest near-term flashpoint, and China's quiet resource-control strategy as the most durable long-tail risk.

TOP GEOPOLITICAL RISKS — MAY 31, 2026

1. 🔴 US-Iran War / Ceasefire Fragility [CRITICAL]
The truce that took effect after the February 28 strike campaign is holding — barely. Tit-for-tats at sea continue, US forces struck missile sites and vessels in southern Iran within the past week, and Washington and Tehran are negotiating a formal wind-down.

2. 🟡 China's Critical Mineral Quiet Play [HIGH]
Beijing's playbook in Indonesia is instructive: Chinese state-owned enterprises quietly absorbed nickel assets and the supply chain map for Indo-Pacific critical minerals increasingly runs through Beijing's industrial network.

The thread running through all six: US power — military, economic, and institutional — is under simultaneous stress across multiple domains, and adversaries are reading that stress carefully.

Sources:
- Polymarket, May 31
- Atlantic Council, May 29
`);

    // Max's own intro, headings, numbered items, and closing survive verbatim.
    expect(formatted).toContain(
      'Six interlocking geopolitical risks dominate the current landscape',
    );
    expect(formatted).toContain('TOP GEOPOLITICAL RISKS — MAY 31, 2026');
    expect(formatted).toMatch(/\n\n1\. US-Iran War \/ Ceasefire Fragility \[CRITICAL\]\n/);
    expect(formatted).toMatch(/\n\n2\. China's Critical Mineral Quiet Play \[HIGH\]\n/);
    expect(formatted).toContain('The thread running through all six');
    // No synthesized BLUF/Operator-take skeleton is imposed on his text.
    expect(formatted).not.toContain('BLUF:');
    expect(formatted).not.toContain('Operator take:');
    // Cosmetic cleanup still applies: emoji + trailing Sources block stripped.
    expect(formatted).not.toContain('🔴');
    expect(formatted).not.toContain('Sources:');
    expect(formatted.length).toBeLessThanOrEqual(X_LONGFORM_MAX_LENGTH);
  });

  it('normalizes rich agent markdown without flattening section structure', () => {
    const normalized = normalizeAgentMarkdownForX(`
## Risk Table

| Signal | Confidence |
| --- | --- |
| Shadow AI | HIGH |

**Operator take:** keep the source trail clean.
`);

    expect(normalized).toContain('Signal / Confidence');
    expect(normalized).toContain('Shadow AI / HIGH');
    expect(normalized).toContain('Operator take:');
    expect(normalized).toContain('\n\n');
  });

  it('keeps decimals, percentages, and multipliers intact (no fragmentation)', () => {
    const sanitized = sanitizeAgentTextForPublicPost(
      'GOOGL closed down -2.99% today at $368.97 on 28.5M shares. NVDA rose +6.19% as the clear AI capex beneficiary. The raise is $80 billion.',
    );

    expect(sanitized).toContain('-2.99%');
    expect(sanitized).toContain('$368.97');
    expect(sanitized).toContain('28.5M');
    expect(sanitized).toContain('+6.19%');
    // No period-then-digit got a space injected and split into its own line.
    expect(sanitized).not.toMatch(/\$368\.\s/);
    expect(sanitized).not.toMatch(/-2\.\s/);
  });

  it('does not split decimals or CVSS scores when formatting a primary post', () => {
    const formatted = formatXPrimaryPostText(
      'BLUF: GOOGL trades at $368.97, down -2.99%, with CVSS 9.8 exposure noted.\n\nOperator take: watch the $80B raise.',
    );

    expect(formatted).toContain('$368.97');
    expect(formatted).toContain('-2.99%');
    expect(formatted).toContain('CVSS 9.8');
  });

  it('does not break on common abbreviations', () => {
    const sanitized = sanitizeAgentTextForPublicPost(
      'Volume was elevated vs. avg. U.S. regulators are watching, e.g. the DOJ remedies. The exposure is real.',
    );

    expect(sanitized).toContain('vs. avg.');
    expect(sanitized).toContain('U.S. regulators');
    expect(sanitized).toContain('e.g. the DOJ');
  });

  it('strips conversational filler lead-ins from public copy', () => {
    const sanitized = sanitizeAgentTextForPublicPost(
      'Let me pull the latest market position. Let me give you the full picture. BLUF: the $80B raise is the largest equity offering in US corporate history.',
    );

    expect(sanitized).not.toMatch(/let me/i);
    expect(sanitized).toContain('largest equity offering');
  });

  it('keeps a multi-sentence paragraph together instead of one line per sentence', () => {
    const sanitized = sanitizeAgentTextForPublicPost(
      'Alpha is the first sentence. Beta is the second sentence in the same paragraph. Gamma closes it out.',
    );

    expect(sanitized).toContain(
      'Alpha is the first sentence. Beta is the second sentence in the same paragraph. Gamma closes it out.',
    );
    expect(sanitized).not.toContain('Alpha is the first sentence.\n\n');
  });

  it('degrades to Max’s cleaned prose without appended boilerplate', () => {
    const pkg = buildXPublishPackage({
      messageContent: 'Acme Corp disclosed a breach affecting 2.3M customer records overnight.',
    });

    expect(pkg.primaryText).toContain(
      'Acme Corp disclosed a breach affecting 2.3M customer records',
    );
    // The old buildGeneralStoryPost boilerplate is retired.
    expect(pkg.primaryText).not.toContain('The important part is not the label');
    expect(pkg.primaryText).not.toContain('blast-radius thinking');
  });

  it('scrubs MODE/BREAKING from an LLM draft instead of discarding it', () => {
    const scrubbed = scrubLlmPrimaryText(
      'BREAKING: MODE 2 deep dive. CVE-2026-1234 is a CVSS 9.8 RCE. Patch to 4.5.1 today.',
    );

    expect(scrubbed).not.toMatch(/\bBREAKING\b/);
    expect(scrubbed).not.toMatch(/\bMODE\s*2\b/);
    expect(scrubbed).toContain('analyst-mode');
    expect(scrubbed).toContain('CVE-2026-1234');
    expect(scrubbed).toContain('CVSS 9.8'); // decimal intact
    expect(scrubbed).toContain('4.5.1');
    expect(scrubbed.length).toBeGreaterThan(0); // kept, not rejected to fallback
  });

  it('scrubs process chatter from an LLM draft while keeping the analysis', () => {
    const scrubbed = scrubLlmPrimaryText(
      'The exposure window is open. Pulling the package in parallel. Patch ships Tuesday.',
    );

    expect(scrubbed).toContain('The exposure window is open');
    expect(scrubbed).toContain('Patch ships Tuesday');
    expect(scrubbed).not.toMatch(/Pulling|in parallel/i);
  });

  it('preserves every item of a numbered list', () => {
    const formatted = formatXPrimaryPostText(
      '1. First point.\n2. Second point.\n3. Third point.\n4. Fourth point.\n5. Fifth point.',
    );

    for (const n of [1, 2, 3, 4, 5]) {
      expect(formatted).toMatch(new RegExp(`${n}\\. `));
    }
    expect(formatted).toContain('First point');
    expect(formatted).toContain('Fifth point');
  });
});
