import { describe, expect, it } from 'vitest';
import { validateCitations } from './citation-validator';

describe('citation-validator', () => {
  // ─── Clean responses ───

  it('returns text with no repairs when no citation issues exist (footer appended for 3 sources)', () => {
    const text = `## KEY FINDINGS

- **[HIGH]** S&P 500 dropped 2.3% today. *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)* *Confidence: 90%*
- **[MEDIUM]** Fed signaled patience. *(Source: [RECALLED] Max memory)* *Confidence: 65%*
- **[LOW]** Analysts expect rebound. *(Source: [ASSESSED] Training knowledge — unverified)* *Confidence: 40%*`;

    const result = validateCitations(text);
    // No repairs needed — all citations are well-formed
    expect(result.repairCount).toBe(0);
    expect(result.repairs).toEqual([]);
    // Footer appended because 3 unique sources exist
    expect(result.text).toContain('**Sources:**');
    expect(result.text).toContain(
      '- [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET',
    );
    expect(result.text).toContain('- [RECALLED] Max memory');
    expect(result.text).toContain('- [ASSESSED] Training knowledge — unverified');
  });

  // ─── Confidence capping ───

  it('caps VERIFIED confidence above 95% to 95%', () => {
    const text = `- **[HIGH]** Market surged. *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)* *Confidence: 99%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 95%');
    expect(result.text).not.toContain('Confidence: 99%');
    expect(result.repairCount).toBe(1);
    expect(result.repairs[0]!.type).toBe('confidence_cap');
  });

  it('caps RECALLED confidence above 70% to 70%', () => {
    const text = `- **[MEDIUM]** Historical pattern matches. *(Source: [RECALLED] Max memory)* *Confidence: 85%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 70%');
    expect(result.repairCount).toBe(1);
  });

  it('caps ASSESSED confidence above 50% to 50%', () => {
    const text = `- **[LOW]** May correlate with rate hike. *(Source: [ASSESSED] Training knowledge)* *Confidence: 75%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 50%');
    expect(result.repairCount).toBe(1);
  });

  it('does not cap confidence at or below tier limit', () => {
    const text = `- *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 10:00 ET)* *Confidence: 95%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 95%');
    expect(result.repairCount).toBe(0);
  });

  it('looks backward up to 3 lines for tier badge', () => {
    const text = `*(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*

Some additional context.
*Confidence: 100%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 95%');
    expect(result.repairCount).toBe(1);
  });

  it('ignores confidence without a nearby tier badge', () => {
    const text = `Overall model *Confidence: 99%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('Confidence: 99%');
    expect(result.repairCount).toBe(0);
  });

  // ─── Tool name detection ───

  it('replaces tool name in source citation with canonical name + URL', () => {
    const text = `*(Source: [VERIFIED] market_snapshot, 14:30 ET)*`;
    const result = validateCitations(text);
    expect(result.text).toContain('[Yahoo Finance](https://finance.yahoo.com)');
    expect(result.text).not.toContain('market_snapshot');
    expect(result.repairs.some((r) => r.type === 'tool_name')).toBe(true);
  });

  it('replaces space-separated tool name variants', () => {
    const text = `*(Source: [VERIFIED] economic data, 10:00 ET)*`;
    const result = validateCitations(text);
    expect(result.text).toContain('[FRED](https://fred.stlouisfed.org)');
    expect(result.text).not.toContain('economic data');
  });

  it('replaces full fetch_ prefixed tool names', () => {
    const text = `*(Source: [VERIFIED] fetch_congress_trades, 09:30 ET)*`;
    const result = validateCitations(text);
    expect(result.text).toContain('[Quiver Quantitative](https://www.quiverquant.com)');
  });

  // ─── VERIFIED link enforcement ───

  it('downgrades VERIFIED to ASSESSED when no link is present', () => {
    const text = `- **[HIGH]** GDP grew 3.1%. *(Source: [VERIFIED] FRED, 10:00 ET)* *Confidence: 90%*`;
    const result = validateCitations(text);
    expect(result.text).toContain('[ASSESSED]');
    expect(result.text).not.toContain('[VERIFIED]');
    expect(result.repairs.some((r) => r.type === 'missing_link')).toBe(true);
    // Confidence should also be capped to 50% (ASSESSED cap)
    expect(result.text).toContain('Confidence: 50%');
  });

  it('keeps VERIFIED when a markdown link is present on same line', () => {
    const text = `*(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 10:00 ET)*`;
    const result = validateCitations(text);
    expect(result.text).toContain('[VERIFIED]');
    expect(result.repairs.filter((r) => r.type === 'missing_link')).toHaveLength(0);
  });

  it('downgrades VERIFIED when link is on a different line', () => {
    const text = `*(Source: [VERIFIED] FRED data, 10:00 ET)*
[Full report](https://fred.stlouisfed.org/series/GDP)`;
    const result = validateCitations(text);
    // Link on a separate line doesn't count — citations are single-line
    expect(result.text).toContain('[ASSESSED]');
    expect(result.repairs.some((r) => r.type === 'missing_link')).toBe(true);
  });

  // ─── Multiple repairs ───

  it('applies multiple repairs in one response', () => {
    const text = `## KEY FINDINGS

- **[HIGH]** Markets dropped. *(Source: [VERIFIED] market_snapshot, 14:30 ET)* *Confidence: 99%*
- **[MEDIUM]** Fed data suggests caution. *(Source: [VERIFIED] FRED, 10:00 ET)* *Confidence: 80%*`;

    const result = validateCitations(text);
    // Should have: 1 tool name repair, 1 missing link (FRED no URL -> downgrade), confidence caps
    expect(result.repairCount).toBeGreaterThanOrEqual(3);
  });

  // ─── Edge cases ───

  it('handles empty text', () => {
    const result = validateCitations('');
    expect(result.text).toBe('');
    expect(result.repairCount).toBe(0);
  });

  it('handles text with no citations at all', () => {
    const text = `Here is a plain response with no citation formatting whatsoever.
Just regular markdown text.`;
    const result = validateCitations(text);
    expect(result.text).toBe(text);
    expect(result.repairCount).toBe(0);
  });

  it('handles multiple VERIFIED on the same line', () => {
    const text = `[VERIFIED] first claim and [VERIFIED] second claim without any links`;
    const result = validateCitations(text);
    expect(result.text).toContain('[ASSESSED]');
    expect(result.text).not.toContain('[VERIFIED]');
  });

  it('preserves markdown formatting around repairs', () => {
    const text = `- **[HIGH]** CPI rose 0.4%. *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 08:30 ET)* *Confidence: 98%*`;
    const result = validateCitations(text);
    // Should cap confidence but preserve surrounding markdown
    expect(result.text).toContain('*(Source: [VERIFIED]');
    expect(result.text).toContain('*Confidence: 95%*');
    expect(result.text).toContain('**[HIGH]**');
  });

  // ─── Composition order ───

  it('applies tool name replacement before link enforcement', () => {
    // Tool name replaced with canonical link → VERIFIED preserved (link now exists)
    const text = `*(Source: [VERIFIED] fetch_economic_data, 10:00 ET)* *Confidence: 90%*`;
    const result = validateCitations(text);
    // Tool name should be replaced with [FRED](url) — which IS a link
    expect(result.text).toContain('[FRED](https://fred.stlouisfed.org)');
    // Since there's now a link, VERIFIED should be preserved
    expect(result.text).toContain('[VERIFIED]');
  });

  // ─── Source aggregation ───

  it('appends sources footer when 2+ unique URLs exist', () => {
    const text = `## KEY FINDINGS

- **[HIGH]** S&P 500 dropped 2.3%. *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)* *Confidence: 90%*
- **[HIGH]** CPI rose 0.4%. *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 08:30 ET)* *Confidence: 85%*`;

    const result = validateCitations(text);
    expect(result.text).toContain('---');
    expect(result.text).toContain('**Sources:**');
    expect(result.text).toContain(
      '- [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET',
    );
    expect(result.text).toContain('- [VERIFIED] [FRED](https://fred.stlouisfed.org), 08:30 ET');
  });

  it('does not append footer with fewer than 2 unique sources', () => {
    const text = `- **[HIGH]** Market surged. *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)* *Confidence: 90%*`;
    const result = validateCitations(text);
    expect(result.text).not.toContain('**Sources:**');
  });

  it('deduplicates by exact URL', () => {
    const text = `- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*
- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:35 ET)*
- *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 10:00 ET)*`;

    const result = validateCitations(text);
    expect(result.text).toContain('**Sources:**');
    // Yahoo Finance should appear only once
    const footer = result.text.split('**Sources:**')[1]!;
    const yahooMatches = footer.match(/Yahoo Finance/g);
    expect(yahooMatches).toHaveLength(1);
  });

  it('keeps different URLs from same domain', () => {
    const text = `- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*
- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com/calendar/earnings), 14:35 ET)*`;

    const result = validateCitations(text);
    expect(result.text).toContain('**Sources:**');
    expect(result.text).toContain('[Yahoo Finance](https://finance.yahoo.com),');
    expect(result.text).toContain('[Yahoo Finance](https://finance.yahoo.com/calendar/earnings),');
  });

  it('preserves highest tier on dedup', () => {
    const text = `- *(Source: [ASSESSED] [FRED](https://fred.stlouisfed.org), 10:00 ET)*
- *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 10:05 ET)*
- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*`;

    const result = validateCitations(text);
    const footer = result.text.split('**Sources:**')[1]!;
    // FRED should show VERIFIED (highest tier), not ASSESSED
    expect(footer).toContain('[VERIFIED] [FRED]');
    expect(footer).not.toContain('[ASSESSED] [FRED]');
  });

  it('includes non-linked sources', () => {
    const text = `- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*
- *(Source: [RECALLED] Max memory)*
- *(Source: [ASSESSED] Training knowledge — unverified)*`;

    const result = validateCitations(text);
    expect(result.text).toContain('**Sources:**');
    expect(result.text).toContain('- [RECALLED] Max memory');
    expect(result.text).toContain('- [ASSESSED] Training knowledge — unverified');
  });

  it('formats with tier badge and timestamp', () => {
    const text = `- *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 14:32 ET)*
- *(Source: [ASSESSED] Training knowledge — unverified)*`;

    const result = validateCitations(text);
    expect(result.text).toContain('- [VERIFIED] [FRED](https://fred.stlouisfed.org), 14:32 ET');
    expect(result.text).toContain('- [ASSESSED] Training knowledge — unverified');
  });

  it('runs after other validators — uses canonical names and final tiers', () => {
    // Tool name "fetch_economic_data" should be replaced with FRED link,
    // and both sources should appear in footer
    const text = `- *(Source: [VERIFIED] fetch_economic_data, 10:00 ET)* *Confidence: 90%*
- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)* *Confidence: 90%*`;

    const result = validateCitations(text);
    // Tool name replaced
    expect(result.text).toContain('[FRED](https://fred.stlouisfed.org)');
    // Footer should have canonical names
    expect(result.text).toContain('**Sources:**');
    const footer = result.text.split('**Sources:**')[1]!;
    expect(footer).toContain('FRED');
    expect(footer).toContain('Yahoo Finance');
  });

  it('does not append if footer already exists', () => {
    const text = `- *(Source: [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET)*
- *(Source: [VERIFIED] [FRED](https://fred.stlouisfed.org), 10:00 ET)*

---
**Sources:**
- [VERIFIED] [Yahoo Finance](https://finance.yahoo.com), 14:30 ET`;

    const result = validateCitations(text);
    // Should not double-append
    const sourcesSections = result.text.match(/\*\*Sources:\*\*/g);
    expect(sourcesSections).toHaveLength(1);
  });
});
